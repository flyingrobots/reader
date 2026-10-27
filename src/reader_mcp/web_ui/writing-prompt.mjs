/** A generated question opens an ordinary Scratch draft; drafts never enter generation requests. */
export function installWritingPrompts({api,document:currentDocument,participant,mount,write,showEvidence,mode,toast,available}){
  const empty=()=>({open:false,loading:false,busy:false,error:'',prompt:null,task:null,voice:'',voices:[]});
  let state=empty(),context=null,sequence=0,timer;const listeners=new Set();
  const getSnapshot=()=>state,subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
  function update(patch){const was=state.open;state={...state,...patch};if(was!==state.open)mode(state.open);for(const fn of listeners)fn();}
  function close(){sequence++;clearTimeout(timer);update({open:false});}
  function fail(error,token){if(token===sequence)update({loading:false,busy:false,error:error.message||String(error)});}
  async function load(token,taskId){
    const query=new URLSearchParams({path:context.path,participant:context.participant});
    if(state.voice)query.set('voice',state.voice);if(taskId)query.set('task',taskId);
    const data=await api('/api/prompt?'+query);if(token!==sequence||!state.open)return;
    const task=data.task;update({loading:false,prompt:data.prompt,voices:(data.voices||[]).filter(v=>v.runnable),voice:data.default_voice||'',task});
    if(task&&!['done','failed','timeout','cancelled'].includes(task.state)){
      update({busy:true});timer=setTimeout(()=>load(token,task.id).catch(error=>fail(error,token)),650);
    }else update({busy:false,error:task&&task.state!=='done'?task.error||'The question could not be generated.':''});
  }
  async function open(){
    const unavailable=available();if(unavailable){toast(unavailable);return;}
    const doc=currentDocument();if(!doc||doc.preview||doc.historical||!['.md','.markdown','.txt'].includes(doc.kind)){toast('Open a current text article to write about it.');return;}
    const identity=JSON.stringify([doc.path,doc.sha256,participant()]);
    if(context?.identity!==identity){state=empty();context={identity,path:doc.path,participant:participant()};}
    const token=++sequence;clearTimeout(timer);update({open:true,loading:true,error:''});
    try{await load(token);}catch(error){fail(error,token);}
  }
  async function generate(regenerate=false){
    if(state.busy)return;const token=++sequence;clearTimeout(timer);update({busy:true,error:''});
    try{
      const data=await api('/api/prompt',{action:'generate',path:context.path,participant:context.participant,voice:state.voice||undefined,request_id:crypto.randomUUID(),regenerate});
      if(token!==sequence)return;
      if(data.prompt){update({prompt:data.prompt,busy:false,task:null});return;}
      update({task:data.task});await load(token,data.task.id);
    }catch(error){fail(error,token);}
  }
  const actions={close,generate,voice:async voice=>{const token=++sequence;clearTimeout(timer);update({voice,loading:true,prompt:null,error:''});try{await load(token);}catch(error){fail(error,token);}},
    write:async()=>{const prompt=state.prompt;close();try{await write(prompt);}catch(error){toast(error.message||String(error));}},
    evidence:()=>{const anchor=state.prompt?.evidence;if(anchor){close();requestAnimationFrame(()=>showEvidence(anchor));}}};
  const island=mount({getSnapshot,subscribe,actions});return {open,close,destroy(){close();island.destroy();listeners.clear();}};
}
