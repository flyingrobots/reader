"""Medium: synthetic PDFs exercise intake's public context and deferral boundary."""

from pathlib import Path

import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from reader_mcp import intake


def pdf_file(path: Path, text: str = '', *, encrypted: bool = False,
             title: str = 'Synthetic field notes', author: str = 'Fixture Author', pages: int = 1) -> bytes:
    """Build a synthetic page with independently chosen text and source metadata."""
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    if text:
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
                                 NameObject('/Subtype'): NameObject('/Type1'),
                                 NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'):
            DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        escaped = text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
        stream.set_data(f'BT /F1 12 Tf 50 700 Td ({escaped}) Tj ET'.encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
    for _ in range(pages - 1):
        writer.add_page(page)
    writer.add_metadata({'/Title': title, '/Author': author})
    if encrypted:
        writer.encrypt('fixture-password')
    with path.open('wb') as output:
        writer.write(output)
    return path.read_bytes()


@pytest.fixture
def pdf_vault(tmp_path: Path) -> Path:
    (tmp_path / 'inbox').mkdir()
    (tmp_path / 'library').mkdir()
    return tmp_path


def test_text_pdf_supplies_labelled_excerpt_and_source_metadata(pdf_vault: Path) -> None:
    path = pdf_vault / 'inbox/report.pdf'
    original = pdf_file(path, 'RESTRICTED: human review required. Synthetic field notes.')
    entry = intake.snapshot(pdf_vault, 'inbox/report.pdf')
    context = intake.model_context(pdf_vault, entry)
    assert len(context['reading']) == 1, 'Text PDFs must supply editorial reading context'
    reading = context['reading'][0]
    assert reading['path'] == 'report.pdf'
    assert 'RESTRICTED: human review required.' in reading['excerpt']
    assert reading['format'] == 'pdf-extracted-text'
    assert reading['source_metadata']['title'] == 'Synthetic field notes'
    assert reading['source_metadata']['author'] == 'Fixture Author'
    assert 'untrusted' in reading['metadata_scope'].lower()
    assert reading['complete'] is False, 'Extracted text does not establish full PDF reading'
    assert path.read_bytes() == original


def test_pdf_and_unicode_text_share_payload_budget(pdf_vault: Path) -> None:
    bundle = pdf_vault / 'inbox/bundle'
    bundle.mkdir()
    originals = {}
    for number in range(9):
        path = bundle / f'{number}.pdf'
        originals[path] = pdf_file(path, 'Source prose. ' * 2000, title='é' * 600, author='あ' * 600)
    text = bundle / '00.txt'
    text.write_bytes(b'\xff' * 17000)  # Replacement characters also cost UTF-8 bytes.
    originals[text] = text.read_bytes()
    context = intake.model_context(pdf_vault, intake.snapshot(pdf_vault, 'inbox/bundle'))
    sizes = [len(row['excerpt'].encode()) + sum(len(value.encode())
             for value in row.get('source_metadata', {}).values()) for row in context['reading']]
    assert len(context['files']) == 10
    assert sum(sizes) <= 96 * 1024
    assert all(size <= 16000 for size in sizes)
    assert any(row.get('source_metadata', {}).get('title') == 'é' * 256 for row in context['reading'])
    assert context['reading'][1]['complete'] is False
    assert all(path.read_bytes() == original for path, original in originals.items())


def test_pdf_page_coverage_is_finite(pdf_vault: Path) -> None:
    path = pdf_vault / 'inbox/pages.pdf'
    pdf_file(path, 'PAGE WITNESS', pages=17)
    context = intake.model_context(pdf_vault, intake.snapshot(pdf_vault, 'inbox/pages.pdf'))
    assert context['reading'][0]['excerpt'].count('PAGE WITNESS') == 16
    assert 'first 16 pages' in context['reading'][0]['extraction_scope']
    assert context['reading'][0]['complete'] is False


def test_pdf_changed_since_snapshot_is_not_sent_to_editor(pdf_vault: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = pdf_vault / 'inbox/report.pdf'
    before = pdf_file(path, 'Original content')
    entry = intake.snapshot(pdf_vault, 'inbox/report.pdf')
    after = pdf_file(path, 'Replaced content')
    assert len(after) == len(before), 'Same-size replacement must still be detected'
    monkeypatch.setattr(intake, 'model_call', lambda *_: pytest.fail('Stale PDF reached editor'))
    decision = intake.classify(pdf_vault, pdf_vault / '.reader/run', entry, 'unused')
    assert decision['disposition'] == 'defer'
    assert 'changed since' in decision['reason']
    assert path.read_bytes() == after


def test_empty_pdf_batch_does_not_evade_work_budget(pdf_vault: Path) -> None:
    bundle = pdf_vault / 'inbox/empty'
    bundle.mkdir()
    for number in range(9):
        pdf_file(bundle / f'{number}.pdf')
    context = intake.model_context(pdf_vault, intake.snapshot(pdf_vault, 'inbox/empty'))
    assert len(context['files']) == 9
    assert len(context['reading']) == 8
    assert all('text layer' in row['reason'] for row in context['reading'])
    assert 'Unlisted PDFs have not been read' in context['reading_scope']


def test_pdf_deadline_does_not_hide_readable_companion(pdf_vault: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from reader_mcp import pdf_context
    bundle = pdf_vault / 'inbox/mixed'
    bundle.mkdir()
    pdf_file(bundle / 'a.pdf')
    (bundle / 'z.txt').write_text('Readable companion')
    # Explicitly expire PDF work admission, while ordinary text remains available.
    monkeypatch.setattr(pdf_context, 'MAX_TOTAL_SECONDS', 0)
    context = intake.model_context(pdf_vault, intake.snapshot(pdf_vault, 'inbox/mixed'))
    assert context['reading'] == [{'path': 'z.txt', 'excerpt': 'Readable companion', 'complete': True}]


def test_expired_pdf_budget_defers_without_editor(pdf_vault: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from reader_mcp import pdf_context
    path = pdf_vault / 'inbox/report.pdf'
    pdf_file(path, 'Readable after an explicit retry')
    monkeypatch.setattr(pdf_context, 'MAX_TOTAL_SECONDS', 0)
    monkeypatch.setattr(intake, 'model_call', lambda *_: pytest.fail('No readable evidence reached editor'))
    decision = intake.classify(pdf_vault, pdf_vault / '.reader/run', intake.snapshot(pdf_vault, 'inbox/report.pdf'), 'unused')
    assert decision['disposition'] == 'defer'
    assert 'No readable evidence' in decision['reason']


def test_mixed_bundle_keeps_pdf_refusal_with_readable_evidence(pdf_vault: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = pdf_vault / 'inbox/mixed'
    bundle.mkdir()
    pdf_file(bundle / 'a.pdf')
    (bundle / 'z.txt').write_text('Readable companion')
    entry = intake.snapshot(pdf_vault, 'inbox/mixed')
    observed = []

    def editor(_root: Path, _runtime: Path, _entry: object, _model: str, context: dict) -> dict:
        observed.append(context)
        decision = dict.fromkeys(intake.DECISION_FIELDS, '')
        decision.update(source=entry['source'], snapshot_sha256=entry['snapshot_sha256'], disposition='defer',
                        reason='Human review of the PDF remains appropriate.')
        return decision

    monkeypatch.setattr(intake, 'model_call', editor)
    intake.classify(pdf_vault, pdf_vault / '.reader/run', entry, 'unused')
    assert len(observed) == 1
    assert 'text layer' in observed[0]['reading'][0]['reason']
    assert observed[0]['reading'][1]['excerpt'] == 'Readable companion'


@pytest.mark.parametrize('kind,reason', [('scanned', 'text layer'), ('encrypted', 'encrypted'),
                                      ('malformed', 'malformed')])
def test_unreadable_pdf_defers_with_reason_and_preserves_source(
    pdf_vault: Path, monkeypatch: pytest.MonkeyPatch, kind: str, reason: str,
) -> None:
    path = pdf_vault / 'inbox/report.pdf'
    if kind == 'malformed':
        path.write_bytes(b'%PDF-1.7\nThis is a deliberately malformed synthetic PDF.\n')
        original = path.read_bytes()
    else:
        original = pdf_file(path, encrypted=kind == 'encrypted')
    entry = intake.snapshot(pdf_vault, 'inbox/report.pdf')
    context = intake.model_context(pdf_vault, entry)
    assert len(context['reading']) == 1, 'PDF extraction failures must be explicit evidence'
    assert context['reading'][0]['excerpt'] == ''
    assert reason in context['reading'][0]['reason'].lower()

    def forbidden_model(*_args: object, **_kwargs: object) -> None:
        pytest.fail('A PDF with no readable evidence must defer without a model invocation')

    monkeypatch.setattr(intake, 'model_call', forbidden_model)
    decision = intake.classify(pdf_vault, pdf_vault / '.reader/run', entry, 'unused-model')
    assert decision['disposition'] == 'defer'
    assert reason in decision['reason'].lower()
    assert path.read_bytes() == original
