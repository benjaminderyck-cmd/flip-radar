import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildServer,loadConfig,publicError} from '../src/server.mjs';

const env={FLIP_RADAR_WORKER_TOKEN:'test-worker-token-not-a-real-secret-1234',FLIP_RADAR_REVIEW_TOKEN:'test-review-token-not-a-real-secret-5678'};
async function withServer(fn,overrides={},buildOverrides={}){
  const calls=[];
  const store={health:async()=>true,listings:async()=>[],opportunities:async()=>[],
    createMission:async x=>{calls.push(x);return {id:'fixture-id',created:true};},
    review:async()=>({id:'fixture-review'}),recordDecision:async()=>({transaction_executed:false}),
    referenceSales:async()=>({historical_only:true,records:[]}),referenceImport:async()=>null,
    createReferenceImport:async()=>({id:'12345678-1234-4123-a123-123456789abc',status:'queued',created:true}),
    startReferenceImport:async id=>({id,source_id:'dnid_sales_2024'}),
    finishReferenceImport:async()=>({status:'completed'}),failReferenceImport:async()=>{},
    claimAlert:async()=>{throw new Error('SHOULD_NOT_CLAIM');},...overrides};
  const app=buildServer({store,config:loadConfig(env),...buildOverrides});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  const request=async(path,{token=env.FLIP_RADAR_WORKER_TOKEN,body,method=body===undefined?'GET':'POST',raw}={})=>{
    const res=await fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:raw??(body===undefined?undefined:JSON.stringify(body))});
    return {status:res.status,data:await res.json()};
  };
  try{await fn({request,calls,app});}finally{await app.stop();}
}
test('two distinct strong API tokens required',()=>{
  assert.throws(()=>loadConfig({}),/TWO_DISTINCT/);
  assert.throws(()=>loadConfig({...env,FLIP_RADAR_REVIEW_TOKEN:env.FLIP_RADAR_WORKER_TOKEN}),/TWO_DISTINCT/);
  assert.equal(loadConfig(env).liveEnabled,false);assert.equal(loadConfig(env).alertsEnabled,false);
});
test('invalid live run limits are rejected',()=>{
  assert.throws(()=>loadConfig({...env,FLIP_RADAR_MAX_STEPS:'1000'}),/INVALID_RUN_LIMIT/);
  assert.throws(()=>loadConfig({...env,FLIP_RADAR_MAX_STEPS:'-1'}),/INVALID_RUN_LIMIT/);
});
test('public health reveals no private configuration',async()=>withServer(async({request})=>{
  const r=await request('/health',{token:''});assert.equal(r.status,200);assert.equal(r.data.service,'flip-radar');
  assert.equal(JSON.stringify(r.data).includes('token'),false);
}));
test('private routes reject missing or wrong credentials',async()=>withServer(async({request})=>{
  assert.equal((await request('/v1/status',{token:''})).status,401);
  assert.equal((await request('/v1/listings',{token:'incorrect'})).status,401);
}));
test('worker cannot submit human evidence or decisions',async()=>withServer(async({request})=>{
  assert.equal((await request('/v1/reviews',{body:{}})).status,403);
  assert.equal((await request('/v1/decisions',{body:{}})).status,403);
  assert.equal((await request('/v1/reviews',{body:{},token:env.FLIP_RADAR_REVIEW_TOKEN})).status,200);
}));
test('historical reference search is authenticated and rejects unknown filters',async()=>withServer(async({request})=>{
  const ok=await request('/v1/reference-sales?brand=Nintendo');
  assert.equal(ok.status,200);assert.equal(ok.data.historical_only,true);
  assert.equal((await request('/v1/reference-sales?sort=price')).data.error,'REFERENCE_QUERY_INVALID');
}));
test('only reviewer can start the official reference import',async()=>{
  let completed=false;
  await withServer(async({request,app})=>{
    assert.equal((await request('/v1/reference-sales/import',{body:{request_key:'reference-one'}})).status,403);
    const started=await request('/v1/reference-sales/import',{body:{request_key:'reference-one'},token:env.FLIP_RADAR_REVIEW_TOKEN});
    assert.equal(started.status,202);assert.equal(started.data.run_status,'started');
    await app.waitForJobs();assert.equal(completed,true);
  },{finishReferenceImport:async()=>{completed=true;}},{referenceImporter:async()=>({rows_processed:1,historical_only:true})});
});
test('request body cannot switch on live browsing or alerts',async()=>withServer(async({request})=>{
  const r=await request('/v1/runs/next',{body:{liveEnabled:true,mode:'live'}});
  assert.equal(r.status,503);assert.equal(r.data.error,'LIVE_DISABLED');
  const alert=await request('/v1/alerts/claim',{body:{alertsEnabled:true}});
  assert.equal(alert.data.status,'disabled');
}));
test('JSON and body size are validated before storage',async()=>withServer(async({request,calls})=>{
  assert.equal((await request('/v1/missions',{method:'POST',raw:'{'})).data.error,'INVALID_JSON');
  assert.equal((await request('/v1/missions',{body:[]})).data.error,'JSON_OBJECT_REQUIRED');
  assert.equal((await request('/v1/missions',{body:{text:'x'.repeat(513000)}})).status,413);
  assert.equal(calls.length,0);
}));
test('mission route delegates without performing any browser action',async()=>withServer(async({request,calls})=>{
  const r=await request('/v1/missions',{body:{request_key:'fixture-key',mission:{objective:'Fixture only'}}});
  assert.equal(r.status,201);assert.equal(calls.length,1);
}));
test('database secrets and unexpected exception text are never returned',async()=>withServer(async({request})=>{
  const r=await request('/v1/status');assert.equal(r.status,500);assert.equal(r.data.error,'INTERNAL_ERROR');
},{health:async()=>{throw new Error('postgres://private:secret@host/database');}}));
test('public error encoder exposes only bounded machine codes',()=>{
  assert.equal(publicError(new Error('LIVE_DISABLED')),'LIVE_DISABLED');
  assert.equal(publicError(new Error('my token: private')),'INTERNAL_ERROR');
});
