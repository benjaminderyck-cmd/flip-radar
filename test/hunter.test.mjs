import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSource,assertReadUrl,assertPublicUrl,searchUrl,publicIp,challengeDetected} from '../src/policy.mjs';
import {runHunter,extractCandidate,parsePriceText} from '../src/hunter.mjs';
import {NOW,source,mission,FakeBrowser,ScriptedModel,normalActions,listingFields,listingSnapshot} from './fixtures.mjs';

test('agent chooses a query, follows observed link and saves grounded data',async()=>{
  const browser=new FakeBrowser(),model=new ScriptedModel(normalActions);
  const result=await runHunter({mission:mission(),sources:[source],browser,model,mode:'test',clock:()=>Date.parse(NOW)});
  assert.equal(result.status,'completed');assert.equal(result.pages,2);assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0].price,100);assert.equal(result.candidates[0].identity_confidence,0.85);
  assert.equal(result.candidates[0].review_status,'unverified');assert.equal(result.candidates[0].costs_eur.inbound_shipping,null);
  assert.ok(browser.visits[0].includes('orthographi'));assert.ok(browser.closed);assert.equal(result.external_calls,0);
});
test('agent can pivot query rather than iterate fixed URLs',async()=>{
  const browser=new FakeBrowser();const actions=[normalActions[0],{action:'search',source_id:source.id,query:'autre reference'},...normalActions.slice(1)];
  await runHunter({mission:mission(),sources:[source],browser,model:new ScriptedModel(actions),mode:'test',clock:()=>Date.parse(NOW)});
  assert.ok(browser.visits[1].includes('autre%20reference'));
});
test('unknown actions (buy, message) cannot execute',async()=>{
  const browser=new FakeBrowser();await assert.rejects(runHunter({mission:mission(),sources:[source],browser,model:new ScriptedModel([{action:'buy'}]),clock:()=>Date.parse(NOW)}),/INVALID_MODEL_ACTION/);assert.ok(browser.closed);
});
test('unobserved link cannot be opened',async()=>{
  await assert.rejects(runHunter({mission:mission(),sources:[source],browser:new FakeBrowser(),model:new ScriptedModel([normalActions[0],{action:'open_link',link_id:999}]),clock:()=>Date.parse(NOW)}),/LINK_NOT_OBSERVED/);
});
test('same listing is not returned twice',async()=>{
  const r=await runHunter({mission:mission(),sources:[source],browser:new FakeBrowser(),model:new ScriptedModel([...normalActions.slice(0,3),normalActions[2],{action:'finish'}]),clock:()=>Date.parse(NOW)});
  assert.equal(r.candidates.length,1);
});
test('browser always closes on model failure',async()=>{
  const browser=new FakeBrowser();await assert.rejects(runHunter({mission:mission(),sources:[source],browser,model:{next:async()=>{throw new Error('MODEL_FAIL');}},clock:()=>Date.parse(NOW)}));assert.ok(browser.closed);
});
test('page budget stops exploration',async()=>{
  const r=await runHunter({mission:mission(),sources:[source],browser:new FakeBrowser(),model:new ScriptedModel(normalActions),limits:{max_pages:1},clock:()=>Date.parse(NOW)});assert.equal(r.status,'page_budget');assert.equal(r.pages,1);
});
test('challenge stops, no bypass',async()=>{
  const browser=new FakeBrowser();browser.navigate=async()=>({url:'https://market.example/search',text:'Verify you are human — CAPTCHA',links:[]});
  await assert.rejects(runHunter({mission:mission(),sources:[source],browser,model:new ScriptedModel(normalActions),clock:()=>Date.parse(NOW)}),/ACCESS_CHALLENGE_STOP/);assert.ok(browser.closed);
});
test('an invented price is rejected even if model is confident',()=>{
  assert.throws(()=>extractCandidate({...listingFields,price:10},listingSnapshot,source),/PRICE_EVIDENCE_MISMATCH/);
});
test('search results page is not a sellable listing',()=>{
  assert.throws(()=>extractCandidate(listingFields,{...listingSnapshot,url:'https://market.example/search'},source),/NOT_A_LISTING_PAGE/);
});
test('model-provided trust and costs cannot enter saved candidate',()=>{
  const c=extractCandidate({...listingFields,verified_by:'official_api',costs_eur:{inbound_shipping:0},availability:'active',mode:'live'},listingSnapshot,source,{mode:'test'});
  assert.equal(c.mode,'test');assert.equal(c.verified_by,undefined);assert.equal(c.availability,undefined);assert.equal(c.costs_eur.inbound_shipping,null);
});
test('source access must be reviewed',()=>{assert.throws(()=>assertSource({...source,enabled:false},NOW),/SOURCE_NOT_APPROVED/);assert.throws(()=>assertSource({...source,reviewed_at:null},NOW),/UNREVIEWED/);});
for(const url of ['https://market.example.evil.com/item/1','http://market.example/item/1','https://user:pass@market.example/item/1','https://market.example:8443/item/1','https://market.example/checkout','https://market.example/%63heckout','https://market.example/item/1?action=buy','https://127.0.0.1/item/1'])test('blocked URL '+url,()=>assert.throws(()=>assertReadUrl(url,source)));
for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1'])test('private address '+ip,()=>assert.equal(publicIp(ip),false));
test('public addresses pass IP gate',()=>{assert.equal(publicIp('93.184.216.34'),true);assert.equal(publicIp('2606:4700:4700::1111'),true);});
test('DNS pointing into local network is blocked',async()=>{await assert.rejects(assertPublicUrl('https://market.example/item/1',source,{},async()=>[{address:'127.0.0.1'}]),/PRIVATE_NETWORK/);});
test('query encoding cannot inject parameters',()=>{const u=new URL(searchUrl(source,'x&action=buy'));assert.equal(u.searchParams.get('q'),'x&action=buy');assert.equal(u.searchParams.has('action'),false);});
test('locale price parsing is explicit',()=>{assert.equal(parsePriceText('1 234,56 €'),1234.56);assert.equal(parsePriceText('£1,234.56'),1234.56);assert.equal(parsePriceText('de 10 à 20 €'),null);});
test('malformed separators are not silently turned into a price',()=>{
  assert.equal(parsePriceText('100,0 €'),100);assert.equal(parsePriceText('10,00,00 €'),null);
  assert.equal(parsePriceText('1,2,345 €'),null);assert.equal(parsePriceText('1.234 €'),1234);
});
test('currency must agree with the observed price marker',()=>{
  assert.throws(()=>extractCandidate({...listingFields,currency:'GBP'},listingSnapshot,source),/CURRENCY_EVIDENCE_MISMATCH/);
});
