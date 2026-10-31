/* The right-hand panels (Discussions, Versions, Lists) as non-modal shadcn Sheets. Each Sheet adopts its existing <aside>
   from index.html, which plain JavaScript still drives: app.mjs, versions.mjs and lists.mjs open and close a panel by
   its `hidden` attribute, reading.mjs and dock.mjs watch that attribute, and the panel's own buttons and keys stay
   wired. The Sheet stays open and never closes itself; styles.css shows its popup exactly while the aside is not
   hidden, so a panel the app unhides can take focus in the same moment. Escape, outside clicks and focus stay with the
   app (a cancelled Base UI close still stops Escape's propagation unless allowed), so the page stays interactive and the panels dock beside it on wide screens (dock.mjs; the geometry is in
   styles.css under [data-panel-sheet]). The popup has no dialog role: the aside keeps its own semantics, and
   app.mjs's typing() would otherwise treat every key inside the panel as typing. */
import {useCallback} from 'react';
import {Sheet, SheetContent} from '@/components/ui/sheet';

export function PanelSheet({panel}:{panel:HTMLElement}){
  const adopt=useCallback((element:HTMLDivElement|null)=>{if(element&&panel.parentElement!==element)element.append(panel);},[panel]);
  return <Sheet open modal={false} onOpenChange={(_next,details)=>{details.cancel();details.allowPropagation();}}>
    <SheetContent side="right" keepMounted showOverlay={false} showCloseButton={false} role="none" data-panel-sheet={panel.id} initialFocus={false} finalFocus={false}>
      <div ref={adopt} className="flex min-h-0 flex-1 flex-col"/>
    </SheetContent>
  </Sheet>;
}
