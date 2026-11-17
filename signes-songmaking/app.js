// Chord Loop — four chords, a plucked guitar, on repeat.

// ---------- Music data ----------
const NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const TYPES = [
  { name: '',      label: 'maj',   iv: [0, 4, 7] },
  { name: 'm',     label: 'm',     iv: [0, 3, 7] },
  { name: '7',     label: '7',     iv: [0, 4, 7, 10] },
  { name: 'maj7',  label: 'maj7',  iv: [0, 4, 7, 11] },
  { name: 'm7',    label: 'm7',    iv: [0, 3, 7, 10] },
  { name: '9',     label: '9',     iv: [0, 4, 7, 10, 14] },
  { name: 'm9',    label: 'm9',    iv: [0, 3, 7, 10, 14] },
  { name: '6',     label: '6',     iv: [0, 4, 7, 9] },
  { name: 'add9',  label: 'add9',  iv: [0, 4, 7, 14] },
  { name: 'sus2',  label: 'sus2',  iv: [0, 2, 7] },
  { name: 'sus4',  label: 'sus4',  iv: [0, 5, 7] },
  { name: '7sus4', label: '7sus4', iv: [0, 5, 7, 10] },
  { name: 'dim',   label: 'dim',   iv: [0, 3, 6] },
  { name: 'm7b5',  label: 'm7b5',  iv: [0, 3, 6, 10] },
  { name: 'aug',   label: 'aug',   iv: [0, 4, 8] },
];

// Strum patterns: [eighth-note position in the bar, direction, strength]
const FEELS = {
  strum:  [[0, 'D', 1], [2, 'D', 0.8], [3, 'U', 0.55], [5, 'U', 0.55], [6, 'D', 0.75], [7, 'U', 0.5]],
  gentle: [[0, 'D', 1], [2, 'D', 0.7], [4, 'D', 0.8], [6, 'D', 0.7]],
  ring:   [[0, 'D', 1]],
};

const chordName = (c) => c ? NOTES[c.root] + TYPES[c.type].name : '';

// Guitar-like voicing: bass root, fifth, then the colour tones spread above.
function voicing(c) {
  const iv = TYPES[c.type].iv;
  const bass = 40 + ((c.root - 4 + 12) % 12); // E2 .. Eb3
  const notes = [bass];
  if (iv.includes(7)) notes.push(bass + 7);
  for (const i of iv) {
    if (i === 0 || i === 7) continue;
    let n = bass + (i % 12);
    while (n < bass + 10) n += 12;
    notes.push(n);
  }
  if (notes.length < 4) notes.push(bass + 12);
  if (notes.length < 5 && iv.includes(7)) notes.push(bass + 19);
  return [...new Set(notes)].sort((a, b) => a - b).slice(0, 6);
}

// ---------- Sound: Karplus-Strong plucked string ----------
const pluckCache = new Map();

function pluck(midi, sr) {
  const key = midi + '@' + sr;
  if (pluckCache.has(key)) return pluckCache.get(key);

  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  const N = Math.max(2, Math.floor(sr / freq - 0.5));
  const len = Math.floor(sr * 3.5);
  const buf = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 1 });
  const out = buf.getChannelData(0);

  // Softened noise burst = a warm pick attack
  const line = new Float32Array(N);
  let prev = 0, mean = 0;
  for (let i = 0; i < N; i++) {
    prev = prev * 0.6 + (Math.random() * 2 - 1) * 0.4;
    line[i] = prev;
    mean += prev;
  }
  mean /= N;
  for (let i = 0; i < N; i++) line[i] -= mean;

  const decay = 0.996;
  let idx = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const cur = line[idx];
    out[i] = cur;
    line[idx] = decay * 0.5 * (cur + last);
    last = cur;
    idx = idx + 1 === N ? 0 : idx + 1;
  }
  // Fade the tail to avoid clicks
  const fade = Math.floor(sr * 0.3);
  for (let i = 0; i < fade; i++) out[len - fade + i] *= 1 - i / fade;

  // Loop length is N + 0.5 samples; correct the tuning with playbackRate
  const result = { buf, rate: freq * (N + 0.5) / sr };
  pluckCache.set(key, result);
  return result;
}

function makeImpulse(ctx, seconds = 1.8) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return ir;
}

// An "engine" is a little signal chain on a given AudioContext (live or offline)
function makeEngine(ctx) {
  const input = ctx.createGain();
  const body = ctx.createBiquadFilter();
  body.type = 'peaking'; body.frequency.value = 180; body.Q.value = 0.8; body.gain.value = 3;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass'; tone.frequency.value = 4200;
  const rev = ctx.createConvolver();
  rev.buffer = makeImpulse(ctx);
  const wet = ctx.createGain(); wet.gain.value = 0.16;
  const master = ctx.createGain(); master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();

  input.connect(body).connect(tone);
  tone.connect(master);
  tone.connect(rev).connect(wet).connect(master);
  master.connect(comp).connect(ctx.destination);
  return { ctx, input, active: [] };
}

function damp(eng, time) {
  for (const v of eng.active) {
    v.g.gain.cancelScheduledValues(time);
    v.g.gain.setTargetAtTime(0, time, 0.03);
    try { v.src.stop(time + 0.4); } catch (e) {}
  }
  eng.active = [];
}

function strum(eng, time, notes, dir, strength) {
  damp(eng, time);
  const list = dir === 'D' ? notes : [...notes].reverse().slice(0, 4);
  const spread = dir === 'D' ? 0.014 : 0.009;
  const vol = (dir === 'D' ? 0.24 : 0.18) * strength;
  list.forEach((midi, i) => {
    const { buf, rate } = pluck(midi, eng.ctx.sampleRate);
    const src = eng.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = eng.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(eng.input);
    src.start(time + i * spread + Math.random() * 0.003);
    eng.active.push({ src, g });
  });
}

// One eighth-note step of the loop (shared by live playback and export)
function playStep(eng, step, time) {
  const bar = Math.floor(step / 8) % 4;
  const pos = step % 8;
  const chord = state.chords[bar];
  if (!chord) { if (pos === 0) damp(eng, time); return; }
  const hit = FEELS[state.feel].find((h) => h[0] === pos);
  if (hit) strum(eng, time, voicing(chord), hit[1], hit[2]);
}

// ---------- State ----------
const state = {
  chords: [null, null, null, null],
  bpm: 90,
  feel: 'strum',
};
try {
  const saved = JSON.parse(localStorage.getItem('chordloop') || 'null');
  if (saved) Object.assign(state, saved);
} catch (e) {}
const save = () => { try { localStorage.setItem('chordloop', JSON.stringify(state)); } catch (e) {} };

// ---------- Live playback ----------
let ctx = null, eng = null, timer = null, step = 0, nextTime = 0;
const timeouts = [];

function ensureAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    eng = makeEngine(ctx);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tick() {
  const stepDur = 60 / state.bpm / 2;
  while (nextTime < ctx.currentTime + 0.12) {
    if (step % 8 === 0) {
      const bar = Math.floor(step / 8) % 4;
      const delay = Math.max(0, (nextTime - ctx.currentTime) * 1000);
      timeouts.push(setTimeout(() => highlight(bar), delay));
    }
    playStep(eng, step, nextTime);
    nextTime += stepDur;
    step++;
  }
}

function start() {
  ensureAudio();
  step = 0;
  nextTime = ctx.currentTime + 0.08;
  tick();
  timer = setInterval(tick, 25);
  $play.classList.add('playing');
  $play.setAttribute('aria-label', 'Stop');
}

function stop() {
  clearInterval(timer); timer = null;
  timeouts.splice(0).forEach(clearTimeout);
  if (eng) damp(eng, ctx.currentTime);
  highlight(-1);
  $play.classList.remove('playing');
  $play.setAttribute('aria-label', 'Play');
}

function audition(chord) {
  if (timer) return; // don't interrupt the loop
  ensureAudio();
  strum(eng, ctx.currentTime + 0.02, voicing(chord), 'D', 1);
}

// ---------- MP3 export ----------
function loadLame() {
  if (window.lamejs) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function renderLoop(loops) {
  const sr = 44100;
  const stepDur = 60 / state.bpm / 2;
  const steps = loops * 32;
  const seconds = 0.05 + steps * stepDur + 2.5;
  const oc = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const e = makeEngine(oc);
  for (let s = 0; s < steps; s++) playStep(e, s, 0.05 + s * stepDur);
  return oc.startRendering();
}

function toInt16(data, gain) {
  const out = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = Math.max(-1, Math.min(1, data[i] * gain));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

function peakGain(buffer) {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  return peak > 0 ? 0.89 / peak : 1;
}

function encodeMp3(buffer) {
  const gain = peakGain(buffer);
  const L = toInt16(buffer.getChannelData(0), gain);
  const R = toInt16(buffer.getChannelData(1), gain);
  const enc = new lamejs.Mp3Encoder(2, buffer.sampleRate, 192);
  const parts = [];
  for (let i = 0; i < L.length; i += 1152) {
    const chunk = enc.encodeBuffer(L.subarray(i, i + 1152), R.subarray(i, i + 1152));
    if (chunk.length) parts.push(new Uint8Array(chunk));
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end));
  return new Blob(parts, { type: 'audio/mpeg' });
}

function encodeWav(buffer) {
  const gain = peakGain(buffer);
  const L = toInt16(buffer.getChannelData(0), gain);
  const R = toInt16(buffer.getChannelData(1), gain);
  const n = L.length, sr = buffer.sampleRate;
  const view = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + n * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, sr, true); view.setUint32(28, sr * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { view.setInt16(44 + i * 4, L[i], true); view.setInt16(46 + i * 4, R[i], true); }
  return new Blob([view], { type: 'audio/wav' });
}

async function download() {
  if (!state.chords.some(Boolean)) { setStatus('Pick at least one chord first.'); return; }
  $download.disabled = true;
  setStatus('Rendering…');
  try {
    const buffer = await renderLoop(Number($loops.value));
    let blob, ext = 'mp3';
    try {
      await loadLame();
      setStatus('Encoding MP3…');
      await new Promise((r) => setTimeout(r, 30));
      blob = encodeMp3(buffer);
    } catch (e) {
      console.warn('MP3 encoder unavailable, saving WAV instead', e);
      blob = encodeWav(buffer);
      ext = 'wav';
    }
    const names = state.chords.map((c) => chordName(c) || 'rest').join('-');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${names}-${state.bpm}bpm.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setStatus(ext === 'mp3' ? 'Saved.' : 'Saved as WAV (MP3 encoder could not load).');
  } catch (e) {
    console.error(e);
    setStatus('Something went wrong.');
  }
  $download.disabled = false;
}

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
const $track = $('track'), $play = $('play'), $tempo = $('tempo'), $tempoOut = $('tempoOut');
const $feel = $('feel'), $loops = $('loops'), $download = $('download'), $status = $('status');
const $picker = $('picker'), $roots = $('roots'), $types = $('types'), $clear = $('clear');

let openSlot = -1;
let pickRoot = 0;

function setStatus(t) { $status.textContent = t; }

function renderTrack() {
  $track.innerHTML = '';
  state.chords.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'slot' + (c ? '' : ' empty') + (i === openSlot ? ' open' : '');
    b.innerHTML = `<span class="num">${i + 1}</span><span class="name">${c ? chordName(c) : '+'}</span>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); togglePicker(i, b); });
    $track.appendChild(b);
  });
}

function highlight(bar) {
  [...$track.children].forEach((el, i) => el.classList.toggle('now', i === bar));
}

function renderPicker() {
  const c = state.chords[openSlot];
  $roots.innerHTML = '';
  NOTES.forEach((n, i) => {
    const b = document.createElement('button');
    b.textContent = n;
    if (i === pickRoot) b.className = 'sel';
    b.addEventListener('click', () => {
      pickRoot = i;
      if (state.chords[openSlot]) setChord({ root: i, type: state.chords[openSlot].type }, false);
      renderPicker();
    });
    $roots.appendChild(b);
  });
  $types.innerHTML = '';
  TYPES.forEach((t, i) => {
    const b = document.createElement('button');
    b.textContent = t.label;
    if (c && c.type === i) b.className = 'sel';
    b.addEventListener('click', () => setChord({ root: pickRoot, type: i }, true));
    $types.appendChild(b);
  });
  $clear.hidden = !c;
}

function setChord(chord, close) {
  state.chords[openSlot] = chord;
  save();
  audition(chord);
  if (close) closePicker(); else renderTrack();
}

function togglePicker(i, el) {
  if (openSlot === i) return closePicker();
  openSlot = i;
  const c = state.chords[i];
  pickRoot = c ? c.root : (state.chords.find(Boolean)?.root ?? 0);
  renderPicker();
  renderTrack();
  $picker.hidden = false;
  const r = el.getBoundingClientRect();
  const w = $picker.offsetWidth;
  const left = Math.min(Math.max(16, r.left + window.scrollX), window.scrollX + document.documentElement.clientWidth - w - 16);
  $picker.style.left = left + 'px';
  $picker.style.top = (r.bottom + window.scrollY + 8) + 'px';
}

function closePicker() {
  openSlot = -1;
  $picker.hidden = true;
  renderTrack();
}

$picker.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { if (openSlot !== -1) closePicker(); });
$clear.addEventListener('click', () => { state.chords[openSlot] = null; save(); closePicker(); });

$play.addEventListener('click', () => (timer ? stop() : start()));

$tempo.value = state.bpm;
$tempoOut.textContent = state.bpm + ' bpm';
$tempo.addEventListener('input', () => {
  state.bpm = Number($tempo.value);
  $tempoOut.textContent = state.bpm + ' bpm';
  save();
});

$feel.value = state.feel;
$feel.addEventListener('change', () => { state.feel = $feel.value; save(); });

$download.addEventListener('click', download);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePicker();
  if (e.code === 'Space' && !['INPUT', 'SELECT'].includes(e.target.tagName)) {
    e.preventDefault();
    timer ? stop() : start();
  }
});

renderTrack();
