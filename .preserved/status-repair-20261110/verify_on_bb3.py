from pathlib import Path
import datetime,hashlib,json,os,subprocess

root=Path('/home/dev/paseo-status-repair-20261110-c3256')
os.chdir(root)
env=os.environ.copy()
env['PATH']='/home/dev/.nvm/versions/node/v22.21.1/bin:'+env.get('PATH','')
env['CI']='1'
npm='/home/dev/.nvm/versions/node/v22.21.1/bin/npm'
receipt={'owner':'Paseo stale workspace status repair','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'phase':'preparing','checks':{},'sharedDaemonChanged':False}
def save():
    p=root/'verification.json.pending'
    p.write_text(json.dumps(receipt,indent=2)+'\n')
    p.replace(root/'verification.json')
def run(name,command,expect_failure=False):
    receipt['phase']=name;save();print(json.dumps({'phase':name}),flush=True)
    with (root/(name+'.log')).open('w') as log:
        result=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,env=env)
    text=(root/(name+'.log')).read_text(errors='replace')
    receipt['checks'][name]={'exitCode':result.returncode,'log':name+'.log'};save()
    if expect_failure:
        if result.returncode==0 or 'marks a replayed subagent' not in text or 'AssertionError' not in text:
            raise RuntimeError('Expected regression was not reproduced; see '+name+'.log')
    elif result.returncode:
        raise RuntimeError(name+' failed; see '+name+'.log')
    print(json.dumps({'finished':name,'exitCode':result.returncode}),flush=True)
try:
    run('install',[npm,'ci','--ignore-scripts','--no-audit','--no-fund'])
    run('baseline-build',[npm,'run','build:server'])
    run('tests-patch',['git','apply',str(root/'tests.patch')])
    test=[npm,'run','test:unit','--workspace=@getpaseo/server','--','src/server/agent/providers/claude/subagents/replay-source.test.ts','--bail=1']
    run('regression-before',test,True)
    run('production-patch',['git','apply',str(root/'production.patch')])
    files=['packages/server/src/server/agent/providers/claude/subagents/replay-source.ts','packages/server/src/server/agent/providers/claude/subagents/replay-source.test.ts']
    run('format',[npm,'run','format:files','--',*files])
    run('regression-after',test)
    run('patched-build',[npm,'run','build:server'])
    run('typecheck',[npm,'run','typecheck','--workspace=@getpaseo/server'])
    run('lint',[npm,'run','lint','--',*files])
    receipt['phase']='verified';receipt['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    receipt['sourceHashes']={p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in files};save()
    print(json.dumps(receipt),flush=True)
except Exception as error:
    receipt['phase']='blocked';receipt['error']=str(error);save();print(json.dumps(receipt),flush=True)
    raise
