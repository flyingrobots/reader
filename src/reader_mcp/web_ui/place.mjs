/** Continuous reading keeps the reader's place while article blocks change height.
 *  Blocks far from the window skip layout (`content-visibility:auto` in style.css), so their height is an
 *  estimate until they near the window. A jump Reader makes (find, a heading, a passage, a bookmark) holds its
 *  target at the line it was sent to while blocks around it settle, until the reader scrolls or types. With
 *  smooth scrolling the article sits in a fixed wrapper that the browser's scroll anchoring cannot see, so the
 *  first block in view is also held when blocks above it change height. Pins follow every change. */
/** The scroll offset of the page the reader sees. With smooth scrolling the shown page glides behind the scroll
 *  position, so a jump measured from what is on screen (a rect) adds this, not scrollY, to land where it means (#156). */
export const shownTop=smoother=>{const content=smoother&&document.querySelector('#smooth-content');return content?-content.getBoundingClientRect().top:scrollY;};
export function installPlace({content, scroll, smoother, onChange}){
  let article=null,observer=null,mutations=null,hold=null,heights=new WeakMap();
  // Layout offset of a block or range in the scrolled content: the same before and after a scroll.
  // A fraction of the way down the target (a bookmark's place in its block) is measured on its settled height.
  const offset=(target,fraction=0)=>{const rect=target.getBoundingClientRect();return rect.top+rect.height*fraction-(content()?.getBoundingClientRect().top||0);};
  const blocks=()=>article?[...article.children].filter(el=>!el.classList.contains('annotation-pin')):[];
  const bound=()=>Math.max(0,document.documentElement.scrollHeight-innerHeight);
  const end=()=>{hold=null;};
  const at=top=>Math.abs(scrollY-Math.min(top,bound()))<2;
  const alive=target=>target instanceof Range?target.startContainer.isConnected:target.isConnected;
  // Where the held jump belongs now: its target at its line, or the page's start or end (gg, G), wherever that is.
  const live=held=>held.edge||alive(held.target);
  const goal=held=>held.edge==='end'?bound():held.edge==='start'?0:offset(held.target,held.fraction)-held.line;
  const input=()=>end();
  for(const type of ['wheel','keydown','pointerdown','touchstart'])addEventListener(type,input,{capture:true,passive:true});
  // Dragging the scrollbar sends no input event: once the jump has arrived, a scroll away from the held line ends
  // the hold. Scroll anchoring scrolls too, when heights change: then the target has moved, so follow it instead.
  addEventListener('scroll',()=>{
    if(!hold)return;if(!live(hold)){end();return;}
    if(!hold.arrived){hold.arrived=at(hold.top);return;}
    const top=goal(hold);
    if(Math.abs(top-hold.top)>1){hold.top=top;scroll(top,false);}else if(!at(hold.top))end();
  },{passive:true});
  /** A skipped block is as tall as its estimate (240 px in style.css) until it is first laid out. Paragraphs and
   *  headings estimate their height from their text length, so the scrollbar and far jumps start close. */
  function estimate(){
    const widths=new Map(),context=document.createElement('canvas').getContext('2d');
    const metrics=el=>{if(widths.has(el.tagName))return widths.get(el.tagName);const style=getComputedStyle(el);context.font=style.font;
      const size=parseFloat(style.fontSize)||16,metric={line:parseFloat(style.lineHeight)||size*1.4,char:context.measureText('a careful claim, held for the reader. ').width/38||size*.5,width:el.clientWidth||article.clientWidth};
      widths.set(el.tagName,metric);return metric;};
    for(const el of article.querySelectorAll(':scope > :is(p,h1,h2,h3,h4,h5,h6)')){
      const {line,char,width}=metrics(el),length=el.textContent.length;if(!length||!width)continue;
      // Word wrapping leaves each line a little short.
      el.style.containIntrinsicSize=`auto ${Math.round(Math.ceil(length*char*1.05/width)*line)}px`;
    }
  }
  // Smooth scrolling sets the page height after the article grows, so a jump near the end may stop short: go on
  // to the held line once there is room. Blocks after the article (Read next) lengthen the page, so a held end moves.
  new ResizeObserver(()=>{if(!hold||!live(hold))return;if(hold.edge)hold.top=goal(hold);if(!at(hold.top))scroll(hold.top,hold.smooth&&performance.now()-hold.at<1000);}).observe(document.body);
  function changed(entries){
    if(!article)return;
    const moved=[];
    for(const entry of entries){
      const el=entry.target,size=entry.borderBoxSize?.[0]?.blockSize??el.getBoundingClientRect().height,before=heights.get(el);heights.set(el,size);
      if(before!==undefined&&Math.abs(size-before)>.5&&el.parentElement===article)moved.push({el,delta:size-before});
    }
    if(!moved.length)return;
    if(hold&&!live(hold))hold=null;
    if(hold){
      // Still moving there smoothly: glide to the corrected line; afterwards correct at once.
      const top=goal(hold);
      if(Math.abs(top-hold.top)>1){const smooth=hold.smooth&&performance.now()-hold.at<1000;hold.top=top;scroll(top,smooth);hold.arrived=!smooth&&at(top);}
    }else if(smoother())keep(moved);
    onChange?.();
  }
  /** Smooth scrolling: move the view by the height change above the first block in view, like scroll anchoring. */
  function keep(moved){
    const list=blocks(),index=new Map(list.map((el,i)=>[el,i])),sorted=moved.filter(m=>index.has(m.el)).map(m=>({i:index.get(m.el),delta:m.delta})).sort((a,b)=>a.i-b.i);
    if(!sorted.length)return;
    // Bottom of block i before this change: its bottom now, less the growth of it and every block above it.
    const growth=i=>{let sum=0;for(const m of sorted){if(m.i>i)break;sum+=m.delta;}return sum;};
    let lo=0,hi=list.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(list[mid].getBoundingClientRect().bottom-growth(mid)>0)hi=mid;else lo=mid+1;}
    let shift=0;for(const m of sorted){if(m.i>=lo)break;shift+=m.delta;}
    if(Math.abs(shift)<=.5)return;
    const view=smoother(),shown=view.scrollTop(),target=scrollY;
    view.scrollTop(shown+shift);if(Math.abs(target-shown)>1)window.scrollTo(0,target+shift);
  }
  return {
    /** Follow one rendered article in continuous reading; null in two-page reading or away from a document. */
    watch(next){
      observer?.disconnect();mutations?.disconnect();observer=mutations=null;hold=null;heights=new WeakMap();article=next||null;
      if(!article)return;
      estimate();observer=new ResizeObserver(changed);for(const el of blocks())observer.observe(el);
      mutations=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&!node.classList.contains('annotation-pin'))observer.observe(node);});
      mutations.observe(article,{childList:true});
    },
    /** A jump Reader made to `top`: keep `target` (an element or range in the article), or the point `fraction`
     *  of the way down it, where it lands. */
    hold(target,top,smooth,fraction=0){
      if(!article||!target||!(target instanceof Range?article.contains(target.startContainer):article.contains(target))){hold=null;return;}
      hold={target,fraction,top,line:offset(target,fraction)-top,smooth,arrived:!smooth&&at(top),at:performance.now()};
    },
    /** A jump Reader made to the page's start or end (gg, G): keep it there while blocks settle and arrive. */
    edge(last,smooth){if(!article){hold=null;return;}const edge=last?'end':'start',top=last?bound():0;hold={edge,top,smooth,arrived:!smooth&&at(top),at:performance.now()};},
    release:end,
    holding:()=>!!hold,
  };
}
