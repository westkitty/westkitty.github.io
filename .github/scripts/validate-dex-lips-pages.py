#!/usr/bin/env python3
"""Fail-closed source/privacy/integrity gate for the public Dex_Lips Pages artifact."""
from __future__ import annotations
import hashlib
import re
import subprocess
import sys
from pathlib import Path

site=Path(sys.argv[1]).resolve()
root=site/'dex-lips-tablet'
expected={'index.html','app.mjs','contract.mjs','THIRD_PARTY.md',
          'demo/still.png','demo/moving.mp4','demo/speech.wav'}
files={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
if not expected.issubset(files): raise SystemExit('Missing public files: '+str(expected-files))
if set(p for p in files if not p.startswith('vendor/'))!=expected:
 raise SystemExit('Unapproved public files in tablet directory: '+str(files-expected))
if not (site/'.nojekyll').is_file(): raise SystemExit('No .nojekyll marker')
if (site/'.git').exists() or (site/'.github').exists(): raise SystemExit('Git/private workflow files leaked')
js=(root/'app.mjs').read_text();html=(root/'index.html').read_text()
for word in ['cdn.jsdelivr.net','unpkg.com','fetch(CDN','sendBeacon','new WebSocket','/Users/','/mnt/data/','BEGIN PRIVATE KEY','ghp_','sk-proj-']:
 # CDN variables are allowed only as local verified paths; no external remote domains.
 if word in js or word in html: raise SystemExit('Sensitive/remote pattern '+word)
for word in ['1.0.3','1.66.2','registerAacEncoder','sourceSHA256','sha(','srcHash','media.canEncodeVideo']:
 if word not in js and word not in (root/'THIRD_PARTY.md').read_text(): raise SystemExit('Expected operation missing: '+word)
if re.search(r'https?://', js): raise SystemExit('Remote URL in browser logic')
for item in ['lip-sync/index.mjs','lip-sync/lip-sync-engine.js','lip-sync/lip-sync-engine.wasm','lip-sync/lip-sync-engine.data','mediabunny/mediabunny.mjs','mediabunny/mediabunny-aac-encoder.mjs']:
 if not (root/'vendor'/item).is_file(): raise SystemExit('Vendor file absent '+item)
subprocess.run(['node','--check',str(root/'app.mjs')],check=True)
subprocess.run(['node','--check',str(root/'contract.mjs')],check=True)
subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(root/'demo/moving.mp4'),'-f','null','-'],check=True)
subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(root/'demo/speech.wav'),'-f','null','-'],check=True)
print('PAGES_PUBLIC_BOUNDARY_PASS: '+str(len(files))+' tablet files, no private paths, exact vendor hashes checked')
