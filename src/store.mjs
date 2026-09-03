import { createHash, randomUUID } from 'node:crypto';
import { canonicalUrl, evaluateAssessment, formatAlert } from './core.mjs';
import { validateMission } from './hunter.mjs';
export function stableJson(value) {
  if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableJson(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function hash(value) {return createHash('sha256').update(stableJson(value)).digest('hex');}
function key(value) {if(typeof value!=='string'||!/^[a-zA-Z0-9_.:-]{4,160}$/.test(value))throw new Error('IDEMPOTENCY_KEY_REQUIRED');return value;}
function checkedUuid(value) {if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||''))throw new Error('INVALID_ID');return value;}

export class PgStore {
  constructor(pool) {this.pool=pool;}
  async tx(fn) {
    const client=await this.pool.connect();
    try {await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }
  async health(){
    const result=await this.pool.query('SELECT version FROM flip_radar.schema_migrations WHERE version=$1',['001_foundation']);
    if(!result.rows.length)throw new Error('SCHEMA_MIGRATION_REQUIRED');
    return true;
  }
  async sources() {return (await this.pool.query('SELECT config FROM flip_radar.sources ORDER BY id')).rows.map(r=>r.config);}
  async createMission(request) {
    key(request.request_key);validateMission(request.mission);
    const fingerprint=hash(request.mission);
    return this.tx(async c=>{
      const row=(await c.query(`INSERT INTO flip_radar.missions(request_key,input_hash,payload)
        VALUES($1,$2,$3::jsonb) ON CONFLICT(request_key) DO NOTHING RETURNING id,status`,[request.request_key,fingerprint,JSON.stringify(request.mission)])).rows[0];
      if(row)return {...row,created:true};
      const existing=(await c.query('SELECT id,status,input_hash FROM flip_radar.missions WHERE request_key=$1',[request.request_key])).rows[0];
      if(existing.input_hash!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');
      return {id:existing.id,status:existing.status,created:false};
    });
  }
  async claimMission() {
    return this.tx(async c=>{
      await c.query(`UPDATE flip_radar.missions SET status='failed',last_error='MAX_ATTEMPTS',updated_at=now()
        WHERE status='running' AND lease_until<now() AND attempts>=3`);
      const row=(await c.query(`SELECT * FROM flip_radar.missions
        WHERE (status='queued' OR (status='running' AND lease_until<now())) AND attempts<3
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
      if(!row)return null;
      const token=randomUUID();
      await c.query(`UPDATE flip_radar.missions SET status='running',attempts=attempts+1,
        lease_token=$2,lease_until=now()+interval '10 minutes',updated_at=now() WHERE id=$1`,[row.id,token]);
      return {id:row.id,lease_token:token,payload:row.payload};
    });
  }
  async finishMission(claim,result) {
    if(result.mode!=='live')throw new Error('TEST_DATA_NOT_PERSISTED');
    return this.tx(async c=>{
      const lease=(await c.query(`SELECT id FROM flip_radar.missions WHERE id=$1 AND status='running'
        AND lease_token=$2 AND lease_until>now() FOR UPDATE`,[claim.id,claim.lease_token])).rows[0];
      if(!lease)throw new Error('MISSION_LEASE_LOST');
      const summary={...result,candidates:undefined,trace:undefined};
      await c.query(`INSERT INTO flip_radar.runs(id,mission_id,status,summary,trace) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)`,
        [result.run_id,claim.id,result.status,JSON.stringify(summary),JSON.stringify(result.trace)]);
      const ids=[];
      for(const listing of result.candidates) {
        if(listing.mode!=='live')throw new Error('TEST_DATA_NOT_PERSISTED');
        const url=canonicalUrl(listing.url);
        const fingerprint=hash({url,price:listing.price,currency:listing.currency,title:listing.title,product_key:listing.product_key,condition_key:listing.condition_key});
        const inserted=(await c.query(`INSERT INTO flip_radar.listings(source_id,source_listing_id,canonical_url,payload,fingerprint,observed_at)
          VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT(canonical_url) DO UPDATE SET
          payload=EXCLUDED.payload,fingerprint=EXCLUDED.fingerprint,observed_at=EXCLUDED.observed_at,updated_at=now()
          WHERE EXCLUDED.observed_at>=flip_radar.listings.observed_at RETURNING id`,
          [listing.source_id,listing.source_listing_id,url,JSON.stringify(listing),fingerprint,listing.observed_at])).rows[0];
        if(!inserted)continue;
        ids.push(inserted.id);
        await c.query(`INSERT INTO flip_radar.listing_events(listing_id,run_id,fingerprint,payload)
          VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(listing_id,fingerprint) DO NOTHING`,[inserted.id,result.run_id,fingerprint,JSON.stringify(listing)]);
      }
      await c.query(`UPDATE flip_radar.missions SET status='completed',lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=now() WHERE id=$1`,[claim.id]);
      return {listing_ids:ids};
    });
  }
  async failMission(claim,code) {
    await this.pool.query(`UPDATE flip_radar.missions SET status='failed',last_error=$3,lease_token=NULL,lease_until=NULL,updated_at=now()
      WHERE id=$1 AND lease_token=$2`,[claim.id,claim.lease_token,code]);
  }
  async mission(id) {
    checkedUuid(id);return (await this.pool.query('SELECT id,status,attempts,last_error,created_at,updated_at FROM flip_radar.missions WHERE id=$1',[id])).rows[0]||null;
  }
  async listings() {return (await this.pool.query('SELECT id,payload,observed_at FROM flip_radar.listings ORDER BY observed_at DESC LIMIT 50')).rows;}
  async opportunities() {return (await this.pool.query('SELECT id,listing_id,verdict,payload,created_at FROM flip_radar.opportunities ORDER BY created_at DESC LIMIT 50')).rows;}
  async review(request,{alertsEnabled=false,now=new Date().toISOString()}={}) {
    key(request.request_key);checkedUuid(request.listing_id);
    const fingerprint=hash(request);
    return this.tx(async c=>{
      // Serialize concurrent reviews for one listing; don't double-enqueue a deal.
      const row=(await c.query('SELECT payload FROM flip_radar.listings WHERE id=$1 FOR UPDATE',[request.listing_id])).rows[0];
      if(!row)throw new Error('LISTING_NOT_FOUND');
      const old=(await c.query(`SELECT r.input_hash,o.id,o.payload FROM flip_radar.reviews r
        JOIN flip_radar.opportunities o ON o.review_id=r.id WHERE r.request_key=$1`,[request.request_key])).rows[0];
      if(old) {if(old.input_hash!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return {id:old.id,result:old.payload,created:false};}
      const allowed=['product_key','condition_key','identity_confidence','costs_eur','availability'];
      const updates={};for(const name of allowed)if(request.listing_updates?.[name]!==undefined)updates[name]=request.listing_updates[name];
      const listing={...row.payload,...updates};
      const input={listing,quotes:request.quotes,risk:request.risk,fx:request.fx};
      const result=evaluateAssessment(input,{now});
      if(result.simulated)throw new Error('TEST_DATA_NOT_PERSISTED');
      const review=(await c.query(`INSERT INTO flip_radar.reviews(listing_id,request_key,input_hash,payload)
        VALUES($1,$2,$3,$4::jsonb) RETURNING id`,[request.listing_id,request.request_key,fingerprint,JSON.stringify(input)])).rows[0];
      const opp=(await c.query(`INSERT INTO flip_radar.opportunities(listing_id,review_id,verdict,payload)
        VALUES($1,$2,$3,$4::jsonb) RETURNING id`,[request.listing_id,review.id,result.verdict,JSON.stringify(result)])).rows[0];
      if(alertsEnabled && result.notification_allowed) {
        const dedupe=hash({listing_id:request.listing_id,channel:result.best.channel,country:result.best.country,
          cost:result.best.all_in_eur,net:result.best.conservative_net_eur});
        await c.query(`INSERT INTO flip_radar.alert_outbox(opportunity_id,dedupe_key,text) VALUES($1,$2,$3)
          ON CONFLICT(dedupe_key) DO NOTHING`,[opp.id,dedupe,formatAlert(result)]);
      }
      return {id:opp.id,result,created:true};
    });
  }
  async claimAlert() {
    return this.tx(async c=>{
      // Never blindly resend a message after an uncertain external send.
      await c.query(`UPDATE flip_radar.alert_outbox SET status='uncertain' WHERE status='claimed' AND claimed_at<now()-interval '15 minutes'`);
      const row=(await c.query(`SELECT id,text FROM flip_radar.alert_outbox WHERE status='pending'
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
      if(!row)return null;
      const token=randomUUID();
      await c.query(`UPDATE flip_radar.alert_outbox SET status='claimed',claim_token=$2,claimed_at=now() WHERE id=$1`,[row.id,token]);
      return {id:row.id,text:row.text,claim_token:token};
    });
  }
  async ackAlert({id,claim_token,message_id}) {
    checkedUuid(id);checkedUuid(claim_token);
    if(!/^[0-9]+$/.test(String(message_id||'')))throw new Error('MESSAGE_ID_REQUIRED');
    const r=await this.pool.query(`UPDATE flip_radar.alert_outbox SET status='sent',sent_at=COALESCE(sent_at,now()),telegram_message_id=$3
      WHERE id=$1 AND claim_token=$2 AND (status IN ('claimed','uncertain') OR (status='sent' AND telegram_message_id=$3)) RETURNING id`,[id,claim_token,String(message_id)]);
    if(!r.rows.length)throw new Error('ALERT_LEASE_LOST');
    return {id,status:'sent'};
  }
  async recordDecision(request) {
    key(request.request_key);checkedUuid(request.opportunity_id);
    if(!['watch','reject','bought','sold_elsewhere'].includes(request.decision))throw new Error('DECISION_INVALID');
    if(typeof request.notes!=='string'||request.notes.length>2000)throw new Error('NOTES_INVALID');
    return this.tx(async c=>{
      const row=(await c.query(`INSERT INTO flip_radar.decisions(opportunity_id,request_key,decision,notes)
        VALUES($1,$2,$3,$4) ON CONFLICT(request_key) DO NOTHING RETURNING id`,[request.opportunity_id,request.request_key,request.decision,request.notes])).rows[0];
      if(row)return {id:row.id,created:true,transaction_executed:false};
      const prior=(await c.query('SELECT * FROM flip_radar.decisions WHERE request_key=$1',[request.request_key])).rows[0];
      if(prior.opportunity_id!==request.opportunity_id||prior.decision!==request.decision||prior.notes!==request.notes)throw new Error('IDEMPOTENCY_CONFLICT');
      return {id:prior.id,created:false,transaction_executed:false};
    });
  }
}
