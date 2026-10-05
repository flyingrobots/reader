"""Versioned document metadata and the stricter Reader catalog profile.

Files remain canonical. Legacy interpretation never rewrites their bytes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
import json
import math
from pathlib import Path, PurePosixPath
import re
from uuid import UUID
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError, field_validator
import yaml

SCHEMA_VERSION = 1
CATALOG_TYPES = {'report', 'note', 'reference', 'document', 'book'}
MAX_HEADER = 16_384
CalendarDate = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$",
                                    json_schema_extra={"format": "date"})]


class DocumentMetadata(BaseModel):
    """Shared v1 fields; document-specific JSON properties remain extensible."""

    model_config = ConfigDict(extra='allow', strict=True)
    __pydantic_extra__: dict[str, JsonValue] = Field(init=False)
    frontmatter_schema_version: Literal[1]
    document_revision: Annotated[int, Field(strict=True, ge=1, le=9223372036854775807)]
    title: Annotated[str, Field(min_length=1, max_length=1000, pattern=r"\S")]
    type: Annotated[str, Field(min_length=1, max_length=100, pattern=r"\S")]
    added: CalendarDate | None = None
    created: CalendarDate | None = None
    updated: CalendarDate | None = None
    author: str | list[str] | None = None
    source: str | None = None
    tags: list[str] | None = None

    @field_validator('frontmatter_schema_version', mode='before')
    @classmethod
    def exact_version(cls, value):
        if type(value) is not int or value != SCHEMA_VERSION:
            raise ValueError('supported schema version is integer 1')
        return value

    @field_validator('title', 'type')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('must not be blank')
        return value

    @field_validator('added', 'created', 'updated')
    @classmethod
    def calendar_date(cls, value):
        if value is not None:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
                raise ValueError('use a calendar date in YYYY-MM-DD form')
            date.fromisoformat(value)
        return value


class CatalogMetadata(DocumentMetadata):
    """Curated catalog notes also need a filing date and Reader document kind."""

    added: CalendarDate
    type: Literal['report', 'note', 'reference', 'document', 'book']


class CatalogEnvelope(DocumentMetadata):
    """Catalog identity belongs to its metadata owner, which may be a sidecar."""

    document_id: Annotated[str, Field(json_schema_extra={'format': 'uuid'})]
    document_path: str
    metadata_created: CalendarDate
    kind: str | None = None
    tags: list[str] = Field(default_factory=list)
    # Accepted for old catalog records only; new records omit this alias.
    schema_version: Literal[1] | None = Field(default=None, deprecated=True)

    @field_validator('metadata_created')
    @classmethod
    def metadata_date(cls, value):
        date.fromisoformat(value)
        return value

    @field_validator('document_id')
    @classmethod
    def identity(cls, value):
        UUID(value)
        return value

    @field_validator('document_path')
    @classmethod
    def library_path(cls, value):
        path = PurePosixPath(value)
        if (not value.startswith('library/') or path.is_absolute() or '..' in path.parts
                or str(path) != value or '\\' in value or any(ord(c) < 32 for c in value)):
            raise ValueError('document_path must be a normalized library-relative path')
        return value

    @field_validator('schema_version', mode='before')
    @classmethod
    def legacy_alias(cls, value):
        if value is not None and (type(value) is not int or value != SCHEMA_VERSION):
            raise ValueError('legacy schema_version must be integer 1')
        return value


def catalog_record(raw):
    return all(key in raw for key in ('document_id', 'document_path', 'metadata_created'))


def validate_record(raw, profile='document', *, allow_legacy=False):
    """One field validator for document, curated note, and catalog envelope data."""
    clean = _json_value(raw)
    legacy = not any(key in clean for key in ('frontmatter_schema_version', 'document_revision'))
    if legacy and profile == 'envelope' and (type(clean.get('schema_version')) is not int or clean.get('schema_version') != 1):
        raise ValueError('Missing or unsupported legacy schema_version')
    if legacy and not allow_legacy:
        raise ValueError('Missing frontmatter_schema_version and document_revision')
    if legacy:
        clean.update(frontmatter_schema_version=SCHEMA_VERSION, document_revision=1)
    model = {'document': DocumentMetadata, 'catalog': CatalogMetadata,
             'envelope': CatalogEnvelope}[profile]
    result = model.model_validate(clean).model_dump(exclude_unset=True)
    if legacy:
        result.pop('frontmatter_schema_version', None)
        result.pop('document_revision', None)
    return result


def schema(profile='document'):
    model = {'catalog': CatalogMetadata, 'envelope': CatalogEnvelope}.get(profile, DocumentMetadata)
    return model.model_json_schema()


@dataclass
class MetadataResult:
    metadata: dict = field(default_factory=dict)
    status: str = 'absent'
    profile: str = 'source'
    diagnostics: list[dict] = field(default_factory=list)

    def public(self):
        return {'metadata': self.metadata, 'metadata_status': self.status,
                'metadata_profile': self.profile, 'metadata_diagnostics': self.diagnostics}


class UniqueLoader(yaml.SafeLoader):
    """Reject duplicate keys instead of silently accepting the last value."""

    def compose_node(self, parent, index):
        if self.check_event(yaml.AliasEvent):
            raise ValueError('YAML aliases are not supported')
        return super().compose_node(parent, index)

    def construct_mapping(self, node, deep=False):
        if any(key.tag == 'tag:yaml.org,2002:merge' for key, _ in node.value):
            raise ValueError('YAML merge keys are not supported')
        result = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, str):
                raise ValueError('metadata property names must be strings')
            if key in result:
                raise ValueError(f'duplicate metadata property: {key}')
            result[key] = self.construct_object(value_node, deep=deep)
        return result


def _json_value(value, active=None, budget=None, depth=0):
    active = set() if active is None else active
    budget = [10_000] if budget is None else budget
    budget[0] -= 1
    if budget[0] < 0 or depth > 20:
        raise ValueError('metadata exceeds the supported depth or value count')
    if value is None or type(value) in (str, bool, int):
        return value
    if type(value) is float:
        if not math.isfinite(value):
            raise ValueError('metadata numbers must be finite')
        return value
    if type(value) in (date, datetime):
        return value.isoformat()
    if isinstance(value, (dict, list)):
        if id(value) in active:
            raise ValueError('cyclic YAML values are not supported')
        active.add(id(value))
        try:
            if isinstance(value, list):
                return [_json_value(v, active, budget, depth + 1) for v in value]
            if not all(isinstance(k, str) for k in value):
                raise ValueError('metadata property names must be strings')
            return {k: _json_value(v, active, budget, depth + 1) for k, v in value.items()}
        finally:
            active.remove(id(value))
    raise ValueError(f'unsupported YAML value type: {type(value).__name__}')


def _style_diagnostics(header):
    """Explicit v1 authoring uses block collections and plain property names."""
    node = yaml.compose(header, Loader=UniqueLoader)
    findings, seen = [], set()

    def walk(item, path='$'):
        if id(item) in seen:
            return
        seen.add(id(item))
        if isinstance(item, yaml.MappingNode):
            if item.flow_style:
                findings.append({'field': path, 'code': 'yaml_style',
                                 'message': 'Use block mappings and plain property names.'})
            for key, value in item.value:
                if key.style is not None:
                    findings.append({'field': path, 'code': 'yaml_style',
                                     'message': 'Property names must be unquoted.'})
                walk(value, path + '.' + key.value)
        elif isinstance(item, yaml.SequenceNode):
            if item.flow_style and item.value:
                findings.append({'field': path, 'code': 'yaml_style',
                                 'message': 'Use block lists; empty lists may use [].'})
            for index, value in enumerate(item.value):
                walk(value, path + '.' + str(index))
    walk(node)
    return findings


class FrontmatterError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def decode_frontmatter(data):
    """Read a bounded UTF-8 header once; keep body bytes and source values intact."""
    offset = 3 if data.startswith(b'\xef\xbb\xbf') else 0
    payload = data[offset:]
    opening = re.match(rb'\A---\r?\n', payload)
    if opening is None:
        return None, data, ''
    bounded = payload[:MAX_HEADER]
    closing = re.search(rb'(?m)^---\r?(?:\n|$)', bounded[opening.end():])
    if closing is not None:
        end = opening.end() + closing.end()
        if end == len(bounded) and len(payload) > len(bounded) and not closing.group().endswith(b'\n'):
            closing = None
    if closing is None:
        raise FrontmatterError('invalid_frontmatter', 'Closing delimiter absent within 16 KiB.')
    try:
        header = bounded[opening.end():opening.end() + closing.start()].decode('utf-8')
    except UnicodeDecodeError as exc:
        raise FrontmatterError('invalid_encoding', 'Frontmatter must use valid UTF-8 bytes.') from exc
    try:
        raw = yaml.load(header, Loader=UniqueLoader)
        if not isinstance(raw, dict):
            raise ValueError('frontmatter must be a mapping')
    except (yaml.YAMLError, ValueError, RecursionError) as exc:
        raise FrontmatterError('invalid_yaml', str(exc)) from exc
    return raw, payload[opening.end() + closing.end():], header


def frontmatter(data):
    """Shared strict codec for callers that require a complete valid header."""
    raw, body, header = decode_frontmatter(data)
    if raw is None:
        return {}, body
    clean = _json_value(raw)
    explicit = any(key in clean for key in ('frontmatter_schema_version', 'document_revision'))
    if explicit:
        issues = _style_diagnostics(header)
        if issues:
            raise ValueError(issues[0]['message'])
    if explicit:
        validate_record(clean, 'envelope' if catalog_record(clean) else 'document')
    return clean, body


def parse_metadata(data: bytes, *, catalog=False, profile='auto') -> MetadataResult:
    """Diagnostics never discard source text; legacy versions remain source-absent."""
    result = MetadataResult(profile='catalog' if catalog or profile == 'catalog' else 'source')
    try:
        raw, body, header = decode_frontmatter(data)
    except FrontmatterError as exc:
        result.status = 'invalid'
        result.diagnostics.append({'field': '$', 'code': exc.code, 'message': str(exc)})
        return result
    if raw is None:
        if catalog or profile in {'catalog', 'document', 'envelope'}:
            result.status = 'invalid'
            result.diagnostics.append({'field': '$', 'code': 'missing_frontmatter',
                                       'message': 'Required frontmatter is absent.'})
        return result
    versioned = 'frontmatter_schema_version' in raw or 'document_revision' in raw
    envelope = profile == 'envelope' or catalog_record(raw)
    curated = not envelope and (catalog or profile == 'catalog' or (profile == 'auto' and
               'added' in raw and isinstance(raw.get('type'), str) and raw['type'] in CATALOG_TYPES))
    constrained = versioned or curated or envelope or profile == 'document'
    result.profile = 'envelope' if envelope else ('catalog' if curated else ('document' if constrained else 'source'))
    clean = {}
    budget = [10_000]
    for key, value in raw.items():
        try:
            clean[key] = _json_value(value, budget=budget)
        except ValueError as exc:
            result.diagnostics.append({'field': key, 'code': 'invalid_value', 'message': str(exc)})
    if not constrained:
        result.metadata = clean
        result.status = 'source' if not result.diagnostics else 'invalid'
        return result
    if versioned:
        result.diagnostics.extend(_style_diagnostics(header))
    legacy = not versioned
    try:
        validated = validate_record(clean, result.profile, allow_legacy=True)
        if result.diagnostics:
            result.status = 'invalid'
            return result
        result.metadata = validated
        result.status = 'legacy' if legacy else 'valid'
        if legacy:
            result.diagnostics.append({'field': '$', 'code': 'legacy_metadata',
                'message': 'Validated with v1 rules; the source declares no canonical schema version or document revision.'})
    except (ValidationError, ValueError) as exc:
        result.status = 'invalid'
        if isinstance(exc, ValidationError):
            result.diagnostics.extend({'field': '.'.join(map(str, e['loc'])), 'code': e['type'],
                                       'message': e['msg']} for e in exc.errors())
        else:
            result.diagnostics.append({'field': '$', 'code': 'invalid_value', 'message': str(exc)})
    return result


def is_catalog(root: Path, relative: str) -> bool:
    """A delivery wrapper is a catalog; arbitrary originals are not wrappers."""
    path = root / relative
    receipt = path.parent / 'receipt.json'
    if path.name != 'index.md' or receipt.is_symlink() or not receipt.is_file():
        return False
    try:
        with receipt.open('rb') as stream:
            data = stream.read(128 * 1024 + 1)
        if len(data) > 128 * 1024:
            return False
        value = json.loads(data)
        return isinstance(value, dict) and value.get('reader_receipt') == 1
    except (OSError, ValueError):
        return False


def inspect_metadata(root: Path, relative: str, data: bytes) -> MetadataResult:
    if Path(relative).suffix.lower() != '.md':
        return MetadataResult()
    return parse_metadata(data, catalog=is_catalog(root, relative))


def validate_paths(root: Path, paths=(), *, allow_legacy=False, profile='auto') -> dict:
    """Read-only validation. Explicit paths remain confined to library/."""
    from .search import source_bytes
    selected = list(paths) or sorted(str(p.relative_to(root)) for p in
                                   (root / 'library').rglob('*')
                                   if p.is_file() and p.suffix.lower() == '.md' and not p.is_symlink())
    entries = []
    for relative in selected:
        try:
            data = source_bytes(root, relative)
            result = parse_metadata(data, catalog=is_catalog(root, relative), profile=profile)
            valid = result.status not in {'invalid', 'legacy'} or (allow_legacy and result.status == 'legacy')
            entries.append({'path': relative, 'valid': valid, **result.public()})
        except (ValueError, OSError) as exc:
            entries.append({'path': relative, 'valid': False,
                            'metadata_diagnostics': [{'field': '$', 'code': 'unreadable', 'message': str(exc)}]})
    return {'valid': all(e['valid'] for e in entries), 'examined': len(entries),
            'invalid': sum(not e['valid'] for e in entries), 'documents': entries}
