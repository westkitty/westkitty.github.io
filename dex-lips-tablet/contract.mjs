// Dex_Lips opt-in browser renderer input contract. Does not mutate source media.
export const SHAPES = 'ABCDEFGHX';
export const LIMITS = Object.freeze({
  sourceBytes: 40 * 1048576, audioBytes: 40 * 1048576,
  rigBytes: 262144, spriteBytes: 3 * 1048576,
  maxSourcePixels: 35000000, maxSpritePixels: 1048576,
  minSeconds: 0.15, maxSeconds: 30, maxFrames: 1800,
  maxWidth: 1280, maxHeight: 720, maxJSHeapBytes: 256 * 1048576,
});
const numeric = n => typeof n === 'number' && Number.isFinite(n);
function fail(message) { throw new Error(message); }
const isHash = h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h);

export function verifySourceDigest(sha, blocked) {
  if (!isHash(sha) || !Array.isArray(blocked) || blocked.length !== 2 ||
      blocked.some(h => !isHash(h))) fail('Source hash protection manifest invalid');
  if (blocked.includes(sha)) fail('Canonical and provisional Tiger references are blocked without approved character-specific visual contracts');
  return sha;
}

export function validateAnchor(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Mouth anchor missing');
  const {x, y} = input, scale = input.scale ?? 1, rotation_deg = input.rotation_deg ?? 0;
  if (!numeric(x) || x < 0 || x > 1 || !numeric(y) || y < 0 || y > 1) fail('Mouth anchor must be normalized');
  if (!numeric(scale) || scale < 0.05 || scale > 10) fail('Mouth scale outside range');
  if (!numeric(rotation_deg) || Math.abs(rotation_deg) > 360) fail('Mouth rotation outside range');
  return {x, y, scale, rotation_deg};
}

export function validateRig(rig, sourceSha, blocked, filenames) {
  verifySourceDigest(sourceSha, blocked);
  if (!rig || typeof rig !== 'object' || Array.isArray(rig) ||
      rig.schema_version !== 1 || rig.source_sha256 !== sourceSha) fail('Rig schema/source hash mismatch');
  if (!['synthetic_demo','approved_user_rig'].includes(rig.authority) || rig.approved !== true) {
    fail('User-authorized noncanonical mouth artwork required');
  }
  if (typeof rig.character_id !== 'string' || !rig.character_id.trim() || typeof rig.source_path !== 'string' || !rig.source_path.trim()) fail('Character ID/source_path required by rig schema v1');
  const anchor = validateAnchor(rig.mouth_anchor), shapes = rig.shapes;
  if (!shapes || typeof shapes !== 'object' || Array.isArray(shapes) ||
      Object.keys(shapes).length < 2 || Object.keys(shapes).length > SHAPES.length ||
      !Object.hasOwn(shapes, 'X')) fail('Rig requires rest shape X plus speaking mouth artwork');
  if (!Array.isArray(filenames) || filenames.length > SHAPES.length || new Set(filenames).size !== filenames.length) {
    fail('Sprite file list invalid');
  }
  const seen = new Set(), available = new Set(filenames);
  for (const [code, path] of Object.entries(shapes)) {
    if (code.length !== 1 || !SHAPES.includes(code) || typeof path !== 'string' ||
        !/^[A-Za-z0-9_-]+\.png$/.test(path) || seen.has(path) || !available.has(path)) {
      fail('Missing, duplicate or unsafe authored mouth sprite: ' + path);
    }
    seen.add(path);
  }
  return {anchor, shapes};
}

export function validateCues(doc, seconds, shapeNames) {
  if (!numeric(seconds) || seconds < LIMITS.minSeconds || seconds > LIMITS.maxSeconds) {
    fail('Audio duration outside 0.15-30 seconds');
  }
  const cues = doc?.mouthCues;
  if (!Array.isArray(cues) || !cues.length || cues.length > 10000) fail('Missing or excessive real Rhubarb mouth cues');
  const available = new Set(shapeNames); let last = 0, speaking = false;
  const normalized = cues.map((cue, i) => {
    if (!cue || typeof cue.value !== 'string' || cue.value.length !== 1 || !SHAPES.includes(cue.value)) fail('Unexpected Rhubarb shape');
    if (!available.has(cue.value)) fail('Artwork missing for Rhubarb shape ' + cue.value);
    if (!numeric(cue.start) || !numeric(cue.end) || cue.start < 0 || cue.end <= cue.start ||
        cue.start < last - 1e-6 || cue.end > seconds + 0.06) fail('Cue overlaps or exceeds speech at index ' + i);
    last = cue.end;
    if (cue.value !== 'X') speaking = true;
    return {start: cue.start, end: cue.end, value: cue.value};
  });
  if (!speaking) fail('Speech analyzer did not find active speaking mouth shapes');
  return normalized;
}

export function shapeAt(cues, time) {
  let lo = 0, hi = cues.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (cues[m].end <= time) lo = m + 1; else hi = m; }
  return lo < cues.length && cues[lo].start <= time ? cues[lo].value : 'X';
}

export function validateKeyframes(raw, defaultAnchor, duration) {
  if (raw == null) return [{time: 0, ...validateAnchor(defaultAnchor)}];
  if (!Array.isArray(raw) || !raw.length || raw.length > 10000) fail('Invalid mouth keyframe count');
  let previous = -1;
  return raw.map(k => {
    if (!k || !numeric(k.time) || k.time < 0 || k.time <= previous || k.time > duration + .06) fail('Out-of-order keyframes');
    previous = k.time; return {time: k.time, ...validateAnchor(k)};
  });
}

export function anchorAt(keys, t) {
  if (t <= keys[0].time) return keys[0];
  if (t >= keys[keys.length - 1].time) return keys[keys.length - 1];
  let a = 0, b = keys.length - 1;
  while (a + 1 < b) { const mid = (a + b) >>> 1; if (keys[mid].time <= t) a = mid; else b = mid; }
  const first = keys[a], next = keys[b], fraction = (t - first.time) / (next.time - first.time);
  return Object.fromEntries(['x','y','scale','rotation_deg'].map(k => [k, first[k] + (next[k] - first[k]) * fraction]));
}

export function outputDimensions(width, height) {
  if (!numeric(width) || !numeric(height) || width < 2 || height < 2 || width * height > LIMITS.maxSourcePixels) {
    fail('Source dimensions outside safety budget');
  }
  const f = Math.min(1, LIMITS.maxWidth/width, LIMITS.maxHeight/height);
  const w = Math.max(2, Math.floor(width*f/2)*2), h = Math.max(2, Math.floor(height*f/2)*2);
  return {width: w, height: h, factor: Math.min(w/width,h/height)};
}

export function assertMediaFile(file, isAudio = false) {
  const max = isAudio ? LIMITS.audioBytes : LIMITS.sourceBytes;
  if (!file || typeof file.name !== 'string' || !Number.isInteger(file.size) || file.size < 1 || file.size > max) fail('Input missing or over 40 MiB');
  const ext = file.name.toLowerCase().split('.').pop();
  const allowed = isAudio ? ['wav','mp3','m4a','ogg','flac'] : ['png','jpg','jpeg','webp','mp4','mov','webm','mkv'];
  if (!allowed.includes(ext)) fail('Media type not supported');
  return {isVideo: !isAudio && ['mp4','mov','webm','mkv'].includes(ext)};
}

export async function selectAacEncoder(probeNative, registerFallback) {
  if (await probeNative()) return {nativeAac: true, polyfill: false};
  await registerFallback();
  if (!await probeNative()) fail('AAC unavailable even with optional polyfill');
  return {nativeAac: false, polyfill: true};
}

export function assertMemoryBudget(jsBytes, nativeEstimateGiB) {
  if (numeric(nativeEstimateGiB) && nativeEstimateGiB < 2) fail('Device memory estimate below experimental browser minimum');
  if (numeric(jsBytes) && jsBytes > LIMITS.maxJSHeapBytes) fail('Observed JavaScript memory exceeds experimental budget');
  return {measuredJSBytes: numeric(jsBytes) ? jsBytes : null, nativePeakMeasured: false};
}
