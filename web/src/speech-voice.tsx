import {useEffect, useId, useState} from 'react';
import {Button} from './components/ui/button';
import {Field, FieldDescription, FieldLabel} from './components/ui/field';
import {NativeSelect, NativeSelectOption} from './components/ui/native-select';

type Api=(path:string,payload?:unknown)=>Promise<any>;
/** The same engine catalog serves the saved default and a single reading override. */
export function SpeechVoice({api,saveDefault=false,refreshKey='',onChange}:{api:Api;saveDefault?:boolean;refreshKey?:string;onChange?:(voice:string)=>void}){
  const id=useId(),[voices,setVoices]=useState<string[]>([]),[voice,setVoice]=useState('');
  const [retry,setRetry]=useState(0);
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  useEffect(()=>{let live=true;setReady(false);setError('');api('/api/speech-voices').then(data=>{if(!live)return;setVoices(data.voices);setVoice(data.default_voice||'');setReady(true);},failure=>{if(live)setError(failure.message||'Couldn’t load AI-TTS voices.');});return ()=>{live=false;};},[api,refreshKey,retry]);
  async function change(next:string){
    setError('');setSaved(false);
    if(!saveDefault){setVoice(next);onChange?.(next);return;}
    setBusy(true);
    try{await api('/api/speech-voices',{voice:next});setVoice(next);setSaved(true);}catch(failure){setError(failure instanceof Error?failure.message:String(failure));}finally{setBusy(false);}
  }
  return <Field data-speech-voice="">
    <FieldLabel htmlFor={id}>{saveDefault?'Default reading voice':'Reading voice'}</FieldLabel>
    <NativeSelect id={id} className="w-full" value={voice} disabled={!ready||busy} onChange={event=>void change(event.target.value)}>
      <NativeSelectOption value="">{ready?'Automatic (AI-TTS default)':'Loading voices…'}</NativeSelectOption>
      {voice&&!voices.includes(voice)?<NativeSelectOption value={voice} disabled>{voice} (unavailable)</NativeSelectOption>:null}
      {voices.map(name=><NativeSelectOption key={name} value={name}>{name}</NativeSelectOption>)}
    </NativeSelect>
    <FieldDescription>{saveDefault?'Used for new readings, including Read aloud.':'Applies to this reading only.'}</FieldDescription>
    {saved?<FieldDescription role="status">Default voice saved.</FieldDescription>:null}
    {error?<><FieldDescription role="alert">{error}</FieldDescription>{!ready?<Button type="button" size="sm" variant="outline" onClick={()=>setRetry(n=>n+1)}>Retry voices</Button>:null}</>:null}
  </Field>;
}
