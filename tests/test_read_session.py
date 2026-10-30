"""No model, service, account, network or real vault is needed for these tests."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

FILE = Path(__file__).resolve().parents[1] / 'skills/reflective-reading/scripts/read_session.py'
spec = importlib.util.spec_from_file_location('read_session', FILE)
reading = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reading)


class ReadingBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.vault = self.root / 'vault'
        (self.vault / 'library').mkdir(parents=True)
        self.source = self.vault / 'library/work.md'
        self.source.write_text('An existing source.\n')
        self.notes = self.root / 'notes'
        self.notes.mkdir()

    def test_existing_source_is_allowed(self):
        self.assertEqual(reading.source_path(self.vault, 'library/work.md'), self.source)

    def test_traversal_and_symlink_escape_are_refused(self):
        outside = self.root / 'outside.md'
        outside.write_text('Not in the library')
        (self.vault / 'library/link.md').symlink_to(outside)
        for path in ['../outside.md', str(outside), 'library/link.md']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                reading.source_path(self.vault, path)

    def test_demo_vault_and_label_are_refused(self):
        marker = self.vault / '.reader-demo-vault'
        marker.write_text('{"kind":"reader-demo-vault"}')
        with self.assertRaises(ValueError):
            reading.source_path(self.vault, 'library/work.md')
        marker.unlink()
        self.source.write_text('---\nrights: "Fictional: invented for the Reader demo"\n---\n')
        with self.assertRaises(ValueError):
            reading.source_path(self.vault, 'library/work.md')

    def test_process_has_deadline_and_terminates(self):
        with self.assertRaisesRegex(RuntimeError, 'time or'):
            reading.run([sys.executable, '-c', 'import time; time.sleep(30)'], '', self.notes, 0.1)

    def test_notes_limit_stops_writer(self):
        script = 'import pathlib,time; pathlib.Path(%r).write_bytes(b"x"*2048); time.sleep(30)' % str(self.notes / 'large')
        with patch.object(reading, 'MAX_NOTES', 1024), self.assertRaisesRegex(RuntimeError, 'notes limit'):
            reading.run([sys.executable, '-c', script], '', self.notes, 5)

    def test_failed_child_status_is_not_success(self):
        self.assertEqual(reading.run([sys.executable, '-c', 'raise SystemExit(13)'], '', self.notes, 5), 13)

    def test_timeout_kills_term_ignoring_process(self):
        script = 'import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(30)'
        with self.assertRaisesRegex(RuntimeError, 'time or'):
            reading.run([sys.executable, '-c', script], '', self.notes, 0.5)

    def valid_report(self):
        selection = dict(source=str(self.source), sha256='a' * 64, first_line=1, last_line=1)
        report = dict(source_path=selection['source'], source_sha256=selection['sha256'],
                      first_line=1, last_line=1, status='complete', summary='An existing source.',
                      coverage_note='Read the one selected line.', opinion='A small fixture.', uncertainties=[])
        path = self.notes / 'report.json'
        path.write_text(json.dumps(report))
        return path, selection, report

    def test_valid_report_matches_exact_selection(self):
        path, selection, report = self.valid_report()
        self.assertEqual(reading.validate_report(path, selection), report)

    def test_missing_malformed_and_symlink_reports_fail(self):
        path, selection, _ = self.valid_report()
        path.unlink()
        with self.assertRaises(RuntimeError):
            reading.validate_report(path, selection)
        path.write_text('not json')
        with self.assertRaises(RuntimeError):
            reading.validate_report(path, selection)
        path.unlink()
        path.symlink_to(self.source)
        with self.assertRaises(RuntimeError):
            reading.validate_report(path, selection)

    def test_wrong_source_hash_and_range_fail(self):
        path, selection, report = self.valid_report()
        for key, wrong in [('source_path', 'another.md'), ('source_sha256', 'b' * 64),
                           ('first_line', True), ('last_line', 2)]:
            with self.subTest(key=key):
                path.write_text(json.dumps({**report, key: wrong}))
                with self.assertRaises(RuntimeError):
                    reading.validate_report(path, selection)

    def test_incomplete_and_empty_coverage_fail(self):
        path, selection, report = self.valid_report()
        for changes in [{'status': 'incomplete'}, {'coverage_note': ' '}, {'uncertainties': 'none'}]:
            path.write_text(json.dumps({**report, **changes}))
            with self.assertRaises(RuntimeError):
                reading.validate_report(path, selection)


if __name__ == '__main__':
    unittest.main()
