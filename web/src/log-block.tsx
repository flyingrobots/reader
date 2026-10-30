/* Raw text (CLI events, stderr, prompts, tool output) in the shadcn Code Block: small, wrapped,
   with a floating copy button that toasts through notify() (it writes the same text the
   component's button writes, to learn whether the clipboard accepted it). */
import type {ReactNode} from 'react';
import {CodeBlock, CodeBlockActions, CodeBlockCopyButton, CodeBlockContent, CodeBlockHeader, CodeBlockTitle} from './components/ui/code-block';
import {notify} from './notify';

export function LogBlock({text,title,className,contentClassName,destructive=false,children,...props}:{text:string;title?:ReactNode;className?:string;contentClassName?:string;destructive?:boolean;children?:ReactNode}&Record<`data-${string}`,string>){
  const copy=<CodeBlockActions><CodeBlockCopyButton value={text} onClick={()=>{navigator.clipboard?.writeText(text).then(()=>notify('Copied to the clipboard.','success'),()=>notify('Couldn’t copy: the browser refused clipboard access.','error'));}}/></CodeBlockActions>;
  return <CodeBlock size="sm" variant={destructive?'destructive':'default'} className={className} data-log-block="" {...props}>
    {title?<CodeBlockHeader><CodeBlockTitle>{title}</CodeBlockTitle>{copy}</CodeBlockHeader>:copy}
    <CodeBlockContent wrap className={contentClassName}>{children??text}</CodeBlockContent>
  </CodeBlock>;
}
