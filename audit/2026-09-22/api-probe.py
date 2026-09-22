"""Read-only, bounded research-API audit; credentials arrive over stdin and are never saved."""
import json, sys, time, urllib.request, urllib.error, urllib.parse, pathlib, datetime
original_attrs=None
try:
 if sys.stdin.isatty():
  import termios
  original_attrs=termios.tcgetattr(sys.stdin)
  attrs=original_attrs.copy();attrs[3]&=~termios.ECHO;termios.tcsetattr(sys.stdin,termios.TCSANOW,attrs)
 print('Ready for audit connection.',flush=True)
 config=json.loads(sys.stdin.readline())
finally:
 if original_attrs is not None:termios.tcsetattr(sys.stdin,termios.TCSANOW,original_attrs)
base=config['url'].rstrip('/')
headers={'Accept':'application/json'}
if config.get('token'):headers['OAI-Sites-Authorization']='Bearer '+config['token']
out=pathlib.Path(__file__).with_name(config.get('output','api-results.json'));results=[];bodies={}
def probe(name, **params):
 start=time.monotonic();entry={'case':name,'params':params}
 try:
  req=urllib.request.Request(base+'/api/research?'+urllib.parse.urlencode(params),headers=headers)
  try:response=urllib.request.urlopen(req,timeout=45)
  except urllib.error.HTTPError as error:response=error
  with response:
   raw=response.read(3_000_000);entry.update(status=response.status,bytes=len(raw),contentType=response.headers.get('Content-Type'));body=json.loads(raw)
  bodies[name]=body;data=body.get('data');entry.update(completeness=body.get('completeness'),error=body.get('error'),notes=body.get('notes'),total=body.get('total'),hasMore=body.get('hasMore'),fetchedAt=body.get('fetchedAt'))
  if isinstance(data,list):
   entry['rows']=len(data)
   entry['sample']=[{k:x.get(k) for k in ['id','name','market','identifiers','version','publishedAt','effectiveAt','eventCountry','status','lastSuccessAt','checkStatus','lastError'] if k in x} if isinstance(x,dict) else x for x in data[:8]]
  elif isinstance(data,dict):entry['dataKeys']=list(data)
  else:entry['data']=data
 except Exception as error:entry['failure']=str(error)
 entry['seconds']=round(time.monotonic()-start,3);results.append(entry)
 out.write_text(json.dumps({'base':base,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'results':results},indent=2))
 print(json.dumps(entry),flush=True)
 return bodies.get(name,{})
cases=config.get('cases') or (json.loads(pathlib.Path(__file__).with_name('edge-cases.json').read_text()) if config.get('scenario')=='edges' else None)
if cases:
 for case in cases:probe(case['name'],**case['params'])
 sys.exit(0)
probe('sources',action='sources')
for name,params in [
 ('short-query',dict(q='ab')),('long-query',dict(q='a'*101)),('invalid-page',dict(q='sertraline',page=0)),
 ('unknown-action',dict(action='not-a-real-action')),('invalid-product',dict(action='product',id="CA:1' OR 1=1")),
 ('typo-empty',dict(q='sertaline',market='US')),('typo-suggestion',dict(action='suggestions',q='sertaline',market='US')),
 ('random-empty',dict(q='zzqzxvbnm',market='US')),('random-suggestion',dict(action='suggestions',q='zzqzxvbnm',market='US')),
 ('numeric-no-correction',dict(action='suggestions',q='02238281',market='CA')),
 ('exact-ndc',dict(q='55154-4687',market='US')),('us-generic',dict(q='Sertraline',market='US')),
 ('ca-din-leading-zero',dict(q='02238280',market='CA')),('ca-generic',dict(q='Sertraline',market='CA')),
 ('ca-spelling',dict(action='suggestions',q='sertaline',market='CA')),
 ('us-combination',dict(q='Bactrim',market='US')),('us-veterinary',dict(q='carprofen',market='US')),
 ('unsupported-market',dict(q='Sertraline',market='GB')),
]:probe(name,**{'action':'search',**params})
us=bodies.get('us-generic',{}).get('data',[]);ca=bodies.get('ca-din-leading-zero',{}).get('data',[])
for label,products in [('us',us),('ca',ca)]:
 if not isinstance(products,list) or not products:continue
 p=products[0];pid=p['id']
 for action in ['product','history','evidence','recalls','reports']:
  data=probe(label+'-'+action,action=action,id=pid,source=p['market'])
  if action=='history' and len(data.get('data',[]))>1:
   versions=data['data'];probe(label+'-diff',action='diff',id=pid,before=versions[1]['version'],after=versions[0]['version'])
 if label=='us' and len(products)>1:probe('same-ingredient-pair',action='reports',id=pid,other=products[1]['id'],source='US')
print('Audit probe complete.',flush=True)
