import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBundledSourceCatalog,summarizeSourceCatalog,validatePendingSourceCatalog} from '../src/source-catalog.mjs';

test('bundled Europe catalogue is broad, unique and disabled by construction',async()=>{
  const sources=await loadBundledSourceCatalog();
  assert.ok(sources.length>=20);assert.equal(new Set(sources.map(s=>s.id)).size,sources.length);
  assert.equal(sources.some(s=>s.enabled),false);assert.equal(sources.some(s=>s.status==='approved'),false);
  assert.ok(sources.some(s=>s.access_method==='official_api'));
  assert.ok(sources.some(s=>s.access_method==='browser_review_required'));
  const summary=summarizeSourceCatalog(sources);
  assert.equal(summary.registered,sources.length);assert.equal(summary.enabled,0);
  assert.ok(summary.countries.includes('FR'));assert.ok(summary.countries.includes('DE'));
});
test('catalogue cannot smuggle an enabled or duplicate source',()=>{
  const base={id:'one_source',label:'Fixture source',access_method:'official_api',enabled:false,status:'pending_adapter',
    policy_url:'https://market.example/terms',countries:['FR'],currencies:['EUR']};
  assert.throws(()=>validatePendingSourceCatalog([{...base,enabled:true}]),/PENDING_ONLY/);
  assert.throws(()=>validatePendingSourceCatalog([base,{...base}]),/ID_INVALID/);
  assert.throws(()=>validatePendingSourceCatalog([{...base,policy_url:'http://market.example/terms'}]),/URL_INVALID/);
  assert.throws(()=>validatePendingSourceCatalog([{...base,credential_env:['DATABASE_URL']}]),/CREDENTIAL_ENV/);
});
