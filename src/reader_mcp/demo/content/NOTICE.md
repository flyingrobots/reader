# Reader demo content: sources and licenses

`reader demo` builds its example vault from the files in this folder. Everything here is either in
the public domain or invented for the demo and covered by Reader's Apache-2.0 license.

## Public-domain texts (`texts/`)

Excerpts, reformatted as Markdown (hard wraps joined, page markers removed),
from these Project Gutenberg eBooks. The underlying works were published before 1930 and are in
the public domain in the United States; every author died more than 70 years ago. The excerpts do
not include Project Gutenberg's license or header text. Project Gutenberg states that citing it as
the source is permitted (https://www.gutenberg.org/policy/permission.html), and each demo document
records its eBook number and URL in its frontmatter.

| File | Work | Author (translator) | First published | eBook |
| --- | --- | --- | --- | --- |
| `thoreau-*.md` | *Walden*: "Reading", "Solitude", "Where I Lived, and What I Lived For" | Henry David Thoreau | 1854 | [#205](https://www.gutenberg.org/ebooks/205) |
| `emerson-*.md` | *Essays, First Series*: "Self-Reliance", "Circles" | Ralph Waldo Emerson | 1841 | [#2944](https://www.gutenberg.org/ebooks/2944) |
| `montaigne-*.md` | *Essays*: "Of Idleness", "Of Solitude", "Of Books" | Michel de Montaigne (Charles Cotton) | 1580; tr. 1685 | [#3600](https://www.gutenberg.org/ebooks/3600) |
| `bacon-*.md` | *Essays*: "Of Studies", "Of Truth", "Of Gardens" | Francis Bacon | 1625 | [#575](https://www.gutenberg.org/ebooks/575) |
| `woolf-*.md` | *The Common Reader*: "The Common Reader", "Montaigne", "Modern Fiction", "The Modern Essay" | Virginia Woolf | 1925 | [#64457](https://www.gutenberg.org/ebooks/64457) |
| `darwin-*.md` | *On the Origin of Species*, chapters III and XIV | Charles Darwin | 1859 | [#1228](https://www.gutenberg.org/ebooks/1228) |
| `babbage-analytical-engine.md` | *Passages from the Life of a Philosopher*, chapter VIII | Charles Babbage | 1864 | [#57532](https://www.gutenberg.org/ebooks/57532) |
| `lovelace-note-g.md` | Note G of the translator's notes to Menabrea's *Sketch of the Analytical Engine* (paragraphs only; tables omitted) | Ada Lovelace | 1843 | [#75107](https://www.gutenberg.org/ebooks/75107) |

## Image (`assets/darwin-diagram.png`)

Charles Darwin's diagram of divergence, the only figure in *On the Origin of Species* (1859), from
Wikimedia Commons:
https://commons.wikimedia.org/wiki/File:Origin_of_Species_illustration_cropped.png. Commons marks it
as public domain (author's life plus 70 years or fewer; Public Domain Mark 1.0). Reduced to a
16-level grayscale palette for size.

## Invented content (`library/`, `assets/field-report.html`, `assets/lantern-0.9-field-report.pdf`, `voice/`)

Fictional, written for the demo: the Lantern project and its people (Mira Okafor, Jonah Reyes),
every number in its reports, logs and benchmarks, the newsletter, and the voices Archivist,
Architect, Plain Reader and Wren. Any resemblance to real projects or people is coincidental. In
the built vault these documents carry `rights: "Fictional: invented for the Reader demo"`. The PDF
is `field-report.html` printed by a browser. `voice/demo-voice.py` is a scripted stand-in for an
agent CLI: it prints canned replies from `voice/replies.json` and never calls a model.
