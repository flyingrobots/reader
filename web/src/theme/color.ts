/* Color decisions for the Theme Editor, built on Culori (MIT).
   The decision vocabulary (best contrast with a surface, most vivid candidate gated by
   a contrast floor, adaptive shades, CVD separation) follows meodai's Design Book; no
   Design Book code is included, because it is AGPL-3.0 and Reader ships Apache-2.0. */
import {useMode, modeRgb, modeLrgb, modeOklab, modeOklch, parse, formatHex, formatHex8, clampChroma, wcagContrast, differenceEuclidean, filterDeficiencyProt, filterDeficiencyDeuter, filterDeficiencyTrit, type Color, type Oklch} from 'culori/fn';
import contract from '../../../src/reader_mcp/web_ui/theme-tokens.json';

useMode(modeRgb);useMode(modeLrgb);const oklab=useMode(modeOklab),oklch=useMode(modeOklch);

export type Tokens=Record<string,string>;
export type Variant='light'|'dark';
export type HeadingStyle={font:string|null;size:number|null};
export type Theme={id:string;name:string;fonts:Record<string,string|null>;headings?:Record<string,HeadingStyle>;light:Tokens;dark:Tokens;created_at?:string;updated_at?:string};
export type TokenInfo={name:string;label:string;group:string;description:string;alpha?:boolean};
export const COLOR_TOKENS:TokenInfo[]=contract.colors;
export const FONT_ROLES=contract.fonts;
export const BUNDLED_FONTS:string[]=contract.bundled_fonts;
export type HeadingInfo={level:string;label:string;size:number;description:string};
export const HEADINGS:HeadingInfo[]=contract.headings;
export const HEADING_SIZES=contract.heading_size_range as [number,number];
export const CHARTS=COLOR_TOKENS.filter(t=>t.group==='Charts'&&t.name!=='chart-stroke').map(t=>t.name);
export type ProseInfo={name:string;label:string;hue:number|'accent';description:string};
export const PROSE_TOKENS:ProseInfo[]=contract.prose as ProseInfo[];

const ΔE=differenceEuclidean('oklab');
export const SIMULATIONS={none:(c:Color)=>c,protanopia:filterDeficiencyProt(1),deuteranopia:filterDeficiencyDeuter(1),tritanopia:filterDeficiencyTrit(1),grayscale:(c:Color)=>({mode:'oklch',l:oklch(c)!.l,c:0,h:0,alpha:c.alpha} as Color)};
export type Simulation=keyof typeof SIMULATIONS;

export function toColor(value:string):Color{return parse(value)||{mode:'rgb',r:0,g:0,b:0};}
/** sRGB hex, mapping out-of-gamut colors by reducing OKLCH chroma (holds lightness and hue). */
export function hex(color:Color|string,alpha=true):string{
  const c=typeof color==='string'?toColor(color):color;const mapped=clampChroma(c,'oklch','rgb');
  return (alpha&&mapped.alpha!==undefined&&mapped.alpha<1?formatHex8(mapped):formatHex(mapped)).toLowerCase();
}
export const alphaOf=(value:string)=>toColor(value).alpha??1;
export const withAlpha=(value:string,alpha:number)=>hex({...toColor(value),alpha:Math.max(0,Math.min(1,alpha))});
export const lightness=(value:string)=>oklch(toColor(value))!.l;
export function simulate(value:string,kind:Simulation){return kind==='none'?value:hex(SIMULATIONS[kind](toColor(value)));}
export function simulateTokens(tokens:Tokens,kind:Simulation):Tokens{return Object.fromEntries(Object.entries(tokens).map(([k,v])=>[k,simulate(v,kind)]));}

/** Composite a translucent color over an opaque backdrop, as the browser paints it. */
export function over(value:string,backdrop:string):string{
  const top=toColor(value),a=top.alpha??1,f=modeRgbOf(top),b=modeRgbOf(toColor(backdrop));
  return hex({mode:'rgb',r:f.r*a+b.r*(1-a),g:f.g*a+b.g*(1-a),b:f.b*a+b.b*(1-a)});
}
function modeRgbOf(c:Color){const p=parse(formatHex(clampChroma(c,'oklch','rgb')))! as {r:number;g:number;b:number};return p;}
export const contrast=(fg:string,bg:string)=>wcagContrast(toColor(over(fg,bg)),toColor(bg));
export const distance=(a:string,b:string)=>ΔE(toColor(a),toColor(b));
/** color-mix(in oklab, a p%, b) */
export function mix(a:string,b:string,p:number){const x=oklab(toColor(a))!,y=oklab(toColor(b))!;return hex({mode:'oklab',l:x.l*p+y.l*(1-p),a:x.a*p+y.a*(1-p),b:x.b*p+y.b*(1-p)});}

/** Design Book's bestContrastWith: the candidate most readable on a surface. */
export function bestContrastWith(surface:string,candidates:string[]){return [...candidates].sort((a,b)=>contrast(b,surface)-contrast(a,surface))[0];}

/** The nearest color in OKLCH lightness (hue held, chroma mapped into sRGB) meeting a contrast target, or null. */
export function nearestPassing(value:string,backdrop:string,target:number):string|null{
  if(contrast(value,backdrop)>=target)return value;
  const start=oklch(toColor(value))!,alpha=start.alpha;
  const at=(l:number)=>hex({...start,l,alpha} as Oklch);
  let best:string|null=null,bestDelta=Infinity;
  for(const end of [0,1]){
    if(contrast(at(end),backdrop)<target)continue;
    let lo=start.l,hi=end;for(let i=0;i<28;i++){const mid=(lo+hi)/2;if(contrast(at(mid),backdrop)>=target)hi=mid;else lo=mid;}
    const delta=Math.abs(hi-start.l);if(delta<bestDelta){bestDelta=delta;best=at(hi);}
  }
  return best;
}

/** Design Book's mostVivid: highest-chroma candidates that meet a contrast floor and stay clear of reserved roles. */
export function suggestAccents(tokens:Tokens,variant:Variant,count=6):string[]{
  const base=oklch(toColor(tokens.accent))!,l=base.l;const candidates:string[]=[];
  for(let h=0;h<360;h+=15){const vivid=clampChroma({mode:'oklch',l,c:.37,h},'oklch','rgb') as Oklch;const value=hex({...vivid,c:vivid.c*.9});
    const passing=nearestPassing(value,tokens.bg,4.5);if(passing&&distance(passing,tokens.warning)>.12&&contrast(bestContrastWith(passing,[tokens.bg,tokens.ink,'#ffffff','#000000']),passing)>=4.5)candidates.push(passing);}
  candidates.sort((a,b)=>oklch(toColor(b))!.c-oklch(toColor(a))!.c);
  const chosen:string[]=[];for(const c of candidates){if(chosen.every(x=>distance(x,c)>.09))chosen.push(c);if(chosen.length===count)break;}
  return chosen.sort((a,b)=>(oklch(toColor(a))!.h??0)-(oklch(toColor(b))!.h??0));
}

// Checks

export type Severity='pass'|'warn'|'fail';
export type Check={id:string;group:string;label:string;detail:string;severity:Severity;value:string;fix?:{token:string;value:string}};
const MODES:[string,number,number,number,number,number,number][]=[
  ['browse',40,.09,195,80,.10,195],['search',40,.13,260,80,.11,260],['insert',40,.11,55,82,.12,65],['leader',40,.13,305,80,.12,305],['settings',37,.035,240,77,.035,240],['help',40,.12,345,80,.12,345],['thread',38,.10,145,78,.12,145]];
/** The footer's mode colors, mixed from fixed hues and the accent exactly as style.css does. */
export function modeColors(tokens:Tokens,variant:Variant){return MODES.map(([name,l1,c1,h1,l2,c2,h2])=>({name,value:mix(hex(variant==='dark'?{mode:'oklch',l:l2/100,c:c2,h:h2}:{mode:'oklch',l:l1/100,c:c1,h:h1}),tokens.accent,.85)}));}

function ratioCheck(id:string,group:string,label:string,fg:string,bg:string,min:number,target:number,token:string|null,backdropToken?:string):Check{
  const ratio=contrast(fg,bg),severity:Severity=ratio>=target?'pass':ratio>=min?'warn':'fail';
  // A failure moves to the floor (smallest change); a below-target pass moves to the target.
  const fixValue=severity!=='pass'&&token?nearestPassing(fg,bg,severity==='fail'?min:target):null;
  return {id,group,label,detail:`${ratio.toFixed(2)}:1, needs ${min}:1${target>min?` (aim ${target}:1)`:''}${backdropToken?` on ${backdropToken}`:''}`,severity,value:ratio.toFixed(2),...(fixValue&&token?{fix:{token,value:fixValue}}:{})};
}

export function checkVariant(tokens:Tokens,variant:Variant):Check[]{
  const t=tokens,checks:Check[]=[];const text='Text contrast (WCAG 2.2)';
  checks.push(ratioCheck('ink-bg',text,'Body text on page',t.ink,t.bg,4.5,7,'ink','bg'));
  checks.push(ratioCheck('ink-surface',text,'Text on surfaces',t.ink,t.surface,4.5,7,'ink','surface'));
  checks.push(ratioCheck('ink-raised',text,'Text on raised fills',t.ink,t.raised,4.5,4.5,'ink','raised'));
  for(const bg of ['bg','surface','raised'])checks.push(ratioCheck('muted-'+bg,text,`Muted text on ${({bg:'page',surface:'surfaces',raised:'raised fills'} as Record<string,string>)[bg]}`,t.muted,t[bg],4.5,4.5,'muted',bg));
  for(const bg of ['bg','surface'])checks.push(ratioCheck('faint-'+bg,text,`Faint text on ${bg==='bg'?'page':'surfaces'}`,t.faint,t[bg],4.5,4.5,'faint',bg));
  checks.push(ratioCheck('accent-ink',text,'Text on accent',t['accent-ink'],t.accent,4.5,4.5,'accent-ink','accent'));
  for(const bg of ['bg','surface'])checks.push(ratioCheck('accent-'+bg,text,`Links on ${bg==='bg'?'page':'surfaces'}`,t.accent,t[bg],4.5,4.5,'accent',bg));
  checks.push(ratioCheck('rust-bg',text,'Secondary emphasis on page',t.rust,t.bg,4.5,4.5,'rust','bg'));
  for(const bg of ['bg','surface'])checks.push(ratioCheck('warning-'+bg,text,`Warning on ${bg==='bg'?'page':'surfaces'}`,t.warning,t[bg],4.5,4.5,'warning',bg));
  for(const token of ['selection','own','other'])checks.push(ratioCheck('ink-'+token,text,`Text over ${COLOR_TOKENS.find(x=>x.name===token)!.label.toLowerCase()}`,t.ink,over(t[token],t.bg),4.5,4.5,null));
  for(const mode of modeColors(t,variant)){const c=ratioCheck('mode-'+mode.name,'Mode labels',`${mode.name.toUpperCase()} label`,t['accent-ink'],mode.value,4.5,4.5,'accent-ink');if(c.severity!=='pass')checks.push(c);}
  const ui='Interface boundaries';
  const lineRatio=contrast(t.line,t.bg);checks.push({id:'line',group:ui,label:'Rules visible on page',detail:`${lineRatio.toFixed(2)}:1; decorative rules read at about 1.2:1 or more`,severity:lineRatio>=1.2?'pass':'warn',value:lineRatio.toFixed(2)});
  checks.push(ratioCheck('accent-ui',ui,'Focus ring and controls on page (non-text 3:1)',t.accent,t.bg,3,3,'accent','bg'));
  const layers=distance(t.surface,t.bg),raised=distance(t.raised,t.surface);
  checks.push({id:'layers',group:ui,label:'Surface layers distinguishable',detail:`ΔE_OK page→surface ${layers.toFixed(3)}, surface→raised ${raised.toFixed(3)}; aim ≥ 0.012`,severity:layers>=.012&&raised>=.012?'pass':'warn',value:layers.toFixed(3)});
  const L=(k:string)=>lightness(t[k]);const ordered=variant==='light'?L('ink')<L('muted')&&L('muted')<=L('faint')+.001:L('ink')>L('muted')&&L('muted')>=L('faint')-.001;
  checks.push({id:'hierarchy',group:ui,label:'Text hierarchy by lightness',detail:'Text → muted → faint should step steadily away from the text color.',severity:ordered?'pass':'warn',value:''});
  const polarity=variant==='light'?L('bg')>=.6:L('bg')<=.4;
  checks.push({id:'polarity',group:ui,label:variant==='light'?'Light variant has a light page':'Dark variant has a dark page',detail:`Page lightness ${(L('bg')*100).toFixed(0)}% (OKLCH)`,severity:polarity?'pass':'fail',value:''});
  const charts='Charts';
  for(const name of CHARTS){const page=contrast(t[name],t.bg),stroke=contrast(t[name],over(t['chart-stroke'],t.bg)),best=Math.max(page,stroke);
    checks.push({id:name,group:charts,label:`${COLOR_TOKENS.find(x=>x.name===name)!.label} separable`,detail:`${page.toFixed(2)}:1 on page, ${stroke.toFixed(2)}:1 against border; needs 3:1 against one`,severity:best>=3?'pass':'warn',value:best.toFixed(2),...(best<3?{fix:{token:name,value:nearestPassing(t[name],t.bg,3)??t[name]}}:{})});}
  const prose=proseColors(t),pg='Prose colors (derived)',label=(role:string)=>role==='punct'?'Punctuation':role==='content'?'Content words':PROSE_TOKENS.find(r=>r.name==='prose-'+role)!.label;
  for(const intensity of ['subtle','clear','vivid'] as const){const name=intensity[0].toUpperCase()+intensity.slice(1);
    for(const [role,value] of Object.entries(prosePaint(prose,intensity))){
      const floor=role==='content'?PROSE_FLOORS.content:intensity==='clear'&&(role==='function'||role==='punct')?PROSE_FLOORS.recede:PROSE_FLOORS.role;
      if(intensity==='clear'&&role==='punct')continue;
      checks.push(ratioCheck(`prose-${intensity}-${role}`,pg,`${name}: ${label(role)}${floor===PROSE_FLOORS.recede?' (receding, large-text floor)':''}`,value,t.bg,floor,floor,null,'bg'));}}
  let close={d:Infinity,a:'',b:''};const vividRoles=PROSE_TOKENS.map(r=>r.name);
  for(let i=0;i<vividRoles.length;i++){const a=prose[vividRoles[i]];for(const [b,other] of [...vividRoles.slice(i+1).map(n=>[n,prose[n]]),['ink',t.ink],['muted',t.muted]]){const d=distance(a,other);if(d<close.d)close={d,a:vividRoles[i].slice(6),b:b.replace('prose-','')};}}
  checks.push({id:'prose-vivid-distinct',group:pg,label:'Vivid: roles distinguishable',detail:`Closest pair ${close.a} / ${close.b}: ΔE_OK ${close.d.toFixed(3)}; needs ${PROSE_FLOORS.distinct} between roles, ink and muted`,severity:close.d>=PROSE_FLOORS.distinct?'pass':'warn',value:close.d.toFixed(3)});
  const washed=over(prose['prose-wash'],t.bg),worstWash=Math.min(...[t.ink,...vividRoles.map(n=>prose[n])].map(v=>contrast(v,washed)));
  checks.push({id:'prose-vivid-wash',group:pg,label:'Vivid: text over the quoted-passage wash',detail:`${worstWash.toFixed(2)}:1 worst; needs 4.5:1`,severity:worstWash>=4.5?'pass':'fail',value:worstWash.toFixed(2)});
  const cvd='Color vision';
  for(const kind of ['none','protanopia','deuteranopia','tritanopia'] as Simulation[]){
    const sim=(v:string)=>simulate(v,kind);let worst={d:Infinity,a:'',b:''};
    for(let i=0;i<CHARTS.length;i++)for(let j=i+1;j<CHARTS.length;j++){const d=distance(sim(t[CHARTS[i]]),sim(t[CHARTS[j]]));if(d<worst.d)worst={d,a:CHARTS[i],b:CHARTS[j]};}
    const label=kind==='none'?'Typical vision':kind[0].toUpperCase()+kind.slice(1);
    checks.push({id:'cvd-chart-'+kind,group:cvd,label:`Chart colors · ${label}`,detail:`Closest pair ${worst.a} / ${worst.b}: ΔE_OK ${worst.d.toFixed(3)}; aim ≥ 0.06 (legends still name every series)`,severity:worst.d>=.06?'pass':'warn',value:worst.d.toFixed(3)});
    const hl=distance(sim(over(t.own,t.bg)),sim(over(t.other,t.bg)));
    checks.push({id:'cvd-highlights-'+kind,group:cvd,label:`Your vs others' highlights · ${label}`,detail:`ΔE_OK ${hl.toFixed(3)}; aim ≥ 0.04`,severity:hl>=.04?'pass':'warn',value:hl.toFixed(3)});
    const warn=distance(sim(t.warning),sim(t.accent));
    checks.push({id:'cvd-warning-'+kind,group:cvd,label:`Warning vs accent · ${label}`,detail:`ΔE_OK ${warn.toFixed(3)}; aim ≥ 0.08`,severity:warn>=.08?'pass':'warn',value:warn.toFixed(3)});
  }
  return checks;
}

// Prose colors (Colorful Language roles)

/** Floors per intensity. Clear lets the skeleton (function words, punctuation) recede to
    WCAG's large-text level, 3:1: it is de-emphasized, and the content words, which carry the
    meaning, stay at 7:1 or more. Every colored role reads at 4.5:1. */
export const PROSE_FLOORS={recede:3,role:4.5,content:7,distinct:.08};
const PROSE_ROLE_NAMES=PROSE_TOKENS.map(r=>r.name);
const hueGap=(a:number,b:number)=>Math.abs(((a-b+540)%360)-180);

/** OKLCH lightness from `value` toward the page until contrast falls to just above `target`:
    the faintest version of the color that still meets it. */
export function recedeTo(value:string,backdrop:string,target:number):string{
  if(contrast(value,backdrop)<target)return nearestPassing(value,backdrop,target)??value;
  const start=oklch(toColor(value))!,end=oklch(toColor(backdrop))!.l;
  const at=(l:number)=>hex({...start,l} as Oklch,false);
  let lo=start.l,hi=end;for(let i=0;i<28;i++){const mid=(lo+hi)/2;if(contrast(at(mid),backdrop)>=target)lo=mid;else hi=mid;}
  return at(lo);
}

/** Vivid roles aim above their 4.5:1 floor so they still read at 4.5:1 over the quoted-passage wash. */
const VIVID_TARGET=5;
/** A saturated version of a color at VIVID_TARGET: chroma raised to `floor` (within sRGB), then the
    nearest passing lightness. */
function vivid(value:string,bg:string,floor:number):string|null{
  const c=oklch(toColor(value))!;const raised=hex(clampChroma({mode:'oklch',l:c.l,c:Math.max(c.c,floor),h:c.h??0},'oklch','rgb'),false);
  return nearestPassing(raised,bg,VIVID_TARGET);
}

/** Every derived prose color for a variant (see theme-tokens.json "prose_note").
    Vivid roles are chosen greedily, proper nouns first: each tries the theme's own colors
    near its hue, then synthesized hues stepping away from its target, and keeps the first
    that reads at 4.5:1 and stays 0.08 ΔE_OK from ink, muted and the roles already chosen.
    Derived, never stored, so built-in, famous and custom themes all have them. */
export function proseColors(tokens:Tokens):Tokens{
  const bg=tokens.bg,ink=tokens.ink,muted=tokens.muted||mix(ink,bg,.6);
  const pool=['rust',...CHARTS].filter(name=>tokens[name]).map(name=>({name,value:hex(tokens[name],false),c:oklch(toColor(tokens[name]))!}));
  const colorful=pool.filter(p=>p.c.c>=.035);
  const chroma=Math.max(.12,Math.min(.18,colorful.length?colorful.map(p=>p.c.c).sort((a,b)=>a-b)[Math.floor(colorful.length/2)]:.14));
  const dark=lightness(bg)<.5,light=dark?.78:.52;
  const accent=oklch(toColor(tokens.accent||ink))!;
  const content=contrast(ink,bg)>=PROSE_FLOORS.content?hex(ink,false):nearestPassing(ink,bg,PROSE_FLOORS.content)??hex(ink,false);
  const avoid=[ink,content,muted],chosen:string[]=[],used=new Set<string>(),out:Tokens={};
  const spread=(v:string)=>Math.min(...[...avoid,...chosen].map(x=>distance(v,x)));
  for(const role of [...PROSE_TOKENS].sort((a,b)=>(a.hue==='accent'?0:1)-(b.hue==='accent'?0:1))){
    const target=role.hue==='accent'?(accent.h??250):Number(role.hue);
    const candidates:{value:string;from?:string}[]=[];
    if(role.hue==='accent'&&tokens.accent)candidates.push({value:hex(tokens.accent,false)});
    for(const p of colorful.filter(p=>!used.has(p.name)&&hueGap(p.c.h??0,target)<=40).sort((x,y)=>hueGap(x.c.h??0,target)-hueGap(y.c.h??0,target)))candidates.push({value:p.value,from:p.name});
    for(const step of [0,15,-15,30,-30,45,-45,60,-60,90,-90,120,-120,150,-150,180])for(const l of [light,dark?.86:.42,dark?.7:.6])
      candidates.push({value:hex({mode:'oklch',l,c:chroma,h:(target+step+360)%360} as Oklch,false)});
    let best:{value:string;from?:string}|null=null,bestSpread=-1;
    for(const candidate of candidates){
      const value=vivid(candidate.value,bg,role.hue==='accent'?.12:.11);if(!value)continue;
      // Function words are a third of all words: keep them at least 60° of hue from the names.
      if(role.name==='prose-function'&&out['prose-proper']&&hueGap(oklch(toColor(value))!.h??0,oklch(toColor(out['prose-proper']))!.h??0)<60)continue;
      // Aim well past the floor (0.11 between roles; names 0.14 from ink, so they stand out in Clear).
      const s=Math.min(spread(value),role.hue==='accent'?Math.min(distance(value,ink),distance(value,content))-.03:Infinity);
      if(s>=.11){best={...candidate,value};break;}
      if(s>bestSpread){bestSpread=s;best={...candidate,value};}
    }
    const value=best?.value??bestContrastWith(bg,[ink,'#ffffff','#000000']);
    if(best?.from)used.add(best.from);chosen.push(value);out[role.name]=value;
  }
  const ordered:Tokens=Object.fromEntries(PROSE_ROLE_NAMES.map(name=>[name,out[name]]));
  const pass=(v:string)=>contrast(v,bg)>=PROSE_FLOORS.role?v:nearestPassing(v,bg,PROSE_FLOORS.role)??v;
  ordered['prose-punct']=pass(muted);
  ordered['prose-recede']=recedeTo(muted,bg,PROSE_FLOORS.recede);
  ordered['prose-content']=content;
  ordered['prose-subtle-function']=pass(mix(muted,ink,.82));
  ordered['prose-subtle-proper']=pass(mix(out['prose-proper'],ink,.42));
  ordered['prose-subtle-number']=pass(mix(out['prose-number'],ink,.42));
  ordered['prose-subtle-quote']=pass(mix(out['prose-quote'],ink,.55));
  // The quoted-passage wash: as strong as it can be while every role and ink still read at 4.5:1 over it.
  const inks=[ink,ordered['prose-content'],ordered['prose-punct'],...PROSE_ROLE_NAMES.map(n=>out[n])];
  let alpha=dark?.2:.22;
  while(alpha>.02&&inks.some(v=>contrast(v,over(withAlpha(out['prose-quote'],alpha),bg))<PROSE_FLOORS.role+.05))alpha-=.01; // margin for 8-bit alpha
  ordered['prose-wash']=withAlpha(out['prose-quote'],alpha);
  ordered['prose-underline']=withAlpha(out['prose-proper'],.7);
  return ordered;
}

/** Per-intensity paint for each role, as the reader applies it (style.css body.prose-*). */
export function prosePaint(p:Tokens,intensity:'subtle'|'clear'|'vivid'):Record<string,string>{
  if(intensity==='subtle')return {function:p['prose-subtle-function'],punct:p['prose-subtle-function'],proper:p['prose-subtle-proper'],number:p['prose-subtle-number'],quote:p['prose-subtle-quote']};
  if(intensity==='clear')return {function:p['prose-recede'],punct:p['prose-recede'],proper:p['prose-proper'],number:p['prose-number'],quote:p['prose-quote'],content:p['prose-content']};
  return {...Object.fromEntries(PROSE_TOKENS.map(r=>[r.name.slice(6),p[r.name]])),punct:p['prose-punct'],content:p['prose-content']};
}

// Generation

type Role={l:number;c:number;h?:number;alpha?:number};
const TEMPLATE:Record<Variant,Record<string,Role>>={
  light:{bg:{l:.965,c:.012},surface:{l:.985,c:.008},raised:{l:.93,c:.014},line:{l:.87,c:.016},ink:{l:.27,c:.03},muted:{l:.46,c:.03},faint:{l:.53,c:.025},accent:{l:.45,c:.12},rust:{l:.47,c:.12,h:50},warning:{l:.5,c:.17,h:27},selection:{l:.8,c:.13,h:95,alpha:.32},own:{l:.8,c:.12,alpha:.34},other:{l:.75,c:.09,h:-1,alpha:.3},chart:{l:.6,c:.13},'chart-stroke':{l:.4,c:.06}},
  dark:{bg:{l:.17,c:.012},surface:{l:.205,c:.014},raised:{l:.25,c:.016},line:{l:.33,c:.018},ink:{l:.93,c:.015},muted:{l:.76,c:.02},faint:{l:.64,c:.02},accent:{l:.8,c:.1},rust:{l:.79,c:.09,h:55},warning:{l:.77,c:.12,h:25},selection:{l:.78,c:.11,h:95,alpha:.27},own:{l:.82,c:.1,alpha:.27},other:{l:.75,c:.08,h:-1,alpha:.26},chart:{l:.76,c:.11},'chart-stroke':{l:.17,c:.012}},
};
const role=(r:Role,h:number)=>hex({mode:'oklch',l:r.l,c:r.c,h:r.h===-1?(h+180)%360:r.h??h,...(r.alpha!==undefined?{alpha:r.alpha}:{})} as Oklch);

/** Eight categorical colors from three lightness bands at one chroma, picked greedily for the largest worst-case separation across CVD simulations. */
export function chartColors(h:number,r:Role):string[]{
  const candidates=[0,-.12,.12].flatMap(dl=>Array.from({length:24},(_,i)=>role({...r,l:r.l+dl},(h+i*15)%360)));const chosen=[candidates[0]];
  const separation=(a:string,b:string)=>Math.min(...(['none','protanopia','deuteranopia','tritanopia'] as Simulation[]).map(k=>distance(simulate(a,k),simulate(b,k))));
  while(chosen.length<8){let best=candidates[1],score=-1;for(const c of candidates){if(chosen.includes(c))continue;const s=Math.min(...chosen.map(x=>separation(x,c)));if(s>score){score=s;best=c;}}chosen.push(best);}
  return chosen;
}

/** Repair every fixable text-contrast failure by nudging the foreground's lightness. */
export function autoFix(tokens:Tokens,variant:Variant):Tokens{
  let next={...tokens};for(let pass=0;pass<3;pass++)for(const check of checkVariant(next,variant))if(check.severity==='fail'&&check.fix&&!check.id.startsWith('cvd'))next={...next,[check.fix.token]:check.fix.value};
  return next;
}

/** A complete variant from one seed: neutrals tinted toward the seed hue, roles from fixed lightness/chroma bands. */
export function generateVariant(seed:string,variant:Variant):Tokens{
  const s=oklch(toColor(seed))!,h=s.h??250,t=TEMPLATE[variant];const tokens:Tokens={};
  for(const [name,r] of Object.entries(t))if(name!=='chart')tokens[name]=role(name==='accent'?{...r,c:Math.min(Math.max(s.c,.04),r.c+.04)}:r,h);
  const rh=oklch(toColor(tokens.rust))!.h??50;if(Math.abs(((rh-h+540)%360)-180)>150)tokens.rust=role({...t.rust,h:(h+150)%360},h);
  const wh=oklch(toColor(tokens.warning))!.h??27;if(Math.abs(((wh-h+540)%360)-180)>155)tokens.warning=role({...t.warning,h:(h+40)%360},h);
  chartColors(h,t.chart).forEach((c,i)=>{tokens[CHARTS[i]]=c;});
  tokens['accent-ink']=bestContrastWith(tokens.accent,[tokens.bg,tokens.ink,'#ffffff','#111111']);
  return autoFix(tokens,variant);
}

/** Map an existing variant to the other polarity, keeping each token's hue and character. */
export function deriveVariant(tokens:Tokens,to:Variant):Tokens{
  const t=TEMPLATE[to],out:Tokens={};
  for(const [name,value] of Object.entries(tokens)){
    const c=oklch(toColor(value))!,r=name.startsWith('chart-')&&name!=='chart-stroke'?t.chart:t[name];
    if(!r){out[name]=value;continue;}
    const chroma=name==='accent'||name.startsWith('chart')?Math.min(c.c,r.c+.04):Math.min(c.c,r.c*1.5);
    out[name]=hex({mode:'oklch',l:r.l,c:chroma,h:c.h??0,...(c.alpha!==undefined&&c.alpha<1?{alpha:c.alpha}:{})} as Oklch);
  }
  out['accent-ink']=bestContrastWith(out.accent,[out.bg,out.ink,'#ffffff','#111111']);
  return autoFix(out,to);
}
