#!/usr/bin/env node
// Language-neutral latency bench for the server port (D1): builds a large synthetic vault (the
// pinned demo plus N generated Markdown works with headings and cross-links), refreshes its
// indexes with the CLI under test, then times the heavy read routes over HTTP against the server
// under test. Uses the contract harness, so READER_SERVER_CMD / READER_CLI_CMD pick the
// implementation and the same numbers can be taken for Python and TypeScript.
//
//   node scripts/port_bench.mjs [--works 2000] [--runs 5] [--keep]
//
// Prints one JSON report. Never touches a real vault; the synthetic vault is deleted unless --keep.
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {cli, makeVault, startServer} from '../tests/contract/harness.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const WORKS = arg('works', 2000);
const RUNS = arg('runs', 5);

// A deterministic generator: the same vault on every run and machine.
let seed = 42;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = list => list[Math.floor(random() * list.length)];
const WORDS = ('reader library margin passage edition version archive provenance careful thought solitude pond engine note '
  + 'highlight comment thread queue history search index shape chapter evidence claim source citation draft revision letter '
  + 'season river lantern sync device anchor relay storage design decision report journal guide research essay field').split(' ');
const PROJECTS = ['Atlas', 'Beacon', 'Cairn', 'Delta', 'Ember', 'Fable'];
const TYPES = ['Essay', 'Report', 'Note', 'Design proposal', 'Development journal'];
const sentence = () => {
  const n = 8 + Math.floor(random() * 14);
  const words = Array.from({length: n}, () => pick(WORDS));
  return words[0][0].toUpperCase() + words.join(' ').slice(1) + '.';
};

function generate(root) {
  const base = join(root, 'library/bench');
  for (let i = 0; i < WORKS; i++) {
    const project = PROJECTS[i % PROJECTS.length];
    const folder = join(base, project.toLowerCase());
    mkdirSync(folder, {recursive: true});
    const sections = [];
    for (let s = 1; s <= 4; s++) {
      const paragraphs = Array.from({length: 2}, () => Array.from({length: 4 + Math.floor(random() * 4)}, sentence).join(' '));
      const target = Math.floor(random() * WORKS);
      const link = random() < 0.5 ? `See [[work-${String(target).padStart(5, '0')}]].` : `Compare [work ${target}](../${PROJECTS[target % PROJECTS.length].toLowerCase()}/work-${String(target).padStart(5, '0')}.md#section-2).`;
      sections.push(`## Section ${s}\n\n${paragraphs.join('\n\n')}\n\n${link}\n`);
    }
    const day = String(1 + (i % 28)).padStart(2, '0');
    const text = `---\nfrontmatter_schema_version: 1\ndocument_revision: 1\ntitle: "Bench work ${i}: ${pick(WORDS)} and ${pick(WORDS)}"\n`
      + `author: "Author ${i % 37}"\nproject: "${project}"\ntype: "${pick(TYPES)}"\nadded: "2026-09-${day}"\n---\n\n# Bench work ${i}\n\n${sections.join('\n')}`;
    writeFileSync(join(folder, `work-${String(i).padStart(5, '0')}.md`), text);
  }
}

const time = async fn => {
  const start = performance.now();
  await fn();
  return performance.now() - start;
};
const stats = samples => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {median_ms: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10, min_ms: Math.round(sorted[0] * 10) / 10, max_ms: Math.round(sorted.at(-1) * 10) / 10};
};

const vault = makeVault();
const report = {works: WORKS, runs: RUNS, server: process.env.READER_SERVER_CMD || 'reference (Python)', build: {}, routes: {}};
try {
  report.build.generate_ms = Math.round(await time(() => generate(vault.root)));
  for (const args of [['browse'], ['index', '--no-semantic']]) {
    let run;
    const ms = await time(() => { run = cli(vault, args, {timeout: 600000}); });
    if (run.status !== 0) throw new Error(`${args.join(' ')}: ${run.stderr}`);
    report.build[args[0] + '_ms'] = Math.round(ms);
  }
  let server;
  report.build.server_start_ms = Math.round(await time(async () => { server = await startServer(vault); }));
  try {
    const sample = 'library/bench/atlas/work-00006.md';
    const routes = [
      ['library', '/api/library', {}],
      ['document', '/api/document', {path: sample}],
      ['search fuzzy', '/api/search', {q: 'lantern relay', mode: 'fuzzy'}],
      ['search keyword', '/api/search', {q: 'lantern relay', mode: 'keyword'}],
      ['search page words', '/api/search/page', {q: 'provenance archive', mode: 'words'}],
      ['search page best', '/api/search/page', {q: 'provenance archive', mode: 'best'}],
      ['link-counts', '/api/link-counts', {}],
      ['links', '/api/links', {path: sample}],
      ['next', '/api/next', {path: sample}],
      ['readers', '/api/readers', {path: sample}],
      ['shape', '/api/shape', {path: sample}],
      ['queue', '/api/queue', {}],
      ['history', '/api/history', {}],
      ['issue', '/api/issue', {start: '2026-10-19', end: '2026-10-25'}],
      ['editions/diagnostics', '/api/editions/diagnostics', {}],
      ['health', '/api/health', {}],
    ];
    for (const [name, path, query] of routes) {
      const first = await time(async () => { const r = await server.get(path, query); if (r.status !== 200) throw new Error(`${path}: ${r.status} ${r.text.slice(0, 200)}`); });
      const samples = [];
      let bytes = 0;
      for (let i = 0; i < RUNS; i++) samples.push(await time(async () => { bytes = (await server.get(path, query)).buffer.length; }));
      report.routes[name] = {first_ms: Math.round(first * 10) / 10, ...stats(samples), bytes};
    }
  } finally {
    await server.stop();
  }
} finally {
  if (!process.argv.includes('--keep')) vault.cleanup();
  else report.vault = vault.root;
}
console.log(JSON.stringify(report, null, 2));
