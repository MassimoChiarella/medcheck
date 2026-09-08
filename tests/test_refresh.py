import pathlib,sys,unittest
from unittest.mock import Mock,patch
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
from import_canada import refresh

class RefreshTests(unittest.TestCase):
    def test_pacing_and_unchanged_completion(self):
        check=Mock();check.send.side_effect=[{},
            {'completed':1,'remaining':1,'complete':False,'blocked':False,'changed':0,'retryAfter':120},
            {'completed':2,'remaining':0,'complete':True,'blocked':False,'changed':0,'retryAfter':0}]
        with patch('import_canada.time.sleep') as sleep:
            result=refresh('https://example.test','x'*32,check)
        sleep.assert_called_once_with(60)
        self.assertTrue(result['complete']);self.assertEqual(check.outcome,'unchanged')

    def test_exhausted_work_is_incomplete(self):
        check=Mock();check.send.side_effect=[{}, {'completed':10,'remaining':2,'complete':False,'blocked':True,'changed':5}]
        with self.assertRaisesRegex(RuntimeError,'2 label documents'):refresh('https://example.test','x'*32,check)

    def test_time_budget_preserves_pending_work(self):
        check=Mock();check.send.return_value={}
        with patch('import_canada.time.monotonic',side_effect=[0,7201]):
            with self.assertRaisesRegex(RuntimeError,'time budget'):refresh('https://example.test','x'*32,check)
