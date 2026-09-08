import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareVersions, distinctPairMatches, latestCases, parseSPL, reportAliases, unzipLabel } from '../lib/core.ts';
import type { ReportSummary } from '../lib/types.ts';

const xml=readFileSync(new URL('./fixtures/sertraline-v8.xml',import.meta.url),'utf8');
const parsed=parseSPL(xml);
void test('real SPL extracts nested warnings and isolates strengths and active-moiety basis',()=>{
  assert.equal(parsed.products.length,2);
  assert.equal(parsed.products[0].identifiers.ndc,'55154-4687');
  assert.equal(parsed.products[0].strength,'50 mg');
  assert.equal(parsed.products[1].strength,'100 mg');
  assert.equal(parsed.products[0].ingredients[0].basis,'SERTRALINE');
  assert.ok(parsed.sections['Drug interactions'].length>4000);
  assert.ok(parsed.sections['Adverse reactions'].length>1000);
  assert.ok(parsed.versions[0].inactive?.some(i=>i.name.includes('BLUE')));
});
void test('one-unit numerator and product-specific edit',()=>{
  const changed=parseSPL(xml.replace('unit="mg" value="50"','unit="mg" value="1"'));
  assert.equal(changed.products[0].strength,'1 mg');
  assert.equal(changed.products[1].strength,'100 mg');
  assert.equal(compareVersions(parsed.versions[1],changed.versions[1]).changes.length,0);
});
void test('missing fields are unknown; order-only edits do not create changes',()=>{
  const original=parsed.versions[0];
  assert.equal(compareVersions(original,{...original,inactive:[...original.inactive!].reverse()}).changes.length,0);
  const missing=compareVersions(original,{...original,inactive:undefined});
  assert.equal(missing.changes.filter(c=>c.category==='inactive ingredients').length,0);
  assert.ok(missing.notes.some(n=>n.includes('cannot be compared')));
  assert.throws(()=>compareVersions(original,{...original,productId:'other'}));
});
void test('archive identity and unsafe XML are rejected',()=>{
  assert.throws(()=>parseSPL(xml,'11111111-1111-1111-1111-111111111111'));
  assert.throws(()=>parseSPL('<!DOCTYPE document><document/>'));
  assert.throws(()=>unzipLabel(new Uint8Array([1,2,3])));
});
void test('separate medication records required; overlapping aliases rejected',()=>{
  assert.equal(distinctPairMatches([{name:'combo',ingredients:['A','B']}],['A'],['B']),false);
  assert.equal(distinctPairMatches([{name:'A'},{name:'B'}],['a'],['B']),true);
  assert.equal(distinctPairMatches([{name:'brand',ingredients:['A']},{name:'generic',ingredients:['A']}],['A'],['A']),false);
});
void test('latest source case version retained without combining authorities',()=>{
  const report={id:'1',version:'1',authority:'FDA'} as ReportSummary;
  const result=latestCases([report,{...report,version:'2'},{...report,authority:'Health Canada'}]);
  assert.equal(result.length,2);assert.equal(result[0].version,'2');
});

void test('ingredient and strength-basis identifiers participate in comparison',()=>{
  const v=parsed.versions[0];
  assert.equal(compareVersions(v,{...v,active:v.active!.map(i=>({...i,code:'DIFFERENT'}))}).changes[0].category,'active ingredients');
  assert.equal(compareVersions(v,{...v,active:v.active!.map(i=>({...i,basisCode:'DIFFERENT'}))}).changes[0].category,'active ingredients');
});
void test('combination products cannot be reduced to one component',()=>{
  const p={...parsed.products[0],name:'AB',genericName:'A / B',ingredients:[{name:'A'},{name:'B'}]};
  const terms=reportAliases(p,['AB','A / B','A','B']);
  assert.equal(distinctPairMatches([{name:'A'},{name:'C'}],terms,['C']),false);
  assert.equal(distinctPairMatches([{name:'AB'},{name:'C'}],terms,['C']),true);
});
void test('legacy warning sections remain readable',()=>{
  const legacy=xml.replace('43685-7','34071-1');
  assert.ok(parseSPL(legacy).sections.Warnings.length>1000);
});
