import {ChevronRightIcon, FileIcon, FolderIcon, CheckIcon} from 'lucide-react';
import {Button} from './components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from './components/ui/collapsible';

export type DocumentRow={path?:string;primary?:string;title?:string;metadata?:{title?:string};read?:boolean;excerpt?:string};
type Node={path:string;name:string;children:Map<string,Node>;index?:number;row?:DocumentRow};
const folderId=(path:string)=>'document-folder-'+encodeURIComponent(path);

// Insert in result order: grouped recents/search keep their existing ranking.
function tree(rows:DocumentRow[]){
  const root:Node={path:'',name:'',children:new Map()};
  rows.forEach((row,index)=>{
    const path=row.path||row.primary;if(!path)return;
    let parent=root;
    const parts=path.split('/');
    parts.forEach((name,depth)=>{
      const key=parts.slice(0,depth+1).join('/');
      if(!parent.children.has(key))parent.children.set(key,{path:key,name,children:new Map()});
      parent=parent.children.get(key)!;
      if(depth===parts.length-1){parent.row=row;parent.index=index;}
    });
  });
  return [...root.children.values()];
}
function TreeNode({node,depth,onOpen,onActive}:{node:Node;depth:number;onOpen:(index:number)=>void;onActive:(element:HTMLElement)=>void}){
  if(node.row){
    const title=node.row.title||node.row.metadata?.title||node.name,read=node.row.read===true;
    return <Button role="treeitem" aria-level={depth} aria-selected={false} aria-label={`${title}, ${read?'Read':'Unread'}`} title={`${node.path} · ${read?'Read':'Unread'}`} tabIndex={-1} variant="ghost" size="sm" className="file-option h-auto w-full justify-start py-2" id={'file-option-'+node.index} data-doc-node="file" data-index={node.index} data-read={read} data-parent-folder={node.path.slice(0,node.path.lastIndexOf('/'))} onMouseEnter={event=>onActive(event.currentTarget)} onClick={()=>onOpen(node.index!)}>
      <FileIcon aria-hidden="true"/><span className="min-w-0 flex-1 text-left"><span className="name">{title}</span>{title!==node.name?<span className="file-basename">{node.name}</span>:null}<span className="path sr-only" aria-hidden="true">{node.path}</span>{node.row.excerpt?<span className="excerpt">{node.row.excerpt}</span>:null}</span>{read?<CheckIcon className="file-read-mark" aria-hidden="true"/>:<span className="unread-pip" aria-hidden="true"/>}
    </Button>;
  }
  const id=folderId(node.path);
  return <Collapsible defaultOpen data-tree-folder={node.path}>
    <CollapsibleTrigger id={id} role="treeitem" aria-level={depth} aria-owns={id+'-children'} aria-selected={false} data-doc-node="folder" data-parent-folder={node.path.includes('/')?node.path.slice(0,node.path.lastIndexOf('/')):''} tabIndex={-1} onClick={event=>{onActive(event.currentTarget);event.currentTarget.closest<HTMLElement>('#file-results')?.focus({preventScroll:true});}} render={<Button variant="ghost" size="sm" className="file-folder w-full justify-start"/>}>
      <ChevronRightIcon className="file-chevron" aria-hidden="true"/><FolderIcon aria-hidden="true"/><span className="truncate">{node.name}</span>
    </CollapsibleTrigger>
    <CollapsibleContent id={id+'-children'} role="group" aria-label={node.name} keepMounted><div className="file-tree-branch ml-4 flex flex-col">{[...node.children.values()].map(child=><TreeNode key={child.path} node={child} depth={depth+1} onOpen={onOpen} onActive={onActive}/>)}</div></CollapsibleContent>
  </Collapsible>;
}
export function DocumentTree({rows,onOpen,onActive}:{rows:DocumentRow[];onOpen:(index:number)=>void;onActive:(element:HTMLElement)=>void}){
  return <div className="reader-file-tree">{tree(rows).map(node=><TreeNode key={node.path} node={node} depth={1} onOpen={onOpen} onActive={onActive}/>)}</div>;
}
export function visibleDocumentNodes(container:HTMLElement){return [...container.querySelectorAll<HTMLElement>('[data-doc-node]')].filter(element=>!element.closest('[data-slot="collapsible-content"][data-closed]')&&element.getClientRects().length>0);}
export function revealDocumentNode(container:HTMLElement,path:string,flush:(callback:()=>void)=>void){
  const parts=path.split('/');
  for(let index=1;index<parts.length;index++){
    const folder=container.querySelector<HTMLElement>('#'+CSS.escape(folderId(parts.slice(0,index).join('/'))));
    if(folder?.getAttribute('aria-expanded')==='false')flush(()=>folder.click());
  }
}
