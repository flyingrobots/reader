import {bodyOf, codePointIndex, escapeHTML as esc, findFragment, formatDate, localizeLibrary, normalize, scopeOf, slugHeadings, occurrences, plainQuote, plural, projectSource, projectText, rawCodePoints, sourceRangeForQuote, visibleQuote} from './logic.mjs';
import {installReading} from './reading.mjs';
import {installLinks} from './links.mjs';
import {mathPlugin,mathOptions} from './math.mjs';
import {openPDF,pdfPage} from './pdf.mjs';
import {embedPlugin,installEmbeds} from './embeds.mjs';
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
import {drawable,fetchShape,paintShape} from './shapes.mjs';
import {artJobs,fetchArt,focusArt,forgetArt,hasArt,paintArt,paintArtThumb,paintPlaceholder} from './art.mjs';
import {closeArtFocus,focusOpen} from './art-focus.mjs';
import {applyThemes,installControls,mountSkeleton,mountCodeBlocks,decorateCodeBlocks,clearControlsWithin,mountDocumentTree,visibleDocumentNodes,revealDocumentRow,mountBackstage,mountChangesPanel,mountArtRegenerate,notify as shellNotify,openChat,closeChat,chatOpen,trackSpeech,renderQueuePanel,mountCallouts,startJob,promptCompanion,needsReader,NEEDS_READER} from './controls/reader-controls.js';
import {installVersions,chipMarkup,historicalMarkup,splitRef,compareLabel} from './versions.mjs';
import {installSplit,installPane,cleanRoute} from './split.mjs';
import {installScratch} from './scratch.mjs';
import {createKeys,closest as keysClosest} from './keys.mjs';
import {installVisual} from './visual.mjs';
import {installPlace} from './place.mjs';
import {installLists} from './lists.mjs';
import {installStatusPriority} from './status-priority.mjs';
import {installDock,pageWidth} from './dock.mjs';

const $ = selector => document.querySelector(selector);
// Split view: a pane is this app in an embedded same-origin iframe (/?pane=1#…); the top document is the shell.
const EMBEDDED=new URLSearchParams(location.search).has('pane')&&window.parent!==window;
if(EMBEDDED)document.documentElement.classList.add('embedded-pane');
let split=null,pane=null;
/** Toasts from a pane appear in the shell's toaster. */
function notify(message,type,options){if(pane){pane.post({type:'toast',message:String(message),kind:type,options:options&&{id:options.id,duration:options.duration}});return;}return shellNotify(message,type,options);}
const defaults = {theme:'ink', participant:null, recent:20, atlas:true, activity:true, smooth:true, layout:'scroll', pace:220, zen:false, pageTurn:'curl', nextReads:true, backlinks:true, outline:true, inboxSandbox:'workspace-write', issueExclude:DEFAULT_EXCLUDED_TYPES.join(', '), proseColors:'clear', shapes:true, art:true, artHero:true, artBy:'', artAuto:'off'};
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
let reading,controls,links,outline,speech,versions,search,prose,queue,scratch,keys,visual,registers,quickfix,marks,jumps,panels;
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
const md = window.markdownit({html:true, linkify:true, breaks:false}).use(mathPlugin).use(calloutPlugin).use(embedPlugin);
for (const type of ['paragraph_open','heading_open','blockquote_open','bullet_list_open','ordered_list_open','math_block','fence']) {
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
const embeds=installEmbeds({api,param,render:renderMarkdown,wire:(root,path)=>wireArticleLinks(root,path),pdfPage,navigate,changed:embedsArrived});
/** Embeds that loaded after the document: lay out again, draw their figures, color them and show their margins. */
function embedsArrived(contents){
  if(!contents.length)return;
  refreshScroll();positionPins();prose?.rescan();
  for(const content of contents){drawDiagrams(content).catch(error=>console.warn('Embedded diagrams',error));}
  if(state.doc&&['.md','.markdown'].includes(state.doc.kind)&&!state.doc.historical)loadEmbedDiscussions().then(paintAnnotations).catch(error=>console.warn('Embedded margins',error));
}
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
/** Scroll continuous reading to `top`. A `target` (the element or range the jump is for, or the point `fraction`
 *  of the way down it) stays where it lands while the blocks around it settle their heights. */
function scrollToPosition(top, smooth=true, target=null, fraction=0) {
  const bounded = Math.max(0, Math.min(top, document.documentElement.scrollHeight - innerHeight));
  if (state.smoother) state.smoother.scrollTo(bounded, smooth && motion());
  else window.scrollTo({top:bounded, behavior:smooth && motion() ? 'smooth' : 'instant'});
  if (target) placeKeeper.hold(target, bounded, smooth && motion(), fraction); else placeKeeper.release();
}
let placePips=0;
const placeKeeper = installPlace({content:()=>$('#smooth-content'), smoother:()=>state.smoother,
  scroll:(top,smooth)=>{const bounded=Math.max(0,Math.min(top,document.documentElement.scrollHeight-innerHeight));
    // A correction replaces the smoother's glide toward the old line rather than racing it.
    if(state.smoother){gsap.killTweensOf(state.smoother);state.smoother.scrollTo(bounded,smooth);}else window.scrollTo({top:bounded,behavior:smooth?'smooth':'instant'});},
  onChange:()=>{positionPins();clearTimeout(placePips);placePips=setTimeout(()=>reading?.pips(),250);}});
function moveToRange(range) {
  lateMoved?.(range);
  // A folded callout opens when find or a thread jumps into its body.
  for(let fold=range.startContainer.parentElement?.closest('details.callout-fold:not([open])');fold;fold=fold.parentElement?.closest('details.callout-fold:not([open])'))fold.open=true;
  if(reading?.reveal(range))return;
  const rect = range.getBoundingClientRect();
  scrollToPosition(window.scrollY + rect.top - innerHeight * .36, true, range);
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
  const artwork=await issueArt(issue);if(id!==state.routeId)return;
  clearControlsWithin($('#main'));
  state.magazine=mountMagazine({root:$('#main'),issue,weeks:issueWeeks(works,{exclude:options.exclude,through:isoWeek(state.data.today).end}),signals,prefs:state.prefs,api,wireDocumentLinks,openIssue,motion:()=>!reduced.matches,art:artwork,artMake:state.prefs.art!==false&&!!artProducer()});
  $('#main').querySelectorAll('.issue [data-art-generate]').forEach(button=>{if(needsReader('art')){localOnly(button);return;}
    button.onclick=event=>{event.preventDefault();button.disabled=true;button.textContent='Making art…';commissionArt(button.dataset.artGenerate);};});
  $('#issue-backstage').onclick=()=>navigate(BACKSTAGE);
  $('#main').querySelectorAll('.issue [data-queue-add]').forEach(button=>{if(needsReader()){localOnly(button);return;}button.onclick=event=>{event.preventDefault();queue.add(button.dataset.queueAdd);};});
  resetScroll();reading?.updateStatus();
  paintIssueArt(artwork,id).catch(error=>console.warn('Article art',error));
  autoCommission(issue,artwork);
}
// Bespoke article art (RW-43): fetched for the cover and features before the issue mounts, so their
// figures are part of the first layout (each request waits at most ART_WAIT ms); painted after mount.
const ART_WAIT=1500;
const art=artJobs({api,notify});
state.artCommissioned=new Set();
/** The producer Settings chose (Art made by), else the server's default: the first available voice. */
function artProducer(){const status=art.status();if(!status)return null;const rows=status.producers||[];return rows.find(r=>r.id===state.prefs.artBy&&r.available)||rows.find(r=>r.id===status.default)||null;}
async function issueArt(issue){
  if(state.prefs.art===false)return {};
  if(!art.status())await art.poll().catch(()=>{});
  const works=[issue.cover,...issue.features].filter(Boolean).map(entry=>entry.work).filter(work=>TEXTUAL.test(work.primary)),found={};
  await Promise.all(works.map(async work=>{try{const data=await Promise.race([fetchArt(api,work.primary),new Promise(resolve=>setTimeout(()=>resolve(null),ART_WAIT))]);if(hasArt(data))found[work.primary]=data;}catch{/* No art for this piece. */}}));
  return found;
}
const artActions={generate:path=>commissionArt(path),version:(path,v)=>showArtVersion(path,v),favorite:(path,a)=>favoriteArt(path,a),focus:(figure,data)=>openArtFocus(figure,data)};
/** The art focus view (#147): the figure's version full screen, with Regenerate this; closing repaints the figure (the focus view held the page's one live canvas). */
async function openArtFocus(figure,data){
  if(!data?.art)return;
  if(!art.status())await art.poll().catch(()=>{});
  const title=state.data?.works.find(w=>w.primary===data.path)?.title||(state.doc?.path===data.path?$('#article .document-title')?.textContent.trim():null)||data.path.split('/').pop();
  await focusArt(data,{api,motion:!reduced.matches,
    restore:()=>{if(!figure.isConnected)return;return figure.classList.contains('article-art')?paintArticleArt(figure,data):paintArt(figure,data,{live:true,motion:!reduced.matches,api,actions:artActions});},
    regenerate:{title,max:2000,mount:mountArtRegenerate,disabled:needsReader('art')?NEEDS_READER:null,
      producers:()=>(art.status()?.producers||[]).filter(p=>p.available&&!p.static_demo),producer:()=>artProducer()?.id||null,
      submit:async(direction,producer)=>{const job=await art.generate(data.path,producer,direction);forgetArt(data.path);notify('Making a new version of the art','info',{description:'With your direction. The version you were looking at is kept.'});return job;}}});
}
/** Space G and :art-focus: the open article's art, else the cover's. */
function focusShownArt(){
  if(focusOpen()){closeArtFocus();return;}
  const figure=$('#article .article-art[data-generation]')||$('#main .cover-art[data-generation]');
  if(!figure?.artData){toast(state.doc?'This article has no art on screen; Space g shows it or offers to make it.':'Open an article with art to focus on it.');return;}
  openArtFocus(figure,figure.artData).catch(report);
}
async function paintIssueArt(found,id){
  // Thumbnails first (still images from the shared renderer), then the cover's live canvas.
  for(const slot of $('#main').querySelectorAll('[data-art-thumb]')){if(id!==state.routeId)return;await paintArtThumb(slot,found[slot.dataset.artThumb],api);}
  const figure=$('#main .cover-art');if(!figure||id!==state.routeId)return;
  await paintArt(figure,found[figure.dataset.art],{live:true,motion:!reduced.matches,api,actions:artActions});
}
/** Make art automatically (Settings): the cover, or the cover and features, once per issue and session. */
function autoCommission(issue,found){
  const mode=state.prefs.artAuto;if(state.prefs.art===false||!['cover','issue'].includes(mode))return;
  const producer=artProducer();if(!producer)return;
  const works=(mode==='cover'?[issue.cover]:[issue.cover,...issue.features]).filter(Boolean).map(entry=>entry.work.primary).filter(path=>TEXTUAL.test(path)&&!found[path]&&!state.artCommissioned.has(path));
  if(!works.length)return;works.forEach(path=>state.artCommissioned.add(path));
  art.commission(works.slice(0,6),producer.id).catch(error=>console.warn('Article art',error));
}
/** No producer for art: Behind the scenes, at Companions' Agents and models card (or the section). */
async function openArtSetup(){
  await navigate(BACKSTAGE);
  for(let tries=0;tries<40;tries++){const target=$('#companion-cli')||$('#companions');if(target){target.scrollIntoView({block:'start'});return;}await new Promise(resolve=>setTimeout(resolve,75));}
}
/** The static web demo (#107): a control that needs a running Reader, disabled with the reason as its tooltip. */
function localOnly(button){button.disabled=true;button.title=NEEDS_READER;button.dataset.needsReader='';button.onclick=null;}
async function commissionArt(path){
  const producer=artProducer();
  if(needsReader('art')){notify('Making art needs Reader on your computer.','info',{description:'This web demo has no server. Run Reader locally: reader demo has a scripted voice that answers art commissions.'});return;}
  if(!producer){notify('No voice or local model can make art yet.','info',{description:'Add a voice to voices.json or set up a local model; Behind the scenes, Companions, shows which agent command lines Reader found.'});return;}
  try{const job=await art.generate(path,producer.id);forgetArt(path);showArtJob(path,job);}catch(error){report(error);}
}
function showArtJob(path,job){
  const figure=$('#article .article-art');
  if(figure&&state.doc?.path===path&&(job&&['queued','waiting','running'].includes(job.state)))paintPlaceholder(figure,{path,job,producer:artProducer(),local:needsReader('art')&&NEEDS_READER,generate:commissionArt,cancel:id=>art.cancel(id).catch(report),setup:openArtSetup});
}
async function showArtVersion(path,version){
  try{const data=await fetchArt(api,path,{edition:version.edition,generation:version.generation});const figure=[...document.querySelectorAll('.cover-art,.article-art')].find(f=>f.dataset.art===path);
    if(figure&&hasArt(data))await(figure.classList.contains('article-art')?paintArticleArt(figure,data):paintArt(figure,data,{live:true,motion:!reduced.matches,api,actions:artActions}));}
  catch(error){report(error);}
}
async function favoriteArt(path,chosen){
  try{await api('/api/art',{action:'favorite',path,edition:chosen.edition,generation:chosen.generation});forgetArt(path);notify('This version is the one shown from now on.','success');repaintArt();}catch(error){report(error);}
}
/** Show art (Space g): the open article's art above its kicker (or a calm placeholder offering to make it), for this session's articles until toggled off. */
async function toggleArt(){
  if(state.prefs.art===false){toast('Article art is off. Turn it on in Settings (Space p).');return;}
  const doc=state.doc;
  if(!doc||doc.preview||doc.historical||!TEXTUAL.test(doc.path)){toast('Open a Markdown or text article to see its art.');return;}
  const shown=$('#article .article-art');
  if(shown){state.showArt=false;keepPlace(()=>removeArticleArt(shown));return;}
  state.showArt=true;
  const data=await articleArt(doc,state.routeId,true);if(!data)return;
  const hero=heroWanted()&&hasArt(data);let figure;
  keepPlace(()=>{figure=placeArticleArt(doc.path,hero);});
  if(hero&&reading?.hasBook())reading.seekSpread(0,false);else figure.scrollIntoView({block:'nearest'});
  await paintArticleArt(figure,data);
}
/** Change the article above the reader's place, keeping the first visible block in view in two-page reading. */
function keepPlace(change){
  const mark=reading?.hasBook()?reading.capture():null;change();refreshScroll();positionPins();
  const block=mark?.source_offset!=null&&$(`#article [data-source-start="${mark.source_offset}"]`);
  if(block){const range=document.createRange();range.selectNode(block);reading.reveal(range,false);}
}
function removeArticleArt(figure){
  figure.artView?.destroy();figure.remove();$('#article').querySelectorAll('.art-hero-spacer').forEach(el=>el.remove());$('#main .document-shell')?.classList.remove('has-hero');
}
/** Open articles with their art (Settings, on by default; #145). */
function heroWanted(){return state.prefs.art!==false&&state.prefs.artHero!==false;}
/** The open article's art for its hero: only /api/art (already asked for with the document), waiting at most ART_WAIT ms. */
async function heroArt(doc,id){
  let data;
  try{data=await Promise.race([fetchArt(api,doc.path),new Promise(resolve=>setTimeout(()=>resolve(null),ART_WAIT))]);}catch{return null;}
  return id===state.routeId&&state.doc===doc?data:null;
}
async function articleArt(doc,id,explicit){
  let data;
  if(!art.status())await art.poll().catch(()=>{});
  try{data=await Promise.race([fetchArt(api,doc.path),new Promise(resolve=>setTimeout(()=>resolve(undefined),ART_WAIT))]);}catch(error){if(explicit)report(error);return null;}
  if(id!==state.routeId||state.doc!==doc)return null;
  if(data===undefined){if(explicit)toast('The art is taking a while to load; try again in a moment.');return null;}
  return data;
}
function placeArticleArt(path,hero=false){
  const figure=document.createElement('figure');figure.className='article-art'+(hero?' art-hero':'');figure.dataset.readerDecoration='';figure.dataset.art=path;
  // In two-page reading the hero covers the first spread; one empty page per column keeps the text off it (CSS shows
  // them only there), so spread math, bookmarks and the page turn see an ordinary first spread.
  if(hero){const spacers=[0,1].map(()=>{const el=document.createElement('div');el.className='art-hero-spacer';el.dataset.readerDecoration='';el.setAttribute('aria-hidden','true');return el;});$('#article').prepend(...spacers);$('#main .document-shell')?.classList.add('has-hero');}
  $('#article').prepend(figure);return figure;
}
/** The hero's opener: the title, kicker and byline over the first spread (two-page reading), and the way into the text. */
function heroOptions(figure){
  const book=!!reading?.hasBook(),text=selector=>$('#article '+selector)?.textContent.trim()||'';
  return {book,kicker:text('.document-kicker'),title:text('.document-title'),byline:text('.document-meta .by'),
    standfirst:book?api('/api/standfirst?path='+param(figure.dataset.art)).then(d=>['frontmatter','local-model'].includes(d.source)?d.standfirst:null).catch(()=>null):null,
    go(){if(book){reading.seekSpread(1);$('#main').focus({preventScroll:true});return;}const kicker=$('#article .document-kicker')||$('#article .document-title');if(kicker)scrollToPosition(scrollY+kicker.getBoundingClientRect().top-32);}};
}
function paintArticleArt(figure,data){
  figure.classList.add('article-art');
  const hero=figure.classList.contains('art-hero');
  if(hasArt(data))return paintArt(figure,data,{live:hero||!reading?.hasBook(),motion:!reduced.matches,api,actions:artActions,hero:hero?heroOptions(figure):null}).then(f=>{f.classList.add('article-art');return f;});
  paintPlaceholder(figure,{path:data.path,job:data.job,producer:artProducer(),local:needsReader('art')&&NEEDS_READER,generate:commissionArt,cancel:id=>art.cancel(id).catch(report),setup:openArtSetup});figure.classList.add('article-art');return Promise.resolve(figure);
}
document.addEventListener('reader:art-ready',event=>{const job=event.detail;forgetArt(job.path);repaintArt(job.path);});
document.addEventListener('reader:art-jobs',event=>{
  const figure=$('#article .article-art[data-state=working],#article .article-art[data-state=placeholder]');if(!figure||!state.doc)return;
  const job=event.detail.jobs.find(j=>j.path===figure.dataset.art&&['queued','waiting','running'].includes(j.state));if(job)showArtJob(figure.dataset.art,job);
});
/** Draw art again after a theme change, a new version or a favorite: the issue's art, and the open article's. */
function repaintArt(path=null){
  if(state.view==='issue'&&!state.doc&&state.issue&&(!path||$('#main [data-art="'+CSS.escape(path)+'"],#main [data-art-thumb="'+CSS.escape(path)+'"]')||[state.issue.cover,...state.issue.features].some(e=>e?.work.primary===path)))
    issueArt(state.issue).then(found=>{if(path&&found[path]&&!$('#main .cover-art,#main [data-art-thumb]'))renderHome(state.issuePath,state.routeId);else paintIssueArt(found,state.routeId);}).catch(()=>{});
  const figure=$('#article .article-art');
  if(figure&&state.doc&&(!path||state.doc.path===path))fetchArt(api,state.doc.path,{fresh:true}).then(data=>{if(figure.isConnected)paintArticleArt(figure,data);}).catch(()=>{});
}
// The RW-20 data view waits at most SHAPE_WAIT ms for /api/shape.
const SHAPE_WAIT=1500;
const shapeTitle=path=>state.data?.works.find(w=>w.primary===path)?.title||path.split('/').pop();
/** The data view (RW-20, `:shape`): the article's passages projected through meaning-space, above its kicker,
    for this session's articles until toggled off. It is a view of the text, not the article's art. */
async function toggleShape(){
  const doc=state.doc;
  if(!doc||doc.preview||doc.historical||!TEXTUAL.test(doc.path)){toast('Open a Markdown or text article to see its shape.');return;}
  const shown=$('#article .article-shape');
  if(shown){state.showShape=false;shown.remove();refreshScroll();positionPins();return;}
  state.showShape=true;
  const shape=await articleShape(doc,state.routeId,true);if(!shape)return;
  const figure=placeArticleShape(shape);refreshScroll();positionPins();
  figure.scrollIntoView({block:'nearest'});await paintArticleShape(figure,shape);
}
async function articleShape(doc,id,explicit){
  let shape;
  try{shape=await Promise.race([fetchShape(api,doc.path),new Promise(resolve=>setTimeout(()=>resolve(undefined),SHAPE_WAIT))]);}catch(error){if(explicit)report(error);return null;}
  if(id!==state.routeId||state.doc!==doc)return null;
  if(shape===undefined){if(explicit)toast('The shape is taking a while; try again in a moment.');return null;}
  if(!drawable(shape)){if(explicit)toast('This piece is too short to have a shape.');return null;}
  return shape;
}
function placeArticleShape(shape){
  const figure=document.createElement('figure');figure.className='article-shape';figure.dataset.readerDecoration='';figure.dataset.shape=shape.path;
  $('#article').prepend(figure);return figure;
}
function paintArticleShape(figure,shape){
  const path=shape.path;
  return paintShape(figure,shape,{title:shapeTitle(path),live:!reading?.hasBook(),motion:!reduced.matches,
    onPassage:i=>{if(state.doc?.path===path)revealPassage({line:shape.lines[i],page:null,terms:[],query:''});},onNeighbour:target=>navigate(target)});
}
// A theme change repaints the art in the new tokens.
new MutationObserver(()=>{clearTimeout(repaintShapes.timer);repaintShapes.timer=setTimeout(()=>{repaintShapes();repaintArt();},60);}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
function repaintShapes(){
  const figure=$('#article .article-shape');
  if(figure&&state.doc)fetchShape(api,state.doc.path).then(shape=>{if(figure.isConnected)paintArticleShape(figure,shape);}).catch(()=>{});
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
  if(visual?.active())visual.exit();panels?.close(false);keys?.closeLine(false);
  closeChat();links?.hide();hideChartTooltip();$('#passage-tooltip').classList.remove('visible');$('#selection-tools').hidden=true;$('#thread-panel').hidden=true;$('#find-bar').hidden=true;versions?.close();
  for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
  queue?.close(false);state.smoother?.paused(false);
}
async function navigate(path,{thread=null,fragment='',record=true,commit=null,at=null,jump=true}={}) {
  if(commit&&path)path=path+'@'+commit;
  // While the window is split, the shell's panels (queue, picker, chat links) open documents in the focused pane.
  if(split?.active()){split.openInFocused(path===SEARCH?'#search':cleanRoute(routeHash(path,null,fragment))||'#home');return;}
  // Leaving a document by a link, the picker or the queue is a jump: Ctrl-o comes back to this place.
  if(record&&jump&&state.doc)jumps?.record();
  const id=++state.routeId;await reading?.leave();if(state.view==='scratch'&&!path?.startsWith(SCRATCH))await scratch.leave();if(id!==state.routeId)return;closeContext();
  // The scratch pad's "responds to" defaults to the current document you came from.
  if(state.doc&&!state.doc.preview&&!state.doc.historical)state.lastDocPath=state.doc.path;
  if(state.view==='search'&&path!==SEARCH)search.leave();
  if(record){state.visits=state.visits.slice(0,state.cursor+1);state.visits.push(path);state.cursor++;
    // A pane's pushed entry would join the window's session history, so browser Back would step a background pane.
    if(EMBEDDED)history.replaceState({reader:true,path},'',routeHash(path,at,fragment));else history.pushState({reader:true,path},'',routeHash(path,at,fragment));}
  clearFind();prose?.detach();await state.pdf?.destroy();state.pdf=null;state.ranges=[];placeKeeper.watch(null);CSS.highlights?.delete('reader-own');CSS.highlights?.delete('reader-other');CSS.highlights?.delete('reader-warning');
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
    // What changed since your receipt arrives with the document, so its banner is part of the first layout.
    // `path@commit` opens a historical version read-only: no receipt, bookmark, annotations or Read next.
    const ref=path;const {path:file,commit:atCommit}=splitRef(ref);path=file;
    // Versions (family, history, read markers) never hold back the text: a cold git history lookup can
    // take longer than rendering the whole document. A timeline that is already here joins the first
    // layout; otherwise the chip and status twin fill in after the reading position is restored (placeLateChip).
    // Inbox arrivals are unfiled previews: they have no versions or read receipt to compare.
    const preview=path.startsWith('inbox/');
    // An article with art opens on it (#145): its art is asked for alongside the document, so the hero costs no extra wait.
    if(heroWanted()&&!atCommit&&!preview&&TEXTUAL.test(path))fetchArt(api,path).catch(()=>{});
    let editions=LATE;
    const pending=preview?Promise.resolve(null):secondary('Versions',()=>api('/api/versions?path='+param(path)+'&participant='+param(state.prefs.participant))).then(found=>editions=found??null);
    const [doc,changes]=await Promise.all([atCommit?api('/api/version?path='+param(path)+'&commit='+param(atCommit)):api('/api/document?path='+param(path)+'&participant='+param(state.prefs.participant)),
      !atCommit&&!preview&&TEXTUAL.test(path)?api('/api/changes?path='+param(path)+'&participant='+param(state.prefs.participant)).catch(()=>null):null]); if(id!==state.routeId)return;
    const inLayout=editions!==LATE;state.editions=state.versions=inLayout?editions:null;state.changes=changes;const historical=!!doc.historical;
    state.doc=doc;state.threads=[];state.attention=[];state.hostAttention=[];state.embedThreads=new Map();
    const author=Array.isArray(doc.metadata.author)?doc.metadata.author.join(' · '):doc.metadata.author;
    const known=doc.preview?null:state.data.works.find(w=>w.primary===path);
    const title=doc.metadata.title || known?.title || doc.title;
    clearControlsWithin($('#main'));
    const chip=doc.preview?'':chipMarkup(state.versions,doc,param);
    $('#main').innerHTML=`<div class="document-shell resume-pending${historical?' historical':''}"><div class="eyebrow document-kicker">${esc(doc.preview?'Inbox preview · not yet filed':known?.projects?.[0] || 'From the library')}</div><h1 class="document-title">${esc(title)}</h1><div class="document-meta">${author?`<span class="by">${esc(author)}</span>`:''}${doc.metadata.created||doc.metadata.added?`<span>${formatDate(doc.metadata.created||doc.metadata.added)}</span>`:''}${doc.metadata.document_revision&&!chip?`<span class="document-edition">Edition ${esc(doc.metadata.document_revision)}</span>`:''}</div>${historical?historicalMarkup(doc,param):chip}${changeMarkup(changes)}<div class="reading-log" data-reader-decoration aria-live="polite"></div><article id="article" class="article"></article><footer class="document-footer">${esc(path)}${historical?` @ ${esc(doc.short)}<br>Historical text from the vault’s git history · <a href="${esc('#read='+param(path))}" data-path="${esc(path)}">Open the current file</a>`:`<br>Original source preserved · <a href="${esc(doc.file_url)}" target="_blank" rel="noopener noreferrer">Open original</a>${doc.text!==null||doc.kind==='.pdf'?'<br><button type="button" id="speak-article" data-button="outline sm" class="speak-article" title="Send to AI-TTS · Space s">Send to AI-TTS</button>':''}${/^library\/notebook\/[^/]+\.md$/.test(path)&&doc.text!==null?' <button type="button" id="edit-scratch" data-button="outline sm" title="Open this piece in the scratch pad; saving writes a new version">Edit in scratch</button>':''}`}</footer></div>`;
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
    // Show shape is on for this session: reserve the figure before the reading position is restored.
    const shape=state.showShape&&!historical&&!doc.preview&&TEXTUAL.test(path)?await articleShape(doc,id,false):null;
    if(id!==state.routeId)return;
    const shapeFigure=shape?placeArticleShape(shape):null;
    // An article with art opens on it as a hero (#145), unless Space g hid art for this session; with Show art on, an
    // article without art shows its placeholder. Either goes above everything, reserved before the position is restored.
    const artOk=state.prefs.art!==false&&!historical&&!doc.preview&&TEXTUAL.test(path)&&state.showArt!==false;
    let artData=null;
    if(artOk&&heroWanted()){const found=await heroArt(doc,id);if(hasArt(found))artData=found;}
    if(artOk&&!artData&&state.showArt)artData=await articleArt(doc,id,false);
    if(id!==state.routeId)return;
    const artFigure=artData?placeArticleArt(path,heroWanted()&&hasArt(artData)):null;
    mountEditions();wireChanges();
    reading?.prepare();resetScroll();placeKeeper.watch(reading?.hasBook()||state.pdf?null:article);wireArticleLinks(article,path);await reading?.restore(doc);
    rendered=true; // From here on, failures are secondary: keep the article and toast quietly instead.
    if(!inLayout)pending.then(late=>placeLateChip(late,doc,id));
    if(shapeFigure)paintArticleShape(shapeFigure,shape).catch(error=>console.warn('Article shape',error));
    if(artFigure)paintArticleArt(artFigure,artData).catch(error=>console.warn('Article art',error));
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
/** A version timeline that arrived after first render: fill the status twin, then put the chip line where the
 *  first layout would have (after the reading log), keeping the reader on the same block as drawLate() does. */
function placeLateChip(late,doc,id){
  if(id!==state.routeId||state.doc!==doc||!late)return;
  state.editions=state.versions=late;versions.update();
  const markup=doc.preview||doc.historical?'':chipMarkup(late,doc,param);if(!markup)return;
  const template=document.createElement('template');template.innerHTML=markup;const line=template.content.firstElementChild;
  versions.wire(template.content);wireDocumentLinks(line);
  for(const button of line.querySelectorAll('[data-compare]'))button.addEventListener('click',()=>openChanges(button.dataset.compare,button.dataset.against));
  const anchor=$('#article > .reading-log')||$('#main .document-meta');if(!anchor)return;
  const place=readingPlace();
  anchor.after(line);$('#main .document-meta .document-edition')?.remove();refreshScroll();
  if(!place?.block.isConnected)return;
  if(reading?.geometry()){const range=document.createRange();range.selectNodeContents(place.block);reading.reveal(range,false);}
  else{const shift=place.block.getBoundingClientRect().top-place.top;if(Math.abs(shift)>1)scrollTo(0,scrollY+shift);}
}
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
/** Render Markdown into a container. An embedded fragment passes `range` (UTF-16 [start, end) of `raw`, the
 *  embedded file), so its blocks carry that file's source offsets; `chain` and `children` come from embeds.mjs. */
async function renderMarkdown(container,raw,path,depth,{defer=false,range=null,chain=[],children=null}={}) {
  const source=range?{text:raw.slice(range[0],range[1]),offset:range[0]}:bodyOf(raw);
  if(depth===0)embeds.reset();
  // `![[…]]` and `[[…]]` are markdown-it inline rules (embeds.mjs): code keeps them literally, and an
  // embed's placeholder never grants a source coordinate to the embedded document's blocks.
  const rendered=md.render(source.text,{raw:source.text,full:raw,offset:source.offset,embeds:true,...mathOptions(raw)});
  const clean=DOMPurify.sanitize(rendered,{USE_PROFILES:{html:true},FORBID_TAGS:['style','form','input','button','textarea','select','iframe'],FORBID_ATTR:['style','srcset']});
  const template=document.createElement('template');template.innerHTML=clean;
  const images=[];
  for(const image of template.content.querySelectorAll('img')){
    const src=image.getAttribute('src') || '';
    if(/^(?:https?:|data:|\/\/)/i.test(src)){image.removeAttribute('src');image.alt=(image.alt || 'External image')+' (not loaded)';continue;}
    images.push(image);
  }
  // Markdown percent-encodes a destination (`my%20pic.png`); an embed's image target is written as is.
  const located=await resolveMany(path,images.map(image=>image.hasAttribute('data-embed-image')?image.getAttribute('src'):decode(image.getAttribute('src') || '')));
  images.forEach((image,index)=>{const resolved=located[index];if(resolved?.path)image.src='/api/file?path='+param(resolved.path);else{image.removeAttribute('src');image.alt=(image.alt || 'Image')+' (unavailable)';}});
  clearControlsWithin(container);container.replaceChildren(template.content);slugHeadings(container);
  prepareDiagrams(container);
  // Embeds: one /api/embeds request resolves the first few and their nested embeds; the rest load as you read.
  await embeds.mount(container,path,{depth,chain,children});
  container.querySelectorAll('img').forEach(image=>image.addEventListener('load',imageLoaded));
  mountCodeBlocks(container);mountCallouts(container,()=>{refreshScroll();positionPins();});
  // A deferred render leaves diagrams and math to drawLate() after first paint; drawing many waits on the
  // renderer, and KaTeX typesets in idle slices. So do embeds mounted before the document is shown.
  if(defer||container.closest('.resume-pending'))return;
  await drawDiagrams(container);
  await drawMath(container);
}
/** Typeset a shown document's math, then draw its diagrams (its own and its embeds'), after first paint,
 *  keeping the reader's place: formulas near it go first, and the first block in view stays put while
 *  heights change, unless the reader moves. */
async function drawLate(article,id){
  const math=!!article.querySelector('.reader-math[data-tex]:not([data-state])'),diagrams=!!article.querySelector('.reader-diagram-canvas[data-state=loading]');
  if(!math&&!diagrams)return;
  let place=readingPlace(),moved=false;const stop=()=>{moved=true;};
  const keep=()=>{
    if(id!==state.routeId||moved||!place?.block.isConnected)return;
    if(reading?.geometry()){reading.reflow();let range=place.range;if(!range){range=document.createRange();range.selectNodeContents(place.block);}reading.reveal(range,false);}
    // A jump Reader made (a bookmark, a heading) is held by placeKeeper, as is the first block in view with smooth
    // scrolling, which has no scroll anchoring.
    else if(!state.smoother&&!placeKeeper.holding()){const shift=place.block.getBoundingClientRect().top-place.top;if(Math.abs(shift)>1)scrollTo(0,scrollY+shift);}
  };
  const events=['wheel','keydown','pointerdown','touchstart'];events.forEach(type=>addEventListener(type,stop,{capture:true,passive:true}));
  // A jump Reader makes becomes the place to keep in two-page mode (columns have no scroll anchoring); in
  // continuous reading it ends the keeping, as the browser's scroll anchoring holds the new place.
  const jumped=target=>{if(!reading?.geometry()||!target){stop();return;}
    const range=target instanceof Range?target:document.createRange();if(!(target instanceof Range))range.selectNode(target);
    const node=range.startContainer,block=(node instanceof Element?node:node.parentElement)?.closest('[data-source-start]')||(target instanceof Element?target:null);
    if(block)place={block,range,top:0};else stop();};
  lateMoved=jumped;
  try{
    // Between slices at most every 100 ms: each re-seek lays out the whole article again.
    let last=0;const slice=()=>{const now=performance.now();if(now-last<100)return;last=now;keep();positionPins();};
    if(math){await drawMath(article,{first:nearReader(),onSlice:slice});if(id!==state.routeId)return;mathLanded();keep();}
    if(diagrams){
      await drawDiagrams(article);
      for(const content of article.querySelectorAll('.embedded-content'))await drawDiagrams(content);
      keep();
    }
  }finally{events.forEach(type=>removeEventListener(type,stop,{capture:true}));if(lateMoved===jumped)lateMoved=null;}
}
/** Set while drawLate() keeps the reader's place, for jumps Reader makes: a heading link, a passage, find or a thread. */
let lateMoved=null;
/** Whether an element is on or next to what the reader sees: one window around it, or one spread around it. */
function nearReader(){
  const box=reading?.geometry()?.viewport.getBoundingClientRect();
  return box?el=>{const r=el.getBoundingClientRect();return r.right>box.left-box.width&&r.left<box.right+box.width;}:el=>{const r=el.getBoundingClientRect();return r.bottom>-innerHeight&&r.top<innerHeight*2;};
}
/** Typeset formulas replace their TeX text, so anchors painted over it are drawn again from the new text. */
function mathLanded(){
  if(state.ranges.length||state.threads.length||state.embedThreads?.size)paintAnnotations();
  if(!state.pdf&&!$('#find-bar').hidden&&$('#find-query').value){const index=state.findIndex;updateFind().then(()=>{if(index>0&&state.find.length){state.findIndex=Math.min(index,state.find.length-1);showFind(false);}});}
}
/** The first source block in view, and its offset from the top of the window. */
function readingPlace(){
  const blocks=[...($('#article')?.querySelectorAll('[data-source-start]')||[])].filter(el=>!el.closest('.document-embed,[data-reader-decoration]')),geometry=reading?.geometry();
  if(geometry){const box=geometry.viewport.getBoundingClientRect();const block=blocks.find(el=>{const r=el.getClientRects()[0];return r&&r.width>0&&r.right>box.left+2&&r.left<box.right-2;});return block?{block,top:0}:null;}
  const block=blocks.find(el=>el.getBoundingClientRect().bottom>0);return block?{block,top:block.getBoundingClientRect().top}:null;
}
// Math placeholders from math.mjs are typeset by the lazy KaTeX chunk; its CSS and fonts load with it.
let mathModule=null;
async function drawMath(container,{first,onSlice}={}){
  if(!container.querySelector('.reader-math[data-tex]:not([data-state])'))return;
  try{
    if(!document.querySelector('link[data-katex]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/assets/controls/katex/katex.css';link.dataset.katex='';const loaded=new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=()=>reject(new Error('KaTeX styles did not load'));});document.head.append(link);await loaded;}
    mathModule??=await import('./controls/math.js');mathModule.installMathCopy();
  }catch(error){console.error(error);document.querySelector('link[data-katex]')?.remove();notify('Formulas couldn’t load; showing their TeX instead.','error');return;}
  const {skipped}=await mathModule.renderMath(container,{first,onSlice,onRender:()=>{refreshScroll();positionPins();}});
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
  const target=id&&findFragment(root,id);if(!target)return false;lateMoved?.(target);
  const range=document.createRange();range.selectNode(target);
  if(!reading?.reveal(range,false))scrollToPosition(scrollY+target.getBoundingClientRect().top-24,false,target);
  return true;
}
function wireArticleLinks(root,path){
  root.querySelectorAll('a').forEach(link=>link.addEventListener('click',async event=>{
    // Each document wires its own links (an embed's resolve from the embedded file); embed headers open their source.
    if(scopeOf(link)!==scopeOf(root)||link.closest('[data-embed-open]'))return;
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
/** Visible text of root, for anchoring (its own text: embedded documents excluded) or for find (`embeds`: included).
 *  Exclusions count only inside root, so an embedded fragment projects its own text. */
function domProjection(root,{embeds=false}={}) {
  const skip=embeds?'.annotation-pin,[data-reader-decoration],script,style':'.annotation-pin,.document-embed,[data-reader-decoration],script,style';
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){const hit=node.parentElement?.closest(skip);return hit&&root.contains(hit)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;}});
  const nodes=[],bases=[];let raw='',node;
  while((node=walker.nextNode())){nodes.push(node);bases.push(raw.length);raw+=node.data;}
  const {text,starts,ends}=projectText(raw);
  // The text node holding raw UTF-16 unit i (text nodes are never empty here: an empty one adds no unit).
  const holder=i=>{let lo=0,hi=nodes.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(bases[mid]<=i)lo=mid;else hi=mid-1;}return lo;};
  const start=j=>{const k=holder(starts[j]);return [nodes[k],starts[j]-bases[k]];};
  const end=j=>{const k=holder(ends[j]-1);return [nodes[k],ends[j]-bases[k]];};
  return {text,range(from,to){if(!(from>=0&&from<text.length&&to>=1&&to<=text.length))return null;const range=document.createRange();range.setStart(...start(from));range.setEnd(...end(to-1));return range;},
    // Projected index of the first character at or after a range's start, for telling repeated quotes apart.
    // Projected points are in document order, so the first one at or after it is found by binary search.
    indexOf(range){let lo=0,hi=text.length;while(lo<hi){const mid=(lo+hi)>>1;if(range.comparePoint(...start(mid))>=0)hi=mid;else lo=mid+1;}return lo;}};
}
/** Find's projection of the article (with or without embeds), kept until the article's visible text changes:
 *  a render, an edition, embeds mounting, typeset math, drawn diagrams or highlighted code all mutate it.
 *  Pins come and go without touching the text, so they keep it. Typing in find then only searches (#35). */
const findCache={root:null,observer:null,doms:new Map()};
function articleProjection(root,{embeds=false}={}){
  if(findCache.root!==root){
    findCache.observer?.disconnect();findCache.doms.clear();findCache.root=root;
    findCache.observer=new MutationObserver(records=>{if(records.some(textChange))findCache.doms.clear();});
    findCache.observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-reader-decoration']});
  }else if(findCache.observer.takeRecords().some(textChange))findCache.doms.clear();
  if(!findCache.doms.has(embeds))findCache.doms.set(embeds,domProjection(root,{embeds}));
  return findCache.doms.get(embeds);
}
const isPin=node=>node.nodeType===1&&node.classList.contains('annotation-pin');
/** Whether a mutation can change a projection: anything but a pin or a decoration changing inside itself, or
 *  pins alone being added or removed. Projected-out classes (pins, embeds) are set when elements are made. */
function textChange(record){
  if(record.type==='attributes')return true;
  const el=record.target.nodeType===1?record.target:record.target.parentElement;
  if(el?.closest('.annotation-pin,[data-reader-decoration]'))return false;
  return record.type!=='childList'||![...record.addedNodes,...record.removedNodes].every(isPin);
}
// The source projection costs O(n) per document; build it only when a thread or selection needs it.
// The open document's, or an embedded document's (embeds.doc(path)).
let projected=new WeakMap();
function projection(doc=state.doc){if(!doc||doc.text===null)return null;if(!projected.has(doc))projected.set(doc,projectSource(doc.text));return projected.get(doc);}
/** The smallest source block of one document (the open one, or the embedded fragment `scope`) holding [start, end). */
function sourceBlock(start,end,scope=null) {
  const root=scope||$('#article');
  const blocks=[...root.querySelectorAll('[data-source-start]')].filter(el=>scopeOf(el)===scope && +el.dataset.sourceStart<=start && +el.dataset.sourceEnd>=end);
  return blocks.sort((a,b)=>(+a.dataset.sourceEnd-a.dataset.sourceStart)-(+b.dataset.sourceEnd-b.dataset.sourceStart))[0] || root;
}
/** Threads of the open document and of every document embedded in it (each thread once). */
function allThreads(){const seen=new Set(),all=[];for(const thread of [...state.threads,...[...(state.embedThreads||new Map()).values()].flatMap(v=>v.threads)])if(!seen.has(thread.id)){seen.add(thread.id);all.push(thread);}return all;}
/** Margins of the embedded documents shown on the page (at most 24 files, four requests at a time). */
async function loadEmbedDiscussions(){
  const doc=state.doc,article=$('#article');if(!doc||!article)return;
  const paths=[...new Set(embeds.scopes(article).map(el=>el.dataset.sourcePath))].filter(path=>path!==doc.path).slice(0,24),found=new Map();
  for(let i=0;i<paths.length;i+=4)await Promise.all(paths.slice(i,i+4).map(async path=>{try{const data=await api('/api/discussion?path='+param(path)+'&participant='+param(state.prefs.participant));found.set(path,{threads:data.threads,attention:data.attention.items});}catch{/* An embed's margins are optional. */}}));
  if(state.doc!==doc)return;
  state.embedThreads=found;state.attention=[...(state.hostAttention||[]),...[...found.values()].flatMap(v=>v.attention)];
}
async function loadDiscussion(){
  if(!state.doc || !['.md','.markdown'].includes(state.doc.kind))return;
  const path=state.doc.path;
  const [data]=await Promise.all([api('/api/discussion?path='+param(path)+'&participant='+param(state.prefs.participant)),loadEmbedDiscussions()]);
  if(state.doc?.path!==path)return;
  state.threads=data.threads;state.hostAttention=data.attention.items;state.attention=[...data.attention.items,...[...(state.embedThreads||new Map()).values()].flatMap(v=>v.attention)];paintAnnotations();
}
function paintAnnotations(){
  const article=$('#article');if(!article)return;
  article.querySelectorAll('.annotation-pin').forEach(el=>el.remove());state.ranges=[];
  const groups={'reader-own':[],'reader-other':[],'reader-warning':[]};
  // The open document's threads, then each embedded fragment's threads that fall inside it (a thread is pinned once).
  const targets=state.threads.map(thread=>({thread,scope:null,doc:state.doc})),pinned=new Set();
  for(const scope of embeds.scopes(article)){
    const path=scope.dataset.sourcePath,doc=path===state.doc?.path?state.doc:embeds.doc(path),from=+scope.dataset.embedStart,to=+scope.dataset.embedEnd;
    const threads=path===state.doc?.path?state.threads:state.embedThreads?.get(path)?.threads||[];
    for(const thread of threads)if(doc&&thread.location&&thread.location.start>=from&&thread.location.end<=to)targets.push({thread,scope,doc});
  }
  for(const {thread,scope,doc} of targets){
    if(!['exact','relocated'].includes(thread.location?.status)||pinned.has(thread.id))continue;
    const start=thread.location.start,end=thread.location.end,root=sourceBlock(start,end,scope),dom=domProjection(root);
    let quote=visibleQuote(projection(doc),start,end);let hits=occurrences(dom.text,quote);
    if(hits.length!==1){quote=normalize(thread.anchor.quote);hits=occurrences(dom.text,quote);}
    if(hits.length!==1)continue;
    const range=dom.range(hits[0].start,hits[0].end);if(!range)continue;
    const key=thread.kind==='warning'?'reader-warning':thread.owner===state.prefs.participant?'reader-own':'reader-other';
    groups[key].push(range);state.ranges.push({thread,range});pinned.add(thread.id);
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
    const size=pin.offsetWidth||28,room=column<columns-1?gap:pageWidth()-right,top=Math.max((stacks[column]??-Infinity)+size+3,rect.top+rect.height/2);stacks[column]=top;
    return {left:Math.min(pageWidth()-size-2,right+Math.max(2,(room-size)/2)),top};
  };
}
function positionPins(){
  const article=$('#article');if(!article)return;const box=article.getBoundingClientRect();let previous=-30;const place=reading?.hasBook()?spreadPinPlacer(article):null;
  // Two-page pins belong to the spread showing their highlight: the book viewport's box, not the window, which in a
  // wide window also spans the margin where the next spread's first column waits.
  const spread=reading?.hasBook()?article.closest('.book-viewport')?.getBoundingClientRect():null;
  // Pins stack down each margin, so place them in reading order (threads arrive in id order).
  const placed=[];
  for(const {thread,range} of state.ranges){const rects=[...range.getClientRects()];const rect=spread?rects.find(r=>r.width>0&&r.right>spread.left+1&&r.left<spread.right-1):reading?.hasBook()?null:rects.at(-1);const pin=article.querySelector(`[data-thread="${CSS.escape(thread.id)}"]`);if(!pin)continue;pin.hidden=!rect;if(rect)placed.push({pin,rect});}
  placed.sort((a,b)=>a.rect.top-b.rect.top||a.rect.left-b.rect.left);
  for(const {pin,rect} of placed){if(place){const at=place(rect,pin);pin.style.left=at.left+'px';pin.style.top=at.top+'px';}else if(reading?.hasBook()){pin.style.left=Math.min(pageWidth()-25,rect.right+9)+'px';pin.style.top=rect.bottom-5+'px';}else{pin.style.left='';const top=Math.max(previous+27,rect.bottom-box.top-5);pin.style.top=top+'px';previous=top;}}
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
  decorateCodeBlocks(template.content,{wrap:true,lineNumbers:false});
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
  const every=allThreads(),threads=participant?every.filter(t=>t.owner===participant||t.comments.some(c=>c.author===participant)):every;
  state.activeThread=null;$('#thread-panel').hidden=false;$('#thread-title').textContent=participant?'In the margins · '+participant:'In the margins';
  $('#thread-body').innerHTML=threads.length?threads.map(t=>`<button class="thread-list-item" data-open-thread="${esc(t.id)}"><small>${esc(t.owner)}${t.kind==='warning'?' · warning':''}${threadUnread(t.id)?' · unread':''}${t.document_path&&t.document_path!==state.doc.path?' · in '+esc(embeds.doc(t.document_path)?.title||t.document_path.split('/').pop()):''}</small><blockquote>“${esc(plainQuote(t.anchor.quote).slice(0,220))}”</blockquote><small>${plural(t.comments.length,'comment')}${t.resolved?' · resolved':''}</small></button>`).join(''):'<p class="empty-note">No notes in these margins yet.<br>Select a passage to begin.</p>';
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
    await loadDiscussion();const thread=allThreads().find(t=>t.id===id);if(!thread)throw new Error('This thread is not in the open document.');
    const first=state.activeThread!==id||$('#thread-panel').hidden;
    queue?.close(false);if(state.activeThread!==id){state.replyTo=null;$('#thread-body').replaceChildren();}state.activeThread=id;$('#thread-panel').hidden=false;renderThread(thread);
    if(first)enterThreadPanel();
    const items=state.attention.filter(i=>i.thread_id===id).map(({key,version})=>({key,version}));
    if(items.length)await api('/api/seen',{participant:state.prefs.participant,items});
    await loadDiscussion();const fresh=allThreads().find(t=>t.id===id);if(state.activeThread===id&&fresh)renderThread(fresh);
  }catch(error){report(error);}
}
/** Which repeat of the quote the range starts at, counted within the block's visible text. */
function quoteOccurrence(block,range,quote){
  const dom=domProjection(block),at=dom.indexOf(range),needle=normalize(quote);let count=0,before=0,index=0;
  while(needle&&(index=dom.text.indexOf(needle,index))>=0){count++;if(index<at)before++;index++;}
  return {occurrence:before,count};
}
/** Map the page selection (or VISUAL's range and text) to source coordinates in state.selected. */
function captureSelection(given=null){
  const article=$('#article'),selection=getSelection();if(!article||state.doc?.historical||!state.doc?.text)return;
  if(!given&&(!selection?.rangeCount||selection.isCollapsed))return;
  const range=given?.range||selection.getRangeAt(0);
  const parent=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
  if(!article.contains(parent)||parent.closest('.annotation-pin,[data-reader-decoration]'))return;
  // A selection inside an embedded fragment annotates the embedded file, at its own offsets; embed chrome never.
  const scope=scopeOf(parent),embed=parent.closest('.document-embed');
  if(embed&&(!scope||!embed.contains(scope)))return;
  const doc=scope?embeds.doc(scope.dataset.sourcePath):state.doc;if(!doc?.text)return;
  const quote=given?.quote??selection.toString();if(!quote.trim())return;
  const found=parent.closest('[data-source-start]'),block=found&&scopeOf(found)===scope?found:null;
  try {
    const bounds=block?{start:+block.dataset.sourceStart,end:+block.dataset.sourceEnd,...quoteOccurrence(block,range,quote)}:scope?{start:+scope.dataset.embedStart,end:+scope.dataset.embedEnd}:null;
    const coords=sourceRangeForQuote(doc.text,quote,bounds,projection(doc));
    state.selected={...coords,path:doc.path,sha256:doc.sha256,quote:rawCodePoints(doc.text,coords.start,coords.end),requests:{}};
    state.lastQuote={quote:plainQuote(state.selected.quote),path:doc.path,title:String(doc.metadata?.title||doc.title||doc.path)};  // :cite in the scratch pad
    const rect=[...range.getClientRects()].at(-1) || range.getBoundingClientRect(),tools=$('#selection-tools');
    tools.hidden=false;tools.style.left=Math.max(130,Math.min(pageWidth()-130,rect.right))+'px';tools.style.top=Math.max(60,rect.top-10)+'px';
    // Touch browsers draw their own selection menu above the passage, so the toolbar goes below it there.
    if(matchMedia('(pointer: coarse)').matches)tools.style.top=Math.min(innerHeight-20,range.getBoundingClientRect().bottom+tools.offsetHeight+28)+'px';
  }catch(error){state.selected=null;$('#selection-tools').hidden=true;if(!error.offline&&captureSelection.failed!==quote)toast(error.message);captureSelection.failed=quote;}
}
async function createAnnotation(kind,comment=''){
  const selected=state.selected;if(!selected||selected.path!==state.doc?.path&&!embeds.doc(selected.path))throw new Error('Select the passage again.');
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
  const anchor=reading.revealLine(at.line,at.page);lateMoved?.(anchor);
  const terms=[...new Set(at.terms)].filter(Boolean).sort((a,b)=>b.length-a.length);
  if(!terms.length)return;
  if(state.pdf){
    $('#find-query').value=terms[0];await updateFind();
    const index=state.find.findIndex(hit=>hit.page>=(at.page||1));state.findIndex=index>=0?index:state.find.length?0:-1;
  }else{
    const root=$('#article');if(!root)return;const dom=articleProjection(root);
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
  // Find covers embedded documents too (those loaded so far); anchoring uses each document's own text.
  const root=$('#article');if(!root)return;const dom=articleProjection(root,{embeds:true});
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
/** Highlight at once, or open the comment / warning dialog for the captured selection. */
function annotate(kind){
  if(kind==='highlight'){createAnnotation('highlight').catch(report);return;}
  $('#annotation-dialog').classList.toggle('warning',kind==='warning');$('#annotation-title').textContent=kind==='warning'?'Leave a warning.':'Leave a thought.';$('#annotation-quote').textContent=plainQuote(state.selected?.quote || '');$('#annotation-body').value='';$('#annotation-form button').textContent=kind==='warning'?'Leave warning':'Leave comment';openDialog('annotation-dialog');$('#annotation-body').focus();
}
document.querySelectorAll('[data-annotate]').forEach(button=>button.onclick=()=>annotate(button.dataset.annotate));
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
  // VISUAL mirrors its selection into the page; its own keys act on it, without the toolbar.
  if(state.visual)return;
  clearTimeout(selectionTimer);if(getSelection()?.isCollapsed){$('#selection-tools').hidden=true;captureSelection.failed=null;return;}
  selectionTimer=setTimeout(()=>{if(!mouseSelecting&&!document.querySelector('dialog[open]'))captureSelection();},450);
});
let hoverFrame;
document.addEventListener('mousemove',event=>{
  document.body.classList.toggle('reveal-controls',event.clientX>pageWidth()-75&&event.clientX<pageWidth()&&event.clientY>innerHeight-80);
  if(hoverFrame)return;
  hoverFrame=requestAnimationFrame(()=>{hoverFrame=null;const spread=reading?.geometry()?.viewport.getBoundingClientRect(),inside=!spread||event.clientX>=spread.left&&event.clientX<=spread.right&&event.clientY>=spread.top&&event.clientY<=spread.bottom;const hit=inside&&state.ranges.find(({range})=>[...range.getClientRects()].some(r=>event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom));const tip=$('#passage-tooltip');if(hit){tip.textContent=`${hit.thread.owner} · ${plural(hit.thread.comments.length,'comment')}`;tip.style.left=Math.max(10,Math.min(innerWidth-260,event.clientX+12))+'px';tip.style.top=event.clientY+20+'px';tip.classList.add('visible');}else tip.classList.remove('visible');});
});
// Keyboard ------------------------------------------------------------------------------------------
// Every page key is a row in the keymap table (keys.mjs); the help dialog and the leader hints are generated from it.
// A feature adds keys with keys.map({mode, keys, when, run, help, hint, group}) and commands with keys.command({...}).
const typing=event=>state.themeEditorOpen||!!event.target.closest?.('input,textarea,select,[contenteditable="true"],dialog,[role=dialog],[role=listbox]:not(.queue-list),[data-slot=popover-content],[role=switch],[data-slot=pagination]');
function pageEscape(event){
  if(event.target.closest?.('.cm-editor'))return;  // Vim's Escape stays in the scratch editor; Escape in normal mode leaves it.
  if(state.themeEditorOpen||event.target.closest('[data-slot=popover-content],[data-slot=select-content],[data-slot=sheet-content]')||document.querySelector('dialog[open]'))return;
  event.preventDefault();
  if(!$('#thread-panel').hidden&&$('#thread-panel').contains(document.activeElement)){leaveThreadPanel();return;}
  if(panels.isOpen()&&panels.contains(document.activeElement)){panels.close();return;}
  if(state.view==='search'){if(!search.escape())goBack();return;}
  if(state.fromSearch&&$('#find-bar').hidden){clearFind();return;}
  closeContext();if(split?.active())split.refocus();else focusMain();
}
function syncChips(){
  const qf=quickfix?.get(),chip=$('#status-qf');
  if(chip){chip.hidden=!qf?.items.length;chip.textContent=qf?.items.length?`QF ${qf.index>=0?qf.index+1:'–'}/${qf.items.length}`:'';}
}
keys=createKeys({guard:typing,escape:pageEscape,notify,changed(){
  const pending=keys?.pending();state.leader=pending?.keys[0]==='<Space>'?(pending.keys[1]===','?',':true):null;state.windowKey=pending?.keys[0]==='<C-w>';
  syncChips();reading?.updateStatus();
}});
const article=()=>$('#article');
const inDoc=()=>!!state.doc&&!!article();
const homepage=()=>state.view==='issue'&&!state.doc;
const theme=()=>{closeContext();setThemeEditorOpen(true);};
const scrollBy=(lines,count)=>scrollToPosition(scrollY+lines*Math.max(1,count||1));
/** The current place for marks and the jump list: the first block in view of the current edition. */
function position(){
  const mark=reading?.capture();if(!mark||!state.doc)return null;
  return {path:mark.path,sha256:mark.source_sha256,offset:mark.source_offset,page:mark.pdf_page,fraction:mark.block_fraction,progress:mark.progress};
}
function restorePlace(spot){
  const size=el=>+el.dataset.sourceEnd-el.dataset.sourceStart;
  const blocks=spot.page?[...document.querySelectorAll(`#article [data-pdf-page="${spot.page}"]`)]:spot.offset!=null?[...document.querySelectorAll(`#article [data-source-start="${spot.offset}"]`)].filter(el=>!el.closest('.document-embed')).sort((a,b)=>size(a)-size(b)):[];
  const target=blocks[0];if(!target){reading.seek(spot.progress??0,false);return;}
  const range=document.createRange();range.selectNode(target);
  if(!reading.reveal(range,false)){const r=target.getBoundingClientRect();scrollToPosition(scrollY+r.top+r.height*(spot.fraction||0)-innerHeight*.22,false,target,spot.fraction||0);}
  reading.update();
}
async function goTo(spot){
  if(!spot)return;
  if(state.doc?.path!==spot.path){await navigate(spot.path,{jump:false});if(state.doc?.path!==spot.path)return;}
  restorePlace(spot);
}
/** Open a list location: a search passage (line and terms) or a source range (a register). */
async function openAt(item){
  jumps.record();
  if(item.at){if(state.doc?.path===item.path&&!state.doc.historical){clearFind();await revealPassage(item.at);}else await navigate(item.path,{at:item.at,jump:false});return;}
  if(state.doc?.path!==item.path){await navigate(item.path,{jump:false});if(state.doc?.path!==item.path)return;}
  if(item.sha256&&item.sha256!==state.doc.sha256){toast('This edition changed since then; showing the start of the document.');return;}
  if(item.start!=null)seekChange(item.start,item.end??item.start);
}
({registers,quickfix,marks,jumps,lists:panels}=installLists({state,api,notify,openAt,position,goTo,param,onChange:()=>{syncChips();reading?.updateStatus();}}));
const focusedLink=()=>{const a=document.activeElement;return a?.matches?.('a[href]')&&article()?.contains(a)?a:null;};
const linkActions={
  preview:a=>links.preview(a),
  follow:a=>a.click(),
  /** gx: a web link in a new tab; a library link opens its document in a new Reader tab. */
  async external(a){
    const href=a.getAttribute('href')||'';
    if(/^(https?:|mailto:)/i.test(href)){window.open(href,'_blank','noopener,noreferrer');return;}
    if(href.startsWith('#')){a.click();return;}
    try{const from=a.closest('[data-source-path]')?.dataset.sourcePath||state.doc.path,resolved=await api('/api/resolve?from='+param(from)+'&target='+param(decode(href)));
      window.open(location.pathname+'#read='+param(resolved.path)+(resolved.fragment?'&h='+param(resolved.fragment):''),'_blank','noopener');}catch(error){report(error);}
  },
};
function onLink(run){const a=focusedLink();if(!a){toast('Move to a link with ]l or Tab first.');return;}run(a);}
visual=installVisual({state,keys,reading:{geometry:()=>reading.geometry(),reveal:(range,animate)=>reading.reveal(range,animate)},scrollToPosition,notify,captureSelection,createAnnotation,annotate,speak:()=>speech.send('selection'),registers,quickfix,links:linkActions,jumps,report});
/** Elements in document order around the reading place: the next one after it, or the last one before it. */
function stepThrough(list,delta,current,count=1){
  if(!list.length)return null;let index=current?list.indexOf(current):-1;
  if(index<0){const place=readingPlace()?.block;if(!place)return delta>0?list[0]:null;
    const after=list.findIndex(el=>{const p=place.compareDocumentPosition(el);return p&Node.DOCUMENT_POSITION_FOLLOWING||p&Node.DOCUMENT_POSITION_CONTAINED_BY||el===place;});
    index=delta>0?(after<0?list.length:after)-1:(after<0?list.length:after);}
  return list[index+delta*Math.max(1,count)]??null;
}
const rangeOf=el=>{const range=document.createRange();range.selectNode(el);return range;};
function flashBlock(el){el.classList.remove('change-target');void el.offsetWidth;el.classList.add('change-target');setTimeout(()=>el.classList.remove('change-target'),1800);}
/** ]c [c ]x [x: margin threads in reading order; the pin takes focus, so Enter opens the thread. */
function stepThread(delta,{count,unread=false}={}){
  if(!state.ranges.length){toast('No margin threads in this document.');return;}
  const ordered=[...state.ranges].sort((a,b)=>a.range.compareBoundaryPoints(Range.START_TO_START,b.range)).filter(entry=>!unread||threadUnread(entry.thread.id));
  if(!ordered.length){toast('No unread margin threads here.');return;}
  const marker=entry=>{const pin=article().querySelector(`[data-thread="${CSS.escape(entry.thread.id)}"]`);return pin;};
  const anchors=ordered.map(entry=>{const node=entry.range.startContainer;return node.nodeType===1?node:node.parentElement;});
  const current=ordered.findIndex(entry=>entry.thread.id===state.threadCursor);
  let next;if(current>=0)next=ordered[current+delta*Math.max(1,count||1)];else{const el=stepThrough(anchors,delta,null,count);next=el?ordered[anchors.indexOf(el)]:null;}
  if(!next){toast(delta>0?'No more margin threads after this one.':'No margin threads before this one.');return;}
  jumps.record();state.threadCursor=next.thread.id;moveToRange(next.range);visual.flash(next.range);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{positionPins();const pin=marker(next);if(pin&&!pin.hidden)pin.focus({preventScroll:true});}));
}
/** ]f [f figures (images, diagrams, tables); ]l [l links written in the document. */
const figures=()=>[...article().querySelectorAll('figure,img,table')].filter(el=>!el.closest('.document-embed,[data-reader-decoration]')&&!el.parentElement.closest('figure'));
const docLinks=()=>[...article().querySelectorAll('a[href]')].filter(a=>!a.closest('[data-reader-decoration],.annotation-pin,.embed-note')&&a.getAttribute('href'));
function stepFigure(delta,{count}){
  const list=figures();if(!list.length){toast('No figures, images or tables in this document.');return;}
  const current=state.figureCursor?.isConnected&&list.includes(state.figureCursor)?state.figureCursor:null;
  const next=stepThrough(list,delta,current,count);if(!next){toast(delta>0?'No more figures after this one.':'No figures before this one.');return;}
  jumps.record();state.figureCursor=next;moveToRange(rangeOf(next));flashBlock(next);
  const focusable=next.matches('[tabindex]')?next:next.querySelector('[tabindex]');focusable?.focus({preventScroll:true});
}
function stepLink(delta,{count}){
  const list=docLinks();if(!list.length){toast('No links in this document.');return;}
  const next=stepThrough(list,delta,focusedLink(),count);if(!next){toast(delta>0?'No more links after this one.':'No links before this one.');return;}
  next.focus({preventScroll:true});const range=document.createRange();range.selectNodeContents(next);moveToRange(range);
}
function seekEdge(end){jumps.record();if(reading.hasBook())reading.seek(end?1:0);else scrollToPosition(end?document.documentElement.scrollHeight:0,true,end?[...$('#article')?.children||[]].filter(el=>!el.classList.contains('annotation-pin')).at(-1):null);}
const R='Reading',L='Leader: Space or comma',H='Homepage',S='Search page',M='Marks and jumps',Q='Lists',P='In panels',W='Split view: Ctrl w or Space W',X='Scratch pad';
keys.group('<Space>,','more');
keys.prefix('<C-w>',{label:'WINDOW',ms:1500});
keys.order([R,'Selecting (v, V)',M,Q,L,W,X,H,S,P]);
/** In a split pane, the shell owns the queue, chat and help: the pane forwards those keys. */
const inShell=(key,run)=>()=>{if(pane){pane.post({type:'window-key',key,shell:true});return;}run();};
keys.map(
  // Global: works even while writing.
  {mode:['normal','visual'],keys:'<F10>',global:true,run(){keys.clear();if(visual.active())visual.exit();if(!state.themeEditorOpen)closeContext();setThemeEditorOpen(!state.themeEditorOpen);}},
  // Leader, in the order the status line lists it.
  {keys:'<Space>/',run:()=>openSearch(),hint:'search',group:L,help:'Search every passage: exact words or meaning'},
  {keys:'<Space>e',run:()=>openPicker(),hint:'files',group:L,help:'Open files; filter by name or contents'},
  {keys:'<Space>h',run:()=>navigate(null),hint:'home',group:L,help:'Return to your homepage'},
  {keys:'<Space>r',run:inShell('r',()=>queue.toggle()),hint:'queue',group:L,help:'Reading queue: Up next and History (`Tab` switches)'},
  {keys:'<Space>n',run:inShell('n',()=>queue.next()),hint:'next',group:L,help:'Open the next document in your queue'},
  {keys:'<Space>t',run:()=>openThreadList(),hint:'threads',group:L,help:'Open passage discussions'},
  {keys:'<Space>c',run:()=>prose.press(),hint:'colors',group:L,help:'Prose colors: Off, Subtle, Clear, Vivid, in turn, for this document'},
  {keys:'<Space>m',run:inShell('m',()=>toggleChat()),hint:'chat',group:L,help:'Chat with the voices about this document; `@` chooses who answers, `r` on a focused voice message replies to it, `Ctrl r` `a` pastes register a'},
  {keys:'<Space>o',run:()=>outline.toggle(),hint:'outline',group:L,help:'Show or hide the document outline'},
  {keys:'<Space>s',run:()=>speech.openMenu(),hint:'speak',group:L,help:'Send to AI-TTS: the whole article, from here, or the selection'},
  {keys:'<Space>p',run:()=>openPreferences(),hint:'backstage',group:L,help:'Behind the scenes: indexes, library statistics and settings'},
  {keys:'<Space>v',run:()=>openEditions(),hint:'versions',group:L,help:'Versions: every edition and its history. In the timeline, `j` `k` move, `Enter` opens, `c` on two versions compares them'},
  {keys:'<Space>d',run:()=>changesShortcut(),hint:'changes',group:L,help:'What changed since you read it, or against the newer version'},
  {keys:'<Space>g',run:()=>toggleArt(),hint:'art',group:L,help:'Article art: show or hide the open article’s art (or Generate art when it has none)'},
  {keys:'<Space>G',run:()=>focusShownArt(),group:L,help:'Focus on the art full screen, with Regenerate this (Esc returns)'},
  {keys:'<Space>z',run:()=>{closeContext();reading.toggleZen();},group:L,help:'Hide or reveal the reading chrome'},
  {keys:'<Space>w',run:()=>navigate(SCRATCH+'='+crypto.randomUUID()),hint:'scratch',group:L,help:'Scratch pad: a new Markdown buffer with Vim keys and a live preview (see Scratch pad below)'},
  {keys:'<Space>W',run:()=>{keys.feed('<C-w>');},hint:'window',group:L,display:'Space W',help:'The window prefix, as `Ctrl w` (for browsers that keep Ctrl W)'},
  {keys:'<Space>?',run:inShell('?',()=>openHelp()),group:L,help:'This map of keys'},
  {keys:'<Space>,t',run:theme,hint:'theme editor',group:L,display:'Space , t / F10',help:'Open or close the Theme Editor'},
  // A selection made with the mouse or the shift keys: show its toolbar.
  {keys:'a',when:event=>!event?.target.closest?.('a,button,summary')&&getSelection()?.isCollapsed===false&&!!article()?.contains(getSelection().anchorNode),run(){captureSelection();if(!$('#selection-tools').hidden)$('#selection-tools button')?.focus({preventScroll:true});},group:R,display:'a / Enter',help:'With a passage selected, show the Highlight / Comment / Warn toolbar'},
  {keys:'<CR>',when:event=>!event?.target.closest?.('a,button,summary')&&getSelection()?.isCollapsed===false&&!!article()?.contains(getSelection().anchorNode),run(){captureSelection();if(!$('#selection-tools').hidden)$('#selection-tools button')?.focus({preventScroll:true});}},
  // Paging, before the per-view keys so they work everywhere.
  ...['<C-d>','<C-u>','<C-f>','<C-b>'].map(key=>({keys:key,run(){const down=key==='<C-d>'||key==='<C-f>',half=key==='<C-d>'||key==='<C-u>';if(reading.hasBook())reading.turn(down?1:-1);else scrollToPosition(scrollY+innerHeight*(down?1:-1)*(half?.5:.9));},
    ...(key==='<C-d>'?{group:R,display:'Ctrl d / Ctrl u',help:'Half a page down / up (a spread in two-page reading)'}:key==='<C-f>'?{group:R,display:'Ctrl f / Ctrl b',help:'A page down / up'}:{})})),
  // The search page's own keys come first while it is shown.
  ...['j','k','<Down>','<Up>','J','K','<CR>','o','q','/'].map(key=>({keys:key,when:()=>state.view==='search',run:({event})=>search.key(event),
    ...(key==='j'?{group:S,display:'j k / J K',help:'On Search: next / previous passage, or work; `Enter` opens it, `o` in a new tab, `q` queues it, `/` returns to the query'}:{})})),
  // The homepage issue.
  {keys:'j',when:homepage,run:({count})=>movePiece(Math.max(1,count)),group:H,display:'j k',help:'Move between the issue’s pieces'},
  {keys:'k',when:homepage,run:({count})=>movePiece(-Math.max(1,count))},
  {keys:'gc',when:()=>state.view==='issue',run(){const cover=$('[data-cover]');if(cover){cover.focus({preventScroll:true});scrollToPosition(0);}},group:H,display:'g c',help:'Go to the cover story'},
  {keys:']',when:homepage,run:()=>stepIssue(1),group:H,display:'[ / ]',help:'Previous / next issue'},
  {keys:'[',when:homepage,run:()=>stepIssue(-1)},
  // Reading.
  ...['j','k','h','l'].map(key=>({keys:key,when:()=>reading.hasBook(),run:({count})=>{for(let i=0;i<Math.max(1,count);i++)reading.turn(['j','l'].includes(key)?1:-1);}})),
  {keys:'j',run:({count})=>scrollBy(85,count),group:R,display:'j k',help:'Scroll down / up; turn spreads in two-page mode; counts work (`5j`)'},
  {keys:'k',run:({count})=>scrollBy(-85,count)},
  {keys:'gg',run:()=>seekEdge(false),group:R,display:'g g / G',help:'Beginning / end'},
  {keys:'G',run:()=>seekEdge(true)},
  {keys:']]',when:()=>!homepage(),run:({count})=>{jumps.record();for(let i=0;i<Math.max(1,count);i++)outline.jump(1);},group:R,display:'] ] / [ [',help:'Next heading / start of this or the previous section'},
  {keys:'[[',when:()=>!homepage(),run:({count})=>{jumps.record();for(let i=0;i<Math.max(1,count);i++)outline.jump(-1);}},
  {keys:']c',when:inDoc,run:c=>stepThread(1,c),group:R,display:'] c / [ c',help:'Next / previous margin thread; `Enter` on its mark opens it'},
  {keys:'[c',when:inDoc,run:c=>stepThread(-1,c)},
  {keys:']x',when:inDoc,run:c=>stepThread(1,{...c,unread:true}),group:R,display:'] x / [ x',help:'Next / previous unread margin thread'},
  {keys:'[x',when:inDoc,run:c=>stepThread(-1,{...c,unread:true})},
  {keys:']f',when:inDoc,run:c=>stepFigure(1,c),group:R,display:'] f / [ f',help:'Next / previous figure, image or table'},
  {keys:'[f',when:inDoc,run:c=>stepFigure(-1,c)},
  {keys:']l',when:inDoc,run:c=>stepLink(1,c),group:R,display:'] l / [ l',help:'Next / previous link in the document; its preview opens'},
  {keys:'[l',when:inDoc,run:c=>stepLink(-1,c)},
  {keys:'K',when:inDoc,run:()=>onLink(linkActions.preview),group:R,display:'K / g f / g x',help:'On a focused link: show its preview / follow it / open it in a new tab'},
  {keys:'gf',when:inDoc,run:()=>onLink(linkActions.follow)},
  {keys:'gx',when:inDoc,run:()=>onLink(linkActions.external)},
  {keys:'gd',when:inDoc,run:()=>visual.firstUse(),group:R,display:'g d',help:'First use of the term you found with `/` (in VISUAL, of the word under the cursor)'},
  {keys:'%',when:inDoc,run:({count})=>{if(count){jumps.record();reading.seek(Math.min(100,count)/100);}else visual.footnote();},group:R,display:'% / 50 %',help:'Footnote reference ↔ its note; with a count, that percent of the document'},
  {keys:'zz',when:inDoc,run:()=>visual.align('middle'),group:R,display:'z z / z t / z b',help:'Put the current place (find match, jump or cursor) in the middle / at the top / at the bottom of the window'},
  {keys:'zt',when:inDoc,run:()=>visual.align('top')},
  {keys:'zb',when:inDoc,run:()=>visual.align('bottom')},
  {keys:'/',run:()=>openFind(),group:R,help:'Find inside the open document'},
  {keys:'n',run:({count})=>{jumps.record();nextFind(Math.max(1,count));},group:R,display:'n / N',help:'Next / previous occurrence, including a search’s matches'},
  {keys:'N',run:({count})=>{jumps.record();nextFind(-Math.max(1,count));}},
  {keys:'q',run({event}){const offered=event?.target.closest?.('[data-path]');if(offered?.dataset.path?.startsWith('library/'))queue.add(offered.dataset.path);else toast('Press q on a document in a list, or on a Read next item, to queue it.');},group:R,help:'Add the focused document (Read next, files, home lists) to your queue'},
  {keys:'h',when:()=>state.cursor>0,run:()=>goBack(),group:R,display:'h l',help:'Reading history; previous / next spread in two-page mode'},
  {keys:'l',when:()=>state.cursor<state.visits.length-1,run(){state.cursor++;navigate(state.visits[state.cursor],{record:false});history.replaceState({reader:true,path:state.visits[state.cursor]},'',routeHash(state.visits[state.cursor]));}},
  {keys:'?',run:inShell('?',()=>openHelp()),group:R,help:'This map of keys'},
  {keys:':',run:()=>keys.openLine(),group:R,help:'Type a command in the status line (see Command line below)'},
  // Marks, jumps and lists.
  {keys:'m{a-z}',run:({args})=>marks.set(args[0]),group:M,display:'m a–z',help:'Mark your place in this edition'},
  {keys:"'{mark}",run:({args})=>marks.jump(args[0]),group:M,display:"' a–z / ' '",help:'Return to a mark; `\'` `\'` returns to where you were before the last jump'},
  {keys:'<C-o>',run:({count})=>jumps.back(count),group:M,display:'Ctrl o / Ctrl i',help:'Back / forward through the places you jumped from, across documents'},
  {keys:'<C-i>',run:({count})=>jumps.forward(count)},
  {keys:']q',when:()=>quickfix.active(),run:({count})=>quickfix.step(1,count),group:Q,display:'] q / [ q',help:'Next / previous location in the list (:grep, more like this)'},
  {keys:'[q',when:()=>quickfix.active(),run:({count})=>quickfix.step(-1,count)},
  // Keys that panels and pages handle themselves, listed here so the help is complete.
  {keys:'',group:R,display:'Escape',help:'Return your attention to the page; in VISUAL or the command line, one step back toward NORMAL'},
  {keys:'',group:P,display:'Tab Enter',help:'On a diagram: open it full size'},
  {keys:'',group:P,display:'← → / ↑ ↓ / Enter',help:'On a focused article shape (`g c` then `Tab` on the homepage, or after `Space g`): passages / related works / open'},
  {keys:'',group:P,display:'j k',help:'In Files, the queue, versions, margins, lists and the Activity transcript: next / previous item; `Enter` opens it'},
  {keys:'',group:P,display:'h l / q',help:'In Files: close / open folders; queue the focused document'},
  {keys:'',group:P,display:'J K / x / p',help:'In the queue: reorder, remove, pin'},
  {keys:'',group:P,display:'Ctrl r a',help:'In a reply, comment or chat box, or the scratch pad in insert mode: paste register a (or `"`) as a quoted citation'},
  // Split view (RW-32): Ctrl-w, or Space W, then one key. A pane forwards them to the shell, which owns the layout.
  ...[['v','side by side','Split the window side by side / stacked (up to four panes); the new pane opens the file picker, `Esc` keeps the document','v / s'],['s','stacked'],
    ['w','next','Next / previous pane','w / W'],['W'],['h','left','The pane to the left, below, above, right','h / j / k / l'],['j','below'],['k','above'],['l','right'],
    ['x','swap','Swap with the next pane / equal sizes','x / ='],['=','equal'],['o','only','Keep only this pane / close it','o / q'],['q','close'],
    ['f','link','Open the focused link in the other pane (or Shift-click a link)','f']].flatMap(([key,hint,help,display])=>{
      return [{keys:'<C-w>'+key,run:()=>windowCommand(key),hint,group:W,...(help?{help,display:display.split(' / ').map(part=>'Ctrl w '+part).join(' / ')}:{})}];
    }),
  // The scratch pad's editor handles its own keys (CodeMirror Vim); listed here so the help is complete.
  {keys:'',group:X,display:'i / Esc Esc',help:'Insert; `Esc` back to normal, a second `Esc` leaves the editor'},
  {keys:'',group:X,display:':w / :write vault',help:'Keep the draft on this device / save it to the vault as your own writing'},
  {keys:'',group:X,display:':preview / :drafts',help:'Side by side, Source or Preview layout / the Drafts panel'},
  {keys:'',group:X,display:':cite / Ctrl r a',help:'Quote your last selection / register a (in insert mode) as a cited block'},
  {keys:'',group:X,display:':enew / :e scratch',help:'A new buffer / the latest draft (`:e scratch=<id>` a given one); these also work from the page command line'},
);
// Ctrl-r {register} in a writing box pastes the citation; the queue panel's keys come before the table.
let pasteInto=null;
keys.intercept(event=>queue?.handleKey(event));
// After Ctrl-w, Ctrl held for the second key works too (Ctrl-w Ctrl-v, Ctrl-w Ctrl-w), as in Vim.
keys.intercept(event=>{
  if(keys.pending().keys[0]!=='<C-w>'||!event.ctrlKey||event.metaKey||event.altKey||!/^[a-z]$/.test(event.key))return false;
  event.preventDefault();keys.feed(event.key,event);return true;
});
// While split, the shell keeps only the leader, ?, : and Ctrl keys; any other key returns focus to the focused pane.
keys.intercept(event=>{
  if(!split?.active()||event.ctrlKey||event.metaKey||event.altKey||typing(event)||keys.mode()!=='normal'||keys.pending().keys.length)return false;
  if([' ',',','?',':','Escape','F10','Shift','Control','Alt','Meta','CapsLock'].includes(event.key))return false;
  if(!$('#queue-panel').hidden||chatOpen()||document.querySelector('dialog[open]'))return false;
  event.preventDefault();split.refocus();return true;
});
keys.intercept(event=>{
  if(['Shift','Control','Alt','Meta','CapsLock'].includes(event.key))return false;
  if(pasteInto){const target=pasteInto;pasteInto=null;$('#status-pending').hidden=true;
    if(event.target===target&&/^[a-z"]$/.test(event.key)&&!event.ctrlKey&&!event.metaKey){event.preventDefault();registers.paste(event.key,target);return true;}
    if(event.key==='Escape'){event.preventDefault();return true;}return false;}
  if(event.ctrlKey&&!event.metaKey&&!event.altKey&&event.key==='r'&&event.target.matches?.('textarea')){event.preventDefault();pasteInto=event.target;const hint=$('#status-pending');hint.textContent='Ctrl r';hint.hidden=false;return true;}
  return false;
});
document.addEventListener('keydown',event=>keys.handle(event));
// Read-only introspection of the table (tests, extensions): every mapped sequence and command.
Object.defineProperty(window,'readerKeymap',{value:Object.freeze({listed:()=>keys.listed(),commands:()=>keys.commands()})});
// Commands for the `:` line. Each maps to an existing action; features add theirs with keys.command().
const prefixed=(list,typed)=>list.filter(item=>item.startsWith(typed));
const JOBS={search:'search',keywords:'search-keyword',browse:'browse',catalog:'catalog',links:'links'};
const SPEAK={article:'article',here:'from',from:'from',selection:'selection'};
/** A document route for a fuzzy name, as :open finds it; null (with a toast) when nothing matches. */
async function fuzzyRoute(text){
  const draft=SCRATCH_ROUTE.exec(text);if(draft)return draft[1]?'#scratch='+draft[1].toLowerCase():'#scratch';
  const known=state.data?.works.find(w=>w.primary===text);if(known)return '#read='+param(known.primary);
  const {results}=await api('/api/search?q='+param(text)+'&mode=fuzzy&participant='+param(state.prefs.participant));
  if(!results?.length){toast(`No document matches “${text}”.`);return null;}
  return '#read='+param(results[0].path||results[0].primary);
}
const SCRATCH_ROUTE=/^scratch(?:=([0-9a-f-]{36}))?$/i;
async function openFuzzy(text){
  if(!text){openPicker('all');return;}
  // :e scratch opens the latest scratch draft; :e scratch=<id> a given one.
  const draft=SCRATCH_ROUTE.exec(text);if(draft){navigate(draft[1]?SCRATCH+'='+draft[1].toLowerCase():SCRATCH);return;}
  const known=state.data?.works.find(w=>w.primary===text);if(known){navigate(known.primary);return;}
  const {results}=await api('/api/search?q='+param(text)+'&mode=fuzzy&participant='+param(state.prefs.participant));
  if(!results?.length){toast(`No document matches “${text}”.`);return;}
  navigate(results[0].path||results[0].primary);
}
/** Tab completion for a document name (:open, :vsplit). */
async function completeDocument(typed){if(!typed.trim())return (state.data?.recent||[]).slice(0,12).map(w=>({value:w.primary,label:w.title}));try{const {results}=await api('/api/search?q='+param(typed)+'&mode=fuzzy&participant='+param(state.prefs.participant));return results.slice(0,12).map(w=>({value:w.path||w.primary,label:w.title}));}catch{return [];}}
keys.command({name:'open',aliases:['e','edit'],args:'<document>',help:'Open a document by fuzzy title, author or path (`:e scratch` the scratch pad); without a name, the stacks',
  complete:completeDocument,
  run:openFuzzy});
keys.command({name:'shape',help:'Data view: show or hide the open article’s shape (its passages through meaning-space)',run:()=>toggleShape()});
keys.command({name:'art',help:'Show or hide the open article’s art, as `Space g`',run:()=>toggleArt()});
keys.command({name:'art-focus',help:'Focus on the art full screen (Esc returns), as `Space G`',run:()=>focusShownArt()});
keys.command({name:'generate-art',help:'Commission new art for the open article (a background job; the current art is kept)',run:()=>{if(state.doc&&TEXTUAL.test(state.doc.path)&&!state.doc.preview)commissionArt(state.doc.path);else toast('Open a Markdown or text article to make art for it.');}});
keys.command({name:'enew',help:'A new scratch pad buffer',run:()=>navigate(SCRATCH+'='+crypto.randomUUID())});
const SPLIT_DIRS={vsplit:['row','v'],split:['col','s']};
for(const [name,[dir,key]] of Object.entries(SPLIT_DIRS))keys.command({name,aliases:name==='vsplit'?['vs','vsp']:['sp'],args:'[document]',
  help:name==='vsplit'?'Split the window side by side; with a document, open it in the new pane':'Split the window stacked; with a document, open it in the new pane',
  complete:completeDocument,
  async run(text){
    if(!text){windowCommand(key);return;}
    const route=await fuzzyRoute(text);if(!route)return;
    if(pane){pane.post({type:'window-key',key,route});return;}
    if(split.active())split.split(dir,{route,picker:false});else split.start(dir,cleanRoute(location.hash),{route}).catch(report);
  }});
const SCROLLBIND={scrollbind:true,scb:true,noscrollbind:false,noscb:false,'scrollbind!':'toggle','scb!':'toggle','invscrollbind':'toggle'};
keys.command({name:'set',args:'[scrollbind|noscrollbind]',help:'`:set scrollbind` scrolls the focused pane with its neighbor, `:set noscrollbind` stops; without an option, Behind the scenes',
  complete:typed=>prefixed(['scrollbind','noscrollbind','scrollbind!'],typed),
  run(text){
    if(!text){openPreferences();return;}
    if(!(text in SCROLLBIND)){toast(`Unknown option: ${text}. Try :set scrollbind or :set noscrollbind.`);return;}
    const value=SCROLLBIND[text],key=value==='toggle'?'scrollbind!':value?'scrollbind':'noscrollbind';
    if(pane){pane.post({type:'window-key',key});return;}
    if(!split.active()){toast('There is one pane. :vsplit or Ctrl-w v splits the window.');return;}
    split.command(key);
  }});
keys.command({name:'theme',aliases:['colorscheme'],args:'<id>',help:'Switch the theme, for example `:theme paper`',
  complete:typed=>prefixed([...new Set([...THEMES,...themeCache.ids])].sort(),typed),
  run(id){if(!id){toast('The theme is '+state.prefs.theme+'.');return;}if(!knownTheme(id)){const near=keysClosest(id,[...THEMES,...themeCache.ids]);toast(`No theme called ${id}.`+(near?` Did you mean ${near}?`:''));return;}useTheme(id);}});
keys.command({name:'layout',args:'scroll|spread',help:'Continuous or two-page reading',complete:typed=>prefixed(['scroll','spread'],typed),
  run(mode){if(!['scroll','spread'].includes(mode)){toast('Use :layout scroll or :layout spread.');return;}if(state.prefs.layout!==mode)$('#layout-swap').click();}});
keys.command({name:'speak',args:'[article|here|selection]',help:'Send to AI-TTS: the whole article, from here, or the selection; without a scope, the menu',complete:typed=>prefixed(['article','here','selection'],typed),
  run(scope){if(!scope){speech.openMenu();return;}if(!SPEAK[scope]){toast('Use :speak article, here or selection.');return;}if(SPEAK[scope]==='selection'&&visual.active()){visual.speak();return;}speech.send(SPEAK[scope]);}});
keys.command({name:'rebuild',args:'search|keywords|browse|catalog|links',help:'Rebuild an index, as on Behind the scenes',complete:typed=>prefixed(Object.keys(JOBS),typed),
  run(kind){if(!JOBS[kind]){toast('Rebuild what? search, keywords, browse, catalog or links.');return;}startJob(JOBS[kind]);}});
keys.command({name:'check',help:'Check whether the indexes are fresh',run:()=>startJob('check')});
keys.command({name:'changes',aliases:['diff'],help:'What changed since you read it, or against the newer version',run:()=>changesShortcut()});
keys.command({name:'versions',aliases:['editions','edition'],help:'Every edition of this document and its history',run:()=>openEditions()});
keys.command({name:'outline',aliases:['toc'],help:'Show or hide the document outline',run:()=>outline.toggle()});
keys.command({name:'chat',help:'Chat with the voices about this document',run:()=>{if(!chatOpen())toggleChat();}});
keys.command({name:'threads',aliases:['margins'],help:'This document’s margin threads',run:()=>openThreadList()});
keys.command({name:'queue',help:'Your reading queue',run:()=>queue.toggle()});
keys.command({name:'next',help:'The next document in your queue',run:()=>queue.next()});
keys.command({name:'home',help:'Your homepage',run:()=>navigate(null)});
keys.command({name:'files',aliases:['ls'],help:'The stacks: every document, by folder',run:()=>openPicker('all')});
keys.command({name:'search',args:'[words]',help:'Search every passage; with words, search for them',run(text){if(!text){openSearch();return;}location.hash='#search='+param(new URLSearchParams({q:text.slice(0,1000)}).toString());}});
keys.command({name:'backstage',aliases:['settings'],help:'Behind the scenes: indexes, statistics and settings',run:()=>openPreferences()});
keys.command({name:'zen',help:'Hide or reveal the reading chrome',run:()=>{closeContext();reading.toggleZen();}});
keys.command({name:'colors',help:'Next prose color strength for this document',run:()=>prose.press()});
keys.command({name:'find',args:'<words>',help:'Find inside the open document',run:async text=>{if(!state.doc){toast('Open a document to find in it.');return;}if(!text){openFind();return;}$('#find-query').value=text;await updateFind();if(state.find.length){jumps.record();showFind();}else toast(`“${text}” is not in this document.`);}});
keys.command({name:'nohlsearch',aliases:['noh'],help:'Clear the find highlights',run:()=>clearFind()});
keys.command({name:'grep',args:'<words>',help:'Passages across the library with these words, as a location list (`]q` steps through it)',run:text=>quickfix.grep(text||visual.text())});
keys.command({name:'copen',aliases:['cw','cwindow','clist'],help:'Show the location list',run:()=>panels.open('quickfix')});
keys.command({name:'cclose',help:'Hide the location list',run:()=>panels.close()});
keys.command({name:'cnext',aliases:['cn'],help:'Next location',run:()=>quickfix.step(1)});
keys.command({name:'cprev',aliases:['cp','cprevious'],help:'Previous location',run:()=>quickfix.step(-1)});
keys.command({name:'cclear',help:'Empty the location list',run:()=>quickfix.clear()});
keys.command({name:'marks',help:'Your marks, in this document first',run:()=>panels.open('marks')});
keys.command({name:'registers',aliases:['reg','display','di'],help:'What you have yanked, with citations',run:()=>panels.open('registers')});
keys.command({name:'help',aliases:['h'],args:'[command]',help:'This map; `:help grep` jumps to a command',complete:typed=>prefixed(keys.commands(),typed),run:topic=>openHelp(topic)});
$('#status-qf').onclick=()=>panels.open('quickfix');
function openHelp(topic=''){
  openDialog('help');
  const row=topic&&$(`#help [data-command="${CSS.escape(topic.replace(/^:/,''))}"]`);
  if(row){row.scrollIntoView({block:'center'});row.classList.add('help-target');setTimeout(()=>row.classList.remove('help-target'),1800);}
}
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
/** One window key (Ctrl-w v s w W h j k l x = o q f, and scrollbind from :set): a pane forwards it to the shell. */
function windowCommand(key){
  if(key==='f'){linkInSplit().catch(report);return;}
  if(pane){pane.post({type:'window-key',key});return;}
  if(split.active()){split.command(key);return;}
  if(key==='v'||key==='s'){startSplit(key==='v'?'row':'col');return;}
  if(['w','W','h','j','k','l','x','=','o','q','scrollbind','noscrollbind','scrollbind!'].includes(key))toast('There is one pane. Ctrl-w v or Ctrl-w s splits the window.');
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
  // The shell's own keymap state (Ctrl-w, the leader, the command line) comes before the pane's mode.
  const owned=keys.status(),mode=owned?.mode||focused.status?.mode||'NORMAL';
  $('#vim-mode').textContent=mode;$('#vim-mode').dataset.mode=mode;
  $('#status-keys').innerHTML=owned?owned.keys:'<kbd>Ctrl-w w</kbd> next pane <kbd>Ctrl-w v</kbd> <kbd>s</kbd> split <kbd>Ctrl-w q</kbd> close';
  breadcrumbs.update(focused.status?.path??null);$('#status-position').textContent=focused.status?.position||'';
  const indicator=$('#split-indicator');indicator.hidden=false;indicator.textContent=`${focused.number}/${focused.count}${focused.bound?' ⇅':''}`;
  indicator.title=`Pane ${focused.number} of ${focused.count}${focused.bound?', scrolling with its neighbor':''}`;
  return true;
}
function goBack(){
  if(state.cursor>0){state.cursor--;const path=state.visits[state.cursor];navigate(path,{record:false});history.replaceState({reader:true,path},'',routeHash(path));}
  else navigate(null);
}
function openSearch(){if(state.view==='search')search.focus();else navigate(SEARCH);}
window.addEventListener('resize',()=>{clearTimeout(positionPins.timer);positionPins.timer=setTimeout(()=>{refreshScroll();positionPins();},120);});
document.fonts.ready.then(()=>{refreshScroll();positionPins();});
reduced.addEventListener('change',resetScroll);
search=installSearch({api,state,navigate,back:goBack,backstage:()=>navigate(BACKSTAGE),notify,queue:path=>queue.add(path)});
installStatusPriority($('#statusline'));
const breadcrumbs=installBreadcrumbs({container:$('#status-location'),home:()=>navigate(null),openFolder:folder=>openPicker('all',folder),onChange:()=>reading?.updateStatus()});
controls=installControls({seek:fraction=>reading.seek(fraction),spread:index=>reading.seekSpread(index),thread:id=>{const hit=state.ranges.find(entry=>entry.thread.id===id);if(hit)moveToRange(hit.range);openThread(id);},theme:()=>{state.prefs.theme=oppositeTheme(state.prefs.theme);document.documentElement.dataset.theme=state.prefs.theme;savePrefs();reading.updateStatus();},save:applyPreferences,error:report,outlineToggle:()=>outline.toggle(),outlineOpen:open=>outline.setOpen(open),outlineGo:index=>outline.go(index),themeEditor:setThemeEditorOpen,api,themesChanged,useTheme,previewFont,chatMarkdown,openPath:path=>navigate(path),chatChanged:()=>reading?.updateStatus(),
  open:path=>navigate(path),libraryChanged:async()=>{await loadLibrary();if(!state.doc&&state.view!=='backstage')renderHome();},
  markdown:text=>{const template=document.createElement('template');template.innerHTML=DOMPurify.sanitize(window.markdownit({html:false,linkify:true}).render(text),{USE_PROFILES:{html:true}});decorateCodeBlocks(template.content,{wrap:true,lineNumbers:false});return template.innerHTML;}},state.prefs);
speech=installSpeech({state,api,reading:{capture:()=>reading.capture(),hasBook:()=>reading.hasBook()},notify,track:trackSpeech,openDialog,closeDialog,companion:promptCompanion});
prose=installProseColors({state,api,notify,companion:promptCompanion});
queue=installQueue({state,api,navigate,notify,needsReader,renderPanel:renderQueuePanel,focusMain:()=>focusMain(),onChange:()=>reading?.updateStatus()});
queue.setCloseOthers(()=>{$('#thread-panel').hidden=true;state.activeThread=null;});
reading=installReading({statusOverride:()=>{const on=!!split?.active();if(!on)$('#split-indicator').hidden=true;return on&&paintSplitStatus();},onStatus:()=>pane&&paneStatus(),mayCurl:()=>!pane||pane.focused(),scratchStatus:()=>state.view==='scratch'?scratch?.status():null,controls,updateBreadcrumbs:path=>breadcrumbs.update(path),state,api,toast,openPreferences,openThread,revealRange:moveToRange,scrollToPosition,savePrefs,reloadDocument:()=>navigate(state.doc.path,{record:false}),positionPins,keyStatus:()=>keys.status()});
outline=installOutline({state,reading,$,controls,scrollToPosition,savePrefs,notify});
links=installLinks({state,api,reading,navigate,openBackstage:()=>navigate(BACKSTAGE)});
scratch=installScratch({state,api,notify,navigate,focusMain:()=>$('#main').focus({preventScroll:true}),updateStatus:()=>reading?.updateStatus(),openChat,registers:()=>registers,
  // A draft has no file yet: its links resolve from the notebook folder it saves into (the server accepts a folder source).
  renderMarkdown:(container,text)=>renderMarkdown(container,text,'library/notebook/',0)});
versions=installVersions({state,api,navigate:ref=>navigate(ref),openCompare:openComparison,openSideBySide:(older,newer)=>{if(pane)pane.post({type:'open-in-split',compare:{a:older,b:newer}});else split.compare(older,newer,cleanRoute(location.hash)).catch(report);},notify,param,onChange:()=>reading?.updateStatus()});
if(EMBEDDED)pane=installPane({open:openRoute,save:()=>reading.save(),onFocus:paneFocus,
  reveal:element=>{if(!reading.hasBook())return false;const range=document.createRange();range.selectNodeContents(element);return reading.reveal(range,false);},
  scrollBy:delta=>{if(Math.abs(delta)>=1)scrollToPosition(scrollY+delta,false);},seek:fraction=>reading.seek(fraction,false),docFraction:()=>reading.progress()});
else{
  split=installSplit({notify,api,param,paint:()=>reading?.updateStatus(),suspend:suspendShell,resume:resumeShell});
  split.setShellCommands({'?':()=>openHelp(),m:toggleChat,r:()=>queue.toggle(),n:()=>queue.next()});
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
// A docked panel narrows continuous reading: keep the line at the reading line (22% down) in view.
installDock({
  before(){
    const article=$('#article');if(!article||reading?.hasBook()||split?.active())return null;
    const list=[...article.children].filter(el=>!el.classList.contains('annotation-pin')),line=innerHeight*.22;
    let lo=0,hi=list.length-1;if(hi<0)return null;
    while(lo<hi){const mid=(lo+hi)>>1;if(list[mid].getBoundingClientRect().bottom>line)hi=mid;else lo=mid+1;}
    const rect=list[lo].getBoundingClientRect();return {el:list[lo],line,fraction:rect.height?Math.max(0,Math.min(1,(line-rect.top)/rect.height)):0};
  },
  after(kept){
    if(!kept?.el.isConnected)return;const rect=kept.el.getBoundingClientRect(),shift=rect.top+rect.height*kept.fraction-kept.line;
    if(Math.abs(shift)>1)scrollToPosition(scrollY+shift,false,kept.el,kept.fraction);
  }});
mountSkeleton($('#main'),'library');
loadThemes();
try{await loadLibrary();
  if(!EMBEDDED&&location.hash.startsWith('#split=')){state.view='split';reading.prepare();await suspendShell();if(split.restore(location.hash))throw SPLIT;history.replaceState(null,'',location.pathname+location.search);}
  if(EMBEDDED&&new URLSearchParams(location.search).has('picker')){const url=new URL(location.href);url.searchParams.delete('picker');history.replaceState(null,'',url);state.pickerAfterBoot=true;}
  const path=routeFromHash();if(path){state.visits=[path];const heading=routeHeading();if(location.hash.startsWith('#read='))history.replaceState(history.state,'',location.pathname+location.search+routeHash(path,passageFromHash(),heading));await navigate(path,{record:false,at:passageFromHash(),fragment:heading});}else {state.view='issue';reading.prepare();await renderHome();}
  if(state.pickerAfterBoot){state.pickerAfterBoot=false;openPicker();}}
catch(error){if(error!==SPLIT){clearControlsWithin($('#main'));$('#main').innerHTML='<div class="loading-state"><span class="brand-mark">r.</span><h2>The stacks couldn’t open.</h2><p id="load-error"></p></div>';$('#load-error').textContent=error.message;}}
