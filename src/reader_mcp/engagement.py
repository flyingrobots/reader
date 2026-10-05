"""Participant-specific receipts for exact document and discussion versions."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
from .annotations import Annotations, now, sha


def version(value):
    return sha(json.dumps(value,sort_keys=True,ensure_ascii=False).encode())


class Engagement:
    def __init__(self, root):
        self.annotations=Annotations(root)
        self.root=self.annotations.root
        self.folder=self.root/'engagement'

    def participant(self, value):
        return self.annotations.body(value,'Participant',100).strip()

    def receipts(self):
        if self.folder.is_symlink(): raise ValueError('Engagement folder must not be a symlink')
        files=sorted(self.folder.glob('*.json'))
        if len(files)>100: raise ValueError('At most 100 participants are supported')
        result=[]
        for file in files:
            if file.is_symlink() or file.stat().st_size>8*1024**2:raise ValueError('Unsafe or oversized read receipts')
            data=json.loads(file.read_text())
            if data.get('schema_version')!=1 or file.stem!=sha(self.participant(data['participant']).encode()):raise ValueError('Invalid read receipt identity/schema')
            result.append(data)
        return result

    def document(self,path):
        if not isinstance(path,str) or not path.startswith('library/') or '\\' in path or any(x in ('','.','..') for x in path.split('/')):raise ValueError('Expected library-relative document path')
        file=self.root/path
        if any(p.is_symlink() for p in (file,*file.parents) if p!=self.root) or not file.is_file():raise ValueError('Expected regular library file without symlinks')
        if file.stat().st_size>256*1024**2:raise ValueError('Document exceeds 256 MiB receipt limit')
        with file.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
        return dict(key='document:'+path,version=digest,kind='document',path=path)

    def thread_items(self,thread):
        tid=thread['id'];path=thread['document_path']
        items=[dict(key='highlight:'+tid,version=version(thread['anchor']),kind=thread.get('kind','highlight'),path=path,thread_id=tid,body=thread['anchor']['quote'],author=thread['owner'])]
        items.extend(dict(key='comment:'+tid+':'+c['id'],version=version(c),kind='comment',path=path,thread_id=tid,**c) for c in thread['comments'])
        items.append(dict(key='thread:'+tid,version=version(thread),kind='thread',path=path,thread_id=tid,revision=thread['revision']))
        return items

    def inventory(self,path=None):
        files=sorted(self.annotations.folder.glob('*.json'))
        if len(files)>5000:raise ValueError('Annotation inventory exceeds 5,000 threads')
        for file in files:
            thread=self.annotations.read(file.stem)
            if path is None or thread['document_path']==path:yield thread

    def attention(self,participant,path=None,offset=0,limit=100):
        participant=self.participant(participant)
        if type(offset)is not int or offset<0 or type(limit)is not int or not 1<=limit<=100:raise ValueError('Invalid attention page')
        receipts=self.receipts()
        def decorate(item):
            item['seen_by']=[dict(participant=r['participant'],at=r['items'][item['key']]['at']) for r in receipts if r['items'].get(item['key'],{}).get('version')==item['version']]
            item['read']=any(r['participant']==participant for r in item['seen_by'])
            return item
        if path is not None:
            items=[decorate(self.document(path))]
            for t in self.inventory(path):items.extend(decorate(i) for i in self.thread_items(t))
            return dict(participant=participant,path=path,items=items)
        pending=[]
        for t in self.inventory():
            items=[decorate(i) for i in self.thread_items(t)]
            if not items[-1]['read']:
                pending.append(dict(thread_id=t['id'],path=t['document_path'],revision=t['revision'],unread=sum(not i['read'] for i in items[:-1])))
        return dict(participant=participant,pending=pending[offset:offset+limit],total=len(pending),next_offset=offset+limit if offset+limit<len(pending) else None)

    def current(self,key):
        kind,_,identifier=key.partition(':')
        if kind=='document':return self.document(identifier)
        tid=identifier.split(':')[0]
        for item in self.thread_items(self.annotations.read(tid)):
            if item['key']==key:return item
        raise ValueError('Unknown discussion item')

    def seen(self,participant,items,read=True):
        participant=self.participant(participant)
        if type(read)is not bool or not isinstance(items,list) or not 1<=len(items)<=2000:raise ValueError('Expected 1–2000 receipt items and boolean read')
        with self.annotations.locked():
            receipts=self.receipts()
            record=next((r for r in receipts if r['participant']==participant),dict(schema_version=1,participant=participant,items={}))
            if not any(r['participant']==participant for r in receipts) and len(receipts)>=100:raise ValueError('At most 100 participants are supported')
            for item in items:
                if self.current(item['key'])['version']!=item['version']:raise ValueError('Content changed; read the current version before marking seen')
            stamp=now()
            for item in items:
                if read:record['items'][item['key']]=dict(version=item['version'],at=stamp)
                else:record['items'].pop(item['key'],None)
            data=(json.dumps(record,ensure_ascii=False,indent=2)+'\n').encode()
            if len(data)>8*1024**2:raise ValueError('Participant receipts exceed 8 MiB')
            self.folder.mkdir(exist_ok=True)
            temporary=None
            try:
                with tempfile.NamedTemporaryFile(dir=self.folder,prefix='.receipt-',delete=False) as stream:
                    temporary=Path(stream.name);stream.write(data);stream.flush();os.fsync(stream.fileno())
                os.replace(temporary,self.folder/(sha(participant.encode())+'.json'))
            finally:
                if temporary:temporary.unlink(missing_ok=True)
        return dict(participant=participant,updated=len(items),read=read)
