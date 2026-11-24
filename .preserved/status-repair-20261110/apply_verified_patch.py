"""Check the verified patch by default; install only after explicit restart approval."""
from pathlib import Path
import hashlib,json,os,shutil,sys

target=Path('/home/dev/.nvm/versions/node/v22.21.1/lib/node_modules/@getpaseo/cli/node_modules/@getpaseo/server/dist/server/server/agent/providers/claude/subagents/replay-source.js')
candidate=Path('/home/dev/paseo-status-repair-20261110-c3256/packages/server/dist/server/server/agent/providers/claude/subagents/replay-source.js')
original_hash='a224d474c614ae9db98f298cbdde1362c980b99276c3c59503085ca0c947e4ba'
patched_hash='720d780992630f6e904b3e31c696b7f41a2c3297e001a299d1b51f6767c33e3a'
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert digest(candidate)==patched_hash,'Verified candidate changed'
current=digest(target)
assert current in (original_hash,patched_hash),'Installed code changed; preserve it and rebase the patch'
apply='--apply' in sys.argv[1:]
if apply and current!=patched_hash:
    backup=candidate.parent/'replay-source.installed-before-fix.js'
    if backup.exists():assert digest(backup)==original_hash,'Rollback copy differs'
    else:shutil.copy2(target,backup)
    temporary=target.with_name(target.name+'.verified-pending')
    shutil.copy2(candidate,temporary)
    temporary.chmod(target.stat().st_mode)
    os.replace(temporary,target)
    assert digest(target)==patched_hash
print(json.dumps({'checked':True,'applied':apply,'installedHash':digest(target),'daemonRestarted':False}))
