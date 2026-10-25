import {bodyOf, codePointIndex, escapeHTML as esc, findFragment, formatDate, localizeLibrary, normalize, slugHeadings, occurrences, plainQuote, plural, projectSource, rawCodePoints, sourceRangeForQuote, visibleQuote} from './logic.mjs';
import {installReading} from './reading.mjs';
import {installLinks} from './links.mjs';
import {mathPlugin,mathOptions} from './math.mjs';
import {openPDF} from './pdf.mjs';
import {installBreadcrumbs} from './breadcrumbs.mjs';
import {readingLogHTML,withYou} from './reading-log.mjs';
import {installSpeech} from './speech.mjs';
import {installOutline} from './outline.mjs';
import {installSearch} from './search-page.mjs';
import {installProseColors} from './prose-colors.mjs';
import {installQueue} from './queue.mjs';
import {mountDashboard} from './dashboard.mjs';
import {DEFAULT_EXCLUDED_TYPES,currentIssue,isoWeek,issueWindow,issueWeeks,selectIssue,mountMagazine} from './magazine.mjs';
import {THEMES,oppositeTheme} from './themes.mjs';
import {calloutPlugin} from './callouts.mjs';
import {applyThemes,installControls,mountSkeleton,mountCodeBlocks,clearControlsWithin,mountDocumentTree,visibleDocumentNodes,revealDocumentRow,mountBackstage,mountChangesPanel,notify as shellNotify,openChat,closeChat,chatOpen,trackSpeech,renderQueuePanel,mountCallouts} from './controls/reader-controls.js';
import {installVersions,chipMarkup,historicalMarkup,splitRef,compareLabel} from './versions.mjs';
import {installSplit,installPane,cleanRoute} from './split.mjs';
import {installScratch} from './scratch.mjs';

const $ = selector => document.querySelector(selector);
// Split view: a pane is this app in an embedded same-origin iframe (/?pane=1#…); the top document is the shell.
const EMBEDDED=new URLSearchParams(location.search).has('pane')&&window.parent!==window;
if(EMBEDDED)document.documentElement.classList.add('embedded-pane');
let split=null,pane=null;
/** Toasts from a pane appear in the shell's toaster. */
function notify(message,type,options){if(pane){pane.post({type:'toast',message:String(message),kind:type,options:options&&{id:options.id,duration:options.duration}});return;}return shellNotify(message,type,options);}
const defaults = {theme:'ink', participant:null, recent:20, atlas:true, activity:true, smooth:true, layout:'scroll', pace:220, zen:false, pageTurn:'curl', nextReads:true, backlinks:true, outline:true, inboxSandbox:'workspace-write', issueExclude:DEFAULT_EXCLUDED_TYPES.join(', '), proseColors:'clear'};
// Route sentinel for Behind the scenes; document routes are always library/ paths.
const BACKSTAGE=':backstage',SEARCH=':search',SCRATCH=':scratch';  // A scratch buffer: ':scratch' (the latest draft) or ':scratch=<id>'.
// Past issues use ':issue=<ISO week>'; the bare homepage (null) is the current issue.
const ISSUE=':issue=';
const isIssue=path=>!path||path.startsWith(ISSUE);
// A passage link carries its line, page and terms: #read=<path>&at=<json>; a heading link #read=<path>&h=<heading id>.
const routeHash=(path,at=null,heading='')=>path===BACKSTAGE?'#backstage':path?.startsWith(SCRATCH)?'#scratch'+path.slice(SCRATCH.length):path===SEARCH?search.hash():path?.startsWith(ISSUE)?'#issue='+param(path.slice(ISSUE.length)):path?'#read='+param(path)+(at?'&at='+param(JSON.stringify(at)):'')+(heading?'&h='+param(heading):''):location.pathname;
const routeFromHash=()=>location.hash==='#backstage'?BACKSTAGE:/^#scratch(=[0-9a-f-]{36})?$/.test(location.hash)?SCRATCH+location.hash.slice(8):location.hash.startsWith('#search')?SEARCH:location.hash.startsWith('#issue=')?ISSUE+decodeURIComponent(location.hash.slice(7)):location.hash.startsWith('#read=')?readRoute().path:null;
/** Path and heading of a #read= route. Hand-made `#read=<path>#<heading>` (raw or %23) also works; a malformed escape never throws. */
const decode=text=>{try{return decodeURIComponent(text);}catch{return text;}};
function readRoute(){
  const [value,...params]=location.hash.slice(6).split('&');
  let path=decode(value.split('#')[0]),heading=value.includes('#')?decode(value.slice(value.indexOf('#')+1)):'';
  const tail=!heading&&path.match(/^(.*\.[A-Za-z0-9]{1,10})#([^/]*)$/);if(tail)[,path,heading]=tail;
  for(const item of params)if(item.startsWith('h='))heading=decode(item.slice(2));
  return {path,heading};
}
const routeHeading=()=>location.hash.startsWith('#read=')?readRoute().heading:'';
function passageFromHash(){
  const match=location.hash.match(/&at=([^&]*)/);if(!match)return null;
  try{const at=JSON.parse(decodeURIComponent(match[1]));if(!at||typeof at!=='object')return null;
    return {line:Number.isInteger(at.line)&&at.line>0?at.line:1,page:Number.isInteger(at.page)&&at.page>0?at.page:null,terms:Array.isArray(at.terms)?at.terms.filter(t=>typeof t==='string'&&t.length<=200).slice(0,32):[],query:typeof at.query==='string'?at.query.slice(0,1000):''};}
  catch{return null;}
}
let reading,controls,links,outline,speech,versions,search,prose,queue,scratch;
let saved = {};
try { saved = JSON.parse(localStorage.getItem('reader.preferences.v1') || '{}'); } catch {}
const state = {prefs:{...defaults,...saved}, data:null, doc:null, threads:[], attention:[], token:null, mode:'fuzzy', results:[], resultIndex:0, searchId:0, routeId:0, pdf:null, smoother:null, find:[], findIndex:-1, selected:null, activeThread:null, replyTo:null, visits:[null], cursor:0, ranges:[], leader:null,themeEditorOpen:false,view:null};
// Custom theme CSS is cached so a saved custom theme paints before /api/themes answers.
let themeCache={css:'',links:[],ids:[]};
try{const cached=JSON.parse(localStorage.getItem('reader.themes.v1')||'null');if(cached&&typeof cached.css==='string'&&Array.isArray(cached.ids)&&Array.isArray(cached.links))themeCache=cached;}catch{}
if(themeCache.css){const style=document.createElement('style');style.id='reader-user-themes';style.textContent=themeCache.css;document.head.append(style);for(const href of themeCache.links){if(!/^\/fonts\/[a-z0-9-]+\/font\.css$/.test(href))continue;const link=document.createElement('link');link.rel='stylesheet';link.href=href;link.dataset.themeFont='';document.head.append(link);}}
const knownTheme=theme=>THEMES.includes(theme)||themeCache.ids.includes(theme);
const previewTheme=new URLSearchParams(location.search).get('theme');
if(knownTheme(previewTheme))state.prefs.theme=previewTheme;
if(!knownTheme(state.prefs.theme))state.prefs.theme='ink';
document.documentElement.dataset.theme=state.prefs.theme;
// The browser chrome (and the installed app's status bar) follows the theme's page colour.
const syncThemeColor=()=>{const meta=document.querySelector('meta[name=theme-color]'),bg=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();if(meta&&bg)meta.content=bg;};
new MutationObserver(syncThemeColor).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});addEventListener('load',syncThemeColor,{once:true});
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
// Callouts register before the source-map wrapper below, so their asides receive the blockquote's map.
const md = window.markdownit({html:true, linkify:true, breaks:false}).use(mathPlugin).use(calloutPlugin);
for (const type of ['paragraph_open','heading_open','blockquote_open','bullet_list_open','ordered_list_open','math_block']) {
  const original = md.renderer.rules[type];
  md.renderer.rules[type] = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (token.map && env.raw) {
      // One scan per render; per-block Array.from(prefix) was quadratic in document size.
      if(!env.lineOffsets){env.lineOffsets=[0];let position=0;for(const line of env.raw.split('\n')){position+=line.length+1;env.lineOffsets.push(position);}env.codePoint=codePointIndex(env.full);}
      const offset = env.offset || 0;
      const begin = offset + env.lineOffsets[token.map[0]];
      const end = offset + env.lineOffsets[token.map[1]];
      token.attrSet('data-source-start', env.codePoint(begin));
      token.attrSet('data-source-end', env.codePoint(Math.min(end, env.full.length)));
    }
    return original ? original(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
  };
}

// An unreachable server raises one toast, replaced in place, and a probe with backoff clears it.
const OFFLINE_TOAST = 'reader-unreachable';
const offline = {down:false, unsaved:false, delay:1000, timer:0};
function unreachable(write) {
  offline.unsaved ||= write;
  if (!offline.down) { offline.down = true; offline.delay = 1000; }
  notify(`Reader isn’t reachable — retrying…${offline.unsaved ? ' Your last change wasn’t saved.' : ''}`, 'error', {id:OFFLINE_TOAST, duration:Infinity});
  if (!offline.timer) offline.timer = setTimeout(probe, offline.delay);
}
async function probe() {
  offline.timer = 0;
  try { const response = await fetch('/', {cache:'no-store'}); if (!response.ok) throw new Error(String(response.status)); reachable(); }
  catch { offline.delay = Math.min(offline.delay * 2, 30000); offline.timer = setTimeout(probe, offline.delay); }
}
function reachable() {
  if (!offline.down) return;
  clearTimeout(offline.timer);
  const unsaved = offline.unsaved;
  Object.assign(offline, {down:false, unsaved:false, timer:0});
  notify(unsaved ? 'Reader is reachable again. Redo your last change if it’s missing.' : 'Reader is reachable again.', 'success', {id:OFFLINE_TOAST, duration:6000});
}
async function api(path, payload, extra={}) {
  const options = payload ? {method:'POST', headers:{'Content-Type':'application/json','X-Reader-Token':state.token}, body:JSON.stringify(payload)} : {};
  let response;
  try { response = await fetch(path, {...options,...extra});
    // Several panes load at once; a busy server's 429 on a read is retried once.
    if (EMBEDDED && !payload && response.status === 429) { await new Promise(resolve => setTimeout(resolve, 400)); response = await fetch(path, {...options,...extra}); } }
  catch (cause) {
    if (cause?.name === 'AbortError') throw cause;
    unreachable(!!payload);
    const error = new Error('Reader isn’t reachable.'); error.offline = true; error.cause = cause;
    throw error;
  }
  reachable();
  let data;
  try { data = await response.json(); } catch { throw new Error('Reader returned an unreadable response.'); }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Reader could not complete that request.'),{status:response.status,data});
  return data;
}
const param = value => encodeURIComponent(value);
function toast(message) { notify(message); }
function report(error) { if (error?.offline) return; console.error(error); notify(error.message || String(error),'error'); }
// A secondary request (margins, read marks, Read next, ...) must never take down a rendered document.
// It stays quiet when unreachable (one offline toast) or 404 (the document itself reports a missing path).
async function secondary(label, work) {
  try { return await work(); }
  catch (error) { console.warn(label, error); if (!error?.offline && error?.status !== 404) notify(`${label} could not load: ${error.message || error}`); return undefined; }
}
function motion() { return !reduced.matches && state.prefs.smooth; }
function refreshScroll() {
  if (state.smoother) window.ScrollTrigger?.refresh();
  reading?.reflow();
}
function resetScroll() {
  state.smoother?.kill(); state.smoother = null;
  window.scrollTo(0, 0);
  if (motion() && window.ScrollSmoother && !document.body.classList.contains('two-page')) {
    gsap.registerPlugin(ScrollTrigger, ScrollSmoother);
    state.smoother = ScrollSmoother.create({wrapper:'#smooth-wrapper',content:'#smooth-content',smooth:.8,smoothTouch:0,normalizeScroll:false,effects:false,onUpdate:()=>reading?.update()});
  }
  requestAnimationFrame(refreshScroll);
}
function scrollToPosition(top, smooth=true) {
  const bounded = Math.max(0, Math.min(top, document.documentElement.scrollHeight - innerHeight));
  if (state.smoother) state.smoother.scrollTo(bounded, smooth && motion());
  else window.scrollTo({top:bounded, behavior:smooth && motion() ? 'smooth' : 'instant'});
}
function moveToRange(range) {
  // A folded callout opens when find or a thread jumps into its body.
  for(let fold=range.startContainer.parentElement?.closest('details.callout-fold:not([open])');fold;fold=fold.parentElement?.closest('details.callout-fold:not([open])'))fold.open=true;
  if(reading?.reveal(range))return;
  const rect = range.getBoundingClientRect();
  scrollToPosition(window.scrollY + rect.top - innerHeight * .36);
}
async function loadLibrary() {
  const profile = state.prefs.participant ? '?participant=' + param(state.prefs.participant) : '';
  const data = await api('/api/library' + profile);
  state.data = localizeLibrary(data); state.token = data.token; state.prefs.participant = data.participant;
  return data;
}
function savePrefs() { const url=new URL(location.href);if(url.searchParams.has('theme') && url.searchParams.get('theme')!==state.prefs.theme){url.searchParams.delete('theme');history.replaceState(history.state,'',url);}try { localStorage.setItem('reader.preferences.v1', JSON.stringify(state.prefs)); } catch {} if(split?.active())split.broadcast({type:'prefs-changed'}); }
function latestWorks() { return [...state.data.works].sort((a,b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title)); }
function workRows(works) {
  return works.map((w,i) => `<li class="work-row" tabindex="0" role="link" data-path="${esc(w.primary)}"><span class="row-index">${String(i+1).padStart(2,'0')}</span><div><h3 class="work-title">${esc(w.title)}${!w.read?'<span class="unread-pip" title="Unread edition" aria-label="Unread edition"></span>':''}</h3><div class="work-byline">${esc(w.authors?.join(' · ') || 'Unspecified author')}${w.projects?.[0] && w.projects[0] !== 'Unspecified project'?' · '+esc(w.projects[0]):''}</div></div><span class="work-date">${formatDate(w.date)}</span></li>`).join('');
}
function issueOptions(){return {today:state.data.today,exclude:state.prefs.issueExclude};}
async function renderHome(path=null,id=state.routeId) {
  state.issuePath=path;
  const works=state.data.works,options=issueOptions(),week=path?.slice(ISSUE.length);
  let span;
  try{span=week?{...issueWindow(works,{week,exclude:options.exclude}),fallback:false}:currentIssue(works,options);}
  catch{span=currentIssue(works,options);notify('That issue does not exist; showing this week’s issue.');}
  let signals={newsletters:[],picks:[],near:[]};
  try{signals=await api('/api/issue?start='+param(span.start)+'&end='+param(span.end));}catch{/* Selection works without newsletter picks or embeddings. */}
  if(id!==state.routeId)return;
  const issue=selectIssue(works,{window:span,today:state.data.today,exclude:options.exclude,picks:signals.picks,near:signals.near});
  state.issue=issue;
  clearControlsWithin($('#main'));
  state.magazine=mountMagazine({root:$('#main'),issue,weeks:issueWeeks(works,{exclude:options.exclude,through:isoWeek(state.data.today).end}),signals,prefs:state.prefs,api,wireDocumentLinks,openIssue,motion:()=>!reduced.matches});
  $('#issue-backstage').onclick=()=>navigate(BACKSTAGE);
  $('#main').querySelectorAll('.issue [data-queue-add]').forEach(button=>button.onclick=event=>{event.preventDefault();queue.add(button.dataset.queueAdd);});
  resetScroll();reading?.updateStatus();
}
function openIssue(week){
  const current=currentIssue(state.data.works,issueOptions()).week;
  navigate(week===current?null:ISSUE+week);
}
function stepIssue(delta){
  if(!state.issue)return;
  const button=$(`.issue-nav [aria-label="${delta<0?'Previous':'Next'} issue"]`);
  if(button?.dataset.issue)openIssue(button.dataset.issue);else toast(delta<0?'This is the earliest issue.':'This is the latest issue.');
}
function movePiece(delta){
  const pieces=state.magazine?.pieces()||[];if(!pieces.length)return;
  const index=pieces.indexOf(document.activeElement),next=pieces[index<0?(delta>0?0:pieces.length-1):Math.max(0,Math.min(pieces.length-1,index+delta))];
  next.focus({preventScroll:true});const rect=next.getBoundingClientRect();
  if(rect.top<70||rect.bottom>innerHeight-70)scrollToPosition(scrollY+rect.top-innerHeight*.3);
}
function mountLibrary(container){
  mountDashboard({root:container,data:state.data,prefs:state.prefs,embedded:true,workRows,wireDocumentLinks,openPicker,openPreferences,navigate,showTooltip:showChartTooltip,hideTooltip:hideChartTooltip,seek:element=>scrollToPosition(scrollY+element.getBoundingClientRect().top-50)});
}
function showChartTooltip(event,title,detail='') {
  const tip=$('#chart-tooltip'); tip.replaceChildren();
  const strong=document.createElement('strong');strong.textContent=title;tip.append(strong,document.createTextNode(detail));
  const rect=event.currentTarget.getBoundingClientRect();
  tip.style.left=Math.min(innerWidth-310,Math.max(12,event.clientX || rect.x+rect.width/2))+12+'px';
  tip.style.top=Math.min(innerHeight-100,(event.clientY || rect.y)+15)+'px';tip.classList.add('visible');
}
function hideChartTooltip(){ $('#chart-tooltip').classList.remove('visible'); }
function wireDocumentLinks(root) {
  root.querySelectorAll('[data-path]').forEach(el=>{
    const open=()=>navigate(el.dataset.path,{thread:el.dataset.threadLink});
    el.addEventListener('click',event=>{event.preventDefault();if(event.shiftKey&&el.dataset.path?.startsWith('library/')){openInSplit('#read='+param(el.dataset.path));return;}open();});
    if(el.tagName!=='BUTTON')el.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();open();}});
  });
  root.querySelectorAll('[data-home]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();navigate(null);}));
}
function closeDialog(id) { const el=$('#'+id);if(el.open)el.close();state.smoother?.paused(false); }
function openDialog(id) { const el=$('#'+id); if(!el.open)el.showModal();state.smoother?.paused(true); }
function closeContext() {
  closeChat();links?.hide();hideChartTooltip();$('#passage-tooltip').classList.remove('visible');$('#selection-tools').hidden=true;$('#thread-panel').hidden=true;$('#find-bar').hidden=true;versions?.close();
  for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
  queue?.close(false);state.smoother?.paused(false);
}
async function navigate(path,{thread=null,fragment='',record=true,commit=null,at=null}={}) {
  if(commit&&path)path=path+'@'+commit;
  // While the window is split, the shell's panels (queue, picker, chat links) open documents in the focused pane.
  if(split?.active()){split.openInFocused(path===SEARCH?'#search':cleanRoute(routeHash(path,null,fragment))||'#home');return;}
  const id=++state.routeId;await reading?.leave();if(state.view==='scratch'&&!path?.startsWith(SCRATCH))await scratch.leave();if(id!==state.routeId)return;closeContext();
  // The scratch pad's "responds to" defaults to the current document you came from.
  if(state.doc&&!state.doc.preview&&!state.doc.historical)state.lastDocPath=state.doc.path;
  if(state.view==='search'&&path!==SEARCH)search.leave();
  if(record){state.visits=state.visits.slice(0,state.cursor+1);state.visits.push(path);state.cursor++;
    // A pane's pushed entry would join the window's session history, so browser Back would step a background pane.
    if(EMBEDDED)history.replaceState({reader:true,path},'',routeHash(path,at,fragment));else history.pushState({reader:true,path},'',routeHash(path,at,fragment));}
  clearFind();prose?.detach();await state.pdf?.destroy();state.pdf=null;state.ranges=[];CSS.highlights?.delete('reader-own');CSS.highlights?.delete('reader-other');CSS.highlights?.delete('reader-warning');
  const quick=isIssue(path)&&state.view==='issue'&&!!state.data;
  state.view=path===BACKSTAGE?'backstage':path===SEARCH?'search':path?.startsWith(SCRATCH)?'scratch':isIssue(path)?'issue':null;
  state.editions=null;state.versions=null;state.changes=null;versions?.reset();versions?.update();
  if(path===SEARCH){state.doc=null;reading?.prepare();clearControlsWithin($('#main'));search.render($('#main'),record?null:location.hash);resetScroll();reading?.updateStatus();return;}
  if(path?.startsWith(SCRATCH)){state.doc=null;reading?.prepare();clearControlsWithin($('#main'));resetScroll();await scratch.open($('#main'),path.slice(SCRATCH.length+1)||null);reading?.updateStatus();return;}
  if(path===BACKSTAGE){state.doc=null;reading?.prepare();renderBackstage(state.focusSettings);state.focusSettings=false;return;}
  if(isIssue(path)){state.doc=null;reading?.prepare();if(!quick){mountSkeleton($('#main'),'library');await loadLibrary();}if(id===state.routeId)await renderHome(path,id);return;}
  state.doc=null;reading?.prepare();mountSkeleton($('#main'),'document');
  let rendered=false;
  try {
    // Versions (family, history, read markers) and what changed since your receipt arrive with the
    // document, so the version chip and banners are part of the first layout. `path@commit` opens a
    // historical version read-only: no receipt, bookmark, annotations or Read next.
    const ref=path;const {path:file,commit:atCommit}=splitRef(ref);path=file;
    // A long history (git log --follow on a busy index page) may take most of a second; after 600 ms
    // the page renders without the chip and the status twin fills in when the timeline arrives.
    // Inbox arrivals are unfiled previews: they have no versions or read receipt to compare.
    const preview=path.startsWith('inbox/');
    const pending=preview?Promise.resolve(null):secondary('Versions',()=>api('/api/versions?path='+param(path)+'&participant='+param(state.prefs.participant))).then(found=>found??null);
    const [doc,editions,changes]=await Promise.all([atCommit?api('/api/version?path='+param(path)+'&commit='+param(atCommit)):api('/api/document?path='+param(path)+'&participant='+param(state.prefs.participant)),
      Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve(LATE),600))]),
      !atCommit&&!preview&&TEXTUAL.test(path)?api('/api/changes?path='+param(path)+'&participant='+param(state.prefs.participant)).catch(()=>null):null]); if(id!==state.routeId)return;
    if(editions===LATE)pending.then(late=>{if(id!==state.routeId||!late)return;state.editions=state.versions=late;versions.update();});
    state.editions=state.versions=editions===LATE?null:editions;state.changes=changes;const historical=!!doc.historical;
    state.doc=doc;state.threads=[];state.attention=[];
    const author=Array.isArray(doc.metadata.author)?doc.metadata.author.join(' · '):doc.metadata.author;
    const known=doc.preview?null:state.data.works.find(w=>w.primary===path);
    const title=doc.metadata.title || known?.title || doc.title;
    clearControlsWithin($('#main'));
    const chip=doc.preview?'':chipMarkup(state.versions,doc,param);
    $('#main').innerHTML=`<div class="document-shell resume-pending${historical?' historical':''}"><div class="eyebrow document-kicker">${esc(doc.preview?'Inbox preview · not yet filed':known?.projects?.[0] || 'From the library')}</div><h1 class="document-title">${esc(title)}</h1><div class="document-meta">${author?`<span class="by">${esc(author)}</span>`:''}${doc.metadata.created||doc.metadata.added?`<span>${formatDate(doc.metadata.created||doc.metadata.added)}</span>`:''}${doc.metadata.document_revision&&!chip?`<span>Edition ${esc(doc.metadata.document_revision)}</span>`:''}</div>${historical?historicalMarkup(doc,param):chip}${changeMarkup(changes)}<div class="reading-log" data-reader-decoration aria-live="polite"></div><article id="article" class="article"></article><footer class="document-footer">${esc(path)}${historical?` @ ${esc(doc.short)}<br>Historical text from the vault’s git history · <a href="${esc('#read='+param(path))}" data-path="${esc(path)}">Open the current file</a>`:`<br>Original source preserved · <a href="${esc(doc.file_url)}" target="_blank" rel="noopener noreferrer">Open original</a>${doc.text!==null||doc.kind==='.pdf'?'<br><button type="button" id="speak-article" data-button="outline sm" class="speak-article" title="Send to AI-TTS · Space s">Send to AI-TTS</button>':''}${/^library\/notebook\/[^/]+\.md$/.test(path)&&doc.text!==null?' <button type="button" id="edit-scratch" data-button="outline sm" title="Open this piece in the scratch pad; saving writes a new version">Edit in scratch</button>':''}`}</footer></div>`;
    // A historical view keeps the reading log of the current file (it never adds you: nothing is marked read).
    const article=$('#article');$('#speak-article')?.addEventListener('click',()=>speech.send('article'));$('#edit-scratch')?.addEventListener('click',()=>scratch.editSaved(doc,bodyOf(doc.text).text.replace(/^\r?\n/,'')));if(doc.preview){$('.reading-log')?.remove();$('#speak-article')?.remove();}else loadReadingLog(doc,id);
    if(doc.kind==='.md' || doc.kind==='.markdown'){
      await renderMarkdown(article,doc.text,path,0,{defer:true});
    } else if(doc.kind==='.pdf') {
      const controller=await openPDF(article,doc.file_url);if(id!==state.routeId){await controller.destroy();return;}state.pdf=controller;
    } else if(doc.text===null){article.innerHTML=`<img class="document-image" src="${esc(doc.file_url)}" alt="${esc(title)}">`;}
    else {const pre=document.createElement('pre');pre.textContent=doc.text;article.append(pre);}
    if(doc.text!==null){
      const placeholder=$('.document-title'),first=article.firstElementChild;
      // Keep the source heading and its coordinates; generate a title only if absent.
      const heading=['.md','.markdown'].includes(doc.kind)&&first?.tagName==='H1'?first:placeholder;
      heading.classList.add('document-title');
      if(heading!==placeholder)placeholder.remove();else heading.dataset.readerDecoration='';
      const kicker=$('.document-kicker'),meta=$('.document-meta');
      kicker.dataset.readerDecoration='';meta.dataset.readerDecoration='';
      article.prepend(kicker,heading,meta,$('.reading-log'),...$('#main').querySelectorAll('.document-shell>.version-line,.document-shell>.historical-banner,.document-shell>.change-banner'));
    }
    if(id!==state.routeId)return;
    mountEditions();wireChanges();
    reading?.prepare();resetScroll();wireArticleLinks(article,path);await reading?.restore(doc);
    rendered=true; // From here on, failures are secondary: keep the article and toast quietly instead.
    if(id!==state.routeId)return;drawLate(article,id).catch(error=>console.error(error));await outline?.refresh(article);
    // Inbox previews are plain reading: no discussion, read receipt, recents or Read next.
    if(doc.preview){if(fragment)article.querySelector('#'+CSS.escape(fragment))?.scrollIntoView({block:'start'});focusMain();return;}
    if(!historical&&(doc.kind==='.md' || doc.kind==='.markdown'))await secondary('Margins',loadDiscussion);
    if(id!==state.routeId)return;
    if(!historical)prose.attach(article,doc);  // Prose colors are for the current edition only.
    if(!historical&&!['changed','unavailable'].includes(changes?.status))await secondary('Read mark',()=>markRead(doc,path,title,author));
    if(id!==state.routeId)return;
    if(!historical)await queue?.opened(doc);  // The open log behind History and queue suggestions; never for a past version.
    if(fragment)showHeading(article,fragment);
    if(at)await secondary('Passage',()=>revealPassage(at));
    if(thread)openThread(thread);
    focusMain();
    // Historical versions are read-only views of the past: no Read next or Linked from for them.
    if(!historical){showNextReads(path,id).catch(error=>console.warn('Read next',error));links?.backlinks(path,id)?.catch(error=>console.warn('Linked from',error));}
  } catch(error){if(id!==state.routeId)return;if(rendered&&state.doc?.path===path){console.warn(error);notify(error.message || String(error));return;}outline?.clear();clearControlsWithin($('#main'));
    // A missing document gets one clear message on the page, with a way to look for it, instead of a toast.
    if(error.status===404&&!state.doc){$('#main').innerHTML=`<div class="loading-state"><h2>Link target not found</h2><p>No document at <code>${esc(path)}</code>. It may have moved or been renamed.</p><p><button type="button" data-button="outline sm" id="missing-find">Find a document</button></p></div>`;$('#missing-find').onclick=()=>openPicker('all');console.warn(error.message);return;}
    $('#main').innerHTML='<div class="loading-state"><h2>Document unavailable</h2><p>Try opening another document.</p></div>';report(error);}
}
async function markRead(doc,path,title,author){
    await api('/api/seen',{participant:state.prefs.participant,items:[doc.item]});
    if(state.doc===doc)youReadNow(doc,state.routeId);
    const work=state.data.works.find(w=>w.primary===path);if(work){work.read=true;work.read_at=new Date().toISOString();}
    state.data.recent=[{...(work||{}),title,primary:path,authors:author?[author]:[],read:true,read_at:new Date().toISOString()},...state.data.recent.filter(w=>w.primary!==path)].slice(0,50);
}
const LATE=Symbol('late');
const TEXTUAL=/\.(md|markdown|txt)$/i;
/** "Changed since you read it" banner; a quieter line when only another reader saw an earlier edition. */
function changeMarkup(data){
  if(!data)return '';
  const others=(data.others||[]).slice(0,3).map(o=>`<button type="button" data-button="link sm" data-compare="against" data-against="${esc(o.participant)}">Compare with what ${esc(o.participant)} read</button>`).join('');
  const when=data.read_at?' on '+esc(formatDate(data.read_at)):'';
  const caught='<button type="button" data-button="outline xs" data-caught-up>Mark as caught up</button>';
  if(data.status==='changed'&&data.prose_changed===false)return `<aside class="change-banner quiet" data-reader-decoration role="note"><span>Edited since you read it${when}</span><span>only metadata or line wrapping changed; the text reads the same</span>${caught}${others}</aside>`;
  if(data.status==='changed'){const s=data.stats,n=s.added+s.removed+s.reworded;return `<aside class="change-banner" data-reader-decoration role="status"><span>Changed since you read it${when}</span><span>${n} ${n===1?'section':'sections'} changed</span><button type="button" data-button="link sm" data-compare="mine">Show changes</button>${caught}${others}</aside>`;}
  if(data.status==='unavailable')return `<aside class="change-banner" data-reader-decoration role="status"><span>Changed since you read it${when}</span><span>the earlier edition isn’t in the vault history</span>${caught}${others}</aside>`;
  return others?`<aside class="change-banner quiet" data-reader-decoration role="note"><span>Another reader saw an earlier edition</span>${others}</aside>`:'';
}
function wireChanges(){
  for(const button of $('#main').querySelectorAll('[data-compare]'))button.addEventListener('click',()=>openChanges(button.dataset.compare,button.dataset.against));
  $('#main .change-banner [data-caught-up]')?.addEventListener('click',()=>caughtUp().catch(report));
}
async function caughtUp(){
  const doc=state.doc;if(!doc)return;
  const known=state.data.works.find(w=>w.primary===doc.path);
  await markRead(doc,doc.path,doc.metadata.title||known?.title||doc.title,Array.isArray(doc.metadata.author)?doc.metadata.author.join(' · '):doc.metadata.author);
  if(state.doc!==doc)return;
  state.changes={...state.changes,status:'unchanged'};
  $('#main .change-banner')?.remove();reading?.reflow();positionPins();
  notify('Marked as caught up with this edition.','success');
}
/** A comparison from the version explorer; the change list seeks only when its newer side is on screen. */
function openComparison(data,inPlace){
  let host=$('#changes-host');if(!host){host=document.createElement('div');host.id='changes-host';$('#main .document-shell').append(host);}
  mountChangesPanel(host,{data,participant:state.prefs.participant,seek:inPlace?seekChange:()=>toast('Open '+data.title.split(' → ').pop()+' to see this change in place.')});
}
/** Changes against your receipt, another reader's, or the newer version. */
async function openChanges(kind,against){
  const doc=state.doc;if(!doc)return;
  let data=kind==='mine'?state.changes:null;
  if(!data||!data.hunks){
    const query=kind==='successor'?'&successor=1':kind==='against'?'&against='+param(against):'';
    try{data=await api('/api/changes?path='+param(doc.path)+'&participant='+param(state.prefs.participant)+query);}catch(error){report(error);return;}
    if(state.doc!==doc)return;
  }
  if(kind==='successor'&&state.editions?.newer)data={...data,title:compareLabel(state.editions)};
  if(data.status==='unavailable'){notify(data.reason||'That edition isn’t in the vault history.','error');return;}
  if(data.status!=='changed'||data.prose_changed===false){notify(data.status==='changed'?'The text reads the same; only metadata or line wrapping changed.':'No differences to show.');return;}
  let host=$('#changes-host');if(!host){host=document.createElement('div');host.id='changes-host';$('#main .document-shell').append(host);}
  mountChangesPanel(host,{data,participant:state.prefs.participant,seek:seekChange,caughtUp:kind==='mine'&&state.changes?.status==='changed'?caughtUp:undefined});
}
function changesShortcut(){
  if(!state.doc){toast('Open a document to compare editions.');return;}
  if(state.doc.historical){versions.open();return;}
  if(state.changes?.status==='changed'&&state.changes.prose_changed!==false)openChanges('mine');
  else if(state.editions?.newer)openChanges('successor');
  else if(state.changes?.others?.length)openChanges('against',state.changes.others[0].participant);
  else toast(state.changes?.status==='unavailable'?'The edition you read isn’t in the vault history.':'Nothing changed since this edition was read.');
}
function seekChange(start,end){
  const blocks=[...$('#article').querySelectorAll('[data-source-start]')].filter(el=>!el.closest('.document-embed,[data-reader-decoration]'));
  const hit=blocks.filter(el=>+el.dataset.sourceStart<=start&&start<+el.dataset.sourceEnd).sort((a,b)=>(+a.dataset.sourceEnd-a.dataset.sourceStart)-(+b.dataset.sourceEnd-b.dataset.sourceStart))[0]
    ||blocks.filter(el=>+el.dataset.sourceStart>=start)[0]||blocks.at(-1);
  if(!hit)return;
  const range=document.createRange();range.selectNode(hit);moveToRange(range);
  hit.classList.remove('change-target');void hit.offsetWidth;hit.classList.add('change-target');setTimeout(()=>hit.classList.remove('change-target'),1800);
}
/** The version chip, historical banner and status twin; Space v or the chip opens the timeline. */
function mountEditions(){
  for(const el of $('#main').querySelectorAll('.version-line,.historical-banner'))wireDocumentLinks(el);
  versions.wire($('#main'));versions.update();
}
function openEditions(){versions.open();}
async function renderMarkdown(container,raw,path,depth,{defer=false}={}) {
  const source=bodyOf(raw);
    let markdown=source.text.replace(/!\[\[([^\]]+)\]\]/g,(_,target)=>`<div class="document-embed" data-embed-target="${esc(target.split('|')[0])}"></div>`).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_,target,label)=>`[${label || target}](${encodeURI(target)})`);
  // Keep line maps based on unexpanded source for annotatable blocks. Embed rewrites
  // never grant a source coordinate to their rendered children.
  const rendered=md.render(markdown,{raw:source.text,full:raw,offset:source.offset,...mathOptions(raw)});
  const clean=DOMPurify.sanitize(rendered,{USE_PROFILES:{html:true},FORBID_TAGS:['style','form','input','button','textarea','select','iframe'],FORBID_ATTR:['style','srcset']});
  const template=document.createElement('template');template.innerHTML=clean;
  const images=[];
  for(const image of template.content.querySelectorAll('img')){
    const src=image.getAttribute('src') || '';
    if(/^(?:https?:|data:|\/\/)/i.test(src)){image.removeAttribute('src');image.alt=(image.alt || 'External image')+' (not loaded)';continue;}
    images.push(image);
  }
  const located=await resolveMany(path,images.map(image=>image.getAttribute('src') || ''));
  images.forEach((image,index)=>{const resolved=located[index];if(resolved?.path)image.src='/api/file?path='+param(resolved.path);else{image.removeAttribute('src');image.alt=(image.alt || 'Image')+' (unavailable)';}});
  clearControlsWithin(container);container.replaceChildren(template.content);slugHeadings(container);
  prepareDiagrams(container);
  const embeds=[...container.querySelectorAll('[data-embed-target]')];
  for(const embed of embeds){const target=embed.dataset.embedTarget;embed.innerHTML=`<span class="embed-note">Embedded document</span><a class="embed-link" href="${esc(target)}">${esc(target)} ↗</a>`;}
  // The first eight embeds load together, then render in source order.
  const wanted=depth>0?[]:embeds.slice(0,8),targets=await resolveMany(path,wanted.map(embed=>embed.dataset.embedTarget));
  const nested=await Promise.all(targets.map(resolved=>resolved?.path&&resolved.path!==path?api('/api/document?path='+param(resolved.path)).catch(()=>null):null));
  for(const [index,embed] of wanted.entries()){
    const doc=nested[index],resolved=targets[index];
    if(!doc || !['.md','.markdown'].includes(doc.kind) || doc.text.length>128000)continue;
    try {
      const content=document.createElement('div');content.className='embedded-content';content.dataset.sourcePath=resolved.path;embed.append(content);
      await renderMarkdown(content,doc.text,resolved.path,depth+1,{defer});wireArticleLinks(content,resolved.path);
    }catch{/* Keep the source link if an embedded edition is unavailable. */}
  }
  container.querySelectorAll('img').forEach(image=>image.addEventListener('load',imageLoaded));
  mountCodeBlocks(container);mountCallouts(container,()=>{refreshScroll();positionPins();});
  // A deferred render leaves diagrams to drawLate() after first paint; drawing many waits on the renderer.
  if(!defer)await drawDiagrams(container);
  await drawMath(container);
}
/** Draw a shown document's diagrams (its own and its embeds') after first paint, keeping the reader's place. */
async function drawLate(article,id){
  if(!article.querySelector('.reader-diagram-canvas[data-state=loading]'))return;
  const place=readingPlace();let moved=false;const stop=()=>{moved=true;};
  const events=['wheel','keydown','pointerdown','touchstart'];events.forEach(type=>addEventListener(type,stop,{capture:true,passive:true}));
  try{
    await drawDiagrams(article);
    for(const content of article.querySelectorAll('.embedded-content'))await drawDiagrams(content);
  }finally{events.forEach(type=>removeEventListener(type,stop,{capture:true}));}
  if(id!==state.routeId||moved||!place?.block.isConnected)return;
  const geometry=reading?.geometry();
  if(geometry){const range=document.createRange();range.selectNodeContents(place.block);reading.reveal(range,false);}
  else{const shift=place.block.getBoundingClientRect().top-place.top;if(Math.abs(shift)>1)scrollTo(0,scrollY+shift);}
}
/** The first source block in view, and its offset from the top of the window. */
function readingPlace(){
  const blocks=[...($('#article')?.querySelectorAll('[data-source-start]')||[])].filter(el=>!el.closest('.document-embed,[data-reader-decoration]')),geometry=reading?.geometry();
  if(geometry){const box=geometry.viewport.getBoundingClientRect();const block=blocks.find(el=>{const r=el.getClientRects()[0];return r&&r.width>0&&r.right>box.left+2&&r.left<box.right-2;});return block?{block,top:0}:null;}
  const block=blocks.find(el=>el.getBoundingClientRect().bottom>0);return block?{block,top:block.getBoundingClientRect().top}:null;
}
// Math placeholders from math.mjs are typeset by the lazy KaTeX chunk; its CSS and fonts load with it.
let mathModule=null;
async function drawMath(container){
  if(!container.querySelector('.reader-math[data-tex]:not([data-state])'))return;
  try{
    if(!document.querySelector('link[data-katex]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/assets/controls/katex/katex.css';link.dataset.katex='';const loaded=new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=()=>reject(new Error('KaTeX styles did not load'));});document.head.append(link);await loaded;}
    mathModule??=await import('./controls/math.js');mathModule.installMathCopy();
  }catch(error){console.error(error);document.querySelector('link[data-katex]')?.remove();notify('Formulas couldn’t load; showing their TeX instead.','error');return;}
  const {skipped}=await mathModule.renderMath(container,{onRender:()=>{refreshScroll();positionPins();}});
  if(skipped)notify(`Showing the first ${mathModule.MATH_LIMIT.toLocaleString('en-US')} formulas.`);
}
// Mermaid fences become figures: a decoration canvas for the drawing (the lazy Pele chunk
// fills it) and a "Diagram source" disclosure that keeps the fence's text for find and annotations.
function prepareDiagrams(container){
  for(const pre of container.querySelectorAll('pre:has(> code.language-mermaid)')){
    if(pre.closest('.reader-diagram'))continue;
    const source=pre.textContent,figure=document.createElement('figure'),canvas=document.createElement('div'),details=document.createElement('details'),summary=document.createElement('summary');
    figure.className='reader-diagram';canvas.className='reader-diagram-canvas';canvas.dataset.readerDecoration='';canvas.dataset.state='loading';canvas.diagramSource=source;
    canvas.style.setProperty('--diagram-estimate',Math.min(420,64+source.split('\n').length*22)+'px');
    details.className='reader-diagram-source';summary.textContent='Diagram source';summary.dataset.readerDecoration='';
    pre.replaceWith(figure);details.append(summary,pre);figure.append(canvas,details);
  }
}
let diagramsModule=null;
async function drawDiagrams(container){
  if(!container.querySelector('.reader-diagram-canvas[data-state=loading]'))return;
  try{diagramsModule??=await import('./controls/diagrams.js');}
  catch(error){console.error(error);for(const canvas of container.querySelectorAll('.reader-diagram-canvas[data-state=loading]')){canvas.dataset.state='error';canvas.textContent='Couldn’t draw this diagram: the diagram renderer did not load.';canvas.closest('figure').querySelector('details').open=true;}notify('Diagrams couldn’t load; showing their source instead.','error');return;}
  await diagramsModule.mountDiagrams(container,{onRender:()=>{refreshScroll();positionPins();}});
}
function openDiagram(canvas){
  const svg=canvas.querySelector(':scope > svg');if(!svg)return;
  const copy=svg.cloneNode(true),width=+svg.getAttribute('width')||svg.getBoundingClientRect().width,height=+svg.getAttribute('height')||svg.getBoundingClientRect().height;
  // Full size, or larger when the natural size is small, up to three times.
  const scale=Math.max(1,Math.min(3,(innerWidth*.9-48)/width,(innerHeight*.82-90)/height));
  copy.style.width=Math.round(width*scale)+'px';copy.style.maxWidth='none';copy.style.height='auto';copy.removeAttribute('aria-hidden');copy.setAttribute('role','img');copy.setAttribute('aria-label',canvas.getAttribute('aria-label')||'Diagram');
  $('#diagram-body').replaceChildren(copy);openDialog('diagram-dialog');$('#diagram-body').focus();
}
document.addEventListener('click',event=>{const canvas=event.target.closest?.('#main .reader-diagram-canvas[data-state=ready]');if(canvas&&getSelection()?.isCollapsed!==false)openDiagram(canvas);});
document.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.defaultPrevented&&event.target.matches?.('.reader-diagram-canvas[data-state=ready]')){event.preventDefault();openDiagram(event.target);}},true);
/** Resolve many links from one document in batched requests; failed targets map to null. */
async function resolveMany(path,targets){
  const unique=[...new Set(targets)],found=new Map(),batches=[];let size=0;
  // At most 64 targets (the server limit) and about 12 KB of query per request.
  for(const target of unique){const length=param(target).length+8;if(!batches.length||batches.at(-1).length>=64||size+length>12000){batches.push([]);size=0;}batches.at(-1).push(target);size+=length;}
  // Two batches at a time stays well inside the server's request limit.
  for(let i=0;i<batches.length;i+=2)await Promise.all(batches.slice(i,i+2).map(async batch=>{
    try{const {results}=await api('/api/resolve-batch?from='+param(path)+batch.map(target=>'&target='+param(target)).join(''));batch.forEach((target,index)=>found.set(target,results[index]?.path?results[index]:null));}
    catch{batch.forEach(target=>found.set(target,null));}
  }));
  return targets.map(target=>found.get(target)??null);
}
// Many images finish loading together; reflow once per frame instead of once per image.
function imageLoaded(){if(imageLoaded.frame)return;imageLoaded.frame=requestAnimationFrame(()=>{imageLoaded.frame=0;refreshScroll();positionPins();});}
/** Bring a heading (by id or slug) to the top of the reading view; an unknown id is ignored. */
function showHeading(root,id){
  const target=id&&findFragment(root,id);if(!target)return false;
  const range=document.createRange();range.selectNode(target);
  if(!reading?.reveal(range,false))scrollToPosition(scrollY+target.getBoundingClientRect().top-24,false);
  return true;
}
function wireArticleLinks(root,path){
  root.querySelectorAll('a').forEach(link=>link.addEventListener('click',async event=>{
    if(link.closest('.embedded-content') && root.id==='article')return;
    const href=link.getAttribute('href');if(!href)return;
    if(href.startsWith('#')){event.preventDefault();const heading=decode(href.slice(1));if(showHeading(root,heading)&&root.id==='article')history.replaceState(history.state,'',routeHash(path,null,heading));return;}
    if(/^(https?:|mailto:)/i.test(href)){link.target='_blank';link.rel='noopener noreferrer';return;}
    event.preventDefault();
    try{const resolved=await api('/api/resolve?from='+param(path)+'&target='+param(decodeURI(href)));
      // Shift-click opens the target in the other pane, splitting the window first if needed.
      if(event.shiftKey)openInSplit('#read='+param(resolved.path)+(resolved.fragment?'&h='+param(resolved.fragment):''));else navigate(resolved.path,{fragment:resolved.fragment});}catch(error){report(error);}
  }));
}

// Reading log: one /api/readers request per path and edition per session, in parallel
// with the discussion; it never delays the article. The line reserves its height first.
const readingLogs=new Map();
function readingLogKey(doc){return doc.path+'\n'+doc.sha256+'\n'+state.prefs.participant;}
function loadReadingLog(doc,id){
  const key=readingLogKey(doc);
  if(!readingLogs.has(key))readingLogs.set(key,api('/api/readers?path='+param(doc.path)+'&participant='+param(state.prefs.participant)).catch(error=>{readingLogs.delete(key);throw error;}));
  readingLogs.get(key).then(data=>paintReadingLog(data,id),error=>{
    if(id!==state.routeId)return;const slot=$('#main .reading-log');if(slot){slot.innerHTML='<p class="reading-log-empty">Reading log unavailable</p>';slot.dataset.ready='error';}
    console.warn(error);notify('Reading log unavailable: '+(error.message||error));
  });
}
function youReadNow(doc,id){
  const key=readingLogKey(doc),pending=readingLogs.get(key);if(!pending)return;
  const updated=pending.then(data=>withYou(data));readingLogs.set(key,updated);updated.then(data=>paintReadingLog(data,id),()=>{});
}
function paintReadingLog(data,id){
  const slot=$('#main .reading-log');if(id!==state.routeId||!slot||state.doc?.path!==data.path)return;
  const open=slot.querySelector('.reading-log-details')?.open,agents=slot.querySelector('.reading-log-agents')?.open;
  slot.innerHTML=readingLogHTML(data);slot.dataset.ready='true';
  const details=slot.querySelector('.reading-log-details');
  if(details){details.open=!!open;const nested=slot.querySelector('.reading-log-agents');if(nested)nested.open=!!agents;}
  slot.querySelectorAll('details').forEach(el=>el.addEventListener('toggle',()=>{refreshScroll();positionPins();}));
  slot.querySelectorAll('[data-reader-threads]').forEach(button=>button.onclick=()=>openThreadList(button.dataset.readerThreads));
  refreshScroll();positionPins();
}

async function showNextReads(path,id){
  if(state.prefs.nextReads===false)return;
  const [data,queued]=await Promise.all([api('/api/next?path='+param(path)+'&participant='+param(state.prefs.participant)).catch(()=>null),queue.peek()]);
  const items=data?.items||[];
  if(id!==state.routeId||state.doc?.path!==path||!items.length&&!queued||$('#main .next-reads'))return;
  const aside=document.createElement('aside');aside.className='next-reads';aside.dataset.readerDecoration='';aside.dataset.endOrder='2';
  if(items.length)aside.setAttribute('aria-labelledby','next-reads-title');else aside.setAttribute('aria-label','Next in your queue');
  const byline=w=>esc([w.authors?.join(' · '),w.date?formatDate(w.date):''].filter(Boolean).join(' · ')||'Unspecified author');
  // When the queue has something, it leads: the next track before the recommendations.
  const lead=queued?`<a class="next-read next-in-queue" href="${esc('#read='+param(queued.path))}" data-path="${esc(queued.path)}"><span class="next-in-queue-label">Next in your queue →</span><span class="next-read-title">${esc(queued.title)}${!queued.read?'<span class="unread-pip" title="Unread edition" aria-label="Unread edition"></span>':''}</span><span class="next-read-byline">${byline(queued)}</span><span class="next-read-keys"><kbd>Space</kbd> <kbd>n</kbd></span></a>`:'';
  aside.innerHTML=lead+(items.length?`<div class="eyebrow" id="next-reads-title">Read next</div><ol>${items.map(w=>`<li><a class="next-read" href="${esc('#read='+param(w.primary))}" data-path="${esc(w.primary)}"><span class="next-read-title">${esc(w.title)}${!w.read?'<span class="unread-pip" title="Unread edition" aria-label="Unread edition"></span>':''}</span><span class="next-read-byline">${byline(w)}</span><span class="next-read-reasons">${w.reasons.map(r=>`<span>${esc(r)}</span>`).join('')}</span></a><button type="button" data-button="ghost xs" class="next-read-queue" data-queue-add="${esc(w.primary)}" aria-label="Add ${esc(w.title)} to your queue" title="Add to your queue · q">+ Queue</button></li>`).join('')}</ol>`:'');
  wireDocumentLinks(aside);
  aside.querySelectorAll('[data-queue-add]').forEach(button=>button.onclick=event=>{event.preventDefault();queue.add(button.dataset.queueAdd);});
  if(!reading?.placeAtEnd(aside))return;
  positionPins();
}
function domProjection(root) {
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){return node.parentElement?.closest('.annotation-pin,.document-embed,[data-reader-decoration],script,style')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;}});
  let text='',nodes=[],offsets=[],node;
  while((node=walker.nextNode()))for(let i=0;i<node.data.length;i++){text+=node.data[i];nodes.push(node);offsets.push(i);}
  let normalized='',starts=[],ends=[];
  for(const match of text.matchAll(/\s+|\S/gu)){
    normalized+=/\s/u.test(match[0])?' ':match[0];
    for(let k=0;k<(/\s/u.test(match[0])?1:match[0].length);k++){starts.push({node:nodes[match.index+k],offset:offsets[match.index+k]});const last=match.index+match[0].length-1;ends.push({node:nodes[last],offset:offsets[last]+1});}
  }
  return {text:normalized,range(start,end){const a=starts[start],b=ends[end-1];if(!a||!b)return null;const range=document.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);return range;},
    // Projected index of the first character at or after a range's start, for telling repeated quotes apart.
    indexOf(range){const index=starts.findIndex(point=>range.comparePoint(point.node,point.offset)>=0);return index<0?normalized.length:index;}};
}
// The source projection costs O(n) per document; build it only when a thread or selection needs it.
let projected={doc:null,value:null};
function projection(){const doc=state.doc;if(!doc||doc.text===null)return null;if(projected.doc!==doc)projected={doc,value:projectSource(doc.text)};return projected.value;}
function sourceBlock(start,end) {
  const blocks=[...$('#article').querySelectorAll('[data-source-start]')].filter(el=>!el.closest('.document-embed') && +el.dataset.sourceStart<=start && +el.dataset.sourceEnd>=end);
  return blocks.sort((a,b)=>(+a.dataset.sourceEnd-a.dataset.sourceStart)-(+b.dataset.sourceEnd-b.dataset.sourceStart))[0] || $('#article');
}
async function loadDiscussion(){
  if(!state.doc || !['.md','.markdown'].includes(state.doc.kind))return;
  const path=state.doc.path;
  const data=await api('/api/discussion?path='+param(path)+'&participant='+param(state.prefs.participant));
  if(state.doc?.path!==path)return;
  state.threads=data.threads;state.attention=data.attention.items;paintAnnotations();
}
function paintAnnotations(){
  const article=$('#article');if(!article)return;
  article.querySelectorAll('.annotation-pin').forEach(el=>el.remove());state.ranges=[];
  const groups={'reader-own':[],'reader-other':[],'reader-warning':[]};
  for(const thread of state.threads){
    if(!['exact','relocated'].includes(thread.location?.status))continue;
    const start=thread.location.start,end=thread.location.end,root=sourceBlock(start,end),dom=domProjection(root);
    let quote=visibleQuote(projection(),start,end);let hits=occurrences(dom.text,quote);
    if(hits.length!==1){quote=normalize(thread.anchor.quote);hits=occurrences(dom.text,quote);}
    if(hits.length!==1)continue;
    const range=dom.range(hits[0].start,hits[0].end);if(!range)continue;
    const key=thread.kind==='warning'?'reader-warning':thread.owner===state.prefs.participant?'reader-own':'reader-other';
    groups[key].push(range);state.ranges.push({thread,range});
    const pin=document.createElement('button');pin.className='annotation-pin'+(thread.kind==='warning'?' warning':'')+(threadUnread(thread.id)?' unread':'');
    pin.textContent=thread.kind==='warning'?'!':String(thread.comments.length || '·');pin.title=`${thread.owner} · ${plural(thread.comments.length,'comment')}`;pin.setAttribute('aria-label',`Open ${thread.owner}’s ${thread.kind==='warning'?'warning':'highlight'} thread`);pin.dataset.thread=thread.id;
    pin.onclick=()=>openThread(thread.id);article.append(pin);
  }
  if(window.Highlight && CSS.highlights)for(const [name,ranges] of Object.entries(groups))CSS.highlights.set(name,new Highlight(...ranges));
  positionPins();reading?.pips();
}
/** Two-page pins sit in the gutter right of their column (or the outer margin), stacked per column, never over the text. */
function spreadPinPlacer(article){
  const viewport=article.closest('.book-viewport')?.getBoundingClientRect(),style=getComputedStyle(article);if(!viewport)return null;
  const gap=parseFloat(style.columnGap)||40,columns=parseInt(style.columnCount)||1,width=(viewport.width-gap*(columns-1))/columns,stacks=[];
  return (rect,pin)=>{
    const column=Math.max(0,Math.min(columns-1,Math.floor((rect.left-viewport.left+gap/2)/(width+gap)))),right=viewport.left+column*(width+gap)+width;
    const size=pin.offsetWidth||28,room=column<columns-1?gap:innerWidth-right,top=Math.max((stacks[column]??-Infinity)+size+3,rect.top+rect.height/2);stacks[column]=top;
    return {left:Math.min(innerWidth-size-2,right+Math.max(2,(room-size)/2)),top};
  };
}
function positionPins(){
  const article=$('#article');if(!article)return;const box=article.getBoundingClientRect();let previous=-30;const place=reading?.hasBook()?spreadPinPlacer(article):null;
  for(const {thread,range} of state.ranges){const rects=[...range.getClientRects()];const rect=reading?.hasBook()?rects.find(r=>r.right>45&&r.left<innerWidth-45):rects.at(-1);const pin=article.querySelector(`[data-thread="${CSS.escape(thread.id)}"]`);if(!pin)continue;pin.hidden=!rect;if(!rect)continue;if(place){const at=place(rect,pin);pin.style.left=at.left+'px';pin.style.top=at.top+'px';}else if(reading?.hasBook()){pin.style.left=Math.min(innerWidth-25,rect.right+9)+'px';pin.style.top=rect.bottom-5+'px';}else{pin.style.left='';const top=Math.max(previous+27,rect.bottom-box.top-5);pin.style.top=top+'px';previous=top;}}
}
function threadUnread(id){return state.attention.find(i=>i.key==='thread:'+id)?.read!==true;}
function seenLabel(key){const item=state.attention.find(i=>i.key===key);return item?.seen_by?.length?'Seen by '+item.seen_by.map(r=>r.participant).join(', '):'Not yet seen by another reader';}
// Chat bodies use the same markdown-it and DOMPurify pipeline as documents, without source coordinates.
function chatMarkdown(text){
  const clean=DOMPurify.sanitize(md.render(text,{}),{USE_PROFILES:{html:true},FORBID_TAGS:['style','form','input','button','textarea','select','iframe','img','video','audio'],FORBID_ATTR:['style','srcset']});
  const template=document.createElement('template');template.innerHTML=clean;
  for(const link of template.content.querySelectorAll('a[href]')){const href=link.getAttribute('href');
    if(/^(https?:|mailto:)/i.test(href)){link.target='_blank';link.rel='noopener noreferrer';}
    else if(href.startsWith('library/'))link.setAttribute('href','#read='+param(decodeURI(href)));
    else if(!href.startsWith('#'))link.removeAttribute('href');}
  return template.innerHTML;
}
function toggleChat(){
  if(chatOpen()){closeChat();if(split?.active())split.refocus();else focusMain();return;}
  if(split?.active()){const doc=split.focused()?.doc;
    if(!doc?.path||!doc.path.startsWith('library/')||doc.historical||doc.preview){toast('Open a filed, current document in this pane to chat about it.');return;}
    closeContext();openChat(doc.path,doc.title||doc.path,state.prefs.participant);return;}
  if(!state.doc){toast('Open a document to chat about it.');return;}
  if(state.doc.preview){toast('Inbox arrivals are previews; chat about a document once it is filed.');return;}
  if(state.doc.historical){toast('Chats are about the current file; open it to chat about this document.');return;}
  closeContext();openChat(state.doc.path,String(state.doc.metadata?.title||state.doc.title),state.prefs.participant);
}
/** Focus moves into the margin panel when it opens and returns to whatever opened it when it closes. */
function enterThreadPanel(target){
  const active=document.activeElement;if(!$('#thread-panel').contains(active))state.threadOpener=active&&active!==document.body?active:null;
  (target || $('#thread-title')).focus({preventScroll:true});
}
function leaveThreadPanel(){
  const opener=state.threadOpener;state.threadOpener=null;$('#thread-panel').hidden=true;state.activeThread=null;
  (opener?.isConnected&&!opener.closest('[hidden],dialog:not([open])')?opener:$('#main')).focus({preventScroll:true});
}
function openThreadList(participant=null){
  queue?.close(false);
  if(!state.doc){toast('Open a document to read its margins.');return;}
  if(!['.md','.markdown'].includes(state.doc.kind)){toast('Passage threads currently support Markdown documents.');return;}
  if(typeof participant!=='string')participant=null;
  const threads=participant?state.threads.filter(t=>t.owner===participant||t.comments.some(c=>c.author===participant)):state.threads;
  state.activeThread=null;$('#thread-panel').hidden=false;$('#thread-title').textContent=participant?'In the margins · '+participant:'In the margins';
  $('#thread-body').innerHTML=threads.length?threads.map(t=>`<button class="thread-list-item" data-open-thread="${esc(t.id)}"><small>${esc(t.owner)}${t.kind==='warning'?' · warning':''}${threadUnread(t.id)?' · unread':''}</small><blockquote>“${esc(plainQuote(t.anchor.quote).slice(0,220))}”</blockquote><small>${plural(t.comments.length,'comment')}${t.resolved?' · resolved':''}</small></button>`).join(''):'<p class="empty-note">No notes in these margins yet.<br>Select a passage to begin.</p>';
  $('#thread-body').querySelectorAll('[data-open-thread]').forEach(el=>el.onclick=()=>openThread(el.dataset.openThread));
  enterThreadPanel($('#thread-body .thread-list-item'));
}
function renderThread(thread){
  const draft=state.activeThread===thread.id?$('#reply-body')?.value || '':'';const wasWriting=document.activeElement?.id==='reply-body';
  $('#thread-title').textContent=thread.kind==='warning'?'A word of caution':'In the margins';
  $('#thread-body').innerHTML=`<blockquote class="thread-quote${thread.kind==='warning'?' warning':''}">${esc(plainQuote(thread.anchor.quote))}</blockquote><div class="thread-status">${esc(thread.owner)} · ${formatDate(thread.created_at)}${thread.resolved?' · resolved':''}<br>${esc(seenLabel('thread:'+thread.id))}</div>${!['exact','relocated'].includes(thread.location?.status)?'<p class="orphan-note">This passage has moved or is ambiguous. The original quote is preserved; no inline location is guessed.</p>':''}<div class="comments">${thread.comments.map(c=>`<div class="comment${c.reply_to?' reply':''}"><div class="comment-header"><span class="comment-author">${esc(c.author)}</span><span class="comment-time">${formatDate(c.created_at)}</span></div><p>${esc(c.body)}</p><div class="comment-footer"><span>${esc(seenLabel('comment:'+thread.id+':'+c.id))}</span><button type="button" data-button="ghost xs" data-reply="${esc(c.id)}">Reply</button></div></div>`).join('') || '<p class="quiet">A passage worth returning to.</p>'}</div><form id="thread-reply" class="thread-reply"><div id="reply-context" class="reply-context" hidden></div><label class="sr-only" for="reply-body">Reply to this thread</label><textarea id="reply-body" maxlength="16000" placeholder="Continue the thought…" required></textarea><button type="submit" data-button="default" class="form-submit">Add reply</button></form>`;
  $('#reply-body').value=draft;if(wasWriting)$('#reply-body').focus();
  $('#thread-body').querySelectorAll('[data-reply]').forEach(el=>el.onclick=()=>{state.replyTo=el.dataset.reply;const parent=thread.comments.find(c=>c.id===state.replyTo);$('#reply-context').hidden=false;$('#reply-context').textContent='Replying to '+parent.author;$('#reply-body').focus();});
  $('#thread-reply').onsubmit=async event=>{event.preventDefault();const body=$('#reply-body').value;const replyKey=JSON.stringify([thread.id,state.prefs.participant,body,state.replyTo]);state.replyRequests ||= {};state.replyRequests[replyKey] ||= crypto.randomUUID();const button=$('#thread-reply button');button.disabled=true;try{await api('/api/annotations',{operation:'reply',thread_id:thread.id,author:state.prefs.participant,body,reply_to:state.replyTo,request_id:state.replyRequests[replyKey]});state.replyTo=null;$('#reply-body').value='';await openThread(thread.id);toast('Your reply is in the margins.');}catch(error){button.disabled=false;report(error);}};
}
async function openThread(id){
  try {
    await loadDiscussion();const thread=state.threads.find(t=>t.id===id);if(!thread)throw new Error('This thread is not in the open document.');
    const first=state.activeThread!==id||$('#thread-panel').hidden;
    queue?.close(false);if(state.activeThread!==id){state.replyTo=null;$('#thread-body').replaceChildren();}state.activeThread=id;$('#thread-panel').hidden=false;renderThread(thread);
    if(first)enterThreadPanel();
    const items=state.attention.filter(i=>i.thread_id===id).map(({key,version})=>({key,version}));
    if(items.length)await api('/api/seen',{participant:state.prefs.participant,items});
    await loadDiscussion();if(state.activeThread===id)renderThread(state.threads.find(t=>t.id===id));
  }catch(error){report(error);}
}
/** Which repeat of the quote the range starts at, counted within the block's visible text. */
function quoteOccurrence(block,range,quote){
  const dom=domProjection(block),at=dom.indexOf(range),needle=normalize(quote);let count=0,before=0,index=0;
  while(needle&&(index=dom.text.indexOf(needle,index))>=0){count++;if(index<at)before++;index++;}
  return {occurrence:before,count};
}
function captureSelection(){
  const article=$('#article'),selection=getSelection();if(!article||state.doc?.historical||!state.doc?.text||!selection?.rangeCount||selection.isCollapsed)return;
  const range=selection.getRangeAt(0);
  const parent=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
  if(!article.contains(parent)||parent.closest('.document-embed,.annotation-pin,[data-reader-decoration]'))return;
  const quote=selection.toString();if(!quote.trim())return;
  const block=parent.closest('[data-source-start]');
  try {
    const bounds=block?{start:+block.dataset.sourceStart,end:+block.dataset.sourceEnd,...quoteOccurrence(block,range,quote)}:null;
    const coords=sourceRangeForQuote(state.doc.text,quote,bounds,projection());
    state.selected={...coords,path:state.doc.path,sha256:state.doc.sha256,quote:rawCodePoints(state.doc.text,coords.start,coords.end),requests:{}};
    state.lastQuote={quote:plainQuote(state.selected.quote),path:state.doc.path,title:String(state.doc.metadata?.title||state.doc.title||state.doc.path)};  // :cite in the scratch pad
    const rect=[...range.getClientRects()].at(-1) || range.getBoundingClientRect(),tools=$('#selection-tools');
    tools.hidden=false;tools.style.left=Math.max(130,Math.min(innerWidth-130,rect.right))+'px';tools.style.top=Math.max(60,rect.top-10)+'px';
    // Touch browsers draw their own selection menu above the passage, so the toolbar goes below it there.
    if(matchMedia('(pointer: coarse)').matches)tools.style.top=Math.min(innerHeight-20,range.getBoundingClientRect().bottom+tools.offsetHeight+28)+'px';
  }catch(error){state.selected=null;$('#selection-tools').hidden=true;if(!error.offline&&captureSelection.failed!==quote)toast(error.message);captureSelection.failed=quote;}
}
async function createAnnotation(kind,comment=''){
  const selected=state.selected;if(!selected||selected.path!==state.doc?.path)throw new Error('Select the passage again.');
  const key=JSON.stringify([kind,comment]);selected.requests[key] ||= crypto.randomUUID();
  const thread=await api('/api/annotations',{operation:'create',path:selected.path,start:selected.start,end:selected.end,owner:state.prefs.participant,comment,expected_sha256:selected.sha256,request_id:selected.requests[key],kind});
  closeDialog('annotation-dialog');$('#selection-tools').hidden=true;getSelection()?.removeAllRanges();await loadDiscussion();if(comment || kind==='warning')await openThread(thread.id);else toast('Passage highlighted.');
}

function pickerWorks(source='recent'){
  const works=state.pickerFolder?latestWorks().filter(work=>work.primary.startsWith(state.pickerFolder)):source==='all'?latestWorks():state.data.recent;
  return (works.length || state.pickerFolder?works:latestWorks()).slice(0,+state.prefs.recent);
}
function pickerLabel(){return state.pickerFolder?'In '+state.pickerFolder:state.data.recent.length?'Recently opened':'Start with a recent addition';}
function openPicker(source='recent',folder=null){
  clearTimeout(searchTimer);state.pickerFolder=folder;$('#folder-scope').hidden=!folder;$('#folder-path').textContent=folder || '';$('#picker-title').textContent='Documents';$('#picker-filter').hidden=true;$('#picker-filter-toggle').setAttribute('aria-expanded','false');$('#picker-filter-toggle').innerHTML='Filter <kbd>/</kbd>';
  $('#file-query').value='';$('#search-status').textContent='';state.searchId++;state.resultIndex=0;
  state.results=pickerWorks(source);
  $('#search-label').textContent=source==='all'&&!folder?'The stacks':pickerLabel();
  drawResults();openDialog('picker');$('#file-results').focus();selectResult(state.resultIndex,true);
}
function activateDocumentNode(node,scroll=false){
  if(!node)return;const root=$('#file-results');
  root.querySelectorAll('[data-doc-node]').forEach(item=>{const active=item===node;item.toggleAttribute('data-active',active);item.setAttribute('aria-selected',String(active));});
  if(node.dataset.index!==undefined)state.resultIndex=+node.dataset.index;
  root.setAttribute('aria-activedescendant',node.id);$('#file-query').setAttribute('aria-activedescendant',node.id);
  if(scroll)node.scrollIntoView({block:'nearest'});
}
function drawResults(){
  const root=$('#file-results');clearControlsWithin(root);
  if(state.results.length){mountDocumentTree(root,state.results,openResult,node=>activateDocumentNode(node));selectResult(state.resultIndex,$('#picker').open);}
  else {root.innerHTML='<p class="empty-note">Nothing here yet. Try another phrase.</p>';root.removeAttribute('aria-activedescendant');$('#file-query').removeAttribute('aria-activedescendant');}
  $('#file-query').setAttribute('aria-controls','file-results');
}
function selectResult(index,scroll=true){
  if(!state.results.length)return;state.resultIndex=(index+state.results.length)%state.results.length;
  const work=state.results[state.resultIndex];revealDocumentRow($('#file-results'),work.path||work.primary);
  activateDocumentNode($('#file-option-'+state.resultIndex),scroll);
}
function openResult(index=state.resultIndex){const w=state.results[index];if(!w)return;closeDialog('picker');navigate(w.path || w.primary);}
const SEARCH_RETRIES = 5; // a 429 (another search running) retries after 0.5, 1, 2, 4 and 8 s
async function runSearch(attempt=0){
  const q=$('#file-query').value.trim(),id=++state.searchId;
  if(!q){state.results=pickerWorks();$('#search-label').textContent=pickerLabel();$('#search-status').textContent='';state.resultIndex=0;drawResults();return;}
  $('#search-label').textContent=state.mode==='semantic'?'Following the meaning…':'Searching…';
  mountSkeleton($('#file-results'),'search');
  try{const data=await api('/api/search?q='+param(q)+'&mode='+state.mode+'&participant='+param(state.prefs.participant)+(state.pickerFolder?'&path_prefix='+param(state.pickerFolder):''));if(id!==state.searchId||!$('#picker').open)return;state.results=data.results;state.resultIndex=0;$('#search-label').textContent=`${plural(data.results.length,'result')} · ${state.mode==='fuzzy'?'catalog':'index '+formatDate(data.indexed_at)}`;$('#search-status').textContent=(data.warnings || []).slice(0,2).join(' ');drawResults();}
  catch(error){if(id!==state.searchId)return;
    if(error.status===429&&attempt<SEARCH_RETRIES){$('#search-label').textContent='Another search is running; retrying…';$('#search-status').textContent='';
      searchTimer=setTimeout(()=>{if(id===state.searchId&&$('#picker').open)runSearch(attempt+1);},500*2**attempt);return;}
    state.results=[];drawResults();$('#file-results').innerHTML='<p class="empty-note">The search didn’t run, so there is nothing to show yet.</p>';
    $('#search-label').textContent='Search unavailable';$('#search-status').textContent=error.message;}
}
$('#clear-folder').onclick=()=>{state.pickerFolder=null;$('#folder-scope').hidden=true;$('#picker-title').textContent='Documents';runSearch();($('#picker-filter').hidden?$('#file-results'):$('#file-query')).focus();};
let searchTimer;
function showPickerFilter(){
  $('#picker-filter').hidden=false;$('#picker-filter-toggle').setAttribute('aria-expanded','true');$('#picker-filter-toggle').textContent='Hide filter';$('#file-query').focus();
}
function hidePickerFilter(){
  clearTimeout(searchTimer);state.searchId++;$('#picker-filter').hidden=true;$('#picker-filter-toggle').setAttribute('aria-expanded','false');$('#picker-filter-toggle').innerHTML='Filter <kbd>/</kbd>';$('#file-query').value='';$('#search-status').textContent='';state.results=pickerWorks();state.resultIndex=0;$('#search-label').textContent=pickerLabel();drawResults();$('#file-results').focus();reading?.updateStatus();
}
$('#picker-filter-toggle').onclick=()=>$('#picker-filter').hidden?showPickerFilter():hidePickerFilter();
$('#file-results').addEventListener('keydown',event=>{
  if(event.defaultPrevented)return;
  const root=event.currentTarget,nodes=visibleDocumentNodes(root),active=document.getElementById(root.getAttribute('aria-activedescendant')),index=nodes.indexOf(active);
  if(event.key==='/'){event.preventDefault();showPickerFilter();}
  else if(['j','k','ArrowDown','ArrowUp','Home','End'].includes(event.key)||event.ctrlKey&&['n','p'].includes(event.key)){
    event.preventDefault();event.stopPropagation();const next=event.key==='Home'?0:event.key==='End'?nodes.length-1:(index+(['j','ArrowDown','n'].includes(event.key)?1:-1)+nodes.length)%nodes.length;activateDocumentNode(nodes[next],true);
  }else if(['h','ArrowLeft','l','ArrowRight'].includes(event.key)){
    event.preventDefault();event.stopPropagation();if(!active)return;
    const right=['l','ArrowRight'].includes(event.key),folder=active.dataset.docNode==='folder',expanded=active.getAttribute('aria-expanded')==='true';
    if(folder&&(right?!expanded:expanded))active.click();
    else if(right&&folder)activateDocumentNode(nodes[index+1],true);
    else if(!right){const parent=root.querySelector('[data-tree-folder="'+CSS.escape(active.dataset.parentFolder||'')+'"] > [data-doc-node]');activateDocumentNode(parent,true);}
  }else if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();active?.click();}
  else if(event.key==='q'){event.preventDefault();event.stopPropagation();const work=active?.dataset.index!==undefined?state.results[+active.dataset.index]:null;if(work)queue.add(work.path||work.primary);}
});
$('#file-query').addEventListener('input',()=>{clearTimeout(searchTimer);state.searchId++;searchTimer=setTimeout(runSearch,state.mode==='semantic'?450:140);});
$('#file-query').addEventListener('keydown',event=>{
  if(event.key==='ArrowDown'||event.ctrlKey&&['j','n'].includes(event.key)){event.preventDefault();selectResult(state.resultIndex+1);}
  else if(event.key==='ArrowUp'||event.ctrlKey&&['k','p'].includes(event.key)){event.preventDefault();selectResult(state.resultIndex-1);}
  else if(event.key==='Enter'){event.preventDefault();openResult();}
});
document.querySelectorAll('[data-mode]').forEach(el=>el.onclick=()=>{state.mode=el.dataset.mode;document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button===el)));runSearch();});

function clearFind(){state.pdf?.cancelFind();state.find=[];state.findMore=false;state.findIndex=-1;CSS.highlights?.delete('reader-find');CSS.highlights?.delete('reader-current');$('#find-query').value='';$('#find-count').textContent='0 / 0';state.fromSearch=null;searchChip();}
function searchChip(){
  const chip=$('#search-chip');if(!state.fromSearch){chip.hidden=true;return;}
  chip.hidden=false;chip.replaceChildren();const query=document.createElement('q');query.textContent=state.fromSearch.query;
  chip.append('From search: ',query,` · ${state.find.length?state.findIndex+1:0} of ${state.find.length}`);const hint=document.createElement('span');hint.className='search-chip-hint';hint.textContent=' · Esc to clear';chip.append(hint);
}
/** Open-at-passage: reveal the indexed line (or PDF page) in either layout, then highlight the query's words with find. */
async function revealPassage(at){
  const anchor=reading.revealLine(at.line,at.page);
  const terms=[...new Set(at.terms)].filter(Boolean).sort((a,b)=>b.length-a.length);
  if(!terms.length)return;
  if(state.pdf){
    $('#find-query').value=terms[0];await updateFind();
    const index=state.find.findIndex(hit=>hit.page>=(at.page||1));state.findIndex=index>=0?index:state.find.length?0:-1;
  }else{
    const root=$('#article');if(!root)return;const dom=domProjection(root);
    const pattern=new RegExp('(?<![\\p{L}\\p{N}_])(?:'+terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')(?![\\p{L}\\p{N}_])','giu');
    state.find=[];for(const match of dom.text.matchAll(pattern)){const range=dom.range(match.index,match.index+match[0].length);if(range)state.find.push(range);if(state.find.length>=2000)break;}
    if(window.Highlight&&CSS.highlights)CSS.highlights.set('reader-find',new Highlight(...state.find));
    const index=anchor?state.find.findIndex(range=>range.compareBoundaryPoints(Range.START_TO_START,anchor)>=0):0;
    state.findIndex=index>=0?index:state.find.length?0:-1;
  }
  state.fromSearch={query:at.query||terms.join(' ')};
  if(state.find.length){if(window.Highlight&&CSS.highlights&&!state.pdf)CSS.highlights.set('reader-current',new Highlight(state.find[state.findIndex]));$('#find-count').textContent=`${state.findIndex+1} / ${state.find.length}`;if(state.pdf)await showFind();}
  searchChip();
}
function openFind(){if(!state.doc){openPicker();return;}$('#find-bar').hidden=false;$('#find-query').focus();$('#find-query').select();}
async function updateFind(){
  const query=$('#find-query').value;
  if(state.pdf){const controller=state.pdf;$('#find-count').textContent='Searching PDF…';try{const result=await controller.find(query);if(!result||state.pdf!==controller||$('#find-query').value!==query)return;state.find=result.hits;state.findMore=!result.complete;state.findIndex=state.find.length?0:-1;showFind(false);if(!result.complete)toast(`PDF search stopped after ${result.examined} of ${plural(controller.count,'page')}; showing partial results.`);}catch(error){report(error);}return;}
  const root=$('#article');if(!root)return;const dom=domProjection(root);
  const hits=occurrences(dom.text,query);state.findMore=!!hits.limited;
  state.find=hits.map(({start,end})=>dom.range(start,end)).filter(Boolean);state.findIndex=state.find.length?0:-1;
  if(window.Highlight&&CSS.highlights)CSS.highlights.set('reader-find',new Highlight(...state.find));
  showFind(false);
}
async function showFind(scroll=true){
  $('#find-count').textContent=`${state.findIndex+1} / ${state.find.length}${state.findMore?'+':''}`;searchChip();
  if(!state.find.length){CSS.highlights?.delete('reader-current');return;}
  if(state.pdf){if(scroll){const controller=state.pdf,hit=state.find[state.findIndex],page=controller.pages[hit.page-1],range=document.createRange();range.selectNode(page);moveToRange(range);await controller.show(hit.page);if(controller!==state.pdf)return;const dom=domProjection(page.querySelector('.textLayer')||page),matches=occurrences(dom.text,$('#find-query').value),match=matches[hit.occurrence] || matches[0];if(match && window.Highlight&&CSS.highlights)CSS.highlights.set('reader-current',new Highlight(dom.range(match.start,match.end)));}return;}
  const range=state.find[state.findIndex];if(window.Highlight&&CSS.highlights)CSS.highlights.set('reader-current',new Highlight(range));if(scroll)moveToRange(range);
}
function nextFind(delta=1){if(!state.find.length){toast('Use / to find a passage first.');return;}state.findIndex=(state.findIndex+delta+state.find.length)%state.find.length;showFind();}
$('#find-query').oninput=updateFind;
$('#find-query').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();showFind();$('#find-bar').hidden=true;focusMain();}};
$('#find-next').onclick=()=>nextFind();$('#find-prev').onclick=()=>nextFind(-1);$('#find-close').onclick=()=>{$('#find-bar').hidden=true;focusMain();};

function renderBackstage(focusSettings=false){
  controls.update({prefs:{...state.prefs},participants:state.data?.participants||[]});
  clearControlsWithin($('#main'));mountBackstage($('#main'),{library:mountLibrary});resetScroll();reading?.updateStatus();
  prose.status(true).then(status=>controls.update({prose:status}));
  // The Settings heading takes focus (NORMAL mode), so leader keys keep working and Tab moves into the fields.
  if(focusSettings)requestAnimationFrame(()=>{$('#backstage-settings')?.scrollIntoView({block:'start'});const heading=$('#settings-title');heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});});
  else focusMain();
}
async function openPreferences(){
  if(state.view==='backstage'){closeContext();renderBackstage(true);return;}
  state.focusSettings=true;await navigate(BACKSTAGE);
}
function setThemeEditorOpen(open){
  if(open&&!state.themeEditorOpen)state.themeEditorOpener=document.activeElement;
  state.themeEditorOpen=open;controls.update({themeEditorOpen:open});state.smoother?.paused(open);reading?.updateStatus();
  // Closing returns focus to where the editor was opened from (after the sheet's own focus handling), or the page.
  if(!open)setTimeout(()=>{const opener=state.themeEditorOpener;state.themeEditorOpener=null;if(state.themeEditorOpen)return;(opener?.isConnected&&opener!==document.body&&!opener.closest('#theme-editor')?opener:$('#main')).focus({preventScroll:true});reading?.updateStatus();},0);
}
function useTheme(theme){state.prefs.theme=theme;document.documentElement.dataset.theme=theme;savePrefs();controls.update({theme,prefs:{...state.prefs}});reading?.updateStatus();}
function themesChanged(themes,fonts){
  themeCache=applyThemes(themes,fonts);try{localStorage.setItem('reader.themes.v1',JSON.stringify(themeCache));}catch{}
  controls.update({customThemes:themes,fonts});
  if(!knownTheme(state.prefs.theme))useTheme(state.prefs.theme.endsWith('-dark')?'ink':'paper');
}
async function loadThemes(){try{const list=await api('/api/themes');themesChanged(list.themes,list.fonts);}catch(error){report(error);}}
function previewFont(href){if(!/^\/fonts\/[a-z0-9-]+\/font\.css$/.test(href)||document.querySelector(`link[data-theme-font][href="${href}"]`))return;const link=document.createElement('link');link.rel='stylesheet';link.href=href;link.dataset.themeFont='';document.head.append(link);}
async function applyPreferences(prefs){
  await reading?.leave();if(prefs.proseColors!==state.prefs.proseColors)state.proseStyles?.clear();state.prefs={...state.prefs,...prefs};savePrefs();document.documentElement.dataset.theme=state.prefs.theme;
  await loadLibrary();
  if(state.view==='backstage'){controls.update({theme:state.prefs.theme,prefs:{...state.prefs},participants:state.data?.participants||[]});const slot=$('#backstage-library-mount');if(slot)mountLibrary(slot);notify('Preferences saved.','success');}
  else if(state.doc)await navigate(state.doc.path,{record:false});else await renderHome(state.issuePath);reading?.updateStatus();
}
$('#annotation-form').onsubmit=async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;try{await createAnnotation($('#annotation-dialog').classList.contains('warning')?'warning':'highlight',$('#annotation-body').value);}catch(error){report(error);}finally{button.disabled=false;}};
$('#selection-tools').onmousedown=event=>event.preventDefault();
document.querySelectorAll('[data-annotate]').forEach(button=>button.onclick=()=>{
  const kind=button.dataset.annotate;if(kind==='highlight'){createAnnotation('highlight').catch(report);return;}
  $('#annotation-dialog').classList.toggle('warning',kind==='warning');$('#annotation-title').textContent=kind==='warning'?'Leave a warning.':'Leave a thought.';$('#annotation-quote').textContent=plainQuote(state.selected?.quote || '');$('#annotation-body').value='';$('#annotation-form button').textContent=kind==='warning'?'Leave warning':'Leave comment';openDialog('annotation-dialog');$('#annotation-body').focus();
});
$('#chat-open').onclick=toggleChat;
$('#thread-close').onclick=leaveThreadPanel;
// The thread list moves like the other panels: j / k or arrows between threads, Enter opens one.
$('#thread-body').addEventListener('keydown',event=>{
  const items=[...$('#thread-body').querySelectorAll('.thread-list-item')],index=items.indexOf(document.activeElement);
  if(index<0||event.ctrlKey||event.metaKey||event.altKey||!['j','k','ArrowDown','ArrowUp'].includes(event.key))return;
  event.preventDefault();items[(index+(['j','ArrowDown'].includes(event.key)?1:-1)+items.length)%items.length].focus();
});
$('#summon').onclick=()=>openPicker();
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>closeDialog(button.dataset.close));
document.querySelectorAll('dialog').forEach(dialog=>{
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(dialog.id==='picker'&&!$('#picker-filter').hidden)hidePickerFilter();else closeDialog(dialog.id);});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog(dialog.id);}});
});
let mouseSelecting=false,selectionTimer;
document.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse')mouseSelecting=true;},true);
document.addEventListener('mouseup',event=>{mouseSelecting=false;if(!event.target.closest('#selection-tools,dialog,#thread-panel'))setTimeout(captureSelection,0);});
document.addEventListener('touchend',event=>{if(!event.target.closest('#selection-tools,dialog,#thread-panel')){clearTimeout(selectionTimer);selectionTimer=setTimeout(captureSelection,350);}},{passive:true});
// Touch handles and keyboard selection never send mouseup, so a settled selection also shows the toolbar.
document.addEventListener('selectionchange',()=>{
  clearTimeout(selectionTimer);if(getSelection()?.isCollapsed){$('#selection-tools').hidden=true;captureSelection.failed=null;return;}
  selectionTimer=setTimeout(()=>{if(!mouseSelecting&&!document.querySelector('dialog[open]'))captureSelection();},450);
});
let hoverFrame;
document.addEventListener('mousemove',event=>{
  document.body.classList.toggle('reveal-controls',event.clientX>innerWidth-75&&event.clientY>innerHeight-80);
  if(hoverFrame)return;
  hoverFrame=requestAnimationFrame(()=>{hoverFrame=null;const hit=state.ranges.find(({range})=>[...range.getClientRects()].some(r=>event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom));const tip=$('#passage-tooltip');if(hit){tip.textContent=`${hit.thread.owner} · ${plural(hit.thread.comments.length,'comment')}`;tip.style.left=Math.max(10,Math.min(innerWidth-260,event.clientX+12))+'px';tip.style.top=event.clientY+20+'px';tip.classList.add('visible');}else tip.classList.remove('visible');});
});
let lastG=0,lastBracket={key:null,at:0},leaderTimer;
document.addEventListener('keydown',event=>{
  if(event.isComposing||event.defaultPrevented)return;
  if(queue?.handleKey(event))return;
  if(event.key==='F10'&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();state.leader=null;clearTimeout(leaderTimer);if(!state.themeEditorOpen)closeContext();setThemeEditorOpen(!state.themeEditorOpen);return;}
  if(event.key==='Escape'){
    state.leader=null;clearTimeout(leaderTimer);
    if(event.target.closest?.('.cm-editor'))return;  // Vim's Escape stays in the scratch editor; Escape in normal mode leaves it.
    if(state.themeEditorOpen||event.target.closest('[data-slot=popover-content],[data-slot=select-content],[data-slot=sheet-content]')||document.querySelector('dialog[open]'))return;
    event.preventDefault();
    if(!$('#thread-panel').hidden&&$('#thread-panel').contains(document.activeElement)){leaveThreadPanel();return;}
    if(state.view==='search'&&!state.leader){if(!search.escape())goBack();return;}
    if(state.fromSearch&&$('#find-bar').hidden){clearFind();return;}
    state.windowKey=false;closeContext();if(split?.active())split.refocus();else focusMain();return;
  }
  if(state.themeEditorOpen||event.target.closest('input,textarea,select,[contenteditable="true"],dialog,[role=dialog],[role=listbox]:not(.queue-list),[data-slot=popover-content],[role=switch],[data-slot=pagination]'))return;
  if(event.metaKey || event.altKey)return;
  // Window keys: Ctrl-w (or Space W) then v s w h j k l x = o q f. A pane forwards them to the shell.
  if(state.windowKey){event.preventDefault();state.windowKey=false;clearTimeout(leaderTimer);if(!['Shift','Control'].includes(event.key))windowCommand(event.key);else state.windowKey=true;reading?.updateStatus();return;}
  if(event.ctrlKey&&!event.shiftKey&&event.key==='w'&&!state.leader){event.preventDefault();startWindowKey();return;}
  if(split?.active()&&!state.leader&&!event.ctrlKey&&![' ',',','?'].includes(event.key)&&$('#queue-panel').hidden&&!chatOpen()&&!document.querySelector('dialog[open]')){event.preventDefault();split.refocus();return;}
  if(state.leader===true&&event.key===','){event.preventDefault();clearTimeout(leaderTimer);state.leader=',';leaderTimer=setTimeout(()=>{state.leader=null;reading?.updateStatus();},1200);reading?.updateStatus();return;}
  if(state.leader===','){event.preventDefault();state.leader=null;clearTimeout(leaderTimer);if(event.key==='t'){closeContext();setThemeEditorOpen(true);}else reading?.updateStatus();return;}
  if(!state.leader&&!event.ctrlKey&&(event.key==='Enter'||event.key==='a')&&!event.target.closest('a,button,summary')&&getSelection()?.isCollapsed===false&&$('#article')?.contains(getSelection().anchorNode)){
    event.preventDefault();captureSelection();if(!$('#selection-tools').hidden)$('#selection-tools button')?.focus({preventScroll:true});return;
  }
  if(state.leader){
    event.preventDefault();state.leader=null;clearTimeout(leaderTimer);
    if(pane&&['?','m','r','n'].includes(event.key)){pane.post({type:'window-key',key:event.key,shell:true});return;}
    const commands={W:startWindowKey,w:()=>navigate(SCRATCH+'='+crypto.randomUUID()),'/':openSearch,e:()=>openPicker(),h:()=>navigate(null),t:openThreadList,m:toggleChat,p:openPreferences,r:()=>queue.toggle(),n:()=>queue.next(),v:openEditions,d:changesShortcut,o:()=>outline.toggle(),s:()=>speech.openMenu(),z:()=>{closeContext();reading.toggleZen();},c:()=>prose.press(),'?':()=>openDialog('help')};commands[event.key]?.();return;
  }
  if(event.key===' '||event.key===','){event.preventDefault();state.leader=true;leaderTimer=setTimeout(()=>{state.leader=null;reading?.updateStatus();},1200);return;}
  if(event.ctrlKey&&['d','u','f','b'].includes(event.key)){event.preventDefault();if(reading.hasBook())reading.turn(['d','f'].includes(event.key)?1:-1);else scrollToPosition(scrollY+innerHeight*(['d','f'].includes(event.key)?1:-1)*(['d','u'].includes(event.key)?.5:.9));return;}
  if(event.ctrlKey)return;
  if(state.view==='search'&&search.key(event))return;
  if(state.view==='issue'&&!state.doc&&['j','k','[',']'].includes(event.key)){event.preventDefault();if(event.key==='j'||event.key==='k')movePiece(event.key==='j'?1:-1);else stepIssue(event.key===']'?1:-1);}
  else if(state.view==='issue'&&event.key==='c'&&Date.now()-lastG<650){event.preventDefault();lastG=0;const cover=$('[data-cover]');if(cover){cover.focus({preventScroll:true});scrollToPosition(0);}}
  else if(reading.hasBook()&&['j','k','h','l'].includes(event.key)){event.preventDefault();reading.turn(['j','l'].includes(event.key)?1:-1);}
  else if(event.key==='j'||event.key==='k'){event.preventDefault();scrollToPosition(scrollY+(event.key==='j'?85:-85));}
  else if(event.key==='g'){event.preventDefault();if(Date.now()-lastG<650){reading.hasBook()?reading.seek(0):scrollToPosition(0);lastG=0;}else lastG=Date.now();}
  else if(event.key===']'||event.key==='['){event.preventDefault();if(lastBracket.key===event.key&&Date.now()-lastBracket.at<650){outline.jump(event.key===']'?1:-1);lastBracket={key:null,at:0};}else lastBracket={key:event.key,at:Date.now()};}
  else if(event.key==='G'){event.preventDefault();reading.hasBook()?reading.seek(1):scrollToPosition(document.documentElement.scrollHeight);}
  else if(event.key==='/'){event.preventDefault();openFind();}
  else if(event.key==='n'||event.key==='N'){event.preventDefault();nextFind(event.key==='n'?1:-1);}
  else if(event.key==='?'){event.preventDefault();if(pane)pane.post({type:'window-key',key:'?',shell:true});else openDialog('help');}
  else if(event.key==='q'){event.preventDefault();const offered=event.target.closest?.('[data-path]');if(offered?.dataset.path?.startsWith('library/'))queue.add(offered.dataset.path);else toast('Press q on a document in a list, or on a Read next item, to queue it.');}
  else if(event.key==='h'&&state.cursor>0){event.preventDefault();goBack();}
  else if(event.key==='l'&&state.cursor<state.visits.length-1){event.preventDefault();state.cursor++;navigate(state.visits[state.cursor],{record:false});history.replaceState({reader:true,path:state.visits[state.cursor]},'',routeHash(state.visits[state.cursor]));}
});
window.addEventListener('popstate',()=>{
  // Back into a split layout restores it; Back out of one leaves the split for the earlier single view.
  if(!EMBEDDED&&location.hash.startsWith('#split=')){if(!split.active()){suspendShell().then(()=>split.restore(location.hash));}return;}
  if(split?.active())split.dismiss();
  // Back, Forward, a typed URL or a #read= link: keep the h / l visit list in step with where the browser went.
  const path=routeFromHash();
  if(state.visits[state.cursor-1]===path)state.cursor--;else if(state.visits[state.cursor+1]===path)state.cursor++;
  else if(state.visits[state.cursor]!==path){state.visits=state.visits.slice(0,state.cursor+1);state.visits.push(path);state.cursor++;}
  navigate(path,{record:false,at:passageFromHash(),fragment:routeHeading()});
});
function startWindowKey(){state.windowKey=true;clearTimeout(leaderTimer);leaderTimer=setTimeout(()=>{state.windowKey=false;reading?.updateStatus();},1500);reading?.updateStatus();}
function windowCommand(key){
  if(key==='f'){linkInSplit().catch(report);return;}
  if(pane){pane.post({type:'window-key',key});return;}
  if(split.active()){split.command(key);return;}
  if(key==='v'||key==='s'){startSplit(key==='v'?'row':'col');return;}
  if(['w','W','h','j','k','l','x','=','o','q'].includes(key))toast('There is one pane. Ctrl-w v or Ctrl-w s splits the window.');
}
function startSplit(dir){split.start(dir,cleanRoute(location.hash),{picker:true}).catch(report);}
/** Open a route in the other pane (Shift-click, Ctrl-w f), splitting the window first when there is one pane. */
function openInSplit(route){if(!route)return;if(pane){pane.post({type:'open-in-split',route});return;}split.openInSplit(route,cleanRoute(location.hash)).catch(report);}
async function linkInSplit(){
  const link=document.activeElement?.closest?.('a[href],[data-path]');
  if(!link){toast('Focus a link (Tab), then Ctrl-w f opens it in the other pane.');return;}
  if(link.dataset.path){openInSplit('#read='+param(link.dataset.path));return;}
  const href=link.getAttribute('href')||'';
  if(/^(https?:|mailto:)/i.test(href)){toast('Ctrl-w f opens library links; this one leaves Reader.');return;}
  if(href.startsWith('#read=')){openInSplit(cleanRoute(href));return;}
  const from=link.closest('.embedded-content')?.dataset.sourcePath||state.doc?.path;if(!from||href.startsWith('#'))return;
  const resolved=await api('/api/resolve?from='+param(from)+'&target='+param(decodeURI(href)));
  openInSplit('#read='+param(resolved.path)+(resolved.fragment?'&h='+param(resolved.fragment):''));
}
// Split view glue ----------------------------------------------------------------------------
const SPLIT=Symbol('split');
/** Empty the single-pane view before a split replaces it: save the place, close panels, drop the document. */
async function suspendShell(){
  ++state.routeId;await reading?.leave();closeContext();clearFind();prose?.detach();await state.pdf?.destroy();state.pdf=null;
  state.smoother?.kill();state.smoother=null;state.doc=null;state.view='split';state.ranges=[];
  for(const name of ['reader-own','reader-other','reader-warning'])CSS.highlights?.delete(name);
  outline?.clear();versions?.reset();versions?.update();clearControlsWithin($('#main'));$('#main').replaceChildren();reading?.prepare();
}
/** The last split closed: the shell becomes that pane's document again. */
async function resumeShell(route){
  history.replaceState({reader:true},'',location.pathname+location.search+(route||''));
  const path=route?routeFromHash():null;state.visits=[path];state.cursor=0;state.view=null;
  await navigate(path,{record:false,fragment:routeHeading()});
}
/** A pane opens a route the shell sent (an open-in-split target, or a document from the shell's panels). */
function openRoute(route){
  history.replaceState(history.state,'',location.pathname+location.search+(route||''));
  const path=route?routeFromHash():null;navigate(path,{fragment:routeHeading()});
}
/** A background pane never takes the keyboard by itself (focus() in a frame would move the window's focus into it). */
function focusMain(){if(!pane||pane.focused())$('#main').focus({preventScroll:true});}
function paneFocus(focused,move){
  if(focused&&move&&!document.querySelector('dialog[open]')&&!$('#main').contains(document.activeElement))$('#main').focus({preventScroll:true});
  reading?.paneFocus(focused);
}
let lastPaneDoc='',lastPaneStatus='';
function paneStatus(){
  const status={type:'status',mode:$('#vim-mode').textContent,position:$('#status-position').textContent,path:state.doc?.path||(state.view==='backstage'?BACKSTAGE:state.view==='search'?SEARCH:null)};
  const now=JSON.stringify(status);if(now!==lastPaneStatus){lastPaneStatus=now;pane.post(status);}
  const doc=state.doc,ref=doc?(doc.historical?doc.path+'@'+doc.commit:doc.path):null;
  const message={type:'doc',hash:location.hash,ref,path:doc?.path||null,title:doc?String(doc.metadata?.title||doc.title||''):'',preview:!!doc?.preview,historical:!!doc?.historical};
  const key=JSON.stringify(message);if(key!==lastPaneDoc){lastPaneDoc=key;pane.post(message);}
}
/** While split, the one status bar shows the focused pane: its mode, breadcrumb, place and number. */
function paintSplitStatus(){
  if(document.querySelector('dialog[open]')||!$('#queue-panel').hidden||chatOpen())return false;
  const focused=split.focused();if(!focused)return false;
  const mode=state.windowKey?'WINDOW':focused.status?.mode||'NORMAL';
  $('#vim-mode').textContent=mode;$('#vim-mode').dataset.mode=mode;
  $('#status-keys').innerHTML=state.windowKey?WINDOW_KEYS:'<kbd>Ctrl-w w</kbd> next pane <kbd>Ctrl-w v</kbd> <kbd>s</kbd> split <kbd>Ctrl-w q</kbd> close';
  breadcrumbs.update(focused.status?.path??null);$('#status-position').textContent=focused.status?.position||'';
  const indicator=$('#split-indicator');indicator.hidden=false;indicator.textContent=`${focused.number}/${focused.count}${focused.bound?' ⇅':''}`;
  indicator.title=`Pane ${focused.number} of ${focused.count}${focused.bound?', scrolling with its neighbor':''}`;
  return true;
}
const WINDOW_KEYS='<kbd>v</kbd> side by side <kbd>s</kbd> stacked <kbd>w</kbd> next <kbd>h j k l</kbd> move <kbd>x</kbd> swap <kbd>=</kbd> equal <kbd>o</kbd> only <kbd>q</kbd> close <kbd>f</kbd> link';
function goBack(){
  if(state.cursor>0){state.cursor--;const path=state.visits[state.cursor];navigate(path,{record:false});history.replaceState({reader:true,path},'',routeHash(path));}
  else navigate(null);
}
function openSearch(){if(state.view==='search')search.focus();else navigate(SEARCH);}
window.addEventListener('resize',()=>{clearTimeout(positionPins.timer);positionPins.timer=setTimeout(()=>{refreshScroll();positionPins();},120);});
document.fonts.ready.then(()=>{refreshScroll();positionPins();});
reduced.addEventListener('change',resetScroll);
search=installSearch({api,state,navigate,back:goBack,backstage:()=>navigate(BACKSTAGE),notify,queue:path=>queue.add(path)});
const breadcrumbs=installBreadcrumbs({container:$('#status-location'),home:()=>navigate(null),openFolder:folder=>openPicker('all',folder),onChange:()=>reading?.updateStatus()});
controls=installControls({seek:fraction=>reading.seek(fraction),spread:index=>reading.seekSpread(index),thread:id=>{const hit=state.ranges.find(entry=>entry.thread.id===id);if(hit)moveToRange(hit.range);openThread(id);},theme:()=>{state.prefs.theme=oppositeTheme(state.prefs.theme);document.documentElement.dataset.theme=state.prefs.theme;savePrefs();reading.updateStatus();},save:applyPreferences,error:report,outlineToggle:()=>outline.toggle(),outlineOpen:open=>outline.setOpen(open),outlineGo:index=>outline.go(index),themeEditor:setThemeEditorOpen,api,themesChanged,useTheme,previewFont,chatMarkdown,openPath:path=>navigate(path),chatChanged:()=>reading?.updateStatus(),
  open:path=>navigate(path),libraryChanged:async()=>{await loadLibrary();if(!state.doc&&state.view!=='backstage')renderHome();},
  markdown:text=>DOMPurify.sanitize(window.markdownit({html:false,linkify:true}).render(text),{USE_PROFILES:{html:true}})},state.prefs);
speech=installSpeech({state,api,reading:{capture:()=>reading.capture(),hasBook:()=>reading.hasBook()},notify,track:trackSpeech,openDialog,closeDialog});
prose=installProseColors({state,api,notify});
queue=installQueue({state,api,navigate,notify,renderPanel:renderQueuePanel,focusMain:()=>focusMain(),onChange:()=>reading?.updateStatus()});
queue.setCloseOthers(()=>{$('#thread-panel').hidden=true;state.activeThread=null;});
reading=installReading({statusOverride:()=>{const on=!!split?.active();if(!on)$('#split-indicator').hidden=true;return on&&paintSplitStatus();},onStatus:()=>pane&&paneStatus(),mayCurl:()=>!pane||pane.focused(),scratchStatus:()=>state.view==='scratch'?scratch?.status():null,controls,updateBreadcrumbs:path=>breadcrumbs.update(path),state,api,toast,openPreferences,openThread,revealRange:moveToRange,scrollToPosition,savePrefs,reloadDocument:()=>navigate(state.doc.path,{record:false}),positionPins});
outline=installOutline({state,reading,$,controls,scrollToPosition,savePrefs,notify});
links=installLinks({state,api,reading,navigate,openBackstage:()=>navigate(BACKSTAGE)});
scratch=installScratch({state,api,notify,navigate,focusMain:()=>$('#main').focus({preventScroll:true}),updateStatus:()=>reading?.updateStatus(),openChat,
  renderMarkdown:(container,text)=>renderMarkdown(container,text,'library/notebook/scratch.md',0)});
versions=installVersions({state,api,navigate:ref=>navigate(ref),openCompare:openComparison,openSideBySide:(older,newer)=>{if(pane)pane.post({type:'open-in-split',compare:{a:older,b:newer}});else split.compare(older,newer,cleanRoute(location.hash)).catch(report);},notify,param,onChange:()=>reading?.updateStatus()});
if(EMBEDDED)pane=installPane({open:openRoute,save:()=>reading.save(),onFocus:paneFocus,
  reveal:element=>{if(!reading.hasBook())return false;const range=document.createRange();range.selectNodeContents(element);return reading.reveal(range,false);},
  scrollBy:delta=>{if(Math.abs(delta)>=1)scrollToPosition(scrollY+delta,false);},seek:fraction=>reading.seek(fraction,false),docFraction:()=>reading.progress()});
else{
  split=installSplit({notify,api,param,paint:()=>reading?.updateStatus(),suspend:suspendShell,resume:resumeShell});
  split.setShellCommands({'?':()=>openDialog('help'),m:toggleChat,r:()=>queue.toggle(),n:()=>queue.next()});
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('close',()=>{if(split.active()&&!document.querySelector('dialog[open]'))split.refocus();}));
}
// Theme and preference changes made in another pane (or the shell) arrive as a storage event.
function prefsFromStorage(){
  let fresh;try{fresh=JSON.parse(localStorage.getItem('reader.preferences.v1')||'{}');}catch{return;}
  if(!fresh||typeof fresh!=='object')return;
  const relayout=typeof fresh.layout==='string'&&fresh.layout!==state.prefs.layout;
  state.prefs={...state.prefs,...fresh,participant:state.prefs.participant};
  // A layout change (continuous or two-page) reopens the document in its new layout, at the same place.
  if(relayout&&state.doc&&!state.doc.preview){const doc=state.doc;reading.save().then(()=>{if(state.doc===doc)navigate(doc.historical?doc.path+'@'+doc.commit:doc.path,{record:false});});}
  if(knownTheme(state.prefs.theme)&&document.documentElement.dataset.theme!==state.prefs.theme){document.documentElement.dataset.theme=state.prefs.theme;controls.update({theme:state.prefs.theme,prefs:{...state.prefs}});}
  reading?.updateStatus();
}
window.addEventListener('storage',event=>{if(event.key==='reader.preferences.v1')prefsFromStorage();else if(event.key==='reader.themes.v1')loadThemes();});
window.addEventListener('reader:prefs',prefsFromStorage);
mountSkeleton($('#main'),'library');
loadThemes();
try{await loadLibrary();
  if(!EMBEDDED&&location.hash.startsWith('#split=')){state.view='split';reading.prepare();await suspendShell();if(split.restore(location.hash))throw SPLIT;history.replaceState(null,'',location.pathname+location.search);}
  if(EMBEDDED&&new URLSearchParams(location.search).has('picker')){const url=new URL(location.href);url.searchParams.delete('picker');history.replaceState(null,'',url);state.pickerAfterBoot=true;}
  const path=routeFromHash();if(path){state.visits=[path];const heading=routeHeading();if(location.hash.startsWith('#read='))history.replaceState(history.state,'',location.pathname+location.search+routeHash(path,passageFromHash(),heading));await navigate(path,{record:false,at:passageFromHash(),fragment:heading});}else {state.view='issue';reading.prepare();await renderHome();}
  if(state.pickerAfterBoot){state.pickerAfterBoot=false;openPicker();}}
catch(error){if(error!==SPLIT){clearControlsWithin($('#main'));$('#main').innerHTML='<div class="loading-state"><span class="brand-mark">r.</span><h2>The stacks couldn’t open.</h2><p id="load-error"></p></div>';$('#load-error').textContent=error.message;}}
