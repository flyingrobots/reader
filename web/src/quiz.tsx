import {useSyncExternalStore} from 'react';
import {ChevronRightIcon} from 'lucide-react';
import {CodeBlock, CodeBlockContent} from './components/ui/code-block';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from './components/ui/collapsible';
import {Notice} from './theme/molecules/notice';
import {LoadingState} from './theme/molecules/states';
import {createRoot} from 'react-dom/client';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from './components/ui/dialog';
import {RadioGroup,RadioGroupItem} from './components/ui/radio-group';
import {Button} from './components/ui/button';
import {Select,SelectContent,SelectGroup,SelectItem,SelectTrigger,SelectValue} from './components/ui/select';
import {Field,FieldGroup,FieldLabel,FieldSet,FieldLegend} from './components/ui/field';
import {Textarea} from './components/ui/textarea';
import {Skeleton} from './components/ui/skeleton';
import {Badge} from './components/ui/badge';

type Evidence={quote:string;start:number;end:number;source_sha256:string};
type Question={id:string;type:'choice'|'short';prompt:string;options?:string[];answer?:number;explanation?:string;rubric?:string;evidence:Evidence};
type Review={review_id:string;verdict:'right'|'partly'|'not yet';comment:string};
type Task={kind:string;state:string;attempts:number;error?:string;rejected?:unknown[];changed_paths?:string[];runs?:{log:string}[];commit?:{status:string;error?:string};pending?:{message:string}[]};
type Model={open:boolean;loading:boolean;busy:boolean;error:string;quiz:null|{id:string;author:string;earlier:boolean;hidden:unknown[];questions:Question[]};task:Task|null;
  voices:{name:string}[];voice:string;index:number;answers:Record<string,number>;short:Record<string,string>;reviews:Record<string,Review>;result:null|{score:number;total:number;missed:string[]}};
type Actions={close():void;generate(regenerate?:boolean):void;choose(value:string):void;shortAnswer(value:string):void;review():void;next():void;evidence(q:Question):void;
  voice(value:string):void;back():void;retake():void};
type Options={getSnapshot():Model;subscribe(listener:()=>void):()=>void;actions:Actions};

function QuizDialog({getSnapshot,subscribe,actions}:Options){
  const model=useSyncExternalStore(subscribe,getSnapshot),quiz=model.quiz,question=quiz?.questions[model.index];
  const selected=question?model.answers[question.id]:undefined,review=question?model.reviews[question.id]:undefined;
  const answered=question?.type==='choice'?selected!==undefined:!!review;
  const status=model.task?.pending?.[0]?.message||model.task?.state;
  const disabled=model.busy||model.loading;
  return <Dialog open={model.open} onOpenChange={open=>{if(!open)actions.close();}}
    onOpenChangeComplete={open=>{if(!open&&!getSnapshot().open)document.querySelector<HTMLElement>('#main')?.focus({preventScroll:true});}}>
    {/* Base UI resolves a container return target to its first tabbable child. Reader's
        keyboard cursor belongs on main itself; the root's completion callback restores it. */}
    <DialogContent className="reader-quiz-dialog" data-reader-quiz="" finalFocus={false} onKeyDown={event=>event.stopPropagation()}>
      <DialogHeader><DialogTitle>Test yourself</DialogTitle><DialogDescription>Questions by a library voice, with the passages behind its answers.</DialogDescription></DialogHeader>
      {model.loading?<div className="flex flex-col gap-3" aria-label="Loading quiz"><Skeleton className="h-6 w-3/4"/><Skeleton className="h-24 w-full"/></div>:<>
        <FieldGroup><Field><FieldLabel htmlFor="quiz-voice">Quiz voice</FieldLabel><Select value={model.voice||null} onValueChange={value=>{if(value)actions.voice(value);}} disabled={disabled||!model.voices.length}>
          <SelectTrigger id="quiz-voice"><SelectValue placeholder="Choose a voice"/></SelectTrigger><SelectContent><SelectGroup>{model.voices.map(v=><SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}</SelectGroup></SelectContent>
        </Select></Field></FieldGroup>
        {!model.voices.length&&<Notice title="Configure an enabled voice in Reader to generate questions.">Saved quizzes remain available.</Notice>}
        {model.busy&&<LoadingState>{status||'Working…'}{model.task?.attempts?` · attempt ${model.task.attempts}`:''}</LoadingState>}
        {model.error&&<Notice tone="error" role="alert" title={model.error}/>}
        {quiz?.earlier&&<Notice title="From an earlier edition">{quiz.hidden.length} unavailable {quiz.hidden.length===1?'question':'questions'} hidden. Remaining passages were located in this edition.</Notice>}
        {!quiz?<Button disabled={disabled||!model.voices.length} onClick={()=>actions.generate()}>Generate a quiz</Button>:model.result?<>
          <div className="flex flex-col gap-1" role="status" data-quiz-score=""><span className="font-serif text-4xl tabular-nums">{model.result.score} of {model.result.total}</span>
          <span className="text-sm text-muted-foreground">{model.result.missed.length?'Revisit these questions and their evidence:':'You matched every answer in this quiz.'}</span></div>
          <ul className="flex flex-col gap-2">{quiz.questions.filter(q=>model.result!.missed.includes(q.id)).map(q=><li key={q.id}><Button variant="link" onClick={()=>actions.evidence(q)}>{q.prompt}</Button></li>)}</ul>
          <Button variant="outline" onClick={actions.retake}>Retake the same quiz</Button>
        </>:question?<>
          <span className="text-sm text-muted-foreground" data-quiz-progress="">Question {model.index+1} of {quiz.questions.length}{question.type==='short'?' · optional short answer':''}</span>
          <FieldGroup><FieldSet><FieldLegend>{question.prompt}</FieldLegend>
            {question.type==='choice'?<RadioGroup aria-label={question.prompt} value={selected===undefined?null:String(selected)} onValueChange={value=>actions.choose(String(value))} disabled={answered||disabled}>
              {question.options!.map((option,index)=><Field key={index} orientation="horizontal"><RadioGroupItem id={'quiz-option-'+index} value={String(index)}/><FieldLabel htmlFor={'quiz-option-'+index}>{option}</FieldLabel></Field>)}
            </RadioGroup>:<Field><FieldLabel htmlFor="quiz-short">Your answer</FieldLabel><Textarea id="quiz-short" maxLength={16000} rows={4} value={model.short[question.id]||''} disabled={disabled||!!review} onChange={event=>actions.shortAnswer(event.target.value)}/></Field>}
          </FieldSet></FieldGroup>
          {question.type==='short'&&!review&&<Button variant="outline" disabled={disabled||!model.short[question.id]?.trim()||!model.voice} onClick={actions.review}>Ask for a review</Button>}
          {answered&&(question.type==='choice'?<Notice role="status" data-quiz-feedback="" tone={selected===question.answer?'info':'error'} title={selected===question.answer?'Correct.':'The saved answer is '+question.options![question.answer!]+'.'}>{question.explanation}</Notice>
            :<Notice role="status" data-quiz-feedback="" tone={review!.verdict==='right'?'info':review!.verdict==='partly'?'info':'error'} title={review!.verdict==='right'?'Right':review!.verdict==='partly'?'Partly':'Not yet'}>{review!.comment}</Notice>)}
          <Button variant="link" disabled={question.type==='choice'&&!answered} onClick={()=>actions.evidence(question)}>Show me in the text</Button>
          <DialogFooter><Button variant="outline" disabled={disabled||model.index===0} onClick={actions.back}>Previous</Button><Button disabled={disabled||question.type==='choice'&&!answered} onClick={actions.next}>{model.index+1===quiz.questions.length?'Save results':question.type==='short'&&!review?'Skip optional question':'Next question'}</Button></DialogFooter>
        </>:<Notice title="None of the saved questions can be located in this edition.">Generate a new quiz.</Notice>}
        {quiz&&<Button variant="ghost" disabled={disabled||!model.voices.length} onClick={()=>actions.generate(true)}>Generate a new quiz</Button>}
        {model.task&&(model.task.rejected?.length||model.task.changed_paths?.length||model.task.commit?.status==='failed')?<Collapsible data-quiz-task-details=""><CollapsibleTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground"/>}><ChevronRightIcon data-icon="inline-start" aria-hidden className="transition-transform in-data-[panel-open]:rotate-90"/>Task details</CollapsibleTrigger>
          <CollapsibleContent><CodeBlock size="sm"><CodeBlockContent wrap className="max-h-64">{JSON.stringify({rejected:model.task.rejected,changed_paths:model.task.changed_paths,commit:model.task.commit,runs:model.task.runs},null,2)}</CodeBlockContent></CodeBlock></CollapsibleContent></Collapsible>:null}
      </>}
    </DialogContent>
  </Dialog>;
}

export function mountQuiz(options:Options){
  const element=document.createElement('div');element.dataset.readerDecoration='';document.body.append(element);
  const root=createRoot(element);root.render(<QuizDialog {...options}/>);
  return {destroy(){root.unmount();element.remove();}};
}
