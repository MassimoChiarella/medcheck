import json,pathlib,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
from update_run import SourceCheck

class SourceCheckTests(unittest.TestCase):
    def test_failure_before_upload_and_unchanged_are_recorded(self):
        calls=[]
        def post(base,token,value,check=None):calls.append(value);return {'leaseEpoch':1,'protocolVersion':2}
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
        def post(base,token,value,check=None):
            if value['action']=='check-finish':raise RuntimeError('offline')
            return {'leaseEpoch':1,'protocolVersion':2}
        with tempfile.TemporaryDirectory() as folder:
            directory=pathlib.Path(folder)
            with self.assertRaises(RuntimeError):
                with SourceCheck('cv','https://example.test','unused',post,directory):pass
            self.assertEqual(json.loads((directory/'cv.json').read_text())['outcome'],'failed')

    def test_lost_heartbeat_stops_new_mutations(self):
        calls=[]
        def post(base,token,value,check=None):
            calls.append(value)
            if check:check.ensure_active()
            return {'leaseEpoch':1,'protocolVersion':2}
        with tempfile.TemporaryDirectory() as folder:
            check=SourceCheck('cv','https://example.test','unused',post,pathlib.Path(folder))
            check.heartbeat_error=RuntimeError('lease lost')
            for invoke in [lambda:check.send('refresh'),lambda:check.request({'action':'batch'})]:
                with self.assertRaisesRegex(RuntimeError,'heartbeat failed'):invoke()
            self.assertEqual(calls,[])

    def test_cancelled_producers_can_release_owned_lease(self):
        calls=[]
        def post(base,token,value,check=None):
            if check:check.ensure_active()
            calls.append(value)
            return {'leaseEpoch':1,'protocolVersion':2}
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError,'invalid batch'):
                with SourceCheck('cv','https://example.test','unused',post,pathlib.Path(folder)) as check:
                    check.heartbeat_error=ValueError('invalid batch')
                    raise ValueError('invalid batch')
            self.assertEqual(calls[-1]['action'],'check-finish')
            self.assertEqual(calls[-1]['outcome'],'failed')
