import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createPool} from './db.mjs';
import {PgStore} from './store.mjs';
import {runHunter} from './hunter.mjs';
import {assertSource} from './policy.mjs';
import {GeminiPlanner} from './gemini.mjs';
import {PlaywrightBrowser} from './playwright-browser.mjs';
import {importDnidReferenceSales} from './reference-data.mjs';
import {loadBundledSourceCatalog,summarizeSourceCatalog} from './source-catalog.mjs';

export function loadConfig(env=process.env) {
  const workerToken=env.FLIP_RADAR_WORKER_TOKEN, reviewToken=env.FLIP_RADAR_REVIEW_TOKEN;
  if(!workerToken || workerToken.length<32 || !reviewToken || reviewToken.length<32 || workerToken===reviewToken) throw new Error('TWO_DISTINCT_API_TOKENS_REQUIRED');
  const positive=(name,fallback,max)=>{const n=Number(env[name]||fallback);if(!Number.isInteger(n)||n<=0||n>max)throw new Error('INVALID_RUN_LIMIT');return n;};
  return {workerToken,reviewToken,liveEnabled:env.FLIP_RADAR_LIVE_ENABLED==='true',alertsEnabled:env.FLIP_RADAR_ALERTS_ENABLED==='true',
    vision:env.FLIP_RADAR_VISION_ENABLED==='true',apiKey:env.FLIP_RADAR_GEMINI_API_KEY,model:env.FLIP_RADAR_GEMINI_MODEL,
    limits:{max_steps:positive('FLIP_RADAR_MAX_STEPS',18,30),max_pages:positive('FLIP_RADAR_MAX_PAGES',12,20),
      max_run_ms:positive('FLIP_RADAR_MAX_RUN_MS',180000,300000)},
    maxOutputTokens:positive('FLIP_RADAR_MAX_OUTPUT_TOKENS',1600,4096)};
}
function equal(a,b) {return timingSafeEqual(createHash('sha256').update(String(a)).digest(),createHash('sha256').update(String(b)).digest());}
function role(req,config) {
  const token=(req.headers.authorization||'').replace(/^Bearer /,'');
  if(equal(token,config.reviewToken))return 'reviewer';
  if(equal(token,config.workerToken))return 'worker';
  return null;
}
function send(res,status,data) {res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));}
export function publicError(error) {return /^[A-Z0-9_]{1,80}$/.test(error?.message||'')?error.message:'INTERNAL_ERROR';}
async function readJson(req) {
  if(!(req.headers['content-type']||'').startsWith('application/json'))throw new Error('JSON_REQUIRED');
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>512000)throw new Error('BODY_TOO_LARGE');chunks.push(chunk);}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('INVALID_JSON');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('JSON_OBJECT_REQUIRED');
  return data;
}
export function buildServer({store,config,browserFactory=()=>new PlaywrightBrowser({vision:config.vision}),
  modelFactory=()=>new GeminiPlanner({apiKey:config.apiKey,model:config.model,maxOutputTokens:config.maxOutputTokens}),
  referenceImporter=()=>importDnidReferenceSales({store}),sourceCatalogLoader=loadBundledSourceCatalog}) {
  const jobs=new Set(),controllers=new Set();let busy=false,referenceBusy=false;
  async function nextRun() {
    if(!config.liveEnabled)throw new Error('LIVE_DISABLED');
    if(busy)return {status:'busy'};
    busy=true;
    try{
      const sources=(await store.sources()).filter(s=>s.enabled===true);
      if(!sources.length)throw new Error('NO_APPROVED_SOURCE');
      sources.forEach(s=>assertSource(s));
      // Validate model config before leasing any mission.
      const model=modelFactory();
      const claim=await store.claimMission();
      if(!claim){busy=false;return {status:'idle'};}
      const controller=new AbortController();controllers.add(controller);
      const timer=setTimeout(()=>controller.abort(),config.limits.max_run_ms);
      const job=(async()=>{
        try{
          const result=await runHunter({mission:claim.payload,sources,browser:browserFactory(),model,limits:config.limits,
            mode:'live',signal:controller.signal});
          await store.finishMission(claim,result);
        }catch(error){await store.failMission(claim,publicError(error));}
        finally{clearTimeout(timer);controllers.delete(controller);busy=false;}
      })();
      jobs.add(job);job.then(()=>jobs.delete(job),()=>{jobs.delete(job);console.error('FLIP_RADAR_JOB_PERSISTENCE_ERROR');});
      return {status:'started',mission_id:claim.id};
    }catch(error){busy=false;throw error;}
  }
  async function startReferenceImport(importId) {
    if(referenceBusy)throw new Error('REFERENCE_IMPORT_BUSY');
    const claim=await store.startReferenceImport(importId);
    if(!claim)return {status:'already_started',import_id:importId};
    referenceBusy=true;
    const job=(async()=>{
      try{await store.finishReferenceImport(importId,await referenceImporter());}
      catch(error){await store.failReferenceImport(importId,publicError(error));}
      finally{referenceBusy=false;}
    })();
    jobs.add(job);job.then(()=>jobs.delete(job),()=>{jobs.delete(job);console.error('FLIP_RADAR_REFERENCE_IMPORT_PERSISTENCE_ERROR');});
    return {status:'started',import_id:importId};
  }
  const server=createServer(async(req,res)=>{
    try{
      const requestUrl=new URL(req.url,'http://localhost'),path=requestUrl.pathname;
      if(req.method==='GET'&&path==='/health')return send(res,200,{service:'flip-radar',version:'0.4.0',status:'up'});
      const who=role(req,config);
      if(!who)return send(res,401,{error:'UNAUTHORIZED'});
      if(req.method==='GET'&&path==='/v1/status'){
        await store.health();
        const sources=await store.sources(),approvedSourceCount=sources.reduce((count,source)=>{
          try{assertSource(source);return count+1;}catch{return count;}
        },0);
        const modelConfigured=Boolean(config.apiKey&&config.model);
        return send(res,200,{database:'ready',live_enabled:config.liveEnabled,alerts_enabled:config.alertsEnabled,
          model_configured:modelConfigured,approved_source_count:approvedSourceCount,
          registered_source_count:sources.length,pending_source_count:sources.length-approvedSourceCount,
          hunter_ready:config.liveEnabled&&modelConfigured&&approvedSourceCount>0,busy,reference_import_busy:referenceBusy});
      }
      if(req.method==='GET'&&path==='/v1/sources'){
        const sources=await store.sources();
        return send(res,200,{...summarizeSourceCatalog(sources),sources:sources.map(source=>({id:source.id,label:source.label,
          enabled:source.enabled===true,status:source.status,access_method:source.access_method||'browser_review_required',
          countries:Array.isArray(source.countries)?source.countries:[],priority:Number(source.priority)||0,
          credentials_required:Array.isArray(source.credential_env)&&source.credential_env.length>0}))});
      }
      if(req.method==='GET'&&path==='/v1/listings')return send(res,200,{listings:await store.listings()});
      if(req.method==='GET'&&path==='/v1/opportunities')return send(res,200,{opportunities:await store.opportunities()});
      if(req.method==='GET'&&path==='/v1/reference-sales'){
        const allowed=new Set(['q','brand','model','category','limit']);
        if([...requestUrl.searchParams.keys()].some(name=>!allowed.has(name)))throw new Error('REFERENCE_QUERY_INVALID');
        return send(res,200,await store.referenceSales(Object.fromEntries(requestUrl.searchParams)));
      }
      if(req.method==='GET'&&path==='/v1/reference-sales/families'){
        const allowed=new Set(['level','min_sales','limit']);
        if([...requestUrl.searchParams.keys()].some(name=>!allowed.has(name)))throw new Error('REFERENCE_QUERY_INVALID');
        return send(res,200,await store.referenceFamilies(Object.fromEntries(requestUrl.searchParams)));
      }
      if(req.method==='GET'&&path.startsWith('/v1/reference-sales/imports/')){
        const item=await store.referenceImport(path.split('/').at(-1));return send(res,item?200:404,item||{error:'NOT_FOUND'});
      }
      if(req.method==='GET'&&path.startsWith('/v1/missions/')){
        const mission=await store.mission(path.split('/').at(-1));return send(res,mission?200:404,mission||{error:'NOT_FOUND'});
      }
      if(req.method!=='POST')return send(res,404,{error:'NOT_FOUND'});
      const body=await readJson(req);
      if(path==='/v1/missions')return send(res,201,await store.createMission(body));
      if(path==='/v1/runs/next')return send(res,202,await nextRun());
      if(path==='/v1/reference-sales/import'){
        if(who!=='reviewer')return send(res,403,{error:'REVIEWER_REQUIRED'});
        const item=await store.createReferenceImport(body),start=item.status==='queued'?await startReferenceImport(item.id):{status:item.status,import_id:item.id};
        return send(res,202,{...item,run_status:start.status});
      }
      if(path==='/v1/sources/catalog/import'){
        if(who!=='reviewer')return send(res,403,{error:'REVIEWER_REQUIRED'});
        if(body.confirm_pending_only!==true)throw new Error('SOURCE_CATALOG_CONFIRMATION_REQUIRED');
        const sources=await sourceCatalogLoader(),result=await store.upsertPendingSources(sources);
        return send(res,200,{status:'CATALOG_REGISTERED_NOT_ENABLED',...result,...summarizeSourceCatalog(sources)});
      }
      if(path==='/v1/reviews'){
        if(who!=='reviewer')return send(res,403,{error:'REVIEWER_REQUIRED'});
        return send(res,200,await store.review(body,{alertsEnabled:config.alertsEnabled}));
      }
      if(path==='/v1/decisions'){
        if(who!=='reviewer')return send(res,403,{error:'REVIEWER_REQUIRED'});
        return send(res,200,await store.recordDecision({...body,notes:body.notes||''}));
      }
      if(path==='/v1/alerts/claim'){
        if(!config.alertsEnabled)return send(res,200,{status:'disabled'});
        const alert=await store.claimAlert();return send(res,200,alert?{status:'claimed',alert}:{status:'idle'});
      }
      if(path==='/v1/alerts/ack')return send(res,200,await store.ackAlert(body));
      return send(res,404,{error:'NOT_FOUND'});
    }catch(error){
      const code=publicError(error);
      const status=code==='BODY_TOO_LARGE'?413:/IDEMPOTENCY_CONFLICT|_BUSY$/.test(code)?409:
        /DISABLED|CONFIG_REQUIRED|NO_APPROVED|POLICY_UNREVIEWED/.test(code)?503:code==='INTERNAL_ERROR'?500:400;
      send(res,status,{error:code});
    }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  return {server,waitForJobs:()=>Promise.allSettled([...jobs]),
    stop:async()=>{controllers.forEach(c=>c.abort());await Promise.allSettled([...jobs]);await new Promise(r=>server.close(r));}};
}
export async function main(){
  const config=loadConfig(),pool=await createPool(),store=new PgStore(pool);await store.health();
  const app=buildServer({store,config});
  const port=Number(process.env.PORT||8080);
  app.server.listen(port,'0.0.0.0',()=>console.log(JSON.stringify({service:'flip-radar',port,live_enabled:config.liveEnabled,alerts_enabled:config.alertsEnabled})));
  let closing=false;
  for(const event of ['SIGTERM','SIGINT'])process.on(event,async()=>{if(closing)return;closing=true;await app.stop();await pool.end();});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
