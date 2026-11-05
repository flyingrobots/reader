/* The right-hand panels (Discussions, Versions, Lists) as non-modal shadcn Sheets, mounted only while open and driven from
   plain JavaScript: app.mjs, versions.mjs and lists.mjs show and hide a panel through showPanel and hidePanel, and fill its
   body by id. Reading.mjs and dock.mjs see a panel come and go as a child of the body. The Sheet never closes itself:
   Escape, outside clicks and focus stay with the app (a cancelled Base UI close still stops Escape's propagation unless
   allowed), so the page stays interactive and the panels dock beside it on wide screens (dock.mjs; the geometry is in
   styles.css under [data-panel-sheet]). The popup has no dialog role: the aside keeps its own semantics, and
   app.mjs's typing() would otherwise treat every key inside the panel as typing. */
import type {KeyboardEventHandler, ReactNode} from 'react';
import {XIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {ButtonGroup} from '@/components/ui/button-group';
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/components/ui/sheet';

export function PanelSheet({panel,children}:{panel:string;children:ReactNode}){
  return <Sheet open modal={false} onOpenChange={(_next,details)=>{details.cancel();details.allowPropagation();}}>
    <SheetContent side="right" showOverlay={false} showCloseButton={false} role="none" data-panel-sheet={panel} initialFocus={false} finalFocus={false}>{children}</SheetContent>
  </Sheet>;
}
const Close=({id,label,onClick}:{id:string;label:string;onClick:()=>void})=><Button id={id} variant="ghost" size="icon-sm" className="close-button" aria-label={label} onClick={onClick}><XIcon aria-hidden/></Button>;

export type ThreadPanelProps={onClose:()=>void;onQuiz:()=>void;onChat:()=>void;quizBlocked:string|null;onBodyKeys:KeyboardEventHandler};
export function ThreadPanel({onClose,onQuiz,onChat,quizBlocked,onBodyKeys}:ThreadPanelProps){
  return <PanelSheet panel="thread-panel"><aside id="thread-panel" className="thread-panel" aria-labelledby="thread-title">
    <SheetHeader className="thread-top flex-row p-0"><SheetTitle id="thread-title" tabIndex={-1} className="font-serif text-2xl font-normal outline-none">In the margins</SheetTitle>
      <ButtonGroup className="thread-actions">
        <Button id="quiz-open" variant="ghost" size="sm" disabled={!!quizBlocked} title={quizBlocked||'Test yourself · Space x'} onClick={onQuiz}>Quiz</Button>
        <Button id="chat-open" variant="ghost" size="sm" title="Chat with the voices · Space m" onClick={onChat}>Chat</Button>
        <Close id="thread-close" label="Close discussions" onClick={onClose}/>
      </ButtonGroup></SheetHeader>
    <div id="thread-body" onKeyDown={onBodyKeys}/>
  </aside></PanelSheet>;
}
export function VersionsPanel({onClose}:{onClose:()=>void}){
  return <PanelSheet panel="versions-panel"><aside id="versions-panel" className="thread-panel versions-panel" role="dialog" aria-modal="false" aria-labelledby="versions-title" data-reader-decoration="">
    <SheetHeader className="thread-top flex-row p-0"><SheetTitle id="versions-title" className="font-serif text-2xl font-normal">Versions</SheetTitle><Close id="versions-close" label="Close versions" onClick={onClose}/></SheetHeader>
    <div id="versions-body"/>
  </aside></PanelSheet>;
}
export function ListPanel({onClose}:{onClose:()=>void}){
  return <PanelSheet panel="list-panel"><aside id="list-panel" className="thread-panel list-panel" aria-labelledby="list-title">
    <SheetHeader className="thread-top flex-row p-0"><SheetTitle id="list-title" tabIndex={-1} className="font-serif text-2xl font-normal outline-none">Locations</SheetTitle><Close id="list-close" label="Close list" onClick={onClose}/></SheetHeader>
    <div id="list-body"/>
  </aside></PanelSheet>;
}
export type SelectionToolsProps={onAnnotate:(kind:'highlight'|'comment'|'warning')=>void;onSpeak:()=>void};
/** Over a selected passage. Pressing a button must not clear the selection it acts on. */
export function SelectionTools({onAnnotate,onSpeak}:SelectionToolsProps){
  return <div id="selection-tools" className="fixed z-40 flex -translate-x-1/2 -translate-y-full rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10" role="toolbar" aria-label="Selected passage" onMouseDown={event=>event.preventDefault()}>
    <ButtonGroup aria-label="Annotate selection" className="flex-none">
      <Button variant="ghost" size="sm" data-annotate="highlight" onClick={()=>onAnnotate('highlight')}>Highlight</Button>
      <Button variant="ghost" size="sm" data-annotate="comment" onClick={()=>onAnnotate('comment')}>Comment</Button>
      <Button variant="destructive" size="sm" data-annotate="warning" className="warning-action" onClick={()=>onAnnotate('warning')}>Warn</Button>
      <Button variant="ghost" size="sm" id="speak-selection" title="Send the selection to AI-TTS" onClick={onSpeak}>Speak</Button>
    </ButtonGroup>
  </div>;
}
