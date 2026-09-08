import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureToken, localEnvironment, isDue, acquireLock, parseArgs, matchingBaseline, scheduledSettings } from '../scripts/local.mjs';

test('a fresh clone creates its own persistent secret without overwriting other settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'medcheck-token-'));
  try {
    await writeFile(join(root, '.dev.vars'), 'OPENFDA_API_KEY=example\n');
    const token = await ensureToken(root);
    assert.equal(token.length, 64);
    assert.equal(await ensureToken(root), token);
    assert.match(await readFile(join(root, '.dev.vars'), 'utf8'), /^OPENFDA_API_KEY=example\nIMPORT_TOKEN=/);
    await writeFile(join(root, '.dev.vars'), 'IMPORT_TOKEN=short\n');
    await assert.rejects(ensureToken(root), /existing IMPORT_TOKEN/);
    assert.equal(await readFile(join(root, '.dev.vars'), 'utf8'), 'IMPORT_TOKEN=short\n');
  } finally { await rm(root, { recursive: true }); }
});
test('local uploads cannot inherit another installation destination or authorization', () => {
  const env = localEnvironment({ MEDCHECK_URL: 'https://someone-else.example', MEDCHECK_IMPORT_TOKEN: 'old', SITES_AUTHORIZATION: 'old-owner', CLOUDFLARE_API_TOKEN: 'remote-token', PATH: '/bin' }, 3012, 'local-token');
  assert.equal(env.MEDCHECK_URL, 'http://127.0.0.1:3012');
  assert.equal(env.MEDCHECK_IMPORT_TOKEN, 'local-token');
  assert.equal(env.SITES_AUTHORIZATION, undefined);
  assert.equal(env.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(env.PATH, '/bin');
});
test('daily checks catch up after downtime and do not retry failures every minute', () => {
  const now = Date.parse('2026-09-08T12:00:00Z');
  assert.equal(isDue({ updates: 'manual' }, {}, now), false);
  assert.equal(isDue({ updates: 'daily' }, {}, now), true);
  assert.equal(isDue({ updates: 'daily' }, { lastAttempt: '2026-09-07T11:59:00Z' }, now), true);
  assert.equal(isDue({ updates: 'daily' }, { lastAttempt: '2026-09-08T11:00:00Z', lastError: 'offline' }, now), false);
});
test('an update lock excludes a concurrent process and recovers a dead owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'medcheck-lock-'));
  const path = join(root, 'update.lock');
  try {
    const release = await acquireLock(path);
    assert.equal(typeof release, 'function');
    assert.equal(await acquireLock(path), null);
    await release();
    await mkdir(path);
    await writeFile(join(path, 'owner-2147483647-abc.json'), JSON.stringify({ pid: 2147483647 }));
    const recovered = await acquireLock(path);
    assert.equal(typeof recovered, 'function');
    await release(); // A previous owner cannot release a new owner's lock.
    assert.equal(await acquireLock(path), null);
    await recovered();
  } finally { await rm(root, { recursive: true }); }
});
test('concurrent processes cannot both reclaim a crashed update owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'medcheck-race-'));
  const path = join(root, 'update.lock');
  const children = [];
  try {
    await mkdir(path);
    await writeFile(join(path, 'owner-2147483647-abc.json'), JSON.stringify({ pid: 2147483647 }));
    const moduleUrl = new URL('../scripts/local.mjs', import.meta.url).href;
    const code = `import {acquireLock} from ${JSON.stringify(moduleUrl)};
      process.on('message', async message => {
        if (message !== 'go') return;
        const release = await acquireLock(${JSON.stringify(path)});
        process.send({ acquired: Boolean(release) });
        if (release) { await new Promise(resolve => process.once('message', resolve)); await release(); }
        process.disconnect();
      }); process.send('ready');`;
    let ready = 0;
    const results = Array.from({ length: 8 }, () => new Promise((resolveResult, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      children.push(child);
      child.on('error', reject);
      child.on('exit', code => { if (code) reject(new Error('Lock test child failed: ' + code)); });
      child.on('message', value => {
        if (value === 'ready') { if (++ready === 8) for (const p of children) p.send('go'); }
        else resolveResult(value.acquired);
      });
    }));
    assert.equal((await Promise.all(results)).filter(Boolean).length, 1);
  } finally {
    await Promise.all(children.map(child => new Promise(resolveExit => {
      if (child.exitCode !== null) return resolveExit();
      child.once('exit', resolveExit);
      if (child.connected) child.send('release');
    })));
    await rm(root, { recursive: true });
  }
});
test('first-run flags require bounded ports and explicit known choices', () => {
  assert.deepEqual(parseArgs(['setup', '--data=full', '--updates', 'daily', '--port', '3012', '--yes']), { command: 'setup', yes: true, data: 'full', updates: 'daily', port: 3012 });
  for (const args of [['dev', '--port=0'], ['setup', '--data=sample'], ['setup', '--updates=cron'], ['dev', '--host=0.0.0.0']]) assert.throws(() => parseArgs(args));
});

test('a running schedule honors saved opt-out and data changes without moving its upload destination', async () => {
  const root = await mkdtemp(join(tmpdir(), 'medcheck-schedule-'));
  const path = join(root, 'settings.json');
  const running = { port: 3000, updates: 'daily', data: 'on-demand' };
  try {
    await writeFile(path, JSON.stringify({ port: 3001, updates: 'manual', data: 'full' }));
    const next = await scheduledSettings(path, running);
    assert.deepEqual(next, { port: 3000, updates: 'manual', data: 'full' });
    assert.equal(isDue(next, {}), false);
    await writeFile(path, JSON.stringify({ port: 3001, updates: 'daily', data: 'full' }));
    assert.equal(isDue(await scheduledSettings(path, running), {}), true);
  } finally { await rm(root, { recursive: true }); }
});

test('legacy migration adoption requires exact existing definitions', () => {
  const migrations = [['first.sql', 'CREATE TABLE `products` (id TEXT);'], ['second.sql', 'CREATE TABLE `reports` (id TEXT);']];
  assert.deepEqual(matchingBaseline([{ name: 'products', sql: 'CREATE TABLE `products` (id TEXT)' }], migrations), ['first.sql']);
  assert.deepEqual(matchingBaseline([{ name: 'products', sql: 'CREATE TABLE `products` (id INTEGER)' }], migrations), []);
  assert.deepEqual(matchingBaseline([], migrations), []);
});
