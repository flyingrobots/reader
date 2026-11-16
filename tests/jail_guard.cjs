/* Refuse to run tests outside the enforced test sandbox (scripts/test_jail.py, docs/testing.md); the same check as
   tests/jail_guard.py. Inside the sandbox the runner's probe directory refuses writes, so a write that succeeds there
   means no sandbox is active. CI's containers say so with READER_TEST_JAIL=container and the runtime's marker file.
   Requiring this module is the check: test entry files load it first. */
'use strict';
const {existsSync, unlinkSync, writeFileSync} = require('node:fs');
const {join} = require('node:path');

const MESSAGE = 'Refusing to run tests outside the enforced test sandbox. Run them through scripts/test_jail.py, for example\n' +
  '  python3 scripts/test_jail.py -- node --test tests/*.test.mjs\nSee docs/testing.md.';

function problem(environ = process.env) {
  const mode = environ.READER_TEST_JAIL;
  if (mode === 'container') {
    return existsSync('/.dockerenv') || existsSync('/run/.containerenv') ? null : 'READER_TEST_JAIL=container is set, but this is not a container';
  }
  if (mode !== 'sandbox-exec') return 'not started by scripts/test_jail.py';
  if (!environ.READER_TEST_JAIL_PROBE) return 'the sandbox probe is not named';
  const target = join(environ.READER_TEST_JAIL_PROBE, `guard-${process.pid}`);
  try {
    writeFileSync(target, '');
  } catch (error) {
    return error.code === 'EPERM' || error.code === 'EACCES' ? null : `the sandbox probe cannot be checked: ${error.code}`;
  }
  unlinkSync(target);
  return 'the sandbox probe accepted a write, so no sandbox is active';
}

const reason = problem();
if (reason) {
  process.stderr.write(`${MESSAGE}\n(${reason})\n`);
  process.exit(2);
}
module.exports = {problem};
