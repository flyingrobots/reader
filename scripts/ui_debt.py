#!/usr/bin/env python3
"""Count what stands between the interface and plain shadcn: custom CSS tokens, hand-written CSS rules and hard-coded inline styles.

    python3 scripts/ui_debt.py          # counts, with the worst files
    python3 scripts/ui_debt.py --json

tests/test_ui_debt.py holds each count to a ceiling that only moves down. A token is custom when its name isn't in shadcn's
set. An inline style is hard-coded when its value is a literal; a value computed at run time, such as a popover's position, isn't."""
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / 'src/reader_mcp/web_ui'
SRC = ROOT / 'web/src'
CSS = [UI / 'style.css', UI / 'harvest.css', SRC / 'styles.css']
SHADCN = re.compile(r'--(color-)?(background|foreground|card(-foreground)?|popover(-foreground)?|primary(-foreground)?|secondary(-foreground)?|muted(-foreground)?'
                    r'|accent(-foreground)?|destructive(-foreground)?|border|input|ring|radius(-\w+)?|chart-\d+|sidebar(-[a-z-]+)?|font-\w+)$')
DEFINED = re.compile(r'(?:^|[{;\s])(--[a-zA-Z][\w-]*)\s*:')
LITERAL = r"""(?:'[^'$`]*'|"[^"$`]*"|`[^`$]*`|-?\d[\d.]*)"""
INLINE = [re.compile(r'''\bstyle="[^"$]+"'''),                                    # Markup, and markup in template strings.
          re.compile(r'\bstyle=\{\{[^}]*?:\s*' + LITERAL + r'\s*[,}]'),           # React.
          re.compile(r'\.style\.(?!setProperty|removeProperty)\w+\s*=\s*' + LITERAL + r'\s*[;,)\n]'),  # DOM.
          re.compile(r'\.style\.setProperty\(\s*' + LITERAL + r'\s*,\s*' + LITERAL + r'\s*\)'),
          re.compile(r'\.style\.cssText\s*=')]


def sources():
    yield from UI.glob('*.mjs')
    yield UI / 'index.html'
    for path in SRC.rglob('*'):
        if path.suffix in ('.ts', '.tsx'):
            yield path


def count():
    tokens, rules = {}, {}
    for path in CSS:
        text = re.sub(r'/\*.*?\*/', '', path.read_text(), flags=re.S)
        names = set(DEFINED.findall(text))
        tokens[path.relative_to(ROOT).as_posix()] = sorted(name for name in names if not SHADCN.match(name))
        rules[path.relative_to(ROOT).as_posix()] = text.count('{')
    inline = {}
    for path in sources():
        text = path.read_text()
        found = sum(len(pattern.findall(text)) for pattern in INLINE)
        if found:
            inline[path.relative_to(ROOT).as_posix()] = found
    return {'custom_tokens': len({name for names in tokens.values() for name in names}), 'css_rules': sum(rules.values()),
            'hard_coded_inline_styles': sum(inline.values()), 'tokens': tokens, 'rules': rules, 'inline': inline}


if __name__ == '__main__':
    result = count()
    if '--json' in sys.argv:
        print(json.dumps(result, indent=1))
    else:
        print(f"custom tokens {result['custom_tokens']}, CSS rules {result['css_rules']}, hard-coded inline styles {result['hard_coded_inline_styles']}")
        for name, total in sorted(result['inline'].items(), key=lambda row: -row[1]):
            print(f'  {total:4} {name}')
