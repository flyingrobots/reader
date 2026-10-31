/* Writes the browser suites' frozen test theme (tests/test_theme_fixture.py).
     node tests/fixtures/make_test_theme.cjs --from-builtins   once: copy Paper (light) and Ink (dark) into reader-test-theme.json
     node tests/fixtures/make_test_theme.cjs                   regenerate reader-test-theme.css from that JSON with the app's own code
   The JSON is frozen: do not regenerate it when product themes change; that independence is its purpose. Regenerate the CSS
   only when web_themes reports that the app now builds a different stylesheet from the same JSON. */
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const here=__dirname,builtins=process.argv.includes('--from-builtins');
const tokens=require('../../src/reader_mcp/web_ui/theme-tokens.json').colors;

(async()=>{
  const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py',...(builtins?['--product-theme']:[])],{stdio:['ignore','pipe','inherit']});let browser;
  try{
    const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
    browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage();
    if(builtins){
      const read=async theme=>{await page.goto(url+'/?theme='+theme);await page.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);
        return page.evaluate(list=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d',{willReadFrequently:true}),style=getComputedStyle(document.documentElement);
          const hex=value=>{c.clearRect(0,0,1,1);c.fillStyle='#000';c.fillStyle=value;c.fillRect(0,0,1,1);const [r,g,b,a]=c.getImageData(0,0,1,1).data;
            const h=n=>n.toString(16).padStart(2,'0');return '#'+h(r)+h(g)+h(b);};
          const alpha=value=>{const probe=document.createElement('i');probe.style.color=value;document.body.append(probe);const rgba=getComputedStyle(probe).color;probe.remove();
            const m=rgba.match(/[\d.]+/g).map(Number);return m.length>3?m[3]:1;};
          return Object.fromEntries(list.map(t=>{const v=style.getPropertyValue('--'+t.name).trim(),base=hex(v);
            return [t.name,t.alpha?base+Math.round(alpha(v)*255).toString(16).padStart(2,'0'):base];}));},tokens);};
      const theme={schema_version:1,id:'reader-test',name:'Reader test',fonts:{},headings:{},light:await read('paper'),dark:await read('ink')};
      writeFileSync(join(here,'reader-test-theme.json'),JSON.stringify(theme,null,2)+'\n');console.log('Wrote reader-test-theme.json');
    }else{
      // The fixture lists the JSON in /api/themes; the app builds the stylesheet and caches it in localStorage.
      const answered=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/themes');
      await page.goto(url+'/?theme=user-reader-test');await answered;
      await page.waitForFunction(()=>{try{const c=JSON.parse(localStorage.getItem('reader.themes.v1'));return c?.ids?.includes('user-reader-test-dark')&&c.css.includes('user-reader-test-dark');}catch{return false;}});
      await page.waitForTimeout(300);
      const css=await page.evaluate(()=>JSON.parse(localStorage.getItem('reader.themes.v1')).css);
      writeFileSync(join(here,'reader-test-theme.css'),css);console.log('Wrote reader-test-theme.css ('+css.length+' bytes)');
    }
  }finally{await browser?.close();fixture.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
