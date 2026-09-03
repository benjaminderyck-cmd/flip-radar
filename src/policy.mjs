import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { recent, safeUrl } from './core.mjs';

export class PolicyError extends Error { constructor(code) { super(code); this.name='PolicyError'; } }
export function publicIp(address) {
  if (isIP(address)===4) {
    const [a,b,c]=address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===100 && b>=64 && b<=127)
      || (a===169 && b===254) || (a===172 && b>=16 && b<=31) || (a===192 && b===168)
      || (a===192 && b===0) || (a===192 && b===2) || (a===198 && (b===18||b===19||b===51))
      || (a===203 && b===0 && c===113));
  }
  if (isIP(address)===6) {
    const a=address.toLowerCase();
    // Conservatively accept global-unicast only, excluding documentation space.
    return /^[23][0-9a-f]{3}:/.test(a) && !a.startsWith('2001:db8:');
  }
  return false;
}
export function assertSource(source, now=new Date().toISOString()) {
  if (!source || source.enabled!==true || source.status!=='approved') throw new PolicyError('SOURCE_NOT_APPROVED');
  if (!safeUrl(source.policy_url) || !recent(source.reviewed_at,now,90)) throw new PolicyError('SOURCE_POLICY_UNREVIEWED');
  if (!/^[a-z0-9_-]{2,64}$/.test(source.id||'')) throw new PolicyError('SOURCE_ID_INVALID');
  for (const list of [source.navigation_hosts,source.resource_hosts]) {
    if (!Array.isArray(list) || !list.length || list.some(h=>typeof h!=='string' || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(h) || isIP(h))) throw new PolicyError('HOST_POLICY_INVALID');
  }
  if (!source.search_url_template?.includes('{query}')) throw new PolicyError('SEARCH_TEMPLATE_REQUIRED');
  if (!Array.isArray(source.listing_path_prefixes) || source.listing_path_prefixes.some(p=>typeof p!=='string'||!p.startsWith('/')||p==='/')) throw new PolicyError('LISTING_PATH_POLICY_INVALID');
  return source;
}
export function assertReadUrl(raw, source, {navigation=true}={}) {
  let u; try {u=new URL(raw);} catch {throw new PolicyError('INVALID_URL');}
  if (u.protocol!=='https:' || u.username || u.password || (u.port && u.port!=='443') || u.hostname.endsWith('.')) throw new PolicyError('URL_SCHEME_OR_AUTH_BLOCKED');
  const hosts=navigation?source.navigation_hosts:[...source.navigation_hosts,...source.resource_hosts];
  if (!hosts?.includes(u.hostname)) throw new PolicyError('DOMAIN_NOT_APPROVED');
  let path=u.pathname;
  for (let i=0;i<3;i++) {try {const p=decodeURIComponent(path);if(p===path)break;path=p;}catch {throw new PolicyError('PATH_INVALID');}}
  if (navigation && /(?:^|\/)(?:checkout|cart|basket|buy|purchase|payment|payments|account|login|signin|logout|signout|register|delete|remove|message|messages|offer|offers|bid|bids|sell|publish|settings)(?:\/|$|[._-])/i.test(path)) throw new PolicyError('STATE_CHANGING_PATH_BLOCKED');
  if (navigation && [...u.searchParams.keys()].some(k=>/^(?:action|cmd|token|access_token|api_key|session|password|confirm|purchase|checkout|delete|bid|offer)$/i.test(k))) throw new PolicyError('STATE_CHANGING_QUERY_BLOCKED');
  return u;
}
export async function assertPublicUrl(raw, source, options={}, resolver=lookup) {
  const u=assertReadUrl(raw,source,options);
  const addresses=await resolver(u.hostname,{all:true,verbatim:true});
  if (!addresses.length || addresses.some(a=>!publicIp(a.address))) throw new PolicyError('PRIVATE_NETWORK_BLOCKED');
  return u;
}
export function searchUrl(source,query) {
  if (typeof query!=='string'||!query.trim()||query.length>300) throw new PolicyError('QUERY_INVALID');
  const url=source.search_url_template.replaceAll('{query}',encodeURIComponent(query));
  return assertReadUrl(url,source).toString();
}
export function challengeDetected(text) {
  return /(?:verify (?:that )?you are (?:a )?human|confirm you are human|security verification required|access denied|captcha|vérifiez que vous êtes humain|accès refusé|temporarily blocked|unusual traffic)/i.test(text.slice(0,4000));
}
