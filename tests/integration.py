"""Run only against a fresh isolated local Worker: npm run test:integration.
Synthetic fixtures validate import transactions. NEVER use against review/live data.
"""
import hashlib,json,sys,urllib.request,urllib.error,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from import_canada import post
base=os.environ['MEDCHECK_URL'];token=os.environ['MEDCHECK_IMPORT_TOKEN']
assert base in ('http://localhost:3002','http://127.0.0.1:3002'), 'Isolated local test port required'
def send(**body):return post(base,token,body)
def rejected(**body):
    try:send(**body)
    except RuntimeError:return
    raise AssertionError('Invalid operation was accepted')
def get(**params):
    from urllib.parse import urlencode
    with urllib.request.urlopen(base+'/api/research?'+urlencode(params)) as response:return json.load(response)
def source():return next(x for x in get(action='sources')['data'] if x['id']=='cv')
def manifest(gen):return dict(id=gen,cutoff='2026-05-31',hash=gen*4,bytes=1000,manifest={t:1 for t in rows})
rows={'cv_products':[[1,'TEST A','["A"]']],'cv_reports':[[1,'TEST',2,'2026-05-01','2026-05-02',1,'[]']],'cv_report_drugs':[[1,1,1,'TEST A','Suspect']],'cv_reactions':[[1,1,'Test reaction']],'cv_links':[[1,1,'OTHER','Duplicate']]}
try:
    with urllib.request.urlopen(urllib.request.Request(base+'/api/import',data=b'{}',headers={'Content-Type':'application/json'})):raise AssertionError('Unauthenticated import accepted')
except urllib.error.HTTPError as e:assert e.code==401
g1='1111111111111111';g2='2222222222222222'
rejected(action='begin',**{**manifest(g1),'bytes':9000000000})
send(action='begin',**manifest(g1))
rejected(action='promote',id=g1)
assert source()['status']=='Dataset not imported yet'
for table,data in rows.items():
    send(action='batch',id=g1,table=table,batch=0,rows=data)
    assert send(action='batch',id=g1,table=table,batch=0,rows=data)['replayed']
    rejected(action='batch',id=g1,table=table,batch=2,rows=data)
assert send(action='promote',id=g1)['state']=='active'
assert send(action='promote',id=g1)['replayed']
send(action='begin',**manifest(g2))
send(action='batch',id=g2,table='cv_products',batch=0,rows=rows['cv_products'])
rejected(action='promote',id=g2)
send(action='fail',id=g2,error='Simulated interrupted transfer')
assert source()['coverageThrough']=='2026-05-31'
rejected(action='cleanup',id=g1,table='cv_products')
for table,data in rows.items():send(action='batch',id=g2,table=table,batch=0,rows=data)
send(action='promote',id=g2)
assert send(action='rollback',id=g1)['rolledBack']
rejected(action='promote',id=g2)
rejected(action='cleanup',id=g2,table='cv_products')
g3='3333333333333333'
send(action='begin',**manifest(g3))
for table,data in rows.items():send(action='batch',id=g3,table=table,batch=0,rows=data)
send(action='promote',id=g3)
send(action='cleanup',id=g2,table='cv_products')
rejected(action='rollback',id=g2)
p={'id':'CA:123','name':'TEST PRODUCT','genericName':'A','market':'CA','manufacturer':'TEST','strength':'1 mg','form':'Tablet','route':'Oral','identifiers':{'drugCode':123,'din':'00000123'},'ingredients':[{'name':'A','strength':'1 mg'}],'sourceUrl':'https://health-products.canada.ca/dpd-bdpp/info?lang=eng&code=123'}
for n,strength in enumerate(['1 mg','2 mg','1 mg']):
    p={**p,'strength':strength,'ingredients':[{'name':'A','strength':strength}]};digest=hashlib.sha256((str(n)+strength).encode()).hexdigest();gen=digest[:16]
    m=dict(id=gen,hash=digest,count=1,observedAt=f'2026-09-08T00:00:0{n}Z')
    run=send(action='dpd-begin',**m)
    rejected(action='dpd-complete',id=gen)
    send(action='dpd',id=gen,entries=[{'product':p}]);send(action='dpd-complete',id=gen)
    assert send(action='dpd-begin',**m)['state']=='active'
h=get(action='history',id='CA:123')['data']
assert len(h)==3 and [v['active'][0]['strength'] for v in h]==['1 mg','2 mg','1 mg'],h
# An older competing catalogue must not replace a newer live/catalogue observation.
old_id='4444444444444444'
send(action='dpd-begin',id=old_id,hash=old_id*4,count=1,observedAt='2026-09-07T00:00:00Z')
send(action='dpd',id=old_id,entries=[{'product':{**p,'strength':'OLDER','ingredients':[{'name':'A','strength':'OLDER'}]}}])
assert send(action='dpd-complete',id=old_id)['state']=='retired'
assert get(action='history',id='CA:123')['data'][0]['active'][0]['strength']=='1 mg'
# Resume a partial batch prefix with variable-sized batches across independent tables.
import sqlite3,tempfile
from import_canada import upload,TABLES
with tempfile.TemporaryDirectory() as directory:
    path=Path(directory)/'resume.sqlite';connection=sqlite3.connect(path)
    for table,(schema,_) in TABLES.items():
        connection.execute(f'CREATE TABLE {table}({schema})')
        data=[tuple([i]+rows[table][0][1:]) for i in range(1,4)]
        connection.executemany(f'INSERT INTO {table} VALUES('+','.join('?'*len(data[0]))+')',data)
    connection.commit();connection.close()
    gen='5555555555555555';m={**manifest(gen),'manifest':{t:3 for t in TABLES},'batch_size':2}
    send(action='begin',**m);send(action='batch',id=gen,table='cv_products',batch=0,rows=rows['cv_products'])
    upload(path,m,base,token)
    assert send(action='status',id=gen)['run']['state']=='active'
print('PASS: authentication boundary, bounds, idempotency, interrupted import, promotion, retained data, rollback, unchanged snapshots, leading-zero DIN and A→B→A history.')
