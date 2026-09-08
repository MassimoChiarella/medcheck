import json,pathlib,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
from update_summary import summary

class SummaryTests(unittest.TestCase):
    def test_untrusted_log_fields_and_incomplete_steps_cannot_report_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            (root/'cv.json').write_text(json.dumps({'outcome':'unchanged','phase':'validating','started':'2026-09-08T01:00:00+00:00','error':'SECRET','token':'SECRET'}))
            (root/'dpd.json').write_text(json.dumps({'outcome':'SECRET','phase':'SECRET','started':'SECRET'}))
            value=summary(root,{'cv':'failure','maintenance':'skipped'})
            self.assertNotIn('SECRET',value)
            self.assertIn('Canada Vigilance | failed / incomplete',value)
            self.assertIn('Canadian products | not checked',value)
            self.assertIn('Storage maintenance | not checked (skipped)',value)
            self.assertIn('2026-09-08 01:00:00',value)
