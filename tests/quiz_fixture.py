"""Disposable quiz browser library; fake voices, synthetic prose, no private vault."""
import json
from pathlib import Path
import sys
import tempfile

from chat_vault import make_vault
from test_quizzes import TEXT, proposed
from reader_mcp.web import WebLibrary, WebServer

with tempfile.TemporaryDirectory(prefix='reader-quiz-browser-') as temporary:
    root = make_vault(Path(temporary) / 'vault')
    (root / 'library/thought.md').write_text(TEXT.replace('The first color is red.', 'The **first** color is red.') + '\n\n' + '\n\n'.join(
        f'## Observation {i}\n\nA reader can return to this synthetic paragraph {i}. '
        'The paragraph is long enough to make pages, while the five color sentences stay unique. '
        'Its purpose is to exercise passage navigation across the continuous and two-page layouts.'
        for i in range(1, 45)))
    raw = proposed()
    raw[0]['evidence']['quote'] = 'The **first** color is red.'
    raw[-1].update(type='short', rubric='Names purple, as stated in the fifth sentence.')
    registry = json.loads((root / 'voices.json').read_text())
    for voice in registry['voices']:
        if voice.get('cli'):
            voice['argv'] += ['--quiz-json', json.dumps({'questions': raw}), '--quiz-review-json',
                              json.dumps({'verdict': 'right', 'comment': 'The fifth sentence names purple.'})]
            voice['argv'] += ['--writing-prompt-json', json.dumps({'question': 'Which color would you choose, and why?', 'quote': 'The **first** color is red.'})]
    (root / 'voices.json').write_text(json.dumps(registry))
    library = WebLibrary(root, chat_options={'git_locks': False})
    server = WebServer(('127.0.0.1', 0), library, participant='Browser tester')
    print(json.dumps({'url': 'http://127.0.0.1:' + str(server.server_port) + '/', 'root': str(root)}), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        library.close()
