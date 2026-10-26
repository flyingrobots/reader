#!/usr/bin/env node
/* Repeat browser suites under CPU load to measure flakes (RED/GREEN evidence for timing fixes).

   node scripts/browser-stress.mjs [--iterations 10] [--burners N] [--timeout 240] [--deadline 5]
                                   [--out DIR] [--log-budget 128] [--keep-passing] web_focus web_split ...

   Each iteration runs every named suite once, in order, as its own process group. --burners starts N busy-loop
   worker threads for the whole run (default: CPU count − 2; 0 for none). Every suite run is capped by --timeout
   seconds (SIGTERM, then SIGKILL), no suite starts after --deadline minutes, and logs are capped per run (2 MiB)
   and in total (--log-budget MiB); passing logs are deleted unless --keep-passing. Suites get an owned TMPDIR
   under --out, and leftover reader-web-fixture-* folders there are counted and removed afterwards.
   scripts/browser-stress-track.cjs is preloaded to count 429 and 5xx responses per run without changing the suite.
   The summary (per suite: runs, failures, failing steps, 429s) is printed and written to DIR/summary.json.
   Keep a run to about five minutes (the default deadline): ten repeats of one suite say more than a long campaign.
   See docs/web.md, "Browser flakes". */
import {spawn} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {availableParallelism, tmpdir} from 'node:os';
import {createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MiB = 1024 * 1024, RUN_LOG_CAP = 2 * MiB;
const options = {iterations: 10, burners: Math.max(0, availableParallelism() - 2), timeout: 240, deadline: 5, out: null, logBudget: 128, keepPassing: false};
const suites = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i], value = () => { if (i + 1 >= argv.length) throw new Error(arg + ' needs a value'); return argv[++i]; };
  if (arg === '--iterations') options.iterations = +value();
  else if (arg === '--burners') options.burners = +value();
  else if (arg === '--timeout') options.timeout = +value();
  else if (arg === '--deadline') options.deadline = +value();
  else if (arg === '--out') options.out = resolve(value());
  else if (arg === '--log-budget') options.logBudget = +value();
  else if (arg === '--keep-passing') options.keepPassing = true;
  else if (arg === '-h' || arg === '--help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\s?/, '')); process.exit(0); }
  else if (arg.startsWith('--')) throw new Error('Unknown option ' + arg);
  else suites.push(arg);
}
for (const key of ['iterations', 'burners', 'timeout', 'deadline', 'logBudget']) if (!Number.isFinite(options[key]) || options[key] < 0) throw new Error(`--${key} must be a non-negative number`);
if (!suites.length) throw new Error('Name at least one suite, such as web_focus or tests/web_focus.cjs');
const files = suites.map(name => { const file = join(root, 'tests', basename(name).replace(/\.cjs$/, '').replace(/^(?!web_)/, 'web_') + '.cjs'); if (!existsSync(file)) throw new Error('No such suite: ' + name); return file; });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = options.out || join(process.env.TMPDIR || tmpdir(), 'browser-stress-' + stamp);
const logs = join(out, 'logs'), responses = join(out, 'responses'), owned = join(out, 'tmp');
for (const dir of [logs, responses, owned]) mkdirSync(dir, {recursive: true});
const fixtures = dir => { try { return readdirSync(dir).filter(name => name.startsWith('reader-web-fixture-')); } catch { return []; } };
const parentTmp = process.env.TMPDIR || tmpdir();
const before = {owned: fixtures(owned).length, parent: fixtures(parentTmp).length};

// Busy loops on worker threads: they share this process, so they end with it and cannot be orphaned.
const burners = Array.from({length: options.burners}, () => new Worker('for(;;){}', {eval: true}));
burners.forEach(worker => worker.unref());

let child = null, stopping = false, logBytes = 0;
const started = Date.now(), deadline = started + options.deadline * 60_000, longest = new Map();
const stats = new Map(files.map(file => [basename(file, '.cjs'), {runs: 0, failures: 0, timeouts: 0, busy: 0, errors: 0, steps: {}, seconds: 0}]));
const failures = [];

function killGroup(proc, signal) { try { process.kill(-proc.pid, signal); } catch {} }
function stop(signal) {
  if (stopping) return; stopping = true;
  console.error(`\n${signal}: stopping the current suite and the burners`);
  if (child) { killGroup(child, 'SIGTERM'); setTimeout(() => child && killGroup(child, 'SIGKILL'), 10_000).unref(); }
}
process.on('SIGINT', () => stop('SIGINT')); process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGHUP', () => stop('SIGHUP'));

/** The first error line and the suite line it was thrown from, e.g. "web_focus.cjs:24 AssertionError: …". */
function step(text, name) {
  const error = text.match(/^\s*(?:\w*Error\b|[\w.]+: (?:Timeout|Error|Target)\b)[^\n]*/m)?.[0].trim() || text.trim().split('\n').pop() || 'no output';
  const line = text.match(new RegExp(name.replace('.', '\\.') + '\\.cjs:(\\d+)'))?.[1];
  return `${name}.cjs:${line || '?'} ${error.slice(0, 200)}`;
}

function runSuite(file, iteration) {
  const name = basename(file, '.cjs'), log = join(logs, `${String(iteration).padStart(3, '0')}-${name}.log`), tally = join(responses, `${String(iteration).padStart(3, '0')}-${name}.json`);
  const budget = Math.max(0, Math.min(RUN_LOG_CAP, options.logBudget * MiB - logBytes));
  const stream = createWriteStream(log);let written = 0, tail = '', truncated = false;
  const remaining = Math.max(5, Math.min(options.timeout, (deadline - Date.now()) / 1000 + 60));
  return new Promise(resolveRun => {
    const t0 = Date.now();
    child = spawn(process.execPath, ['--require', join(root, 'scripts', 'browser-stress-track.cjs'), file], {cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: {...process.env, TMPDIR: owned, READER_STRESS_RESPONSES: tally}});
    const take = chunk => {
      tail = (tail + chunk.toString()).slice(-64 * 1024);
      if (written < budget) { const part = chunk.subarray(0, budget - written); stream.write(part); written += part.length; }
      else if (!truncated) { truncated = true; stream.write('\n[browser-stress: log truncated at its cap]\n'); }
    };
    child.stdout.on('data', take); child.stderr.on('data', take);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killGroup(child, 'SIGTERM'); setTimeout(() => killGroup(child, 'SIGKILL'), 10_000).unref(); }, remaining * 1000);
    // When the suite exits, stop anything it left in its group (a fixture server holding the pipes open).
    const proc = child;
    proc.on('exit', () => { killGroup(proc, 'SIGTERM'); setTimeout(() => killGroup(proc, 'SIGKILL'), 5_000).unref(); });
    proc.on('close', (code, signal) => {
      clearTimeout(timer); child = null;
      const seconds = (Date.now() - t0) / 1000;
      stream.end(() => {
        const ok = code === 0 && !timedOut, s = stats.get(name);
        s.runs++; s.seconds += seconds; longest.set(name, Math.max(longest.get(name) || 0, seconds));
        let seen = null; try { seen = JSON.parse(readFileSync(tally, 'utf8')); s.busy += seen.busy; s.errors += seen.errors; } catch {}
        if (!ok) {
          s.failures++; if (timedOut) s.timeouts++;
          const where = timedOut ? `${name}.cjs:? harness timeout after ${Math.round(seconds)} s` : step(tail, name);
          s.steps[where] = (s.steps[where] || 0) + 1;
          failures.push({iteration, suite: name, step: where, code, signal, seconds: Math.round(seconds), log, responses: seen});
          logBytes += written;
        } else if (options.keepPassing) logBytes += written;
        else rmSync(log, {force: true});
        if (seen && !seen.busy && !seen.errors) rmSync(tally, {force: true});
        console.log(`${ok ? 'pass' : 'FAIL'}  #${iteration} ${name}  ${seconds.toFixed(1)} s${seen?.busy ? `  429×${seen.busy}` : ''}${ok ? '' : '  ' + failures.at(-1).step}`);
        resolveRun(ok);
      });
    });
  });
}

let completed = 0, stoppedEarly = false;
outer: for (let iteration = 1; iteration <= options.iterations; iteration++) {
  for (const file of files) {
    const name = basename(file, '.cjs'), estimate = (longest.get(name) || 30) * 1.5 * 1000;
    if (stopping || Date.now() + estimate > deadline) { stoppedEarly = true; break outer; }
    await runSuite(file, iteration);
  }
  completed = iteration;
}
await Promise.all(burners.map(worker => worker.terminate()));

const leftovers = fixtures(owned);
for (const name of leftovers) rmSync(join(owned, name), {recursive: true, force: true});
const after = {owned: fixtures(owned).length, parent: fixtures(parentTmp).length};
const sizeOf = dir => { let total = 0; for (const entry of readdirSync(dir, {withFileTypes: true})) { const path = join(dir, entry.name); total += entry.isDirectory() ? sizeOf(path) : statSync(path).size; } return total; };
const summary = {
  started: new Date(started).toISOString(), minutes: +((Date.now() - started) / 60000).toFixed(1), iterationsRequested: options.iterations, iterationsCompleted: completed, stoppedEarly,
  burners: options.burners, cpus: availableParallelism(), suites: Object.fromEntries(stats), failures,
  totals: {runs: [...stats.values()].reduce((n, s) => n + s.runs, 0), failures: failures.length, busy: [...stats.values()].reduce((n, s) => n + s.busy, 0)},
  fixtures: {ownedBefore: before.owned, leftoverRemoved: leftovers.length, ownedAfter: after.owned, parentBefore: before.parent, parentAfter: after.parent},
  logBytes: sizeOf(logs), out,
};
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n${summary.totals.failures} failures in ${summary.totals.runs} runs (${completed}/${options.iterations} iterations, ${options.burners} burners, ${summary.minutes} min); 429s seen: ${summary.totals.busy}`);
for (const [name, s] of stats) console.log(`  ${name}: ${s.failures}/${s.runs} failed${s.busy ? `, 429×${s.busy}` : ''}${Object.keys(s.steps).length ? '\n    ' + Object.entries(s.steps).map(([k, v]) => `${v}× ${k}`).join('\n    ') : ''}`);
console.log(`fixtures: ${leftovers.length} leftover removed; ${summary.fixtures.parentBefore}→${summary.fixtures.parentAfter} in the parent TMPDIR (not touched); logs ${summary.logBytes} bytes; summary ${join(out, 'summary.json')}`);
process.exitCode = stopping ? 130 : failures.length ? 1 : 0;
