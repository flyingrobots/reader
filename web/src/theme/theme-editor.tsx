import {localOnly, needsReader} from '../static-demo';
import {CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockTitle} from '../components/ui/code-block';
import {useEffect, useMemo, useRef, useState, type CSSProperties} from 'react';
import {Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription} from '../components/ui/sheet';
import {Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem, SelectLabel} from '../components/ui/select';
import {Field, FieldLabel, FieldDescription} from '../components/ui/field';
import {Input} from '../components/ui/input';
import {Button} from '../components/ui/button';
import {ButtonGroup} from '../components/ui/button-group';
import {bestContrastWith, COLOR_TOKENS, FONT_ROLES, BUNDLED_FONTS, CHARTS, alphaOf, autoFix, checkVariant, deriveVariant, generateVariant, modeColors, simulateTokens, suggestAccents, withAlpha, type Check, type Simulation, type Theme, type Tokens, type Variant} from './color';
import {FAMOUS, famousId} from './famous';
import {readBuiltIn, themeId, variantProperties, type InstalledFont} from './theme-css';

export type EditorProps={open:boolean;onOpenChange:(open:boolean)=>void;themes:Theme[];fonts:InstalledFont[];current:string;
  api:(path:string,payload?:unknown)=>Promise<any>;onChanged:(themes:Theme[],fonts:InstalledFont[])=>void;onUse:(dataTheme:string)=>void;onPreviewFont:(href:string)=>void;error:(error:unknown)=>void};

const BUILT_INS=[{key:'ink',name:'Ink & Paper',light:'paper',dark:'ink'},{key:'orchid',name:'Orchid',light:'orchid',dark:'orchid-dark'},{key:'harvest',name:'Harvest',light:'harvest',dark:'harvest-dark'},...FAMOUS.map(t=>({key:t.id,name:t.name,light:famousId(t.id,'light'),dark:famousId(t.id,'dark')}))];
const GROUPS=[...new Set(COLOR_TOKENS.map(t=>t.group))];
const SIMS:{value:Simulation;label:string}[]=[{value:'none',label:'Typical vision'},{value:'protanopia',label:'Protanopia'},{value:'deuteranopia',label:'Deuteranopia'},{value:'tritanopia',label:'Tritanopia'},{value:'grayscale',label:'Grayscale'}];
const variantOf=(dataTheme:string):Variant=>dataTheme==='ink'||dataTheme.endsWith('-dark')?'dark':'light';
const slugify=(name:string)=>name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,34).replace(/-dark$/,'')||'theme';

function fromBuiltIn(key:string):Theme{
  const b=BUILT_INS.find(x=>x.key===key)!,light=readBuiltIn(b.light),dark=readBuiltIn(b.dark);
  return {id:'',name:b.name+' copy',fonts:light.fonts,light:light.tokens,dark:dark.tokens};
}
function blank(seed='#5b6ee1'):Theme{return {id:'',name:'New theme',fonts:{serif:null,sans:null,mono:null},light:generateVariant(seed,'light'),dark:generateVariant(seed,'dark')};}
function initial(current:string,themes:Theme[]):{theme:Theme;source:string}{
  const custom=themes.find(t=>current===themeId(t,'light')||current===themeId(t,'dark'));
  if(custom)return {theme:structuredClone(custom),source:custom.id};
  const b=BUILT_INS.find(x=>x.light===current||x.dark===current)||BUILT_INS[0];return {theme:fromBuiltIn(b.key),source:'builtin:'+b.key};
}

function Choice({id,label,value,groups,onChange}:{id:string;label:string;value:string;groups:{label?:string;items:{value:string;label:string}[]}[];onChange:(v:string)=>void}){
  const items=groups.flatMap(g=>g.items);
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Select items={items} value={value} onValueChange={v=>{if(v!==null)onChange(v);}}><SelectTrigger id={id} className="w-full"><SelectValue/></SelectTrigger><SelectContent alignItemWithTrigger={false}>{groups.map((g,i)=><SelectGroup key={i}>{g.label&&<SelectLabel>{g.label}</SelectLabel>}{g.items.map(item=><SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup>)}</SelectContent></Select></Field>;
}

function TokenRow({name,label,description,alpha,value,flag,onChange}:{name:string;label:string;description:string;alpha?:boolean;value:string;flag?:Check;onChange:(value:string)=>void}){
  const [text,setText]=useState(value);useEffect(()=>setText(value),[value]);
  const commit=(raw:string)=>{const v=raw.trim().toLowerCase();if(/^#([0-9a-f]{6}|[0-9a-f]{8})$/.test(v))onChange(v);else if(/^#[0-9a-f]{3}$/.test(v))onChange('#'+[...v.slice(1)].map(c=>c+c).join(''));else setText(value);};
  return <div className="theme-token" data-token={name}>
    <input type="color" aria-label={label+' color'} value={value.slice(0,7)} onChange={e=>onChange(alpha?withAlpha(e.target.value,alphaOf(value)):e.target.value)}/>
    <div className="theme-token-label"><label htmlFor={'token-'+name}>{label}{flag&&<span className={'theme-flag '+flag.severity} title={flag.label+': '+flag.detail}>{flag.severity==='fail'?'!':'·'}</span>}</label><span>{description}</span></div>
    <Input id={'token-'+name} className="theme-token-hex" value={text} spellCheck={false} maxLength={9} onChange={e=>setText(e.target.value)} onBlur={e=>commit(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commit((e.target as HTMLInputElement).value);}}}/>
    {alpha&&<label className="theme-alpha">Opacity<input type="range" min={0} max={100} value={Math.round(alphaOf(value)*100)} onChange={e=>onChange(withAlpha(value,+e.target.value/100))}/><output>{Math.round(alphaOf(value)*100)}%</output></label>}
  </div>;
}

function Preview({tokens,fonts,variant,sim}:{tokens:Tokens;fonts:Theme['fonts'];variant:Variant;sim:Simulation}){
  const shown=simulateTokens(tokens,sim);
  const style={...variantProperties(shown,fonts,variant),...Object.fromEntries(modeColors(shown,variant).map(m=>['--mode-'+m.name,m.value]))} as CSSProperties;
  return <div className="theme-preview" style={style} data-variant={variant} aria-label="Sample article preview">
    <div className="theme-preview-page">
      <article className="article">
        <p className="theme-preview-kicker">Essay · 9 min read</p>
        <h1>On the keeping of small libraries</h1>
        <p className="theme-preview-byline">Ada Lovelace · Reading room · 24 October 2026</p>
        <p>A small library is less a collection than a <span className="theme-mark own">set of promises about attention</span>. Each shelf says what its keeper meant to return to, and each margin note records <a href="#preview" onClick={e=>e.preventDefault()}>where a reader stopped to think</a>.</p>
        <p>Others leave traces too: <span className="theme-mark other">a passage another reader marked</span>, a <span className="theme-mark warning">claim someone flagged for checking</span>, and the <span className="theme-mark selection">text you are selecting now</span>.</p>
        <blockquote>The catalog is the library’s memory of itself; the margins are its conversation.</blockquote>
        <h2>What the keeper owes</h2>
        <ul><li>Preserve what arrived, exactly as it came.</li><li>Say where certainty ends, with <code>provenance</code> attached.</li></ul>
        <CodeBlock className="theme-preview-code"><CodeBlockHeader><CodeBlockTitle>Shell</CodeBlockTitle></CodeBlockHeader><CodeBlockContent tabIndex={-1}>{'reader browse --check\n# 2 works, 0 changed'}</CodeBlockContent></CodeBlock>
      </article>
      <aside className="theme-preview-panel">
        <h3>In the margins</h3>
        <p className="theme-preview-muted">Ada · 3 comments</p>
        <p className="theme-preview-faint">Updated 2 hours ago</p>
        <div className="theme-preview-actions"><Button size="sm">Leave comment</Button><Button size="sm" variant="secondary">Cancel</Button><Button size="sm" variant="destructive">Warn</Button></div>
        <div className="theme-preview-chart" aria-label="Chart colors">{CHARTS.map((name,i)=><i key={name} style={{height:`${30+((i*37)%55)}%`,background:`var(--${name})`}}/>)}</div>
      </aside>
    </div>
    <div className="theme-preview-status"><span className="vim-mode" data-mode="NORMAL">NORMAL</span>{['BROWSE','SEARCH','INSERT','LEADER','HELP'].map(m=><span key={m} className="vim-mode" data-mode={m}>{m}</span>)}<span className="theme-preview-keys"><kbd>Space e</kbd> files <kbd>/</kbd> find</span></div>
  </div>;
}

function Checks({checks,onFix,onFixAll}:{checks:Check[];onFix:(c:Check)=>void;onFixAll:()=>void}){
  const failing=checks.filter(c=>c.severity==='fail'),warning=checks.filter(c=>c.severity==='warn');
  const groups=[...new Set(checks.map(c=>c.group))];
  return <section className="theme-checks" aria-labelledby="theme-checks-title">
    <div className="theme-checks-head"><h3 id="theme-checks-title">Checks</h3><span role="status">{failing.length} failing · {warning.length} to review · {checks.length-failing.length-warning.length} passing</span>{failing.some(c=>c.fix)&&<Button size="sm" variant="secondary" onClick={onFixAll}>Fix contrast failures</Button>}</div>
    {groups.map(group=>{const rows=checks.filter(c=>c.group===group).sort((a,b)=>'fwp'.indexOf(a.severity[0])-'fwp'.indexOf(b.severity[0]));
      return <details key={group} open={rows.some(c=>c.severity!=='pass')}><summary>{group} <span>{rows.filter(c=>c.severity==='pass').length}/{rows.length}</span></summary><ul>{rows.map(c=><li key={c.id} data-severity={c.severity}><span className="theme-check-badge">{c.severity==='pass'?'Pass':c.severity==='warn'?'Review':'Fail'}</span><div><strong>{c.label}</strong><span>{c.detail}</span></div>{c.fix&&c.severity!=='pass'&&<Button size="xs" variant="outline" onClick={()=>onFix(c)} title={`Set ${c.fix.token} to ${c.fix.value}`}>Use {c.fix.value}</Button>}</li>)}</ul></details>;})}
  </section>;
}

function FontSearch({api,installed,onInstalled,error}:{api:EditorProps['api'];installed:InstalledFont[];onInstalled:(fonts:InstalledFont[],font:InstalledFont)=>void;error:(e:unknown)=>void}){
  const [query,setQuery]=useState(''),[results,setResults]=useState<{family:string;category:string}[]|null>(null),[busy,setBusy]=useState<string|null>(null);
  const searchId=useRef(0);
  useEffect(()=>{if(!query.trim()){setResults(null);return;}const id=++searchId.current;const timer=setTimeout(()=>{api('/api/fonts?q='+encodeURIComponent(query.trim())).then(r=>{if(id===searchId.current)setResults(r.families);}).catch(error);},250);return ()=>clearTimeout(timer);},[query]);
  return <Field><FieldLabel htmlFor="font-search">Add a Google Font</FieldLabel>
    <Input id="font-search" placeholder="Search families, e.g. Literata" value={query} onChange={e=>setQuery(e.target.value)} autoComplete="off" spellCheck={false}/>
    <FieldDescription>Searching and adding contact Google Fonts once; the font is then stored in your vault and served locally. Reading never contacts Google.</FieldDescription>
    {results&&<ul className="theme-font-results">{results.length===0&&<li className="theme-preview-muted">No matching families.</li>}{results.slice(0,12).map(r=>{const have=installed.some(f=>f.family===r.family)||BUNDLED_FONTS.includes(r.family);return <li key={r.family}><span>{r.family}<small>{r.category}</small></span><Button size="xs" variant="outline" disabled={have||busy!==null} onClick={async()=>{setBusy(r.family);try{const font=await api('/api/themes',{action:'install-font',family:r.family});const list=await api('/api/themes');onInstalled(list.fonts,font);}catch(e){error(e);}finally{setBusy(null);}}}>{have?'Added':busy===r.family?'Adding…':'Add'}</Button></li>;})}</ul>}
  </Field>;
}

export function ThemeEditor(props:EditorProps){
  const {open,themes,fonts,api,error}=props;
  const [draft,setDraft]=useState<Theme>(()=>blank()),[source,setSource]=useState('new'),[variant,setVariant]=useState<Variant>('light'),[sim,setSim]=useState<Simulation>('none'),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[seed,setSeed]=useState('#5b6ee1');
  useEffect(()=>{if(!open)return;const start=initial(props.current,themes);setDraft(start.theme);setSource(start.source);setVariant(variantOf(props.current));setDirty(false);setSim('none');},[open]);
  const tokens=draft[variant];
  const checks=useMemo(()=>checkVariant(tokens,variant),[tokens,variant]);
  const otherChecks=useMemo(()=>checkVariant(draft[variant==='light'?'dark':'light'],variant==='light'?'dark':'light'),[draft,variant]);
  const accents=useMemo(()=>suggestAccents(tokens,variant),[tokens.bg,tokens.warning,tokens.accent,tokens.ink,variant]);
  const flags=useMemo(()=>{const map:Record<string,Check>={};for(const c of checks)if(c.severity!=='pass'&&c.fix&&(!map[c.fix.token]||c.severity==='fail'))map[c.fix.token]=c;return map;},[checks]);
  const update=(next:Partial<Theme>)=>{setDraft(old=>({...old,...next}));setDirty(true);};
  const setToken=(name:string,value:string)=>update({[variant]:{...tokens,[name]:value}} as Partial<Theme>);
  const confirmDiscard=()=>!dirty||confirm('Discard unsaved theme changes?');
  const builtIn=source.startsWith('builtin:');
  const sourceItems=[{label:'Your themes',items:themes.map(t=>({value:t.id,label:t.name}))},{label:'Built-in (saving makes a copy)',items:BUILT_INS.map(b=>({value:'builtin:'+b.key,label:b.name}))},{items:[{value:'new',label:'New theme from a seed color'}]}].filter(g=>g.items.length);
  const choose=(value:string)=>{if(value===source||!confirmDiscard())return;setDirty(false);setSource(value);
    if(value==='new')setDraft(blank(seed));else if(value.startsWith('builtin:'))setDraft(fromBuiltIn(value.slice(8)));else setDraft(structuredClone(themes.find(t=>t.id===value)!));};
  const fontGroups=(role:typeof FONT_ROLES[number])=>[{items:[{value:'',label:`Default${role.default?` (${role.default})`:' (system)'}`}]},{label:'Bundled',items:BUNDLED_FONTS.map(f=>({value:f,label:f}))},{label:'Downloaded',items:fonts.filter(f=>!BUNDLED_FONTS.includes(f.family)).map(f=>({value:f.family,label:`${f.family} · ${f.category}`}))}].filter(g=>g.items.length);
  async function save(use:boolean){
    const name=draft.name.trim();if(!name){error(new Error('Give the theme a name.'));return;}
    const taken=new Set([...themes.map(t=>t.id),...BUILT_INS.flatMap(b=>[b.key,b.light])]);let id=draft.id;
    if(!id){const base=slugify(name);id=base;for(let n=2;taken.has(id);n++)id=`${base.slice(0,34)}-${n}`;}
    setBusy(true);try{const saved=await api('/api/themes',{action:'save',theme:{...draft,id,name}});const list=await api('/api/themes');
      setDraft(saved);setSource(saved.id);setDirty(false);props.onChanged(list.themes,list.fonts);if(use)props.onUse(themeId(saved,variant));}catch(e){error(e);}finally{setBusy(false);}
  }
  async function remove(){
    if(!draft.id||!confirm(`Delete “${draft.name}”? Its file is removed from the vault's themes folder; downloaded fonts are kept.`))return;
    setBusy(true);try{await api('/api/themes',{action:'delete',id:draft.id});const list=await api('/api/themes');props.onChanged(list.themes,list.fonts);setDirty(false);
      const next=list.themes[0];if(next){setSource(next.id);setDraft(structuredClone(next));}else{setSource('new');setDraft(blank(seed));}}catch(e){error(e);}finally{setBusy(false);}
  }
  const other:Variant=variant==='light'?'dark':'light';
  const failingOther=otherChecks.filter(c=>c.severity==='fail').length;
  const requestOpen=(next:boolean)=>{if(!next&&!confirmDiscard())return;props.onOpenChange(next);};
  return <Sheet open={open} onOpenChange={requestOpen}>
    <SheetContent onKeyDown={e=>{if(e.key==='F10'){e.preventDefault();requestOpen(false);}}} id="theme-editor" className="theme-editor data-[side=right]:w-full data-[side=right]:sm:max-w-[min(1320px,100vw)]" initialFocus={()=>document.querySelector<HTMLElement>('#theme-source')} finalFocus={()=>document.querySelector<HTMLElement>('#main')}>
      <SheetHeader className="theme-editor-head"><SheetTitle>Theme Editor</SheetTitle><SheetDescription>Every theme has a light and a dark variant. Checks use WCAG 2.2 contrast and simulated color vision; they are guides, not proof of accessibility.</SheetDescription></SheetHeader>
      <div className="theme-editor-body">
        <form className="theme-editor-form" onSubmit={e=>{e.preventDefault();if(!needsReader())save(false);}}>
          <Choice id="theme-source" label="Theme" value={source} groups={sourceItems} onChange={choose}/>
          {builtIn&&<p className="theme-note">Built-in themes ship with Reader and stay unchanged. Saving creates your own copy.</p>}
          <Field><FieldLabel htmlFor="theme-name">Name</FieldLabel><Input id="theme-name" value={draft.name} maxLength={60} required onChange={e=>update({name:e.target.value})}/></Field>
          {source==='new'&&<div className="theme-seed"><label>Seed color<input type="color" value={seed} onChange={e=>setSeed(e.target.value)}/></label><Button type="button" size="sm" variant="secondary" onClick={()=>{update({light:generateVariant(seed,'light'),dark:generateVariant(seed,'dark')});}}>Generate both variants</Button><p>Neutrals are tinted toward the seed hue; roles keep fixed lightness and chroma bands, then text is nudged until it meets contrast. Chart colors share one lightness and chroma and are picked for the widest separation under simulated color-vision deficiencies.</p></div>}
          <ButtonGroup className="theme-variant" aria-label="Variant">{(['light','dark'] as Variant[]).map(v=><Button key={v} type="button" size="sm" variant={variant===v?'default':'outline'} aria-pressed={variant===v} onClick={()=>setVariant(v)}>{v==='light'?'Light':'Dark'}{(v===variant?checks:otherChecks).some(c=>c.severity==='fail')&&<span className="theme-flag fail">!</span>}</Button>)}</ButtonGroup>
          <Button type="button" size="sm" variant="outline" onClick={()=>{if(confirm(`Replace the ${other} variant with one derived from this ${variant} variant?`))update({[other]:deriveVariant(tokens,other)} as Partial<Theme>);}}>Derive {other} variant from {variant}</Button>
          {GROUPS.map(group=><fieldset key={group} className="theme-group"><legend>{group}</legend>
            {COLOR_TOKENS.filter(t=>t.group===group).map(t=><TokenRow key={t.name} {...t} value={tokens[t.name]} flag={flags[t.name]} onChange={v=>setToken(t.name,v)}/>)}
            {group==='Accent'&&accents.length>0&&<div className="theme-suggest"><span>Vivid accents that pass 4.5:1 here</span><div>{accents.map(c=><Button key={c} type="button" variant="outline" size="icon-sm" className="rounded-full" style={{background:c}} title={c} aria-label={'Use accent '+c} onClick={()=>update({[variant]:{...tokens,accent:c,'accent-ink':bestContrastWith(c,[tokens.bg,tokens.ink,'#ffffff','#111111'])}} as Partial<Theme>)}/>)}</div></div>}
          </fieldset>)}
          <fieldset className="theme-group"><legend>Fonts</legend>
            {FONT_ROLES.map(role=><Choice key={role.name} id={'font-'+role.name} label={role.label} value={draft.fonts[role.name]||''} groups={fontGroups(role)} onChange={v=>update({fonts:{...draft.fonts,[role.name]:v||null}})}/>)}
            <FontSearch api={api} installed={fonts} error={error} onInstalled={(list,font)=>{props.onPreviewFont(font.stylesheet);props.onChanged(themes,list);}}/>
          </fieldset>
        </form>
        <div className="theme-editor-side">
          <div className="theme-preview-bar"><ButtonGroup className="theme-variant" aria-label="Preview variant">{(['light','dark'] as Variant[]).map(v=><Button key={v} type="button" size="sm" variant={variant===v?'default':'outline'} aria-pressed={variant===v} onClick={()=>setVariant(v)}>{v==='light'?'Light':'Dark'}</Button>)}</ButtonGroup>
            <Choice id="theme-simulation" label="Simulate" value={sim} groups={[{items:SIMS}]} onChange={v=>setSim(v as Simulation)}/></div>
          <Preview tokens={tokens} fonts={draft.fonts} variant={variant} sim={sim}/>
          {failingOther>0&&<p className="theme-note">The {other} variant has {failingOther} failing check{failingOther>1?'s':''}.</p>}
          <Checks checks={checks} onFix={c=>c.fix&&setToken(c.fix.token,c.fix.value)} onFixAll={()=>update({[variant]:autoFix(tokens,variant)} as Partial<Theme>)}/>
        </div>
      </div>
      <div className="theme-editor-foot">
        {!builtIn&&draft.id&&<Button type="button" variant="destructive" className="theme-delete" disabled={busy} {...localOnly()} onClick={remove}>Delete theme</Button>}
        <span className="theme-editor-state" role="status">{dirty?'Unsaved changes':draft.id?'Saved in the vault':''}</span>
        <Button type="button" variant="secondary" disabled={busy} {...localOnly()} onClick={()=>save(false)}>{builtIn||!draft.id?'Save as new theme':'Save'}</Button>
        <Button type="button" disabled={busy} {...localOnly()} onClick={()=>save(true)}>{busy?'Saving…':'Save and use'}</Button>
      </div>
    </SheetContent>
  </Sheet>;
}
