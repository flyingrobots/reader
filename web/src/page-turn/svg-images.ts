/* Inline SVG (diagrams, and anything else drawn as SVG in the article) for the page turn.
   A canvas cannot paint live SVG, and serializing plus decoding an image is asynchronous,
   while the turn rasterizes synchronously when a key is pressed. So each SVG is
   pre-serialized into an <img> ahead of the turn: its CSS variables, color and font are
   resolved and inlined (an SVG image sees none of the page's CSS), the page's own
   @font-face files are embedded as data URLs, and the image is decoded. The cache is
   keyed by element and by everything that changes the picture (size, color, resolved
   variables), so a theme change or a re-render re-serializes on the next warm. */
type Entry={key:string;image:HTMLImageElement|null;names:string[]};
const cache=new WeakMap<SVGSVGElement,Entry>();
const fontFiles=new Map<string,Promise<string|null>>();
const MAX_FONT_BYTES=1024*1024,MAX_FONTS=6,MAX_SVG_CHARS=4*1024*1024;

const outermost=(root:Element)=>[...root.querySelectorAll<SVGSVGElement>('svg')].filter(svg=>!svg.parentElement?.closest('svg'));
function variableNames(svg:SVGSVGElement){return [...new Set(svg.outerHTML.match(/var\(--[a-z0-9-]+/gi)?.map(m=>m.slice(4))??[])];}
function keyOf(svg:SVGSVGElement,entry?:Entry){
  const rect=svg.getBoundingClientRect(),style=getComputedStyle(svg),names=entry?.names??variableNames(svg);
  return {names,key:[Math.round(rect.width),Math.round(rect.height),style.color,style.fontFamily,...names.map(name=>style.getPropertyValue(name).trim())].join('|')};
}
/** The decoded image for an SVG, or null when it is not ready or out of date. */
export function svgImage(svg:SVGSVGElement):HTMLImageElement|null{
  const entry=cache.get(svg);if(!entry?.image)return null;
  return keyOf(svg,entry).key===entry.key?entry.image:null;
}
const families=(list:string)=>list.split(',').map(name=>name.trim().replace(/^["']|["']$/g,'').toLowerCase()).filter(Boolean);
function fontRules(wanted:Set<string>){
  const found:{rule:CSSFontFaceRule;base:string}[]=[];
  const visit=(rules:CSSRuleList,base:string)=>{for(const rule of rules){
    if(rule instanceof CSSFontFaceRule){if(wanted.has(families(rule.style.getPropertyValue('font-family'))[0]??''))found.push({rule,base});}
    else if(rule instanceof CSSImportRule&&rule.styleSheet){try{visit(rule.styleSheet.cssRules,rule.styleSheet.href||base);}catch{/* unreadable sheet */}}
    else if('cssRules' in rule){try{visit((rule as CSSGroupingRule).cssRules,base);}catch{/* ignore */}}
  }};
  for(const sheet of document.styleSheets){try{visit(sheet.cssRules,sheet.href||location.href);}catch{/* cross-origin sheets are never readable; the CSP allows none */}}
  return found.slice(0,MAX_FONTS);
}
function fontData(url:string){
  let pending=fontFiles.get(url);
  if(!pending){pending=fetch(url).then(async response=>{if(!response.ok)return null;const blob=await response.blob();if(blob.size>MAX_FONT_BYTES)return null;
    return await new Promise<string|null>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(typeof reader.result==='string'?reader.result:null);reader.onerror=()=>resolve(null);reader.readAsDataURL(blob);});}).catch(()=>null);fontFiles.set(url,pending);}
  return pending;
}
async function embeddedFonts(fontFamily:string){
  const css:string[]=[];
  for(const {rule,base} of fontRules(new Set(families(fontFamily)))){
    const match=/url\(\s*(['"]?)([^'")]+)\1\s*\)/.exec(rule.style.getPropertyValue('src'));if(!match)continue;
    let url:URL;try{url=new URL(match[2],base);}catch{continue;}if(url.origin!==location.origin)continue;
    const data=await fontData(url.href);if(!data)continue;
    const descriptor=(name:string)=>{const value=rule.style.getPropertyValue(name);return value?`${name}:${value};`:'';};
    css.push(`@font-face{font-family:${rule.style.getPropertyValue('font-family')};src:url(${data});${descriptor('font-weight')}${descriptor('font-style')}${descriptor('font-stretch')}}`);
  }
  return css.join('');
}
async function serialize(svg:SVGSVGElement,names:string[],scale:number){
  const rect=svg.getBoundingClientRect(),style=getComputedStyle(svg);
  if(rect.width<1||rect.height<1)return null;
  const clone=svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  clone.setAttribute('width',String(Math.ceil(rect.width*scale)));clone.setAttribute('height',String(Math.ceil(rect.height*scale)));
  for(const name of names)clone.style.setProperty(name,style.getPropertyValue(name).trim());
  // KaTeX's SVG (radicals, stretchy arrows) paints with fill: currentColor from page CSS.
  clone.style.color=style.color;clone.style.fontFamily=style.fontFamily;clone.style.fill=style.fill;if(style.stroke!=='none')clone.style.stroke=style.stroke;
  for(const property of ['max-width','max-height','width','height','margin'])clone.style.removeProperty(property);
  const fonts=await embeddedFonts(style.fontFamily+','+(style.getPropertyValue('--pele-font-mono')||''));
  if(fonts){const sheet=document.createElementNS('http://www.w3.org/2000/svg','style');sheet.textContent=fonts;clone.prepend(sheet);}
  const xml=new XMLSerializer().serializeToString(clone);if(xml.length>MAX_SVG_CHARS)return null;
  const image=new Image();image.decoding='async';image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xml);
  try{await image.decode();}catch{return null;}
  return image;
}
/** Serialize and decode every out-of-date SVG under `root`. Safe to call often. */
export async function warmSvgImages(root:Element|null,scale=Math.min(2,devicePixelRatio||1)){
  if(!root)return;
  await Promise.all(outermost(root).map(async svg=>{
    const previous=cache.get(svg),{key,names}=keyOf(svg,previous);if(previous?.key===key)return;
    const entry:Entry={key,image:null,names};cache.set(svg,entry);
    const image=await serialize(svg,names,scale);
    if(cache.get(svg)===entry)entry.image=image;
  }));
}
