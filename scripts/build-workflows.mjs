import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=new URL('../',import.meta.url);
const stripExports=text=>text.replace(/^export /gm,'');
function id(text){const h=createHash('sha256').update(text).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
function node(name,type,version,parameters,x,y=0){return {id:id(name),name,type,typeVersion:version,position:[x,y],parameters};}
const manual=()=>node('Demarrage manuel','n8n-nodes-base.manualTrigger',1,{},0);
const code=(name,js,x)=>node(name,'n8n-nodes-base.code',2,{mode:'runOnceForAllItems',language:'javaScript',jsCode:js},x);
const note=content=>node('A lire avant execution','n8n-nodes-base.stickyNote',1,{content,width:640,height:230},0,-290);
function workflow(name,nodes,description){
  const operational=nodes.filter(n=>n.type!=='n8n-nodes-base.stickyNote');
  const connections={};
  for(let i=0;i<operational.length-1;i++)connections[operational[i].name]={main:[[{node:operational[i+1].name,type:'main',index:0}]]};
  return {name,nodes:[note(description),...nodes],connections,active:false,pinData:{},settings:{executionOrder:'v1',timezone:'Europe/Paris'},tags:[]};
}
export const CONFIG_CODE=`// Modifier uniquement ces parametres NON SECRETS.
const worker_url = 'https://YOUR-FLIP-RADAR-WORKER';
const chat_id = 'YOUR_TELEGRAM_CHAT_ID';
const mission_id = 'YOUR_MISSION_UUID';
const listing_id = 'YOUR_LISTING_UUID';
if(worker_url.includes('YOUR-'))throw new Error('CONFIGURER_URL_WORKER_AVANT_EXECUTION');
// URL is not a global in all n8n runners. Only accept an HTTPS DNS origin here.
if(!/^https:\\/\\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,63}(?::443)?\\/?$/i.test(worker_url))throw new Error('URL_WORKER_HTTPS_ORIGIN_REQUIRED');
return [{json:{worker_url:worker_url.replace(/\\/$/,''),chat_id,mission_id,listing_id}}];`;
function http(name,path,{method='POST',body='{}',x=480,urlExpression}={}){
  return {...node(name,'n8n-nodes-base.httpRequest',4.2,{
    method,url:urlExpression||`={{ $('Configuration').first().json.worker_url + '${path}' }}`,
    authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',
    ...(method==='POST'?{sendBody:true,contentType:'json',specifyBody:'json',jsonBody:body}:{}),
    options:{timeout:30000,redirect:{redirect:{followRedirects:false}},response:{response:{responseFormat:'json'}}}},x),
    retryOnFail:false,onError:'stopWorkflow',notes:'Choisir le credential Header Auth FLIP_RADAR_WORKER. Ne pas mettre de secret dans le JSON.'};
}
export const ALERT_GATE_CODE=`const response=$input.first().json;
if(response.status==='idle'||response.status==='disabled')return [];
if(response.status!=='claimed'||!response.alert?.id||!response.alert?.claim_token||typeof response.alert?.text!=='string')throw new Error('INVALID_ALERT_CLAIM');
const config=$('Configuration').first().json;
if(!/^-?[0-9]+$/.test(config.chat_id))throw new Error('CONFIGURER_CHAT_TELEGRAM');
const text=response.alert.text;
if(!text.startsWith('FLIP RADAR — GO\\n')||text.includes('[SIMULATION]'))throw new Error('SIMULATION_OR_NON_GO_BLOCKED');
// The Telegram node uses HTML parsing. Escape EVERY character with HTML semantics.
const escaped=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
return [{json:{...response.alert,chat_id:config.chat_id,escaped_text:escaped}}];`;

export const REFERENCE_PLAN_CODE=`const categories=$('Lire categories historiques').first().json;
const products=$('Lire produits identifies').first().json;
const status=$('Verifier capacite Hunter').first().json;
const config=$('Configuration').first().json;
if(categories.historical_only!==true||products.historical_only!==true
  ||categories.eligible_as_current_market_proof!==false||products.eligible_as_current_market_proof!==false)throw new Error('REFERENCE_SCOPE_INVALID');
const prohibited=[/arme|munition|explosif/i,/alcool|vin|spiritueux/i,/tabac|cigarette/i,
  /medicament|médicament|stupéfiant|drogue/i,/animal vivant/i,/immobilier|terrain|herbage/i];
const score=g=>{
  const n=Math.max(0,Number(g.historical_sales_count)||0),org=Math.max(0,Number(g.distinct_organizers)||0);
  const p=g.historical_price_eur||{},spread=Number(p.p25)>0?Number(p.p75)/Number(p.p25):Infinity;
  const volume=Math.min(55,Math.round(14*Math.log2(1+n)));
  const breadth=Math.min(25,org*2);
  const consistency=spread<=2?20:spread<=4?12:spread<=8?6:0;
  return Math.min(100,volume+breadth+consistency);
};
const channels=category=>{
  if(/vêtement|chaussure|accessoire|bijou|bagagerie|maroquinerie|beauté/i.test(category))return ['vinted','leboncoin','own_site'];
  if(/véhicule|utilitaire|roue|voiturette|poids lourd|remorque|tracteur|bateau|quad/i.test(category))return ['leboncoin','own_site'];
  return ['leboncoin','vinted','own_site'];
};
const candidates=(categories.groups||[]).filter(g=>!prohibited.some(rule=>rule.test(g.category||'')))
  .map(g=>({...g,historical_research_score:score(g)}))
  .sort((a,b)=>b.historical_research_score-a.historical_research_score||b.historical_sales_count-a.historical_sales_count);
const chosen=candidates.slice(0,Math.min(12,config.max_categories));
const productGroups=products.groups||[];
const mission_drafts=chosen.map((family,index)=>{
  const examples=productGroups.filter(p=>(p.category||'').toLocaleLowerCase('fr')===(family.category||'').toLocaleLowerCase('fr'))
    .slice(0,3).map(p=>[p.brand,p.model].filter(Boolean).join(' '));
  const channelHints=channels(family.category||'');
  const objective=[
    'Rechercher des annonces ACTIVES en Europe pour la famille '+family.category+'.',
    examples.length?'Exemples historiques de requetes a tester : '+examples.join(', ')+'.':'Identifier les marques, modeles et sous-types visibles avant toute estimation.',
    'Verifier la reference exacte, etat, disponibilite, cout achat complet, transport, frais et risque de contrefacon.',
    'Mesurer la demande ACTUELLE uniquement avec des ventes recentes et verifiables, puis comparer les canaux '+channelHints.join(', ')+'.',
    'Les '+family.historical_sales_count+' observations DNID 2024 et leurs prix de lots sont seulement une graine de recherche : ne jamais les utiliser comme preuve de demande, prix actuel ou marge.',
    'Ne jamais acheter, contacter un vendeur, se connecter, publier ou contourner un blocage.'
  ].join(' ');
  return {family_rank:index+1,family:{category:family.category,historical_research_score:family.historical_research_score,
      historical_sales_count:family.historical_sales_count,historical_price_eur:family.historical_price_eur,
      example_products:examples,resale_channels_to_verify:channelHints},
    mission:{objective,countries:['FR','DE','BE','ES','IT','NL','PT','AT','PL','SE','DK','FI','IE','CZ','CH','GB','NO'],
      languages:['fr','en','de','es','it','nl','pt','pl'],source_ids:[]}};
});
const blockers=[];
if(config.transmit_to_hunter!==true)blockers.push('TRANSMISSION_DISABLED_IN_CONFIGURATION');
if(status.live_enabled!==true)blockers.push('LIVE_DISABLED');
if(status.model_configured!==true)blockers.push('MODEL_NOT_CONFIGURED');
if(!(Number(status.approved_source_count)>0))blockers.push('NO_APPROVED_ACTIVE_SOURCE');
const transmission_allowed=blockers.length===0&&status.hunter_ready===true;
return [{json:{project:'FLIP RADAR',workflow_version:'0.4.0',status:transmission_allowed?'READY_TO_QUEUE':'PLAN_ONLY',
  historical_only:true,eligible_as_current_market_proof:false,method:'deterministic_historical_research_priority_not_profit_or_demand',
  categories_considered:(categories.groups||[]).length,regulated_categories_excluded:true,
  mission_drafts,transmission_allowed,transmission_blockers:blockers,max_missions:config.max_missions,
  warning:'Plan exploratoire fonde sur des adjudications 2024. Chaque mission doit reconstruire demande, prix et marge avec des preuves actuelles.'}}];`;

export const REFERENCE_EMIT_CODE=`const plan=$input.first().json;
if(plan.transmission_allowed!==true)throw new Error('TRANSMISSION_NOT_ALLOWED');
const drafts=plan.mission_drafts.slice(0,plan.max_missions);
if(!drafts.length)throw new Error('NO_MISSION_DRAFT');
return drafts.map((draft,index)=>({json:{request_key:'n8n-family-'+$execution.id+'-'+index,mission:draft.mission}}));`;

export async function buildWorkflows(){
  const core=stripExports(await readFile(new URL('src/core.mjs',root),'utf8'));
  const fixtures=stripExports((await readFile(new URL('test/fixtures.mjs',root),'utf8')).split('export function mission')[0]);
  const tests=stripExports((await readFile(new URL('src/self-test.mjs',root),'utf8')).replace(/^import .*;\n/gm,''));
  const offline=workflow('FLIP RADAR 00 - SELF TEST HORS LIGNE',[
    manual(),code('Verifier les 19 cas',core+'\n'+fixtures+'\n'+tests+'\nreturn [{json:runOfflineSelfTest()}];',320),
  ],'## Commencer ici\nExecute workflow : resultat attendu all_ok = true.\n19 tests deterministes, donnees fictives uniquement.\nAucun credential, aucune API, aucun Telegram, aucun achat.\nCe test ne prouve pas la connexion a un site reel.');
  const createMission=workflow('FLIP RADAR 10 - CREER MISSION',[
    manual(),code('Configuration',CONFIG_CODE,240),
    code('Definir la mission',`return [{json:{request_key:'n8n-mission-'+$execution.id,mission:{objective:'Chercher des annonces europeennes sous-cotees, reference identifiable, demande a verifier. Explorer plusieurs familles de produits et reformuler les recherches selon les resultats.',countries:['FR','DE','BE','ES','IT','NL','PT','AT','PL','SE','DK','FI','IE','CZ','CH','GB','NO'],languages:['fr','en','de','es','it','nl'],source_ids:[]}}}];`,480),
    http('Creer la mission','/v1/missions',{body:'={{ JSON.stringify($json) }}',x:720}),
  ],'## Creation seulement\nConfigurer URL worker + credential Header Auth.\nLes pays sont une intention, pas une promesse de couverture.\nCette execution met une mission en attente ; elle ne lance aucun navigateur.\nUn nouvel Execute workflow cree une nouvelle mission. Les retries de la meme execution sont idempotents.');
  const hunt=workflow('FLIP RADAR 20 - EXECUTER UNE MISSION',[
    manual(),code('Configuration',CONFIG_CODE,240),http('Lancer le Web Hunter','/v1/runs/next'),
  ],'## Recherche reelle, a brancher\nNecessite worker, base, modele et au moins une source approuvee.\nFLIP_RADAR_LIVE_ENABLED=true est un opt-in separe.\nReponse started + mission_id : travail en cours, pas preuve de fin.\nAucun achat, message vendeur ou contournement de blocage.');
  const status=workflow('FLIP RADAR 21 - LIRE ETAT MISSION',[
    manual(),code('Configuration',CONFIG_CODE,240),
    code('Verifier identifiant',`const c=$input.first().json;if(!/^[0-9a-f-]{36}$/i.test(c.mission_id))throw new Error('CONFIGURER_MISSION_UUID');return [{json:c}];`,480),
    http('Lire etat','',{method:'GET',x:720,urlExpression:"={{ $('Configuration').first().json.worker_url + '/v1/missions/' + $json.mission_id }}"}),
  ],'## Suivi manuel\nReporter le mission_id retourne par le workflow 20 dans Configuration.\nEtats : queued, running, completed, failed.\nAucune boucle de polling ni activation automatique.');
  const listings=workflow('FLIP RADAR 22 - LIRE LES CANDIDATS',[
    manual(),code('Configuration',CONFIG_CODE,240),http('Lire annonces','/v1/listings',{method:'GET'}),
  ],'## Candidats a verifier\nLes 50 dernieres annonces observees, non des achats conseilles.\nLes frais, ventes confirmees et la demande ne sont pas inventes par le navigateur.\nUtiliser ensuite 25 ou POST /v1/reviews pour des preuves verifiees.');
  const referenceImport=workflow('FLIP RADAR 23 - IMPORTER REFERENCES DNID',[
    manual(),
    code('Configuration',`const worker_url='https://flip-radar-production-1c7c.up.railway.app';
if(!/^https:\\/\\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,63}(?::443)?\\/?$/i.test(worker_url))throw new Error('URL_WORKER_HTTPS_ORIGIN_REQUIRED');
return [{json:{worker_url:worker_url.replace(/\\\/$/,'')}}];`,240),
    code('Demander import officiel',`return [{json:{request_key:'n8n-dnid-reference-'+$execution.id}}];`,480),
    {...http('Demarrer import historique','/v1/reference-sales/import',{body:'={{ JSON.stringify($json) }}',x:720}),notes:'Credential Header Auth FLIP_RADAR_REVIEW obligatoire. Import manuel de la ressource officielle DNID uniquement.'},
    node('Attendre 30 secondes','n8n-nodes-base.wait',1.1,{resume:'timeInterval',amount:30,unit:'seconds'},960),
    {...http('Lire etat import','',{method:'GET',x:1200,urlExpression:"={{ $('Configuration').first().json.worker_url + '/v1/reference-sales/imports/' + $('Demarrer import historique').first().json.id }}"}),notes:'Credential Header Auth FLIP_RADAR_REVIEW. Si status=running, attendre puis relire le meme import_id ; ne pas relancer un nouvel import.'},
    code('Expliquer resultat',`const x=$input.first().json;
if(!['queued','running','completed','failed'].includes(x.status))throw new Error('IMPORT_STATUS_INVALID');
return [{json:{...x,historical_only:true,eligible_as_current_market_proof:false,warning:'Ventes DNID 2024 : references historiques seulement. Elles ne prouvent ni la demande actuelle ni le prix actuel de revente.'}}];`,1440),
  ],'## Import officiel, manuel et historique\nExecute seulement apres la migration SQL 002 et avec FLIP_RADAR_REVIEW.\nTelecharge une URL data.gouv.fr exacte et autorisee, puis stocke les adjudications 2024.\nCes lignes servent de references exploratoires : jamais de preuve de demande ou de prix actuel.\nAucun scraping, marketplace, achat, vendeur, Telegram ou activation LIVE.');
  const plannerNodes=[
    manual(),
    code('Configuration',`const worker_url='https://flip-radar-production-1c7c.up.railway.app';
const transmit_to_hunter=false;
const max_categories=12;
const max_missions=5;
if(!/^https:\\/\\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,63}(?::443)?\\/?$/i.test(worker_url))throw new Error('URL_WORKER_HTTPS_ORIGIN_REQUIRED');
if(typeof transmit_to_hunter!=='boolean'||!Number.isInteger(max_categories)||max_categories<1||max_categories>30
  ||!Number.isInteger(max_missions)||max_missions<1||max_missions>10)throw new Error('PLAN_CONFIG_INVALID');
return [{json:{worker_url:worker_url.replace(/\\\/$/,''),transmit_to_hunter,max_categories,max_missions}}];`,240),
    http('Verifier capacite Hunter','/v1/status',{method:'GET',x:480}),
    http('Lire categories historiques','',{method:'GET',x:720,urlExpression:"={{ $('Configuration').first().json.worker_url + '/v1/reference-sales/families?level=category&min_sales=20&limit=60' }}"}),
    http('Lire produits identifies','',{method:'GET',x:960,urlExpression:"={{ $('Configuration').first().json.worker_url + '/v1/reference-sales/families?level=product&min_sales=3&limit=100' }}"}),
    code('Construire plan exploratoire',REFERENCE_PLAN_CODE,1200),
    node('Transmission autorisee','n8n-nodes-base.if',2.2,{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},
      conditions:[{id:id('condition-transmission-reference'),leftValue:'={{ $json.transmission_allowed }}',rightValue:'',operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}},1440),
    code('Emettre missions bornees',REFERENCE_EMIT_CODE,1680,-100),
    http('Creer missions Hunter','/v1/missions',{body:'={{ JSON.stringify($json) }}',x:1920}),
    code('Resumer missions creees',`const rows=$input.all().map(item=>item.json);
if(rows.some(row=>!row.id))throw new Error('MISSION_CREATE_RESPONSE_INVALID');
return [{json:{project:'FLIP RADAR',status:'MISSIONS_QUEUED_NOT_RUN',missions_created:rows.length,
  mission_ids:rows.map(row=>row.id),browser_started:false,purchases_executed:0,
  message:'Missions en attente. Le navigateur ne demarre que via le workflow 20 ou le master, avec les garde-fous LIVE.'}}];`,2160,-100),
    code('Plan seulement - garde fou',`const plan=$input.first().json;
return [{json:{...plan,status:'PLAN_ONLY_NOT_TRANSMITTED',missions_created:0,browser_started:false,purchases_executed:0,
  message:'Plan cree sans lancer le Hunter. Garder transmit_to_hunter=false tant que LIVE et une source autorisee ne sont pas valides.'}}];`,1680,190),
  ];
  const referencePlanner={name:'FLIP RADAR 24 - PLANIFIER FAMILLES RENTABLES',nodes:[note('## Planificateur historique vers Web Hunter\nClasse des familles DNID pour orienter la prospection, sans les appeler rentables.\nPar defaut transmit_to_hunter=false : aucune mission envoyee, aucun navigateur lance.\nLe passage a true reste bloque si LIVE, modele ou source autorisee manque.\nAucun achat, message vendeur, publication ou contournement.'),...plannerNodes],connections:{
    'Demarrage manuel':{main:[[{node:'Configuration',type:'main',index:0}]]},
    'Configuration':{main:[[{node:'Verifier capacite Hunter',type:'main',index:0}]]},
    'Verifier capacite Hunter':{main:[[{node:'Lire categories historiques',type:'main',index:0}]]},
    'Lire categories historiques':{main:[[{node:'Lire produits identifies',type:'main',index:0}]]},
    'Lire produits identifies':{main:[[{node:'Construire plan exploratoire',type:'main',index:0}]]},
    'Construire plan exploratoire':{main:[[{node:'Transmission autorisee',type:'main',index:0}]]},
    'Transmission autorisee':{main:[[{node:'Emettre missions bornees',type:'main',index:0}],[{node:'Plan seulement - garde fou',type:'main',index:0}]]},
    'Emettre missions bornees':{main:[[{node:'Creer missions Hunter',type:'main',index:0}]]},
    'Creer missions Hunter':{main:[[{node:'Resumer missions creees',type:'main',index:0}]]},
  },active:false,pinData:{},settings:{executionOrder:'v1',timezone:'Europe/Paris'},tags:[]};
  const review=workflow('FLIP RADAR 25 - REVUE HUMAINE',[
    manual(),code('Configuration',CONFIG_CODE,240),
    code('Saisir les preuves',`// A completer avec des preuves REELLES. Jamais avec les donnees du SELF TEST.
const review_ready=false;
const c=$('Configuration').first().json;
if(!review_ready)throw new Error('PREUVES_REELLES_A_RENSEIGNER');
if(!/^[0-9a-f-]{36}$/i.test(c.listing_id))throw new Error('CONFIGURER_LISTING_UUID');
// Voir config/review.template.json et docs/DATA_CONTRACT.md dans le pack.
const evidence={listing_updates:{},quotes:[],risk:null,fx:{}};
if(!evidence.quotes.length||evidence.risk?.reviewed_by!=='human')throw new Error('PREUVES_INCOMPLETES');
return [{json:{request_key:'n8n-review-'+$execution.id,listing_id:c.listing_id,...evidence}}];`,480),
    {...http('Enregistrer revue','/v1/reviews',{body:'={{ JSON.stringify($json) }}',x:720}),notes:'Credential Header Auth FLIP_RADAR_REVIEW obligatoire, distinct du WORKER. Les autres workflows ne doivent pas y avoir acces.'},
  ],'## Validation privee\nLe credential REVIEW est reserve a toi, pas au LLM.\nRenseigner frais, ventes confirmees, demande et risques avec leurs preuves.\nExemple de structure dans le pack. review_ready reste false par defaut.\nGO signifie candidat documente a examiner ; aucun achat execute.');
  const sourceCatalog=workflow('FLIP RADAR 26 - ENREGISTRER CATALOGUE EUROPE',[
    manual(),
    code('Configuration',`const worker_url='https://flip-radar-production-1c7c.up.railway.app';
const confirm_pending_only=true;
if(!/^https:\\/\\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,63}(?::443)?\\/?$/i.test(worker_url))throw new Error('URL_WORKER_HTTPS_ORIGIN_REQUIRED');
if(confirm_pending_only!==true)throw new Error('CONFIRMATION_REQUIRED');
return [{json:{worker_url:worker_url.replace(/\\\/$/,''),confirm_pending_only}}];`,240),
    {...http('Enregistrer sources en attente','/v1/sources/catalog/import',{body:'={{ JSON.stringify({confirm_pending_only:$json.confirm_pending_only}) }}',x:480}),notes:'Credential Header Auth FLIP_RADAR_REVIEW obligatoire. Ce noeud enregistre le catalogue fourni avec le worker, mais n active aucune source.'},
    {...http('Lire matrice sources','/v1/sources',{method:'GET',x:720}),notes:'Credential FLIP_RADAR_REVIEW ou FLIP_RADAR_WORKER. La reponse ne contient aucune valeur de secret.'},
    code('Expliquer prochaine etape',`const x=$input.first().json;
if(!Number.isInteger(x.registered)||!Array.isArray(x.sources))throw new Error('SOURCE_CATALOG_RESPONSE_INVALID');
return [{json:{...x,status:'CATALOG_READY_SOURCES_STILL_DISABLED',browser_started:false,purchases_executed:0,
  next_step:'Configurer et tester un adaptateur officiel prioritaire, puis approuver une seule source avant le premier LIVE.',
  warning:'Le nombre de sources augmente la couverture, pas automatiquement le benefice. Deduplication, frais, transport, demande et risque restent obligatoires.'}}];`,960),
  ],'## Catalogue europeen large, sans activation\nEnregistre des API officielles et des sites a examiner, tous desactives.\nLe credential REVIEW est obligatoire pour l import.\nAucune cle, navigation, annonce, mission, alerte ou achat pendant ce workflow.\nUne source ne pourra devenir active qu apres validation de son acces et de son adaptateur.');
  const telegram=workflow('FLIP RADAR 30 - ENVOYER UNE ALERTE',[
    manual(),code('Configuration',CONFIG_CODE,240),
    code('Verifier destination',`const c=$input.first().json;if(!/^-?[0-9]+$/.test(c.chat_id))throw new Error('CONFIGURER_CHAT_TELEGRAM');return [{json:c}];`,480),
    http('Reserver une alerte','/v1/alerts/claim',{x:720}),
    code('Garder seulement une alerte reelle',ALERT_GATE_CODE,960),
    {...node('Telegram','n8n-nodes-base.telegram',1.2,{resource:'message',operation:'sendMessage',chatId:'={{ $json.chat_id }}',text:'={{ $json.escaped_text }}',replyMarkup:'none',additionalFields:{parse_mode:'HTML',appendAttribution:false,disable_web_page_preview:true}},1200),retryOnFail:false,onError:'stopWorkflow',notes:'Choisir ton credential Telegram. Pas de Retry On Fail : une livraison incertaine demande une verification manuelle.'},
    code('Preparer confirmation',`const response=$input.first().json;const message_id=response.message_id??response.result?.message_id;if(!Number.isInteger(message_id)||message_id<=0)throw new Error('TELEGRAM_MESSAGE_ID_REQUIRED');const claim=$('Garder seulement une alerte reelle').first().json;return [{json:{id:claim.id,claim_token:claim.claim_token,message_id}}];`,1440),
    http('Confirmer la livraison','/v1/alerts/ack',{body:'={{ JSON.stringify($json) }}',x:1680}),
  ],'## Envoi reel, desactive par defaut\nConfigurer chat_id + credentials WORKER et Telegram.\nFLIP_RADAR_ALERTS_ENABLED=true requis cote worker. Une alerte maximum par execution.\nEn cas de doute apres envoi : verifier Telegram, ne pas relancer le noeud Telegram seul.\nAucun renvoi automatique des livraisons incertaines.');
  return [
    ['FLIP_RADAR_00_SELF_TEST.json',offline],['FLIP_RADAR_10_CREATE_MISSION.json',createMission],
    ['FLIP_RADAR_20_HUNT_NEXT.json',hunt],['FLIP_RADAR_21_MISSION_STATUS.json',status],
    ['FLIP_RADAR_22_READ_CANDIDATES.json',listings],['FLIP_RADAR_23_IMPORT_DNID_REFERENCE.json',referenceImport],
    ['FLIP_RADAR_24_PLAN_REFERENCE_FAMILIES.json',referencePlanner],
    ['FLIP_RADAR_25_REVIEW.json',review],
    ['FLIP_RADAR_26_REGISTER_EUROPE_SOURCES.json',sourceCatalog],
    ['FLIP_RADAR_30_DISPATCH_ALERT.json',telegram],
  ];
}
export async function writeWorkflows(){
  const dir=new URL('workflows/',root);await mkdir(dir,{recursive:true});
  for(const [name,workflow] of await buildWorkflows())await writeFile(new URL(name,dir),JSON.stringify(workflow,null,2)+'\n');
  console.log('10 workflows generes, tous inactifs : '+fileURLToPath(dir));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await writeWorkflows();
