/* Math syntax for markdown-it. Display math: a line starting with $$ or \[, closed by $$
   or \] at the end of the same or a later line. Inline math: \(…\) always; $…$ only when
   it cannot be currency (see inlineDollar). Rendering is deferred: tokens become
   placeholders (.reader-math with data-tex) that the lazy KaTeX chunk typesets. */
// TeX-ish content: a command, script, brace or equals; a letter next to an operator; or a math symbol.
const TEXISH=/[\\^_{=]|[A-Za-z][+\-*/<>]|[+\-*/<>][A-Za-z]|[A-Za-z0-9] [+\-*/<>] [A-Za-z0-9]|[\u0391-\u03C9\u2190-\u21FF\u2200-\u22FF\u27F0-\u27FF]/;
const escapeHTML=text=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const escaped=(src,pos)=>{let count=0;while(pos-1-count>=0&&src.charCodeAt(pos-1-count)===0x5C)count++;return count%2===1;};
const isSpace=code=>code===0x20||code===0x09||code===0x0A||code===0x0D;
const isDigit=code=>code>=0x30&&code<=0x39;
const isWord=code=>isDigit(code)||code>=0x41&&code<=0x5A||code>=0x61&&code<=0x7A;

/** Decide whether `$` at `start` opens inline math: [contentStart, contentEnd, end], {prose: closeIndex} for a
    non-math pair, or null. */
export function inlineDollar(src,start,max=src.length){
  if(src.charCodeAt(start)!==0x24||escaped(src,start)||start>0&&isWord(src.charCodeAt(start-1)))return null;
  const first=src.charCodeAt(start+1);
  if(start+1>=max||first===0x24||isSpace(first)||isDigit(first))return null;
  let close=start+1;
  for(;close<max;close++){const code=src.charCodeAt(close);if(code===0x0A)return null;if(code===0x24&&!escaped(src,close))break;}
  if(close>=max)return null;
  if(isSpace(src.charCodeAt(close-1))||isWord(src.charCodeAt(close+1))||src.charCodeAt(close+1)===0x24)return null;
  // A well-formed pair that is not TeX-ish is prose; its closing $ must not open a new span.
  if(!TEXISH.test(src.slice(start+1,close)))return {prose:close};
  return [start+1,close,close+1];
}
function mathInline(state,silent){
  if(state.env?.mathDollar===false||state.src.charCodeAt(state.pos)!==0x24)return false;
  const prose=state.readerMathProse??=new Set();if(prose.has(state.pos))return false;
  const found=inlineDollar(state.src,state.pos,state.posMax);
  if(found?.prose!==undefined){prose.add(found.prose);return false;}
  if(!found)return false;
  if(!silent){const token=state.push('math_inline','math',0);token.markup='$';token.content=state.src.slice(found[0],found[1]);}
  state.pos=found[2];return true;
}
function mathParen(state,silent){
  const {src,pos,posMax}=state;
  if(src.charCodeAt(pos)!==0x5C||src.charCodeAt(pos+1)!==0x28||escaped(src,pos))return false;
  let close=pos+2;
  for(;close<posMax-1;close++)if(src.charCodeAt(close)===0x5C&&src.charCodeAt(close+1)===0x29&&!escaped(src,close))break;
  if(close>=posMax-1||!src.slice(pos+2,close).trim())return false;
  if(!silent){const token=state.push('math_inline','math',0);token.markup='\\(';token.content=src.slice(pos+2,close);}
  state.pos=close+2;return true;
}
function mathBlock(state,startLine,endLine,silent){
  let begin=state.bMarks[startLine]+state.tShift[startLine],max=state.eMarks[startLine];
  if(state.sCount[startLine]-state.blkIndent>=4)return false;
  const line=state.src.slice(begin,max),open=line.startsWith('$$')?'$$':line.startsWith('\\[')?'\\[':null;
  if(!open)return false;
  const close=open==='$$'?'$$':'\\]';
  let rest=line.slice(2),content=null,last=startLine;
  const trimmed=rest.trimEnd();
  if(trimmed.length>=2&&trimmed.endsWith(close)&&!escaped(trimmed,trimmed.length-2)){content=trimmed.slice(0,-2);}
  else{
    const lines=[rest];
    for(let next=startLine+1;next<endLine;next++){
      const text=state.src.slice(state.bMarks[next]+state.tShift[next],state.eMarks[next]),end=text.trimEnd();
      if(state.sCount[next]<state.blkIndent&&end)return false;
      if(end.endsWith(close)&&!escaped(end,end.length-2)){lines.push(end.slice(0,-2));content=lines.join('\n');last=next;break;}
      lines.push(text);
    }
  }
  if(content===null||!content.trim())return false;
  if(silent)return true;
  state.line=last+1;
  const token=state.push('math_block','math',0);token.block=true;token.content=content.trim();token.markup=open;token.map=[startLine,state.line];
  return true;
}
/** markdown-it plugin. `env.mathDollar === false` disables inline $…$ for a document. */
export function mathPlugin(md){
  md.block.ruler.before('fence','math_block',mathBlock,{alt:['paragraph','reference','blockquote','list']});
  md.inline.ruler.before('escape','math_paren',mathParen);
  md.inline.ruler.after('backticks','math_inline',mathInline);
  md.renderer.rules.math_inline=(tokens,index)=>`<span class="reader-math reader-math-inline" data-tex="${escapeHTML(tokens[index].content)}">${escapeHTML(tokens[index].markup==='$'?'$'+tokens[index].content+'$':'\\('+tokens[index].content+'\\)')}</span>`;
  md.renderer.rules.math_block=(tokens,index,options,env,self)=>{const token=tokens[index];token.attrJoin('class','reader-math reader-math-block');token.attrSet('data-tex',token.content);return `<div${self.renderAttrs(token)}>${escapeHTML(token.markup==='$$'?'$$'+token.content+'$$':'\\['+token.content+'\\]')}</div>\n`;};
}
/** Frontmatter `math: false` turns off inline $ detection. */
export function mathOptions(raw){
  const front=raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return {mathDollar:!(front&&/^math:\s*(?:false|no|off)\s*$/im.test(front[1]))};
}
