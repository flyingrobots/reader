"""Durable shared Markdown annotations; source bytes are never rewritten."""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile
from uuid import UUID, uuid4

from .metadata import frontmatter


def now(): return datetime.now(timezone.utc).isoformat()
def sha(data): return hashlib.sha256(data).hexdigest()


class Annotations:
    def __init__(self, root):
        self.root = Path(root).resolve(strict=True)
        self.folder = self.root / 'annotations'
        self.runtime = self.root / '.reader'

    def document(self,path):
        parts=path.split('/')
        if not path.startswith('library/') or any(p in ('','.','..') for p in parts) or '\\' in path:
            raise ValueError('Annotation source must be a library-relative Markdown path')
        file=self.root/path
        if file.suffix.lower() not in ('.md','.markdown'):
            raise ValueError('Passage annotations currently support Markdown only')
        if any(p.is_symlink() for p in (file,*file.parents) if p!=self.root):
            raise ValueError('Annotation source must not cross symlinks')
        if not file.is_file() or file.stat().st_size>4*1024**2:
            raise ValueError('Annotation source must be a regular Markdown file of at most 4 MiB')
        data=file.read_bytes(); text=data.decode('utf-8')
        metadata,_=frontmatter(data)
        identity=metadata.get('document_id') if metadata.get('document_path')==path else None
        return data,text,identity

    @contextmanager
    def locked(self):
        self.runtime.mkdir(exist_ok=True)
        if self.folder.is_symlink(): raise ValueError('Annotation folder must not be a symlink')
        self.folder.mkdir(exist_ok=True)
        with (self.runtime/'annotations.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            yield

    def read(self,thread_id):
        if self.folder.is_symlink():raise ValueError('Annotation folder must not be a symlink')
        name=str(UUID(thread_id))+'.json';path=self.folder/name
        if path.is_symlink() or path.stat().st_size>1024**2:raise ValueError('Unsafe or oversized annotation thread')
        thread=json.loads(path.read_text())
        if thread.get('schema_version')!=1 or thread.get('id')!=str(UUID(thread_id)):raise ValueError('Invalid annotation thread identity/schema')
        return thread

    def write(self,thread):
        data=(json.dumps(thread,ensure_ascii=False,indent=2)+'\n').encode()
        if len(data)>1024**2:raise ValueError('Annotation thread exceeds 1 MiB')
        temporary=None
        try:
            with tempfile.NamedTemporaryFile(dir=self.folder,prefix='.thread-',delete=False) as out:
                temporary=Path(out.name);out.write(data);out.flush();os.fsync(out.fileno())
            os.replace(temporary,self.folder/(thread['id']+'.json'))
        finally:
            if temporary:temporary.unlink(missing_ok=True)

    @staticmethod
    def body(value,name,maximum):
        if not isinstance(value,str) or not value.strip() or len(value)>maximum:raise ValueError(f'{name} must contain 1–{maximum} characters')
        return value

    @staticmethod
    def anchor(thread,data,text):
        a=thread['anchor'];quote=a['quote'];start=a['start'];end=a['end']
        if sha(data)==a['source_sha256'] and text[start:end]==quote:return dict(status='exact',start=start,end=end)
        candidates=[];offset=0
        while True:
            hit=text.find(quote,offset)
            if hit<0:break
            candidates.append(hit);offset=hit+1
            if len(candidates)>1000:return dict(status='ambiguous')
        if len(candidates)==1:return dict(status='relocated',start=candidates[0],end=candidates[0]+len(quote))
        matched=[i for i in candidates if text[max(0,i-len(a['prefix'])):i]==a['prefix'] and text[i+len(quote):i+len(quote)+len(a['suffix'])]==a['suffix']]
        if len(matched)==1:return dict(status='relocated',start=matched[0],end=matched[0]+len(quote))
        return dict(status='ambiguous' if candidates else 'orphaned')

    def list(self,path):
        data,text,identity=self.document(path)
        threads=[]
        if not self.folder.exists():return dict(path=path,source_sha256=sha(data),threads=[])
        files=sorted(self.folder.glob('*.json'))
        if len(files)>5000:raise ValueError('Annotation inventory exceeds 5,000 threads')
        for file in files:
            thread=self.read(file.stem)
            if thread['document_path']==path or identity and thread.get('document_id')==identity:
                threads.append(dict(thread,location=self.anchor(thread,data,text)))
        return dict(path=path,source_sha256=sha(data),threads=threads)

    def create(self,path,start,end,owner,comment='',expected_sha256=None,request_id=None,kind='highlight'):
        owner=self.body(owner,'Owner',100)
        if kind not in ('highlight','warning'):raise ValueError('Annotation kind must be highlight or warning')
        if kind=='warning':self.body(comment,'Warning explanation',16000)
        if comment:self.body(comment,'Comment',16000)
        data,text,identity=self.document(path)
        if expected_sha256 and sha(data)!=expected_sha256:raise ValueError('Source changed; select the passage again')
        if type(start)is not int or type(end)is not int or not 0<=start<end<=len(text) or end-start>16000:raise ValueError('Invalid passage range; offsets are Unicode code points')
        thread_id=str(UUID(request_id)) if request_id else str(uuid4())
        anchor=dict(start=start,end=end,quote=text[start:end],prefix=text[max(0,start-64):start],suffix=text[end:end+64],source_sha256=sha(data))
        with self.locked():
            if (self.folder/(thread_id+'.json')).exists():
                previous=self.read(thread_id)
                if previous['document_path']==path and previous['anchor']==anchor and previous['owner']==owner and previous.get('initial_comment','')==comment and previous.get('kind','highlight')==kind:return previous
                raise ValueError('Annotation request ID already exists with different input')
            if sum(1 for _ in self.folder.glob('*.json'))>=5000:raise ValueError('Annotation inventory exceeds 5,000 threads')
            thread=dict(schema_version=1,kind=kind,id=thread_id,document_path=path,document_id=identity,owner=owner,created_at=now(),revision=1,resolved=False,anchor=anchor,initial_comment=comment,comments=[])
            if comment:thread['comments'].append(dict(id=str(uuid4()),author=owner,body=comment,created_at=now(),reply_to=None))
            self.write(thread);return thread

    def reply(self,thread_id,author,body,reply_to=None,request_id=None):
        author=self.body(author,'Author',100);body=self.body(body,'Comment',16000)
        comment_id=str(UUID(request_id)) if request_id else str(uuid4())
        with self.locked():
            thread=self.read(thread_id)
            for c in thread['comments']:
                if c['id']==comment_id:
                    if (c['author'],c['body'],c['reply_to'])==(author,body,reply_to):return thread
                    raise ValueError('Comment request ID already exists with different input')
            if reply_to and not any(c['id']==reply_to for c in thread['comments']):raise ValueError('Reply parent is not in this thread')
            if len(thread['comments'])>=1000:raise ValueError('Thread exceeds 1,000 comments')
            thread['comments'].append(dict(id=comment_id,author=author,body=body,created_at=now(),reply_to=reply_to))
            thread['revision']+=1;self.write(thread);return thread

    def resolve(self,thread_id,resolved,expected_revision=None):
        if type(resolved)is not bool:raise ValueError('resolved must be boolean')
        with self.locked():
            thread=self.read(thread_id)
            if expected_revision is not None and thread['revision']!=expected_revision:raise ValueError('Thread changed; reload before changing its state')
            if thread['resolved']!=resolved:thread['resolved']=resolved;thread['revision']+=1;self.write(thread)
            return thread

    def dispatch(self,request):
        operation=request.pop('operation',None)
        if operation in ('attention','seen'):
            from .engagement import Engagement
            return getattr(Engagement(self.root),operation)(**request)
        if operation not in ('list','create','reply','resolve'):raise ValueError('Unknown annotation operation')
        return getattr(self,operation)(**request)
