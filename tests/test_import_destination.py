"""Import destinations are explicit and authenticated uploads never follow redirects."""
import importlib.util,pathlib,unittest,urllib.request,urllib.error,threading,json
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from unittest.mock import patch
import sys
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
spec=importlib.util.spec_from_file_location('destination_importer',pathlib.Path(__file__).parents[1]/'scripts/import_canada.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class DestinationChecks(unittest.TestCase):
    def test_origins_and_local_ports(self):
        token='x'*32
        for url in ['https://my-medcheck.example','https://my-medcheck.example/','http://127.0.0.1:3003','http://localhost:3003','http://[::1]:3003']:
            self.assertEqual(mod.validate_target(url,token),url.rstrip('/'))
        for url in ['http://example.com','https://user:pass@example.com','https://example.com/path','https://example.com/?token=abc','https://example.com/#fragment','http://localhost','http://localhost:0','https://example.com:0','https://','https://example.com:bad','https://example.com\n']:
            with self.assertRaises(ValueError):mod.validate_target(url,token)
        with self.assertRaises(ValueError):mod.validate_target('https://example.com','short')
    def test_redirect_does_not_forward_credentials(self):
        received=[]
        class Receiver(BaseHTTPRequestHandler):
            def do_GET(self):received.append(dict(self.headers));self.send_response(200);self.end_headers()
            def log_message(self,*args):pass
        receiver=ThreadingHTTPServer(('127.0.0.1',0),Receiver)
        class Redirect(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers.get('Content-Length','0')))
                self.send_response(302);self.send_header('Location',f'http://127.0.0.1:{receiver.server_port}/target');self.end_headers()
            def log_message(self,*args):pass
        origin=ThreadingHTTPServer(('127.0.0.1',0),Redirect)
        threads=[threading.Thread(target=s.serve_forever,daemon=True) for s in [receiver,origin]]
        for t in threads:t.start()
        try:
            with self.assertRaisesRegex(RuntimeError,'302'):
                mod.post(f'http://127.0.0.1:{origin.server_port}','not-a-real-secret-'*3,{'action':'status'})
            self.assertEqual(received,[])
        finally:
            for server in [origin,receiver]:server.shutdown();server.server_close()
            for t in threads:t.join()
    def test_partial_refresh_is_not_success(self):
        from unittest.mock import Mock
        check=Mock();check.send.side_effect=[{}, {'completed':2,'remaining':1,'complete':False,'blocked':True,'changed':0}]
        with self.assertRaisesRegex(RuntimeError,'1 label documents'):mod.refresh('https://example.com','x'*32,check)

if __name__=='__main__':unittest.main()
