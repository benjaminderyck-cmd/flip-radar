import {readFile} from 'node:fs/promises';

const METHODS=new Set(['official_api','authorized_feed','browser_review_required']);
const STATUSES=new Set(['pending_credentials','pending_adapter','pending_policy_review','blocked']);
const URL_FIELDS=['policy_url','documentation_url'];

function cleanString(value,{min=1,max=500,code='SOURCE_CATALOG_INVALID'}={}) {
  if(typeof value!=='string'||value.trim().length<min||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new Error(code);
  return value.trim();
}
function publicHttps(value) {
  let url;try{url=new URL(value);}catch{throw new Error('SOURCE_CATALOG_URL_INVALID');}
  if(url.protocol!=='https:'||url.username||url.password||url.port)throw new Error('SOURCE_CATALOG_URL_INVALID');
  return url.toString();
}
function list(value,pattern,code) {
  if(!Array.isArray(value)||!value.length||value.length>40||value.some(x=>typeof x!=='string'||!pattern.test(x)))throw new Error(code);
  return [...new Set(value)];
}
export function validatePendingSourceCatalog(value) {
  if(!Array.isArray(value)||!value.length||value.length>100)throw new Error('SOURCE_CATALOG_INVALID');
  const ids=new Set();
  return value.map(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('SOURCE_CATALOG_INVALID');
    const id=cleanString(raw.id,{max:64});
    if(!/^[a-z0-9_-]{2,64}$/.test(id)||ids.has(id))throw new Error('SOURCE_CATALOG_ID_INVALID');
    ids.add(id);
    if(raw.enabled!==false||!STATUSES.has(raw.status)||!METHODS.has(raw.access_method))throw new Error('SOURCE_CATALOG_PENDING_ONLY');
    const item={...raw,id,label:cleanString(raw.label,{max:160}),enabled:false,
      countries:list(raw.countries,/^[A-Z]{2}$/,'SOURCE_CATALOG_COUNTRIES_INVALID'),
      currencies:list(raw.currencies,/^[A-Z]{3}$/,'SOURCE_CATALOG_CURRENCIES_INVALID')};
    for(const field of URL_FIELDS)if(item[field]!==undefined)item[field]=publicHttps(item[field]);
    if(item.credential_env!==undefined)item.credential_env=list(item.credential_env,/^FLIP_RADAR_[A-Z0-9_]{2,80}$/,'SOURCE_CREDENTIAL_ENV_INVALID');
    if(item.notes!==undefined)item.notes=cleanString(item.notes,{max:700});
    return item;
  });
}
export function summarizeSourceCatalog(sources) {
  const byMethod={},byStatus={},countries=new Set();
  for(const source of sources){byMethod[source.access_method]=(byMethod[source.access_method]||0)+1;
    byStatus[source.status]=(byStatus[source.status]||0)+1;source.countries.forEach(c=>countries.add(c));}
  return {registered:sources.length,enabled:sources.filter(s=>s.enabled).length,by_method:byMethod,by_status:byStatus,
    countries:[...countries].sort(),live_search_started:false,purchases_executed:0,
    warning:'Catalogue de preparation uniquement. Une source reste inutilisable tant que ses conditions, son adaptateur et ses identifiants eventuels ne sont pas valides.'};
}
export async function loadBundledSourceCatalog() {
  return validatePendingSourceCatalog(JSON.parse(await readFile(new URL('../config/sources.europe.v1.json',import.meta.url),'utf8')));
}
