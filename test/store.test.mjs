import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {PgStore} from '../src/store.mjs';
import {NOW,source,mission,goodAssessment} from './fixtures.mjs';

let db,store,serial=0;
const sql=(await Promise.all(['001_foundation.sql','002_reference_sales.sql'].map(name=>readFile(new URL('../sql/'+name,import.meta.url),'utf8')))).join('\n');
before(async()=>{
  db=new PGlite();await db.exec(sql);
  const query=(text,values)=>db.query(text,values);
  store=new PgStore({query,connect:async()=>({query,release(){}})});
  await db.query('INSERT INTO flip_radar.sources(id,config) VALUES($1,$2::jsonb)',[source.id,JSON.stringify(source)]);
});
after(async()=>{await db?.close();});
async function freshListing(overrides={}){
  const n=++serial;
  const input=goodAssessment();
  const listing={...input.listing,mode:'live',source_listing_id:'sql-'+n,url:`https://market.example/item/sql-${n}`,...overrides};
  await store.createMission({request_key:'sql-mission-'+n,mission:mission()});
  const claim=await store.claimMission();
  const result={run_id:randomUUID(),mode:'live',status:'completed',candidates:[listing],trace:[],external_calls:0};
  const saved=await store.finishMission(claim,result);
  return {id:saved.listing_ids[0],listing,input,claim,result};
}
const reviewRequest=(saved,key)=>({request_key:key,listing_id:saved.id,quotes:saved.input.quotes,risk:saved.input.risk,fx:{}});

test('PostgreSQL migration is rerunnable and preserves existing source',async()=>{
  await db.exec(sql);
  assert.equal(await store.health(),true);
  assert.equal((await store.sources()).length,1);
  const r=await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='flip_radar' AND rowsecurity=true");
  assert.equal(r.rows[0].n,12);
});
test('historical reference imports are idempotent, searchable and explicitly non-current',async()=>{
  const request=await store.createReferenceImport({request_key:'reference-import-one'});
  assert.equal(request.created,true);
  assert.ok((await store.startReferenceImport(request.id)).id);
  const record={source_id:'dnid_sales_2024',source_record_id:'42:0123456789abcdef',official_lot_id:'42',
    description:'Console Nintendo Switch',description_derived:false,category:'Jeux vidéo',brand:'Nintendo',model:'Switch',
    first_registration_date:null,sale_number:'V42',sold_at:'2024-02-03',organizer:'PARIS',sale_name:'Vente 42',
    sold_price_eur_cents:15000,verification_ref:'https://www.data.gouv.fr/datasets/donnees-de-ventes-annee-2024',
    source_updated_at:'2026-02-20T11:13:25.000Z',license_id:'etalab-2.0',raw_hash:'a'.repeat(64)};
  assert.equal((await store.upsertReferenceSales([record])).rows_processed,1);
  assert.equal((await store.upsertReferenceSales([record])).rows_processed,1);
  await store.finishReferenceImport(request.id,{rows_processed:1});
  assert.equal((await store.referenceImport(request.id)).status,'completed');
  const result=await store.referenceSales({brand:'Nintendo'});
  assert.equal(result.records.length,1);assert.equal(result.records[0].sold_price_eur,150);
  assert.equal(result.records[0].official_lot_id,'42');assert.equal(result.historical_only,true);
  assert.equal(result.eligible_as_current_market_proof,false);
  await assert.rejects(()=>store.referenceSales({}),/REFERENCE_QUERY_REQUIRED/);
  await assert.rejects(()=>store.referenceSales({q:'x',limit:51}),/REFERENCE_LIMIT_INVALID/);
});
test('mission request is idempotent, changed payload with same key conflicts',async()=>{
  const req={request_key:'dedup-mission',mission:mission()};
  const a=await store.createMission(req),b=await store.createMission(req);
  assert.equal(a.id,b.id);assert.equal(a.created,true);assert.equal(b.created,false);
  await assert.rejects(()=>store.createMission({...req,mission:{...req.mission,objective:'Une autre recherche explicite'}}),/IDEMPOTENCY_CONFLICT/);
  const claim=await store.claimMission();assert.equal(claim.id,a.id);
  assert.equal(await store.claimMission(),null);
  await store.failMission(claim,'TEST_END');
});
test('live candidates persist, simulation data cannot enter database',async()=>{
  const saved=await freshListing();
  assert.equal((await store.mission(saved.claim.id)).status,'completed');
  assert.equal((await store.listings()).find(r=>r.id===saved.id).payload.mode,'live');
  await assert.rejects(()=>store.finishMission(saved.claim,{...saved.result,mode:'test'}),/TEST_DATA_NOT_PERSISTED/);
});
test('lost lease cannot finalize a mission twice',async()=>{
  const saved=await freshListing();
  await assert.rejects(()=>store.finishMission(saved.claim,{...saved.result,run_id:randomUUID()}),/MISSION_LEASE_LOST/);
});
test('duplicate observations deduplicate listings and events',async()=>{
  const first=await freshListing();
  const second=await freshListing(first.listing);
  assert.equal(second.id,first.id);
  const count=await db.query('SELECT count(*)::int AS n FROM flip_radar.listing_events WHERE listing_id=$1',[first.id]);
  assert.equal(count.rows[0].n,1);
  const changed=await freshListing({...first.listing,price:90});
  assert.equal(changed.id,first.id);
  const events=await db.query('SELECT count(*)::int AS n FROM flip_radar.listing_events WHERE listing_id=$1',[first.id]);
  assert.equal(events.rows[0].n,2);
});
test('failed candidate insert rolls the entire run back',async()=>{
  const saved=await freshListing();
  await store.createMission({request_key:'rollback-mission',mission:mission()});
  const claim=await store.claimMission(),runId=randomUUID();
  const invalid={...saved.listing,source_id:'missing_source',url:'https://market.example/item/rollback',source_listing_id:'rollback'};
  await assert.rejects(()=>store.finishMission(claim,{...saved.result,run_id:runId,candidates:[invalid]}));
  assert.equal((await db.query('SELECT id FROM flip_radar.runs WHERE id=$1',[runId])).rows.length,0);
  assert.equal((await store.mission(claim.id)).status,'running');
  await store.failMission(claim,'TEST_END');
});
test('review is idempotent and disabled alerts leave no outbox row',async()=>{
  const saved=await freshListing(),req=reviewRequest(saved,'review-disabled');
  const a=await store.review(req,{now:NOW}),b=await store.review(req,{now:NOW});
  assert.equal(a.result.verdict,'GO');assert.equal(b.id,a.id);assert.equal(b.created,false);
  assert.equal((await db.query('SELECT id FROM flip_radar.alert_outbox WHERE opportunity_id=$1',[a.id])).rows.length,0);
  await assert.rejects(()=>store.review({...req,risk:{...req.risk,score:99}},{now:NOW}),/IDEMPOTENCY_CONFLICT/);
});
test('review cannot change source URL, live mode or observation time',async()=>{
  const saved=await freshListing();
  const req={...reviewRequest(saved,'review-fields'),listing_updates:{url:'https://attacker.example',mode:'test',observed_at:'2099-01-01'}};
  const r=await store.review(req,{now:NOW});
  assert.equal(r.result.listing_url,saved.listing.url);assert.equal(r.result.simulated,false);
});
test('same economics enqueue once; claimed alert cannot be sent again by another worker',async()=>{
  const saved=await freshListing();
  const r=await store.review(reviewRequest(saved,'review-alert-one'),{now:NOW,alertsEnabled:true});
  await store.review(reviewRequest(saved,'review-alert-two'),{now:NOW,alertsEnabled:true});
  const rows=await db.query('SELECT id FROM flip_radar.alert_outbox WHERE opportunity_id=$1',[r.id]);assert.equal(rows.rows.length,1);
  const a=await store.claimAlert();assert.ok(a.id);assert.equal(await store.claimAlert(),null);
  assert.equal((await store.ackAlert({...a,message_id:123})).status,'sent');
  assert.equal((await store.ackAlert({...a,message_id:123})).status,'sent');
  await assert.rejects(()=>store.ackAlert({...a,claim_token:randomUUID(),message_id:123}),/ALERT_LEASE_LOST/);
  assert.equal(await store.claimAlert(),null);
});
test('uncertain Telegram delivery is not blindly retried',async()=>{
  const saved=await freshListing();
  await store.review(reviewRequest(saved,'review-uncertain'),{now:NOW,alertsEnabled:true});
  const a=await store.claimAlert();
  await db.query("UPDATE flip_radar.alert_outbox SET claimed_at=now()-interval '16 minutes' WHERE id=$1",[a.id]);
  assert.equal(await store.claimAlert(),null);
  assert.equal((await db.query('SELECT status FROM flip_radar.alert_outbox WHERE id=$1',[a.id])).rows[0].status,'uncertain');
});
test('unknown costs and unverified demand never create an alert',async()=>{
  const saved=await freshListing({costs_eur:{}}),req=reviewRequest(saved,'review-missing');
  req.quotes[0].market={verified_by:'llm',favourites:500};
  const r=await store.review(req,{now:NOW,alertsEnabled:true});
  assert.equal(r.result.verdict,'REVUE');
  assert.equal((await db.query('SELECT id FROM flip_radar.alert_outbox WHERE opportunity_id=$1',[r.id])).rows.length,0);
});
test('manual decision records intent, executes no purchase and is idempotent',async()=>{
  const saved=await freshListing();
  const r=await store.review(reviewRequest(saved,'review-decision'),{now:NOW});
  const req={request_key:'decision-one',opportunity_id:r.id,decision:'bought',notes:'Enregistrement de test uniquement'};
  const a=await store.recordDecision(req),b=await store.recordDecision(req);
  assert.equal(a.transaction_executed,false);assert.equal(a.id,b.id);assert.equal(b.created,false);
  await assert.rejects(()=>store.recordDecision({...req,decision:'reject'}),/IDEMPOTENCY_CONFLICT/);
});
