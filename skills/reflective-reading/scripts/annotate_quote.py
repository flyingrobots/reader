#!/usr/bin/env python3
"""Create a hash-checked, uniquely anchored Reader highlight or warning."""
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import subprocess
from uuid import UUID


def prepare(root,path,quote,comment,kind,owner,expected_sha256,request_id):
    if not path.startswith('library/') or '\\' in path or any(p in ('','.','..') for p in path.split('/')):raise ValueError('Expected library-relative Markdown path')
    source=root/path
    if source.suffix.lower() not in ('.md','.markdown') or not source.is_file() or any(p.is_symlink() for p in (source,*source.parents) if p!=root):raise ValueError('Expected regular Markdown source without symlinks')
    if source.stat().st_size>4*1024**2:raise ValueError('Source exceeds 4 MiB')
    raw=source.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=expected_sha256:raise ValueError('Source changed; reread before annotating')
    text=raw.decode('utf-8')
    if not quote or len(quote)>16000:raise ValueError('Expected a quote of 1–16000 characters')
    start=text.find(quote)
    if start<0 or text.find(quote,start+1)>=0:raise ValueError('Quote must match exactly once; inspect context and use explicit offsets for repeated passages')
    if kind not in ('highlight','warning'):raise ValueError('Unknown annotation kind')
    if not comment.strip() or len(comment)>16000:raise ValueError('Reflective annotations need an explanatory comment of 1–16000 characters')
    return dict(operation='create',path=path,start=start,end=start+len(quote),owner=owner,comment=comment,kind=kind,expected_sha256=expected_sha256,request_id=str(UUID(request_id)))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path')
    parser.add_argument('--quote-file',required=True,type=Path)
    parser.add_argument('--comment-file',required=True,type=Path)
    parser.add_argument('--kind',choices=['highlight','warning'],default='highlight')
    parser.add_argument('--owner',default='Reader librarian')
    parser.add_argument('--expected-sha256',required=True)
    parser.add_argument('--request-id',required=True)
    args=parser.parse_args();code,root=runpy.run_path(str(Path(__file__).resolve().parents[3] / 'scripts/reader_paths.py'))['paths']()
    request=prepare(root,args.path,args.quote_file.read_text(),args.comment_file.read_text(),args.kind,args.owner,args.expected_sha256,args.request_id)
    result=subprocess.run([str(code/'.venv/bin/reader'),'--root',str(root),'annotate','-'],input=json.dumps(request),text=True,timeout=30)
    raise SystemExit(result.returncode)

if __name__=='__main__':main()
