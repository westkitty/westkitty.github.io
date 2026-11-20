import {LIMITS, SHAPES, verifySourceDigest, validateRig, validateCues, validateKeyframes, anchorAt, shapeAt, outputDimensions, assertMediaFile, selectAacEncoder, assertMemoryBudget} from './contract.mjs';

// All fetched library URLs have exact immutable npm version pins; app checks
// SHA-256 of their distributed bytes before invoking them. No uploaded media
// enters a fetch(), POST, beacon, WebSocket or service worker.
const CDN = Object.freeze({
  lip:'https://cdn.jsdelivr.net/npm/lip-sync-engine@1.0.3/dist/index.mjs',
  js:'https://cdn.jsdelivr.net/npm/lip-sync-engine@1.0.3/dist/wasm/lip-sync-engine.js',
  wasm:'https://cdn.jsdelivr.net/npm/lip-sync-engine@1.0.3/dist/wasm/lip-sync-engine.wasm',
  data:'https://cdn.jsdelivr.net/npm/lip-sync-engine@1.0.3/dist/wasm/lip-sync-engine.data',
  media:'https://cdn.jsdelivr.net/npm/mediabunny@1.66.2/dist/bundles/mediabunny.mjs',
  aac:'https://cdn.jsdelivr.net/npm/@mediabunny/aac-encoder@1.66.2/dist/bundles/mediabunny-aac-encoder.mjs'
});
const LOCKED = Object.freeze({
  lip:'bc9b36a83ea3707cdda4ecaf47d37ebff00a12b2764607c60a5cdb47f9cef198',
  js:'078c9cb6b2daa1a01bd1894962c298387b341fbec6697ef611f201e384c60c3e',
  wasm:'1846795c8f25b5069416d00f5053c40514725ad0899a9c3e2da6065dce54fa5a',
  data:'70cdab484b820d34e63d33d5df5eef5265eebae926d6b962da243c4368a69a52',
  media:'6561396012f179bd4c538188c4b057676ba28a1b7967fff740479f3f8a2e8081',
  aac:'a04e2d292d5701d18a4c6ce163969d4bfcd581d45e555566b9aed9ea551cf765'
});
const PROTECTED = Object.freeze([
  '098e017a4960e7eeda634ac58c3b2dafc7097f8af87cab439bfbb88d4c87d1e2',
  '03fd4f144ebc005e70ce8e9e906da9979a94ebe1a6344982e49fcf2441e5a8b3'
]);
const $=id=>document.getElementById(id);
const actionIds=['demo-still','demo-moving','custom-start'];
let busy=false, stopped=false, cancelRequested=false, active=null, memoryMeter=null, memoryPeak=null, observedSamples=0, outputUrls=[];
let sourceImage=null, videoInput=null, engine=null, libraryPromise=null, codecModule=null;
function show(message,kind='idle'){const node=$('status');node.textContent=message;node.dataset.kind=kind;}
function status(message){show(message,'running');}
function clearResult(){const player=$('preview');player.pause();player.removeAttribute('src');player.load();for(const u of outputUrls)URL.revokeObjectURL(u);outputUrls=[];$('download').hidden=true;$('cueDownload').hidden=true;$('receipt').textContent='No output for this run.';$('metric').textContent='';}
function setBusy(value){busy=value;for(const id of actionIds)$(id).disabled=value;$('cancel').disabled=!value;}
function requireActive(){if(stopped||cancelRequested||active?.signal.aborted)throw Error('Render cancelled');}
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
function json(text,description){try{return JSON.parse(text)}catch{throw Error(description+' must be valid JSON');}}
async function verifyPackage(key){
  requireActive();
  const url=CDN[key];status('Checking pinned library integrity: '+key+(key==='data'?' (37.9 MB)':''));
  const response=await fetch(url,{cache:'force-cache',signal:active.signal,mode:'cors'});
  if(!response.ok)throw Error('Could not load '+key+' library asset (HTTP '+response.status+')');
  const bytes=await response.arrayBuffer();requireActive();
  if(await sha(bytes)!==LOCKED[key])throw Error('Library asset integrity mismatch: '+key+'. Nothing was run.');
}
async function getLibraries(){
  if(codecModule)return codecModule;
  if(!libraryPromise){libraryPromise=(async()=>{
    for(const key of ['lip','media','js','wasm','data'])await verifyPackage(key);
    requireActive();status('Loading verified speech and video modules');
    const [lip,media]=await Promise.all([import(CDN.lip),import(CDN.media)]);
    if(typeof lip.LipSyncEngine?.getInstance!=='function'||typeof media.Output!=='function')throw Error('Pinned library API unavailable');
    return {lip,media};
  })().catch(e=>{libraryPromise=null;throw e})}
  codecModule=await libraryPromise;return codecModule;
}
async function pcmFromAudio(raw){
  const bytes=new Uint8Array(raw),v=new DataView(raw);
  const tag=o=>String.fromCharCode(...bytes.slice(o,o+4));
  if(bytes.byteLength>=44&&tag(0)==='RIFF'&&tag(8)==='WAVE'){
    let fmt,block;
    for(let p=12;p+8<=bytes.length;){const size=v.getUint32(p+4,true),offset=p+8;
      if(size>bytes.length-offset)throw Error('WAV audio has a truncated chunk');
      if(tag(p)==='fmt '&&size>=16)fmt={format:v.getUint16(offset,true),channels:v.getUint16(offset+2,true),rate:v.getUint32(offset+4,true),bits:v.getUint16(offset+14,true)};
      if(tag(p)==='data')block={offset,size};p=offset+size+(size&1)}
    if(fmt&&block&&fmt.format===1&&fmt.channels===1&&fmt.rate===16000&&fmt.bits===16){
      if(block.size%2)throw Error('WAV data chunk misaligned');const n=block.size/2;
      if(n/16000<LIMITS.minSeconds||n/16000>LIMITS.maxSeconds)throw Error('Speech duration outside 0.15–30 seconds');
      const pcm=new Int16Array(n),floats=new Float32Array(n);
      for(let i=0;i<n;i++){const x=v.getInt16(block.offset+i*2,true);pcm[i]=x;floats[i]=x/32768}return {pcm,floats,seconds:n/16000};
    }
  }
  status('Decoding speech locally');
  if(typeof OfflineAudioContext!=='function')throw Error('This browser cannot decode the selected audio format');
  const initial=new OfflineAudioContext(1,1,16000);
  const decoded=await initial.decodeAudioData(raw.slice(0));
  if(!Number.isFinite(decoded.duration)||decoded.duration<.15||decoded.duration>30)throw Error('Speech duration outside 0.15–30 seconds');
  const normalized=new OfflineAudioContext(1,Math.round(decoded.duration*16000),16000);
  const src=normalized.createBufferSource();src.buffer=decoded;src.connect(normalized.destination);src.start();
  const output=await normalized.startRendering();const floats=output.getChannelData(0),pcm=new Int16Array(floats.length);
  for(let i=0;i<floats.length;i++){const x=Math.max(-1,Math.min(1,floats[i]));pcm[i]=Math.round(x<0?x*32768:x*32767)}
  return {pcm,floats,seconds:pcm.length/16000};
}
function checkPng(buf,name){const a=new Uint8Array(buf),v=new DataView(buf);if(a.length<33||a[0]!==137||a[1]!==80||a[2]!==78||a[3]!==71||a[4]!==13||a[5]!==10||a[6]!==26||a[7]!==10)throw Error('Not a PNG: '+name);const width=v.getUint32(16),height=v.getUint32(20),alpha=v.getUint8(25);if(width<1||height<1||width*height>LIMITS.maxSpritePixels||![4,6].includes(alpha))throw Error('Mouth sprite needs transparent PNG and a safe size: '+name)}
function mouthCanvas(code){
  const c=document.createElement('canvas');c.width=64;c.height=50;const ctx=c.getContext('2d');
  ctx.strokeStyle='#72f8e1';ctx.fillStyle='#061821';ctx.lineWidth=3.5;ctx.lineJoin='round';ctx.lineCap='round';
  if(code==='X'){ctx.beginPath();ctx.moveTo(14,24);ctx.quadraticCurveTo(32,28,50,24);ctx.stroke();return c;}
  const shape={A:[17,6],B:[19,10],C:[17,16],D:[19,22],E:[21,15],F:[23,8],G:[24,13],H:[18,20]}[code];
  ctx.beginPath();ctx.ellipse(32,25,shape[0],shape[1],0,0,Math.PI*2);ctx.fill();ctx.stroke();
  if('CDEGH'.includes(code)){ctx.strokeStyle='#d4fff8';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(18,25);ctx.lineTo(46,25);ctx.stroke()}return c;
}
async function prepareDemo(mode){
  const path=mode==='moving'?'./demo/moving.mp4':'./demo/still.png';
  const [sourceResponse,audioResponse]=await Promise.all([fetch(path,{signal:active.signal}),fetch('./demo/speech.wav',{signal:active.signal})]);
  if(!sourceResponse.ok||!audioResponse.ok)throw Error('Synthetic demo files unavailable');
  const [sourceBytes,audioBytes]=await Promise.all([sourceResponse.arrayBuffer(),audioResponse.arrayBuffer()]);
  const sourceName=mode==='moving'?'synthetic_moving_video.mp4':'synthetic_character.png';
  const shaSource=await sha(sourceBytes);verifySourceDigest(shaSource,PROTECTED);
  const shapes=Object.fromEntries([...SHAPES].map(c=>[c,c+'.png']));
  const rig={schema_version:1,character_id:'synthetic_speaking_oval',source_path:sourceName,
    source_sha256:shaSource,authority:'synthetic_demo',approved:true,mouth_anchor:{x:.5,y:.61,scale:1,rotation_deg:0},shapes};
  const spriteBitmaps={};for(const code of SHAPES)spriteBitmaps[code]=await createImageBitmap(mouthCanvas(code));
  const authorized=validateRig(rig,shaSource,PROTECTED,Object.values(shapes));
  return {sourceBytes,audioBytes,srcHash:shaSource,rig,authorized,sprites:spriteBitmaps,mode,sourceName,sourceType:mode==='moving'?'video/mp4':'image/png',keyframes:null,transcript:'Hello there. We are testing the speaking mouth.'};
}
async function prepareCustom(){
  if(!$('approved').checked)throw Error('Confirm permission for all custom media and mouth artwork');
  const source=$('source').files?.[0],audio=$('audio').files?.[0],files=Array.from($('sprites').files||[]),rigFile=$('rig').files?.[0];
  const {isVideo}=assertMediaFile(source);assertMediaFile(audio,true);
  if(isVideo&&!$('neutral').checked)throw Error('Confirm existing video mouth has been neutralized or masked first');
  if(files.length<2||files.length>9)throw Error('Upload 2–9 separate mouth PNGs, including X.png');
  if(files.some(f=>f.size<1||f.size>LIMITS.spriteBytes))throw Error('A mouth sprite exceeds the 3 MB limit');
  const names=files.map(f=>f.name);
  if(new Set(names).size!==names.length)throw Error('Duplicate mouth sprite filename');
  const [sourceBytes,audioBytes]=await Promise.all([source.arrayBuffer(),audio.arrayBuffer()]);
  const srcHash=await sha(sourceBytes);verifySourceDigest(srcHash,PROTECTED);
  const anchor={x:Number($('x').value),y:Number($('y').value),scale:Number($('scale').value),rotation_deg:Number($('angle').value)};
  let rig;
  if(rigFile){if(!rigFile.size||rigFile.size>LIMITS.rigBytes)throw Error('Rig JSON exceeds 256 KB');rig=json(await rigFile.text(),'Rig JSON')}
  else{const shapes={};for(const f of files){const match=/^([A-HX])\.png$/.exec(f.name);if(!match)throw Error('Mouth file must be named A.png–H.png or X.png');shapes[match[1]]=f.name}
    rig={schema_version:1,character_id:'user_authorized_noncanonical',source_path:source.name,source_sha256:srcHash,authority:'approved_user_rig',approved:true,mouth_anchor:anchor,shapes};
  }
  const authorized=validateRig(rig,srcHash,PROTECTED,names);
  const sprites={};for(const [code,name] of Object.entries(authorized.shapes)){requireActive();const file=files.find(f=>f.name===name);const b=await file.arrayBuffer();checkPng(b,name);sprites[code]=await createImageBitmap(new Blob([b],{type:'image/png'}))}
  const keytext=$('keyframes').value.trim();const transcript=$('transcript').value.trim();
  if(transcript.length>10000)throw Error('Transcript too long');
  return {sourceBytes,audioBytes,srcHash,rig,authorized,sprites,mode:isVideo?'moving':'still',sourceName:source.name,sourceType:source.type||'application/octet-stream',keyframes:keytext?json(keytext,'Keyframes'):null,transcript};
}
function meter(){const b=performance.memory?.usedJSHeapSize;if(typeof b==='number'&&Number.isFinite(b)){memoryPeak=Math.max(memoryPeak??0,b);observedSamples++}assertMemoryBudget(b??null,navigator.deviceMemory)}
function link(anchor,bytes,type,name){const url=URL.createObjectURL(new Blob([bytes],{type}));outputUrls.push(url);anchor.href=url;anchor.download=name;anchor.hidden=false;return url}
async function run(kind){
  if(busy)return;setBusy(true);clearResult();cancelRequested=false;stopped=false;active=new AbortController();memoryPeak=null;observedSamples=0;
  let pack=null,videoInput=null,stillImage=null;const started=performance.now();
  memoryMeter=setInterval(()=>{try{meter()}catch(e){cancelRequested=true;active?.abort();show('Memory safety limit: '+e.message,'error')}},135);
  try{
    if(!window.isSecureContext)throw Error('Open this page over HTTPS; browser media APIs require a secure context');
    status(kind==='custom'?'Reading your authorized files':'Loading synthetic demonstration');
    pack=kind==='custom'?await prepareCustom():await prepareDemo(kind);
    requireActive();const {sourceBytes,audioBytes,srcHash,sprites,mode}=pack;
    const audioHash=await sha(audioBytes),{pcm,floats,seconds}=await pcmFromAudio(audioBytes);requireActive();
    const {lip,media}=await getLibraries();requireActive();
    status('Starting Rhubarb WASM speech recognizer');engine=lip.LipSyncEngine.getInstance();
    await engine.init({wasmPath:CDN.wasm,dataPath:CDN.data,jsPath:CDN.js});requireActive();
    const tAnalysis=performance.now();status('Recognizing spoken mouth shapes');
    const cuesDoc=await engine.analyze(pcm,{sampleRate:16000,dialogText:pack.transcript});requireActive();
    const analysisMs=performance.now()-tAnalysis,cues=validateCues(cuesDoc,seconds,Object.keys(pack.authorized.shapes));
    const keys=validateKeyframes(pack.keyframes,pack.authorized.anchor,seconds);
    let dims,sink;
    if(mode==='moving'){
      status('Checking video source and timing');
      videoInput=new media.Input({formats:media.ALL_FORMATS,source:new media.BlobSource(new Blob([sourceBytes],{type:pack.sourceType}))});
      const track=await videoInput.getPrimaryVideoTrack();
      if(!track||!await track.canDecode())throw Error('Your browser cannot decode that source video');
      const [start,clipSeconds,w,h]=await Promise.all([videoInput.getFirstTimestamp(),videoInput.computeDuration(),track.getDisplayWidth(),track.getDisplayHeight()]);
      if(!Number.isFinite(start)||Math.abs(start)>.05||!Number.isFinite(clipSeconds)||Math.abs(clipSeconds-seconds)>Math.max(.08,2/24))throw Error('Video must start at zero and match the audio duration');
      dims=outputDimensions(w,h);sink=new media.VideoSampleSink(track);
    }else{
      stillImage=await createImageBitmap(new Blob([sourceBytes],{type:pack.sourceType}));
      dims=outputDimensions(stillImage.width,stillImage.height);
    }
    const {width,height,factor}=dims,fps=24,frames=Math.round(seconds*fps);
    if(frames<1||frames>LIMITS.maxFrames)throw Error('Clip exceeds the bounded render-frame limit');
    status('Checking H.264 and AAC capability');
    const avc=await media.canEncodeVideo('avc',{width,height,framerate:fps,bitrate:700000});
    if(!avc)throw Error('H.264 encoder unsupported on this browser; use the Python studio');
    const aac=await selectAacEncoder(()=>media.canEncodeAudio('aac',{sampleRate:16000,numberOfChannels:1,bitrate:64000}),async()=>{
      requireActive();await verifyPackage('aac');requireActive();
      const p=await import(CDN.aac);p.registerAacEncoder();
    });requireActive();
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('No Canvas 2D support');
    const target=new media.BufferTarget(),out=new media.Output({format:new media.Mp4OutputFormat(),target});
    const vs=new media.CanvasSource(canvas,{codec:'avc',quality:new media.Quality({bitrate:700000})});
    const as=new media.AudioBufferSource({codec:'aac',quality:new media.Quality({bitrate:64000})});
    out.addVideoTrack(vs,{frameRate:fps});out.addAudioTrack(as);
    status('Encoding real mouth motion into H.264/AAC');await out.start();
    const ab=new AudioBuffer({numberOfChannels:1,length:floats.length,sampleRate:16000});ab.copyToChannel(floats,0);await as.add(ab);as.close();
    const tRender=performance.now();
    for(let i=0;i<frames;i++){
      requireActive();const t=i/fps;
      if(sink){const sample=await sink.getSample(t);if(!sample)throw Error('Missing video source frame at '+t.toFixed(2));sample.draw(ctx,0,0,width,height);sample.close()}
      else ctx.drawImage(stillImage,0,0,width,height);
      const shape=shapeAt(cues,t),sprite=sprites[shape];if(!sprite)throw Error('No approved mouth sprite for '+shape);
      const anchor=anchorAt(keys,t),sw=sprite.width*anchor.scale*factor,sh=sprite.height*anchor.scale*factor;
      ctx.save();ctx.translate(anchor.x*width,anchor.y*height);ctx.rotate(anchor.rotation_deg*Math.PI/180);ctx.drawImage(sprite,-sw/2,-sh/2,sw,sh);ctx.restore();
      await vs.add(t,1/fps);
      if(i%24===0){meter();await new Promise(r=>setTimeout(r,0))}
    }
    vs.close();await out.finalize();requireActive();
    const bytes=target.buffer;if(!bytes||bytes.byteLength<200)throw Error('No encoded MP4 was produced');
    const outputHash=await sha(bytes),after=await sha(sourceBytes);
    if(srcHash!==after)throw Error('Original source integrity mismatch after render');
    // Browser-side codec metadata inspection, not a substitute for decoding every packet.
    const check=new media.Input({formats:media.ALL_FORMATS,source:new media.BlobSource(new Blob([bytes],{type:'video/mp4'}))});
    const mime=await check.getMimeType();
    if(!/video\/mp4/i.test(mime)||!/avc1/i.test(mime)||!/mp4a/i.test(mime))throw Error('Output does not advertise H.264 and AAC streams: '+mime);
    const result={status:'BROWSER_EXPORT_CODECS_DECLARED',kind,sourceSHA256:srcHash,sourceSHA256After:after,audioSHA256:audioHash,mp4SHA256:outputHash,bytes:bytes.byteLength,
      durationSeconds:seconds,frames,width,height,realRhubarbCueCount:cues.length,mouthShapes:[...new Set(cues.map(x=>x.value))],
      analysisMs:Math.round(analysisMs),encodeMs:Math.round(performance.now()-tRender),totalMs:Math.round(performance.now()-started),
      aacNative:aac.nativeAac,aacPolyfill:aac.polyfill,mime,observedJSPeakBytes:memoryPeak,jsMemorySamples:observedSamples,
      nativeProcessPeakBytes:null,modelVersion:'lip-sync-engine@1.0.3',mediaVersion:'mediabunny@1.66.2',
      proofLimit:'Header codecs checked inside browser; full external stream/AV synchronization verification not performed by this page.'};
    link($('download'),bytes,'video/mp4','dex_lips_'+kind+'.mp4');
    link($('cueDownload'),JSON.stringify({...cuesDoc,mouthCues:cues},null,2),'application/json','dex_lips_cues_'+kind+'.json');
    $('preview').src=outputUrls[0];$('receipt').textContent=JSON.stringify(result,null,2);
    $('metric').textContent=`${cues.length} actual mouth cues · ${frames} frames · ${(performance.now()-started)/1000|0}s processing · ${aac.nativeAac?'native':'fallback'} AAC`;
    show('MP4 exported. Tap Play to inspect it, or Download to save it on your tablet.','success');
  }catch(err){const message=String(err?.message||err);$('receipt').textContent=JSON.stringify({status:'BLOCKED',error:message,kind,stage:'browser test',sourceArtPreserved:true},null,2);show('Blocked: '+message,'error')}
  finally{if(memoryMeter)clearInterval(memoryMeter);memoryMeter=null;for(const m of Object.values(pack?.sprites||{}))m?.close?.();stillImage?.close?.();videoInput?.dispose?.();active=null;setBusy(false)}
}
$('demo-still').addEventListener('click',()=>run('still'));
$('demo-moving').addEventListener('click',()=>run('moving'));
$('custom-start').addEventListener('click',()=>run('custom'));
$('cancel').addEventListener('click',()=>{cancelRequested=true;active?.abort();show('Cancellation requested. The current codec operation may need to finish before stopping.','running')});
window.addEventListener('pagehide',()=>{stopped=true;cancelRequested=true;active?.abort();clearResult();try{engine?.destroy?.()}catch{};engine=null;if(memoryMeter)clearInterval(memoryMeter)});
window.addEventListener('pageshow',()=>{stopped=false});
