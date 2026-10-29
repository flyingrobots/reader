import {COLOR_TOKENS, FONT_ROLES, HEADINGS, BUNDLED_FONTS, hex, lightness, proseColors, PROSE_TOKENS, withAlpha, type Theme, type Tokens, type Variant} from './color';

export type InstalledFont={family:string;slug:string;category:string;license:string|null;stylesheet:string};
export const themeId=(theme:Theme,variant:Variant)=>'user-'+theme.id+(variant==='dark'?'-dark':'');

export function fontStack(role:string,family:string|null|undefined){
  const info=FONT_ROLES.find(f=>f.name===role)!;const chosen=family||info.default;
  return chosen?`'${chosen}', ${info.fallback}`:info.fallback;
}
/** Custom properties for one variant; used by both the generated stylesheet and the editor preview. */
/** --hN-font and --hN-size for each level the theme sets; unset levels fall back to style.css. */
export function headingProperties(headings:Theme['headings']):Record<string,string>{
  const out:Record<string,string>={};
  for(const h of HEADINGS){const set=headings?.[h.level];if(!set)continue;
    if(set.font)out[`--${h.level}-font`]=fontStack('serif',set.font);
    if(typeof set.size==='number'&&Number.isFinite(set.size))out[`--${h.level}-size`]=`${set.size}px`;}
  return out;
}
export function variantProperties(tokens:Tokens,fonts:Theme['fonts'],variant:Variant,headings?:Theme['headings']):Record<string,string>{
  const shadow=variant==='dark'?'#00000080':withAlpha(tokens.ink.slice(0,7),.14);
  return {...Object.fromEntries(COLOR_TOKENS.map(t=>['--'+t.name,tokens[t.name]])),
    ...Object.fromEntries(Object.entries(proseColors(tokens)).map(([name,value])=>['--'+name,value])),
    ...Object.fromEntries(FONT_ROLES.map(f=>['--'+f.name,fontStack(f.name,fonts[f.name])])),
    ...headingProperties(headings),
    '--shadow':`0 32px 120px ${shadow}`,'color-scheme':variant};
}

/** Palette-only built-ins keep prose and modal signals inside their supplied swatches.
 * Labels, warning icons and underline styles continue to convey meaning without hue. */
export function paletteOnlyProperties(tokens:Tokens):Record<string,string>{
  const prose={...Object.fromEntries(PROSE_TOKENS.map(t=>['--'+t.name,tokens.ink])),
    '--prose-punct':tokens.muted,'--prose-recede':tokens.muted,'--prose-content':tokens.ink,
    '--prose-subtle-function':tokens.muted,'--prose-subtle-proper':tokens.ink,
    '--prose-subtle-number':tokens.ink,'--prose-subtle-quote':tokens.ink,
    '--prose-wash':tokens.bg,'--prose-underline':tokens.accent};
  return {...prose,...Object.fromEntries(['browse','search','insert','leader','settings','help','thread'].map(mode=>['--mode-'+mode,tokens.accent])),
    '--shadow':'none'};
}

/** Stylesheet for built-in and custom themes, using validated tokens and font names. */
export function themeStylesheet(themes:Theme[],idOf:(theme:Theme,variant:Variant)=>string=themeId){
  return themes.flatMap(theme=>(['light','dark'] as Variant[]).map(variant=>{
    const id=idOf(theme,variant),props={...variantProperties(theme[variant],theme.fonts,variant,theme.headings),...(theme.paletteOnly?paletteOnlyProperties(theme[variant]):{})};
    return `:root[data-theme="${id}"]{${Object.entries(props).map(([k,v])=>`${k}:${v}`).join(';')}}\n`+
      `:root[data-theme="${id}"] .chart-mount path[role=button],:root[data-theme="${id}"] .chart-bar-row rect:not([fill=transparent]),:root[data-theme="${id}"] .chart-mount>svg>rect{stroke:var(--chart-stroke);stroke-width:1}\n`+
      `:root[data-theme="${id}"] .chart-legend i{outline:1px solid var(--chart-stroke)}\n`;
  })).join('');
}
export function fontLinks(themes:Theme[],installed:InstalledFont[]){
  const used=new Set(themes.flatMap(t=>[...Object.values(t.fonts),...Object.values(t.headings||{}).map(h=>h?.font)].filter(Boolean) as string[]));
  return installed.filter(f=>used.has(f.family)&&!BUNDLED_FONTS.includes(f.family)).map(f=>f.stylesheet);
}

/** Apply generated CSS and font stylesheets to the document; returns the cacheable payload. */
export function applyThemes(themes:Theme[],installed:InstalledFont[],extraFonts:string[]=[]){
  const css=themeStylesheet(themes),links=[...new Set([...fontLinks(themes,installed),...extraFonts])];
  let style=document.getElementById('reader-user-themes') as HTMLStyleElement|null;
  if(!style){style=document.createElement('style');style.id='reader-user-themes';document.head.append(style);}
  style.textContent=css;
  for(const href of links)if(!document.querySelector(`link[data-theme-font][href="${href}"]`)){const link=document.createElement('link');link.rel='stylesheet';link.href=href;link.dataset.themeFont='';document.head.append(link);}
  return {css,links,ids:themes.flatMap(t=>[themeId(t,'light'),themeId(t,'dark')])};
}

/** Concrete sRGB values of a built-in theme, read from the cascade without repainting. */
export function readBuiltIn(dataTheme:string):{tokens:Tokens;fonts:Theme['fonts']}{
  const root=document.documentElement,previous=root.dataset.theme;root.dataset.theme=dataTheme;
  const probe=document.createElement('span');probe.style.display='none';document.body.append(probe);
  try{
    const style=getComputedStyle(root),tokens:Tokens={};
    for(const t of COLOR_TOKENS){
      const raw=style.getPropertyValue('--'+t.name).trim();
      if(!raw&&t.name==='chart-stroke'){tokens[t.name]=tokens.surface;continue;}
      probe.style.color=`var(--${t.name})`;tokens[t.name]=hex(getComputedStyle(probe).color);
    }
    const family=(name:string)=>{const first=style.getPropertyValue('--'+name).split(',')[0].trim().replace(/^['"]|['"]$/g,'');const role=FONT_ROLES.find(f=>f.name===name)!;return first&&first!==role.default&&!role.fallback.startsWith(first)?first:null;};
    return {tokens,fonts:Object.fromEntries(FONT_ROLES.map(f=>[f.name,family(f.name)]))};
  }finally{probe.remove();root.dataset.theme=previous;}
}
export const isLightPage=(tokens:Tokens)=>lightness(tokens.bg)>=.5;

/** Built-in themes (style.css) get derived prose colors at runtime, read from the cascade
    for the current theme only; famous and custom themes carry them in their stylesheet. */
export function ensureProseTokens(){
  const root=document.documentElement,theme=root.dataset.theme||'ink',style=getComputedStyle(root);
  if(style.getPropertyValue('--prose-recede').trim())return;
  const probe=document.createElement('span');probe.style.display='none';document.body.append(probe);
  const tokens:Tokens={};
  try{for(const t of COLOR_TOKENS){if(!style.getPropertyValue('--'+t.name).trim())continue;probe.style.color=`var(--${t.name})`;tokens[t.name]=hex(getComputedStyle(probe).color);}}finally{probe.remove();}
  if(!tokens.bg||!tokens.ink)return;
  let sheet=document.getElementById('reader-prose-tokens') as HTMLStyleElement|null;
  if(!sheet){sheet=document.createElement('style');sheet.id='reader-prose-tokens';document.head.append(sheet);}
  // Zero specificity: a theme stylesheet that arrives later still wins.
  const selector=`:where(:root[data-theme="${theme.replace(/[^a-z0-9-]/g,'')}"])`;
  sheet.textContent+=`${selector}{${Object.entries(proseColors(tokens)).map(([k,v])=>`--${k}:${v}`).join(';')}}\n`;
}
