/** Article quizzes: edition-bound controller; the UI is a shadcn/Base UI island. */
export function installQuiz({api,document:currentDocument,participant:currentParticipant,mount,showEvidence,changed,mode,available,toast}){
  const empty=()=>({open:false,loading:false,busy:false,error:'',quiz:null,task:null,voices:[],voice:'',difficulty:3,setup:false,index:0,answers:{},short:{},reviews:{},result:null});
  let state=empty(),context=null,sequence=0,submission=0,timer=null;const listeners=new Set();
  const getSnapshot=()=>state,subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
  function update(patch){const before=state.open;state={...state,...patch};if(before!==state.open)mode?.(state.open);for(const listener of listeners)listener();}
  const params=()=>new URLSearchParams({path:context.path,participant:context.participant});
  function post(request){return api('/api/quiz',{...request,path:context.path,participant:context.participant});}
  function resetQuestions(quiz){return {quiz,setup:false,index:0,answers:{},short:{},reviews:{},result:null,task:null};}
  function close(){sequence++;clearTimeout(timer);update({open:false,loading:false,busy:false});}
  function adopt(data){
    const voices=(data.voices||[]).filter(v=>v.runnable);
    // Another tab can regenerate while this participant awaits a short-answer
    // review. That result belongs to the question set being answered.
    const quiz=data.task?.kind==='quiz-review'&&state.quiz?state.quiz:data.quiz;
    const patch={voices,loading:false};
    if(!state.voice||!voices.some(v=>v.name===state.voice))patch.voice=data.default_voice||voices[0]?.name||'';
    if(quiz&&quiz.id!==state.quiz?.id)Object.assign(patch,resetQuestions(quiz));
    else if(quiz)patch.quiz=quiz;
    update(patch);
  }
  async function load(taskId=null,token=sequence){
    const query=params();if(taskId)query.set('task',taskId);
    const data=await api('/api/quiz?'+query);if(token!==sequence||!state.open)return;
    adopt(data);
    if(data.task){
      const task=data.task;update({task});
      if(['done','failed','cancelled','timeout'].includes(task.state)){
        update({busy:false,error:task.state==='done'?'':task.error||'The quiz task did not finish.'});
        if(task.state==='done'&&task.kind==='quiz-review'){
          const review=task.result;
          if(review.quiz_id!==state.quiz?.id){update({error:'This review belongs to another quiz. Reopen the quiz to continue.'});return;}
          update({reviews:{...state.reviews,[review.question_id]:{...review,review_id:task.id}}});
        }
        if(task.commit?.status==='failed')toast('The quiz was saved, but its commit failed. See task details.');
        return;
      }
      update({busy:true});timer=setTimeout(()=>load(task.id,token).catch(error=>failure(error,token)),650);
    }
  }
  function failure(error,token=sequence){if(token===sequence)update({loading:false,busy:false,error:error.message||String(error)});}
  async function acceptResponse(data,owner,request){
    // Accepted work survives closing. A different context or newer submission
    // supersedes it, and its acceptance invalidates earlier listing requests.
    if(owner!==context||request!==submission)return;
    const token=++sequence;clearTimeout(timer);
    if(data.quiz){update({...resetQuestions(data.quiz),busy:false,loading:false});return;}
    update({task:data.task});
    if(state.open)try{await load(data.task.id,token);}catch(error){failure(error,token);}
  }
  async function open(){
    const unavailable=available?.();if(unavailable){toast(unavailable);return;}
    const doc=currentDocument(),participant=currentParticipant();
    if(!doc||doc.preview||doc.historical||!['.md','.markdown','.txt'].includes(doc.kind)){
      toast('Open a current Markdown or plain-text article to take a quiz.');return;
    }
    const token=++sequence;clearTimeout(timer);
    if(!context||context.path!==doc.path||context.sha256!==doc.sha256||context.participant!==participant){state=empty();context={path:doc.path,sha256:doc.sha256,participant};}
    update({open:true,loading:true,error:''});
    try{await load(state.task?.id,token);}catch(error){failure(error,token);}
  }
  async function generate(regenerate=false){
    if(state.busy)return;const token=++sequence,owner=context,request=++submission;clearTimeout(timer);update({busy:true,error:'',result:null});
    try{
      const data=await post({action:'generate',voice:state.voice||undefined,difficulty:state.difficulty,request_id:crypto.randomUUID(),regenerate});
      await acceptResponse(data,owner,request);
    }catch(error){failure(error,token);}
  }
  function choose(value){
    const question=state.quiz?.questions[state.index];if(!question||question.type!=='choice'||question.id in state.answers)return;
    update({answers:{...state.answers,[question.id]:Number(value)}});
  }
  function shortAnswer(value){const question=state.quiz?.questions[state.index];if(question)update({short:{...state.short,[question.id]:value}});}
  async function review(){
    const quiz=state.quiz,question=quiz?.questions[state.index];if(!question||state.busy)return;
    const token=++sequence,owner=context,request=++submission;update({busy:true,error:''});
    try{
      const data=await post({action:'review',voice:state.voice||quiz.author,request_id:crypto.randomUUID(),edition:quiz.document_sha256,
        quiz_id:quiz.id,question_id:question.id,answer:state.short[question.id]||''});
      await acceptResponse(data,owner,request);
    }catch(error){failure(error,token);}
  }
  async function next(){
    if(state.busy)return;
    if(state.index+1<state.quiz.questions.length){update({index:state.index+1,error:''});return;}
    update({busy:true,error:''});const token=sequence;
    try{
      const result=await post({action:'result',edition:state.quiz.document_sha256,quiz_id:state.quiz.id,
        expected_sha256:context.sha256,answers:state.answers,reviews:Object.fromEntries(Object.entries(state.reviews).map(([id,r])=>[id,r.review_id]))});
      if(token!==sequence)return;update({result,busy:false});changed();
    }catch(error){failure(error,token);}
  }
  function evidence(question){const anchor=question.evidence;close();requestAnimationFrame(()=>showEvidence(anchor));}
  const actions={close,generate,choose,shortAnswer,review,next,evidence,
    voice:value=>update({voice:value}),difficulty:value=>update({difficulty:value}),setup:value=>update({setup:value,error:''}),back:()=>update({index:Math.max(0,state.index-1)}),go:index=>{if(!state.busy&&state.quiz&&index>=0&&index<state.quiz.questions.length)update({index,error:''});},retake:()=>update(resetQuestions(state.quiz))};
  const island=mount({getSnapshot,subscribe,actions});
  return {open,close,isOpen:()=>state.open,destroy(){close();island.destroy();listeners.clear();}};
}
