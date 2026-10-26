/* Paint one page of the live, laid-out article into a canvas, for the 3D page turn.
   Nothing is re-laid-out: every word is drawn at the rectangle the browser already
   gave it, so justification, hyphen-free wrapping and column breaks are exact.
   Covered: text (font, color, case, letter spacing, underline), block backgrounds and
   borders, CSS custom highlights (annotations, find, prose and code syntax colors), images and canvases (PDF pages), and inline SVG through
   images pre-serialized by svg-images.ts. A flat icon SVG (Lucide-style path, circle,
   ellipse, rect, line, polyline, polygon) whose image is not ready yet is drawn from its
   shapes instead; diagrams and formulas only ever come from their image, never twice.
   Not covered: SVG text outside images, gradients, shadows and transforms. The turn lasts under a second and the real
   DOM replaces the texture when it ends. */
import {svgImage} from './svg-images';
export type Box={x:number;y:number;w:number;h:number};
const hit=(r:DOMRect|Box,b:Box)=>('width' in r?r.width:r.w)>0&&('height' in r?r.height:r.h)>0&&('left' in r?r.left:r.x)<b.x+b.w&&('right' in r?r.right:r.x+r.w)>b.x&&('top' in r?r.top:r.y)<b.y+b.h&&('bottom' in r?r.bottom:r.y+r.h)>b.y;
// Content of a closed <details> (other than its summary) still reports rectangles in Chrome; never paint it.
const concealed=(el:Element):boolean=>{const details=el.closest('details:not([open])');if(!details)return false;const summary=el.closest('summary');return !(summary&&summary.parentElement===details)||concealed(details);};
const shown=(el:Element)=>!concealed(el);
const visible=(color:string)=>!!color&&color!=='transparent'&&!/rgba?\([^)]*,\s*0\)$/.test(color)&&!/\/\s*0\)$/.test(color);
const HIGHLIGHTS:Record<string,{fill?:string;wavy?:string;ink?:string;line?:string}>={'reader-own':{fill:'--own'},'reader-other':{fill:'--other'},'reader-find':{fill:'--selection'},'reader-current':{fill:'--accent',ink:'--accent-ink'},'reader-warning':{wavy:'--warning'},'reader-visual':{fill:'--selection'},'reader-cursor':{line:'--accent'}};
// Prose colors (Colorful Language) are read from <body>, where the intensity class sets them,
// and lose to every annotation or find ink. Their ranges never cross a text node.
// Syntax roles of the Code Block highlighter (code-blocks.ts CODE_ROLES).
const CODE_ROLES=['keyword','string','string-expression','constant','function','parameter','punctuation','comment','link'];
const PROSE=['function','proper','quote','number','punct','noun','verb','adjective','adverb'];

export function rasterize(article:HTMLElement,page:Box,dx:number,background:string,scale:number):HTMLCanvasElement{
  const canvas=document.createElement('canvas');canvas.width=Math.round(page.w*scale);canvas.height=Math.round(page.h*scale);
  const ctx=canvas.getContext('2d')!;ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);
  const src={x:page.x+dx,y:page.y,w:page.w,h:page.h};
  ctx.scale(scale,scale);ctx.translate(-src.x,-src.y);
  const root=getComputedStyle(document.documentElement),token=(name:string)=>root.getPropertyValue(name).trim();
  const tops=[...article.children].filter(el=>!el.classList.contains('annotation-pin')&&[...el.getClientRects()].some(r=>hit(r,src))) as HTMLElement[];
  const clips=new Map<Element,DOMRect|null>();
  const clipOf=(el:Element|null):DOMRect|null=>{
    if(!el||el===article)return null;if(clips.has(el))return clips.get(el)!;
    const style=getComputedStyle(el),own=style.overflowX!=='visible'||style.overflowY!=='visible'?el.getBoundingClientRect():null;
    const parent=clipOf(el.parentElement);let clip=own;
    if(own&&parent){const l=Math.max(own.left,parent.left),t=Math.max(own.top,parent.top),r=Math.min(own.right,parent.right),b=Math.min(own.bottom,parent.bottom);clip=new DOMRect(l,t,Math.max(0,r-l),Math.max(0,b-t));}
    else if(!own)clip=parent;
    clips.set(el,clip);return clip;
  };
  const withClip=(el:Element|null,draw:()=>void)=>{const clip=clipOf(el);if(clip){ctx.save();ctx.beginPath();ctx.rect(clip.left,clip.top,clip.width,clip.height);ctx.clip();draw();ctx.restore();}else draw();};

  // 1. Box decorations, outermost first.
  for(const top of tops)for(const el of [top,...top.querySelectorAll<HTMLElement>('*')]){
    if(el.closest('.annotation-pin'))continue;
    const node=el as Element;
    if(node instanceof SVGElement){
      // Inline SVG is drawn whole from its cached image; its parts are never painted one by one.
      if(node instanceof SVGSVGElement&&!node.parentElement?.closest('svg')){const image=svgImage(node);
        if(image&&shown(node))withClip(node.parentElement,()=>{for(const r of node.getClientRects())if(hit(r,src))try{ctx.drawImage(image,r.left,r.top,r.width,r.height);}catch{/* undecodable: leave the box */}});}
      continue;
    }
    const style=getComputedStyle(el);if(style.visibility==='hidden'||style.display==='contents')continue;
    const bg=style.backgroundColor,sides=(['Top','Right','Bottom','Left'] as const).map(side=>({side,width:parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`))||0,color:style.getPropertyValue(`border-${side.toLowerCase()}-color`),line:style.getPropertyValue(`border-${side.toLowerCase()}-style`)})).filter(b=>b.width>0&&b.line!=='none'&&visible(b.color));
    const media=el instanceof HTMLImageElement||el instanceof HTMLCanvasElement;
    if(!visible(bg)&&!sides.length&&!media)continue;
    if(!shown(el))continue;
    const radius=parseFloat(style.borderTopLeftRadius)||0;
    withClip(el.parentElement,()=>{for(const r of el.getClientRects()){if(!hit(r,src))continue;
      if(visible(bg)){ctx.fillStyle=bg;ctx.beginPath();ctx.roundRect(r.left,r.top,r.width,r.height,radius);ctx.fill();}
      for(const b of sides){ctx.fillStyle=b.color;const w=b.width;
        if(b.side==='Top')ctx.fillRect(r.left,r.top,r.width,w);else if(b.side==='Bottom')ctx.fillRect(r.left,r.bottom-w,r.width,w);else if(b.side==='Left')ctx.fillRect(r.left,r.top,w,r.height);else ctx.fillRect(r.right-w,r.top,w,r.height);}
      if(media){const source=el as HTMLImageElement|HTMLCanvasElement;const natural=source instanceof HTMLImageElement?{w:source.naturalWidth,h:source.naturalHeight,ok:source.complete&&source.naturalWidth>0}:{w:source.width,h:source.height,ok:source.width>0};
        if(natural.ok){let w=r.width,h=r.height,x=r.left,y=r.top;if(style.objectFit==='contain'){const k=Math.min(r.width/natural.w,r.height/natural.h);w=natural.w*k;h=natural.h*k;x+=(r.width-w)/2;y+=(r.height-h)/2;}try{ctx.drawImage(source,x,y,w,h);}catch{/* tainted or not decodable: leave the box */}}}
    }});
  }
  // 1b. Fallback for flat inline SVG icons whose pre-serialized image (pass 1) is not ready:
  // drawn from their shapes, scaled from the viewBox. Diagrams and formulas are skipped here
  // (only their image is drawn), and an SVG with a ready image was already painted.
  for(const top of tops)for(const svg of top.querySelectorAll<SVGSVGElement>('svg')){
    if(svg.closest('.annotation-pin,.reader-diagram-canvas,.katex,.reader-math')||svg.parentElement?.closest('svg')||svgImage(svg)||!shown(svg))continue;const box=svg.getBoundingClientRect();if(!hit(box,src))continue;
    const style=getComputedStyle(svg);if(style.visibility==='hidden'||style.display==='none'||+style.opacity===0)continue;
    const view=svg.viewBox?.baseVal,vw=view?.width||box.width,vh=view?.height||box.height;
    withClip(svg.parentElement,()=>{ctx.save();ctx.translate(box.left,box.top);ctx.scale(box.width/vw,box.height/vh);if(view)ctx.translate(-view.x,-view.y);
      for(const shape of svg.querySelectorAll<SVGElement>('path,circle,ellipse,rect,line,polyline,polygon')){
        const a=(name:string)=>parseFloat(shape.getAttribute(name)||'0')||0,path=new Path2D(),kind=shape.tagName.toLowerCase();
        if(kind==='path')path.addPath(new Path2D(shape.getAttribute('d')||''));
        else if(kind==='circle')path.arc(a('cx'),a('cy'),a('r'),0,Math.PI*2);
        else if(kind==='ellipse')path.ellipse(a('cx'),a('cy'),a('rx'),a('ry'),0,0,Math.PI*2);
        else if(kind==='rect')path.roundRect(a('x'),a('y'),a('width'),a('height'),a('rx')||a('ry'));
        else if(kind==='line'){path.moveTo(a('x1'),a('y1'));path.lineTo(a('x2'),a('y2'));}
        else{const points=(shape.getAttribute('points')||'').trim().split(/[\s,]+/).map(Number);for(let i=0;i+1<points.length;i+=2)i?path.lineTo(points[i],points[i+1]):path.moveTo(points[i],points[i+1]);if(kind==='polygon')path.closePath();}
        const shapeStyle=getComputedStyle(shape);
        if(visible(shapeStyle.fill)&&shapeStyle.fill!=='none'){ctx.fillStyle=shapeStyle.fill;ctx.fill(path);}
        if(visible(shapeStyle.stroke)&&shapeStyle.stroke!=='none'){ctx.strokeStyle=shapeStyle.stroke;ctx.lineWidth=parseFloat(shapeStyle.strokeWidth)||1;ctx.lineCap=shapeStyle.strokeLinecap as CanvasLineCap;ctx.lineJoin=shapeStyle.strokeLinejoin as CanvasLineJoin;ctx.stroke(path);}
      }
      ctx.restore();});
  }
  // 2. CSS custom highlights under the text.
  const highlights=(CSS as unknown as {highlights?:Map<string,Set<AbstractRange>>}).highlights;
  const inkRanges:{range:Range;ink:string}[]=[];
  // Prose washes (Vivid's quoted passages) and underlines (Vivid's names) go under everything else.
  const body=getComputedStyle(document.body);
  if(highlights)for(const role of [...PROSE,'quoted']){const set=highlights.get('reader-prose-'+role);if(!set)continue;
    const fill=body.getPropertyValue('--prose-bg-'+role).trim(),line=body.getPropertyValue('--prose-line-'+role).trim();if(!visible(fill)&&!visible(line))continue;
    for(const range of set){if(!(range instanceof Range)||!article.contains(range.commonAncestorContainer))continue;
      for(const r of range.getClientRects()){if(!hit(r,src))continue;
        if(visible(fill)){ctx.fillStyle=fill;ctx.fillRect(r.left,r.top,r.width,r.height);}
        if(visible(line)){ctx.fillStyle=line;ctx.fillRect(r.left,r.bottom-Math.max(2,r.height*.17),r.width,1);}}}}
  if(highlights)for(const [name,set] of highlights){const spec=HIGHLIGHTS[name];if(!spec)continue;
    for(const range of set){if(!(range instanceof Range)||!article.contains(range.commonAncestorContainer))continue;
      for(const r of range.getClientRects()){if(!hit(r,src))continue;
        if(spec.fill){ctx.fillStyle=token(spec.fill);ctx.fillRect(r.left,r.top,r.width,r.height);}
        if(spec.line){ctx.fillStyle=token(spec.line);ctx.fillRect(r.left,r.bottom-1,r.width,2);}
        if(spec.wavy){ctx.strokeStyle=token(spec.wavy);ctx.lineWidth=1.5;ctx.beginPath();for(let x=r.left,i=0;x<=r.right;x+=3,i++)ctx.lineTo(x,r.bottom-1+(i%2?1.5:-1.5));ctx.stroke();}}
      if(spec.ink)inkRanges.push({range,ink:token(spec.ink)});}}
  const proseInk=new Map<Node,[number,number,string][]>();
  if(highlights)for(const role of PROSE){const set=highlights.get('reader-prose-'+role),ink=body.getPropertyValue('--prose-ink-'+role).trim();if(!set||!ink)continue;
    for(const range of set){const node=(range as Range).startContainer;if(node!==(range as Range).endContainer||!article.contains(node))continue;
      let list=proseInk.get(node);if(!list)proseInk.set(node,list=[]);list.push([(range as Range).startOffset,(range as Range).endOffset,ink]);}}
  // Code Block syntax colors (code-blocks.ts): one range per token inside one line's text node.
  if(highlights)for(const role of CODE_ROLES){const set=highlights.get('reader-syntax-'+role),ink=token('--code-'+role);if(!set||!ink)continue;
    for(const range of set){const node=(range as Range).startContainer;if(node!==(range as Range).endContainer||!article.contains(node))continue;
      let list=proseInk.get(node);if(!list)proseInk.set(node,list=[]);list.push([(range as Range).startOffset,(range as Range).endOffset,ink]);}}
  // 3. Text, word by word at the browser's own rectangles.
  const range=document.createRange();
  for(const top of tops){
    const walker=document.createTreeWalker(top,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode() as Text|null;node;node=walker.nextNode() as Text|null){
      const parent=node.parentElement;if(!parent||parent.closest('.annotation-pin,script,style,.sr-only,svg,.katex-mathml'))continue;
      range.selectNodeContents(node);if(![...range.getClientRects()].some(r=>hit(r,src))||!shown(parent))continue;
      const style=getComputedStyle(parent);if(style.visibility==='hidden'||!visible(style.color))continue;
      ctx.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      (ctx as CanvasRenderingContext2D&{letterSpacing:string}).letterSpacing=style.letterSpacing==='normal'?'0px':style.letterSpacing;
      ctx.textBaseline='alphabetic';
      const metrics=ctx.measureText('Hg'),ascent=metrics.fontBoundingBoxAscent,descent=metrics.fontBoundingBoxDescent;
      const transform=(text:string)=>style.textTransform==='uppercase'?text.toUpperCase():style.textTransform==='lowercase'?text.toLowerCase():text;
      const underline=style.textDecorationLine.includes('underline'),decoration=style.textDecorationColor||style.color;
      withClip(parent,()=>{
        for(const match of node.data.matchAll(/\S+/gu)){
          const start=match.index!,end=start+match[0].length;range.setStart(node,start);range.setEnd(node,end);
          const rects=[...range.getClientRects()].filter(r=>r.width>0);if(!rects.some(r=>hit(r,src)))continue;
          // Split at prose-role boundaries ("fox," is a noun and a comma) as well as at line wraps.
          const cuts=rects.length===1?[...new Set((proseInk.get(node)||[]).flatMap(([a,b])=>[a,b]).filter(o=>o>start&&o<end))].sort((a,b)=>a-b):[];
          const sub=(a:number,b:number)=>{range.setStart(node,a);range.setEnd(node,b);return {text:node.data.slice(a,b),rect:range.getBoundingClientRect(),offset:a};};
          const pieces=rects.length===1?(cuts.length?[start,...cuts].map((a,i,all)=>sub(a,all[i+1]??end)):[{text:match[0],rect:rects[0],offset:start}]):[...match[0]].map((ch,i,chars)=>{const offset=start+chars.slice(0,i).join('').length;return sub(offset,offset+ch.length);});
          for(const {text,rect,offset} of pieces){
            const inked=inkRanges.find(h=>h.range.isPointInRange(node,offset));
            const prose=inked?null:proseInk.get(node)?.find(([a,b])=>a<=offset&&offset<b);
            ctx.fillStyle=inked?inked.ink:prose?prose[2]:style.color;
            const baseline=rect.top+(rect.height-(ascent+descent))/2+ascent;ctx.fillText(transform(text),rect.left,baseline);
            if(underline){ctx.fillStyle=decoration;ctx.fillRect(rect.left,baseline+Math.max(1.5,descent*.3),rect.width,1);}
          }
        }
      });
    }
  }
  return canvas;
}
