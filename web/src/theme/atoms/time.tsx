/* Atoms: times as Admin pages say them. RelativeTime is a <time> element ("3 min ago", or a calendar date as written);
   Elapsed counts up from a start, once a second, as "42 s" or as a "1:05" clock. */
import {useEffect, useState} from 'react';

/** "just now", "3 min ago", "2 h ago" or a date; a YYYY-MM-DD calendar date is shown as written. Null for no value. */
export function when(value:unknown){
  if(typeof value!=='string'||!value)return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return new Date(value+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  const date=new Date(value);if(Number.isNaN(+date))return value;
  const seconds=Math.round((Date.now()-+date)/1000);
  if(seconds<45)return 'just now';if(seconds<3600)return Math.round(seconds/60)+' min ago';if(seconds<86400)return Math.round(seconds/3600)+' h ago';
  return date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}

export function RelativeTime({value}:{value:string|null|undefined}){
  const text=when(value);return text===null?null:<time dateTime={value!}>{text}</time>;
}

function useSecond(){const [, tick]=useState(0);useEffect(()=>{const timer=setInterval(()=>tick(n=>n+1),1000);return ()=>clearInterval(timer);},[]);}
export function Elapsed({since,clock=false}:{since:string;clock?:boolean}){
  useSecond();
  const seconds=Math.max(0,Math.round((Date.now()-+new Date(since))/1000));
  return <time dateTime={`PT${seconds}S`}>{clock?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:`${seconds} s`}</time>;
}
