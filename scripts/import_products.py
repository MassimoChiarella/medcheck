#!/usr/bin/env python3
"""Snapshot the complete Health Canada human medication catalogue."""
import argparse,collections,datetime,hashlib,json,os,pathlib,time,urllib.request
from import_canada import post,archive_source,validate_target
from update_run import SourceCheck
from source_download import download_source,read_metadata
ENDPOINTS=['drugproduct','activeingredient','form','route','status']

def collect(directory,offline):
    directory.mkdir(parents=True,exist_ok=True)
    for name in ENDPOINTS:
        path=directory/(name+'.json')
        if not offline:
            url='https://health-products.canada.ca/api/drug/'+name+'/?lang=en&type=json'
            download_source(url,path,80_000_000)
    values={name:json.loads((directory/(name+'.json')).read_text()) for name in ENDPOINTS}
    for name,data in values.items():
        if not isinstance(data,list) or not data:raise ValueError('Source dataset missing: '+name)
    return values

def build(values):
    maps={}
    for name in ENDPOINTS[1:]:
        grouped=collections.defaultdict(list)
        for r in values[name]:grouped[r['drug_code']].append(r)
        maps[name]=grouped
    output=[]
    for p in values['drugproduct']:
        if p['class_name']!='Human':continue
        code=p['drug_code']
        if any(code not in maps[name] for name in maps):raise ValueError('Missing product relation for '+str(code))
        ingredients=[]
        for a in maps['activeingredient'][code]:
            strength=' '.join(str(x) for x in [a.get('strength'),a.get('strength_unit')] if x)
            if a.get('dosage_value') and a.get('dosage_unit'):strength+=' / '+str(a['dosage_value'])+' '+a['dosage_unit']
            ingredients.append({'name':a['ingredient_name'],'strength':strength})
        product={'id':'CA:'+str(code),'name':p['brand_name'],'genericName':' / '.join(i['name'] for i in ingredients),'market':'CA','manufacturer':p.get('company_name') or 'Unknown','strength':' / '.join(i['strength'] for i in ingredients),'form':', '.join(r['pharmaceutical_form_name'] for r in maps['form'][code]),'route':', '.join(r['route_of_administration_name'] for r in maps['route'][code]),'identifiers':{'drugCode':code,'din':str(p['drug_identification_number'])},'ingredients':ingredients,'sourceUrl':f'https://health-products.canada.ca/dpd-bdpp/info?lang=eng&code={code}','status':', '.join(r['status'] for r in maps['status'][code])}
        output.append({'product':product,'sourceUpdatedAt':p.get('last_update_date')})
    if len({p['product']['id'] for p in output})!=len(output):raise ValueError('Duplicate product identifiers')
    return output

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--directory',type=pathlib.Path,default=pathlib.Path('work/dpd'));parser.add_argument('--offline',action='store_true');parser.add_argument('--upload',action='store_true');args=parser.parse_args()
    if args.upload:
        base=os.getenv('MEDCHECK_URL','');token=os.getenv('MEDCHECK_IMPORT_TOKEN','')
        try:base=validate_target(base,token)
        except ValueError as error:parser.error(str(error))
    if args.upload:
        with SourceCheck('dpd',base,token,post) as check:import_products(args,base,token,check)
    else:import_products(args)

def import_products(args,base=None,token=None,check=None):
    if check:check.phase('downloading')
    values=collect(args.directory,args.offline)
    if check:check.phase('validating')
    entries=build(values)
    observed=datetime.datetime.now(datetime.timezone.utc).isoformat();digest=hashlib.sha256(json.dumps(entries,sort_keys=True).encode()).hexdigest()
    print(f'{len(entries):,} human products validated; snapshot {observed}',flush=True)
    if not args.upload:return
    if check:check.phase('archiving')
    for name in ENDPOINTS:archive_source(args.directory/(name+'.json'),base,token,'https://health-products.canada.ca/api/drug/'+name+'/?lang=en&type=json')
    # Run identity includes observation time so A→B→A remains a new occurrence.
    generation=hashlib.sha256((digest+observed).encode()).hexdigest()[:16]
    if check:check.phase('importing')
    run=post(base,token,{'action':'dpd-begin','id':generation,'count':len(entries),'observedAt':observed,'hash':digest})
    if run['state']=='active':
        print('Canadian catalogue unchanged; prior complete snapshot retained.')
        if check:
            check.outcome='unchanged'
            save_release(check,args.directory,run['id'],digest)
        return
    generation=run['id']
    for i in range(0,len(entries),400):
        post(base,token,{'action':'dpd','id':generation,'entries':entries[i:i+400]})
        if i%4000==0:print(f'{i:,} / {len(entries):,} products staged',flush=True)
    print(post(base,token,{'action':'dpd-complete','id':generation}),flush=True)
    while post(base,token,{'action':'dpd-cleanup'})['deleted']:pass
    if check:save_release(check,args.directory,generation,digest)
def save_release(check,directory,generation,digest):
    documents={name+'.json':read_metadata(directory/(name+'.json')) for name in ENDPOINTS}
    # Explicit offline input may not have network validators; it cannot seed release skipping.
    if all(documents.values()):check.send('release-save',generation=generation,datasetHash=digest,documents=documents)

if __name__=='__main__':main()
