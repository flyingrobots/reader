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
changes, so `reader_service.py tailscale on|off` applies without a restart.

A trusted front (docs/port/plan.md, PR 1) is off by default. When
READER_WEB_FRONT_SECRET is set, every request must carry that secret in
X-Reader-Front-Secret (compared in constant time) and the front's verdict in
X-Reader-Identity, or it is refused. The front then owns proxy recognition; this
server re-checks the client's Host and Origin, which the front forwards
unchanged, against the claimed identity and the same config. Without the secret
both headers are ignored, so a client never gains an identity by sending them."""
from email.header import decode_header, make_header
import hmac
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
FRONT_SECRET, FRONT_IDENTITY = 'X-Reader-Front-Secret', 'X-Reader-Identity'
MIN_FRONT_SECRET = 32  # characters, for the secret and for a front-supplied write token
MAX_FRONT_IDENTITY = 2048


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

    def front(self):
        """The trusted front's (secret, write token), or (None, None) when no front is configured.

        Raises ValueError, without echoing either value, when a configured value is too short."""
        secret = self.environ.get('READER_WEB_FRONT_SECRET') or None
        if secret is None:
            return None, None
        token = self.environ.get('READER_WEB_FRONT_TOKEN') or None
        if len(secret) < MIN_FRONT_SECRET:
            raise ValueError(f'READER_WEB_FRONT_SECRET must be at least {MIN_FRONT_SECRET} characters')
        if token is not None and len(token) < MIN_FRONT_SECRET:
            raise ValueError(f'READER_WEB_FRONT_TOKEN must be at least {MIN_FRONT_SECRET} characters')
        return secret, token

    def identify(self, headers, port):
        """Return the requester's identity or raise PermissionError."""
        host = headers.get('Host')
        origin = headers.get('Origin')
        try:
            secret, _ = self.front()
        except ValueError as exc:
            raise PermissionError(f'{exc}; requests are refused until it is fixed')
        if secret is not None:
            return self.identify_front(headers, secret, host, origin)
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
        return self.tailnet(config, login, decoded(headers.get('Tailscale-User-Name') or '')[:200] or None, origin)

    @staticmethod
    def tailnet(config, login, name, origin):
        if not login or login.casefold() not in {l.casefold() for l in config['allowed_logins']}:
            raise PermissionError('Not allowed')
        if origin and origin not in config['allowed_origins']:
            raise PermissionError('Cross-origin requests are refused')
        return {'via': 'tailscale', 'login': login, 'name': name}

    def identify_front(self, headers, secret, host, origin):
        """A request through the trusted front: its secret, its identity, and the client's Host and Origin.

        The front forwards the client's Host and Origin unchanged. It recognizes proxies itself, so forwarding
        and Tailscale identity headers are not consulted here; a Funnel marker is still refused."""
        offered = (headers.get(FRONT_SECRET) or '').encode('utf-8', 'surrogateescape')
        if not hmac.compare_digest(offered, secret.encode('utf-8', 'surrogateescape')):
            raise PermissionError('Requests must come through the Reader front')
        identity = front_identity(headers.get(FRONT_IDENTITY))
        if headers.get('Tailscale-Funnel-Request') is not None:
            raise PermissionError('Public (Funnel) requests are refused')
        if identity['via'] == 'local':
            # The front's public port, not ours, is in Host; any loopback port keeps rebinding out.
            hostname, _, port = (host or '').rpartition(':')
            if hostname not in ('127.0.0.1', 'localhost') or not port.isdigit():
                raise PermissionError('Unexpected Host')
            if origin and origin != 'http://' + host:
                raise PermissionError('Cross-origin requests are refused')
            return identity
        config = self.config()
        if config['trusted_proxy'] != 'tailscale':
            raise PermissionError('Proxied requests are refused; no trusted proxy is configured')
        name = (host or '').removesuffix(':443').rstrip('.')
        if not name or name.casefold() not in {h.casefold() for h in config['allowed_hosts']}:
            raise PermissionError('Unexpected Host')
        return self.tailnet(config, identity['login'], identity['name'], origin)


def front_identity(raw):
    """Parse X-Reader-Identity: {"via": "local", "login": null, "name": null} or a tailscale login and name."""
    try:
        identity = json.loads(raw) if raw and len(raw) <= MAX_FRONT_IDENTITY else None
    except ValueError:
        identity = None
    if not isinstance(identity, dict) or set(identity) != {'via', 'login', 'name'}:
        raise PermissionError('The Reader front sent no valid identity')
    via, login, name = identity['via'], identity['login'], identity['name']
    if via == 'local' and login is None and name is None:
        return identity
    if (via == 'tailscale' and isinstance(login, str) and 0 < len(login.strip()) <= 320
            and (name is None or isinstance(name, str) and len(name) <= 200)):
        return {'via': via, 'login': login.strip(), 'name': name or None}
    raise PermissionError('The Reader front sent no valid identity')


def decoded(value):
    """Tailscale may RFC 2047 'Q'-encode non-ASCII identity values."""
    if '=?' not in value:
        return value
    try:
        return str(make_header(decode_header(value)))
    except (ValueError, LookupError, UnicodeDecodeError):
        return value
