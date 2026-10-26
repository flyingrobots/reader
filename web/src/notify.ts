import {toast} from 'sonner';
/** Plain-JS toasts go through the same Sonner Toaster. */
/** A toast; pass `id` to replace an earlier toast with the same id instead of stacking another. A string third argument is a description. */
export function notify(message:string,type:'info'|'success'|'error'='info',options:string|{id?:string;duration?:number;description?:string}={}){
  const o=typeof options==='string'?{description:options}:options;
  if(type==='error')toast.error(message,{duration:8000,...o});else if(type==='success')toast.success(message,o);else toast(message,o);
}
