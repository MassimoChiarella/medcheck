#!/usr/bin/env python3
"""Validate the complete Canada Vigilance extract; publish an atomic, resumable index.
No paid services, source sampling, or schema changes are performed by this script.
"""
import datetime, argparse, hashlib, io, json, os, pathlib, re, sqlite3, sys, time, urllib.error, urllib.request, urllib.parse, zipfile
from update_run import SourceCheck
from source_download import download_source,file_hash

TRANSFORM_VERSION = '1'
SOURCE = 'https://www.canada.ca/content/dam/hc-sc/migration/hc-sc/dhp-mps/alt_formats/zip/medeff/databasdon/extract_extrait.zip'
COLUMNS = {'reports':42,'drug_products':2,'drug_product_ingredients':5,'reactions':10,'report_links':5,'report_drug':22}
TABLES = {
 'cv_products': ('id INTEGER PRIMARY KEY,name TEXT NOT NULL,ingredients TEXT NOT NULL',3),
 'cv_reports': ('id INTEGER PRIMARY KEY,reportNo TEXT NOT NULL,version INTEGER NOT NULL,received TEXT,updated TEXT,serious INTEGER,outcomes TEXT NOT NULL',7),
 'cv_report_drugs': ('id INTEGER PRIMARY KEY,reportId INTEGER NOT NULL,drugId INTEGER,name TEXT NOT NULL,role TEXT NOT NULL',5),
 'cv_reactions': ('id INTEGER PRIMARY KEY,reportId INTEGER NOT NULL,term TEXT NOT NULL',3),
 'cv_links': ('id INTEGER PRIMARY KEY,reportId INTEGER NOT NULL,target TEXT NOT NULL,kind TEXT NOT NULL',4),
}
START = re.compile(r'^"[0-9]+"\$')
MONTHS = {m:i+1 for i,m in enumerate('JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split())}

def records(stream, expected):
    # The official extract contains unescaped embedded quotes and multiline names.
    # Exact field delimiters and numeric record boundaries preserve these values.
    current=[]
    for line in stream:
        if START.match(line) and current:
            yield parse_record(''.join(current),expected);current=[]
        current.append(line)
        if sum(map(len,current))>1_000_000: raise ValueError('Oversize or malformed source record')
    if current: yield parse_record(''.join(current),expected)

def parse_record(record,expected):
    record=record.rstrip('\r\n')
    if not record.startswith('"') or not record.endswith('"'): raise ValueError('Malformed source record wrapper')
    values=record[1:-1].split('"$"')
    if len(values)!=expected: raise ValueError(f'Source schema changed: expected {expected}, got {len(values)}')
    return values

def source_date(raw,cutoff):
    if not raw: return None
    match=re.fullmatch(r'(\d{2})-([A-Z]{3})-(\d{2}|\d{4})',raw.upper())
    if not match: raise ValueError(f'Unrecognized source date {raw!r}')
    day,month,year=match.groups();year=int(year)
    if year<100:
        year+=2000
        if year>int(cutoff[:4]):year-=100
    import datetime
    return datetime.date(year,MONTHS[month],int(day)).isoformat()

def download(path):
    download_source(SOURCE,path,1_000_000_000)
    return path

def build(archive_path, output):
    hasher=hashlib.sha256()
    with open(archive_path,'rb') as source_file:
        while chunk:=source_file.read(1024*1024):hasher.update(chunk)
    digest=hasher.hexdigest()
    gen=hashlib.sha256((digest+':'+TRANSFORM_VERSION).encode()).hexdigest()[:16];manifest_path=output.with_suffix('.manifest.json')
    if output.exists() and manifest_path.exists():
        prior=json.loads(manifest_path.read_text())
        if prior.get('hash')==digest and prior.get('transform_version')==TRANSFORM_VERSION and prior.get('bytes')==output.stat().st_size and prior.get('index_hash')==file_hash(output):return prior
    staging=output.with_suffix('.staging.sqlite')
    if staging.exists():staging.unlink()
    conn=sqlite3.connect(staging);conn.execute('PRAGMA journal_mode=OFF');conn.execute('PRAGMA synchronous=OFF');conn.execute('PRAGMA cache_size=-32768');conn.execute('PRAGMA temp_store=FILE')
    for table,(schema,_) in TABLES.items():conn.execute(f'CREATE TABLE {table}({schema})')
    counts={};source_counts={};started=time.monotonic()
    with zipfile.ZipFile(archive_path) as archive:
        members={pathlib.PurePosixPath(m.filename).stem:m for m in archive.infolist() if not m.is_dir()}
        if set(COLUMNS)-set(members):raise ValueError('A required complete source table is missing')
        cuts={re.search(r'extract_(\d{8})/',m.filename).group(1) for m in members.values() if re.search(r'extract_(\d{8})/',m.filename)}
        if len(cuts)!=1:raise ValueError('Cannot establish the source coverage cutoff')
        cut=cuts.pop();cutoff=f'{cut[:4]}-{cut[4:6]}-{cut[6:]}'
        def rows(name):
            count=0
            with archive.open(members[name]) as raw,io.TextIOWrapper(raw,encoding='utf-8-sig',newline='') as text:
                for row in records(text,COLUMNS[name]):count+=1;yield row
            source_counts[name]=count
        ingredients={}
        for r in rows('drug_product_ingredients'):ingredients.setdefault(int(r[1]),set()).add(r[4])
        def product(r):return(int(r[0]),r[1],json.dumps(sorted(ingredients.get(int(r[0]),set())),ensure_ascii=False))
        def report(r):
            outcomes=[r[17]] if r[17] else []
            for i,label in [(28,'Death'),(29,'Disability'),(30,'Congenital anomaly'),(31,'Life threatening'),(32,'Hospitalization'),(33,'Other medically important condition')]:
                if r[i].lower() in ('1','yes','y','true'):outcomes.append(label)
            return(int(r[0]),r[1],int(r[2]),source_date(r[4],cutoff),source_date(r[3],cutoff),1 if r[26].lower()=='serious' else 0 if r[26].lower() in ('non-serious','not serious') else None,json.dumps(outcomes))
        conversions=[('drug_products','cv_products',product),('reports','cv_reports',report),('report_drug','cv_report_drugs',lambda r:(int(r[0]),int(r[1]),int(r[2]) if r[2] else None,r[3],r[4])),('reactions','cv_reactions',lambda r:(int(r[0]),int(r[1]),r[5])),('report_links','cv_links',lambda r:(int(r[0]),int(r[1]),r[4],r[2]))]
        for source,table,convert in conversions:
            sql=f'INSERT INTO {table} VALUES('+','.join('?' for _ in range(TABLES[table][1]))+')';batch=[];count=0
            for row in rows(source):
                batch.append(convert(row));count+=1
                if len(batch)>=10000:conn.executemany(sql,batch);batch=[]
            if batch:conn.executemany(sql,batch)
            conn.commit();counts[table]=count;print(f'{table}: {count:,} complete source records',flush=True)
    for sql in ['CREATE INDEX cv_drug_report ON cv_report_drugs(drugId,reportId)','CREATE INDEX cv_report_drug ON cv_report_drugs(reportId)','CREATE INDEX cv_reaction_report ON cv_reactions(reportId)','CREATE INDEX cv_link_report ON cv_links(reportId)','CREATE INDEX cv_report_receipt ON cv_reports(received)','CREATE INDEX cv_product_name ON cv_products(name)']:conn.execute(sql)
    conn.commit()
    for table in ('cv_report_drugs','cv_reactions','cv_links'):
        missing=conn.execute(f'SELECT COUNT(*) FROM {table} d LEFT JOIN cv_reports r ON r.id=d.reportId WHERE r.id IS NULL').fetchone()[0]
        if missing:raise ValueError(f'{table}: {missing} orphaned report links; source must be investigated')
    dates=conn.execute('SELECT MIN(received),MAX(updated) FROM cv_reports').fetchone()
    if dates[1]>cutoff:raise ValueError('Source dates exceed coverage cutoff')
    if conn.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('SQLite integrity check failed')
    conn.close();size=staging.stat().st_size
    # Reserve space for generation keys, staging+active copies, and source documents.
    if size*6>8_000_000_000:raise ValueError(f'Complete index {size} bytes exceeds staging headroom ceiling')
    staging.replace(output)
    manifest={'id':gen,'hash':digest,'transform_version':TRANSFORM_VERSION,'cutoff':cutoff,'manifest':counts,'bytes':size,'index_hash':file_hash(output),'batch_size':12000,'source_counts':source_counts,'source_url':SOURCE,'elapsed_seconds':round(time.monotonic()-started,2)}
    manifest_path.write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest),flush=True);return manifest

def validate_target(base,token):
    """Authenticated imports target an explicit owner URL; never accept URL credentials."""
    try:
        url=urllib.parse.urlsplit(base)
        port=url.port
        valid_host=bool(url.hostname) and not any(c.isspace() for c in base)
        local=url.scheme=='http' and url.hostname in ('localhost','127.0.0.1','::1') and port is not None
        if not valid_host or (port is not None and port<1) or url.username or url.password or url.query or url.fragment or url.path not in ('','/') or not (url.scheme=='https' or local):raise ValueError()
    except ValueError:raise ValueError('Use an HTTPS deployment origin or an explicit loopback HTTP port; no credentials, paths, queries or fragments in MEDCHECK_URL.') from None
    if not isinstance(token,str) or len(token)<32 or any(c.isspace() for c in token):raise ValueError('A 32+ character import token without whitespace is required.')
    return base.rstrip('/')

class NoImportRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        raise urllib.error.HTTPError(req.full_url,code,'Authenticated import redirects are not allowed',headers,fp)

IMPORT_HTTP=urllib.request.build_opener(NoImportRedirect())

def post(base,token,payload):
    base=validate_target(base,token)
    raw=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode()
    headers={'Content-Type':'application/json','Authorization':'Bearer '+token}
    # Private review deployments can use an existing owner-supplied Sites token.
    if os.getenv('SITES_AUTHORIZATION'):headers['OAI-Sites-Authorization']='Bearer '+os.environ['SITES_AUTHORIZATION']
    for attempt in range(5):
        try:
            with IMPORT_HTTP.open(urllib.request.Request(base+'/api/import',data=raw,headers=headers),timeout=180) as response:return json.load(response)
        except urllib.error.HTTPError as e:
            detail=e.read(2000).decode(errors='replace')
            if e.code not in (429,500,502,503,504):raise RuntimeError(f'Upload HTTP {e.code}: {detail}') from e
            if attempt==4:raise RuntimeError(f'Upload failed: {detail}') from e
        except (TimeoutError,urllib.error.URLError):
            if attempt==4:raise
        time.sleep(min(30,2**attempt))

def archive_source(path,base,token,source_url):
    base=validate_target(base,token)
    digest=hashlib.sha256()
    with open(path,'rb') as source:
        while chunk:=source.read(5*1024*1024):digest.update(chunk)
    full_hash=digest.hexdigest()
    if post(base,token,{'action':'archive-status','hash':full_hash})['complete']:return
    chunks=[]
    with open(path,'rb') as source:
        while chunk:=source.read(5*1024*1024):
            chunk_hash=hashlib.sha256(chunk).hexdigest();index=len(chunks)
            headers={'Authorization':'Bearer '+token,'Content-Type':'application/octet-stream','X-Content-SHA256':chunk_hash}
            if os.getenv('SITES_AUTHORIZATION'):headers['OAI-Sites-Authorization']='Bearer '+os.environ['SITES_AUTHORIZATION']
            url=base.rstrip('/')+'/api/import?sourceHash='+full_hash+'&chunk='+str(index)
            for attempt in range(5):
                try:
                    with IMPORT_HTTP.open(urllib.request.Request(url,data=chunk,headers=headers),timeout=180) as response:json.load(response)
                    break
                except (urllib.error.URLError,TimeoutError):
                    if attempt==4:raise
                    time.sleep(2**attempt)
            chunks.append({'hash':chunk_hash,'bytes':len(chunk)})
    post(base,token,{'action':'archive-complete','hash':full_hash,'sourceUrl':source_url,'filename':path.name,'bytes':path.stat().st_size,'chunks':chunks})
    print('Source bytes archived:',path.name,flush=True)

def bounded_batches(cursor,max_rows=12000,max_bytes=1_500_000):
    rows=[];size=2
    for row in cursor:
        count=len(json.dumps(row,ensure_ascii=False,separators=(',',':')).encode())+1
        if count>max_bytes:raise ValueError('A source row exceeds the bounded transport limit')
        if rows and (len(rows)>=max_rows or size+count>max_bytes):
            yield rows;rows=[];size=2
        rows.append(row);size+=count
    if rows:yield rows

def upload(path,manifest,base,token):
    cleanup(base,token)
    gen=manifest['id'];post(base,token,{'action':'begin',**manifest})
    status=post(base,token,{'action':'status','id':gen})
    if status['run']['state']=='active':print('Current dataset already active.');return False
    if status['run']['state']!='staging':raise RuntimeError('This source generation was retired or rolled back; a scheduled run cannot reactivate it. Await a newer release or explicitly restore a retained generation.')
    last={x['tableName']:x for x in status['batches']};batch_size=12000
    def upload_table(table):
        with sqlite3.connect(path) as conn:
            prior=last.get(table,{'rows':0,'lastBatch':-1});count=prior['rows']
            cursor=conn.execute(f'SELECT * FROM {table} ORDER BY id LIMIT -1 OFFSET ?',(count,))
            for number,batch in enumerate(bounded_batches(cursor,batch_size),start=prior['lastBatch']+1):
                post(base,token,{'action':'batch','id':gen,'table':table,'batch':number,'rows':batch})
                count+=len(batch)
                if (number+1)%100==0:print(f'{table}: {count:,} / {manifest["manifest"][table]:,}',flush=True)
            post(base,token,{'action':'validate','id':gen,'table':table})
            print(f'{table}: complete ({count:,} rows)',flush=True)
    try:
        # Three independent tables at a time; each table's acknowledged batches stay ordered.
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(upload_table,TABLES))
        response=post(base,token,{'action':'promote','id':gen});print(json.dumps(response),flush=True)
        cleanup(base,token)
        return True
    except Exception as e:
        try:post(base,token,{'action':'fail','id':gen,'error':str(e)[:500]})
        except Exception:pass
        raise

def cleanup(base,token):
    retired=post(base,token,{'action':'retired'})
    for run in retired['generations']:
        for table in TABLES:
            while post(base,token,{'action':'cleanup','id':run['id'],'table':table})['deleted']:pass


def refresh(base,token,check=None):
    if check is None:
        with SourceCheck('dailymed',base,token,post) as owned:
            owned.phase('refreshing');return refresh(base,token,owned)
    limit=int(os.getenv('MEDCHECK_REFRESH_SECONDS','7200'))
    if not 10<=limit<=10800:raise ValueError('MEDCHECK_REFRESH_SECONDS must be between 10 and 10800.')
    deadline=time.monotonic()+limit
    started=check.send('refresh-start');print('Label cycle:',json.dumps(started),flush=True)
    last_print=-1
    while time.monotonic()<deadline:
        state=check.send('refresh')
        if state['completed']//25!=last_print or state['complete'] or state['blocked']:
            print('Label refresh:',json.dumps(state),flush=True);last_print=state['completed']//25
        if state['complete']:
            check.outcome='updated' if state['changed'] else 'unchanged'
            return state
        if state['blocked']:raise RuntimeError(f"{state['remaining']} label documents could not be refreshed; progress is saved for the next attempt.")
        # Worker requests remain short; pacing and longer upstream retry waits happen here.
        time.sleep(min(60,max(1,state.get('retryAfter',1)),max(0,deadline-time.monotonic())))
    raise RuntimeError('Label refresh time budget reached; remaining work is saved for the next run.')

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--archive',type=pathlib.Path);parser.add_argument('--workdir',type=pathlib.Path,default=pathlib.Path('work/canada'));parser.add_argument('--upload',action='store_true');parser.add_argument('--refresh',action='store_true');parser.add_argument('--refresh-only',action='store_true');args=parser.parse_args();args.workdir.mkdir(parents=True,exist_ok=True)
    base=os.getenv('MEDCHECK_URL','');token=os.getenv('MEDCHECK_IMPORT_TOKEN','')
    if args.upload or args.refresh or args.refresh_only:
        try:base=validate_target(base,token)
        except ValueError as error:parser.error(str(error))
    if not args.refresh_only:
        if args.upload:
            with SourceCheck('cv',base,token,post) as check:
                state=check.send('release-state')
                check.phase('downloading');archive=args.archive or args.workdir/'extract_extrait.zip'
                if args.archive:
                    document={'hash':file_hash(archive),'bytes':archive.stat().st_size,'etag':None,'lastModified':None,'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
                else:
                    prior=(state.get('release') or {}).get('documents',{}).get('extract_extrait.zip')
                    document=download_source(SOURCE,archive,1_000_000_000,prior)
                generation=hashlib.sha256((document['hash']+':'+TRANSFORM_VERSION).encode()).hexdigest()[:16]
                active=state.get('active') or {}
                if active.get('id')==generation and post(base,token,{'action':'archive-status','hash':document['hash']})['complete']:
                    check.outcome='unchanged';print('Published Canada Vigilance release is unchanged; no index rebuild or import needed.')
                else:
                    if not archive.exists():document=download_source(SOURCE,archive,1_000_000_000,force=True)
                    check.phase('validating');output=args.workdir/'canada.sqlite';manifest=build(archive,output)
                    check.phase('archiving');archive_source(archive,base,token,SOURCE)
                    check.phase('importing');changed=upload(output,manifest,base,token)
                    check.outcome='updated' if changed else 'unchanged'
                    generation=manifest['id']
                check.send('release-save',generation=generation,datasetHash=document['hash'],documents={'extract_extrait.zip':document})
        else:
            archive=args.archive or download(args.workdir/'extract_extrait.zip');build(archive,args.workdir/'canada.sqlite')
    if args.refresh or args.refresh_only:
        with SourceCheck('dailymed',base,token,post) as check:
            check.phase('refreshing');refresh(base,token,check)
if __name__=='__main__':main()
