"""Bounded public-source downloads with verified caches and conditional requests."""
import datetime,hashlib,json,pathlib,re,time,urllib.error,urllib.request

RECHECK_SECONDS=7*24*60*60

def file_hash(path):
    digest=hashlib.sha256()
    with pathlib.Path(path).open('rb') as stream:
        while chunk:=stream.read(1024*1024):digest.update(chunk)
    return digest.hexdigest()

def read_metadata(path):
    try:
        meta=json.loads(path.with_suffix('.metadata.json').read_text())
        if path.stat().st_size!=meta['bytes'] or file_hash(path)!=meta['hash']:return None
        return meta
    except (OSError,ValueError,KeyError,TypeError):return None

def download_source(url,path,ceiling,prior=None,force=False):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    # A corrupt local file is repaired unconditionally; remote metadata is useful on a fresh runner.
    meta=read_metadata(path) if path.exists() else prior
    if not isinstance(meta,dict) or not re.fullmatch(r'[a-f0-9]{64}',str(meta.get('hash',''))) or not isinstance(meta.get('bytes'),int) or not 0<meta['bytes']<=ceiling:meta=None
    headers={}
    try:
        age=time.time()-datetime.datetime.fromisoformat(meta['verifiedAt']).timestamp()
        if not force and 0<=age<RECHECK_SECONDS:
            if meta.get('etag'):headers['If-None-Match']=meta['etag']
            elif meta.get('lastModified'):headers['If-Modified-Since']=meta['lastModified']
    except (TypeError,KeyError,ValueError):pass
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=120) as response:
                if int(response.headers.get('Content-Length') or 0)>ceiling:raise ValueError('Source exceeds the bounded download size')
                temp=path.with_suffix('.part');size=0;digest=hashlib.sha256()
                with temp.open('wb') as target:
                    while chunk:=response.read(1024*1024):
                        size+=len(chunk)
                        if size>ceiling:raise ValueError('Source exceeds the bounded download size')
                        target.write(chunk);digest.update(chunk)
                expected=response.headers.get('Content-Length')
                if not size or (expected and size!=int(expected)):raise ValueError('Source download is incomplete')
                meta={'hash':digest.hexdigest(),'bytes':size,'etag':response.headers.get('ETag'),'lastModified':response.headers.get('Last-Modified'),'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
                temp.replace(path)
                metadata_path=path.with_suffix('.metadata.json');temporary=metadata_path.with_suffix('.tmp')
                temporary.write_text(json.dumps(meta));temporary.replace(metadata_path)
                return meta
        except urllib.error.HTTPError as error:
            if error.code==304:
                if not headers or not meta:raise ValueError('Source returned an unverified unchanged response') from error
                return meta
            if error.code not in (429,500,502,503,504) or attempt==3:raise
            delay=error.headers.get('Retry-After','')
            time.sleep(min(60,int(delay)) if delay.isdigit() else 2**attempt)
        except (TimeoutError,urllib.error.URLError):
            if attempt==3:raise
            time.sleep(2**attempt)
    raise RuntimeError('Source download did not complete')
