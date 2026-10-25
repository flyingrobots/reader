"""`reader demo`: build a disposable example vault and open the web reader on it.

The vault holds public-domain texts and clearly fictional notes, voices and projects (see
content/NOTICE.md). It is rebuilt on every run so its dates stay relative to today, and the builder
only ever writes into a new or empty directory or one carrying the demo marker."""
import os
from pathlib import Path
import socket
import sys
import threading
import webbrowser

DEFAULT_PORT = 8780


def default_dir():
    return Path.home() / 'Reader Demo'


def add_arguments(parser):
    parser.add_argument('--dir', help='Where to build the demo vault (default: ~/Reader Demo). Must be new, empty, or an earlier demo')
    parser.add_argument('--port', type=int, help=f'Web port (default {DEFAULT_PORT}, or any free port when it is taken); 0 picks a free port')
    parser.add_argument('--open', action='store_true', help='Open the reader in your browser')
    parser.add_argument('--keep', action='store_true', help='Serve an existing demo vault as it is instead of rebuilding it')
    parser.add_argument('--no-serve', action='store_true', help='Build the vault and its indexes, then exit')
    parser.add_argument('--semantic', action='store_true',
                        help='Allow downloading the embedding model (~130 MB, once) to enable semantic search')
    parser.add_argument('--export-static', metavar='DIR',
                        help='Write the demo as a static website into DIR (new, empty, or an earlier export) instead of serving it')
    parser.add_argument('--base-path', default='/', help='With --export-static: the URL path the site is served under, such as /reader/ (default /)')
    parser.add_argument('--site-url', help='With --export-static: the public https:// URL of the site, for social previews and the canonical link')


def say(message):
    print(message, flush=True)


def run(args):
    if not args.semantic:
        # Nothing in a demo run may reach the network for model files unless asked to.
        os.environ['HF_HUB_OFFLINE'] = '1'
    from . import build as builder
    if getattr(args, 'export_static', None):
        export_static(args, builder)
        return
    root = Path(args.dir).expanduser() if args.dir else default_dir()
    if not root.is_absolute():
        root = Path.cwd() / root
    kept = args.keep and builder.marker_info(root) is not None
    if args.keep and not kept:
        say(f'No demo vault at {root} to keep; building one.')
    if not kept:
        builder.check(root)
        existed = builder.marker_info(root) is not None
        say(('Refreshing' if existed else 'Building') + f' the Reader demo vault in {root} …')
        builder.build(root)
        semantic = args.semantic or builder.semantic_model_present(root)
        if args.semantic:
            say('Downloading the embedding model if needed (BAAI/bge-small-en-v1.5, about 130 MB) …')
        builder.index(root, semantic)
        if semantic:
            say('Search: keyword, fuzzy and semantic.')
        else:
            say('Search: keyword and fuzzy. Semantic search is off because the embedding model is not on this machine.\n'
                f'  To enable it, run: reader demo --semantic --dir {_quote(root)}  (downloads about 130 MB once; refreshes keep it)')
    say('Chat voices are scripted demo voices (no AI). To use a real model, point a voice in '
        f'{root / "voices.json"} at an installed agent CLI; see "Voice registry" in docs/web.md (templates/voices.json is a starting point).')
    if args.no_serve:
        say(f'Demo vault ready: {root}')
        return
    serve(root, args.port, args.open)


def export_static(args, builder):
    """Build a demo vault (in a temporary folder unless --dir is given), then export it as a static site."""
    import tempfile
    from . import static
    out = Path(args.export_static).expanduser()
    static.check_output(out.absolute())
    base = static.normal_base(args.base_path)
    with tempfile.TemporaryDirectory(prefix='reader-demo-') as scratch:
        root = Path(args.dir).expanduser().absolute() if args.dir else Path(scratch) / 'vault'
        if not (args.keep and builder.marker_info(root) is not None):
            builder.check(root)
            say(f'Building the Reader demo vault in {root} …')
            builder.build(root)
            builder.index(root, args.semantic or builder.semantic_model_present(root))
        static.export(root, out, base, args.site_url, say=say)
    say(f'Static demo written to {out}. Serve it with any static web server; nothing in it calls a Reader server.')


def _quote(path):
    import shlex
    return shlex.quote(str(path))


def free(port):
    with socket.socket() as probe:
        try:
            probe.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False


def serve(root, port=None, open_browser=False):
    from ..web import WebLibrary, WebServer
    if port is None:
        port = DEFAULT_PORT if free(DEFAULT_PORT) else 0
    library = WebLibrary(root)
    try:
        server = WebServer(('127.0.0.1', port), library, 'You')
    except OSError as exc:
        library.close()
        raise OSError(f'Port {port} is not available ({exc.strerror}); pass --port 0 for any free port') from exc
    url = f'http://127.0.0.1:{server.server_port}/'
    say(f'Reader demo: {url}\nPress Ctrl-C to stop. Your own library stays untouched; this serves only {root}.')
    if open_browser:
        threading.Timer(0.3, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        library.close()
        server.server_close()


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(prog='reader demo', description=__doc__.splitlines()[0])
    add_arguments(parser)
    try:
        run(parser.parse_args(argv))
    except (ValueError, OSError) as exc:
        print(f'Reader: {exc}', file=sys.stderr)
        sys.exit(1)
