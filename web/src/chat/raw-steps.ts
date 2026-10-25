/* Turn a voice CLI's raw stdout lines into a readable step list: reply text collapsed per step,
   tool calls with their parameters and output or error, session and result summaries.
   Understands agy stream-json, Claude Code stream-json and Codex exec --json; anything else is shown as is. */
export type RawStep={key:string;kind:'text'|'tool'|'result'|'session'|'event'|'line';label:string;state?:string;detail?:string;body?:string;error?:string;seconds?:number};

const clip=(text:string,max=4000)=>text.length>max?text.slice(0,max)+`… [${text.length-max} more characters]`:text;
const compact=(value:unknown)=>{try{return JSON.stringify(value);}catch{return String(value);}};
const tokens=(usage:any)=>usage&&typeof usage==='object'?[usage.total_tokens!=null?`${usage.total_tokens} tokens`:null,usage.input_tokens!=null?`${usage.input_tokens} in`:null,usage.output_tokens!=null?`${usage.output_tokens} out`:null].filter(Boolean).join(', '):'';

export function rawSteps(lines:string[]):RawStep[]{
  const steps:RawStep[]=[],byKey=new Map<string,RawStep>();
  let claudeText:RawStep|null=null,serial=0;
  const add=(step:Omit<RawStep,'key'>&{key?:string})=>{const full={...step,key:step.key||`n${serial++}`} as RawStep;steps.push(full);byKey.set(full.key,full);return full;};
  const keyed=(key:string,make:()=>Omit<RawStep,'key'>)=>byKey.get(key)||add({...make(),key});
  for(const line of lines){
    if(!line.trim())continue;
    let event:any;try{event=JSON.parse(line);}catch{event=undefined;}
    if(!event||typeof event!=='object'||Array.isArray(event)){add({kind:'line',label:clip(line,600)});continue;}
    // agy stream-json
    if(typeof event.event==='string'&&!('type' in event)){
      if(event.event==='init'){const init=event.init||{};add({kind:'session',label:'Session started',detail:[init.cwd,Array.isArray(init.tools)?`${init.tools.length} tools`:null,init.permission_mode].filter(Boolean).join(' · ')});continue;}
      if(event.event==='step_update'){const s=event.step_update||{},index=s.step_index;
        if(s.step_type==='agent_response'){const step=keyed('agy-text:'+index,()=>({kind:'text',label:'Reply text',body:''}));
          if(typeof s.text_delta==='string')step.body=(step.body||'')+s.text_delta;
          step.state=s.state;if(s.duration_seconds!=null)step.seconds=s.duration_seconds;if(s.usage)step.detail=tokens(s.usage);continue;}
        if(s.step_type==='tool'){const info=s.tool_info||{},step=keyed('agy-tool:'+index,()=>({kind:'tool',label:s.tool_name||info.name||'tool'}));
          step.state=s.state;if(info.parameters)step.detail=compact(info.parameters);
          if(typeof info.output==='string')step.body=clip(info.output);if(info.error)step.error=[info.error.type,info.error.message].filter(Boolean).join(': ');
          if(s.duration_seconds!=null)step.seconds=s.duration_seconds;continue;}
        if(s.step_type==='user_input')continue;
        add({kind:'event',label:`${s.step_type||'step'} ${s.state||''}`.trim(),detail:compact(s)});continue;}
      if(event.event==='result'){const r=event.result||{};
        add({kind:'result',label:`Result · ${r.status||'unknown'}`,state:r.status,seconds:r.duration_seconds,
          detail:[r.num_turns!=null?`${r.num_turns} turns`:null,tokens(r.usage),typeof r.response==='string'?`response ${r.response.length} characters`:null].filter(Boolean).join(' · ')});continue;}
      add({kind:'event',label:event.event,detail:clip(compact(event),1200)});continue;}
    const type=event.type;
    // Claude Code stream-json
    if(type==='system'){add({kind:'session',label:event.subtype==='init'?'Session started':`system ${event.subtype||''}`.trim(),detail:[event.model,event.cwd].filter(Boolean).join(' · ')});continue;}
    if(type==='stream_event'){const inner=event.event||{};
      if(inner.type==='content_block_delta'&&inner.delta?.type==='text_delta'){claudeText||=add({kind:'text',label:'Reply text',body:''});claudeText.body+=inner.delta.text||'';}
      else if(inner.type==='message_stop'||inner.type==='content_block_stop')claudeText=null;
      continue;}
    if(type==='assistant'){const content=event.message?.content;
      for(const block of Array.isArray(content)?content:[]){
        if(block?.type==='tool_use')keyed('claude-tool:'+block.id,()=>({kind:'tool',label:block.name||'tool',detail:compact(block.input),state:'ACTIVE'}));
        else if(block?.type==='text'&&!steps.some(s=>s.kind==='text'&&s.body&&block.text&&s.body.trim()===String(block.text).trim()))add({kind:'text',label:'Reply text',body:block.text});
      }continue;}
    if(type==='user'){const content=event.message?.content;
      for(const block of Array.isArray(content)?content:[]){if(block?.type!=='tool_result')continue;
        const step=keyed('claude-tool:'+block.tool_use_id,()=>({kind:'tool',label:'tool result'}));
        const text=typeof block.content==='string'?block.content:Array.isArray(block.content)?block.content.map((c:any)=>c?.text||'').join(''):compact(block.content);
        if(block.is_error){step.error=clip(text,1200);step.state='ERROR';}else{step.body=clip(text);step.state='DONE';}}
      continue;}
    if(type==='result'&&('subtype' in event||'is_error' in event||typeof event.result==='string')){
      add({kind:'result',label:`Result · ${event.is_error?'error':event.subtype||'done'}`,state:event.is_error?'ERROR':'SUCCESS',seconds:event.duration_ms!=null?event.duration_ms/1000:undefined,
        detail:[event.num_turns!=null?`${event.num_turns} turns`:null,event.total_cost_usd!=null?`$${Number(event.total_cost_usd).toFixed(4)}`:null,tokens(event.usage)].filter(Boolean).join(' · ')});continue;}
    // Codex exec --json
    if(type==='thread.started'){add({kind:'session',label:'Session started',detail:event.thread_id});continue;}
    if(type==='item.started'||type==='item.updated'||type==='item.completed'){const item=event.item||{},key='codex:'+(item.id||serial++);
      if(item.type==='agent_message'||item.type==='reasoning'){if(type==='item.completed')add({kind:'text',label:item.type==='reasoning'?'Reasoning':'Reply text',body:item.text||''});continue;}
      const step=keyed(key,()=>({kind:'tool',label:item.type||'item'}));
      step.state=type==='item.completed'?(item.exit_code&&item.exit_code!==0||item.status==='failed'?'ERROR':'DONE'):'ACTIVE';
      if(item.command)step.detail=String(item.command);else if(item.changes)step.detail=compact(item.changes);else if(!step.detail)step.detail=clip(compact(item),600);
      if(typeof item.aggregated_output==='string'&&item.aggregated_output)step.body=clip(item.aggregated_output);
      if(item.exit_code&&item.exit_code!==0)step.error=`exit code ${item.exit_code}`;
      continue;}
    if(type==='turn.completed'){add({kind:'result',label:'Turn completed',state:'SUCCESS',detail:tokens(event.usage)});continue;}
    if(type==='error'||type==='turn.failed'){add({kind:'event',label:type,state:'ERROR',error:clip(String(event.message||event.error?.message||compact(event.error)),1200)});continue;}
    if(type==='turn.started')continue;
    add({kind:'event',label:String(type||'event'),detail:clip(compact(event),1200)});
  }
  return steps;
}

/** One JSON event per line, re-serialized compactly; non-JSON lines as they are. */
export function eventLines(lines:string[]){return lines.filter(l=>l.trim()).map(line=>{try{return JSON.stringify(JSON.parse(line));}catch{return line;}});}
