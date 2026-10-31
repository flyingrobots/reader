/* Full article quiz path: fake CLI -> saved edition -> grading -> evidence -> receipt. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {readFileSync,mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'python3',['tests/quiz_fixture.py'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url,root}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking']});
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.addInitScript(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({theme:'user-reader-test',smooth:false,art:false,shapes:false,nextReads:false,participant:'Browser tester'})));
  await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));
  await page.waitForSelector('#article:not(.resume-pending)');
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('x');
  const modal=page.locator('[data-reader-quiz]');await modal.waitFor();
  assert.equal(await page.locator('#vim-mode').textContent(),'QUIZ');
  // Setup: voice and difficulty are chosen before generation, then locked in for that quiz.
  const slider=modal.getByRole('slider',{name:'Difficulty'});
  assert.equal(await slider.getAttribute('aria-valuenow'),'3');
  await slider.focus();await page.keyboard.press('ArrowRight');
  await modal.getByText('4 · Analyze',{exact:true}).waitFor();
  const generated=page.waitForRequest(request=>request.url().includes('/api/quiz')&&request.method()==='POST');
  await modal.getByRole('button',{name:'Generate a quiz',exact:true}).click();
  assert.equal((await generated).postDataJSON().difficulty,4);
  await modal.getByText('Question 1 of 5',{exact:true}).waitFor({timeout:15000});
  assert.equal(await modal.locator('#quiz-voice').count(),0);
  assert.equal(await modal.getByRole('slider').count(),0);
  await modal.getByText(/^Quiz by /).waitFor();
  assert.equal(await modal.locator('.reader-quiz-bar [data-slot=progress-indicator]').evaluate(e=>Math.round(parseFloat(e.style.width||getComputedStyle(e).width))),20);
  assert.equal(await modal.locator('[data-slot=dialog-title]').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=24),true);
  // Grading is immediate in the browser; the first deliberately wrong choice shows the reference answer.
  await modal.getByRole('radio').nth(1).click();
  await modal.getByText('The saved answer is red.',{exact:true}).waitFor();
  // Grading marks the saved answer green, crosses out the others, explains why and keeps a running score.
  assert.deepEqual(await modal.locator('[data-slot=questionnaire-choice]:visible').evaluateAll(choices=>choices.map(c=>c.dataset.quizResult)),['correct','chosen-wrong','wrong','wrong']);
  assert.equal(await modal.locator('[data-quiz-result=correct] .reader-quiz-mark').textContent(),'Correct answer');
  assert.equal(await modal.locator('[data-quiz-result=wrong] .reader-quiz-option').first().evaluate(e=>getComputedStyle(e).textDecorationLine),'line-through');
  const green=await modal.locator('[data-quiz-result=correct]').evaluate(e=>getComputedStyle(e).borderTopColor);assert.match(green,/oklab|rgb/);
  await modal.getByText('Why:',{exact:false}).first().waitFor();
  assert.equal(await modal.locator('.reader-quiz-running').textContent(),'Score 0 of 1');
  await modal.getByRole('button',{name:'Show me in the text',exact:true}).click();
  await modal.waitFor({state:'hidden'});
  await page.waitForFunction(()=>CSS.highlights.get('reader-quiz')?.size===1);
  assert.equal(await page.evaluate(()=>[...CSS.highlights.get('reader-quiz')][0].toString()),'The first color is red.');
  // Reopening retains the attempt. A later retake uses the exact saved question IDs.
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('x');await modal.waitFor();
  await modal.getByRole('button',{name:'Next question',exact:true}).click();
  for(let i=2;i<=4;i++){
   await modal.getByText(`Question ${i} of 5`,{exact:true}).waitFor();
   await modal.getByRole('radio').nth(0).click();
   await modal.getByText('Correct.',{exact:true}).waitFor();
   await modal.getByRole('button',{name:'Next question',exact:true}).click();
  }
  await modal.getByLabel('Your answer',{exact:true}).fill('Purple.');
  await modal.getByRole('button',{name:'Ask for a review',exact:true}).click();
  await modal.getByText('The fifth sentence names purple.',{exact:true}).waitFor({timeout:15000});
  assert.equal(await modal.locator('.reader-quiz-running').textContent(),'Score 4 of 5');
  await modal.getByRole('button',{name:'Save results',exact:true}).click();
  await modal.getByText('4 of 5',{exact:true}).waitFor();
  await page.locator('[data-reading-log-quizzes]',{hasText:'You took the quiz · 4/5'}).waitFor();
  const data=await page.evaluate(async()=>await(await fetch('/api/quiz?path=library/thought.md&participant=Browser%20tester')).json());
  const original=readFileSync(root+`/quizzes/${data.quiz.document_sha256}/${data.quiz.id}.json`,'utf8');
  await modal.getByRole('button',{name:'Retake the same quiz',exact:true}).click();
  assert.equal(await modal.getByRole('radio',{checked:true}).count(),0);
  assert.equal(readFileSync(root+`/quizzes/${data.quiz.document_sha256}/${data.quiz.id}.json`,'utf8'),original);
  // A narrow screen uses the full viewport without horizontal overflow.
  await page.setViewportSize({width:390,height:844});
  const bounds=await modal.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=391,bounds);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const shots=process.env.READER_SHOTS;if(shots){mkdirSync(shots,{recursive:true});await page.screenshot({path:shots+'/quiz-phone.png'});}
  await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.id==='main',null,{timeout:3000}).catch(async()=>{throw Error('Quiz close focus state: '+JSON.stringify(await page.evaluate(()=>({active:document.activeElement?.outerHTML.slice(0,400),mainInert:document.querySelector('#main').closest('[inert]')?.outerHTML.slice(0,100),mainTabIndex:document.querySelector('#main').tabIndex,mode:document.querySelector('#vim-mode').textContent,openModal:!!document.querySelector('[data-reader-quiz]')}))));});
  // Two-page reading uses the same source anchor and the rasterizer's named highlight.
  await page.setViewportSize({width:1280,height:900});await page.locator('#layout-swap').click();
  await page.waitForSelector('.book-viewport');
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('x');await modal.waitFor();
  await modal.getByRole('radio').nth(0).click();await modal.getByRole('button',{name:'Show me in the text',exact:true}).click();
  await modal.waitFor({state:'hidden'});await page.waitForFunction(()=>CSS.highlights.get('reader-quiz')?.size===1);
  assert.equal(await page.evaluate(()=>[...CSS.highlights.get('reader-quiz')][0].toString()),'The first color is red.');
  const painted=await page.evaluate(async()=>{
   const {rasterize}=await import('/assets/controls/page-turn.js'),article=document.querySelector('#article');
   const highlight=CSS.highlights.get('reader-quiz'),rect=[...highlight][0].getBoundingClientRect();
   const box={x:rect.left-2,y:rect.top-2,w:Math.ceil(rect.width)+4,h:Math.ceil(rect.height)+4};
   const render=()=>{const canvas=rasterize(article,box,0,getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),1);return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;};
   const withQuiz=render();CSS.highlights.delete('reader-quiz');const without=render();CSS.highlights.set('reader-quiz',highlight);
   let pixels=0;for(let i=0;i<withQuiz.length;i+=4)if(withQuiz[i]!==without[i]||withQuiz[i+1]!==without[i+1]||withQuiz[i+2]!==without[i+2])pixels++;
   return pixels;
  });
  assert.ok(painted>20,'the compiled page-turn rasterizer must paint quiz highlighting');
  assert.deepEqual(errors,[]);
  console.log('Quiz browser: generation, local grading, short review, receipts, retake, mobile and both reading layouts passed.');
 }finally{await browser?.close();fixture.kill('SIGTERM');}
})().catch(error=>{console.error(error);process.exitCode=1;});
