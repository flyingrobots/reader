import {localOnly, needsReader} from '../static-demo';
import {CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockTitle} from '../components/ui/code-block';
import {useEffect, useMemo, useRef, useState, type CSSProperties} from 'react';
import {Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription} from '../components/ui/sheet';
import {Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem, SelectLabel} from '../components/ui/select';
import {Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet} from '../components/ui/field';
import {AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle} from '../components/ui/alert-dialog';
import {Badge} from '../components/ui/badge';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '../components/ui/collapsible';
import {InputGroup, InputGroupAddon, InputGroupInput} from '../components/ui/input-group';
import {Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle} from '../components/ui/item';
import {Kbd} from '../components/ui/kbd';
import {Slider} from '../components/ui/slider';
import {ToggleGroup, ToggleGroupItem} from '../components/ui/toggle-group';
import {StatusBadge} from './atoms/status-badge';
import {Notice} from './molecules/notice';
import {ChevronRightIcon} from 'lucide-react';
import {Input} from '../components/ui/input';
import {Button} from '../components/ui/button';
import {ButtonGroup} from '../components/ui/button-group';
import {bestContrastWith, COLOR_TOKENS, FONT_ROLES, HEADINGS, HEADING_SIZES, BUNDLED_FONTS, CHARTS, alphaOf, autoFix, checkVariant, deriveVariant, generateVariant, modeColors, simulateTokens, suggestAccents, withAlpha, type Check, type HeadingStyle, type Simulation, type Theme, type Tokens, type Variant} from './color';
import {FAMOUS, famousId} from './famous';
import {readBuiltIn, themeId, variantProperties, type InstalledFont} from './theme-css';

export type EditorProps={open:boolean;onOpenChange:(open:boolean)=>void;/** After the close animation ends and the sheet unmounts: the caller restores focus (#124). */onClosed?:()=>void;themes:Theme[];fonts:InstalledFont[];current:string;
  api:(path:string,payload?:unknown)=>Promise<any>;onChanged:(themes:Theme[],fonts:InstalledFont[])=>void;onUse:(dataTheme:string)=>void;onPreviewFont:(href:string)=>void;error:(error:unknown)=>void};

const BUILT_INS=[{key:'ink',name:'Ink & Paper',light:'paper',dark:'ink'},{key:'orchid',name:'Orchid',light:'orchid',dark:'orchid-dark'},{key:'harvest',name:'Harvest',light:'harvest',dark:'harvest-dark'},...FAMOUS.map(t=>({key:t.id,name:t.name,light:famousId(t.id,'light'),dark:famousId(t.id,'dark')}))];
const GROUPS=[...new Set(COLOR_TOKENS.map(t=>t.group))];
const SIMS:{value:Simulation;label:string}[]=[{value:'none',label:'Typical vision'},{value:'protanopia',label:'Protanopia'},{value:'deuteranopia',label:'Deuteranopia'},{value:'tritanopia',label:'Tritanopia'},{value:'grayscale',label:'Grayscale'}];
const variantOf=(dataTheme:string):Variant=>dataTheme==='ink'||dataTheme.endsWith('-dark')?'dark':'light';
const slugify=(name:string)=>name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,34).replace(/-dark$/,'')||'theme';

function fromBuiltIn(key:string):Theme{
  const b=BUILT_INS.find(x=>x.key===key)!,light=readBuiltIn(b.light),dark=readBuiltIn(b.dark);
  return {id:'',name:b.name+' copy',fonts:light.fonts,headings:{},light:light.tokens,dark:dark.tokens};
}
function blank(seed='#5b6ee1'):Theme{return {id:'',name:'New theme',fonts:{serif:null,sans:null,mono:null},headings:{},light:generateVariant(seed,'light'),dark:generateVariant(seed,'dark')};}
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
  return <Field data-token={name} className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-x-3 gap-y-1.5">
    <FieldContent className="min-w-0 gap-0.5">
      <FieldLabel htmlFor={'token-'+name} className="flex-wrap">{label}{flag&&<Badge variant={flag.severity==='fail'?'destructive':'outline'} data-token-flag={flag.severity} title={flag.label+': '+flag.detail}>{flag.severity==='fail'?'Fails':'Review'}</Badge>}</FieldLabel>
      <FieldDescription className="text-xs">{description}</FieldDescription>
    </FieldContent>
    <InputGroup>
      <InputGroupAddon><input type="color" aria-label={label+' color'} className="size-5 cursor-pointer rounded-sm border-0 bg-transparent p-0" value={value.slice(0,7)} onChange={e=>onChange(alpha?withAlpha(e.target.value,alphaOf(value)):e.target.value)}/></InputGroupAddon>
      <InputGroupInput id={'token-'+name} className="font-mono text-xs" value={text} spellCheck={false} maxLength={9} onChange={e=>setText(e.target.value)} onBlur={e=>commit(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commit((e.target as HTMLInputElement).value);}}}/>
    </InputGroup>
    {alpha&&<div className="col-span-2 flex items-center gap-3"><span className="text-xs text-muted-foreground">Opacity</span><Slider aria-label={label+' opacity'} className="flex-1" min={0} max={100} value={[Math.round(alphaOf(value)*100)]} onValueChange={v=>onChange(withAlpha(value,(Array.isArray(v)?v[0]:v)/100))}/><output className="w-9 text-right text-xs tabular-nums">{Math.round(alphaOf(value)*100)}%</output></div>}
  </Field>;
}

function HeadingRow({level,label,size,description,value,fontGroups,onChange}:{level:string;label:string;size:number;description:string;value:HeadingStyle;fontGroups:{label?:string;items:{value:string;label:string}[]}[];onChange:(value:HeadingStyle)=>void}){
  const [low,high]=HEADING_SIZES;const [text,setText]=useState(value.size===null?'':String(value.size));useEffect(()=>setText(value.size===null?'':String(value.size)),[value.size]);
  const commit=(raw:string)=>{const v=raw.trim();if(v===''){onChange({...value,size:null});return;}const n=Math.round(Number(v)*10)/10;if(Number.isFinite(n)&&n>=low&&n<=high)onChange({...value,size:n});else setText(value.size===null?'':String(value.size));};
  return <div className="grid gap-3 sm:grid-cols-2" data-heading={level}>
    <Choice id={'heading-font-'+level} label={label+' font'} value={value.font||''} groups={fontGroups} onChange={v=>onChange({...value,font:v||null})}/>
    <Field><FieldLabel htmlFor={'heading-size-'+level}>{label} size</FieldLabel><div className="flex items-center gap-2"><Input id={'heading-size-'+level} type="number" inputMode="decimal" min={low} max={high} step={1} placeholder={String(size)} value={text} onChange={e=>setText(e.target.value)} onBlur={e=>commit(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commit((e.target as HTMLInputElement).value);}}}/><span>px</span></div></Field>
    <FieldDescription className="text-xs sm:col-span-2">{description} Blank size keeps {size} px.</FieldDescription>
  </div>;
}

function Preview({tokens,fonts,headings,variant,sim}:{tokens:Tokens;fonts:Theme['fonts'];headings:Theme['headings'];variant:Variant;sim:Simulation}){
  const shown=simulateTokens(tokens,sim);
  const style={...variantProperties(shown,fonts,variant,headings),...Object.fromEntries(modeColors(shown,variant).map(m=>['--mode-'+m.name,m.value]))} as CSSProperties;
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
        <h3>Heading three</h3><h4>Heading four</h4><h5>Heading five</h5><h6>Heading six</h6>
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

const SEVERITY={pass:{label:'Pass',tone:'ok'},warn:{label:'Review',tone:'attention'},fail:{label:'Fail',tone:'error'}} as const;
function Checks({checks,onFix,onFixAll}:{checks:Check[];onFix:(c:Check)=>void;onFixAll:()=>void}){
  const failing=checks.filter(c=>c.severity==='fail'),warning=checks.filter(c=>c.severity==='warn');
  const groups=[...new Set(checks.map(c=>c.group))];
  return <section className="flex flex-col gap-3" aria-labelledby="theme-checks-title" data-theme-checks="">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h3 id="theme-checks-title" data-slot="section-heading" className="text-base font-medium">Checks</h3>
      <span role="status" className="text-sm text-muted-foreground">{failing.length} failing · {warning.length} to review · {checks.length-failing.length-warning.length} passing</span>
      {failing.some(c=>c.fix)&&<Button size="sm" variant="secondary" className="ml-auto" onClick={onFixAll}>Fix contrast failures</Button>}</div>
    {groups.map(group=>{const rows=checks.filter(c=>c.group===group).sort((a,b)=>'fwp'.indexOf(a.severity[0])-'fwp'.indexOf(b.severity[0]));
      // Keyed on whether the group has issues: a group opens again when a check starts failing, as <details open> did.
      const issues=rows.some(c=>c.severity!=='pass');
      return <Collapsible key={group+(issues?':issues':'')} defaultOpen={issues} className="rounded-lg border" data-check-group={group}>
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="w-full justify-start"/>}><ChevronRightIcon data-icon="inline-start" aria-hidden className="transition-transform in-data-[panel-open]:rotate-90"/>{group}<span className="ml-auto text-xs text-muted-foreground tabular-nums">{rows.filter(c=>c.severity==='pass').length}/{rows.length}</span></CollapsibleTrigger>
        <CollapsibleContent className="border-t"><ItemGroup className="gap-0">{rows.map(c=><Item key={c.id} size="xs" role="listitem" data-severity={c.severity} className="items-start">
          <ItemContent className="min-w-0"><ItemTitle className="flex-wrap"><StatusBadge tone={SEVERITY[c.severity].tone}>{SEVERITY[c.severity].label}</StatusBadge>{c.label}</ItemTitle><ItemDescription className="line-clamp-none text-xs">{c.detail}</ItemDescription></ItemContent>
          {c.fix&&c.severity!=='pass'?<ItemActions><Button size="xs" variant="outline" onClick={()=>onFix(c)} title={`Set ${c.fix.token} to ${c.fix.value}`}>Use {c.fix.value}</Button></ItemActions>:null}
        </Item>)}</ItemGroup></CollapsibleContent>
      </Collapsible>;})}
  </section>;
}

function FontSearch({api,installed,onInstalled,error}:{api:EditorProps['api'];installed:InstalledFont[];onInstalled:(fonts:InstalledFont[],font:InstalledFont)=>void;error:(e:unknown)=>void}){
  const [query,setQuery]=useState(''),[results,setResults]=useState<{family:string;category:string}[]|null>(null),[busy,setBusy]=useState<string|null>(null);
  const searchId=useRef(0);
  useEffect(()=>{if(!query.trim()){setResults(null);return;}const id=++searchId.current;const timer=setTimeout(()=>{api('/api/fonts?q='+encodeURIComponent(query.trim())).then(r=>{if(id===searchId.current)setResults(r.families);}).catch(error);},250);return ()=>clearTimeout(timer);},[query]);
  return <Field><FieldLabel htmlFor="font-search">Add a Google Font</FieldLabel>
    <Input id="font-search" placeholder="Search families, e.g. Literata" value={query} onChange={e=>setQuery(e.target.value)} autoComplete="off" spellCheck={false}/>
    <FieldDescription>Searching and adding contact Google Fonts once; the font is then stored in your vault and served locally. Reading never contacts Google.</FieldDescription>
    {results&&<ItemGroup className="gap-0 rounded-lg border" data-font-results="">{results.length===0&&<Item size="xs"><ItemDescription>No matching families.</ItemDescription></Item>}{results.slice(0,12).map(r=>{const have=installed.some(f=>f.family===r.family)||BUNDLED_FONTS.includes(r.family);return <Item key={r.family} size="xs" role="listitem" data-font={r.family}>
      <ItemContent><ItemTitle>{r.family}</ItemTitle><ItemDescription className="text-xs">{r.category}</ItemDescription></ItemContent>
      <ItemActions><Button size="xs" variant="outline" disabled={have||busy!==null} onClick={async()=>{setBusy(r.family);try{const font=await api('/api/themes',{action:'install-font',family:r.family});const list=await api('/api/themes');onInstalled(list.fonts,font);}catch(e){error(e);}finally{setBusy(null);}}}>{have?'Added':busy===r.family?'Adding…':'Add'}</Button></ItemActions></Item>;})}</ItemGroup>}
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
  // Confirmations are one AlertDialog: `ask` holds what it asks and what Confirm runs (never window.confirm).
  const [ask,setAsk]=useState<{title:string;description:string;confirm:string;run:()=>void}|null>(null);
  const unlessDirty=(run:()=>void)=>{if(!dirty)run();else setAsk({title:'Discard unsaved changes?',description:'The changes to this theme have not been saved.',confirm:'Discard',run});};
  const builtIn=source.startsWith('builtin:');
  const sourceItems=[{label:'Your themes',items:themes.map(t=>({value:t.id,label:t.name}))},{label:'Built-in (saving makes a copy)',items:BUILT_INS.map(b=>({value:'builtin:'+b.key,label:b.name}))},{items:[{value:'new',label:'New theme from a seed color'}]}].filter(g=>g.items.length);
  const choose=(value:string)=>{if(value===source)return;unlessDirty(()=>{setDirty(false);setSource(value);
    if(value==='new')setDraft(blank(seed));else if(value.startsWith('builtin:'))setDraft(fromBuiltIn(value.slice(8)));else setDraft(structuredClone(themes.find(t=>t.id===value)!));});};
  const fontGroups=(role:typeof FONT_ROLES[number])=>[{items:[{value:'',label:`Default${role.default?` (${role.default})`:' (system)'}`}]},{label:'Bundled',items:BUNDLED_FONTS.map(f=>({value:f,label:f}))},{label:'Downloaded',items:fonts.filter(f=>!BUNDLED_FONTS.includes(f.family)).map(f=>({value:f.family,label:`${f.family} · ${f.category}`}))}].filter(g=>g.items.length);
  const headingFontGroups=[{items:[{value:'',label:'Default (Reading font)'}]},{label:'Bundled',items:BUNDLED_FONTS.map(f=>({value:f,label:f}))},{label:'Downloaded',items:fonts.filter(f=>!BUNDLED_FONTS.includes(f.family)).map(f=>({value:f.family,label:`${f.family} · ${f.category}`}))}].filter(g=>g.items.length);
  async function save(use:boolean){
    const name=draft.name.trim();if(!name){error(new Error('Give the theme a name.'));return;}
    const taken=new Set([...themes.map(t=>t.id),...BUILT_INS.flatMap(b=>[b.key,b.light])]);let id=draft.id;
    if(!id){const base=slugify(name);id=base;for(let n=2;taken.has(id);n++)id=`${base.slice(0,34)}-${n}`;}
    setBusy(true);try{const saved=await api('/api/themes',{action:'save',theme:{...draft,id,name}});const list=await api('/api/themes');
      setDraft(saved);setSource(saved.id);setDirty(false);props.onChanged(list.themes,list.fonts);if(use)props.onUse(themeId(saved,variant));}catch(e){error(e);}finally{setBusy(false);}
  }
  function remove(){
    if(!draft.id)return;
    setAsk({title:`Delete “${draft.name}”?`,description:'Its file is removed from the vault’s themes folder; downloaded fonts are kept.',confirm:'Delete theme',run:()=>{void removeNow();}});
  }
  async function removeNow(){
    setBusy(true);try{await api('/api/themes',{action:'delete',id:draft.id});const list=await api('/api/themes');props.onChanged(list.themes,list.fonts);setDirty(false);
      const next=list.themes[0];if(next){setSource(next.id);setDraft(structuredClone(next));}else{setSource('new');setDraft(blank(seed));}}catch(e){error(e);}finally{setBusy(false);}
  }
  const other:Variant=variant==='light'?'dark':'light';
  const failingOther=otherChecks.filter(c=>c.severity==='fail').length;
  const requestOpen=(next:boolean)=>{if(next)props.onOpenChange(true);else unlessDirty(()=>{setDirty(false);props.onOpenChange(false);});};
  return <Sheet open={open} onOpenChange={requestOpen} onOpenChangeComplete={next=>{if(!next)props.onClosed?.();}}>
    <SheetContent onKeyDown={e=>{if(e.key==='F10'){e.preventDefault();requestOpen(false);}}} id="theme-editor" className="theme-editor data-[side=right]:w-full data-[side=right]:sm:max-w-[min(1320px,100vw)]" initialFocus={()=>document.querySelector<HTMLElement>('#theme-source')} finalFocus={false}>
      <SheetHeader className="theme-editor-head" data-ui="shadcn"><SheetTitle>Theme Editor</SheetTitle><SheetDescription>Every theme has a light and a dark variant. Checks use WCAG 2.2 contrast and simulated color vision; they are guides, not proof of accessibility.</SheetDescription></SheetHeader>
      <div className="theme-editor-body">
        <form className="theme-editor-form flex flex-col gap-6" data-ui="shadcn" onSubmit={e=>{e.preventDefault();if(!needsReader())save(false);}}>
          <Choice id="theme-source" label="Theme" value={source} groups={sourceItems} onChange={choose}/>
          {builtIn&&<Notice title="Built-in themes ship with Reader and stay unchanged.">Saving creates your own copy.</Notice>}
          <Field><FieldLabel htmlFor="theme-name">Name</FieldLabel><Input id="theme-name" value={draft.name} maxLength={60} required onChange={e=>update({name:e.target.value})}/></Field>
          {source==='new'&&<Field data-theme-seed=""><FieldLabel htmlFor="theme-seed">Seed color</FieldLabel>
            <div className="flex flex-wrap items-center gap-2"><InputGroup className="w-auto"><InputGroupAddon><input id="theme-seed" type="color" aria-label="Seed color" className="size-5 cursor-pointer rounded-sm border-0 bg-transparent p-0" value={seed} onChange={e=>setSeed(e.target.value)}/></InputGroupAddon><InputGroupInput readOnly value={seed} className="w-24 font-mono" aria-label="Seed color value"/></InputGroup>
              <Button type="button" size="sm" variant="secondary" onClick={()=>{update({light:generateVariant(seed,'light'),dark:generateVariant(seed,'dark')});}}>Generate both variants</Button></div>
            <FieldDescription>Neutrals are tinted toward the seed hue; roles keep fixed lightness and chroma bands, then text is nudged until it meets contrast. Chart colors share one lightness and chroma and are picked for the widest separation under simulated color-vision deficiencies.</FieldDescription></Field>}
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup variant="outline" size="sm" aria-label="Variant" data-theme-variant="" value={[variant]} onValueChange={v=>{if(v[0])setVariant(v[0] as Variant);}}>{(['light','dark'] as Variant[]).map(v=><ToggleGroupItem key={v} value={v}>{v==='light'?'Light':'Dark'}{(v===variant?checks:otherChecks).some(c=>c.severity==='fail')&&<Badge variant="destructive" className="ml-1 px-1" aria-label="has failing checks">!</Badge>}</ToggleGroupItem>)}</ToggleGroup>
            <Button type="button" size="sm" variant="outline" onClick={()=>setAsk({title:`Replace the ${other} variant?`,description:`It is replaced with one derived from this ${variant} variant.`,confirm:'Replace',run:()=>update({[other]:deriveVariant(tokens,other)} as Partial<Theme>)})}>Derive {other} variant from {variant}</Button>
          </div>
          {GROUPS.map(group=><FieldSet key={group} data-token-group={group}><FieldLegend>{group}</FieldLegend><FieldGroup className="gap-3">
            {COLOR_TOKENS.filter(t=>t.group===group).map(t=><TokenRow key={t.name} {...t} value={tokens[t.name]} flag={flags[t.name]} onChange={v=>setToken(t.name,v)}/>)}
            {group==='Accent'&&accents.length>0&&<Field><FieldLabel>Vivid accents that pass 4.5:1 here</FieldLabel><div className="flex flex-wrap gap-2">{accents.map(c=><Button key={c} type="button" variant="outline" size="icon-sm" className="rounded-full" style={{background:c}} title={c} aria-label={'Use accent '+c} onClick={()=>update({[variant]:{...tokens,accent:c,'accent-ink':bestContrastWith(c,[tokens.bg,tokens.ink,'#ffffff','#111111'])}} as Partial<Theme>)}/>)}</div></Field>}
          </FieldGroup></FieldSet>)}
          <FieldSet data-token-group="Fonts"><FieldLegend>Fonts</FieldLegend><FieldGroup className="gap-4">
            {FONT_ROLES.map(role=><Choice key={role.name} id={'font-'+role.name} label={role.label} value={draft.fonts[role.name]||''} groups={fontGroups(role)} onChange={v=>update({fonts:{...draft.fonts,[role.name]:v||null}})}/>)}
            <FontSearch api={api} installed={fonts} error={error} onInstalled={(list,font)=>{props.onPreviewFont(font.stylesheet);props.onChanged(themes,list);}}/>
          </FieldGroup></FieldSet>
          <FieldSet data-token-group="Headings"><FieldLegend>Headings</FieldLegend>
            <FieldDescription>Each level can take its own font and size. Default uses the Reading font at the size shown. Fonts added above appear in every list.</FieldDescription><FieldGroup className="gap-5">
            {HEADINGS.map(h=><HeadingRow key={h.level} {...h} value={draft.headings?.[h.level]||{font:null,size:null}} fontGroups={headingFontGroups}
              onChange={v=>update({headings:{...draft.headings,[h.level]:v}})}/>)}
          </FieldGroup></FieldSet>
        </form>
        <div className="theme-editor-side">
          <div className="theme-preview-bar" data-ui="shadcn"><ToggleGroup variant="outline" size="sm" aria-label="Preview variant" value={[variant]} onValueChange={v=>{if(v[0])setVariant(v[0] as Variant);}}>{(['light','dark'] as Variant[]).map(v=><ToggleGroupItem key={v} value={v}>{v==='light'?'Light':'Dark'}</ToggleGroupItem>)}</ToggleGroup>
            <Choice id="theme-simulation" label="Simulate" value={sim} groups={[{items:SIMS}]} onChange={v=>setSim(v as Simulation)}/></div>
          <Preview tokens={tokens} fonts={draft.fonts} headings={draft.headings} variant={variant} sim={sim}/>
          {failingOther>0&&<div data-ui="shadcn"><Notice tone="error" title={`The ${other} variant has ${failingOther} failing check${failingOther>1?'s':''}.`}/></div>}
          <div data-ui="shadcn"><Checks checks={checks} onFix={c=>c.fix&&setToken(c.fix.token,c.fix.value)} onFixAll={()=>update({[variant]:autoFix(tokens,variant)} as Partial<Theme>)}/></div>
        </div>
      </div>
      <div className="theme-editor-foot" id="theme-editor-foot" data-ui="shadcn">
        {!builtIn&&draft.id&&<Button type="button" variant="destructive" className="mr-auto" disabled={busy} {...localOnly()} onClick={remove}>Delete theme</Button>}
        <span className="text-sm text-muted-foreground" role="status">{dirty?'Unsaved changes':draft.id?'Saved in the vault':''}</span>
        <Button type="button" variant="secondary" disabled={busy} {...localOnly()} onClick={()=>save(false)}>{builtIn||!draft.id?'Save as new theme':'Save'}</Button>
        <Button type="button" disabled={busy} {...localOnly()} onClick={()=>save(true)}>{busy?'Saving…':'Save and use'}</Button>
      </div>
      <AlertDialog open={!!ask} onOpenChange={next=>{if(!next)setAsk(null);}}>
        <AlertDialogContent data-theme-confirm=""><AlertDialogHeader><AlertDialogTitle>{ask?.title}</AlertDialogTitle><AlertDialogDescription>{ask?.description}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={()=>{const run=ask?.run;setAsk(null);run?.();}}>{ask?.confirm}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </SheetContent>
  </Sheet>;
}
