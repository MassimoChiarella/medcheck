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

# Release validators belong to the active dataset and current check, not a stale run.
send(action='check-begin',source='cv',runId=run)
active=send(action='release-state',source='cv')['active']
if active:
    document={'hash':active['hash'],'bytes':100,'etag':'"release"','lastModified':None,'verifiedAt':'2026-09-08T00:00:00+00:00'}
    rejects(action='release-save',source='cv',runId=other,generation=active['id'],datasetHash=active['hash'],documents={'extract_extrait.zip':document})
    rejects(action='release-save',source='cv',runId=run,generation=active['id'],datasetHash='f'*64,documents={'extract_extrait.zip':document})
    send(action='release-save',source='cv',runId=run,generation=active['id'],datasetHash=active['hash'],documents={'extract_extrait.zip':document})
    assert send(action='release-state',source='cv')['release']['documents']['extract_extrait.zip']==document
send(action='check-finish',source='cv',runId=run,outcome='unchanged')
print('PASS: release checkpoints require active source identity and current ownership.')

# A shared SPL is queued once. Budget failures stay pending and completed work survives a new run.
labels=['634ec8e3-6d83-4cb2-90a3-fc9c973b06bf','7e5e76cf-2fda-4f9d-bcbf-f77b1f188ee6']
for setid,ndc in [(labels[0],'0000-0001'),(labels[1],'0000-0002'),(labels[1],'0000-0003')]:
    sql(f"INSERT INTO products(id,data,observed) VALUES('US:{setid}:{ndc}','{{}}','2026-09-08T00:00:00Z')")
label_run=uuid.uuid4().hex
send(action='check-begin',source='dailymed',runId=label_run)
cycle=send(action='refresh-start',source='dailymed',runId=label_run)
assert cycle['total']==2
assert send(action='refresh-start',source='dailymed',runId=label_run)['cycle']==cycle['cycle']
import time
if time.time()%60>55:time.sleep(5)
sql("INSERT INTO source_budget(key,window,count) VALUES('dailymed.nlm.nih.gov:60000',CAST(unixepoch('now')/60 AS INTEGER),120) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=120")
for _ in range(2):
    pending=send(action='refresh',source='dailymed',runId=label_run)
    assert pending['completed']==0 and not pending['complete']
assert pending['retryAfter']>0 and not pending['blocked']
assert all(row['attempts']==0 and row['nextAttempt']>0 for row in sql('SELECT attempts,nextAttempt FROM label_refresh'))
sql(f"UPDATE label_refresh SET state='done',changed=1 WHERE setId='{labels[0]}'")
send(action='check-finish',source='dailymed',runId=label_run,outcome='failed',phase='refreshing')
next_run=uuid.uuid4().hex
send(action='check-begin',source='dailymed',runId=next_run)
resumed=send(action='refresh-start',source='dailymed',runId=next_run)
assert resumed['resumed'] and resumed['cycle']==cycle['cycle'] and resumed['completed']==1
rejects(action='refresh',source='dailymed',runId=label_run)
sql("UPDATE label_refresh SET attempts=3,state='pending' WHERE state<>'done'")
blocked=send(action='refresh',source='dailymed',runId=next_run)
assert blocked['blocked'] and not blocked['complete'] and blocked['remaining']==1
send(action='check-finish',source='dailymed',runId=next_run,outcome='failed',phase='refreshing')
plan=sql("EXPLAIN QUERY PLAN SELECT DISTINCT substr(id,4,36) FROM products WHERE id GLOB 'US:*'")
assert any('INDEX' in row['detail'] for row in plan),plan
print('PASS: unique label cycles, indexed selection, rate waits, retained checkpoints and incomplete refresh results.')
