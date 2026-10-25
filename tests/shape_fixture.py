"""Synthetic articles and a deterministic topic model for article shapes (tests/test_shape.py, web_fixture --shapes).

The model counts words from a few invented topic groups: plumbing evidence for the
projection, not semantic quality."""
import re

import numpy as np

TOPICS = [('river', 'delta', 'current', 'estuary', 'silt'), ('lantern', 'wick', 'flame', 'glow', 'ember'),
          ('ledger', 'column', 'tally', 'balance', 'audit'), ('orchard', 'graft', 'blossom', 'pruning', 'harvest'),
          ('compass', 'bearing', 'meridian', 'heading', 'chart'), ('loom', 'weft', 'shuttle', 'warp', 'thread'),
          ('bellows', 'anvil', 'forge', 'quench', 'temper'), ('glacier', 'moraine', 'crevasse', 'firn', 'serac')]
FILLER = ['The keeper notes how each {a} turns toward the {b}, and why a patient reader follows the {c} past the {d}. ',
          'Every {a} answers the {b}; we watched the {c} lean into the {d} until evening. ',
          'Some say the {a} remembers its {b}, while the {c} forgets the {d} entirely. ',
          'Between the {a} and the {b} lies a quiet {c}, older than any {d}. ']


class TopicModel:
    def vector(self, text):
        words = re.findall(r'\w+', text.casefold())
        raw = np.array([sum(words.count(w) for w in group) for group in TOPICS] + [0.2], dtype=np.float32)
        return raw / max(float(np.linalg.norm(raw)), 1e-6)

    def passage_embed(self, texts, **kwargs):
        for text in texts:
            yield self.vector(text)

    def query_embed(self, text):
        yield self.vector(text)


def section(topic, length=1500, mix=None):
    """About `length` characters of prose on one topic (optionally blended with a second)."""
    words = TOPICS[topic] + (TOPICS[mix] if mix is not None else ())
    out, i = [], 0
    while sum(map(len, out)) < length:
        out.append(FILLER[i % len(FILLER)].format(a=words[i % len(words)], b=words[(i + 1) % len(words)], c=words[(i + 2) % len(words)], d=words[(i + 3) % len(words)]))
        i += 1
    return ''.join(out).strip()


def wandering(title='A long walk through the valley'):
    """An essay that wanders through six topics and returns to where it began."""
    parts = [f'---\ntitle: {title}\nauthor: Ada\n---\n\n# {title}\n']
    for number, topic in enumerate([0, 1, 4, 5, 6, 7, 0], 1):
        parts.append(f'## Part {number}\n\n{section(topic, 1500)}\n\n{section(topic, 900, mix=(topic + 1) % len(TOPICS))}\n')
    return '\n'.join(parts)


def tight(title='Notes on a single ledger'):
    """A note that circles one idea: ledgers, with a little of the orchard."""
    parts = [f'---\ntitle: {title}\nauthor: Bo\n---\n\n# {title}\n']
    for number in range(1, 7):
        parts.append(f'{section(2, 1100, mix=3 if number % 2 else None)}\n')
    return '\n'.join(parts)


def neighbours():
    """Short works, one per topic, for nearest-neighbour stars."""
    return {f'library/near/{TOPICS[t][0]}.md': f'# On the {TOPICS[t][0]}\n\n{section(t, 600)}\n' for t in range(len(TOPICS))}
