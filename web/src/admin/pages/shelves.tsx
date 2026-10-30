/* Admin › Library › A map of the stacks: a zoomable icicle of first topic → first project → work, sized by catalog works.
   The location trail is a shadcn Breadcrumb and the picker a NativeSelect, which lists every child, including cells too
   small to draw or label. D3 (the global `d3`) lays out and draws only the cells. Selecting a shelf zooms into it; a work
   opens; "Browse" lists the shelf's works under Latest additions. */
import {Fragment, useEffect, useMemo, useRef, useState} from 'react';
import {Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator} from '@/components/ui/breadcrumb';
import {Button} from '@/components/ui/button';
import {NativeSelect, NativeSelectOption} from '@/components/ui/native-select';
import {plural, shelfHierarchy} from './gallery-model';
import type {LibraryWork} from './library-charts';

declare const d3:any;
const WIDTH=360,HEIGHT=210,COLUMN=180;
const colors=['var(--chart-1)','var(--chart-2)'];
const names=(node:any):string[]=>node.ancestors().reverse().map((n:any)=>n.data.name);

export type ShelvesProps={works:LibraryWork[];open:(path:string)=>void;
  select:(key:string,label:string,works:LibraryWork[])=>void;tooltip:(event:Event,title:string,detail:string)=>void;hideTooltip:()=>void};

/** The page resets it to all shelves by remounting it (a new `key`). */
export function Shelves({works,open,select,tooltip,hideTooltip}:ShelvesProps){
  const tree=useMemo(()=>{
    if(typeof d3==='undefined')return null;
    const root=d3.hierarchy(shelfHierarchy(works)).sum((node:any)=>node.value||0).sort((a:any,b:any)=>b.value-a.value||a.data.name.localeCompare(b.data.name));
    d3.partition().size([1,root.height+1])(root);
    return root;
  },[works]);
  // The focused shelf, by the names from the root, so it survives a redraw of the same works.
  const [path,setPath]=useState<string[]>([]);
  const svg=useRef<SVGSVGElement>(null),picker=useRef<HTMLSelectElement>(null),refocus=useRef(false),latest=useRef({open,tooltip,hideTooltip});
  latest.current={open,tooltip,hideTooltip};
  useEffect(()=>{setPath([]);},[works]);
  const focus=useMemo(()=>{let node=tree;for(const name of path.slice(1))node=node?.children?.find((child:any)=>child.data.name===name)??node;return node;},[tree,path]);

  function enter(node:any){
    hideTooltip();
    if(node.data.work){open(node.data.work.primary);return;}
    // Redrawing removes the cell or crumb that had keyboard focus; hand it to the picker instead of the page.
    refocus.current=!!svg.current?.closest('[data-shelves]')?.contains(document.activeElement);
    setPath(names(node));
  }

  useEffect(()=>{
    if(!svg.current||!focus)return;
    const span=focus.x1-focus.x0,chart=d3.select(svg.current),hooks=latest.current;
    // Only draw cells tall enough to read; the picker reaches the rest.
    const visible=focus.descendants().filter((node:any)=>node!==focus&&node.depth<=focus.depth+2&&(node.x1-node.x0)/span*HEIGHT>=18);
    const cells=chart.selectAll('g').data(visible,(node:any)=>JSON.stringify(node.ancestors().reverse().map((n:any)=>n.data.work?.primary||n.data.name)))
      .join('g').attr('class','shelf-cell').attr('transform',(node:any)=>`translate(${(node.depth-focus.depth-1)*COLUMN},${(node.x0-focus.x0)/span*HEIGHT})`);
    cells.selectAll('*').remove();
    cells.append('rect').attr('width',COLUMN-2).attr('height',(node:any)=>(node.x1-node.x0)/span*HEIGHT-2).attr('fill',(node:any)=>colors[(node.depth-1)%2]).attr('stroke','var(--chart-stroke, var(--line))');
    cells.append('rect').attr('x',3).attr('y',1).attr('width',(node:any)=>Math.min(172,Math.min(24,node.data.name.length)*6+8)).attr('height',16).attr('fill','var(--surface)').attr('pointer-events','none');
    cells.append('text').attr('x',7).attr('y',13).text((node:any)=>node.data.name.length>24?node.data.name.slice(0,22)+'…':node.data.name).attr('pointer-events','none');
    cells.append('title').text((node:any)=>`${names(node).join(' › ')} · ${plural(node.value,'work')}`);
    cells.attr('tabindex',0).attr('role',(node:any)=>node.data.work?'link':'button')
      .attr('aria-label',(node:any)=>`${node.data.name}: ${plural(node.value,'work')}${node.data.work?'. Open document':'. Zoom into shelf'}`)
      .on('click',(_:Event,node:any)=>enter(node))
      .on('keydown',(event:KeyboardEvent,node:any)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();enter(node);}})
      .on('mouseenter focus',(event:Event,node:any)=>hooks.tooltip(event,node.data.name,plural(node.value,'work'))).on('mouseleave blur',()=>hooks.hideTooltip());
    if(refocus.current){refocus.current=false;picker.current?.focus({preventScroll:true});}
  },[focus]);

  if(!tree||!focus)return null;
  const trail=focus.ancestors().reverse(),children:any[]=focus.children||[];
  const label=names(focus).join(' › '),shelfWorks=focus.leaves().map((node:any)=>node.data.work).filter(Boolean) as LibraryWork[];
  return <div className="flex flex-col gap-2" data-shelves="">
    <Breadcrumb aria-label="Shelf location" data-shelf-trail="">
      <BreadcrumbList className="gap-1 text-xs sm:gap-1">
        {trail.map((node:any,i:number)=><Fragment key={names(node).join('\u0000')}>
          {i?<BreadcrumbSeparator/>:null}
          <BreadcrumbItem data-shelf-crumb="">{node===focus?<BreadcrumbPage className="font-medium [overflow-wrap:anywhere]">{node.data.name}</BreadcrumbPage>
            :<BreadcrumbLink render={<button type="button"/>} className="[overflow-wrap:anywhere]" onClick={()=>enter(node)}>{node.data.name}</BreadcrumbLink>}</BreadcrumbItem>
        </Fragment>)}
      </BreadcrumbList>
    </Breadcrumb>
    <NativeSelect ref={picker} className="w-full" size="sm" data-shelf-picker="" aria-label="Open a shelf or work" value="" disabled={!children.length}
      onChange={event=>{const node=children[Number(event.target.value)-1];if(node)enter(node);}}>
      <NativeSelectOption value="">Choose a shelf or work…</NativeSelectOption>
      {children.map((node:any,i:number)=><NativeSelectOption key={names(node).join('\u0000')+(node.data.work?.primary||'')} value={String(i+1)}>{`${node.data.name} · ${plural(node.value,'work')}`}</NativeSelectOption>)}
    </NativeSelect>
    <svg ref={svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label={`Shelves in ${focus.data.name}, sized by catalog work count`} className="block h-auto w-full"/>
    <p role="status" data-shelf-context="" className="text-xs text-muted-foreground">
      {children.length?<Button variant="link" size="xs" className="h-auto px-0" onClick={()=>select('shelf:'+JSON.stringify(trail.map((n:any)=>n.data.name).reverse()),label,shelfWorks)}>{`Browse ${plural(focus.value,'work')} on this shelf`}</Button>
        :'No catalog works on these shelves.'}
    </p>
  </div>;
}
