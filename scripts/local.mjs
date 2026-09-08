#!/usr/bin/env node
/** Local-only first-run setup. No remote deployment or OS scheduler is installed. */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, open, unlink, readdir, rmdir, rm, statfs } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DAY = 24 * 60 * 60 * 1000;
const MIN_FREE = 10_000_000_000;
const children = new Set();
let stopping = false;

export function parseArgs(args) {
  const options = { command: args.shift() || 'dev', yes: false };
  for (let i = 0; i < args.length; i++) {
    const [key, inline] = args[i].split('=');
    if (key === '--yes') { options.yes = true; continue; }
    if (key === '--help') { options.command = 'help'; continue; }
    if (!['--data', '--updates', '--port'].includes(key)) throw new Error('Unknown option: ' + key);
    const value = inline ?? args[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + key);
    options[key.slice(2)] = value;
  }
  if (!['dev', 'setup', 'update', 'status', 'help'].includes(options.command)) throw new Error('Unknown local command.');
  return validateSettings(options);
}
export function validateSettings(value) {
  if (value.data !== undefined && !['on-demand', 'full'].includes(value.data)) throw new Error('Data must be on-demand or full.');
  if (value.updates !== undefined && !['manual', 'daily'].includes(value.updates)) throw new Error('Updates must be manual or daily.');
  if (value.port !== undefined) {
    value.port = Number(value.port);
    if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) throw new Error('Choose a port between 1024 and 65535.');
  }
  return value;
}
async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
async function saveJson(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true });
  const temp = path + '.' + process.pid + '.tmp';
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, path);
}
export async function ensureToken(root) {
  const path = join(root, '.dev.vars');
  let current = '';
  try { current = await readFile(path, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const line = current.match(/^\s*(?:export\s+)?IMPORT_TOKEN\s*=\s*(.*?)\s*$/m);
  if (line) {
    const token = line[1].replace(/^(['"])(.*)\1$/, '$2');
    if (token.length < 32 || /\s/.test(token)) throw new Error('The existing IMPORT_TOKEN in .dev.vars must contain at least 32 characters without whitespace. It was not changed.');
    return token;
  }
  const token = randomBytes(32).toString('hex');
  // Exclusive append is guarded by the installation lock in main().
  const fd = await open(path, 'a', 0o600);
  try { await fd.writeFile((current && !current.endsWith('\n') ? '\n' : '') + 'IMPORT_TOKEN=' + token + '\n'); }
  finally { await fd.close(); }
  return token;
}
export function localEnvironment(parent, port, token) {
  const env = { ...parent, MEDCHECK_URL: `http://127.0.0.1:${port}`, MEDCHECK_IMPORT_TOKEN: token,
    WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', PYTHONUNBUFFERED: '1' };
  delete env.SITES_AUTHORIZATION;
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_API_KEY;
  delete env.CLOUDFLARE_ACCOUNT_ID;
  return env;
}
export function isDue(settings, state, now = Date.now()) {
  if (settings.updates !== 'daily') return false;
  // Failed automatic attempts retry the next day, or manually with data:update.
  const previous = Date.parse(state?.lastAttempt || '');
  return !Number.isFinite(previous) || now - previous >= DAY;
}
export async function scheduledSettings(path, running) {
  const saved = validateSettings(await readJson(path, running));
  // A schedule change applies to the running installation; a new port needs a restart.
  return { ...running, data: saved.data ?? running.data, updates: saved.updates ?? running.updates };
}
export async function acquireLock(path) {
  await mkdir(resolve(path, '..'), { recursive: true });
  const ownerName = `owner-${process.pid}-${randomUUID()}.json`;
  const claim = path + '.' + ownerName;
  await mkdir(claim, { mode: 0o700 });
  try {
    await writeFile(join(claim, ownerName), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        // Publish a nonempty directory atomically. Another nonempty owner cannot be replaced.
        await rename(claim, path);
        return async () => {
          try { await unlink(join(path, ownerName)); }
          catch (e) { if (e.code === 'ENOENT') return; throw e; }
          try { await rmdir(path); }
          catch (e) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e; }
        };
      } catch (e) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(e.code)) throw e;
        let names;
        try { names = await readdir(path); }
        catch (error) { if (error.code === 'ENOENT' && e.code !== 'EPERM') continue; throw e; }
        if (names.length) {
          if (names.length !== 1 || !/^owner-\d+-[\da-f-]+\.json$/.test(names[0])) return null;
          const owner = await readJson(join(path, names[0]));
          if (!owner) continue;
          if (!Number.isInteger(owner.pid) || owner.pid < 1) return null;
          try { process.kill(owner.pid, 0); return null; }
          catch (error) { if (error.code !== 'ESRCH') return null; }
          // A competing recovery can replace the directory; remove only the observed owner.
          try { await unlink(join(path, names[0])); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        try { await rmdir(path); }
        catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
      }
    }
    return null;
  } finally { await rm(claim, { recursive: true, force: true }); }
}
function start(command, args, env, stdio = 'inherit') {
  const child = spawn(command, args, { cwd: ROOT, env, stdio, windowsHide: true });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}
function finished(child) {
  return new Promise((resolveRun, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolveRun() : reject(new Error(`Process failed (${signal || code}). See the output above.`)));
  });
}
async function run(command, args, env, stdio) { await finished(start(command, args, env, stdio)); }
function python() {
  const choices = process.platform === 'win32' ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']];
  for (const [command, ...args] of choices) {
    const probe = spawnSync(command, [...args, '-c', 'import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)'], { stdio: 'ignore' });
    if (probe.status === 0) return [command, ...args];
  }
  throw new Error('Install Python 3.9 or newer to run local setup and import tools.');
}
export function matchingBaseline(actual, migrations) {
  const normalize = sql => sql.replace(/\s+/g, ' ').trim().replace(/;$/, '');
  const objects = new Map(actual.map(row => [row.name, normalize(row.sql || '')]));
  const matched = [];
  for (const [name, sql] of migrations) {
    const statements = sql.replace(/--> statement-breakpoint/g, '').split(';').map(s => s.trim()).filter(Boolean);
    if (!statements.length || !statements.every(statement => {
      const object = statement.match(/^CREATE (?:TABLE|INDEX) [`"]?(\w+)/);
      return object && objects.get(object[1]) === normalize(statement);
    })) break;
    matched.push(name);
  }
  return matched;
}
async function initializeDatabase(env) {
  const cli = join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
  const options = ['--local', '--config', join(ROOT, 'wrangler.local.json'), '--persist-to', join(ROOT, '.wrangler/state')];
  const query = async sql => {
    const child = start(process.execPath, [cli, 'd1', 'execute', 'DB', ...options, '--command', sql, '--json'], env, ['ignore', 'pipe', 'inherit']);
    let output = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { output += chunk; });
    await finished(child); return JSON.parse(output)[0].results;
  };
  const objects = await query(`SELECT name,sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'`);
  const tracked = objects.some(o => o.name === 'd1_migrations') ? (await query('SELECT COUNT(*) AS n FROM d1_migrations'))[0].n : 0;
  // The initial preview applied these three CREATE-only files before using Wrangler's journal.
  // Adopt only byte-equivalent SQL definitions; unknown/partial schemas still fail closed.
  if (!tracked && objects.some(o => o.name === 'products')) {
    const names = ['0000_illegal_goliath.sql', '0001_milky_wither.sql', '0002_sticky_mysterio.sql'];
    const migrations = await Promise.all(names.map(async name => [name, await readFile(join(ROOT, 'drizzle', name), 'utf8')]));
    const matched = matchingBaseline(objects, migrations);
    if (matched.length) {
      await query(`CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);` + matched.map(name => `INSERT OR IGNORE INTO d1_migrations(name) VALUES('${name}');`).join(''));
      console.log('Recognized the original local schema; existing research data was retained.');
    }
  }
  await run(process.execPath, [cli, 'd1', 'migrations', 'apply', 'DB', ...options], env, ['ignore', 'inherit', 'inherit']);
}
async function chooseSettings(options, existing) {
  const settings = validateSettings({ version: 1, port: existing?.port ?? 3000, data: existing?.data ?? 'on-demand', updates: existing?.updates ?? 'manual',
    ...Object.fromEntries(['port', 'data', 'updates'].filter(k => options[k] !== undefined).map(k => [k, options[k]])) });
  if ((!existing || options.command === 'setup') && !options.yes && process.stdin.isTTY) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log('\nMedCheck — set up your own data\n1. Start with live US and Canadian product searches.\n2. Also download and index the complete Canadian catalogue and report dataset.\n   Allow at least 10 GB free disk; the first import can take tens of minutes.');
      if (options.data === undefined) {
        const answer = (await prompt.question(`Data option [${settings.data === 'full' ? '2' : '1'}]: `)).trim();
        if (answer && !['1', '2'].includes(answer)) throw new Error('Choose 1 or 2.');
        if (answer) settings.data = answer === '2' ? 'full' : 'on-demand';
      }
      if (options.updates === undefined) {
        const answer = (await prompt.question(`Updates: 1 manual, 2 daily while this app is running [${settings.updates === 'daily' ? '2' : '1'}]: `)).trim();
        if (answer && !['1', '2'].includes(answer)) throw new Error('Choose 1 or 2.');
        if (answer) settings.updates = answer === '2' ? 'daily' : 'manual';
      }
    } finally { prompt.close(); }
  } else if (!existing && !options.yes) {
    console.log(`Non-interactive first run: ${settings.data} data, ${settings.updates} updates. Run npm run setup to change these choices.`);
  }
  return settings;
}
async function readiness(base, token) {
  try {
    const response = await fetch(base + '/api/import', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ action: 'status', id: '0000000000000000' }) });
    if (!response.ok) return false;
    const body = await response.json();
    return Array.isArray(body.batches) && typeof body.databaseBytes === 'number';
  } catch { return false; }
}
async function worker(settings, token, env) {
  const base = env.MEDCHECK_URL;
  if (await readiness(base, token)) return { child: null, base };
  const child = start(process.execPath, [join(ROOT, 'node_modules/vinext/dist/cli.js'), 'dev', '--host', '127.0.0.1', '--port', String(settings.port), '--strictPort'], env);
  let failure;
  const exit = finished(child); exit.catch(error => { failure = error; });
  for (let attempt = 0; attempt < 90 && !stopping; attempt++) {
    if (failure) throw new Error('The local server could not start. If the port is occupied, choose another with --port.');
    if (await readiness(base, token)) return { child, base, exit };
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }
  child.kill('SIGTERM');
  throw new Error('The local server did not become ready. Check its output and .dev.vars configuration.');
}
async function update(settings, token, env, py) {
  const release = await acquireLock(join(ROOT, 'work/local/update.lock'));
  if (!release) { console.log('An update for this installation is already running.'); return false; }
  const statusPath = join(ROOT, 'work/local/update-status.json');
  const state = await readJson(statusPath, {});
  const attempt = new Date().toISOString();
  const failures = [];
  try {
    await saveJson(statusPath, { ...state, lastAttempt: attempt, running: true });
    if (settings.data === 'full') {
      const disk = await statfs(ROOT);
      if (disk.bavail * disk.bsize < MIN_FREE) throw new Error('Complete imports require at least 10 GB free disk space. No data was truncated or removed.');
    }
    const steps = settings.data === 'full' ? [['Canadian catalogue', 'scripts/import_products.py', '--upload'], ['Canada Vigilance', 'scripts/import_canada.py', '--upload']] : [];
    steps.push(['Previously indexed US labels', 'scripts/import_canada.py', '--refresh-only']);
    for (const [name, ...args] of steps) {
      if (stopping) throw new Error('Update interrupted; rerun to resume.');
      console.log('\nUpdating ' + name + ' from its official source…');
      try { await run(py[0], [...py.slice(1), ...args], env); }
      catch (error) { failures.push(name); console.error(name + ': ' + error.message); }
    }
    if (failures.length) throw new Error('Some updates failed: ' + failures.join(', ') + '. Previous successful data remains available.');
    await saveJson(statusPath, { lastAttempt: attempt, lastSuccess: new Date().toISOString(), running: false, data: settings.data });
    try {
      const response = await fetch(env.MEDCHECK_URL + '/api/research?action=sources', { signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (response.ok) {
        const sources = await response.json();
        for (const s of sources.data || []) if (s.id === 'dpd' || s.id === 'cv') console.log(`${s.name}: ${s.status}${s.coverageThrough ? ' · coverage ' + s.coverageThrough : ''}`);
      }
    } catch { console.log('Imports succeeded; source status could not be displayed. Check the source directory in the app.'); }
    console.log('Update complete. Your data is stored in this project’s ignored local folders.');
    return true;
  } catch (error) {
    await saveJson(statusPath, { ...state, lastAttempt: attempt, running: false, lastError: error.message });
    throw error;
  } finally { await release(); }
}
export async function main(args = process.argv.slice(2)) {
  const options = parseArgs([...args]);
  if (options.command === 'help') {
    console.log('npm run dev | setup | data:update | data:status\nOptions: --data=on-demand|full --updates=manual|daily --port=3000 --yes\nDaily updates run only while npm run dev is running. SETUP.md explains independent hosted schedules.'); return;
  }
  const settingsPath = join(ROOT, 'work/local/settings.json');
  const existing = await readJson(settingsPath);
  if (options.command === 'status') {
    console.log(JSON.stringify({ settings: existing, update: await readJson(join(ROOT, 'work/local/update-status.json')), storage: '.wrangler/state and work/', schedule: 'Daily checks run only while the local launcher is running.' }, null, 2)); return;
  }
  const py = python();
  const settings = await chooseSettings(options, existing);
  const installationLock = await acquireLock(join(ROOT, 'work/local/setup.lock'));
  if (!installationLock) throw new Error('Local setup is already running in another process.');
  let token, env;
  try {
    token = await ensureToken(ROOT); env = localEnvironment(process.env, settings.port, token);
    await initializeDatabase(env);
    await saveJson(settingsPath, settings);
  } finally { await installationLock(); }
  const current = await worker(settings, token, env);
  console.log(`\nYour local MedCheck: ${current.base}\nData: ${settings.data}. Updates: ${settings.updates}${settings.updates === 'daily' ? ' (only while the app is running)' : ''}.\nUse npm run setup to change these choices. US records load on demand; no original deployment connection is used.\n`);
  const state = await readJson(join(ROOT, 'work/local/update-status.json'), {});
  const mustUpdate = options.command === 'update' || (settings.data === 'full' && (!state.lastSuccess || state.data !== 'full')) || isDue(settings, state);
  if (options.command !== 'dev') {
    try { if (mustUpdate) await update(settings, token, env, py); }
    finally {
      if (current.child) {
        current.child.kill('SIGTERM');
        const timeout = setTimeout(() => current.child.kill('SIGKILL'), 5000);
        try { await current.exit.catch(() => {}); } finally { clearTimeout(timeout); }
      }
    }
    return;
  }
  if (!current.child) {
    if (mustUpdate) await update(settings, token, env, py);
    console.log('The app is already running. If it was started with dev:worker, stop it and run npm run dev to enable scheduling.');
    return;
  }
  let busy = false;
  const tick = async (force = false) => {
    if (busy || stopping) return;
    busy = true;
    try {
      const schedule = await scheduledSettings(settingsPath, settings);
      if (!force && !isDue(schedule, await readJson(join(ROOT, 'work/local/update-status.json'), {}))) return;
      await update(schedule, token, env, py);
    }
    catch (error) { console.error(error.message + '\nRun npm run data:update to retry.'); }
    finally { busy = false; }
  };
  if (mustUpdate) void tick(true);
  const timer = setInterval(() => void tick(), 60_000);
  try { await current.exit; } finally { clearInterval(timer); }
}
function shutdown(signal, exitCode) {
  if (stopping) return;
  stopping = true;
  if (exitCode !== undefined) process.exitCode = exitCode;
  // SIGTERM stops Python import threads too; SIGINT can leave them waiting on HTTP.
  for (const child of children) child.kill(signal === 'SIGINT' ? 'SIGTERM' : signal);
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(process.exitCode || 0);
  }, 5000).unref();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on('SIGINT', () => shutdown('SIGINT', 130));
  process.on('SIGTERM', () => shutdown('SIGTERM', 143));
  main().catch(error => { if (!stopping) { console.error('MedCheck: ' + error.message); process.exitCode = 1; shutdown('SIGTERM'); } });
}
