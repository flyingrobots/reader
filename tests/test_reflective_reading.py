import hashlib
import importlib.util
from pathlib import Path
from uuid import uuid4
import pytest
from reader_mcp.annotations import Annotations

spec=importlib.util.spec_from_file_location('reflective',Path(__file__).resolve().parents[1]/'skills/reflective-reading/scripts/annotate_quote.py')
reflective=importlib.util.module_from_spec(spec);spec.loader.exec_module(reflective)

def test_quote_helper_unicode_anchor_roundtrip_and_refusals(tmp_path):
    (tmp_path/'library').mkdir();source=tmp_path/'library/note.md'
    source.write_text('An emoji 😀 before the surprising claim.\n')
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    def prepare(quote='surprising claim',expected=digest):
        return reflective.prepare(tmp_path,'library/note.md',quote,'Question: which assumption supports this?', 'warning','Reader librarian',expected,str(uuid4()))
    request=prepare();thread=Annotations(tmp_path).dispatch(request)
    assert thread['kind']=='warning' and thread['anchor']['quote']=='surprising claim'
    assert thread['anchor']['start']==source.read_text().index('surprising claim')
    with pytest.raises(ValueError,match='exactly once'):prepare('missing')
    with pytest.raises(ValueError,match='changed'):prepare(expected='0'*64)
    source.write_text('same same')
    with pytest.raises(ValueError,match='exactly once'):prepare('same',hashlib.sha256(source.read_bytes()).hexdigest())


def test_quote_helper_owner_defaults_to_the_session_label_not_the_curator(monkeypatch,capsys):
    required=['library/note.md','--quote-file','q.txt','--comment-file','c.txt','--expected-sha256','0'*64,'--request-id',str(uuid4())]
    monkeypatch.delenv('AGENT_SESSION_ID',raising=False)
    with pytest.raises(SystemExit) as error:reflective.parse_args(required)
    assert error.value.code==2 and '--owner' in capsys.readouterr().err
    monkeypatch.setenv('AGENT_SESSION_ID','claude-session-1234')
    assert reflective.parse_args(required).owner=='claude-session-1234'
    assert reflective.parse_args([*required,'--owner','Courier']).owner=='Courier'
