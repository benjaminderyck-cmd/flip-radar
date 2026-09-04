import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateAssessment,canonicalUrl,formatAlert,toEurCents,safeUrl} from '../src/core.mjs';
import {goodAssessment,NOW} from './fixtures.mjs';

test('baseline has positive conservative economics, simulation cannot notify',()=>{
  const r=evaluateAssessment(goodAssessment(),{now:NOW});
  assert.equal(r.would_verdict,'GO');assert.equal(r.verdict,'SIMULATION');assert.equal(r.notification_allowed,false);
  assert.equal(r.best.all_in_eur,110);assert.equal(r.best.conservative_gross_eur,214);assert.equal(r.best.estimated_contribution_eur,71.32);
});
test('portable URL canonicalization agrees with standard query semantics',()=>{
  const input='HTTPS://Market.Example:443/item/123/?z=last&a=hello%20world&a=second&utm_source=test#x';
  assert.equal(canonicalUrl(input),'https://market.example/item/123/?a=hello+world&a=second&z=last');
});
test('portable URL parser rejects credentials, ambiguous authority and dot paths',()=>{
  for(const u of ['https://user:password@market.example/item/1','https://bad..example/a','https://market.example:99999/a','https://market.example/a/../b','https://market.example/%2e%2e/item','https://market.example/a?x=%zz'])assert.equal(safeUrl(u),false,u);
});
test('resale destination must also be in European scope',()=>{
  const x=goodAssessment();x.quotes[0].country='US';
  x.quotes[0].market.market_country='US';x.quotes[0].comps.forEach(c=>c.market_country='US');
  assert.equal(evaluateAssessment(x,{now:NOW}).would_verdict,'REVUE');
});
test('live assessed opportunity can be eligible, purchase is never executed',()=>{
  const a=goodAssessment();a.listing.mode='live';const r=evaluateAssessment(a,{now:NOW});assert.equal(r.verdict,'GO');assert.equal(r.notification_allowed,true);
});
for(const [name,change,verdict] of [
  ['unknown inbound shipping',a=>a.listing.costs_eur.inbound_shipping=null,'REVUE'],
  ['unknown business provisions',a=>a.quotes[0].fees_bps.business_reserve=null,'REVUE'],
  ['removed listings are not sales',a=>a.quotes[0].comps.forEach(c=>c.status='removed'),'REVUE'],
  ['active asking prices are not sales',a=>a.quotes[0].comps.forEach(c=>c.status='active'),'REVUE'],
  ['an LLM cannot attest a sold price',a=>a.quotes[0].comps.forEach(c=>c.verified_by='llm'),'REVUE'],
  ['other model',a=>a.quotes[0].comps.forEach(c=>c.product_key='different'),'REVUE'],
  ['other condition',a=>a.quotes[0].comps.forEach(c=>c.condition_key='new'),'REVUE'],
  ['wrong resale market',a=>a.quotes[0].comps.forEach(c=>c.market_country='ES'),'REVUE'],
  ['old comps',a=>a.quotes[0].comps.forEach(c=>c.sold_at='2025-01-01'),'REVUE'],
  ['future comps',a=>a.quotes[0].comps.forEach(c=>c.sold_at='2030-01-01'),'REVUE'],
  ['unknown demand',a=>delete a.quotes[0].market,'REVUE'],
  ['favourites cannot replace market counts',a=>{a.quotes[0].market.scope='favorites';a.quotes[0].market.favorites=999999;},'REVUE'],
  ['stale demand',a=>a.quotes[0].market.observed_at='2026-08-01','REVUE'],
  ['weak market even with margin',a=>{a.quotes[0].market.sold_count=10;a.quotes[0].market.active_count=1000;},'SURVEILLER'],
  ['too much risk',a=>a.risk.score=90,'NON'],
  ['counterfeit',a=>a.risk.flags=['counterfeit'],'NON'],
  ['missing risk review',a=>delete a.risk,'REVUE'],
  ['profit after all costs is negative',a=>a.listing.price=300,'NON'],
  ['shipping destroys margin',a=>a.listing.costs_eur.inbound_shipping=150,'NON'],
  ['ambiguous model',a=>a.listing.identity_confidence=0.6,'REVUE'],
  ['stale listing',a=>a.listing.observed_at='2026-08-01','REVUE'],
  ['not currently available',a=>delete a.listing.availability,'REVUE'],
  ['non-European acquisition',a=>a.listing.country='US','REVUE'],
  ['GBP without rate',a=>a.listing.currency='GBP','REVUE'],
  ['unsafe URL',a=>a.listing.url='javascript:alert(1)','REVUE'],
  ['no destination',a=>a.quotes=[],'REVUE']
])test(name,()=>{const a=goodAssessment();change(a);const r=evaluateAssessment(a,{now:NOW});assert.equal(r.would_verdict,verdict);assert.equal(r.notification_allowed,false);});
test('duplicate comparables do not strengthen proof',()=>{const a=goodAssessment();a.quotes[0].comps=a.quotes[0].comps.map(()=>a.quotes[0].comps[0]);const r=evaluateAssessment(a,{now:NOW});assert.equal(r.best.accepted_comps,1);assert.equal(r.would_verdict,'REVUE');});
test('expensive object not rejected for price when evidence is sufficient',()=>{
  const a=goodAssessment();a.listing.price=5000;a.quotes[0].comps.forEach(c=>c.price+=9000);
  const r=evaluateAssessment(a,{now:NOW});assert.equal(r.would_verdict,'GO');assert.equal(r.best.required_comps,8);
});
test('expensive item requires more evidence',()=>{
  const a=goodAssessment();a.listing.price=5000;a.quotes[0].comps=a.quotes[0].comps.slice(0,5);a.quotes[0].comps.forEach(c=>c.price+=9000);
  assert.equal(evaluateAssessment(a,{now:NOW}).would_verdict,'REVUE');
});
test('confirmed FX has source and recent date',()=>{assert.equal(toEurCents(100,'GBP',{GBP:{eur_per_unit:1.2,source_url:'https://fx.example/rates',as_of:NOW}},NOW),12000);});
test('URL dedup removes only tracking parameters',()=>{assert.equal(canonicalUrl('https://market.example/item?id=12&utm_source=x#top'),'https://market.example/item?id=12');});
test('unverified lucrative route cannot beat valid route',()=>{
  const a=goodAssessment(),q=structuredClone(a.quotes[0]);q.channel='own_site';q.comps.forEach(c=>{c.price+=1000;c.channel='own_site';});q.enabled=false;a.quotes.push(q);
  assert.equal(evaluateAssessment(a,{now:NOW}).best.channel,'vinted');
});
test('messages are plain text and labelled as simulation',()=>{const r=evaluateAssessment(goodAssessment(),{now:NOW}),text=formatAlert(r);assert.match(text,/SIMULATION/);assert.match(text,/Validation humaine/);assert.ok(text.length<4096);});
