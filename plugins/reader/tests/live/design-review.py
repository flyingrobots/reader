"""Live comment UX, theme, and rendered-panel acceptance. Run in the Reader vault."""
exec((__import__('pathlib').Path(__file__).parent/'engagement.py').read_text().split('ident=')[0])
ident=uuid.uuid4().hex[:8];path='library/design-review-'+ident+'.md';q=json.dumps(path);p='app.plugins.plugins.reader'
human='Reviewer '+ident;original=ev('JSON.stringify('+p+'.current?.path)');participant=ev(p+'.participant()')
threads=[];original_theme=ev('JSON.stringify(document.body.className)')
source='# Reading with intent\n\nA receipt records an encounter, not agreement.\n\nEvery opened page has been fully understood.\n'
scratch=Path('.reader/session-scratch/reader-plugin');scratch.mkdir(parents=True,exist_ok=True)
try:
    ev('(async()=>{await app.vault.create('+q+','+json.dumps(source)+');return true})()')
    quote='A receipt records an encounter, not agreement.';start=source.index(quote)
    t=api(operation='create',path=path,start=start,end=start+len(quote),owner='Reader librarian',comment='This is a useful distinction. Opening, reading, and agreeing are different events.')
    threads.append(t['id'])
    api(operation='reply',thread_id=t['id'],author=human,body='Can we make that distinction visible without adding more controls?',reply_to=t['comments'][0]['id'])
    quote='Every opened page has been fully understood.';start=source.index(quote)
    w=api(operation='create',path=path,start=start,end=start+len(quote),owner='Reader librarian',kind='warning',comment='Suspected issue: opening a page cannot establish understanding. What evidence would support this claim?')
    threads.append(w['id'])
    ev(p+'.setParticipant('+json.dumps(human)+')');ev(p+'.navigate('+q+',false)')
    ev(p+'.documentLeaf.setViewState({type:"markdown",state:{file:'+q+',mode:"preview"}})')
    ev(p+'.loadAnnotations('+q+',true,true)')
    wait('!!document.querySelector(".markdown-preview-view .reader-comment-icon")')
    ev('document.querySelector('+json.dumps('[data-reader-thread="'+t['id']+'"]')+').click()')
    wait('document.activeElement?.dataset.threadId==='+json.dumps(t['id']))
    # Reply targets a specific comment, focuses input, and preserves draft/caret on async redraw.
    ev('[...document.querySelectorAll(".reader-thread[open] .reader-comment button")].find(b=>b.textContent==="Reply").click()')
    wait('document.activeElement?.dataset.threadId==='+json.dumps(t['id']))
    ev('(()=>{const d=document.activeElement;d.value="Use a compact seen-by line, with details on demand.";d.dispatchEvent(new Event("input"));d.setSelectionRange(4,9);return true})()')
    ev(p+'.render()');time.sleep(.1)
    assert ev('document.activeElement?.selectionStart')==4
    assert ev('document.activeElement?.selectionEnd')==9
    ev('window.__readerOriginalAnnotate=app.plugins.plugins.reader.annotate;app.plugins.plugins.reader.annotate=function(r){if(r.operation==="reply")return Promise.reject(new Error("Test transport failure"));return window.__readerOriginalAnnotate.call(this,r)}')
    ev('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",metaKey:true,bubbles:true}))')
    time.sleep(.2)
    assert ev('!!document.querySelector(".reader-thread[open] .reader-compose-error")?.textContent.includes("Test transport failure")')
    assert ev('document.querySelector(".reader-thread[open] textarea").value')=='Use a compact seen-by line, with details on demand.'
    ev('app.plugins.plugins.reader.annotate=window.__readerOriginalAnnotate;delete window.__readerOriginalAnnotate')
    ev('document.querySelector(".reader-thread[open] textarea").focus();document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",metaKey:true,bubbles:true}))')
    wait(p+'.threadsFor('+q+').find(t=>t.id==='+json.dumps(t['id'])+').comments.length===3')
    saved=api(operation='list',path=path)['threads'];replied=next(x for x in saved if x['id']==t['id'])
    assert replied['comments'][-1]['reply_to']==t['comments'][0]['id']
    wait('app.workspace.getLeavesOfType("reader-view")[0].view.sending.size===0')
    time.sleep(.5)
    # Source return and fresh selection composition retain context and keyboard support.
    ev('[...document.querySelectorAll(".reader-thread[open] button")].find(b=>b.textContent==="Show passage").click()')
    wait('document.activeElement?.classList.contains("markdown-preview-view")')
    ev(p+'.documentLeaf.setViewState({type:"markdown",state:{file:'+q+',mode:"source",source:false}})')
    ev(p+'.documentLeaf.view.editor.setSelection({line:0,ch:2},{line:0,ch:21})')
    ev(p+'.highlightSelection()')
    assert ev('document.activeElement?.getAttribute("aria-label")')=='Initial comment'
    ev('[...document.querySelectorAll(".modal button")].find(b=>b.textContent==="Cancel").click()')
    assert not ev('!!document.querySelector(".reader-annotation-modal")')
    ev(p+'.openThread('+json.dumps(t['id'])+')')
    ev('document.querySelector(".reader-thread[open] textarea").value="A draft for theme inspection";document.querySelector(".reader-thread[open] textarea").dispatchEvent(new Event("input"))')
    # Render both themes and record overflow + semantic theme token usage.
    results={}
    for theme in ['theme-dark','theme-light']:
        ev('document.body.classList.remove("theme-dark","theme-light");document.body.classList.add('+json.dumps(theme)+')')
        result=ev('JSON.stringify((()=>{const panel=document.querySelector(".reader-sidebar"),button=panel.querySelector(".reader-thread[open] .reader-composer .mod-cta");const s=getComputedStyle(button);return {width:panel.clientWidth,scrollWidth:panel.scrollWidth,buttonColor:s.color,buttonBackground:s.backgroundColor,accent:getComputedStyle(document.body).getPropertyValue("--interactive-accent"),foreground:getComputedStyle(document.body).getPropertyValue("--text-on-accent"),bodyColor:getComputedStyle(panel.querySelector(\".reader-comment p\")).color,bodyBackground:getComputedStyle(panel.querySelector(\".reader-comment\")).backgroundColor}})())')
        assert result['scrollWidth']<=result['width']+1,result
        results[theme]=result
        dest=str((scratch/('design-'+theme+'.png')).resolve())
        ev('(async()=>{const r=document.querySelector(".reader-sidebar").getBoundingClientRect();const image=await window.electron.remote.getCurrentWebContents().capturePage({x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)});require("fs").writeFileSync('+json.dumps(dest)+',image.toPNG());return true})()')
    (scratch/'design-review.json').write_text(json.dumps(results,indent=2))
    assert Path(path).read_text()==source
    print('PASS: inline thread opens focused composer, parent reply, draft/caret survive redraw, failure retains draft, keyboard retry sends one attributed reply, source return, modal focus/cancel, both themes without horizontal overflow.')
finally:
    ev('document.body.className='+json.dumps(original_theme))
    ev('if(window.__readerOriginalAnnotate){app.plugins.plugins.reader.annotate=window.__readerOriginalAnnotate;delete window.__readerOriginalAnnotate}')
    ev('document.querySelector(".modal-header-button")?.click()')
    ev(p+'.setParticipant('+json.dumps(participant)+')')
    for target in [path]+['annotations/'+tid+'.json' for tid in threads]+['engagement/'+hashlib.sha256(human.encode()).hexdigest()+'.json']:
        ev('(async()=>{const f=app.vault.getAbstractFileByPath('+json.dumps(target)+');if(f)await app.vault.delete(f);return true})()');Path(target).unlink(missing_ok=True)
    if original:ev(p+'.navigate('+json.dumps(original)+',false)')
