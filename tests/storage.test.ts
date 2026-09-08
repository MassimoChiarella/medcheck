import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactCandidate, RETENTION_GRACE_MS } from '../lib/storage-policy.ts';

void test('only aged partial uploads are cleanup candidates; completed evidence stays protected', () => {
  const stamp=Date.now(),old=new Date(stamp-RETENTION_GRACE_MS-1),hash='a'.repeat(64),gen='b'.repeat(16);
  assert.deepEqual(artifactCandidate(`raw-sources/${hash}/200`,old,stamp),{kind:'raw',id:hash});
  assert.deepEqual(artifactCandidate(`canada/catalogue/${gen}/${hash}.json`,old,stamp),{kind:'catalogue',id:gen});
  for(const key of [`raw-sources/${hash}/manifest.json`,`raw-sources/${hash}/201`,`labels/${gen}.xml`,'unknown/archive.json']) assert.equal(artifactCandidate(key,old,stamp),null);
  assert.equal(artifactCandidate(`raw-sources/${hash}/0`,new Date(stamp),stamp),null);
  assert.equal(artifactCandidate(`raw-sources/${hash}/0`,new Date('invalid'),stamp),null);
});
