#!/usr/bin/env python3
"""Real Chrome synthetic proof: local Pages build, Rhubarb -> H.264/AAC, no remote requests."""
from __future__ import annotations
import array
import base64
import json
import math
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import wave
from playwright.sync_api import sync_playwright

site=Path(sys.argv[1]).resolve()
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(site),**kwargs)
    def log_message(self,fmt,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/dex-lips-tablet/'

with wave.open(str(site/'dex-lips-tablet/demo/speech.wav'),'rb') as wf:
    if wf.getframerate()!=16000 or wf.getnchannels()!=1 or wf.getsampwidth()!=2:
        raise AssertionError('Incorrect synthetic fixture')
    source=array.array('h');source.frombytes(wf.readframes(wf.getnframes()))

def verify_mp4(payload:bytes,kind:str):
    with tempfile.TemporaryDirectory() as td:
        file=Path(td)/f'{kind}.mp4';file.write_bytes(payload)
        info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_name,codec_type,nb_frames','-of','json',str(file)],timeout=15))
        tracks=info['streams']
        video=next((x for x in tracks if x.get('codec_type')=='video'),None)
        audio=next((x for x in tracks if x.get('codec_type')=='audio'),None)
        if video is None or video['codec_name']!='h264' or int(video['nb_frames'])!=48:
            raise AssertionError(f'{kind} invalid H264: {tracks}')
        if audio is None or audio['codec_name']!='aac':raise AssertionError(f'{kind} invalid AAC: {tracks}')
        decoded=subprocess.check_output(['ffmpeg','-v','error','-xerror','-i',str(file),'-vn','-ac','1','-ar','16000','-f','s16le','-'],timeout=20)
        samples=array.array('h');samples.frombytes(decoded)
        if len(samples)<len(source):raise AssertionError(f'{kind} audio truncated')
        a=source[::4];b=samples[:len(source):4]
        dot=sum(x*y for x,y in zip(a,b))
        power=math.sqrt(sum(x*x for x in a)*sum(y*y for y in b))
        similarity=dot/power
        if similarity<0.97:raise AssertionError(f'{kind} spoken audio mismatch: correlation={similarity}')
        subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(file),'-f','null','-'],check=True,timeout=20)
        return {'codecVideo':'h264','codecAudio':'aac','frames':48,'duration':float(info['format']['duration']),'speechCorrelation':round(similarity,5)}

try:
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome',headless=True,args=['--disable-dev-shm-usage','--no-sandbox'])
        ctx=browser.new_context(viewport={'width':800,'height':1130},device_scale_factor=1,has_touch=True,is_mobile=True)
        page=ctx.new_page()
        seen_external=[];failures=[]
        page.on('request',lambda r:seen_external.append(r.url) if not r.url.startswith(('http://127.0.0.1:', 'blob:')) else None)
        page.on('pageerror',lambda e:failures.append(str(e)))
        page.goto(url,wait_until='domcontentloaded',timeout=10000)
        assert page.title()=='Dex_Lips · Browser Studio'
        assert page.evaluate('window.isSecureContext') is True
        assert not page.evaluate('document.documentElement.scrollWidth > window.innerWidth')
        # Consent failure is a real state, not a dead button.
        page.locator('#custom-start').click()
        page.locator('#status[data-kind="error"]').wait_for(timeout=3000)
        for kind,button in [('still','#demo-still'),('moving','#demo-moving')]:
            page.locator(button).click()
            page.locator('#status[data-kind="success"], #status[data-kind="error"]').wait_for(timeout=125000)
            state=page.locator('#status').inner_text()
            if page.locator('#status').get_attribute('data-kind')!='success':
                raise AssertionError(f'{kind} rendering failed: {state}; js={failures}')
            receipt=json.loads(page.locator('#receipt').inner_text())
            if receipt['realRhubarbCueCount']<2 or receipt['frames']!=48:
                raise AssertionError(f'{kind} no correct Rhubarb cues/frames: {receipt}')
            if receipt['sourceSHA256']!=receipt['sourceSHA256After']:
                raise AssertionError(f'{kind} source mutated')
            data=page.evaluate("""async()=>{const r=await fetch(document.getElementById('download').href); const bytes=new Uint8Array(await r.arrayBuffer());let out='';for(let i=0;i<bytes.length;i+=8192){out+=String.fromCharCode(...bytes.subarray(i,i+8192))}return btoa(out)}""")
            proof=verify_mp4(base64.b64decode(data),kind)
            cues=json.loads(page.evaluate("async()=>await (await fetch(document.getElementById('cueDownload').href)).text()"))
            assert len(cues['mouthCues'])==receipt['realRhubarbCueCount']
            print('BROWSER_PROOF_PASS',json.dumps({'kind':kind,**proof,'cues':len(cues['mouthCues']),'bytes':receipt['bytes'],'nativeAac':receipt['aacNative']}),flush=True)
            if failures:raise AssertionError(f'{kind} browser console exception: {failures}')
        if seen_external:raise AssertionError('Unexpected external browser network: '+str(seen_external[:5]))
        page.close();browser.close()
    print('REAL_CHROME_SMOKE_PASS: still and moving H264/AAC, speech, mouth cues, source hashes, no external network')
finally:
    server.shutdown();server.server_close()
