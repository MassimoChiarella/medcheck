"""Source-check lifecycle shared by command-line importers. No third-party dependencies."""
import datetime,json,pathlib,threading,uuid

def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

class SourceCheck:
    def __init__(self,source,base,token,post,directory=pathlib.Path('work/checks')):
        self.source,self.base,self.token,self.post=source,base,token,post
        self.run_id=uuid.uuid4().hex
        self.phase_name='checking';self.outcome='updated';self.started=timestamp()
        self.lease_epoch=None;self.directory=directory;self.stop=threading.Event();self.thread=None;self.heartbeat_error=None

    def record(self,outcome,error=None):
        self.directory.mkdir(parents=True,exist_ok=True)
        value={'source':self.source,'started':self.started,'recordedAt':timestamp(),'phase':self.phase_name,'outcome':outcome}
        if error:value['error']=error
        path=self.directory/(self.source+'.json');temp=path.with_suffix('.tmp')
        temp.write_text(json.dumps(value,indent=2)+'\n');temp.replace(path)

    def ensure_active(self):
        if self.heartbeat_error:raise RuntimeError('Source check heartbeat failed; retry with a new lease.') from self.heartbeat_error

    def credentials(self):
        return {'protocolVersion':2,'source':self.source,'runId':self.run_id,'leaseEpoch':self.lease_epoch}

    def send(self,action,**fields):
        # Terminal status is still attempted after producer cancellation; the server fence
        # rejects lost ownership, while ordinary validation failures release a valid lease.
        if action!='check-finish':self.ensure_active()
        return self.post(self.base,self.token,{'action':action,'phase':self.phase_name,**self.credentials(),**fields},check=None if action=='check-finish' else self)

    def request(self,payload):
        self.ensure_active()
        return self.post(self.base,self.token,{**payload,**self.credentials()},check=self)


    def __enter__(self):
        self.record('running')
        try:
            started=self.send('check-begin');self.lease_epoch=started['leaseEpoch']
            if started.get('protocolVersion')!=2:raise RuntimeError('Update this installation to the current import protocol.')
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
