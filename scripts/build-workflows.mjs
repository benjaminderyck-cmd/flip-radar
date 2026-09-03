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
    ['FLIP_RADAR_22_READ_CANDIDATES.json',listings],['FLIP_RADAR_25_REVIEW.json',review],
    ['FLIP_RADAR_30_DISPATCH_ALERT.json',telegram],
  ];
}
export async function writeWorkflows(){
  const dir=new URL('workflows/',root);await mkdir(dir,{recursive:true});
  for(const [name,workflow] of await buildWorkflows())await writeFile(new URL(name,dir),JSON.stringify(workflow,null,2)+'\n');
  console.log('7 workflows generes, tous inactifs : '+fileURLToPath(dir));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await writeWorkflows();
