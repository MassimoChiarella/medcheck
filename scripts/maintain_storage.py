"""Audit storage; --apply reclaims only eligible, unreferenced staging artifacts."""
import argparse,json,os,time
from import_canada import post,validate_target
from update_run import SourceCheck

def maintain(base,token,apply=False):
    deadline=time.monotonic()+1800
    deleted_rows=0
    with SourceCheck('maintenance',base,token,post) as check:
        check.phase('cleanup')
        def request(action,**fields):
            if time.monotonic()>deadline:raise RuntimeError('Maintenance time budget reached; rerun to resume bounded cleanup.')
            return check.send(action,**fields)
        after='';candidates=0
        while True:
            plan=request('maintenance-plan',after=after)
            if not after:print(json.dumps({'mode':'apply' if apply else 'dry-run','capacity':plan['capacity'],'protectedGenerations':plan['protectedIds'],'graceDays':plan['graceDays']}),flush=True)
            candidates+=len(plan['candidates'])
            for item in plan['candidates']:
                print('Eligible generation: '+item['id'],flush=True)
                if apply:
                    while True:
                        result=request('maintenance-clean',id=item['id'])
                        deleted_rows+=result['deleted']
                        if result['done']:break
            if not plan['hasMore']:break
            after=plan['cursor']
        cursor=''
        while True:
            scan=request('maintenance-scan',cursor=cursor,dryRun=not apply)
            if scan['complete']:break
            cursor=scan['cursor']
        result={k:scan[k] for k in ['archiveBytes','archiveLimitBytes','scannedObjects','deletedObjects','deletedBytes','dryRun']}
        result.update(eligibleGenerations=candidates,deletedRows=deleted_rows)
        print(json.dumps(result),flush=True)
        check.outcome='updated' if deleted_rows or scan['deletedObjects'] else 'unchanged'
        return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true',help='Delete eligible staging work; the default only audits.')
    args=parser.parse_args()
    base=validate_target(os.getenv('MEDCHECK_URL',''),os.getenv('MEDCHECK_IMPORT_TOKEN',''))
    maintain(base,os.environ['MEDCHECK_IMPORT_TOKEN'],args.apply)

if __name__=='__main__':main()
