"""Write a bounded, redacted Actions summary from the local source-check records."""
import datetime,json,os,pathlib

SOURCES={'maintenance':'Storage maintenance','dpd':'Canadian products','cv':'Canada Vigilance','dailymed':'US labels'}
OUTCOMES={'updated','unchanged','failed','running'}
PHASES={'checking','downloading','validating','archiving','importing','refreshing','cleanup','complete'}

def summary(directory,steps):
    lines=['## Medication source update','', '| Source | Result | Phase | Attempt (UTC) |', '| --- | --- | --- | --- |']
    for source,name in SOURCES.items():
        try:
            path=directory/(source+'.json')
            if path.stat().st_size>4096:raise ValueError('Oversized check record')
            record=json.loads(path.read_text())
            outcome=record.get('outcome') if record.get('outcome') in OUTCOMES else 'unknown'
            phase=record.get('phase') if record.get('phase') in PHASES else 'unknown'
            started=datetime.datetime.fromisoformat(record['started']).astimezone(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
            if outcome=='running':outcome='interrupted / incomplete'
        except (OSError,ValueError,KeyError,TypeError):outcome,phase,started='not checked','—','—'
        step=steps.get(source)
        if step in ('failure','cancelled'):outcome='failed / incomplete'
        elif step=='skipped':outcome='not checked (skipped)'
        lines.append(f'| {name} | {outcome} | {phase} | {started} |')
    lines+=['','An unchanged check confirms the installed release; it does not advance source coverage dates.',
            'Failures retain the previous complete dataset. Rerun the workflow to resume; inspect the failed step for a capacity or source-access blocker.',
            'Storage ceilings, launch gating and recovery steps are documented in SETUP.md. No patient notification is sent.','']
    return '\n'.join(lines)

def main():
    text=summary(pathlib.Path('work/checks'),{s:os.getenv('STEP_'+s.upper()) for s in SOURCES})
    print(text)
    if os.getenv('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as output:output.write(text)

if __name__=='__main__':main()
