// Pure deterministic functions. Embedded unchanged in the n8n offline self-test.
export const RULES = Object.freeze({
  version: 'foundation-0.1.0', min_profit_eur: 25, min_roi: 0.20,
  min_demand: 60, max_risk: 35, min_identity: 0.90,
  min_comps: 5, expensive_review_eur: 2500, expensive_min_comps: 8,
  max_comp_age_days: 90, max_market_age_days: 7,
  max_fee_age_days: 90, max_fx_age_days: 3,
});
export const EUROPE = Object.freeze([
  'AL','AD','AT','BE','BA','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR',
  'HU','IS','IE','IT','XK','LV','LI','LT','LU','MT','MD','MC','ME','NL','MK',
  'NO','PL','PT','RO','SM','RS','SK','SI','ES','SE','CH','TR','UA','GB','VA',
]);
export const COST_KEYS = ['inbound_shipping','buyer_fee','refurbishment','import_reserve','handling'];
export const FEE_KEYS = ['fixed_fee','seller_shipping','packaging','return_reserve','customer_acquisition','other_reserve'];
const DAY = 86400000;
export function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
export function cents(value) {
  if (!finite(value) || value < 0 || value > 1000000000) throw new Error('INVALID_MONEY');
  return Math.round((value + Number.EPSILON) * 100);
}
export function euros(value) { return value === null ? null : Math.round(value) / 100; }
export function clamp(value, low=0, high=100) { return Math.max(low, Math.min(high, value)); }
export function ageDays(date, now) {
  if (typeof date !== 'string' || !date.trim()) return null;
  const t = Date.parse(date), n = Date.parse(now);
  return Number.isFinite(t) && Number.isFinite(n) ? (n-t)/DAY : null;
}
export function recent(date, now, maxDays) {
  const age = ageDays(date, now); return age !== null && age >= 0 && age <= maxDays;
}
// Portable in the restricted n8n Code sandbox (no global URL / require assumed).
// Deliberately conservative: absolute HTTP(S), ASCII DNS host, no credentials,
// whitespace, encoded host or dot segments. This is NOT the network access gate;
// the browser uses native WHATWG URL + DNS/IP/allowlist checks in policy.mjs.
export function evidenceUrlParts(value) {
  if(typeof value!=='string'||value.length>8192||/[\s\\\u0000-\u001f\u007f]/.test(value))throw new Error('INVALID_URL');
  const m=/^(https?):\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(value);
  if(!m)throw new Error('INVALID_URL');
  const authority=/^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(m[2]);
  if(!authority)throw new Error('INVALID_URL');
  const host=authority[1].toLowerCase(),labels=host.split('.');
  if(host.length>253||labels.length<2||labels.some(s=>!s||s.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s)))throw new Error('INVALID_URL');
  const port=authority[2]===undefined?null:Number(authority[2]);
  if(port!==null&&(port<1||port>65535))throw new Error('INVALID_URL');
  const path=m[3]||'/';
  if(path.split('/').some(s=>['.','..'].includes(s.toLowerCase().replace(/%2e/g,'.'))))throw new Error('INVALID_URL');
  const decode=s=>decodeURIComponent(s.replace(/\+/g,' '));
  const pairs=(m[4]||'').split('&').filter(Boolean).map(s=>{
    const equal=s.indexOf('=');return equal<0?[decode(s),'']:[decode(s.slice(0,equal)),decode(s.slice(equal+1))];
  });
  const scheme=m[1].toLowerCase(),defaultPort=(scheme==='https'?443:80);
  const origin=scheme+'://'+host+(port!==null&&port!==defaultPort?':'+port:'');
  return {origin,path,pairs};
}
export function safeUrl(value) {try {evidenceUrlParts(value);return true;}catch{return false;}}
export function canonicalUrl(value) {
  let parts;try{parts=evidenceUrlParts(value);}catch{throw new Error('INVALID_URL');}
  const encode=s=>encodeURIComponent(s).replace(/[!'()~]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g,'+');
  const pairs=parts.pairs.filter(([key])=>!/^(utm_|gclid$|fbclid$|msclkid$)/i.test(key));
  pairs.sort(([a],[b])=>a<b?-1:a>b?1:0);
  const query=pairs.map(([k,v])=>encode(k)+'='+encode(v)).join('&');
  // Keep item selectors, duplicate query keys and trailing path semantics.
  return parts.origin+parts.path+(query?'?'+query:'');
}
export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a,b)=>a-b), k=Math.floor(s.length/2);
  return s.length%2 ? s[k] : (s[k-1]+s[k])/2;
}
export function lowerQuartile(values) {
  if (!values.length) return null;
  const s=[...values].sort((a,b)=>a-b); return s[Math.floor((s.length-1)*0.25)];
}
export function toEurCents(amount, currency, fx, now) {
  const base = cents(amount);
  if (currency === 'EUR') return base;
  const r = fx?.[currency];
  if (!r || !finite(r.eur_per_unit) || r.eur_per_unit <= 0 || !safeUrl(r.source_url)
      || !recent(r.as_of, now, RULES.max_fx_age_days)) throw new Error('FX_UNKNOWN_OR_STALE');
  return Math.round(base*r.eur_per_unit);
}
export function validateListing(listing) {
  const errors=[];
  if (!listing || typeof listing !== 'object') return ['LISTING_REQUIRED'];
  if (!safeUrl(listing.url)) errors.push('INVALID_URL');
  if (typeof listing.title !== 'string' || !listing.title.trim()) errors.push('TITLE_REQUIRED');
  if (!EUROPE.includes(listing.country)) errors.push('COUNTRY_OUT_OF_SCOPE');
  if (!finite(listing.price) || listing.price <= 0) errors.push('INVALID_PRICE');
  if (!/^[A-Z]{3}$/.test(listing.currency || '')) errors.push('CURRENCY_REQUIRED');
  if (typeof listing.product_key !== 'string' || !listing.product_key.trim()) errors.push('PRODUCT_UNKNOWN');
  if (typeof listing.condition_key !== 'string' || !listing.condition_key.trim()) errors.push('CONDITION_UNKNOWN');
  return errors;
}
export function comparableSales(listing, quote, fx, now, rules=RULES) {
  const accepted=[], rejected=[], seen=new Set();
  for (const c of (Array.isArray(quote.comps) ? quote.comps : [])) {
    let reason=null, url=null, price=null;
    if (!c || typeof c !== 'object') { rejected.push({id:null,reason:'INVALID_COMP'}); continue; }
    if (!safeUrl(c.url)) reason='URL_MISSING'; else url=canonicalUrl(c.url);
    if (!reason && seen.has(url)) reason='DUPLICATE';
    if (!reason && c.status !== 'sold') reason='NOT_A_CONFIRMED_SALE';
    if (!reason && (c.price_confirmed !== true || !['human','official_api'].includes(c.verified_by)
      || !safeUrl(c.verification_ref))) reason='UNVERIFIED_PRICE_OR_STATUS';
    if (!reason && (c.product_key !== listing.product_key || c.condition_key !== listing.condition_key)) reason='PRODUCT_OR_CONDITION_MISMATCH';
    if (!reason && (c.channel !== quote.channel || c.market_country !== quote.country)) reason='MARKET_MISMATCH';
    if (!reason && !recent(c.sold_at,now,rules.max_comp_age_days)) reason='STALE_OR_FUTURE';
    if (!reason) {
      try { price=toEurCents(c.price,c.currency,fx,now); if (price<=0) reason='INVALID_COMP_PRICE'; }
      catch { reason='INVALID_COMP_PRICE_OR_FX'; }
    }
    if (reason) { rejected.push({id:c.id || null,reason}); continue; }
    seen.add(url);
    const delay=ageDays(c.listed_at,c.sold_at);
    accepted.push({...c,url,eur_cents:price,days_to_sell:delay!==null && delay>=0 ? delay : null});
  }
  return {accepted,rejected};
}
export function demandMetrics(quote, accepted, now, rules=RULES) {
  const m=quote.market, reasons=[];
  if (!m || !['human','official_api'].includes(m.verified_by) || !safeUrl(m.verification_ref)) reasons.push('DEMAND_UNVERIFIED');
  if (!m || m.scope !== 'complete_window' || !Number.isInteger(m.window_days) || m.window_days<7 || m.window_days>90
    || !Number.isInteger(m.sold_count) || m.sold_count<0 || !Number.isInteger(m.active_count) || m.active_count<0) reasons.push('DEMAND_WINDOW_UNKNOWN');
  if (!m || !recent(m.observed_at,now,rules.max_market_age_days)) reasons.push('DEMAND_STALE');
  if (!m || m.product_key !== accepted[0]?.product_key || m.condition_key !== accepted[0]?.condition_key
    || m.channel !== quote.channel || m.market_country !== quote.country) reasons.push('DEMAND_SCOPE_MISMATCH');
  if (m && Number.isInteger(m.window_days) && Number.isInteger(m.sold_count)
    && accepted.filter(c=>recent(c.sold_at,m.observed_at,m.window_days)).length>m.sold_count) reasons.push('DEMAND_COUNTS_INCONSISTENT');
  const days=accepted.map(c=>c.days_to_sell).filter(v=>v!==null), medianDays=median(days);
  if (days.length<3) reasons.push('SALE_SPEED_UNKNOWN');
  if (reasons.length) return {score:null,median_days:medianDays,reasons,saturation_proxy:null};
  // This is a heuristic index, NOT a calibrated probability of selling.
  const monthlySales=m.sold_count*30/m.window_days;
  const turnoverProxy=m.sold_count/Math.max(1,m.sold_count+m.active_count);
  const volume=clamp(monthlySales/25,0,1), turnover=clamp(turnoverProxy/0.5,0,1);
  const speed=clamp(1-medianDays/60,0,1);
  const score=Math.round(100*(0.35*volume+0.40*turnover+0.25*speed));
  return {score,median_days:Math.round(medianDays*10)/10,verified_sold_count:m.sold_count,
    window_days:m.window_days,active_count:m.active_count,saturation_proxy:Math.round(100*(1-turnoverProxy)),
    method:'heuristic_v1_not_probability',reasons:[]};
}
export function evaluateQuote(listing, quote, risk, fx, now, rules=RULES) {
  const reasons=[], hard=[];
  const comps=comparableSales(listing,quote,fx,now,rules);
  let buyCents=null;
  try { buyCents=toEurCents(listing.price,listing.currency,fx,now); } catch { reasons.push('ACQUISITION_FX_UNKNOWN'); }
  let costCents=0;
  for (const key of COST_KEYS) {
    try { costCents+=cents(listing.costs_eur?.[key]); } catch { reasons.push('COST_UNKNOWN:'+key); }
  }
  const allIn=buyCents===null ? null : buyCents+costCents;
  const requiredComps=allIn!==null && allIn>=rules.expensive_review_eur*100 ? rules.expensive_min_comps : rules.min_comps;
  if (comps.accepted.length<requiredComps) reasons.push('INSUFFICIENT_SOLD_COMPS');
  if (quote.enabled !== true || quote.market_accessible !== true || quote.category_allowed !== true || !EUROPE.includes(quote.country)) reasons.push('CHANNEL_NOT_APPROVED');
  if (!recent(quote.fees_reviewed_at,now,rules.max_fee_age_days)) reasons.push('FEES_UNKNOWN_OR_STALE');
  let fees=0;
  for (const key of FEE_KEYS) {
    try { fees+=cents(quote.fees_eur?.[key]); } catch { reasons.push('FEE_UNKNOWN:'+key); }
  }
  const bps=quote.fees_bps;
  if (!bps || !Number.isInteger(bps.platform) || bps.platform<0 || bps.platform>10000
    || !Number.isInteger(bps.business_reserve) || bps.business_reserve<0 || bps.business_reserve>10000) reasons.push('PERCENT_FEES_UNKNOWN');
  const gross=lowerQuartile(comps.accepted.map(c=>c.eur_cents));
  const unknownCost=reasons.some(r=>/FX|COST_UNKNOWN|FEE|PERCENT/.test(r));
  const sellNet=gross===null || unknownCost ? null : gross-fees-Math.ceil(gross*(bps.platform+bps.business_reserve)/10000);
  const profit=sellNet===null || allIn===null ? null : sellNet-allIn;
  const roi=profit===null || !allIn ? null : profit/allIn;
  const demand=demandMetrics(quote,comps.accepted,now,rules);
  reasons.push(...demand.reasons);
  if (demand.score !== null && demand.score<rules.min_demand) reasons.push('DEMAND_TOO_WEAK');
  if (!finite(listing.identity_confidence) || listing.identity_confidence<rules.min_identity) reasons.push('IDENTITY_UNCERTAIN');
  if (!risk || risk.reviewed_by !== 'human' || !safeUrl(risk.evidence_ref)
    || !recent(risk.reviewed_at,now,rules.max_market_age_days) || !finite(risk.score) || risk.score<0 || risk.score>100) reasons.push('RISK_NOT_REVIEWED');
  else if (risk.score>rules.max_risk) hard.push('RISK_TOO_HIGH');
  if (Array.isArray(risk?.flags) && risk.flags.some(v=>['counterfeit','prohibited','unsafe','suspected_stolen'].includes(v))) hard.push('HARD_RISK_FLAG');
  if (profit!==null && (profit<rules.min_profit_eur*100 || roi<rules.min_roi)) hard.push('MARGIN_INSUFFICIENT');
  if (!recent(listing.observed_at,now,1)) reasons.push('LISTING_STALE');
  if (listing.availability !== 'active') reasons.push('AVAILABILITY_UNKNOWN');
  let verdict=hard.length ? 'NON' : reasons.length ? 'REVUE' : 'GO';
  if (!hard.length && demand.score!==null && demand.score<rules.min_demand) verdict='SURVEILLER';
  const missingCritical=reasons.some(r=>/UNKNOWN|UNVERIFIED|UNREVIEWED|NOT_REVIEWED|INSUFFICIENT|UNCERTAIN|STALE|MISMATCH|NOT_APPROVED/.test(r));
  if (!hard.length && missingCritical) verdict='REVUE';
  return {channel:quote.channel,country:quote.country,verdict,
    reasons:[...new Set([...hard,...reasons])],all_in_eur:unknownCost ? null : euros(allIn),
    conservative_gross_eur:euros(gross),conservative_net_eur:euros(sellNet),
    estimated_contribution_eur:euros(profit),roi:roi===null?null:Math.round(roi*1000)/1000,
    // Not a promise of future sale time; historical delay only.
    historical_median_days:demand.median_days,demand,
    required_comps:requiredComps,accepted_comps:comps.accepted.length,rejected_comps:comps.rejected,
    evidence_links:comps.accepted.map(c=>c.url),
    eur_per_holding_day:profit===null || demand.median_days===null ? null : Math.round(euros(profit)/Math.max(1,demand.median_days)*100)/100};
}
export function evaluateAssessment(input, {now=new Date().toISOString(),rules=RULES}={}) {
  const listing=input?.listing, errors=validateListing(listing);
  const simulated=listing?.mode !== 'live';
  if (errors.length) return {rule_version:rules.version,simulated,verdict:'REVUE',would_verdict:'REVUE',notification_allowed:false,reasons:errors,quotes:[]};
  const quotes=(Array.isArray(input.quotes)?input.quotes:[]).filter(q=>q && ['vinted','leboncoin','own_site'].includes(q.channel))
    .map(q=>evaluateQuote(listing,q,input.risk,input.fx||{},now,rules));
  const rank={GO:3,REVUE:2,SURVEILLER:1,NON:0};
  quotes.sort((a,b)=>rank[b.verdict]-rank[a.verdict] || (b.eur_per_holding_day??-Infinity)-(a.eur_per_holding_day??-Infinity));
  const best=quotes[0]||null, verdict=best?.verdict||'REVUE';
  return {rule_version:rules.version,thresholds_provisional:true,simulated,
    verdict:simulated?'SIMULATION':verdict,would_verdict:verdict,
    notification_allowed:!simulated && verdict==='GO',
    reasons:best?.reasons||['NO_RESALE_QUOTES'],listing_url:canonicalUrl(listing.url),title:listing.title,
    best,quotes,warning:'Estimation après provisions configurées, pas un bénéfice garanti ni un calcul fiscal définitif.'};
}
export function formatAlert(result) {
  const b=result.best, safe=s=>String(s??'').replace(/[\u0000-\u001f]/g,' ').slice(0,220);
  const money=v=>v===null||v===undefined?'inconnu':`${v.toFixed(2)} €`;
  const lines=[`${result.simulated?'[SIMULATION] ':''}FLIP RADAR — ${result.verdict}`,
    safe(result.title),safe(result.listing_url)];
  if (b) lines.push(`Canal : ${b.channel} / ${b.country}`,`Coût complet : ${money(b.all_in_eur)}`,
    `Revente nette prudente : ${money(b.conservative_net_eur)}`,
    `Marge estimée après provisions : ${money(b.estimated_contribution_eur)}`,
    `Demande : ${b.demand.score??'inconnue'}/100 · ventes comparables : ${b.accepted_comps}`,
    `Délai médian historique : ${b.historical_median_days??'inconnu'} jours`,
    `À vérifier : ${(b.reasons.length?b.reasons:['état réel, disponibilité et frais']).join(', ')}`,
    ...b.evidence_links.slice(0,3));
  lines.push('Validation humaine requise. Aucun achat automatique.');
  // Plain text, no Telegram HTML/Markdown parser injection.
  return lines.join('\n').slice(0,3900);
}
