/* The static web demo (RW-42, #107). The shim (web_ui/static-demo.js) reads <meta name="reader-static-demo">, which only
   `reader demo --export-static` writes, and publishes window.readerStaticDemo. That object is the single source of truth
   for "static": a normal server never sets it, so nothing here changes the app on a running Reader. */
export const NEEDS_READER='Needs Reader on your computer';
export type StaticDemo={base:string;exportedAt:string;serves?:Record<string,boolean>};
export function staticDemo():StaticDemo|null{return (globalThis as {readerStaticDemo?:StaticDemo}).readerStaticDemo||null;}
/** True when `feature` needs a running Reader here: in the static demo, unless the shim serves it (`serves.chat`, #108). */
export function needsReader(feature?:string){const demo=staticDemo();return !!demo&&!(feature&&demo.serves?.[feature]);}
/** Props for a control that needs a running Reader: disabled, with the reason as its tooltip. Spread after `disabled`. */
export function localOnly(feature?:string):{disabled?:true;title?:string;'data-needs-reader'?:''}{return needsReader(feature)?{disabled:true,title:NEEDS_READER,'data-needs-reader':''}:{};}
