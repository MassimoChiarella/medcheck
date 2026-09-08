import importlib.util,io,pathlib,unittest
import sys
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
spec=importlib.util.spec_from_file_location('importer',pathlib.Path(__file__).parents[1]/'scripts/import_canada.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class ImportChecks(unittest.TestCase):
 def test_source_quoting_and_multiline(self):
  value='"9096"$"ENBREL "IMMUNEX""\n"123"$"A\nB"\n'
  self.assertEqual(list(mod.records(io.StringIO(value),2)),[['9096','ENBREL "IMMUNEX"'],['123','A\nB']])
 def test_schema_change_rejected(self):
  with self.assertRaises(ValueError):list(mod.records(io.StringIO('"1"$"A"$"extra"\n'),2))
 def test_source_dates_respect_dataset_century(self):
  self.assertEqual(mod.source_date('01-JAN-65','2026-05-31'),'1965-01-01')
  self.assertEqual(mod.source_date('31-MAY-26','2026-05-31'),'2026-05-31')
  self.assertIsNone(mod.source_date('','2026-05-31'))
  with self.assertRaises(ValueError):mod.source_date('31-FEB-25','2026-05-31')

class BatchTests(unittest.TestCase):
    def test_batches_preserve_all_rows_and_bound_encoded_bytes(self):
        bounded_batches=mod.bounded_batches
        import json
        rows=[(i,'é"'*100) for i in range(10)]
        batches=list(bounded_batches(iter(rows),max_rows=4,max_bytes=1000))
        self.assertEqual([r for b in batches for r in b],rows)
        self.assertTrue(all(len(json.dumps(b,ensure_ascii=False,separators=(',',':')).encode())<=1000 for b in batches))
        self.assertEqual(batches,list(bounded_batches(iter(rows),max_rows=4,max_bytes=1000)))

if __name__=='__main__':unittest.main()
