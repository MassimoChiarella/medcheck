"""Source-check lifecycle shared by command-line importers. No third-party dependencies."""
import datetime,json,pathlib,threading,uuid

def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

class SourceCheck:
    def __init__(self,source,base,token,post,directory=pathlib.Path('work/checks')):
        self.source,self.base,self.token,self.post=source,base,token,post
        self.run_id=uuid.uuid4().hex
        self.phase_name='checking';self.outcome='updated';self.started=timestamp()
        self.directory=directory;self.stop=threading.Event();self.thread=None;self.heartbeat_error=None

    def record(self,outcome,error=None):
        self.directory.mkdir(parents=True,exist_ok=True)
        value={'source':self.source,'started':self.started,'recordedAt':timestamp(),'phase':self.phase_name,'outcome':outcome}
        if error:value['error']=error
        path=self.directory/(self.source+'.json');temp=path.with_suffix('.tmp')
        temp.write_text(json.dumps(value,indent=2)+'\n');temp.replace(path)

    def send(self,action,**fields):
        return self.post(self.base,self.token,{'action':action,'source':self.source,'runId':self.run_id,'phase':self.phase_name,**fields})

    def __enter__(self):
        self.record('running')
        try:self.send('check-begin')
        except Exception:
            self.record('failed','Could not start an authenticated source check.');raise
        self.thread=threading.Thread(target=self.heartbeat,daemon=True);self.thread.start()
        return self

    def heartbeat(self):
        while not self.stop.wait(60):
            try:self.send('check-heartbeat')
            except Exception as error:
                self.heartbeat_error=error;return

    def phase(self,name):
        if self.heartbeat_error:raise RuntimeError('Source check heartbeat failed; retry to resume.') from self.heartbeat_error
        self.phase_name=name;self.send('check-heartbeat');self.record('running')

    def __exit__(self,kind,error,traceback):
        self.stop.set()
        if self.thread:self.thread.join(timeout=5)
        outcome='failed' if kind or self.heartbeat_error else self.outcome
        reason=None if outcome!='failed' else 'Source update failed; previous successful data remains available. See owner logs.'
        self.record(outcome,reason)
        try:self.send('check-finish',outcome=outcome)
        except Exception:
            self.record('failed','Could not confirm completion with the installation. Its last successful dataset is retained.')
            if kind is None:raise
        if self.heartbeat_error and kind is None:raise RuntimeError('Source check lost its heartbeat; completion was not successful.') from self.heartbeat_error
        return False
