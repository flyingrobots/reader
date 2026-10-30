import {useSyncExternalStore} from 'react';
import {CheckIcon,XIcon} from 'lucide-react';
import {createRoot} from 'react-dom/client';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from './components/ui/dialog';
import {Button} from './components/ui/button';
import {Select,SelectContent,SelectGroup,SelectItem,SelectTrigger,SelectValue} from './components/ui/select';
import {Field,FieldGroup,FieldLabel} from './components/ui/field';
import {Questionnaire,QuestionnaireActions,QuestionnaireChoice,QuestionnaireChoices,QuestionnaireError,QuestionnaireItem,QuestionnaireNext,QuestionnairePrevious,QuestionnaireProgress,QuestionnaireSkip,QuestionnaireSubmit,QuestionnaireTitle} from './components/ui/questionnaire';
import {Textarea} from './components/ui/textarea';
import {Skeleton} from './components/ui/skeleton';
import {Badge} from './components/ui/badge';
import {Progress} from './components/ui/progress';
import {Slider} from './components/ui/slider';

type Evidence={quote:string;start:number;end:number;source_sha256:string};
type Question={id:string;type:'choice'|'short';prompt:string;options?:string[];answer?:number;explanation?:string;rubric?:string;evidence:Evidence};
type Review={review_id:string;verdict:'right'|'partly'|'not yet';comment:string};
type Task={kind:string;state:string;attempts:number;error?:string;rejected?:unknown[];changed_paths?:string[];runs?:{log:string}[];commit?:{status:string;error?:string};pending?:{message:string}[]};
type Model={open:boolean;loading:boolean;busy:boolean;error:string;quiz:null|{id:string;author:string;difficulty?:number;earlier:boolean;hidden:unknown[];questions:Question[]};task:Task|null;
  voices:{name:string}[];voice:string;difficulty:number;setup:boolean;index:number;answers:Record<string,number>;short:Record<string,string>;reviews:Record<string,Review>;result:null|{score:number;total:number;missed:string[]}};
type Actions={close():void;generate(regenerate?:boolean):void;choose(value:string):void;shortAnswer(value:string):void;review():void;next():void;evidence(q:Question):void;
  voice(value:string):void;difficulty(value:number):void;setup(value:boolean):void;back():void;go(index:number):void;retake():void};
type Options={getSnapshot():Model;subscribe(listener:()=>void):()=>void;actions:Actions};

const LEVELS=['Recall','Understand','Connect','Analyze','Challenge'];
const HINTS=['Facts stated plainly in one sentence.','What a passage means, in other words.','How nearby ideas and the argument fit together.',
  'Implications, assumptions and tradeoffs.','Near-miss options and the limits of a claim.'];

// Root.items gives the choice shortcuts (A, B, …) a stable order per question.
const items=(questions:Question[])=>questions.map(q=>({name:q.id,required:q.type==='choice',choices:q.options?.map((_,index)=>({value:String(index)}))}));

function QuizDialog({getSnapshot,subscribe,actions}:Options){
  const model=useSyncExternalStore(subscribe,getSnapshot),quiz=model.quiz,question=quiz?.questions[model.index];
  const selected=question?model.answers[question.id]:undefined,review=question?model.reviews[question.id]:undefined;
  const answered=question?.type==='choice'?selected!==undefined:!!review;
  const status=model.task?.pending?.[0]?.message||model.task?.state;
  const disabled=model.busy||model.loading;
  // Running score, counted as the server counts the result: a partly right short answer is half a point.
  const running=quiz?quiz.questions.reduce((sum,q)=>q.type==='choice'?(q.id in model.answers?{graded:sum.graded+1,correct:sum.correct+(model.answers[q.id]===q.answer?1:0)}:sum)
    :model.reviews[q.id]?{graded:sum.graded+1,correct:sum.correct+({right:1,partly:.5,'not yet':0}[model.reviews[q.id].verdict])}:sum,{graded:0,correct:0}):{graded:0,correct:0};
  return <Dialog open={model.open} onOpenChange={open=>{if(!open)actions.close();}}
    onOpenChangeComplete={open=>{if(!open&&!getSnapshot().open)document.querySelector<HTMLElement>('#main')?.focus({preventScroll:true});}}>
    {/* Base UI resolves a container return target to its first tabbable child. Reader's
        keyboard cursor belongs on main itself; the root's completion callback restores it. */}
    <DialogContent className="reader-quiz-dialog" data-reader-quiz="" finalFocus={false} onKeyDown={event=>event.stopPropagation()}>
      <DialogHeader><DialogTitle>Test yourself</DialogTitle><DialogDescription>Questions by a library voice, with the passages behind its answers.</DialogDescription></DialogHeader>
      {model.loading?<div className="flex flex-col gap-3" aria-label="Loading quiz"><Skeleton className="h-6 w-3/4"/><Skeleton className="h-24 w-full"/></div>:<>
        {quiz&&!model.setup&&<p className="text-muted-foreground">Quiz by {quiz.author}{quiz.difficulty?` · ${LEVELS[quiz.difficulty-1]}`:''}</p>}
        {(!quiz||model.setup)&&<FieldGroup>
          <Field><FieldLabel htmlFor="quiz-voice">Quiz voice</FieldLabel><Select value={model.voice||null} onValueChange={value=>{if(value)actions.voice(value);}} disabled={disabled||!model.voices.length}>
            <SelectTrigger id="quiz-voice"><SelectValue placeholder="Choose a voice"/></SelectTrigger><SelectContent><SelectGroup>{model.voices.map(v=><SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}</SelectGroup></SelectContent>
          </Select></Field>
          <Field><div className="flex items-baseline justify-between gap-2"><FieldLabel id="quiz-difficulty-label">Difficulty</FieldLabel><span className="text-sm font-medium tabular-nums">{model.difficulty} · {LEVELS[model.difficulty-1]}</span></div>
            <Slider aria-labelledby="quiz-difficulty-label" min={1} max={5} step={1} value={[model.difficulty]} disabled={disabled}
              onValueChange={value=>actions.difficulty(Array.isArray(value)?value[0]:value)}/>
            <p className="text-muted-foreground text-sm">{HINTS[model.difficulty-1]}</p></Field>
        </FieldGroup>}
        {model.busy&&<p role="status">{status||'Working…'}{model.task?.attempts?` · attempt ${model.task.attempts}`:''}</p>}
        {model.error&&<p role="alert" className="text-destructive">{model.error}</p>}
        {quiz?.earlier&&<p><Badge variant="secondary">Earlier edition</Badge> {quiz.hidden.length} unavailable {quiz.hidden.length===1?'question':'questions'} hidden. Remaining passages were located in this edition.</p>}
        {!quiz||model.setup?<div className="flex flex-wrap gap-2"><Button disabled={disabled||!model.voices.length} onClick={()=>actions.generate(!!quiz)}>Generate a quiz</Button>
          {quiz&&!model.busy&&<Button variant="ghost" onClick={()=>actions.setup(false)}>Back to the current quiz</Button>}</div>:model.result?<>
          <p className="text-muted-foreground">Your score</p><div className="reader-quiz-score" role="status">{model.result.score} of {model.result.total}</div>
          <p>{model.result.missed.length?'Revisit these questions and their evidence:':'You matched every answer in this quiz.'}</p>
          <ul className="flex flex-col gap-2">{quiz.questions.filter(q=>model.result!.missed.includes(q.id)).map(q=><li key={q.id}><Button variant="link" onClick={()=>actions.evidence(q)}>{q.prompt}</Button></li>)}</ul>
          <Button variant="outline" onClick={actions.retake}>Retake the same quiz</Button>
        </>:question?<Questionnaire item={question.id} items={items(quiz.questions)} shortcuts="letters"
          onItemChange={name=>actions.go(quiz.questions.findIndex(q=>q.id===name))}
          onSubmit={event=>{event.preventDefault();if(model.index+1===quiz.questions.length)actions.next();}}>
          {/* The quiz model owns the position: item follows model.index, and the buttons call the
              model's actions instead of the primitive's navigation (preventDefault), so a short
              answer counts as done once reviewed. Keyboard navigation arrives through onItemChange. */}
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <QuestionnaireProgress render={(props,state)=><p {...props} className="text-muted-foreground">Question {state.current} of {state.total}{question.type==='short'?' · optional short answer':''}</p>}/>
            {running.graded>0&&<p className="reader-quiz-running">Score <strong>{running.correct}</strong> of {running.graded}</p>}
          </div>
          {/* The visual bar; the Questionnaire progress above carries the progressbar role and live text. */}
          <Progress aria-hidden="true" className="reader-quiz-bar" value={(model.index+1)/quiz.questions.length*100}/>
          {quiz.questions.map(q=><QuestionnaireItem key={q.id} name={q.id} required={q.type==='choice'}>
            <QuestionnaireTitle>{q.prompt}</QuestionnaireTitle>
            {q.type==='choice'?<><QuestionnaireChoices>{q.options!.map((option,index)=>{const graded=q.id in model.answers,result=!graded?undefined:index===q.answer?'correct':model.answers[q.id]===index?'chosen-wrong':'wrong';
              return <QuestionnaireChoice key={index} value={String(index)} data-quiz-result={result}
                checked={model.answers[q.id]===index} disabled={graded||disabled} onChange={()=>actions.choose(String(index))}>
                <span className="reader-quiz-option">{option}</span>
                {result==='correct'?<span className="reader-quiz-mark"><CheckIcon aria-hidden="true"/>Correct answer</span>:result==='chosen-wrong'?<span className="reader-quiz-mark"><XIcon aria-hidden="true"/>Your answer</span>:null}
              </QuestionnaireChoice>;})}</QuestionnaireChoices><QuestionnaireError/></>
            :<Field><FieldLabel htmlFor={'quiz-short-'+q.id}>Your answer</FieldLabel><Textarea id={'quiz-short-'+q.id} maxLength={16000} rows={4} value={model.short[q.id]||''} disabled={disabled||!!model.reviews[q.id]} onChange={event=>actions.shortAnswer(event.target.value)}/></Field>}
          </QuestionnaireItem>)}
          {question.type==='short'&&!review&&<Button type="button" variant="outline" disabled={disabled||!model.short[question.id]?.trim()||!model.voice} onClick={actions.review}>Ask for a review</Button>}
          {answered&&<div className="reader-quiz-feedback" role="status">{question.type==='choice'?<><strong>{selected===question.answer?'Correct.':'The saved answer is '+question.options![question.answer!]+'.'}</strong>{question.explanation&&<p><span className="reader-quiz-why">Why: </span>{question.explanation}</p>}</>:<><strong>{review!.verdict==='right'?'Right':review!.verdict==='partly'?'Partly':'Not yet'}</strong><p>{review!.comment}</p></>}</div>}
          <Button type="button" variant="link" disabled={question.type==='choice'&&!answered} onClick={()=>actions.evidence(question)}>Show me in the text</Button>
          <DialogFooter><QuestionnaireActions>
            <QuestionnairePrevious disabled={disabled} onClick={event=>{event.preventDefault();actions.back();}}/>
            {model.index+1===quiz.questions.length?<QuestionnaireSubmit disabled={disabled||question.type==='choice'&&!answered} onClick={event=>{event.preventDefault();actions.next();}}>Save results</QuestionnaireSubmit>
            :question.type==='short'&&!review?<QuestionnaireSkip disabled={disabled} onClick={event=>{event.preventDefault();actions.next();}}>Skip optional question</QuestionnaireSkip>
            :<QuestionnaireNext disabled={disabled||question.type==='choice'&&!answered} onClick={event=>{event.preventDefault();actions.next();}}>Next question</QuestionnaireNext>}
          </QuestionnaireActions></DialogFooter>
        </Questionnaire>:<p>None of the saved questions can be located in this edition. Generate a new quiz.</p>}
        {quiz&&!model.setup&&<Button variant="ghost" disabled={disabled} onClick={()=>actions.setup(true)}>Generate a new quiz</Button>}
        {model.task&&(model.task.rejected?.length||model.task.changed_paths?.length||model.task.commit?.status==='failed')?<details><summary>Task details</summary>
          <pre className="reader-quiz-task-details">{JSON.stringify({rejected:model.task.rejected,changed_paths:model.task.changed_paths,commit:model.task.commit,runs:model.task.runs},null,2)}</pre></details>:null}
      </>}
    </DialogContent>
  </Dialog>;
}

export function mountQuiz(options:Options){
  const element=document.createElement('div');element.dataset.readerDecoration='';document.body.append(element);
  const root=createRoot(element);root.render(<QuizDialog {...options}/>);
  return {destroy(){root.unmount();element.remove();}};
}
