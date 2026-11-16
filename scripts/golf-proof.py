# Proof that each review-round-2 test section passes on this tree and FAILS on 544803e. Needs: git worktree add /tmp/golf-old 544803e
# Run: python3 scripts/golf-proof.py
import re,subprocess,sys,shutil,os
src=open('/home/claude/calcutta-golf/odds-api/golf.test.js',encoding='utf8').read().split('\n')
L=lambda n: n-1
listen=[i for i,l in enumerate(src) if l.startswith('srv.listen(')][0]
tr=[i for i,l in enumerate(src) if l.strip()=='try {' and i>listen][0]
course=[l for l in src if l.strip().startswith("const course = { name: 'Palm Valley'")][0]
p0=[i for i,l in enumerate(src) if 'REVIEW ROUND 2' in l][0]-1
secs=[i for i,l in enumerate(src) if l.startswith('    { // ----') and i>p0]
end=[i for i,l in enumerate(src) if l.strip()=="// ---------------- privacy ----------------"][0]-1
head=src[:tr+1]
headOld=[l.replace(", shares: { P1: 0.5, P2: 0.5 }","").replace("if (same !== null) assert.ok(same,","if (false) assert.ok(same,") for l in head]
prel=src[p0:secs[0]]
tail=["    console.log('SECTION PASSED'); srv.close(); process.exit(0);","  } catch (e) { console.error('FAIL: ' + String(e && e.message).replace(/\\s+/g, ' ').slice(0, 260)); srv.close(); process.exit(1); }","});"]
res=[]
for k,s in enumerate(secs):
    e=secs[k+1] if k+1<len(secs) else end
    body=src[s:e]
    name=re.sub(r'^\s*\{ // ---- ','',src[s])[:70]
    out=[]
    for root in ['/home/claude/calcutta-golf','/tmp/golf-old']:
        txt='\n'.join((headOld if root=='/tmp/golf-old' else head)+[course]+prel+body+tail)
        f=root+'/odds-api/_sec.test.js'; open(f,'w',encoding='utf8').write(txt)
        if root=='/tmp/golf-old': shutil.copy('/home/claude/calcutta-golf/odds-api/golf.fakestats.js',root+'/odds-api/golf.fakestats.js')
        p=subprocess.run(['node',f],capture_output=True,text=True,timeout=120)
        last=[l for l in (p.stdout+p.stderr).split('\n') if l.strip() and not l.startswith('  ok') and not l.startswith('golf: recordPlay')]
        out.append((p.returncode, (last[-1] if last else '')[:230]))
        if not os.environ.get('KEEP'): os.remove(f)
    res.append((name,out))
    print(('PASS' if out[0][0]==0 else 'FAIL')+' new | '+('FAILS' if out[1][0]!=0 else 'PASSES')+' on 544803e | '+name)
    if out[0][0]!=0: print('     new:',out[0][1])
    print('     old:',out[1][1])
