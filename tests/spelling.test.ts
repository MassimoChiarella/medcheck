import test from 'node:test';
import assert from 'node:assert/strict';
import { spellingCandidates, shouldOfferSpelling } from '../lib/spelling.ts';
import type { Result } from '../lib/types';

void test('medication spellings rank common typos and reject unrelated or identical terms', () => {
  assert.deepEqual(spellingCandidates('sertaline', ['sertraline', '(+)-sertraline']), ['sertraline']);
  assert.deepEqual(spellingCandidates('metfromin', ['merbromin', 'metformin']), ['metformin', 'merbromin']);
  assert.deepEqual(spellingCandidates('  AMBIENN ', ['Ambien', 'AMBIEN', null]), ['ambien']);
  assert.deepEqual(spellingCandidates('sertralline', ['sertraline']), ['sertraline']);
  assert.deepEqual(spellingCandidates('zzqzxvbnm', ['sertraline', 'metformin']), []);
  assert.deepEqual(spellingCandidates('sertraline', ['Sertraline', 'sertraline hcl']), []);
  assert.deepEqual(spellingCandidates('sertaline', undefined), []);
  for (const query of ['ab', '00071015523', '02238280', '00071-0155-23', 'sertraline 50', 'a'.repeat(101)]) {
    assert.deepEqual(spellingCandidates(query, ['sertraline']), []);
  }
});

void test('suggestions are only offered for complete empty first-page name searches', () => {
  const empty: Result<unknown[]> = { data: [], completeness: 'complete', notes: [], fetchedAt: '2026-09-20', page: 1 };
  assert.equal(shouldOfferSpelling('sertaline', empty), true);
  for (const completeness of ['partial', 'stale', 'unavailable'] as const) {
    assert.equal(shouldOfferSpelling('sertaline', { ...empty, completeness }), false);
  }
  assert.equal(shouldOfferSpelling('sertaline', { ...empty, data: [{}] }), false);
  assert.equal(shouldOfferSpelling('sertaline', { ...empty, page: 2 }), false);
  assert.equal(shouldOfferSpelling('02238280', empty), false);
});

void test('a filtered page with more upstream results does not offer a correction',()=>{
  assert.equal(shouldOfferSpelling('sertraine',{data:[],completeness:'complete',notes:[],fetchedAt:'2026-01-01',page:1,hasMore:true}),false);
});
