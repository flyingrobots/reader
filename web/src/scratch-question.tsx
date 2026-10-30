/* The question a Scratch draft answers, shown at the top of the editor pane as a shadcn
   Collapsible so the editor and preview keep the full height. Open by default. */
import {createRoot} from 'react-dom/client';
import {ChevronDownIcon} from 'lucide-react';
import {Button} from './components/ui/button';
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from './components/ui/collapsible';

type Question={author:string;question:string};
function ScratchQuestion({author,question}:Question){
  return <Collapsible defaultOpen className="flex flex-col gap-1">
    <CollapsibleTrigger render={<Button variant="ghost" size="xs" className="w-fit text-muted-foreground"/>}>
      Question from {author}<ChevronDownIcon data-icon="inline-end" className="transition-transform in-data-[panel-open]:rotate-180"/>
    </CollapsibleTrigger>
    <CollapsibleContent><p className="reader-scratch-question">{question}</p></CollapsibleContent>
  </Collapsible>;
}
export function mountScratchQuestion(host:HTMLElement,props:Question){
  const root=createRoot(host);root.render(<ScratchQuestion {...props}/>);
  return {destroy(){root.unmount();}};
}
