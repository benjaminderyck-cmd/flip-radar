import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PgStore} from '../src/store.mjs';
import {buildServer,loadConfig} from '../src/server.mjs';
import {source,mission,goodAssessment,FakeBrowser,ScriptedModel,normalActions} from './fixtures.mjs';

test('HTTP to PostgreSQL pipeline: hunt, review, outbox, acknowledgement, no external action',async()=>{
  const db=new PGlite();let app;
  try{
    for(const name of ['001_foundation.sql','002_reference_sales.sql'])await db.exec(await readFile(new URL('../sql/'+name,import.meta.url),'utf8'));
    const now=new Date().toISOString(),freshSource={...source,reviewed_at:now};
    await db.query('INSERT INTO flip_radar.sources(id,config) VALUES($1,$2::jsonb)',[source.id,JSON.stringify(freshSource)]);
    const query=(sql,args)=>db.query(sql,args),store=new PgStore({query,connect:async()=>({query,release(){}})});
    const env={FLIP_RADAR_WORKER_TOKEN:'integration-worker-token-FICTITIOUS-000',FLIP_RADAR_REVIEW_TOKEN:'integration-review-token-FICTITIOUS-111',FLIP_RADAR_LIVE_ENABLED:'true',FLIP_RADAR_ALERTS_ENABLED:'true'};
    const browser=new FakeBrowser(),model=new ScriptedModel(normalActions);
    const referenceImporter=async()=>{
      const first={source_id:'dnid_sales_2024',source_record_id:'900:abcdef0123456789',official_lot_id:'900',
        description:'Console Nintendo Switch',description_derived:false,category:'Jeux vidéo',brand:'Nintendo',model:'Switch',
        first_registration_date:null,sale_number:'V900',sold_at:'2024-04-05',organizer:'PARIS',sale_name:'Vente 900',
        sold_price_eur_cents:14500,verification_ref:'https://www.data.gouv.fr/datasets/donnees-de-ventes-annee-2024',
        source_updated_at:'2026-02-20T11:13:25.000Z',license_id:'etalab-2.0',raw_hash:'b'.repeat(64)};
      const second={...first,source_record_id:'901:bcdef0123456789a',official_lot_id:'901',sale_number:'V901',
        sold_price_eur_cents:15500,raw_hash:'c'.repeat(64)};
      const saved=await store.upsertReferenceSales([first,second]);
      return {...saved,historical_only:true,eligible_as_current_market_proof:false};
    };
    // Test adapters only. No provider, marketplace, Telegram or real database.
    app=buildServer({store,config:loadConfig(env),browserFactory:()=>browser,modelFactory:()=>model,referenceImporter});
    await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
    const base='http://127.0.0.1:'+app.server.address().port;
    const request=async(path,body,review=false)=>{
      const res=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',authorization:'Bearer '+(review?env.FLIP_RADAR_REVIEW_TOKEN:env.FLIP_RADAR_WORKER_TOKEN)},body:body===undefined?undefined:JSON.stringify(body)});
      return {status:res.status,data:await res.json()};
    };
    const m=await request('/v1/missions',{request_key:'integration-mission',mission:mission()});assert.equal(m.status,201);
    const run=await request('/v1/runs/next',{});assert.equal(run.status,202);assert.equal(run.data.status,'started');
    await app.waitForJobs();
    assert.equal((await request('/v1/missions/'+m.data.id)).data.status,'completed');assert.equal(browser.closed,true);
    const rows=(await request('/v1/listings')).data.listings;assert.equal(rows.length,1);assert.equal(rows[0].payload.review_status,'unverified');
    assert.equal((await request('/v1/opportunities')).data.opportunities.length,0);
    const evidence=goodAssessment();
    evidence.risk.reviewed_at=now;evidence.quotes[0].fees_reviewed_at=now;evidence.quotes[0].market.observed_at=now;
    evidence.quotes[0].comps.forEach((c,i)=>{
      c.sold_at=new Date(Date.parse(now)-(i+1)*86400000).toISOString();
      c.listed_at=new Date(Date.parse(c.sold_at)-10*86400000).toISOString();
    });
    const review={request_key:'integration-review',listing_id:rows[0].id,listing_updates:{costs_eur:evidence.listing.costs_eur,identity_confidence:0.96,availability:'active'},quotes:evidence.quotes,risk:evidence.risk,fx:{}};
    assert.equal((await request('/v1/reviews',review)).status,403);
    const reviewed=await request('/v1/reviews',review,true);assert.equal(reviewed.status,200);assert.equal(reviewed.data.result.verdict,'GO');
    const claimed=await request('/v1/alerts/claim',{});assert.equal(claimed.data.status,'claimed');
    assert.equal((await request('/v1/alerts/claim',{})).data.status,'idle');
    // Simulate an acknowledgement only; no message is sent by this test.
    const ack=await request('/v1/alerts/ack',{id:claimed.data.alert.id,claim_token:claimed.data.alert.claim_token,message_id:42});assert.equal(ack.data.status,'sent');
    const decision=await request('/v1/decisions',{request_key:'integration-watch',opportunity_id:reviewed.data.id,decision:'watch',notes:'Fixture only'},true);
    assert.equal(decision.data.transaction_executed,false);assert.equal(model.usage.calls,4);
    assert.equal((await request('/v1/reference-sales/import',{request_key:'integration-reference'})).status,403);
    const imported=await request('/v1/reference-sales/import',{request_key:'integration-reference'},true);
    assert.equal(imported.status,202);await app.waitForJobs();
    assert.equal((await request('/v1/reference-sales/imports/'+imported.data.id)).data.status,'completed');
    const references=await request('/v1/reference-sales?brand=Nintendo');
    assert.equal(references.data.records.length,2);assert.equal(references.data.historical_only,true);
    assert.equal(references.data.eligible_as_current_market_proof,false);
    const families=await request('/v1/reference-sales/families?level=category&min_sales=2&limit=10');
    assert.equal(families.status,200);assert.equal(families.data.groups[0].category,'Jeux vidéo');
    assert.equal(families.data.historical_only,true);assert.equal(families.data.eligible_as_current_market_proof,false);
  }finally{if(app)await app.stop();await db.close();}
});
