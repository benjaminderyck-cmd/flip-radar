import { assertPublicUrl, challengeDetected, PolicyError } from './policy.mjs';

// Deployment adapter; tests use a fake browser. No page content can execute code here.
export class PlaywrightBrowser {
  constructor({vision=false,resolver}={}) {this.vision=vision;this.resolver=resolver;this.browser=null;this.context=null;this.page=null;this.source=null;}
  async init() {
    if(this.browser)return;
    const {chromium}=await import('playwright');
    this.browser=await chromium.launch({headless:true,chromiumSandbox:true,
      // Do not pass DB/model/server secrets to the browser subprocess.
      env:{PATH:process.env.PATH||'/usr/bin:/bin',LANG:'C.UTF-8'},
      args:['--disable-background-networking','--disable-quic','--disable-sync']});
    this.context=await this.browser.newContext({acceptDownloads:false,serviceWorkers:'block',
      userAgent:'FLIP-RADAR/0.4 (read-only opportunity research)',viewport:{width:1280,height:900}});
    await this.context.route('**/*',async route=>{
      const r=route.request();
      try {
        if(!this.source||!['GET','HEAD'].includes(r.method())) throw new PolicyError('WRITE_REQUEST_BLOCKED');
        if(['media','font'].includes(r.resourceType())) return await route.abort();
        await assertPublicUrl(r.url(),this.source,{navigation:r.isNavigationRequest()},this.resolver);
        await route.continue();
      } catch {await route.abort().catch(()=>{});}
    });
    await this.context.routeWebSocket('**/*',ws=>ws.close());
    this.page=await this.context.newPage();
    this.context.on('page',page=>{if(page!==this.page)page.close().catch(()=>{});});
    this.page.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));
    this.page.on('download',download=>download.cancel().catch(()=>{}));
    this.page.setDefaultTimeout(10000);
  }
  async navigate(url,source,{signal}={}) {
    if(signal?.aborted)throw new Error('RUN_CANCELLED');
    await assertPublicUrl(url,source,{},this.resolver);
    await this.init();this.source=source;
    if(signal?.aborted){await this.close();throw new Error('RUN_CANCELLED');}
    const stop=()=>this.close().catch(()=>{});signal?.addEventListener('abort',stop,{once:true});
    try {
      const response=await this.page.goto(url,{waitUntil:'domcontentloaded',timeout:18000});
      if([401,403,429].includes(response?.status())) throw new PolicyError('ACCESS_DENIED_STOP');
      if(!response || response.status()>=400) throw new Error('PAGE_HTTP_ERROR');
      // Redirect destination checked in addition to request interception.
      await assertPublicUrl(this.page.url(),source,{},this.resolver);
      if(source.ready_selector)await this.page.locator(source.ready_selector).first().waitFor({state:'visible',timeout:8000});
      return await this.snapshot();
    } finally {signal?.removeEventListener('abort',stop);}
  }
  async scroll(direction,source,{signal}={}) {
    if(signal?.aborted)throw new Error('RUN_CANCELLED');
    await assertPublicUrl(this.page.url(),source,{},this.resolver);
    await this.page.mouse.wheel(0,direction==='down'?720:-720);
    return this.snapshot();
  }
  async snapshot() {
    const text=(await this.page.locator('body').innerText({timeout:8000})).slice(0,30000);
    if(challengeDetected(text))throw new PolicyError('ACCESS_CHALLENGE_STOP');
    const links=await this.page.locator('a[href]').evaluateAll(elements=>elements.slice(0,200)
      .map(a=>({url:a.href,text:(a.innerText||a.getAttribute('aria-label')||'').trim().slice(0,140)})));
    const seen=new Set();
    const usable=links.filter(l=>{if(!l.url.startsWith('https:')||seen.has(l.url))return false;seen.add(l.url);return true;})
      .slice(0,80).map((l,id)=>({id,...l}));
    const screenshot=this.vision?await this.page.screenshot({type:'jpeg',quality:55,fullPage:false,timeout:8000}):null;
    return {url:this.page.url(),text,links:usable,screenshot};
  }
  async close() {
    const browser=this.browser;this.browser=null;
    if(browser)await browser.close();
  }
}
