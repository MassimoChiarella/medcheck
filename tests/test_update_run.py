import json,pathlib,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
from update_run import SourceCheck

class SourceCheckTests(unittest.TestCase):
    def test_failure_before_upload_and_unchanged_are_recorded(self):
        calls=[]
        def post(base,token,value):calls.append(value);return {}
        with tempfile.TemporaryDirectory() as folder:
            directory=pathlib.Path(folder)
            with self.assertRaisesRegex(ValueError,'offline'):
                with SourceCheck('cv','https://example.test','unused',post,directory) as check:
                    check.phase('downloading');raise ValueError('offline secret-value')
            self.assertEqual(calls[-1]['outcome'],'failed')
            self.assertNotIn('secret-value',(directory/'cv.json').read_text())
            with SourceCheck('cv','https://example.test','unused',post,directory) as check:check.outcome='unchanged'
            self.assertEqual(json.loads((directory/'cv.json').read_text())['outcome'],'unchanged')

    def test_missing_server_completion_is_not_success(self):
        def post(base,token,value):
            if value['action']=='check-finish':raise RuntimeError('offline')
            return {}
        with tempfile.TemporaryDirectory() as folder:
            directory=pathlib.Path(folder)
            with self.assertRaises(RuntimeError):
                with SourceCheck('cv','https://example.test','unused',post,directory):pass
            self.assertEqual(json.loads((directory/'cv.json').read_text())['outcome'],'failed')
