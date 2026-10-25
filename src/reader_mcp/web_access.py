"""Who may use Reader web, decided per request.

Reader binds to loopback only. A request is either *local* (a browser on this
Mac addressing 127.0.0.1 or localhost) or *proxied* by `tailscale serve`, which
connects from loopback, keeps the client's Host header and adds
X-Forwarded-For/-Host/-Proto plus Tailscale identity headers. Because Tailscale
passes the client's Host through unchanged, a proxied request is recognized by
its forwarding headers, never by its Host: any forwarding or Tailscale header
makes the request proxied, and a proxied request is refused unless the
`tailscale` proxy is configured, its Host is a configured tailnet name and its
Tailscale-User-Login is on the allow list. Identity headers therefore never
grant anything on a loopback Host.

Configuration lives in `<vault>/.reader/web-config.json`, with READER_WEB_*
environment overrides (comma-separated lists). It is re-read when the file
changes, so `reader_service.py tailscale on|off` applies without a restart."""
from email.header import decode_header, make_header
import json
import os
from pathlib import Path
import threading

CONFIG_NAME = '.reader/web-config.json'
MAX_CONFIG = 64 * 1024
LISTS = ('allowed_hosts', 'allowed_origins', 'allowed_logins')
# Headers a proxy adds. Tailscale strips client-supplied identity headers and
# always sets X-Forwarded-For and X-Forwarded-Host on what it forwards.
PROXY_HEADERS = ('X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto', 'Forwarded',
                 'Tailscale-User-Login', 'Tailscale-User-Name', 'Tailscale-User-Profile-Pic',
                 'Tailscale-Headers-Info', 'Tailscale-Funnel-Request')


def empty():
    return {'allowed_hosts': [], 'allowed_origins': [], 'allowed_logins': [], 'trusted_proxy': None}


def normalize(data):
    if not isinstance(data, dict):
        raise ValueError('Web config must be a JSON object')
    config = empty()
    for key in LISTS:
        values = data.get(key, [])
        if not isinstance(values, list) or len(values) > 64 or not all(isinstance(v, str) and 0 < len(v) <= 320 for v in values):
            raise ValueError(f'Web config {key} must be a list of at most 64 short strings')
        config[key] = [v.strip().rstrip('.') if key == 'allowed_hosts' else v.strip() for v in values]
    proxy = data.get('trusted_proxy')
    if proxy not in (None, '', 'tailscale'):
        raise ValueError('Web config trusted_proxy must be "tailscale" or empty')
    config['trusted_proxy'] = proxy or None
    return config


class WebAccess:
    """Loads the access config on demand and identifies each request."""

    def __init__(self, root, environ=None):
        self.file = Path(root) / CONFIG_NAME
        self.environ = os.environ if environ is None else environ
        self.lock = threading.Lock()
        self.cached = None

    def config(self):
        identity = None
        try:
            info = self.file.lstat()
            identity = (info.st_ino, info.st_mtime_ns, info.st_size)
        except FileNotFoundError:
            pass
        with self.lock:
            if self.cached and self.cached[0] == identity:
                return self.cached[1]
        if identity is None:
            data = {}
        else:
            if self.file.is_symlink() or self.file.parent.is_symlink() or not self.file.is_file() or identity[2] > MAX_CONFIG:
                raise PermissionError('Unsafe or oversized web config; requests are refused until it is fixed')
            try:
                data = json.loads(self.file.read_text())
            except (OSError, ValueError) as exc:
                raise PermissionError(f'Unreadable web config ({exc}); requests are refused until it is fixed')
        try:
            config = normalize(data)
            for key in LISTS:
                value = self.environ.get('READER_WEB_' + key.upper())
                if value is not None:
                    config[key] = normalize({key: [v for v in value.split(',') if v.strip()]})[key]
            if (value := self.environ.get('READER_WEB_TRUSTED_PROXY')) is not None:
                config['trusted_proxy'] = normalize({'trusted_proxy': value.strip()})['trusted_proxy']
        except ValueError as exc:
            raise PermissionError(f'{exc}; proxied requests are refused until it is fixed')
        with self.lock:
            self.cached = (identity, config)
        return config

    def identify(self, headers, port):
        """Return the requester's identity or raise PermissionError."""
        host = headers.get('Host')
        origin = headers.get('Origin')
        if not any(headers.get(name) is not None for name in PROXY_HEADERS):
            if host not in (f'127.0.0.1:{port}', f'localhost:{port}'):
                raise PermissionError('Unexpected Host')
            if origin and origin not in (f'http://127.0.0.1:{port}', f'http://localhost:{port}'):
                raise PermissionError('Cross-origin requests are refused')
            return {'via': 'local', 'login': None, 'name': None}
        config = self.config()
        if config['trusted_proxy'] != 'tailscale':
            raise PermissionError('Proxied requests are refused; no trusted proxy is configured')
        if headers.get('Tailscale-Funnel-Request') is not None:
            raise PermissionError('Public (Funnel) requests are refused')
        name = (host or '').removesuffix(':443').rstrip('.')
        hosts = {h.casefold() for h in config['allowed_hosts']}
        forwarded = (headers.get('X-Forwarded-Host') or '').removesuffix(':443').rstrip('.')
        if not name or name.casefold() not in hosts or forwarded.casefold() != name.casefold():
            raise PermissionError('Unexpected Host')
        login = (headers.get('Tailscale-User-Login') or '').strip()
        login = decoded(login)
        if not login or login.casefold() not in {l.casefold() for l in config['allowed_logins']}:
            raise PermissionError('Not allowed')
        if origin and origin not in config['allowed_origins']:
            raise PermissionError('Cross-origin requests are refused')
        return {'via': 'tailscale', 'login': login, 'name': decoded(headers.get('Tailscale-User-Name') or '')[:200] or None}


def decoded(value):
    """Tailscale may RFC 2047 'Q'-encode non-ASCII identity values."""
    if '=?' not in value:
        return value
    try:
        return str(make_header(decode_header(value)))
    except (ValueError, LookupError, UnicodeDecodeError):
        return value
