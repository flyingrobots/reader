/** The reading cursor's text model: the article's visible text, block by block, with word and sentence
 *  boundaries from Intl.Segmenter. Positions are indices into that text (whitespace collapsed, one
 *  newline between blocks); range() turns them back into DOM ranges for highlights and annotations. */
export const CURSOR_BLOCKS='p,li,h1,h2,h3,h4,h5,h6,pre,td,th,dt,dd,figcaption,blockquote,summary,caption';
// Text the reader never reads as the document: margin pins, generated chrome (embed headers and notes included),
// diagram drawings, MathML twins. Embedded documents are read in place, so the cursor moves through them.
export const CURSOR_SKIP='.annotation-pin,[data-reader-decoration],script,style,button,.katex-mathml,.reader-diagram-canvas';
const segmenters={};
const segmenter=granularity=>segmenters[granularity]??=new Intl.Segmenter(document.documentElement.lang||undefined,{granularity});

export function textModel(root){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){const parent=node.parentElement;return !parent||parent.closest(CURSOR_SKIP)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;}});
  const parts=[],nodes=[],offsets=[],blocks=[];let length=0,block=null,space=true,visible=new Map();
  const shown=element=>{if(!visible.has(element))visible.set(element,element.checkVisibility?element.checkVisibility():true);return visible.get(element);};
  const closeBlock=()=>{const last=blocks.at(-1);if(!last)return;if(parts.at(-1)===' '&&length>last.start){parts.pop();nodes.pop();offsets.pop();length--;}last.end=length;};
  for(let node;(node=walker.nextNode());){
    const parent=node.parentElement;if(!shown(parent))continue;  // Closed folds and hidden copies.
    const element=parent.closest(CURSOR_BLOCKS)||root;
    if(element!==block){
      closeBlock();
      if(blocks.length&&blocks.at(-1).end>blocks.at(-1).start){parts.push('\n');nodes.push(nodes.at(-1));offsets.push(offsets.at(-1)+1);length++;}
      else if(blocks.length)blocks.pop();
      block=element;blocks.push({el:element,start:length,end:length});space=true;
    }
    const data=node.data;
    for(let i=0;i<data.length;i++){
      const white=/\s/.test(data[i]);if(white&&space)continue;
      parts.push(white?' ':data[i]);nodes.push(node);offsets.push(i);length++;space=white;
    }
  }
  closeBlock();if(blocks.length&&blocks.at(-1).end===blocks.at(-1).start)blocks.pop();
  if(parts.at(-1)==='\n'){parts.pop();nodes.pop();offsets.pop();length--;}
  const text=parts.join('');
  const cache=new Map();
  /** Index of the block holding a position (the next block for a separator). */
  function blockIndex(i){let lo=0,hi=blocks.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(blocks[mid].start<=i)lo=mid;else hi=mid-1;}return lo;}
  function segments(b){
    if(cache.has(b))return cache.get(b);
    const {start,end}=blocks[b],slice=text.slice(start,end),sentences=[],words=[];
    for(const s of segmenter('sentence').segment(slice)){const lead=s.segment.length-s.segment.trimStart().length,body=s.segment.trim();if(body)sentences.push([start+s.index+lead,start+s.index+lead+body.length]);}
    for(const w of segmenter('word').segment(slice))if(w.isWordLike)words.push([start+w.index,start+w.index+w.segment.length]);
    const value={sentences,words};cache.set(b,value);return value;
  }
  /** Spans ([start, end]) of a kind ('sentences' or 'words') from block b onward (or backward). */
  function* spans(kind,from,step){for(let b=blockIndex(Math.min(from,Math.max(0,length-1)));b>=0&&b<blocks.length;b+=step){const list=segments(b)[kind];if(step>0)yield* list;else for(let i=list.length-1;i>=0;i--)yield list[i];}}
  const model={
    text,length,blocks,blockIndex,segments,
    nextStart(kind,i){for(const [s] of spans(kind,i,1))if(s>i)return s;return length;},
    prevStart(kind,i){for(const [s] of spans(kind,i,-1))if(s<i)return s;return 0;},
    nextEnd(kind,i){for(const [,e] of spans(kind,i,1))if(e>i+1)return e;return length;},
    /** The span of a kind holding position i, or the next one. */
    spanAt(kind,i){for(const span of spans(kind,i,1))if(span[1]>i)return span;return null;},
    blockStart(i){return blocks.length?blocks[blockIndex(i)].start:0;},
    blockEnd(i){return blocks.length?blocks[blockIndex(i)].end:0;},
    nextBlock(i){const b=blockIndex(i);return b+1<blocks.length?blocks[b+1].start:length;},
    prevBlock(i){const b=blockIndex(i);return blocks[b]&&blocks[b].start<i?blocks[b].start:b>0?blocks[b-1].start:0;},
    /** Trim spaces and block breaks from both ends of [a, b). */
    trim(a,b){while(a<b&&/\s/.test(text[a]))a++;while(b>a&&/\s/.test(text[b-1]))b--;return [a,b];},
    /** A DOM range over [a, b); collapsed at a when a === b. */
    range(a,b=a){
      if(!length)return null;a=Math.max(0,Math.min(a,length));b=Math.max(a,Math.min(b,length));
      const range=document.createRange();
      if(a<length)range.setStart(nodes[a],Math.min(offsets[a],nodes[a].length));else range.setStart(nodes[length-1],Math.min(offsets[length-1]+1,nodes[length-1].length));
      if(b>a)range.setEnd(nodes[b-1],Math.min(offsets[b-1]+1,nodes[b-1].length));else range.collapse(true);
      return range;
    },
    /** The first rendered box of the character at i (the previous one at a break or the end). */
    rect(i){
      i=Math.max(0,Math.min(i,length-1));while(i>0&&text[i]==='\n')i--;
      const range=document.createRange();range.setStart(nodes[i],offsets[i]);range.setEnd(nodes[i],Math.min(offsets[i]+1,nodes[i].length));
      const rects=[...range.getClientRects()].filter(r=>r.width||r.height);return rects[0]||range.getBoundingClientRect();
    },
    /** The position of a DOM point (binary search over document order). */
    locate(node,offset){
      if(!length)return 0;const probe=document.createRange();
      try{probe.setStart(node,offset);}catch{return 0;}
      let lo=0,hi=length;while(lo<hi){const mid=(lo+hi)>>1;if(probe.comparePoint(nodes[mid],offsets[mid])<0)lo=mid+1;else hi=mid;}
      return lo;
    },
    /** First position for which test(rect) holds, assuming it is monotonic in document order. */
    first(test){let lo=0,hi=length;while(lo<hi){const mid=(lo+hi)>>1;if(test(model.rect(mid)))hi=mid;else lo=mid+1;}return lo;},
  };
  return model;
}

/** Same visual line: boxes whose vertical centres are within half a line of each other. */
export const sameLine=(a,b)=>Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2)<Math.max(4,Math.min(a.height,b.height)*.5)&&Math.abs(a.left-b.left)<4000;

/** Move by visual line: the position on the next (step 1) or previous (-1) line nearest to goalX. */
export function lineMove(model,i,step,goalX){
  const here=model.rect(i);let line=null,best=i,bestDistance=Infinity;
  for(let j=i+step,n=0;j>=0&&j<model.length&&n<6000;j+=step,n++){
    if(model.text[j]==='\n')continue;const r=model.rect(j);if(!r.width&&!r.height)continue;
    if(!line){if(sameLine(r,here)&&!(step>0?r.left<here.left-40:r.left>here.left+40))continue;line=r;}
    else if(!sameLine(r,line))break;
    const distance=Math.abs(r.left-goalX);if(distance<bestDistance){bestDistance=distance;best=j;}
  }
  return line?best:i;
}
/** Start (step -1) or end (step 1) of the visual line holding i. */
export function lineEdge(model,i,step){
  const here=model.rect(i);let edge=i;
  for(let j=i+step,n=0;j>=0&&j<model.length&&n<6000;j+=step,n++){if(model.text[j]==='\n')break;const r=model.rect(j);if(!sameLine(r,here))break;edge=j;}
  return step>0?Math.min(model.length,edge+1):edge;
}
