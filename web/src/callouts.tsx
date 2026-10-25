/* Icons for Obsidian callouts rendered by web_ui/callouts.mjs. The Lucide icons Obsidian uses
   are rendered once into detached SVG templates and cloned into each header, so a document
   with many callouts creates no React roots. The header already carries
   data-reader-decoration; the icon is aria-hidden. */
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {BugIcon, CheckIcon, CircleCheckIcon, CircleQuestionMarkIcon, ClipboardListIcon, FlameIcon, InfoIcon, ListIcon, PencilIcon, QuoteIcon, TriangleAlertIcon, XIcon, ZapIcon, type LucideIcon} from 'lucide-react';

const ICONS:Record<string,LucideIcon>={note:PencilIcon,abstract:ClipboardListIcon,info:InfoIcon,todo:CircleCheckIcon,tip:FlameIcon,success:CheckIcon,question:CircleQuestionMarkIcon,warning:TriangleAlertIcon,failure:XIcon,danger:ZapIcon,bug:BugIcon,example:ListIcon,quote:QuoteIcon};
let templates:Map<string,SVGElement>|null=null;
function iconTemplates(){
  if(templates)return templates;
  const host=document.createElement('div'),root=createRoot(host);
  flushSync(()=>root.render(<>{Object.entries(ICONS).map(([type,Icon])=><Icon key={type} data-callout-svg={type} aria-hidden="true" focusable="false"/>)}</>));
  templates=new Map([...host.querySelectorAll<SVGElement>('svg[data-callout-svg]')].map(svg=>[svg.dataset.calloutSvg!,svg.cloneNode(true) as SVGElement]));
  root.unmount();
  return templates;
}
export function mountCallouts(container:HTMLElement,onToggle?:()=>void){
  const slots=[...container.querySelectorAll<HTMLElement>('.callout-icon[data-callout-icon]')].slice(0,2048);
  if(!slots.length)return;
  const icons=iconTemplates();
  for(const slot of slots){if(slot.firstElementChild)continue;const svg=icons.get(slot.dataset.calloutIcon!)||icons.get('note')!;slot.append(svg.cloneNode(true));}
  if(onToggle)for(const fold of container.querySelectorAll<HTMLDetailsElement>('details.callout-fold'))fold.addEventListener('toggle',onToggle);
}
