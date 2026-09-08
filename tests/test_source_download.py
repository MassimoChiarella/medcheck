import datetime,hashlib,json,pathlib,sys,tempfile,threading,unittest
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
from source_download import download_source
import import_canada
from update_run import SourceCheck

class DownloadTests(unittest.TestCase):
    def test_changed_unchanged_corrupt_missing_and_expired_cache(self):
        state={'data':b'first','etag':'"v1"','requests':[]}
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                state['requests'].append(self.headers.get('If-None-Match'))
                if self.headers.get('If-None-Match')==state['etag']:
                    self.send_response(304);self.end_headers();return
                self.send_response(200);self.send_header('ETag',state['etag']);self.send_header('Content-Length',str(len(state['data'])));self.end_headers();self.wfile.write(state['data'])
            def log_message(self,*args):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with tempfile.TemporaryDirectory() as folder:
                path=pathlib.Path(folder)/'source.zip';url=f'http://127.0.0.1:{server.server_port}/source'
                first=download_source(url,path,100)
                self.assertEqual(download_source(url,path,100),first)
                self.assertEqual(state['requests'],[None,'"v1"'])
                path.write_bytes(b'corrupt')
                self.assertEqual(download_source(url,path,100)['hash'],first['hash'])
                self.assertIsNone(state['requests'][-1]);self.assertEqual(path.read_bytes(),b'first')
                path.unlink()
                self.assertEqual(download_source(url,path,100,first),first)
                self.assertFalse(path.exists()) # Remote active release supplies the validated prior.
                old={**first,'verifiedAt':'2000-01-01T00:00:00+00:00'}
                download_source(url,path,100,old)
                self.assertIsNone(state['requests'][-1]);self.assertTrue(path.exists())
                state.update(data=b'new release',etag='"v2"')
                self.assertNotEqual(download_source(url,path,100)['hash'],first['hash'])
                original=path.read_bytes();state.update(data=b'x'*101,etag='"v3"')
                with self.assertRaises(ValueError):download_source(url,path,100)
                self.assertEqual(path.read_bytes(),original)
        finally:server.shutdown();server.server_close();thread.join()

    def test_active_cv_release_does_not_rebuild_or_import(self):
        digest='a'*64;generation=hashlib.sha256((digest+':'+import_canada.TRANSFORM_VERSION).encode()).hexdigest()[:16]
        document={'hash':digest,'bytes':10,'etag':None,'lastModified':'Wed, 02 Sep 2026 11:59:19 GMT','verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        calls=[]
        def post(base,token,body):
            calls.append(body)
            if body['action']=='release-state':return {'active':{'id':generation,'hash':digest},'release':{'documents':{'extract_extrait.zip':document}}}
            if body['action']=='archive-status':return {'complete':True}
            return {}
        with tempfile.TemporaryDirectory() as folder:
            with patch.dict('os.environ',{'MEDCHECK_URL':'https://example.test','MEDCHECK_IMPORT_TOKEN':'x'*32}), patch.object(sys,'argv',['import_canada.py','--upload','--workdir',folder]), patch.object(import_canada,'post',post), patch.object(import_canada,'download_source',return_value=document), patch.object(import_canada,'build',side_effect=AssertionError('Unexpected rebuild')), patch.object(import_canada,'upload',side_effect=AssertionError('Unexpected upload')), patch.object(import_canada,'SourceCheck',side_effect=lambda *args:SourceCheck(*args,directory=pathlib.Path(folder)/'checks')):
                import_canada.main()
        self.assertEqual(calls[-1]['outcome'],'unchanged')
        self.assertTrue(any(c['action']=='release-save' for c in calls))
