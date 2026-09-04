import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildWorkflows} from './build-workflows.mjs';
import {runOfflineSelfTest} from '../src/self-test.mjs';
import {loadBundledSourceCatalog} from '../src/source-catalog.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
async function files(dir,prefix=''){
  const result=[];
  for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(['node_modules','.git','data','reports'].includes(entry.name)||entry.name==='.env'||entry.name.endsWith('.zip')||entry.name==='sources.reviewed.json')continue;
    const relative=prefix+entry.name;
    if(entry.isSymbolicLink())throw new Error('SYMLINK_NOT_PACKAGED');
    if(entry.isDirectory())result.push(...await files(dir+'/'+entry.name,relative+'/'));
    else result.push(relative);
  }
  return result;
}
const paths=await files(root),codeFiles=paths.filter(p=>p.endsWith('.mjs'));
for(const file of codeFiles)execFileSync(process.execPath,['--check',root+file],{stdio:'pipe',timeout:10000});
const workflows=await buildWorkflows();
for(const [name,expected] of workflows){
  const actual=JSON.parse(await readFile(root+'workflows/'+name,'utf8'));
  if(JSON.stringify(actual)!==JSON.stringify(expected)||actual.active!==false)throw new Error('WORKFLOW_GENERATION_MISMATCH');
}
const sources=JSON.parse(await readFile(root+'config/sources.example.json','utf8'));
if(sources.some(s=>s.enabled))throw new Error('EXAMPLE_SOURCE_MUST_BE_DISABLED');
const sourceCatalog=await loadBundledSourceCatalog();
if(sourceCatalog.some(s=>s.enabled||s.status==='approved'))throw new Error('BUNDLED_CATALOG_MUST_BE_PENDING');
const testFiles=paths.filter(p=>p.startsWith('test/')&&p.endsWith('.test.mjs'));
const tap=execFileSync(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',...testFiles],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
const n=field=>Number(tap.match(new RegExp('^# '+field+' ([0-9]+)$','m'))?.[1]??NaN);
if(n('fail')!==0||!n('pass')||n('cancelled')!==0)throw new Error('TEST_SUITE_FAILED');
const self=runOfflineSelfTest(),lock=JSON.parse(await readFile(root+'package-lock.json','utf8'));
const report={project:'FLIP RADAR',version:'0.4.0',checked_at:new Date().toISOString(),node:process.version,
  status:'passed_local_checks_upgrade_not_deployed',tests:{total:n('tests'),passed:n('pass'),failed:n('fail'),cancelled:n('cancelled'),skipped:n('skipped')},
  javascript_files_syntax_checked:codeFiles.length,n8n_workflows:workflows.length,offline_self_test_cases:self.tests_total,
  bundled_source_catalog:{total:sourceCatalog.length,enabled:0,official_api:sourceCatalog.filter(s=>s.access_method==='official_api').length,
    browser_review_required:sourceCatalog.filter(s=>s.access_method==='browser_review_required').length},
  external_marketplace_calls:0,external_model_calls:0,telegram_sent:0,purchases_executed:0,
  postgres_engine:'PGlite '+lock.packages['node_modules/@electric-sql/pglite'].version+' in memory; both migrations replayed',
  configured_dependencies:{pg:lock.packages['node_modules/pg'].version,playwright:lock.packages['node_modules/playwright'].version},
  not_verified:['Version 0.4 deployment','Workflow 26 import in user n8n instance','Source catalogue registration in production','Marketplace API credentials','Live marketplace browsing','Production Chromium launch','Live model quality/API','Docker image build','Telegram delivery','Multi-worker load']};
await mkdir(root+'reports',{recursive:true});
await writeFile(root+'reports/TEST_RESULTS.tap',tap);
await writeFile(root+'reports/SELF_TEST_RESULT.json',JSON.stringify(self,null,2)+'\n');
await writeFile(root+'reports/VALIDATION.json',JSON.stringify(report,null,2)+'\n');
await writeFile(root+'reports/VALIDATION_FR.md',`# FLIP RADAR 0.4 — vérification locale\n\nDate UTC : ${report.checked_at}\n\n${report.tests.passed}/${report.tests.total} tests réussis, ${report.tests.failed} échec. ${report.javascript_files_syntax_checked} fichiers JavaScript vérifiés. Dix workflows n8n générés et inactifs. Le SELF TEST couvre ${self.tests_total} cas fictifs.\n\nLe catalogue contient ${sourceCatalog.length} sources européennes préparées : ${report.bundled_source_catalog.official_api} interfaces officielles et ${report.bundled_source_catalog.browser_review_required} sources navigateur à examiner. Elles sont toutes désactivées.\n\nPostgreSQL : ${report.postgres_engine}. Node : ${report.node}. Dépendances : pg ${report.configured_dependencies.pg}, Playwright ${report.configured_dependencies.playwright}.\n\nAucun appel à une marketplace ou un modèle distant, aucun Telegram ni achat exécuté. Les serveurs HTTP utilisés par les tests sont locaux.\n\nLes migrations et les transactions ont été réellement exécutées dans PGlite ; le navigateur et le modèle sont simulés. L'import du catalogue préserve une source déjà approuvée et ne peut pas activer une source. Voir TEST_RESULTS.tap et SELF_TEST_RESULT.json.\n\nRestent à vérifier : déploiement 0.4, import du workflow 26 dans n8n, enregistrement du catalogue en production, identifiants des API officielles et premier test LIVE contrôlé.\n`);
const manifest=[];
for(const path of paths){const buffer=await readFile(root+path);manifest.push({path,bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')});}
await writeFile(root+'reports/SOURCE_MANIFEST.json',JSON.stringify({version:'0.4.0',files:manifest},null,2)+'\n');
console.log(JSON.stringify(report,null,2));
