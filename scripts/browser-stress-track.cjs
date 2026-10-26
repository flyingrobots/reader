/* Preloaded by scripts/browser-stress.mjs (node --require): counts every 429 and 5xx response a browser suite sees,
   in every context and frame, and writes the tally to READER_STRESS_RESPONSES when the suite exits.
   It changes nothing the suite does; it only listens. */
const {writeFileSync}=require('node:fs');
const out=process.env.READER_STRESS_RESPONSES;
const playwright=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const tally={busy:0,errors:0,first:[]};
const listen=context=>{if(context.__readerStress)return context;context.__readerStress=true;
  context.on('response',response=>{const status=response.status();if(status!==429&&status<500)return;
    if(status===429)tally.busy++;else tally.errors++;
    if(tally.first.length<40){const url=new URL(response.url());tally.first.push(`${status} ${response.request().method()} ${url.pathname}`);}});
  return context;};
const launch=playwright.chromium.launch.bind(playwright.chromium);
playwright.chromium.launch=async(...args)=>{const browser=await launch(...args);
  const newContext=browser.newContext.bind(browser),newPage=browser.newPage.bind(browser);
  browser.newContext=async(...a)=>listen(await newContext(...a));
  browser.newPage=async(...a)=>{const page=await newPage(...a);listen(page.context());return page;};
  return browser;};
if(out)process.on('exit',()=>{try{writeFileSync(out,JSON.stringify(tally));}catch{}});
