// Waveform — audio visualizer + synth. WebAudio API, zero dependencies.
// Synth: polyphonic oscillator voices with filter + ADSR-ish envelope.
// Visualizer: 3 canvas modes (bars / waveform / radial), 60fps rAF loop,
// smoothed with exponential interpolation (openmotion-style motion feel).

const els = {
  stage: document.getElementById('stage'),
  srcOsc: document.getElementById('src-osc'),
  srcMic: document.getElementById('src-mic'),
  vizButtons: [...document.querySelectorAll('[data-viz]')],
  waveButtons: [...document.querySelectorAll('[data-wave]')],
  filterFreq: document.getElementById('filter-freq'),
  filterVal: document.getElementById('filter-val'),
  masterVol: document.getElementById('master-vol'),
  volVal: document.getElementById('vol-val'),
  attack: document.getElementById('attack'),
  attackVal: document.getElementById('attack-val'),
  keyboard: document.getElementById('keyboard'),
  panic: document.getElementById('panic'),
}

/* ---------------- audio engine ---------------- */

const audio = {
  ctx: null,
  analyser: null,
  master: null,
  filter: null,
  voices: new Map(),  // noteId -> { osc, gain }
  waveType: 'sine',
  source: 'osc',      // 'osc' | 'mic'
  micStream: null,
}

function ensureAudio() {
  if (audio.ctx) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return }
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  audio.ctx = ctx
  audio.master = ctx.createGain()
  audio.master.gain.value = els.masterVol.value / 100 * 0.5
  audio.filter = ctx.createBiquadFilter()
  audio.filter.type = 'lowpass'
  audio.filter.frequency.value = Number(els.filterFreq.value)
  audio.analyser = ctx.createAnalyser()
  audio.analyser.fftSize = 2048
  audio.analyser.smoothingTimeConstant = 0.78

  audio.filter.connect(audio.master)
  audio.master.connect(audio.analyser)
  audio.analyser.connect(ctx.destination)
}

function noteFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12) }

function noteOn(id, midi) {
  ensureAudio()
  if (audio.voices.has(id)) return
  if (audio.source !== 'osc') return
  const ctx = audio.ctx
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = audio.waveType
  osc.frequency.value = noteFreq(midi)
  const attackSec = Number(els.attack.value) / 1000
  const t = ctx.currentTime
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.28, t + Math.max(0.005, attackSec))
  osc.connect(gain)
  gain.connect(audio.filter)
  osc.start()
  audio.voices.set(id, { osc, gain })
}

function noteOff(id) {
  const v = audio.voices.get(id)
  if (!v) return
  const t = audio.ctx.currentTime
  v.gain.gain.cancelScheduledValues(t)
  v.gain.gain.setValueAtTime(v.gain.gain.value, t)
  v.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
  v.osc.stop(t + 0.22)
  audio.voices.delete(id)
}

function panic() { for (const id of [...audio.voices.keys()]) noteOff(id) }

async function switchSource(src) {
  ensureAudio()
  audio.source = src
  els.srcOsc.classList.toggle('active', src === 'osc')
  els.srcMic.classList.toggle('active', src === 'mic')
  panic()
  if (src === 'mic') {
    try {
      audio.micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const micNode = audio.ctx.createMediaStreamSource(audio.micStream)
      micNode.connect(audio.analyser) // analyze only — no feedback loop
    } catch (e) {
      alert('Microphone access denied — staying on synth.')
      switchSource('osc')
    }
  } else if (audio.micStream) {
    audio.micStream.getTracks().forEach(t => t.stop())
    audio.micStream = null
  }
}

/* ---------------- keyboard ---------------- */

// A3..K4 white keys + W E T Y U black keys layout
const KEY_LAYOUT = [
  { kbd: 'A', midi: 57 }, { kbd: 'W', midi: 58, black: true },
  { kbd: 'S', midi: 59 }, { kbd: 'E', midi: 60, black: true },
  { kbd: 'D', midi: 61 }, { kbd: 'F', midi: 62 },
  { kbd: 'T', midi: 63, black: true }, { kbd: 'G', midi: 64 },
  { kbd: 'Y', midi: 65, black: true }, { kbd: 'H', midi: 66 },
  { kbd: 'U', midi: 67, black: true }, { kbd: 'J', midi: 68 },
  { kbd: 'K', midi: 69 },
]

function buildKeyboard() {
  els.keyboard.innerHTML = ''
  const whites = KEY_LAYOUT.filter(k => !k.black)
  const whiteEls = new Map()
  whites.forEach(k => {
    const el = document.createElement('div')
    el.className = 'key'
    el.dataset.midi = k.midi
    el.innerHTML = `<span class="kbd">${k.kbd}</span>`
    els.keyboard.appendChild(el)
    whiteEls.set(k.midi, el)
  })
  // position black keys after their left white neighbor
  KEY_LAYOUT.filter(k => k.black).forEach(k => {
    const idx = whites.findIndex(w => w.midi === k.midi - 1)
    const left = (idx + 0.65) / whites.length * 100
    const el = document.createElement('div')
    el.className = 'key black'
    el.style.left = left + '%'
    el.dataset.midi = k.midi
    el.innerHTML = `<span class="kbd">${k.kbd}</span>`
    els.keyboard.appendChild(el)
  })
}

function setKeyActive(midi, active) {
  const el = els.keyboard.querySelector(`[data-midi="${midi}"]`)
  if (el) el.classList.toggle('active', active)
}

// mouse + touch
els.keyboard.addEventListener('pointerdown', e => {
  const el = e.target.closest('.key')
  if (!el) return
  el.setPointerCapture(e.pointerId)
  noteOn(el.dataset.midi, Number(el.dataset.midi))
  setKeyActive(el.dataset.midi, true)
})
els.keyboard.addEventListener('pointerup', e => {
  const el = e.target.closest('.key')
  if (!el) return
  noteOff(el.dataset.midi); setKeyActive(el.dataset.midi, false)
})

// computer keys
const keyToMidi = Object.fromEntries(KEY_LAYOUT.map(k => [k.kbd.toLowerCase(), k.midi]))
const heldKeys = new Set()
document.addEventListener('keydown', e => {
  if (e.repeat) return
  const midi = keyToMidi[e.key.toLowerCase()]
  if (midi && !heldKeys.has(e.key.toLowerCase())) {
    heldKeys.add(e.key.toLowerCase())
    noteOn('kbd-' + e.key, midi)
    setKeyActive(midi, true)
  }
  if (e.key === 'Escape') panic()
})
document.addEventListener('keyup', e => {
  const midi = keyToMidi[e.key.toLowerCase()]
  if (midi) {
    heldKeys.delete(e.key.toLowerCase())
    noteOff('kbd-' + e.key)
    setKeyActive(midi, false)
  }
})

/* ---------------- visualizer ---------------- */

const viz = { mode: 'bars', fft: null, time: null, barSmooth: [] }

function resizeCanvas() {
  const rect = els.stage.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  els.stage.width = rect.width * dpr
  els.stage.height = rect.height * dpr
}
window.addEventListener('resize', resizeCanvas)
resizeCanvas()

function css(name) { return getComputedStyle(document.body).getPropertyValue(name).trim() }

function lerpColor(a, b, t) {
  // a, b: [r,g,b]
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`
}
const C1 = [167, 139, 250]  // accent
const C2 = [34, 211, 238]   // accent-2

function draw() {
  requestAnimationFrame(draw)
  const ctx = els.stage.getContext('2d')
  const w = els.stage.width, h = els.stage.height
  ctx.clearRect(0, 0, w, h)
  if (!audio.analyser) {
    ctx.fillStyle = css('--muted')
    ctx.font = `${14 * (window.devicePixelRatio || 1)}px ui-sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText('press a key or switch to microphone to begin', w / 2, h / 2)
    return
  }
  const bins = audio.analyser.frequencyBinCount
  if (!viz.fft || viz.fft.length !== bins) { viz.fft = new Uint8Array(bins); viz.time = new Uint8Array(bins) }
  audio.analyser.getByteFrequencyData(viz.fft)
  audio.analyser.getByteTimeDomainData(viz.time)

  if (viz.mode === 'bars') drawBars(ctx, w, h)
  else if (viz.mode === 'wave') drawWave(ctx, w, h)
  else drawRadial(ctx, w, h)
}

function drawBars(ctx, w, h) {
  const N = 64
  const step = Math.floor(viz.fft.length * 0.7 / N)
  const bw = w / N
  if (viz.barSmooth.length !== N) viz.barSmooth = new Array(N).fill(0)
  for (let i = 0; i < N; i++) {
    // average bin cluster, then exponential smooth (openmotion interpolation feel)
    let sum = 0
    for (let j = 0; j < step; j++) sum += viz.fft[i * step + j]
    const target = (sum / step / 255) ** 1.4
    viz.barSmooth[i] += (target - viz.barSmooth[i]) * 0.35
    const bh = viz.barSmooth[i] * (h - 20)
    const x = i * bw + bw * 0.15
    const grad = ctx.createLinearGradient(0, h, 0, h - bh)
    const t = i / N
    grad.addColorStop(0, lerpColor(C1, C2, t))
    grad.addColorStop(1, lerpColor(C2, [255, 255, 255], 0.25 * t))
    ctx.fillStyle = grad
    ctx.shadowColor = lerpColor(C1, C2, t)
    ctx.shadowBlur = 12
    ctx.beginPath()
    ctx.roundRect(x, h - bh - 10, bw * 0.7, bh, 4)
    ctx.fill()
  }
  ctx.shadowBlur = 0
}

function drawWave(ctx, w, h) {
  ctx.lineWidth = 3 * (window.devicePixelRatio || 1)
  ctx.strokeStyle = css('--accent')
  ctx.shadowColor = css('--accent')
  ctx.shadowBlur = 16
  ctx.beginPath()
  const N = viz.time.length
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * w
    const y = h / 2 + ((viz.time[i] - 128) / 128) * (h * 0.42)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.shadowBlur = 0
}

function drawRadial(ctx, w, h) {
  const cx = w / 2, cy = h / 2
  const baseR = Math.min(w, h) * 0.22
  const N = 96
  const step = Math.floor(viz.fft.length * 0.6 / N)
  const dpr = window.devicePixelRatio || 1
  for (let i = 0; i < N; i++) {
    let sum = 0
    for (let j = 0; j < step; j++) sum += viz.fft[i * step + j]
    const v = (sum / step / 255) ** 1.3
    const angle = (i / N) * Math.PI * 2 - Math.PI / 2
    const r1 = baseR
    const r2 = baseR + v * Math.min(w, h) * 0.28
    const t = i / N
    ctx.strokeStyle = lerpColor(C1, C2, t)
    ctx.lineWidth = 3 * dpr
    ctx.lineCap = 'round'
    ctx.shadowColor = lerpColor(C1, C2, t)
    ctx.shadowBlur = 10
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1)
    ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2)
    ctx.stroke()
  }
  // inner ring
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(167,139,250,0.35)'
  ctx.lineWidth = 1.5 * dpr
  ctx.beginPath()
  ctx.arc(cx, cy, baseR * 0.92, 0, Math.PI * 2)
  ctx.stroke()
}

requestAnimationFrame(draw)

/* ---------------- control wiring ---------------- */

function paintRange(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100
  input.style.setProperty('--fill', pct + '%')
}
document.querySelectorAll('input[type="range"]').forEach(r => {
  paintRange(r)
  r.addEventListener('input', () => paintRange(r))
})

els.vizButtons.forEach(b => b.addEventListener('click', () => {
  els.vizButtons.forEach(x => x.classList.remove('active'))
  b.classList.add('active')
  viz.mode = b.dataset.viz
}))
els.waveButtons.forEach(b => b.addEventListener('click', () => {
  els.waveButtons.forEach(x => x.classList.remove('active'))
  b.classList.add('active')
  audio.waveType = b.dataset.wave
}))
els.filterFreq.addEventListener('input', () => {
  els.filterVal.textContent = els.filterFreq.value + ' Hz'
  if (audio.filter) audio.filter.frequency.setTargetAtTime(Number(els.filterFreq.value), audio.ctx.currentTime, 0.03)
})
els.masterVol.addEventListener('input', () => {
  els.volVal.textContent = els.masterVol.value + '%'
  if (audio.master) audio.master.gain.setTargetAtTime(els.masterVol.value / 100 * 0.5, audio.ctx.currentTime, 0.03)
})
els.attack.addEventListener('input', () => { els.attackVal.textContent = els.attack.value + ' ms' })
els.srcOsc.addEventListener('click', () => switchSource('osc'))
els.srcMic.addEventListener('click', () => switchSource('mic'))
els.panic.addEventListener('click', panic)

buildKeyboard()
