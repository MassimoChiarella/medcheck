"""Storage admission/cleanup checks against the disposable integration Worker only."""
from update_integration import send,rejects,sql
from concurrent.futures import ThreadPoolExecutor

space=send(action='capacity')
assert space['databaseBytes']>0 and space['limitBytes']==8_000_000_000
manifest={'cutoff':'2026-05-31','bytes':1_500_000_000,'manifest':{t:1 for t in ['cv_products','cv_reports','cv_report_drugs','cv_reactions','cv_links']}}
def admit(index):
    gen=str(index)*16
    try:send(action='begin',id=gen,hash=gen*4,**manifest);return True
    except RuntimeError:return False
with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(admit,[8,9]))
assert sum(results)==1,results
assert send(action='capacity')['reservedBytes']>=4_500_000_000
rejects(action='dpd-begin',id='a'*16,hash='a'*64,count=50_000,bytes=2_000_000_000,observedAt='2026-09-08T00:00:00Z')
assert sql("SELECT generation FROM source_state WHERE id='cv'")[0]['generation']=='5555555555555555'
sql("UPDATE imports SET state='cleaned',reservedBytes=0 WHERE id IN ('8888888888888888','9999999999999999')")
print('PASS: measured capacity, atomic competing reservations and preservation of the active dataset.')

import uuid,hashlib,json,urllib.request,urllib.error
from update_integration import base,token
history_before=sql("SELECT id FROM versions WHERE productId='CA:123' ORDER BY id")
run=uuid.uuid4().hex;source_run=uuid.uuid4().hex
send(action='check-begin',source='cv',runId=source_run)
rejects(action='check-begin',source='maintenance',runId=run)
sql("UPDATE update_runs SET heartbeat='2000-01-01T00:00:00.000Z' WHERE source='cv'")
send(action='check-begin',source='maintenance',runId=run)
rejects(action='check-heartbeat',source='cv',runId=source_run)
rejects(action='check-begin',source='dpd',runId=source_run)
rejects(action='begin',id='e'*16,hash='e'*64,**{**manifest,'bytes':1000})
plan=send(action='maintenance-plan',source='maintenance',runId=run)
assert '5555555555555555' in plan['protectedIds'] and '3333333333333333' in plan['protectedIds']
for gen in plan['protectedIds']:rejects(action='maintenance-clean',source='maintenance',runId=run,id=gen)
send(action='check-finish',source='maintenance',runId=run,outcome='unchanged')
assert send(action='check-finish',source='maintenance',runId=run,outcome='unchanged')['replayed']
# An old partial import is reclaimed in bounded, restartable batches, then may be restaged.
gen='c'*16
send(action='begin',id=gen,hash=gen*4,**{**manifest,'bytes':1000})
send(action='batch',id=gen,table='cv_products',batch=0,rows=[[1,'PARTIAL','[]']])
run=uuid.uuid4().hex
send(action='check-begin',source='maintenance',runId=run)
rejects(action='maintenance-clean',source='maintenance',runId=run,id=gen)
sql(f"UPDATE imports SET touched='2000-01-01T00:00:00Z' WHERE id='{gen}'")
assert any(c['id']==gen for c in send(action='maintenance-plan',source='maintenance',runId=run)['candidates'])
assert sql(f"SELECT COUNT(*) n FROM cv_products WHERE gen='{gen}'")[0]['n']==1
partial=send(action='maintenance-clean',source='maintenance',runId=run,id=gen)
assert partial['deleted']==1 and not partial['done']
send(action='check-finish',source='maintenance',runId=run,outcome='failed')
run=uuid.uuid4().hex;send(action='check-begin',source='maintenance',runId=run)
while not send(action='maintenance-clean',source='maintenance',runId=run,id=gen)['done']:pass
assert sql(f"SELECT state,reservedBytes FROM imports WHERE id='{gen}'")==[{'state':'abandoned','reservedBytes':0}]
cursor=''
while True:
    scan=send(action='maintenance-scan',source='maintenance',runId=run,cursor=cursor)
    assert send(action='maintenance-scan',source='maintenance',runId=run,cursor=cursor)==scan
    if scan['complete']:break
    cursor=scan['cursor']
assert scan['scannedObjects']>0 and scan['archiveBytes']>0 and scan['deletedObjects']==0
send(action='check-finish',source='maintenance',runId=run,outcome='updated')
assert send(action='begin',id=gen,hash=gen*4,**{**manifest,'bytes':1000})['state']=='staging'
assert sql("SELECT generation FROM source_state WHERE id='cv'")[0]['generation']=='5555555555555555'
assert sql("SELECT id FROM versions WHERE productId='CA:123' ORDER BY id")==history_before
# A full archive meter must prevent new writes even though the bucket remains readable.
sql("UPDATE cache SET value='{\"bytes\":8000000000}' WHERE key='storage:r2'")
raw=b'bounded capacity fixture';digest=hashlib.sha256(raw).hexdigest()
request=urllib.request.Request(base+'/api/import?sourceHash='+digest+'&chunk=0',data=raw,headers={'Authorization':'Bearer '+token,'x-content-sha256':digest})
try:
    with urllib.request.urlopen(request):raise AssertionError('Archive ceiling did not reject growth')
except urllib.error.HTTPError as error:
    assert error.code==400 and 'ceiling' in error.read().decode()
print('PASS: maintenance exclusion, stale lease rejection, rollback protection, dry run, interrupted cleanup, restaging, archive audit and storage ceiling.')
