const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
const doc={path:'library/article.md',kind:'.md',sha256:'current'};
const question={id:'q1',type:'short',prompt:'Explain the original passage.'};
const oldQuiz={id:'old-quiz',author:'Voice',document_sha256:'current',questions:[question]};
const newQuiz={...oldQuiz,id:'new-quiz',questions:[{...question,prompt:'Explain a different passage.'}]};
const listing=quiz=>({quiz,task:null,voices:[{name:'Voice',runnable:true}],default_voice:'Voice'});
async function harness(api){
 const {installQuiz}=await import(pathToFileURL(resolve('src/reader_mcp/web_ui/quiz.mjs')));
 let model;
 const controller=installQuiz({api,document:()=>doc,participant:()=> 'Reader',mount:value=>{model=value;return {destroy(){}};},showEvidence(){},changed(){},mode(){},available:()=>null,toast(){}});
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
