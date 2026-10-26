/** Right-hand panels dock beside the page on wide screens instead of covering it.
 *  The margins panel (and Linked from), Versions, Locations, the reading queue, Chat and What changed each sit at
 *  the right edge. When the window leaves at least DOCK_ROOM beside the panel, an open panel becomes a column: the root gets
 *  `data-dock="right"` and `--dock-width`, and the page (`body` margin, the fixed smooth-scroll and two-page
 *  wrapper, the status line, the summon button, split view, the art hero) gives up that width, so nothing is covered
 *  and the page stays interactive. Panels open together share the column (the widest sets its width); the one opened
 *  last is on top. Narrower windows keep the overlay (from about 1100 px for the 410 px margins panel to 1210 px for
 *  the 520 px What changed). The theme editor is a full-width modal and never docks.
 *  A change of dock width keeps the reader's line in continuous reading and sends a `resize` so two-page reading,
 *  pins, the outline rail and split view lay out again at the new width. */
// The article column is 773 px wide (65ch at 21 px) inside 40 px gutters. Docking keeps at least a 610 px column
// (about 55 characters a line, still comfortable): narrower than that, covering part of the page reads better.
export const DOCK_ROOM=690;
// Below this much room beside the column, two-page reading shows one page, as a window this narrow would.
const BOOK_SINGLE=900;
const PANELS='#thread-panel,#versions-panel,#list-panel,#queue-panel,#chat-panel,#changes-panel';
let width=0;
/** The width the dock takes from the right of the window: 0 when nothing is docked. */
export function dockWidth(){return width;}
/** The window width left to the page. */
export function pageWidth(){return innerWidth-width;}

const open=el=>el.id==='changes-panel'?el.dataset.side==='right'&&!el.hasAttribute('data-closed')&&!el.hasAttribute('data-ending-style'):!el.hidden;

/** `before()` returns what to keep (called while the old layout is still in place); `after(kept)` restores it. */
export function installDock({before,after}={}){
  const root=document.documentElement;
  function refresh(){
    const shown=[...document.querySelectorAll(PANELS)].filter(open);
    let next=shown.length?Math.max(...shown.map(el=>parseFloat(getComputedStyle(el).getPropertyValue('--panel-width'))||0)):0;
    if(innerWidth-next<DOCK_ROOM)next=0;
    const narrow=next>0&&innerWidth-next<=BOOK_SINGLE;
    if(next===width&&narrow===root.hasAttribute('data-dock-narrow'))return;
    const kept=before?.();
    width=next;
    if(next){root.dataset.dock='right';root.style.setProperty('--dock-width',next+'px');}else{delete root.dataset.dock;root.style.removeProperty('--dock-width');}
    root.toggleAttribute('data-dock-narrow',narrow);
    after?.(kept);
    dispatchEvent(new Event('resize'));
  }
  // Panels open and close by their hidden attribute; What changed is a Sheet portal that comes and goes.
  const attributes=new MutationObserver(refresh),children=new MutationObserver(refresh);
  attributes.observe(document.body,{subtree:true,attributes:true,attributeFilter:['hidden','data-side','data-closed','data-ending-style']});
  children.observe(document.body,{childList:true});
  addEventListener('resize',event=>{if(event.isTrusted)refresh();});
  refresh();
  return {refresh};
}
