# Proof that every review-round-3 check passes on this tree and FAILS on 2fa88eb (the reviewed commit).
# Run from anywhere: python3 scripts/golf-proof.py
# WRITES ONLY UNDER /tmp: the old commit is exported with `git archive` into /tmp/golf-proof/old (no worktree, nothing added to this repo), and the
# same test file (odds-api/golf.round3.test.js, read from this tree) is run against it with GOLF_ROOT pointing there.
import os, subprocess, sys, shutil, io, tarfile
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD_REV = os.environ.get('OLD', '2fa88eb'); OUT = '/tmp/golf-proof'; OLD = OUT + '/old'
shutil.rmtree(OLD, ignore_errors=True); os.makedirs(OLD)
tar = subprocess.run(['git', '-C', HERE, 'archive', OLD_REV, 'odds-api'], capture_output=True, check=True).stdout
tarfile.open(fileobj=io.BytesIO(tar)).extractall(OLD, filter='data')
TEST = HERE + '/odds-api/golf.round3.test.js'
env0 = dict(os.environ, NODE_PATH='')
names = [l.split('\t', 1) for l in subprocess.run(['node', TEST, '--list'], capture_output=True, text=True, env=env0).stdout.strip().split('\n')]
bad = 0; lines = []
for i, name in names:
    res = []
    for root in (HERE + '/odds-api/', OLD + '/odds-api/'):
        p = subprocess.run(['node', TEST, i], capture_output=True, text=True, timeout=300, env=dict(env0, GOLF_ROOT=root), cwd='/tmp')
        why = [l.strip() for l in (p.stdout + p.stderr).split('\n') if l.strip() and not l.startswith('  ok') and 'ROUND 3 CHECKS' not in l and not l.startswith('golf: recordPlay')]
        res.append((p.returncode == 0, (why[1] if len(why) > 1 else why[0] if why else '')[:200]))
    good = res[0][0] and not res[1][0]; bad += 0 if good else 1
    lines.append(('OK   ' if good else 'BAD  ') + ('passes here' if res[0][0] else 'FAILS here') + ' | ' + ('fails on ' if not res[1][0] else 'PASSES on ') + OLD_REV + ' | ' + name[:110] + ('' if res[0][0] else '\n       here: ' + res[0][1]) + '\n       old:  ' + res[1][1])
open(OUT + '/result.txt', 'w').write('\n'.join(lines) + '\n')
print('\n'.join(lines)); print(('\n%d of %d checks are not a proof' % (bad, len(names))) if bad else '\nALL %d checks pass here and fail on %s (written to %s/result.txt)' % (len(names), OLD_REV, OUT))
sys.exit(1 if bad else 0)
