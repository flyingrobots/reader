/* Render the installable-app icons from web_ui/mark.svg with headless Chrome.
   READER_PLAYWRIGHT=/path/to/playwright-core READER_CHROME=/path/to/chrome node scripts/render_icons.cjs */
const {readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const ui=join(__dirname,'..','src','reader_mcp','web_ui');
const mark=readFileSync(join(ui,'mark.svg'),'utf8');
// The mark's own rounded tile, and a full-bleed maskable variant whose glyph sits in the central 80% safe zone.
const background=mark.match(/<rect[^>]*fill="([^"]+)"/)[1];
const glyph=mark.replace(/^<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'').replace(/<rect[^>]*\/>/,'');
const maskable=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${background}"/><g transform="translate(9.6 9.6) scale(.7)">${glyph}</g></svg>`;
const opaque=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${background}"/>${glyph}</svg>`;
const icons=[['apple-touch-icon.png',180,opaque],['icon-192.png',192,mark],['icon-512.png',512,mark],['icon-maskable-512.png',512,maskable]];
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{for(const [name,size,svg] of icons){
    const page=await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`);
    await page.locator('img').evaluate(img=>img.decode());
    writeFileSync(join(ui,'icons',name),await page.screenshot({omitBackground:true,clip:{x:0,y:0,width:size,height:size}}));
    await page.close();console.log(name,size);
  }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
