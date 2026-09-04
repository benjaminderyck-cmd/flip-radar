import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {buildWorkflows,CONFIG_CODE,ALERT_GATE_CODE,REFERENCE_PLAN_CODE,REFERENCE_EMIT_CODE} from '../scripts/build-workflows.mjs';
import {runOfflineSelfTest} from '../src/self-test.mjs';

const workflows=await buildWorkflows();
function execute(code,globals={}){
  // No fetch, process, require, credentials or filesystem in this test context.
  const context=vm.createContext({...globals});
  return vm.runInContext('(function(){\n'+code+'\n})()',context,{timeout:1500});
}
test('offline self-test runs the actual core with no external tools',()=>{
  const wf=workflows[0][1],n=wf.nodes.find(n=>n.type==='n8n-nodes-base.code');
  const result=execute(n.parameters.jsCode)[0].json;
  assert.equal(result.all_ok,true);assert.equal(result.tests_total,19);
  assert.equal(result.external_calls,0);assert.equal(result.telegram_sent,0);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),runOfflineSelfTest());
  assert.equal(wf.nodes.some(n=>n.type.includes('httpRequest')||n.type.includes('telegram')),false);
});
test('every workflow is inactive with a manual trigger and valid references',()=>{
  for(const [,wf] of workflows){
    assert.equal(wf.active,false);assert.equal(wf.nodes.filter(n=>n.type==='n8n-nodes-base.manualTrigger').length,1);
    const names=new Set(wf.nodes.map(n=>n.name));assert.equal(names.size,wf.nodes.length);
    for(const [from,outputs] of Object.entries(wf.connections)){
      assert.ok(names.has(from));for(const branch of outputs.main)for(const edge of branch)assert.ok(names.has(edge.node));
    }
    for(const n of wf.nodes){
      assert.equal(n.credentials,undefined);
      if(n.type==='n8n-nodes-base.code')new vm.Script('(function(){'+n.parameters.jsCode+'})');
      if(n.type==='n8n-nodes-base.httpRequest'){assert.equal(n.retryOnFail,false);assert.equal(n.parameters.genericAuthType,'httpHeaderAuth');}
    }
  }
});
test('default live workflow configuration fails before any request',()=>{
  assert.throws(()=>execute(CONFIG_CODE),/CONFIGURER_URL_WORKER/);
  assert.throws(()=>execute(CONFIG_CODE.replace('https://YOUR-FLIP-RADAR-WORKER','http://not-secure.example')),/HTTPS_ORIGIN/);
});
test('configured HTTPS worker origin works without URL or require globals',()=>{
  const r=execute(CONFIG_CODE.replace('https://YOUR-FLIP-RADAR-WORKER','https://flip-radar.example/'));
  assert.equal(r[0].json.worker_url,'https://flip-radar.example');
});
test('mission is free of budget ceiling and carries execution idempotency key',()=>{
  const wf=workflows.find(([name])=>name.includes('10_CREATE'))[1];
  const n=wf.nodes.find(n=>n.name==='Definir la mission');
  const result=execute(n.parameters.jsCode,{$execution:{id:'42'}})[0].json;
  assert.equal(result.request_key,'n8n-mission-42');assert.equal(result.mission.max_price,undefined);
  assert.ok(result.mission.countries.includes('FR'));assert.ok(result.mission.countries.includes('DE'));
});
test('official reference import is manual, historical-only and uses no embedded credential',()=>{
  const wf=workflows.find(([name])=>name.includes('23_IMPORT'))[1];
  assert.equal(wf.nodes.some(n=>n.type==='n8n-nodes-base.scheduleTrigger'),false);
  assert.equal(wf.nodes.some(n=>JSON.stringify(n).includes('FLIP_RADAR_LIVE_ENABLED=true')),false);
  assert.match(wf.nodes.find(n=>n.name==='Demarrer import historique').notes,/FLIP_RADAR_REVIEW/);
  assert.match(wf.nodes.find(n=>n.name==='Expliquer resultat').parameters.jsCode,/eligible_as_current_market_proof:false/);
});
function referencePlanGlobals({transmit=false,ready=false}={}){
  const nodes={
    'Configuration':{worker_url:'https://flip-radar.example',transmit_to_hunter:transmit,max_categories:12,max_missions:2},
    'Verifier capacite Hunter':{live_enabled:ready,model_configured:ready,approved_source_count:ready?1:0,hunter_ready:ready},
    'Lire categories historiques':{historical_only:true,eligible_as_current_market_proof:false,groups:[
      {category:'Informatique',historical_sales_count:1000,distinct_organizers:10,historical_price_eur:{p25:200,median:500,p75:800}},
      {category:'Vins et alcools',historical_sales_count:900,distinct_organizers:10,historical_price_eur:{p25:100,median:200,p75:400}},
      {category:'Bijoux',historical_sales_count:600,distinct_organizers:5,historical_price_eur:{p25:100,median:300,p75:500}},
    ]},
    'Lire produits identifies':{historical_only:true,eligible_as_current_market_proof:false,groups:[
      {category:'Informatique',brand:'APPLE',model:'MACBOOK PRO',historical_sales_count:8},
    ]},
  };
  return {$:name=>({first:()=>({json:nodes[name]})})};
}
test('family planner produces diverse drafts but defaults to plan-only',()=>{
  const result=execute(REFERENCE_PLAN_CODE,referencePlanGlobals())[0].json;
  assert.equal(result.status,'PLAN_ONLY');assert.equal(result.transmission_allowed,false);
  assert.equal(result.historical_only,true);assert.equal(result.eligible_as_current_market_proof,false);
  assert.equal(result.mission_drafts.length,2);
  assert.equal(result.mission_drafts.some(x=>x.family.category==='Vins et alcools'),false);
  assert.match(result.mission_drafts[0].mission.objective,/ne jamais les utiliser comme preuve/i);
  assert.equal(result.mission_drafts[0].mission.max_price,undefined);
});
test('family missions can be emitted only when operator and worker gates are ready',()=>{
  const blocked=execute(REFERENCE_PLAN_CODE,referencePlanGlobals({transmit:true,ready:false}))[0].json;
  assert.equal(blocked.transmission_allowed,false);assert.ok(blocked.transmission_blockers.includes('LIVE_DISABLED'));
  const ready=execute(REFERENCE_PLAN_CODE,referencePlanGlobals({transmit:true,ready:true}))[0].json;
  assert.equal(ready.transmission_allowed,true);assert.equal(ready.status,'READY_TO_QUEUE');
  const emitted=execute(REFERENCE_EMIT_CODE,{$input:{first:()=>({json:ready})},$execution:{id:'fixture'}});
  assert.equal(emitted.length,2);assert.equal(emitted[0].json.request_key,'n8n-family-fixture-0');
  assert.throws(()=>execute(REFERENCE_EMIT_CODE,{$input:{first:()=>({json:blocked})},$execution:{id:'fixture'}}),/TRANSMISSION_NOT_ALLOWED/);
});
test('family planning workflow has a false branch that cannot create missions',()=>{
  const wf=workflows.find(([name])=>name.includes('24_PLAN'))[1];
  assert.equal(wf.active,false);assert.equal(wf.nodes.some(n=>n.type==='n8n-nodes-base.scheduleTrigger'),false);
  const branches=wf.connections['Transmission autorisee'].main;
  assert.equal(branches[0][0].node,'Emettre missions bornees');
  assert.equal(branches[1][0].node,'Plan seulement - garde fou');
  assert.match(wf.nodes.find(n=>n.name==='Configuration').parameters.jsCode,/transmit_to_hunter=false/);
});
test('Telegram gate blocks simulation and non-GO even if outbox is malformed',()=>{
  const globals=text=>({$input:{first:()=>({json:{status:'claimed',alert:{id:'one',claim_token:'two',text}}})},$:()=>({first:()=>({json:{chat_id:'123'}})})});
  assert.throws(()=>execute(ALERT_GATE_CODE,globals('[SIMULATION] FLIP RADAR — GO\nTest')),/SIMULATION_OR_NON_GO/);
  assert.throws(()=>execute(ALERT_GATE_CODE,globals('FLIP RADAR — REVUE\nTest')),/SIMULATION_OR_NON_GO/);
  const result=execute(ALERT_GATE_CODE,globals('FLIP RADAR — GO\n<script>& secret <b>'))[0].json;
  assert.equal(result.escaped_text,'FLIP RADAR — GO\n&lt;script&gt;&amp; secret &lt;b&gt;');
});
test('disabled or empty outbox ends execution before Telegram',()=>{
  for(const status of ['disabled','idle'])assert.equal(execute(ALERT_GATE_CODE,{$input:{first:()=>({json:{status}})}}).length,0);
});
test('generated JSON exactly matches generator output',async()=>{
  for(const [name,wf] of workflows){
    const written=JSON.parse(await readFile(new URL('../workflows/'+name,import.meta.url),'utf8'));
    assert.deepEqual(written,wf);
  }
});
