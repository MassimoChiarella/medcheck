/** Isolated local Worker. Never points synthetic transactions at an existing deployment. */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, symlink, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { once } from 'node:events';
import { localEnvironment } from '../scripts/local.mjs';

const root = process.cwd(), directory = await mkdtemp(join(tmpdir(), 'medcheck-integration-'));
const paths = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' });
if (paths.status) throw new Error('Cannot enumerate test source files.');
let worker, log = '';
try {
  for (const path of new Set(paths.stdout.split('\0').filter(Boolean))) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await copyFile(join(root, path), join(directory, path));
  }
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const env = localEnvironment(process.env, 3002, '');
  worker = spawn(process.execPath, ['scripts/local.mjs', 'dev', '--yes', '--data=on-demand', '--updates=manual', '--port=3002'], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', data => { log = (log + data).slice(-30_000); });
  worker.stderr.on('data', data => { log = (log + data).slice(-30_000); });
  const deadline = Date.now() + 60_000;
  while (!log.includes('Your local MedCheck:')) {
    if (worker.exitCode !== null || Date.now() > deadline) throw new Error('Isolated Worker did not start:\n' + log);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const token = (await readFile(join(directory, '.dev.vars'), 'utf8')).match(/^IMPORT_TOKEN=(.*)$/m)[1];
  const testEnv = { ...localEnvironment(process.env, 3002, token), MEDCHECK_TEST_DIRECTORY: directory, MEDCHECK_TEST_NODE: process.execPath };
  const python = process.platform === 'win32' ? ['py', '-3'] : ['python3'];
  const tests = process.argv.slice(2).length ? process.argv.slice(2) : ['tests/integration.py', 'tests/storage_integration.py'];
  for (const test of tests) {
    const child = spawn(python[0], [...python.slice(1), test], { cwd: directory, env: testEnv, stdio: 'inherit' });
    const [code] = await once(child, 'exit');
    if (code !== 0) throw new Error(test + ' failed with exit code ' + code);
  }
  console.log('PASS: isolated Worker integration checks.');
} finally {
  if (worker && worker.exitCode === null) {
    worker.kill('SIGTERM');
    const timer = setTimeout(() => worker.kill('SIGKILL'), 8000);
    await once(worker, 'exit'); clearTimeout(timer);
  }
  await rm(directory, { recursive: true, force: true });
}
