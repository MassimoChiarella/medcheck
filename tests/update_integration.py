"""Real HTTP/SQLite update checks; run through npm run test:integration only."""
import json,os,pathlib,subprocess,sys,urllib.request,uuid
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
from import_canada import post
base=os.environ['MEDCHECK_URL'];token=os.environ['MEDCHECK_IMPORT_TOKEN']
assert base=='http://127.0.0.1:3002' and 'medcheck-integration-' in os.environ['MEDCHECK_TEST_DIRECTORY']
def send(**body):return post(base,token,body)
def rejects(**body):
    try:send(**body)
    except RuntimeError:return
    raise AssertionError('Expected rejection')
def sql(command):
    r=subprocess.run([os.environ['MEDCHECK_TEST_NODE'],'node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','wrangler.local.json','--persist-to','.wrangler/state','--command',command,'--json'],check=True,capture_output=True,text=True)
    return json.loads(r.stdout)[0]['results']
def status(source):return next(s for s in send(action='checks')['sources'] if s['source']==source)

run=uuid.uuid4().hex;other=uuid.uuid4().hex
send(action='check-begin',source='cv',runId=run)
rejects(action='check-begin',source='cv',runId=other)
send(action='check-heartbeat',source='cv',runId=run,phase='downloading')
send(action='check-finish',source='cv',runId=run,phase='downloading',outcome='failed',error='secret must never be exposed')
assert status('cv')['checkOutcome']=='failed' and 'secret' not in json.dumps(status('cv'))
send(action='check-begin',source='cv',runId=other)
send(action='check-finish',source='cv',runId=other,outcome='unchanged')
success=status('cv')['lastCheckSuccessAt']
assert status('cv')['checkOutcome']=='unchanged' and success
send(action='check-begin',source='cv',runId=run)
sql("UPDATE update_runs SET heartbeat='2000-01-01T00:00:00.000Z' WHERE source='cv'")
assert status('cv')['checkOutcome']=='interrupted'
send(action='check-begin',source='cv',runId=other)
rejects(action='check-finish',source='cv',runId=run,outcome='updated')
send(action='check-finish',source='cv',runId=other,phase='validating',outcome='failed')
assert status('cv')['lastCheckSuccessAt']==success
with urllib.request.urlopen(base+'/api/research?action=sources') as response:sources=json.load(response)['data']
assert next(s for s in sources if s['id']=='cv')['checkOutcome']=='failed'
print('PASS: check leases, pre-import failure, unchanged success, interruption, redaction and retained success dates.')
