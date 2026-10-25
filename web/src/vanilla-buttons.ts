/* shadcn Button and Button Group for the plain-JavaScript renderer.
   Markup declares `data-button="<variant> <size> [round]"` or
   `data-button-group="horizontal|vertical"`; this applies the same cva classes and
   data-slot contract the React components render. A MutationObserver covers markup
   rendered later from template strings. */
import {cn} from 'cn';
import {buttonVariants} from './components/ui/button';
import {buttonGroupVariants} from './components/ui/button-group';

type Variant=NonNullable<Parameters<typeof buttonVariants>[0]>['variant'];
type Size=NonNullable<Parameters<typeof buttonVariants>[0]>['size'];
const VARIANTS=['default','outline','secondary','ghost','destructive','link'];
const SIZES=['default','xs','sm','lg','icon','icon-xs','icon-sm','icon-lg'];
// Literal class strings so Tailwind generates them.
const PRESSED='aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:border-border';
const ROUND='rounded-full';

function decorateButton(element:HTMLElement){
  const [variant='default',size='default',...flags]=(element.dataset.button||'').split(/\s+/).filter(Boolean);
  if(!VARIANTS.includes(variant)||!SIZES.includes(size))throw new Error(`Unknown button variant/size: ${element.dataset.button}`);
  const own=element.dataset.buttonClass??element.className;element.dataset.buttonClass=own;
  element.className=cn(buttonVariants({variant:variant as Variant,size:size as Size}),element.hasAttribute('aria-pressed')&&PRESSED,flags.includes('round')&&ROUND,own);
  element.dataset.slot='button';element.dataset.decorated=element.dataset.button;
}
function decorateGroup(element:HTMLElement){
  const orientation=element.dataset.buttonGroup==='vertical'?'vertical':'horizontal';
  const own=element.dataset.buttonClass??element.className;element.dataset.buttonClass=own;
  element.className=cn(buttonGroupVariants({orientation}),own);
  element.setAttribute('role','group');element.dataset.slot='button-group';element.dataset.orientation=orientation;
}
export function decorateButtons(root:ParentNode=document){
  const scope=root instanceof HTMLElement?[root]:[];
  for(const element of [...scope,...root.querySelectorAll<HTMLElement>('[data-button],[data-button-group]')]){
    // Sonner marks its own toast action buttons data-button="true"; they are not this markup contract.
    if(element.closest('[data-sonner-toaster]'))continue;
    if(element.dataset.button!==undefined&&element.dataset.decorated!==element.dataset.button)decorateButton(element);
    else if(element.dataset.buttonGroup!==undefined&&element.dataset.slot!=='button-group')decorateGroup(element);
  }
}
export function observeButtons(){
  decorateButtons();
  new MutationObserver(records=>{for(const record of records){
    if(record.type==='attributes'){decorateButtons(record.target as HTMLElement);continue;}
    for(const node of record.addedNodes)if(node instanceof HTMLElement)decorateButtons(node);
  }}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-button']});
}
