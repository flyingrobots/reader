import { annotationExtension, annotationClass, annotationTitle, annotationsChanged, locateQuote, type Thread } from './annotations.ts';
import type { EditorView } from '@codemirror/view';
import { createHash } from 'node:crypto';
import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SpeechClient, speechAllowed, type SpeechStatus } from './tts.ts';
import { FileSystemAdapter, FileView, MarkdownView, ItemView, Menu, Modal, Notice, Platform, Plugin, PluginSettingTab, Scope, Setting, TFile, normalizePath, parseLinktext, setIcon } from 'obsidian';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { CachedMetadata, WorkspaceLeaf } from 'obsidian';
import { RelationshipIndex, editorialKind, filterRows, firstDate, inboxItems, matchingParts, libraryPath, validId } from './model.ts';
import type { Association, Citation, DateMode, DocumentRecord, ResultRow } from './model.ts';
const VIEW = 'reader-view';
type SeenItem = {key:string;version:string;kind:string;path:string;thread_id?:string;revision?:number;read:boolean;seen_by:{participant:string;at:string}[]};
type HighlightSelection = { file: TFile; selected: string; start?: number; source?: string };

export default class ReaderPlugin extends Plugin {
  annotationEditors = new Set<EditorView>();
  private annotationCache = new Map<string, Thread[]>();
  private annotationRequests = new Map<string, number>();
  private annotationLoading = new Map<string,Promise<void>>();
  annotationError = '';
  attentionError = '';
  unreadDiscussions: {thread_id:string;path:string;revision:number;unread:number}[] = [];
  unreadTotal=0;
  private attentionPolling=false;
  private automaticReads=new Map<string,Promise<void>>();
  private attention = new Map<string,SeenItem[]>();
  private attentionVersions = new Map<string,number>();
  activeThread?: string;
  speech = new SpeechClient();
  index = new RelationshipIndex([]);
  loading = true;
  errors = new Map<string, string>();
  current: TFile | null = null;
  documentLeaf: WorkspaceLeaf | null = null;
  dateMode: DateMode = 'arrival';
  private searches = new Set<ChildProcess>();
  private readerSettings: { backendRoot?: string; openedOnce?: boolean; dateMode?: DateMode; codexPath?: string; readDocuments?: Record<string, string>; participant?: string } = {};
  inbox: string[] = [];
  inboxRun?: { run_id?: string; status: string; supervisor_pid?: number; message: string };
  private inboxRefreshing = false;
  private launchingInbox = false;
  private launchError = '';
  private inboxLaunchTimer?: number;
  private records = new Map<string, DocumentRecord>();
  private receipts = new Map<string, Association>();
  private arrivals = new Map<string, { date: string; paths: string[] }>();
  private pending = new Set<string>();
  private full = true;
  private running = false;
  private disposed = false;
  private timer: number | undefined;
  private initialized = false;
  async onload() {
    this.registerEditorExtension(annotationExtension(this));
    this.registerInterval(window.setInterval(()=>void this.refreshAttention(),10000));
    this.addCommand({id:'highlight-selection',name:'Highlight selection and comment',editorCallback:()=>void this.highlightSelection()});
    this.registerEvent(this.app.workspace.on('editor-menu',(menu,editor,info)=>{
      const file=info.file,selected=editor.getSelection();
      if(!file || !libraryPath(file.path) || !/^(md|markdown)$/i.test(file.extension) || !selected.trim())return;
      const snapshot={file,selected,start:editor.posToOffset(editor.getCursor('from')),source:editor.getValue()};
      menu.addItem(item=>item.setTitle('Highlight and comment in Reader').setIcon('highlighter').onClick(()=>void this.highlightSelection(snapshot)));
    }));
    this.registerDomEvent(document,'contextmenu',event=>{
      const target=event.target;
      if(event.defaultPrevented || !(target instanceof Element) || !target.closest('.markdown-preview-view'))return;
      for(const leaf of this.app.workspace.getLeavesOfType('markdown')){
        if(!(leaf.view instanceof MarkdownView) || leaf.view.getMode()!=='preview' || !leaf.view.containerEl.contains(target))continue;
        const snapshot=this.captureHighlight(leaf.view);
        if(!snapshot)return;
        event.preventDefault();
        const menu=Menu.forEvent(event).setUseNativeMenu(false);
        // Reading-view text normally gets Electron's native selection menu, not
        // Obsidian's editor-menu event. Preserve its text actions in this menu.
        const desktop=window as Window & { electron?: { clipboard?: { writeText(text: string): void }; remote?: { getCurrentWebContents(): { showDefinitionForSelection(): void } } } };
        const remote=desktop.electron?.remote;
        if(Platform.isMacOS && remote){
          const label=snapshot.selected.trim();
          menu.addItem(item=>item.setTitle(`Look Up “${label.length>40?label.slice(0,39).trim()+'…':label}”`).setIcon('library')
            .onClick(()=>remote.getCurrentWebContents().showDefinitionForSelection()));
        }
        menu.addItem(item=>item.setTitle('Copy').setIcon('copy').onClick(()=>{
          if(desktop.electron?.clipboard){desktop.electron.clipboard.writeText(snapshot.selected);return;}
          void navigator.clipboard.writeText(snapshot.selected).catch(error=>new Notice(`Cannot copy selection: ${String(error)}`));
        }));
        menu.addSeparator();
        menu.addItem(item=>item.setTitle('Highlight and comment in Reader').setIcon('highlighter').onClick(()=>void this.highlightSelection(snapshot)));
        return;
      }
    });
    this.registerMarkdownPostProcessor(async(el,ctx)=>{
      if (!libraryPath(ctx.sourcePath)) return;
      await this.loadAnnotations(ctx.sourcePath,false);
      const section=ctx.getSectionInfo(el);if(!section)return;
      for(const thread of this.threadsFor(ctx.sourcePath)) {
        if(thread.resolved)continue;
        const range=locateQuote(section.text,thread.anchor);if(!range)continue;
        const line=section.text.slice(0,range.from).split('\n').length-1;
        if(line<section.lineStart || line>section.lineEnd)continue;
        const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const nodes: Text[]=[];let node;
        while(node=walker.nextNode())if(node.parentElement && !node.parentElement.closest('.reader-highlight,button,script,style'))nodes.push(node as Text);
        const text=nodes.map(n=>n.data).join('');const quote=thread.anchor.quote;
        const start=text.indexOf(quote);if(start<0 || text.indexOf(quote,start+1)>=0)continue;
        let offset=0,last: HTMLElement | undefined;
        for(const node of nodes){
          const from=Math.max(0,start-offset),to=Math.min(node.length,start+quote.length-offset);offset+=node.length;
          if(to<=from)continue;
          const selection=document.createRange();selection.setStart(node,from);selection.setEnd(node,to);
          const mark=document.createElement('mark');mark.className=annotationClass(thread,this.participant());
          mark.title=annotationTitle(thread);mark.dataset.readerThread=thread.id;
          mark.onclick=()=>void this.openThread(thread.id);selection.surroundContents(mark);last=mark;
        }
        if(last){const icon=document.createElement('button');icon.className='reader-comment-icon';setIcon(icon,thread.kind==='warning'?'message-square-warning':'message-square');icon.setAttribute('aria-label',`Open ${thread.owner}’s ${thread.kind==='warning'?'warning':'comment'} thread`);icon.onclick=()=>void this.openThread(thread.id);last.after(icon);}
      }
    });
    this.registerInterval(window.setInterval(() => void this.refreshInbox(), 2000));
    this.registerView(VIEW, leaf => new ReaderView(leaf, this));
    this.addSettingTab(new ReaderSettings(this));
    this.addCommand({ id: 'open-sidebar', name: 'Open sidebar', callback: () => void this.open() });
    this.addCommand({ id: 'refresh-links', name: 'Refresh document links', callback: () => this.schedule(undefined, true) });
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => this.follow(leaf)));
    this.registerEvent(this.app.workspace.on('file-open', () => this.follow(this.app.workspace.activeLeaf)));
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      if (this.documentLeaf && !this.app.workspace.getLeavesOfType(this.documentLeaf.view.getViewType()).includes(this.documentLeaf)) {
        this.current = null; this.documentLeaf = null; this.follow(this.app.workspace.activeLeaf); this.render();
      }
    }));
    this.registerEvent(this.app.metadataCache.on('changed', file => this.schedule(file.path)));
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.schedule(undefined, true)));
    this.registerEvent(this.app.vault.on('create', file => this.schedule(file.path)));
    this.registerEvent(this.app.vault.on('modify', file => this.schedule(file.path)));
    this.registerEvent(this.app.vault.on('delete', file => this.schedule(file.path, true)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { this.pending.add(oldPath); this.schedule(file.path, true); }));
    this.app.workspace.onLayoutReady(() => { void this.initialize().catch(e => new Notice(`Reader: ${String(e)}`)); });
  }
  private async initialize() {
    if (this.disposed) return;
    const data = await this.loadData();
    if (this.disposed) return;
    this.readerSettings = data ?? {};
    this.initialized = true;
    this.follow(this.app.workspace.activeLeaf);
    if (!this.current) {
      const file = this.app.workspace.getActiveFile(); if (file) this.current = file;
    }
    this.dateMode = ['document', 'arrival', 'modified'].includes(data?.dateMode) ? data.dateMode : 'arrival';
    if (!data?.openedOnce) { await this.open(); this.readerSettings.openedOnce = true; await this.saveData(this.readerSettings); }
    this.schedule(undefined, true); void this.refreshInbox();
  }
  private follow(leaf: WorkspaceLeaf | null) {
    if(!this.initialized)return;
    if (leaf?.view instanceof FileView) {
      this.documentLeaf = leaf; this.current = leaf.view.file; this.render(); if(this.current){void this.loadAnnotations(this.current.path);void this.loadAttention(this.current.path);void this.acknowledgeOpen(this.current.path);}
    } else if (leaf && leaf.view.getViewType() === 'empty') {
      this.documentLeaf = null; this.current = null; this.render();
    }
  }
  async open() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) {
      const candidate = this.app.workspace.getRightLeaf(false);
      if (!candidate) { new Notice('Reader could not open the right sidebar.'); return; }
      leaf = candidate; await leaf.setViewState({ type: VIEW, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    this.render();
  }
  schedule(path?: string, full = false) {
    if(full || path?.startsWith('engagement/') || path?.startsWith('annotations/'))void this.refreshAttention();
    if(this.current && (full || path?.startsWith('engagement/') || path?.startsWith('annotations/') || path===this.current.path))void this.loadAttention(this.current.path);
    if(path?.startsWith('annotations/') && this.current)void this.loadAnnotations(this.current.path,true,true);
    if(path===this.current?.path && path)void this.loadAnnotations(path,true,true);
    if (path?.startsWith('inbox/') || full) void this.refreshInbox();
    if (this.disposed || path && !this.eligible(path)) return;
    if (path) this.pending.add(path);
    this.full ||= full;
    if (!this.initialized) return;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = undefined; void this.refresh(); }, 200);
  }
  private eligible(path: string) { return path.startsWith('library/') || path.startsWith('catalog/metadata/'); }
  private async refresh() {
    if (this.disposed || this.running) return;
    this.running = true;
    try {
      do {
        const full = this.full; this.full = false;
        const paths = full ? this.app.vault.getFiles().filter(f => this.eligible(f.path)).map(f => f.path) : [...this.pending];
        this.pending.clear();
        if (full) {
          const known = new Set(paths);
          for (const p of this.records.keys()) if (!known.has(p)) this.records.delete(p);
          for (const p of this.receipts.keys()) if (!known.has(p)) this.receipts.delete(p);
          for (const p of this.arrivals.keys()) if (!known.has(p)) this.arrivals.delete(p);
          for (const p of this.errors.keys()) if (!known.has(p)) this.errors.delete(p);
        }
        // Bounded file reads. The model is rebuilt once per batch, never per tab switch.
        for (let i = 0; i < paths.length && !this.disposed; i += 12) await Promise.all(paths.slice(i, i + 12).map(p => this.readRecord(p)));
        if (this.disposed) return;
        const associations = [...this.receipts.values()];
        const records = new Map([...this.records].map(([path, record]) => [path, { ...record }]));
        for (const { date, paths } of this.arrivals.values()) for (const path of paths) {
          const record = records.get(path); if (record) record.arrivalDate = date;
        }
        for (const record of this.records.values()) if (record.catalogOriginal && !associations.some(a => a.wrapper === record.path)) {
          associations.push({ wrapper: record.path, original: record.catalogOriginal });
        }
        this.index = new RelationshipIndex([...records.values()], associations);
        this.loading = false; this.render();
      } while ((this.pending.size || this.full) && !this.disposed);
    } catch (error) {
      this.errors.set('Reader index', String(error)); this.loading = false; this.render();
    } finally { this.running = false; }
  }
  private async readRecord(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    this.errors.delete(path); this.records.delete(path); this.receipts.delete(path); this.arrivals.delete(path);
    if (!(file instanceof TFile)) return;
    try {
      if (file.name === 'receipt.json' && libraryPath(path)) {
        const receipt = JSON.parse(await this.app.vault.cachedRead(file));
        const document = receipt.document;
        if (receipt.reader_receipt === 1 && typeof document === 'string' && document && !document.startsWith('/') && !document.includes('\\') && !document.split('/').some(p => !p || p === '.' || p === '..')) {
          const dir = path.slice(0, -'receipt.json'.length);
          this.receipts.set(path, { wrapper: dir + 'index.md', original: dir + document });
          const date = firstDate(receipt.received_at);
          if (date) this.arrivals.set(path, { date, paths: [dir + 'index.md', dir + document,
            ...(Array.isArray(receipt.files) ? receipt.files.flatMap((f: {path?: unknown}) => typeof f.path === 'string' && !f.path.startsWith('/') && !f.path.split('/').includes('..') ? [dir + f.path] : []) : [])] });
        }
      }
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter ?? {};
      const title = typeof fm.title === 'string' && fm.title.trim() ? fm.title : file.basename;
      const ownerTarget = path.startsWith('catalog/metadata/') && typeof fm.document_path === 'string' && libraryPath(fm.document_path) ? fm.document_path : undefined;
      const id = validId(fm.document_id) && (ownerTarget || fm.document_path === path) ? fm.document_id : undefined;
      const kind = editorialKind(path, fm.author);
      const wrapper = file.name === 'index.md' && path.split('/').length > 3 && (
        !!id || !!this.app.vault.getAbstractFileByPath(normalizePath(`${file.parent?.path}/receipt.json`)));
      const reading = path.includes('/reading/') && file.extension === 'md';
      const needsText = !!kind || wrapper || reading;
      const text = needsText ? await this.app.vault.cachedRead(file) : '';
      const links = kind || wrapper ? this.citations(path, cache, text) : [];
      const record: DocumentRecord = { path, title, id, ownerTarget, kind, links,
        documentDate: firstDate(fm.report_date, fm.created, fm.date, fm.added),
        arrivalDate: firstDate(fm.added), modified: new Date(file.stat.mtime).toISOString(),
        readingScope: typeof fm.reading_scope === 'string' ? fm.reading_scope : undefined };
      if (wrapper && id) {
        const labels = new Set(['Read the original PDF', 'Original PDF', 'Read the unchanged source', 'Unchanged original', 'Read the original']);
        const originals = new Set(links.filter(l => l.target && labels.has(l.label) && l.target.startsWith(`${file.parent?.path}/`)).map(l => l.target!));
        if (originals.size === 1) record.catalogOriginal = [...originals][0];
      }
      if (fm.kind === 'reading-copy' && typeof fm.reading_source === 'string' && libraryPath(fm.reading_source)) record.original = fm.reading_source;
      if (reading) {
        const heading = text.indexOf('\n# Reading copy\n');
        if (heading >= 0) {
          const introEnd = text.indexOf('\n\n', heading + '\n# Reading copy\n\n'.length);
          const candidates = (cache?.links ?? []).filter(l => l.displayText === 'Unchanged original' && l.position.start.offset > heading && l.position.end.offset <= introEnd);
          if (candidates.length === 1) record.original = this.app.metadataCache.getFirstLinkpathDest(parseLinktext(candidates[0].link).path, path)?.path;
        }
      }
      if (!this.disposed) this.records.set(path, record);
    } catch (error) { if (!this.disposed) this.errors.set(path, String(error)); }
  }
  private citations(path: string, cache: CachedMetadata | null, text: string): Citation[] {
    return (cache?.links ?? []).flatMap(link => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link.link) || link.link.startsWith('//') || link.link.startsWith('#')) return [];
      const target = this.app.metadataCache.getFirstLinkpathDest(parseLinktext(link.link).path, path)?.path ?? null;
      if (target && (!libraryPath(target) || target.endsWith('/receipt.json') || target.endsWith('/SHA256SUMS'))) return [];
      // A cache position preserves citation identity without reparsing Markdown links.
      const line = link.position.start.line;
      const lines = text.split('\n');
      const excerpt = lines.slice(Math.max(0, line - 1), line + 2).join(' ').trim().slice(0, 360);
      return [{ target, link: link.link, label: link.displayText || parseLinktext(link.link).path.split('/').pop() || link.link, line, excerpt }];
    });
  }
  participant(){return this.readerSettings.participant?.trim() || 'You';}
  async setParticipant(value: string){this.readerSettings.participant=value.trim().slice(0,100);await this.saveData(this.readerSettings);this.attention.clear();await this.refreshAttention();if(this.current)await this.loadAttention(this.current.path);this.refreshAnnotationViews();}
  threadsFor(path: string){return this.annotationCache.get(path) ?? [];}
  annotate(request: object): Promise<any> {
    return new Promise((resolve,reject)=>{
      const base=this.basePath();
      const child=execFile(join(this.readerSettings.backendRoot || base,'.venv/bin/reader'),['--root',base,'annotate','-'],{cwd:base,timeout:15000,maxBuffer:8*1024*1024},(error,stdout,stderr)=>{
        this.searches.delete(child);if(error){reject(new Error(stderr || error.message));return;}
        try{resolve(JSON.parse(stdout));}catch(error){reject(error);}
      });
      this.searches.add(child);child.stdin?.end(JSON.stringify(request));
    });
  }
  async loadAnnotations(path: string,render=true,force=false): Promise<void>{
    const pending=this.annotationLoading.get(path);
    if(pending){await pending;if(force)return this.loadAnnotations(path,render,true);return;}
    const request=this.fetchAnnotations(path,render,force).finally(()=>this.annotationLoading.delete(path));
    this.annotationLoading.set(path,request);return request;
  }
  private async fetchAnnotations(path: string,render=true,force=false){
    if(!libraryPath(path) || !/\.(md|markdown)$/i.test(path))return;
    if(!force && this.annotationCache.has(path))return;
    const version=(this.annotationRequests.get(path)??0)+1;this.annotationRequests.set(path,version);
    try{
      const data=await this.annotate({operation:'list',path});
      if(this.disposed || this.annotationRequests.get(path)!==version)return;
      this.annotationCache.set(path,data.threads);this.annotationError='';
      if(render){this.render();this.refreshAnnotationViews();}
    }catch(error){if(!this.disposed){this.annotationError=String(error);if(render)this.render();}}
  }
  private refreshAnnotationViews(){
    for(const editor of this.annotationEditors)editor.dispatch({effects:annotationsChanged.of(null)});
    for(const leaf of this.app.workspace.getLeavesOfType('markdown'))if(leaf.view instanceof MarkdownView)leaf.view.previewMode.rerender(true);
  }
  async revealPassage(thread:Thread){
    if(this.current?.path!==thread.document_path)await this.navigate(thread.document_path,false);
    const view=this.documentLeaf?.view;
    if(!(view instanceof MarkdownView))return;
    (view.containerEl.ownerDocument.activeElement as HTMLElement | null)?.blur();
    this.app.workspace.setActiveLeaf(this.documentLeaf!,{focus:false});
    await new Promise<void>(resolve=>window.setTimeout(resolve,0));
    if(view.getMode()==='source'){
      const range=locateQuote(view.editor.getValue(),thread.anchor);
      if(range){const from=view.editor.offsetToPos(range.from),to=view.editor.offsetToPos(range.to);view.editor.setSelection(from,to);view.editor.scrollIntoView({from,to},true);view.editor.focus();return;}
    }else{
      const mark=view.containerEl.querySelector<HTMLElement>(`[data-reader-thread="${thread.id}"]`);
      if(mark){mark.scrollIntoView({block:'center'});view.containerEl.querySelector<HTMLElement>('.markdown-preview-view')?.focus({preventScroll:true});return;}
    }
    new Notice('This passage cannot be located in this view. Try the editor or inspect the retained quote.');
  }
  async openThread(id: string){
    this.activeThread=id;
    if(this.current)await this.loadAnnotations(this.current.path);
    await this.open();
    for(const leaf of this.app.workspace.getLeavesOfType(VIEW))if(leaf.view instanceof ReaderView)leaf.view.selectTab('discussion');
    const path=this.current?.path,thread=path?this.threadsFor(path).find(t=>t.id===id):undefined;
    if(path && thread)await this.acknowledgeOpen(path,thread);
    for(const leaf of this.app.workspace.getLeavesOfType(VIEW))if(leaf.view instanceof ReaderView)leaf.view.focusReply(id);
  }
  acknowledgeOpen(path:string,thread?:Thread):Promise<void>{
    if(!libraryPath(path))return Promise.resolve();
    const participant=this.participant(),key=`${participant}:${path}:${thread?.id??'document'}:${thread?.revision??''}`;
    const pending=this.automaticReads.get(key);if(pending)return pending;
    const task=(async()=>{
      try{
        const data=await this.annotate({operation:'attention',participant,path});
        if(this.disposed || participant!==this.participant())return;
        let items:SeenItem[]=data.items;
        if(thread){
          if(items.find(i=>i.key==='thread:'+thread.id)?.revision!==thread.revision)return;
          items=items.filter(i=>i.thread_id===thread.id);
        }else items=items.filter(i=>i.key==='document:'+path);
        const unread=items.filter(i=>!i.read);
        if(unread.length)await this.annotate({operation:'seen',participant,items:unread.map(({key,version})=>({key,version}))});
        if(this.disposed || participant!==this.participant())return;
        await this.loadAttention(path);await this.refreshAttention();
      }catch(error){if(!this.disposed){this.attentionError=`Could not mark opened content read: ${String(error)}`;this.render();}}
    })().finally(()=>this.automaticReads.delete(key));
    this.automaticReads.set(key,task);return task;
  }
  private captureHighlight(view: MarkdownView): HighlightSelection | undefined {
    const file=view.file;
    if(!file || !libraryPath(file.path) || !/^(md|markdown)$/i.test(file.extension))return;
    if(view.getMode()==='source'){
      const editor=view.editor,selected=editor.getSelection();
      if(selected.trim())return {file,selected,start:editor.posToOffset(editor.getCursor('from')),source:editor.getValue()};
    }else{
      const selection=view.containerEl.ownerDocument.getSelection();
      const preview=view.containerEl.querySelector('.markdown-preview-view');
      if(selection?.anchorNode && selection.focusNode && preview?.contains(selection.anchorNode) && preview.contains(selection.focusNode)){
        const selected=selection.toString();
        if(selected.trim())return {file,selected};
      }
    }
  }
  async highlightSelection(snapshot?: HighlightSelection){
    snapshot ??= this.documentLeaf?.view instanceof MarkdownView ? this.captureHighlight(this.documentLeaf.view) : undefined;
    if(!snapshot){new Notice('Select a passage in a Markdown library document first.');return;}
    const {file,selected}=snapshot;
    try{
      const text=await this.app.vault.cachedRead(file);
      let start=snapshot.start ?? text.indexOf(selected);
      if(snapshot.source!==undefined && snapshot.source!==text){new Notice('Wait for this document to save, then select the passage again.');return;}
      if(start<0 || text.slice(start,start+selected.length)!==selected || (snapshot.start===undefined && text.indexOf(selected,start+1)>=0)){
        new Notice('Select this passage in the editor to identify its exact source location.');return;
      }
      const request={operation:'create',path:file.path,start:[...text.slice(0,start)].length,end:[...text.slice(0,start+selected.length)].length,
        owner:this.participant(),expected_sha256:createHash('sha256').update(text).digest('hex'),request_id:randomUUID()};
      const modal=new Modal(this.app);modal.modalEl.addClass('reader-annotation-modal');modal.titleEl.setText('Highlight and comment');
      modal.contentEl.createEl('blockquote',{text:selected.slice(0,1200)});
      const kindLabel=modal.contentEl.createEl('label',{text:'Annotation type '});
      const kind=kindLabel.createEl('select',{attr:{'aria-label':'Annotation type'}});
      kind.createEl('option',{value:'highlight',text:'Highlight'});kind.createEl('option',{value:'warning',text:'Warning — concern or possible error'});
      const comment=modal.contentEl.createEl('textarea',{attr:{placeholder:'Add a comment (optional)','aria-label':'Initial comment',rows:'4'},cls:'reader-comment-compose'});
      const status=modal.contentEl.createDiv({attr:{role:'status'}});
      const actions=modal.contentEl.createDiv({cls:'reader-compose-actions'});
      const cancel=actions.createEl('button',{text:'Cancel'});cancel.onclick=()=>modal.close();
      const save=actions.createEl('button',{text:'Save highlight',cls:'mod-cta'});
      kind.onchange=()=>{comment.required=kind.value==='warning';comment.placeholder=comment.required?'Explain the concern and its evidence (required)':'Add a comment (optional)';save.setText(kind.value==='warning'?'Save warning':'Save highlight');};
      save.onclick=()=>{if(kind.value==='warning' && !comment.value.trim()){status.setText('A warning needs a comment explaining the concern.');comment.focus();return;}save.disabled=true;void this.annotate({...request,kind:kind.value,comment:comment.value}).then(async thread=>{
        modal.close();this.activeThread=thread.id;await this.loadAnnotations(file.path,true,true);await this.openThread(thread.id);
      }).catch(error=>{status.setText(String(error));save.disabled=false;});};
      comment.onkeydown=event=>{if(event.key==='Enter' && (event.metaKey || event.ctrlKey)){event.preventDefault();if(!save.disabled)save.click();}};
      modal.scope.register(['Mod'],'Enter',()=>{if(!save.disabled)save.click();return false;});
      modal.open();comment.focus();
    }catch(error){new Notice(String(error));}
  }
  private basePath() {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error('Inbox processing requires a local desktop vault.');
    return adapter.getBasePath();
  }
  inboxActive() { return this.launchingInbox || ['starting','running','interrupted'].includes(this.inboxRun?.status ?? ''); }
  async refreshInbox() {
    if (this.disposed || this.inboxRefreshing) return; this.inboxRefreshing = true;
    const before = JSON.stringify([this.inbox,this.inboxRun,this.launchingInbox,this.launchError]);
    try {
      this.inbox = inboxItems(this.app.vault.getFiles().map(f=>f.path));
      try {
        const data = JSON.parse(await readFile(join(this.basePath(),'.reader/inbox-runner/state.json'),'utf8'));
        if (['starting','running'].includes(data.status) && typeof data.supervisor_pid === 'number') {
          try { process.kill(data.supervisor_pid,0); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') { data.status = 'interrupted'; data.message = 'The inbox runner stopped unexpectedly. Inspect its report and partial changes before retrying.'; } }
        }
        this.inboxRun = data;
        if (data.run_id === this.pendingRun) { this.launchingInbox = false; this.launchError = ''; }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.launchError = `Cannot read inbox run status: ${String(error)}`;
      }
    } finally {
      this.inboxRefreshing = false;
      if (before !== JSON.stringify([this.inbox,this.inboxRun,this.launchingInbox,this.launchError])) this.renderInbox();
    }
  }
  private pendingRun?: string;
  private renderInbox() {
    if (!this.disposed) for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) if (leaf.view instanceof ReaderView) leaf.view.renderInbox();
  }
  inboxMessage() { return this.launchError || (this.launchingInbox ? 'Starting Codex…' : this.inboxRun?.message ?? ''); }
  async processInbox() {
    if (this.inboxActive()) return;
    await this.refreshInbox(); if (this.inboxActive() || !this.inbox.length) return;
    this.launchingInbox = true; this.launchError = ''; this.renderInbox();
    try {
      if (process.platform === 'win32') throw new Error('The inbox runner currently requires macOS or Linux.');
      const base = this.basePath();
      const configured = this.readerSettings.codexPath?.trim();
      const candidates = configured ? [configured] : [...(process.env.PATH ?? '').split(':').filter(Boolean).map(p=>join(p,'codex')),
        join(homedir(),'.local/bin/codex'),join(homedir(),'.cargo/bin/codex'),'/opt/homebrew/bin/codex','/usr/local/bin/codex'];
      let executable: string | undefined;
      for (const path of candidates) { try { await access(path,constants.X_OK); executable = path; break; } catch {} }
      if (!executable) throw new Error('Codex was not found. Set its executable path in Settings → Reader, then run codex login in your terminal.');
      const python = join(this.readerSettings.backendRoot || base,'.venv/bin/python'); await access(python,constants.X_OK);
      this.pendingRun = randomUUID();
      const child = spawn(python,['-m','reader_mcp.inbox_runner','--root',base,'--codex',executable,'--run-id',this.pendingRun],
        { cwd:base, detached:true, stdio:'ignore' });
      child.once('error', error=> { this.launchingInbox = false; this.launchError = String(error); this.renderInbox(); });
      child.unref();
      if (this.inboxLaunchTimer !== undefined) window.clearTimeout(this.inboxLaunchTimer);
      this.inboxLaunchTimer = window.setTimeout(()=> {
        if (this.launchingInbox) { this.launchingInbox = false; this.launchError = 'Codex runner did not report startup. Check the Reader Python installation and run details.'; this.renderInbox(); }
      },10000);
    } catch (error) { this.launchingInbox = false; this.launchError = String(error); this.renderInbox(); }
  }
  async stopInbox() {
    if (!this.inboxActive() || this.launchingInbox) return;
    const runtime = join(this.basePath(),'.reader/inbox-runner'); await mkdir(runtime,{recursive:true});
    await writeFile(join(runtime,'cancel'),'Stop requested by the Obsidian user.\n');
  }
  async showInboxDetails() {
    const modal = new Modal(this.app); modal.titleEl.setText('Inbox processing');
    modal.contentEl.createEl('p',{text:this.inboxMessage() || 'No run recorded.'});
    for (const name of ['last-message.md','stderr.log']) {
      try {
        const text = await readFile(join(this.basePath(),'.reader/inbox-runner',name),'utf8');
        if (text.trim()) { modal.contentEl.createEl('h3',{text:name==='last-message.md'?'Librarian report':'Runner diagnostics'}); modal.contentEl.createEl('pre',{text:text.slice(-16000),cls:'reader-run-report'}); }
      } catch {}
    }
    modal.open();
  }
  codexPath() { return this.readerSettings.codexPath ?? ''; }
  async setCodexPath(value: string) { this.readerSettings.codexPath = value.trim(); await this.saveData(this.readerSettings); }
  async refreshAttention(){
    if(this.disposed || this.attentionPolling)return;this.attentionPolling=true;
    const participant=this.participant();
    try{
      const data=await this.annotate({operation:'attention',participant});
      if(this.disposed || participant!==this.participant())return;
      if(JSON.stringify([data.pending,data.total])!==JSON.stringify([this.unreadDiscussions,this.unreadTotal])){
        this.unreadDiscussions=data.pending;this.unreadTotal=data.total;this.render();
      }
    }catch(error){if(!this.disposed){this.attentionError=String(error);this.render();}}finally{this.attentionPolling=false;}
  }
  seenItem(path:string,key:string){return this.attention.get(path)?.find(i=>i.key===key);}
  discussionItems(path:string,id:string){return this.attention.get(path)?.filter(i=>i.thread_id===id)??[];}
  seenLabel(item?:SeenItem){return item ? (item.seen_by.length ? `Seen by ${item.seen_by.map(p=>p.participant).join(', ')}` : 'Not marked seen yet') : 'Read status not checked';}
  async loadAttention(path:string){
    if(!libraryPath(path))return;
    const participant=this.participant(),version=(this.attentionVersions.get(path)??0)+1;this.attentionVersions.set(path,version);
    try{
      const data=await this.annotate({operation:'attention',participant,path});
      if(this.disposed || participant!==this.participant() || this.attentionVersions.get(path)!==version)return;
      this.attention.set(path,data.items);this.attentionError='';this.render();
    }catch(error){if(!this.disposed){this.attentionError=String(error);this.render();}}
  }
  async markSeen(path:string,items:SeenItem[],read=true){
    if(!items.length)return;
    await this.annotate({operation:'seen',participant:this.participant(),items:items.map(({key,version})=>({key,version})),read});
    await this.loadAttention(path);await this.refreshAttention();
  }
  isRead(path: string) { return this.seenItem(path,'document:'+path)?.read??false; }
  async toggleRead(path: string) {
    if(!this.seenItem(path,'document:'+path))await this.loadAttention(path);
    const item=this.seenItem(path,'document:'+path);if(!item)throw new Error('Read status is unavailable.');
    await this.markSeen(path,[item],!item.read);
  }
  render() { if (!this.disposed) for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) if (leaf.view instanceof ReaderView) leaf.view.render(); }
  async setDateMode(mode: DateMode) { this.dateMode = mode; this.readerSettings.dateMode = mode; await this.saveData(this.readerSettings); this.render(); }
  async navigate(path: string, newTab: boolean, line?: number) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) { new Notice('Reader: this document is missing.'); return; }
    const leaf = newTab ? this.app.workspace.getLeaf('tab') : this.documentLeaf ?? this.app.workspace.getLeaf('tab');
    await leaf.openFile(file, { active: true, eState: line === undefined ? undefined : { line } });
  }
  async openCitation(link: string, source: string, newTab: boolean) {
    if (this.documentLeaf) this.app.workspace.setActiveLeaf(this.documentLeaf, { focus: false });
    await this.app.workspace.openLinkText(link, source, newTab);
  }
  search(query: string, mode: string, done: (error: string | null, result?: SearchResponse) => void): () => void {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) { done('Library search requires a local desktop vault.'); return () => {}; }
    const base = adapter.getBasePath();
    const executable = join(this.readerSettings.backendRoot || base, '.venv', process.platform === 'win32' ? 'Scripts/reader.exe' : 'bin/reader');
    let canceled = false;
    const child = execFile(executable, ['--root', base, 'search', query, '--mode', mode, '--limit', '30'],
      { cwd: base, timeout: 60000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, OMP_NUM_THREADS: '2', TOKENIZERS_PARALLELISM: 'false' } },
      (error, stdout, stderr) => {
        this.searches.delete(child);
        if (canceled || this.disposed) return;
        if (error) { done(`Library search failed. Check Reader search setup and index. ${stderr || error.message}`.slice(0, 1000)); return; }
        try { const data = JSON.parse(stdout); if (!Array.isArray(data.results)) throw new Error('Invalid search response'); done(null, data); }
        catch (e) { done(String(e)); }
      });
    this.searches.add(child);
    return () => { canceled = true; child.kill(); this.searches.delete(child); };
  }
  onunload() { if (this.inboxLaunchTimer !== undefined) window.clearTimeout(this.inboxLaunchTimer); this.speech.dispose(); for (const child of this.searches) child.kill(); this.searches.clear(); this.disposed = true; if (this.timer !== undefined) window.clearTimeout(this.timer); this.pending.clear(); }
}

interface SearchResponse {
  indexed_at?: string; warnings?: string[];
  results: { path: string; excerpt: string; matched_by?: string[]; page?: number; start_line?: number }[];
}
class ReaderView extends ItemView {
  private tab: 'library'|'discussion'|'inbox'='library';
  private panelId='reader-panel-'+randomUUID();
  selectTab(tab:'library'|'discussion'|'inbox'){
    this.tab=tab;this.render();
    const path=this.plugin.current?.path;
    if(tab==='discussion' && path){const thread=this.plugin.threadsFor(path).find(t=>t.id===this.plugin.activeThread);if(thread)void this.plugin.acknowledgeOpen(path,thread);}
  }
  private drafts=new Map<string,string>();
  private sending=new Set<string>();
  private replyErrors=new Map<string,string>();
  focusReply(id:string){
    const draft=this.contentEl.querySelector<HTMLTextAreaElement>(`textarea[data-thread-id="${id}"]`);
    if(draft)this.app.workspace.setActiveLeaf(this.leaf,{focus:false});
    draft?.focus({preventScroll:true});draft?.scrollIntoView({block:'nearest'});
  }
  private replyRequests=new Map<string,{id:string;body:string;parent:string|null}>();
  private replyingTo=new Map<string,string>();
  private inboxEl?: HTMLElement;
  private speechEl?: HTMLElement;
  private speechStatus?: SpeechStatus;
  private voices: string[] = [];
  private voice = '';
  private speechBusy = false;
  private speechMessage = '';
  private polling = false;
  private closed = false;
  private speechTimer?: number;
  private query = '';
  private searchMode = 'hybrid';
  private searchResult?: SearchResponse;
  private searchError = '';
  private searching = false;
  private cancelSearch?: () => void;
  private resultsEl?: HTMLElement;
  plugin: ReaderPlugin;
  constructor(leaf: WorkspaceLeaf, plugin: ReaderPlugin) {
    super(leaf);this.plugin=plugin;this.scope=new Scope(this.app.scope);
    this.scope.register(['Mod'],'Enter',()=>{
      const active=this.contentEl.ownerDocument.activeElement;
      if(!(active instanceof HTMLTextAreaElement) || !this.contentEl.contains(active))return true;
      const send=active.closest('.reader-composer')?.querySelector<HTMLButtonElement>('.mod-cta');
      if(send && !send.disabled)send.click();return false;
    });
  }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Reader'; }
  getIcon() { return 'book-open'; }
  async onOpen() {
    this.closed = false; this.contentEl.addClass('reader-sidebar'); this.render();
    void this.checkSpeech(); this.speechTimer = this.plugin.registerInterval(window.setInterval(() => void this.checkSpeech(), 10000));
  }
  async onClose() { this.closed = true; if (this.speechTimer !== undefined) window.clearInterval(this.speechTimer); this.cancelSearch?.(); this.contentEl.empty(); }
  render() {
    const active=this.contentEl.ownerDocument.activeElement;
    const composing=active instanceof HTMLTextAreaElement && this.contentEl.contains(active) ? {id:active.dataset.threadId,start:active.selectionStart,end:active.selectionEnd,scroll:this.contentEl.scrollTop}:undefined;
    if(composing)queueMicrotask(()=>{const input=this.contentEl.querySelector<HTMLTextAreaElement>(`textarea[data-thread-id="${composing.id}"]`);if(input){input.focus({preventScroll:true});input.setSelectionRange(composing.start,composing.end);this.contentEl.scrollTop=composing.scroll;}});
    let root = this.contentEl; root.empty();
    this.inboxEl=undefined;this.speechEl=undefined;this.resultsEl=undefined;
    const header = root.createDiv({ cls: 'reader-header' });
    header.createEl('h2', { text: 'Reader' });
    const refresh = header.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Refresh Reader links', title: 'Refresh links' } });
    setIcon(refresh, 'refresh-cw'); refresh.onclick = () => this.plugin.schedule(undefined, true);
    const tabs=root.createDiv({cls:'reader-tabs',attr:{role:'tablist','aria-label':'Reader sections'}});
    const names=['library','discussion','inbox'] as const;
    for(const [index,name] of names.entries()){
      const count=name==='inbox'?this.plugin.inbox.length:name==='discussion'?this.plugin.unreadTotal:0;
      const label={library:'Library',discussion:'Discussion',inbox:'Inbox'}[name];
      const button=tabs.createEl('button',{text:count?`${label} · ${count}`:label,attr:{role:'tab',id:`${this.panelId}-${name}`,'data-reader-tab':name,'aria-selected':String(this.tab===name),'aria-controls':this.panelId,tabindex:this.tab===name?'0':'-1'}});
      button.onclick=()=>this.selectTab(name);
      button.onkeydown=event=>{
        const next=event.key==='ArrowRight'?(index+1)%3:event.key==='ArrowLeft'?(index+2)%3:event.key==='Home'?0:event.key==='End'?2:-1;
        if(next<0)return;event.preventDefault();this.selectTab(names[next]);this.contentEl.querySelector<HTMLElement>(`[data-reader-tab="${names[next]}"]`)?.focus();
      };
    }
    root=root.createDiv({cls:'reader-tab-panel',attr:{id:this.panelId,role:'tabpanel','aria-labelledby':`${this.panelId}-${this.tab}`}});
    if(this.tab==='inbox'){this.inboxEl=root;this.renderInbox();return;}
    if(this.tab==='discussion' && this.plugin.unreadTotal){
      const unread=root.createEl('details',{cls:'reader-unread-discussions'});
      unread.createEl('summary',{text:`Unread discussions · ${this.plugin.unreadTotal}`});
      for(const item of this.plugin.unreadDiscussions){
        const button=unread.createEl('button',{text:`${item.path.split('/').pop()} · ${item.unread} unread items`});
        button.onclick=()=>void this.plugin.navigate(item.path,false).then(()=>this.plugin.openThread(item.thread_id));
      }
      if(this.plugin.unreadTotal>this.plugin.unreadDiscussions.length)unread.createEl('p',{text:'Showing the first 100 discussions. Read or mark these to reveal more.'});
    }
    if(this.tab==='discussion'){this.resultsEl=root.createDiv();this.renderResults();return;}
    this.speechEl = root.createDiv(); this.renderSpeech();
    const search = root.createDiv({ cls: 'reader-search' });
    const input = search.createEl('input', { type: 'search', attr: { placeholder: 'Filter names or search the library…', 'aria-label': 'Filter Reader documents by title or path' } });
    input.value = this.query;
    input.oninput = () => { this.cancelSearch?.(); this.searching = false; this.query = input.value; this.searchResult = undefined; this.searchError = ''; this.renderResults(); };
    const controls = search.createDiv({ cls: 'reader-search-controls' });
    const mode = controls.createEl('select', { attr: { 'aria-label': 'Library search mode' } });
    for (const [value, label] of Object.entries({ hybrid: 'Hybrid', semantic: 'Semantic', fuzzy: 'Fuzzy', keyword: 'Keyword' })) mode.createEl('option', { value, text: label });
    mode.value = this.searchMode;
    mode.onchange = () => { this.cancelSearch?.(); this.searching = false; this.searchMode = mode.value; this.searchResult = undefined; this.searchError = ''; this.renderResults(); };
    const submit = controls.createEl('button', { text: 'Search library' });
    const run = () => {
      this.cancelSearch?.(); this.searchResult = undefined; this.searchError = '';
      if (!this.query.trim()) { this.searching = false; this.renderResults(); return; }
      this.searching = true; this.renderResults();
      this.cancelSearch = this.plugin.search(this.query.trim(), this.searchMode, (error, result) => {
        this.searching = false; this.searchError = error ?? ''; this.searchResult = result; this.renderResults();
      });
    };
    submit.onclick = run;
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); run(); } };
    search.createDiv({ text: 'Typing filters these links. Enter searches the whole library.', cls: 'reader-caption' });
    this.resultsEl = root.createDiv(); this.renderResults();
  }
  renderInbox() {
    const tab=this.contentEl.querySelector<HTMLElement>('[data-reader-tab="inbox"]');
    tab?.setText(this.plugin.inbox.length?`Inbox · ${this.plugin.inbox.length}`:'Inbox');
    const root=this.inboxEl;if (!root) return;root.empty();
    const count=this.plugin.inbox.length, active=this.plugin.inboxActive();
    if (!count && !active && !this.plugin.inboxMessage()){root.createEl('p',{text:'Your inbox is empty.',cls:'reader-muted'});return;}
    const box=root.createDiv({cls:'reader-inbox-callout'});
    const title=box.createDiv({cls:'reader-inbox-title'});setIcon(title.createSpan(),'inbox');
    title.createSpan({text:count ? `${count} pending ${count===1?'arrival':'arrivals'}` : active?'Processing inbox':'Inbox run'});
    if (count || active) {
      const button=box.createEl('button',{text:active?'Processing inbox…':'Process inbox',cls:'mod-cta reader-process-inbox'});
      button.disabled=active;button.onclick=()=>void this.plugin.processInbox();
    }
    if (this.plugin.inboxMessage()) box.createDiv({text:this.plugin.inboxMessage(),cls:'reader-caption',attr:{role:'status'}});
    else box.createDiv({text:'Launches Codex to file documents, review them, and record useful connections.',cls:'reader-caption'});
    if (active && this.plugin.inboxRun?.status !== 'interrupted') { const stop=box.createEl('button',{text:'Stop'});stop.onclick=()=>void this.plugin.stopInbox().catch(e=>new Notice(String(e))); }
    if (this.plugin.inboxRun || this.plugin.inboxMessage()) { const details=box.createEl('button',{text:'Run details'});details.onclick=()=>void this.plugin.showInboxDetails(); }
  }
  private unread(parent: HTMLElement,path: string) { if (this.plugin.seenItem(path,'document:'+path)?.read===false) parent.createSpan({text:'Unread',cls:'reader-unread',attr:{'aria-label':'Unread document'}}); }
  private async checkSpeech() {
    if (this.polling || this.closed) return; this.polling = true;
    try {
      const status = await this.plugin.speech.request<SpeechStatus>({ op: 'status' });
      const catalog = await this.plugin.speech.request<{ voices: string[] }>({ op: 'voices' });
      if (this.closed) return;
      const changed = JSON.stringify(status) !== JSON.stringify(this.speechStatus) || JSON.stringify(catalog.voices) !== JSON.stringify(this.voices);
      this.speechStatus = status; this.voices = catalog.voices;
      if (changed) this.renderSpeech();
    } catch { this.speechStatus = undefined; if (!this.closed) this.renderSpeech(); }
    finally { this.polling = false; }
  }
  private renderSpeech() {
    const root = this.speechEl; if (!root) return; root.empty();
    if (!this.speechStatus) return;
    const controls = root.createDiv({ cls: 'reader-search-controls' });
    const voice = controls.createEl('select', { attr: { 'aria-label': 'Read aloud voice' } });
    voice.createEl('option', { value: '', text: 'Assigned voice' });
    for (const id of this.voices) voice.createEl('option', { value: id, text: id.replaceAll('_', ' ') });
    voice.value = this.voices.includes(this.voice) ? this.voice : '';
    voice.onchange = () => { this.voice = voice.value; };
    const read = controls.createEl('button', { text: this.speechBusy ? 'Sending…' : 'Read aloud' });
    const supported = !!this.plugin.current && ['md', 'txt'].includes(this.plugin.current.extension);
    read.disabled = this.speechBusy || !supported || !speechAllowed(this.speechStatus);
    voice.disabled = this.speechBusy;
    read.onclick = () => void this.readAloud();
    const message = this.speechMessage || (!supported ? 'Open a Markdown or text document to read aloud.' : !speechAllowed(this.speechStatus) ? this.speechStatus.submission_guidance ?? 'Speech playback is held or unavailable.' : 'Reads selected text, or the full document.');
    root.createDiv({ text: message, cls: 'reader-caption', attr: { role: 'status' } });
  }
  private async readAloud() {
    if (this.speechBusy) return;
    const file = this.plugin.current, leaf = this.plugin.documentLeaf, voice = this.voice;
    if (!file || !['md','txt'].includes(file.extension)) return;
    this.speechBusy = true; this.speechMessage = ''; this.renderSpeech();
    try {
      const status = await this.plugin.speech.request<SpeechStatus>({ op: 'status' });
      if (!speechAllowed(status)) throw new Error(status.submission_guidance ?? 'Speech playback is held or unavailable.');
      if (file.stat.size > 1024 * 1024) throw new Error('This document exceeds the 1 MiB read-aloud limit. Select a shorter passage in a smaller note.');
      const editor = leaf?.view instanceof MarkdownView && leaf.view.file?.path === file.path ? leaf.view.editor : undefined;
      const selection = editor?.getSelection();
      const text = selection || (editor?.getValue() ?? await this.plugin.app.vault.cachedRead(file)).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
      if (!text.trim()) throw new Error('There is no text to read.');
      if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Selected text exceeds the 1 MiB read-aloud limit.');
      if (this.closed) return;
      if (voice) await this.plugin.speech.request({ op: 'assign_voice', source: 'obsidian-reader', voice });
      const latest = await this.plugin.speech.request<SpeechStatus>({ op: 'status' });
      if (!speechAllowed(latest)) throw new Error(latest.submission_guidance ?? 'Speech playback is held or unavailable.');
      if (this.closed) return;
      await this.plugin.speech.request({ op: 'submit', source: 'obsidian-reader', origin: 'Obsidian Reader', text,
        content_format: file.extension === 'md' ? 'markdown' : 'plain_text', sensitivity: 'confidential' });
      this.speechMessage = `Queued ${selection ? 'selection from' : 'document'} “${file.basename}”. Playback is managed by AI-TTS.`;
    } catch (error) { this.speechMessage = String(error); }
    finally { this.speechBusy = false; if (!this.closed) this.renderSpeech(); }
  }
  private renderResults() {
    const root = this.resultsEl; if (!root) return; root.empty();
    if (this.tab==='library' && this.searching) root.createEl('p', { text: 'Searching the library…', attr: { role: 'status' } });
    if (this.tab==='library' && this.searchError) root.createEl('p', { text: this.searchError, attr: { role: 'status' } });
    if (this.tab==='library' && this.searchResult) {
      root.createEl('h3', { text: `Library matches · ${this.searchResult.results.length}` });
      root.createDiv({ text: 'Ordered by relevance. Similarity is not a recorded librarian connection.', cls: 'reader-caption' });
      if (this.tab==='library' && this.searchResult.indexed_at) root.createDiv({ text: `Index: ${this.searchResult.indexed_at}`, cls: 'reader-caption' });
      for (const warning of this.searchResult.warnings ?? []) root.createEl('p', { text: warning, cls: 'reader-warning' });
      if (!this.searchResult.results.length) root.createEl('p', { text: 'No library matches.' });
      for (const hit of this.searchResult.results) {
        if (typeof hit.path !== 'string' || !libraryPath(hit.path)) continue;
        const card = root.createEl('article', { cls: 'reader-row' });
        this.button(card, this.plugin.index.resolver.title(hit.path), e => hit.page
          ? this.plugin.openCitation(`${hit.path}#page=${hit.page}`, '', this.newTab(e))
          : this.plugin.navigate(hit.path, this.newTab(e), Math.max(0, (hit.start_line ?? 1) - 1)));
        this.unread(card,hit.path);
        card.createDiv({ text: hit.path, cls: 'reader-path' });
        card.createDiv({ text: (hit.matched_by ?? []).join(' · '), cls: 'reader-caption' });
        const excerpt = card.createEl('details'); excerpt.open = true; excerpt.createEl('summary', { text: 'Matching passage' });
        const parts=matchingParts(hit.excerpt,this.query), literal=parts.some(p=>p.match);
        const passage=excerpt.createEl('p',{cls:'reader-search-passage'});
        if (!literal && hit.matched_by?.includes('semantic')) {
          passage.createEl('mark',{text:hit.excerpt,cls:'reader-semantic-match'});
          excerpt.createDiv({text:'Semantic match: the passage is related in meaning; no exact query words occur.',cls:'reader-caption'});
        } else {
          for(const part of parts)passage.createEl(part.match?'mark':'span',{text:part.text});
          if (!literal) excerpt.createDiv({text:'The match may be in the file path or use fuzzy spelling.',cls:'reader-caption'});
        }
      }
    }
    const current = this.plugin.current;
    if (!current) { root.createEl('p', { text: 'Open a document to see its Reader links.', cls: 'reader-muted' }); return; }
    const result = this.plugin.index.query(current.path, this.plugin.dateMode);
    root.createDiv({ text: 'Current document', cls: 'reader-caption' });
    root.createEl('h3', { text: result.title, cls: 'reader-subject' });
    const location=root.createEl('details',{cls:'reader-location'});location.createEl('summary',{text:'Document details'});location.createDiv({text:current.path,cls:'reader-path'});
    if (libraryPath(this.plugin.index.resolver.context(current.path).subject)) {
      this.unread(root,current.path);
      location.createDiv({text:this.plugin.seenLabel(this.plugin.seenItem(current.path,'document:'+current.path)),cls:'reader-caption'});
      if(this.plugin.attentionError)root.createDiv({text:this.plugin.attentionError,cls:'reader-warning'});
      const read=location.createEl('button',{text:this.plugin.isRead(current.path)?'Mark unread':'Mark read',cls:'reader-mark-read'});
      read.disabled=!this.plugin.seenItem(current.path,'document:'+current.path);
      read.onclick=()=>void this.plugin.toggleRead(current.path).catch(e=>new Notice(String(e)));
    }
    if(this.tab==='discussion'){this.renderThreads(root,current.path);return;}
    const basis = { document: 'Document date', arrival: 'Ingestion date', modified: 'Last modified' }[this.plugin.dateMode];
    root.createDiv({ text: `${basis} · oldest first · UTC`, cls: 'reader-caption' });
    if (this.plugin.loading) { root.createEl('p', { text: 'Loading document links…', attr: { role: 'status' } }); return; }
    if (result.problems.length) {
      const warning = root.createDiv({ cls: 'reader-warning', attr: { role: 'status' } });
      warning.createEl('p', { text: 'Document metadata needs attention. Showing exact-file links.' });
      for (const path of result.problems) this.button(warning, path, e => this.plugin.navigate(path, this.newTab(e)));
    }
    if (this.plugin.errors.size) {
      const details = root.createEl('details', { cls: 'reader-warning' });
      details.createEl('summary', { text: `Results may be incomplete (${this.plugin.errors.size} unreadable files)` });
      for (const [path] of this.plugin.errors) details.createEl('p', { text: path });
    }
    if (!result.notes.length && !result.related.length) root.createEl('p', { text: 'No librarian connections recorded for this document.', cls: 'reader-muted' });
    const notes = filterRows(result.notes, this.query), related = filterRows(result.related, this.query), catalog = filterRows(result.catalog, this.query);
    if (this.query.trim() && !notes.length && !related.length && !catalog.length) root.createEl('p', { text: 'No linked document names match. Press Enter to search library contents.', attr: { role: 'status' } });
    if (notes.length) this.group(root, 'Librarian notes', notes, false);
    if (related.length) this.group(root, 'Related documents', related, false);
    if (catalog.length) this.group(root, 'From the catalog', catalog, true);
  }
  private renderSeen(root:HTMLElement,path:string,key:string){
    const receipt=this.plugin.seenItem(path,key);
    root.createDiv({text:`${receipt?.read===false?'Unread · ':''}${this.plugin.seenLabel(receipt)}`,cls:'reader-caption'});
  }

  private renderThreads(root: HTMLElement,path: string){
    if(!libraryPath(path) || !/\.(md|markdown)$/i.test(path))return;
    const section=root.createEl('section',{cls:'reader-threads'});
    const threads=this.plugin.threadsFor(path);
    section.createEl('h4',{text:`${threads.length} ${threads.length===1?'conversation':'conversations'}`});
    if(!threads.length){const empty=section.createDiv({cls:'reader-empty'});setIcon(empty.createDiv({cls:'reader-empty-icon'}),'messages-square');empty.createEl('p',{text:'Start with a passage'});empty.createEl('small',{text:'Select text in the document, then right-click to highlight, comment, or leave a warning.'});}
    if(this.plugin.annotationError)section.createEl('p',{text:this.plugin.annotationError,cls:'reader-warning'});
    for(const thread of threads){
      const receipt=this.plugin.seenItem(path,'thread:'+thread.id);
      const details=section.createEl('details',{cls:'reader-thread'});details.open=this.plugin.activeThread===thread.id;
      let wasOpen=details.open;
      details.ontoggle=()=>{
        if(!details.isConnected || details.open===wasOpen)return;
        wasOpen=details.open;
        if(details.open){this.plugin.activeThread=thread.id;void this.plugin.acknowledgeOpen(path,thread);}
        else if(this.plugin.activeThread===thread.id)this.plugin.activeThread=undefined;
      };
      const summary=details.createEl('summary',{cls:'reader-thread-heading'});
      summary.createSpan({text:thread.owner,cls:'reader-thread-owner'});
      summary.createSpan({text:`${thread.comments.length} ${thread.comments.length===1?'comment':'comments'}`,cls:'reader-caption'});
      if(receipt?.read===false)summary.createSpan({text:'Unread',cls:'reader-unread'});
      if(thread.kind==='warning')summary.createSpan({text:'⚠ Warning',cls:'reader-thread-kind'});
      if(thread.resolved)summary.createSpan({text:'Resolved',cls:'reader-caption'});
      summary.createSpan({text:thread.anchor.quote.slice(0,140),cls:'reader-thread-preview'});
      const toolbar=details.createDiv({cls:'reader-thread-toolbar'});
      toolbar.createSpan({text:this.plugin.seenLabel(receipt),cls:'reader-caption'});
      const more=toolbar.createEl('button',{cls:'clickable-icon',attr:{'aria-label':'Discussion actions',title:'Discussion actions'}});setIcon(more,'ellipsis');
      const discussion=this.plugin.discussionItems(path,thread.id);
      more.onclick=event=>new Menu().addItem(item=>item.setTitle(receipt?.read?'Mark discussion unread':'Mark discussion read').setIcon('eye').setDisabled(!receipt || receipt.revision!==thread.revision).onClick(()=>void this.plugin.markSeen(path,discussion,!receipt?.read).catch(e=>new Notice(String(e))))).showAtMouseEvent(event);
      details.createEl('blockquote',{text:thread.anchor.quote});
      const source=details.createEl('button',{text:'Show passage',cls:'reader-text-action'});source.onclick=()=>void this.plugin.revealPassage(thread).catch(e=>new Notice(String(e)));
      this.renderSeen(details,path,'highlight:'+thread.id);
      if(thread.location && !['exact','relocated'].includes(thread.location.status))details.createEl('p',{text:`${thread.location.status==='ambiguous'?'Ambiguous passage':'Passage not found'}: the original quote is retained; no inline highlight is attached.`,cls:'reader-warning'});
      for(const comment of thread.comments){
        const item=details.createDiv({cls:`reader-comment ${comment.author===this.plugin.participant()?'is-own':''}`});
        item.createEl('strong',{text:comment.author});item.createEl('small',{text:' · '+new Date(comment.created_at).toLocaleString()});
        if(comment.reply_to){const parent=thread.comments.find(c=>c.id===comment.reply_to);item.createDiv({text:`Reply to ${parent?.author ?? 'earlier comment'}: ${parent?.body.slice(0,160) ?? ''}`,cls:'reader-caption'});}
        item.createEl('p',{text:comment.body});
        this.renderSeen(item,path,'comment:'+thread.id+':'+comment.id);
        const reply=item.createEl('button',{text:'Reply'});reply.onclick=()=>{this.replyingTo.set(thread.id,comment.id);this.plugin.activeThread=thread.id;this.render();this.focusReply(thread.id);};
      }
      if(this.replyingTo.has(thread.id)){const parent=thread.comments.find(c=>c.id===this.replyingTo.get(thread.id));details.createDiv({text:`Replying to ${parent?.author ?? 'comment'}`,cls:'reader-caption'});const cancel=details.createEl('button',{text:'Cancel reply'});cancel.onclick=()=>{this.replyingTo.delete(thread.id);this.render();};}
      const composer=details.createDiv({cls:'reader-composer'});
      composer.createDiv({text:`Reply as ${this.plugin.participant()}`,cls:'reader-caption'});
      const draft=composer.createEl('textarea',{cls:'reader-comment-compose',attr:{'data-thread-id':thread.id,'aria-label':`Reply as ${this.plugin.participant()}`,placeholder:`Reply as ${this.plugin.participant()}`,rows:'3'}});
      draft.value=this.drafts.get(thread.id)??'';draft.oninput=()=>{this.drafts.set(thread.id,draft.value);send.disabled=this.sending.has(thread.id)||!draft.value.trim();};
      const error=composer.createDiv({text:this.replyErrors.get(thread.id)??'',attr:{role:'status'},cls:'reader-compose-error'});
      const actions=composer.createDiv({cls:'reader-compose-actions'});
      actions.createSpan({text:Platform.isMacOS?'⌘ Enter to send':'Ctrl Enter to send',cls:'reader-caption'});
      const send=actions.createEl('button',{text:this.sending.has(thread.id)?'Sending…':'Post reply',cls:'mod-cta'});
      send.disabled=this.sending.has(thread.id)||!draft.value.trim();
      draft.onkeydown=event=>{if(event.key==='Enter' && (event.metaKey || event.ctrlKey)){event.preventDefault();if(!send.disabled)send.click();}};
      send.onclick=()=>{
        if(!draft.value.trim() || this.sending.has(thread.id))return;this.sending.add(thread.id);this.replyErrors.delete(thread.id);send.disabled=true;send.setText('Sending…');
        const parent=this.replyingTo.get(thread.id)??null;let request=this.replyRequests.get(thread.id);
        if(!request || request.body!==draft.value || request.parent!==parent){request={id:randomUUID(),body:draft.value,parent};this.replyRequests.set(thread.id,request);}
        void this.plugin.annotate({operation:'reply',thread_id:thread.id,author:this.plugin.participant(),body:request.body,reply_to:request.parent,request_id:request.id}).then(async()=>{
          this.drafts.delete(thread.id);this.replyRequests.delete(thread.id);this.replyingTo.delete(thread.id);this.plugin.activeThread=thread.id;await this.plugin.loadAnnotations(path,true,true);
        }).catch(e=>{this.replyErrors.set(thread.id,String(e));error.setText(String(e));}).finally(()=>{this.sending.delete(thread.id);this.render();});
      };
      const resolve=toolbar.createEl('button',{cls:'reader-text-action',text:thread.resolved?'Reopen thread':'Resolve thread'});
      resolve.onclick=()=>{resolve.disabled=true;void this.plugin.annotate({operation:'resolve',thread_id:thread.id,resolved:!thread.resolved,expected_revision:thread.revision})
        .then(()=>this.plugin.loadAnnotations(path,true,true)).catch(e=>{error.setText(String(e));resolve.disabled=false;});};
    }
  }
  private newTab(e: MouseEvent) { return e.metaKey || e.ctrlKey || e.button === 1; }
  private button(parent: HTMLElement, title: string, action: (e: MouseEvent) => Promise<void>) {
    const button = parent.createEl('button', { text: title, cls: 'reader-link' });
    button.onclick = e => { void action(e).catch(err => new Notice(`Reader: ${String(err)}`)); };
    button.onauxclick = e => { if (e.button === 1) { e.preventDefault(); void action(e).catch(err => new Notice(`Reader: ${String(err)}`)); } };
    return button;
  }
  private group(root: HTMLElement, title: string, rows: ResultRow[], collapsed: boolean) {
    const section = root.createEl(collapsed ? 'details' : 'section', { cls: 'reader-group' });
    section.createEl(collapsed ? 'summary' : 'h4', { text: `${title} · ${rows.length}` });
    const list = section.createDiv();
    let lastDay: string | undefined;
    const renderRows = (items: ResultRow[]) => { for (const row of items) {
      const day = row.date?.day ?? 'Undated';
      if (day !== lastDay) { list.createEl('h5', { text: day, cls: 'reader-date-group' }); lastDay = day; }
      this.row(list, row, title);
    } };
    renderRows(rows.slice(0, 5));
    if (rows.length > 5) {
      const more = section.createEl('button', { text: `Show all ${rows.length}`, cls: 'reader-more' });
      more.onclick = () => { renderRows(rows.slice(5)); more.remove(); };
    }
  }
  private row(root: HTMLElement, row: ResultRow, group: string) {
    const card = root.createEl('article', { cls: 'reader-row' });
    const evidence = row.evidence[0];
    if (row.path) this.button(card, row.title, e => group === 'Librarian notes'
      ? this.plugin.navigate(row.path!, this.newTab(e))
      : this.plugin.openCitation(evidence.link, evidence.note, this.newTab(e)));
    else { card.createDiv({ text: row.title }); card.createDiv({ text: 'Missing document', cls: 'reader-muted' }); }
    if (row.path) this.unread(card,row.path);
    const sources = new Set(row.evidence.map(e => e.note)).size;
    const caption = group === 'Librarian notes' ? `${evidence.kind} · Reader librarian`
      : group === 'From the catalog' ? `Linked from “${evidence.noteTitle}”`
      : sources > 1 ? `Linked together in ${sources} connection notes` : `Linked together in “${evidence.noteTitle}”`;
    card.createDiv({ text: caption, cls: 'reader-caption' });
    if (row.date) card.createDiv({ text: row.date.timestamp === undefined ? 'Time not recorded' : new Date(row.date.timestamp).toISOString().slice(11, 19) + ' UTC', cls: 'reader-caption' });
    const why = card.createEl('details');
    why.createEl('summary', { text: 'Why this appears' });
    for (const item of row.evidence) {
      const source = why.createDiv({ cls: 'reader-evidence' });
      if (item.context) source.createEl('p', { text: item.context, cls: 'reader-caption' });
      this.button(source, item.noteTitle, e => this.plugin.navigate(item.note, this.newTab(e), item.line));
      source.createEl('p', { text: item.excerpt });
      if (item.kind === 'Reaction') source.createEl('p', { text: item.readingScope ? `Reading scope: ${item.readingScope}` : 'Reading scope not recorded', cls: 'reader-caption' });
      source.createEl('small', { text: `Recorded link: ${item.link}` });
    }
  }
}

class ReaderSettings extends PluginSettingTab {
  plugin: ReaderPlugin;
  constructor(plugin: ReaderPlugin) { super(plugin.app, plugin); this.plugin = plugin; }
  display() {
    this.containerEl.empty();
    new Setting(this.containerEl).setName('Your annotation name').setDesc('Used for highlights and replies you write in Obsidian. Agents use their own names.').addText(text=>text.setValue(this.plugin.participant()).onChange(value=>this.plugin.setParticipant(value)));
    new Setting(this.containerEl).setName('Codex executable').setDesc('Optional absolute path. Leave blank to detect Codex automatically. Uses your existing Codex login.')
      .addText(text=>text.setValue(this.plugin.codexPath()).setPlaceholder('Auto-detect').onChange(value=>this.plugin.setCodexPath(value)));
    new Setting(this.containerEl).setName('Group and sort by date')
      .setDesc('Ingestion date uses receipt time, then filing date. Oldest first. Document dates fall back to filing dates. Undated documents appear last. Timestamp groups use UTC.')
      .addDropdown(dropdown => dropdown.addOptions({ document: 'Document date', arrival: 'Ingestion date', modified: 'Last modified' })
        .setValue(this.plugin.dateMode).onChange(value => this.plugin.setDateMode(value as DateMode)));
  }
}
