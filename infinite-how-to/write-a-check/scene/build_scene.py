"""Compose the scene from the voiceover timing: fit the beat to the planned cuts, inject TM/BEAT/SHOTS/DUR."""
import json, subprocess, sys, os
here = os.path.dirname(os.path.abspath(__file__)); kit = os.path.dirname(os.path.dirname(here))
tm = json.load(open(sys.argv[1] if len(sys.argv) > 1 else '/home/claude/vo/build/timing.json'))
L = tm['lines']; words = tm['words']
lw = lambda li: [w for w in words if w['line'] == li]
# cut wishes: just before each line from line 1 on, plus "That's like handing..." in line 11
wish = [L[i]['start'] - 0.12 for i in range(1, len(L))]
wish.append(lw(11)[10]['start'] - 0.15); wish.sort()
fit = json.loads(subprocess.check_output(['python3', 'score.py', 'fit', ','.join(f'{x:.3f}' for x in wish), '--lo', '96', '--hi', '132'], cwd=kit))
dur = round(tm['duration'], 3)
head = f"'use strict';\nconst TM = {json.dumps(tm)};\nwindow.BEAT = {{ bpm: {fit['bpm']}, offset: {fit['offset']} }};\nwindow.SHOTS = {json.dumps(fit['snapped'])};\nwindow.DUR = {dur};\n"
open(os.path.join(kit, 'scenes', 'check_eli5.js'), 'w').write(head + open(os.path.join(here, 'check_body.js')).read())
print(json.dumps({'bpm': fit['bpm'], 'offset': fit['offset'], 'max_shift': fit['max_shift_s'], 'shots': fit['snapped'], 'dur': dur}))
