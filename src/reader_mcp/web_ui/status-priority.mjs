/** Status line priority (#74): each #statusline child declares data-status-priority (1 never gives way; larger
 * numbers give way first). One measure pass hides the largest numbers, rightmost first, until the line fits, so an item
 * added later gives way by its declared rank instead of pushing the mode or Backstage off screen. An item without a
 * declaration gives way before every declared one. CSS breakpoints cannot do this: they know the viewport, not how wide
 * the breadcrumb, speech label, version chip or a new item actually is. The line cannot clip or scroll instead, because
 * the breadcrumb's folder menu opens above it. */
export const UNDECLARED=9,CRUMB=64;
export const rank=element=>{const value=Number(element.dataset.statusPriority);return Number.isFinite(value)&&value>0?value:UNDECLARED;};
/** Children that may give way, in the order they do: largest rank first, then rightmost first. */
export function givingOrder(children){return children.map((element,index)=>({element,index,rank:rank(element)})).filter(item=>item.rank>1)
  .sort((a,b)=>b.rank-a.rank||b.index-a.index).map(item=>item.element);}

export function installStatusPriority(line){
  if(!line)return {refresh(){}};
  const flow=()=>[...line.children].filter(element=>{const style=getComputedStyle(element);return style.display!=='none'&&style.position!=='absolute'&&style.position!=='fixed';});
  // Fits when no item reaches past the line's padding edge. Items keep their content width (style.css sets
  // flex-shrink:0 on all but the breadcrumb and section label), so too many items overflow instead of crushing each other.
  // The breadcrumb, the one item that shrinks, also needs its current crumb readable: at least CRUMB px, or all of it.
  const fits=()=>{const box=line.getBoundingClientRect(),limit=box.right-parseFloat(getComputedStyle(line).paddingRight)+.5,crumb=line.querySelector('.status-location [aria-current]');
    if(crumb?.getClientRects().length&&crumb.clientWidth+1<Math.min(crumb.scrollWidth,CRUMB))return false;
    return flow().every(element=>{const own=element.getBoundingClientRect();return !own.width||(own.right<=limit&&own.left>=box.left-.5);});};
  let frame=0,restore=false,width=0;
  function pass(){
    frame=0;const again=restore;restore=false;if(!line.isConnected||!line.getBoundingClientRect().width)return;
    if(again)for(const element of line.querySelectorAll(':scope>[data-status-hidden]'))element.removeAttribute('data-status-hidden');
    if(fits())return;
    for(const element of givingOrder([...line.children].filter(child=>!child.hasAttribute('data-status-hidden')))){
      element.setAttribute('data-status-hidden','');if(fits())return;}
  }
  /** Schedule a pass; `full` first brings back what gave way (the line grew, or its items or layout changed). */
  function refresh(full=true){restore||=full;if(!frame)frame=requestAnimationFrame(pass);}
  new ResizeObserver(([entry])=>{const next=Math.round(entry.contentRect.width);if(next!==width){width=next;refresh();}}).observe(line);
  // Text changes only (the position as you scroll) never bring items back; structure, visibility and layout classes do.
  new MutationObserver(records=>refresh(records.some(record=>record.type!=='characterData'))).observe(line,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','class','data-status-priority']});
  new MutationObserver(()=>refresh()).observe(document.body,{attributes:true,attributeFilter:['class']});
  document.fonts?.ready.then(()=>refresh());
  refresh();
  return {refresh};
}
