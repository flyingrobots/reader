const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
const doc={path:'library/article.md',kind:'.md',sha256:'current'};
const question={id:'q1',type:'short',prompt:'Explain the original passage.'};
const oldQuiz={id:'old-quiz',author:'Voice',document_sha256:'current',questions:[question]};
const newQuiz={...oldQuiz,id:'new-quiz',questions:[{...question,prompt:'Explain a different passage.'}]};
const listing=quiz=>({quiz,task:null,voices:[{name:'Voice',runnable:true}],default_voice:'Voice'});
async function harness(api,document=()=>doc){
 const {installQuiz}=await import(pathToFileURL(resolve('src/reader_mcp/web_ui/quiz.mjs')));
 let model;
 const controller=installQuiz({api,document,participant:()=> 'Reader',mount:value=>{model=value;return {destroy(){}};},showEvidence(){},changed(){},mode(){},available:()=>null,toast(){}});
 return {controller,get:()=>model.getSnapshot(),actions:()=>model.actions};
}

test('a completed review stays with the quiz being answered after another tab regenerates',async()=>{
 const review={quiz_id:oldQuiz.id,question_id:'q1',verdict:'right',comment:'Correct for the original question.'};
 const pending={id:'review-task',kind:'quiz-review',state:'queued'},done={...pending,state:'done',result:review};
 let reads=0;
 const h=await harness(async(path,body)=>body?{task:pending}:reads++?{...listing(newQuiz),task:done}:listing(oldQuiz));
 try{
  await h.controller.open();h.actions().shortAnswer('An answer to the original question.');await h.actions().review();
  assert.equal(h.get().quiz.id,oldQuiz.id,'an in-progress attempt must retain its saved question set');
  assert.equal(h.get().reviews.q1.comment,review.comment);
 }finally{h.controller.destroy();}
});

test('a late accepted review does not attach to a different document context',async()=>{
 let current=doc,finish;
 const h=await harness(async(path,body)=>body?new Promise(resolve=>{finish=resolve;}):listing(oldQuiz),()=>current);
 try{
  await h.controller.open();h.actions().shortAnswer('An answer.');const pending=h.actions().review();
  h.controller.close();current={...doc,path:'library/other.md'};await h.controller.open();
  finish({task:{id:'old-context',kind:'quiz-review',state:'queued'}});await pending;
  assert.equal(h.get().task,null,'only the originating document may retain this task');
 }finally{h.controller.destroy();}
});

test('closing an in-flight result does not leave a borrowed quiz busy on reopen',async()=>{
 const quiz={...oldQuiz,questions:[{id:'q1',type:'choice',options:['A','B','C','D'],answer:0}]};
 let finish;
 const h=await harness(async(path,body)=>body?new Promise(resolve=>{finish=resolve;}):listing(quiz));
 try{
  await h.controller.open();h.actions().choose('0');const pending=h.actions().next();
  assert.equal(h.get().busy,true);h.controller.close();
  finish({score:1,total:1,missed:[]});await pending;
  await h.controller.open();
  assert.equal(h.get().busy,false,'a load with no participant task must clear transient request state');
 }finally{h.controller.destroy();}
});

for(const reopenEarly of [false,true])test(`an accepted review survives closing before its POST returns (reopen early: ${reopenEarly})`,async()=>{
 let finish,polled=false;
 const task={id:'accepted-review',kind:'quiz-review',state:'done',result:{quiz_id:oldQuiz.id,question_id:'q1',verdict:'right',comment:'Preserved review.'}};
 const h=await harness(async(path,body)=>{
  if(body)return new Promise(resolve=>{finish=resolve;});
  if(path.includes('task=accepted-review')){polled=true;return {...listing(oldQuiz),task};}
  return listing(oldQuiz);
 });
 try{
  await h.controller.open();h.actions().shortAnswer('My answer.');const pending=h.actions().review();
  h.controller.close();if(reopenEarly)await h.controller.open();
  finish({task});await pending;if(!reopenEarly)await h.controller.open();
  assert.equal(polled,true,'the accepted task must be polled without another provider request');
  assert.equal(h.get().reviews.q1?.comment,'Preserved review.');
 }finally{h.controller.destroy();}
});

for(const reopenEarly of [false,true])test(`regeneration replaces a prior review task after closing (reopen early: ${reopenEarly})`,async()=>{
 let finish,generated=false;
 const review={id:'old-review',kind:'quiz-review',state:'done',result:{quiz_id:oldQuiz.id,question_id:'q1',verdict:'right'}};
 const generation={id:'new-generation',kind:'quiz',state:'done'};
 const h=await harness(async(path,body)=>{
  if(body?.action==='review')return {task:review};
  if(body)return new Promise(resolve=>{finish=resolve;});
  if(path.includes('task=new-generation')){generated=true;return {...listing(newQuiz),task:generation};}
  if(path.includes('task=old-review'))return {...listing(oldQuiz),task:review};
  return listing(oldQuiz);
 });
 try{
  await h.controller.open();h.actions().shortAnswer('My answer.');await h.actions().review();
  const pending=h.actions().generate(true);h.controller.close();if(reopenEarly)await h.controller.open();
  finish({task:generation});await pending;if(!reopenEarly)await h.controller.open();
  assert.equal(generated,true,'reopening must poll the accepted generation rather than the prior review');
  assert.equal(h.get().quiz.id,newQuiz.id);
 }finally{h.controller.destroy();}
});

test('an earlier reopening listing cannot overwrite a newly accepted generation',async()=>{
 let finish,listingRead,reads=0;
 const task={id:'generation',kind:'quiz',state:'done'};
 const h=await harness(async(path,body)=>{
  if(body)return new Promise(resolve=>{finish=resolve;});
  if(path.includes('task=generation'))return {...listing(newQuiz),task};
  if(reads++)return new Promise(resolve=>{listingRead=resolve;});
  return listing(oldQuiz);
 });
 try{
  await h.controller.open();const pending=h.actions().generate(true);h.controller.close();
  const reopening=h.controller.open();finish({task});await pending;
  listingRead(listing(oldQuiz));await reopening;
  assert.equal(h.get().quiz.id,newQuiz.id,'acceptance supersedes the older listing response');
 }finally{h.controller.destroy();}
});

test('a cached generation response clears a reopening loading state',async()=>{
 let finish,listingRead,reads=0;
 const h=await harness(async(path,body)=>{
  if(body)return new Promise(resolve=>{finish=resolve;});
  if(reads++)return new Promise(resolve=>{listingRead=resolve;});
  return listing(oldQuiz);
 });
 try{
  await h.controller.open();const pending=h.actions().generate();h.controller.close();
  const reopening=h.controller.open();finish({quiz:newQuiz});await pending;
  listingRead(listing(oldQuiz));await reopening;
  assert.equal(h.get().quiz.id,newQuiz.id);assert.equal(h.get().loading,false);assert.equal(h.get().busy,false);
 }finally{h.controller.destroy();}
});
