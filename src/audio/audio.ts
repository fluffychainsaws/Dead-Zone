// All audio is synthesized with WebAudio — no samples, no licensing, tiny bundle.

interface AudioSettings {
  music: boolean
  sfx: boolean
}

const STORAGE_KEY = 'dz.audio'

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { music: true, sfx: true, ...JSON.parse(raw) }
  } catch {
    /* corrupted or unavailable storage — fall back to defaults */
  }
  return { music: true, sfx: true }
}

export class AudioEngine {
  settings = loadSettings()

  private ctx: AudioContext | null = null
  private master!: GainNode
  private musicBus!: GainNode
  private sfxBus!: GainNode
  private noiseBuf!: AudioBuffer
  private musicStarted = false
  private intensity = 0
  private musicNodes: { cutoff?: BiquadFilterNode; pulseGain?: GainNode } = {}

  /** Must be called from a user gesture (click/tap). Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.9
      this.master.connect(this.ctx.destination)
      this.musicBus = this.ctx.createGain()
      this.musicBus.connect(this.master)
      this.sfxBus = this.ctx.createGain()
      this.sfxBus.connect(this.master)
      this.applySettings()
      // 1s of white noise, reused by every percussive sound
      this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate)
      const data = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  toggleMusic(): boolean {
    this.settings.music = !this.settings.music
    this.persist()
    return this.settings.music
  }

  toggleSfx(): boolean {
    this.settings.sfx = !this.settings.sfx
    this.persist()
    return this.settings.sfx
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings))
    } catch {
      /* storage may be unavailable (private mode) */
    }
    this.applySettings()
  }

  private applySettings() {
    if (!this.ctx) return
    this.musicBus.gain.value = this.settings.music ? 0.42 : 0
    this.sfxBus.gain.value = this.settings.sfx ? 0.9 : 0
  }

  // ------------------------------ music ------------------------------

  startMusic() {
    if (!this.ctx || this.musicStarted) return
    this.musicStarted = true
    const ctx = this.ctx
    const out = this.musicBus

    const cutoff = ctx.createBiquadFilter()
    cutoff.type = 'lowpass'
    cutoff.frequency.value = 220
    cutoff.connect(out)
    this.musicNodes.cutoff = cutoff

    const drone = (freq: number, type: OscillatorType, gain: number) => {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = freq
      const g = ctx.createGain()
      g.gain.value = gain
      o.connect(g)
      g.connect(cutoff)
      o.start()
    }
    drone(55, 'sawtooth', 0.16) // A1
    drone(55.6, 'sawtooth', 0.11) // detuned — slow beating dread
    drone(27.5, 'sine', 0.22) // sub
    drone(82.41, 'triangle', 0.06) // E2, hollow fifth

    // breathing filter sweep
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.05
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 90
    lfo.connect(lfoGain)
    lfoGain.connect(cutoff.frequency)
    lfo.start()

    // tension pulse — silent until intensity rises
    const pulse = ctx.createOscillator()
    pulse.type = 'square'
    pulse.frequency.value = 110
    const pulseGate = ctx.createOscillator()
    pulseGate.type = 'square'
    pulseGate.frequency.value = 1.8
    const gateGain = ctx.createGain()
    gateGain.gain.value = 0
    const pulseGain = ctx.createGain()
    pulseGain.gain.value = 0
    pulseGate.connect(gateGain.gain)
    pulse.connect(gateGain)
    gateGain.connect(pulseGain)
    const pulseLp = ctx.createBiquadFilter()
    pulseLp.type = 'lowpass'
    pulseLp.frequency.value = 400
    pulseGain.connect(pulseLp)
    pulseLp.connect(out)
    pulse.start()
    pulseGate.start()
    this.musicNodes.pulseGain = pulseGain

    this.scheduleMotif()
  }

  setIntensity(level: number) {
    this.intensity = Math.max(0, Math.min(1, level))
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.musicNodes.cutoff?.frequency.linearRampToValueAtTime(180 + this.intensity * 640, t + 2)
    this.musicNodes.pulseGain?.gain.linearRampToValueAtTime(this.intensity * 0.05, t + 2)
  }

  private scheduleMotif() {
    const delay = 6500 + Math.random() * 7000 - this.intensity * 3500
    setTimeout(() => {
      this.playMotif()
      this.scheduleMotif()
    }, delay)
  }

  private playMotif() {
    if (!this.ctx || !this.settings.music) return
    const ctx = this.ctx
    // A phrygian fragments — minor seconds for unease
    const scale = [220, 233.08, 261.63, 329.63, 349.23]
    const notes = 2 + Math.floor(Math.random() * 2)
    // shared airy feedback delay
    const delay = ctx.createDelay()
    delay.delayTime.value = 0.42
    const fb = ctx.createGain()
    fb.gain.value = 0.38
    delay.connect(fb)
    fb.connect(delay)
    const wet = ctx.createGain()
    wet.gain.value = 0.5
    delay.connect(wet)
    wet.connect(this.musicBus)
    for (let i = 0; i < notes; i++) {
      const t = ctx.currentTime + i * (0.55 + Math.random() * 0.35)
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.3 ? 0.5 : 1)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.09, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4)
      o.connect(g)
      g.connect(this.musicBus)
      g.connect(delay)
      o.start(t)
      o.stop(t + 2.5)
    }
  }

  // ------------------------------ sfx ------------------------------

  private sfxReady(): AudioContext | null {
    return this.ctx && this.settings.sfx ? this.ctx : null
  }

  private noiseHit(opts: {
    at?: number
    decay: number
    filterType?: BiquadFilterType
    freq: number
    gain: number
    pan?: number
  }) {
    const ctx = this.sfxReady()
    if (!ctx) return
    const t = opts.at ?? ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const f = ctx.createBiquadFilter()
    f.type = opts.filterType ?? 'lowpass'
    f.frequency.value = opts.freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(opts.gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay)
    src.connect(f)
    f.connect(g)
    this.route(g, opts.pan)
    src.start(t)
    src.stop(t + opts.decay + 0.05)
  }

  private tone(opts: {
    at?: number
    type?: OscillatorType
    from: number
    to?: number
    dur: number
    gain: number
    pan?: number
  }) {
    const ctx = this.sfxReady()
    if (!ctx) return
    const t = opts.at ?? ctx.currentTime
    const o = ctx.createOscillator()
    o.type = opts.type ?? 'sine'
    o.frequency.setValueAtTime(opts.from, t)
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + opts.dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(opts.gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur)
    o.connect(g)
    this.route(g, opts.pan)
    o.start(t)
    o.stop(t + opts.dur + 0.05)
  }

  private route(node: AudioNode, pan?: number) {
    if (!this.ctx) return
    if (pan !== undefined && Math.abs(pan) > 0.01) {
      const p = this.ctx.createStereoPanner()
      p.pan.value = Math.max(-1, Math.min(1, pan))
      node.connect(p)
      p.connect(this.sfxBus)
    } else {
      node.connect(this.sfxBus)
    }
  }

  gunshot(weaponId: string) {
    switch (weaponId) {
      case 'trench':
        this.noiseHit({ decay: 0.4, freq: 700, gain: 1.0 })
        this.tone({ from: 110, to: 35, dur: 0.28, gain: 0.9 })
        break
      case 'hellfire':
        this.noiseHit({ decay: 0.3, freq: 900, gain: 1.0 })
        this.tone({ from: 120, to: 40, dur: 0.2, gain: 0.85 })
        break
      case 'magnum':
        this.noiseHit({ decay: 0.24, freq: 1600, gain: 1.0 })
        this.tone({ from: 170, to: 38, dur: 0.2, gain: 0.9 })
        break
      case 'liberator':
        this.noiseHit({ decay: 0.11, freq: 2100, gain: 0.85 })
        this.tone({ from: 145, to: 50, dur: 0.1, gain: 0.6 })
        break
      case 'garand':
        this.noiseHit({ decay: 0.17, freq: 2400, gain: 0.9 })
        this.tone({ from: 150, to: 45, dur: 0.14, gain: 0.7 })
        break
      case 'kurz':
        this.noiseHit({ decay: 0.07, freq: 1800, gain: 0.65 })
        this.tone({ from: 130, to: 55, dur: 0.07, gain: 0.45 })
        break
      default: // pistol
        this.noiseHit({ decay: 0.11, freq: 1500, gain: 0.75 })
        this.tone({ from: 140, to: 50, dur: 0.1, gain: 0.55 })
    }
  }

  dryFire() {
    this.noiseHit({ decay: 0.03, freq: 3000, filterType: 'highpass', gain: 0.25 })
  }

  reload() {
    const ctx = this.sfxReady()
    if (!ctx) return
    const t = ctx.currentTime
    this.noiseHit({ at: t, decay: 0.04, freq: 2500, filterType: 'bandpass', gain: 0.4 })
    this.noiseHit({ at: t + 0.18, decay: 0.05, freq: 1800, filterType: 'bandpass', gain: 0.45 })
    this.noiseHit({ at: t + 0.5, decay: 0.06, freq: 2200, filterType: 'bandpass', gain: 0.5 })
  }

  groan(pan: number, volume: number, runner: boolean) {
    const ctx = this.sfxReady()
    if (!ctx || volume < 0.03) return
    const t = ctx.currentTime
    const dur = runner ? 0.5 + Math.random() * 0.4 : 0.9 + Math.random() * 0.7
    const base = runner ? 160 + Math.random() * 80 : 65 + Math.random() * 45
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(base, t)
    o.frequency.linearRampToValueAtTime(base * (0.8 + Math.random() * 0.15), t + dur)
    // vocal wobble
    const wob = ctx.createOscillator()
    wob.frequency.value = 2.5 + Math.random() * 3
    const wobGain = ctx.createGain()
    wobGain.gain.value = base * 0.12
    wob.connect(wobGain)
    wobGain.connect(o.frequency)
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = runner ? 700 : 320
    f.Q.value = 1.6
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.5 * volume, t + dur * 0.3)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(f)
    f.connect(g)
    this.route(g, pan)
    o.start(t)
    o.stop(t + dur + 0.05)
    wob.start(t)
    wob.stop(t + dur + 0.05)
  }

  zombieHit() {
    this.noiseHit({ decay: 0.08, freq: 900, filterType: 'bandpass', gain: 0.5 })
  }

  playerHurt() {
    this.tone({ from: 95, to: 45, dur: 0.3, gain: 0.8 })
    this.noiseHit({ decay: 0.2, freq: 300, gain: 0.5 })
  }

  boxTick() {
    this.tone({ from: 500 + Math.random() * 250, dur: 0.045, gain: 0.16, type: 'square' })
  }

  boxReveal() {
    const ctx = this.sfxReady()
    if (!ctx) return
    const t = ctx.currentTime
    // little rising fanfare
    for (const [i, f] of [440, 554, 659, 880].entries()) {
      this.tone({ at: t + i * 0.09, from: f, dur: 0.22, gain: 0.22, type: 'triangle' })
    }
  }

  melee() {
    this.noiseHit({ decay: 0.16, freq: 1100, filterType: 'bandpass', gain: 0.55 })
    this.tone({ from: 220, to: 70, dur: 0.13, gain: 0.4 })
  }

  purchase() {
    const ctx = this.sfxReady()
    if (!ctx) return
    const t = ctx.currentTime
    this.tone({ at: t, from: 660, dur: 0.07, gain: 0.3, type: 'square' })
    this.tone({ at: t + 0.09, from: 880, dur: 0.1, gain: 0.3, type: 'square' })
  }

  deny() {
    this.tone({ from: 110, dur: 0.16, gain: 0.35, type: 'square' })
  }

  waveStinger() {
    const ctx = this.sfxReady()
    if (!ctx) return
    const t = ctx.currentTime
    // dissonant cluster swell
    for (const freq of [110, 116.5, 220.5]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = freq
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.001, t)
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.18)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.0)
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 900
      o.connect(f)
      f.connect(g)
      g.connect(this.sfxBus)
      o.start(t)
      o.stop(t + 2.1)
    }
    this.noiseHit({ decay: 0.9, freq: 500, gain: 0.4 })
  }

  deathSting() {
    const ctx = this.sfxReady()
    if (!ctx) return
    this.tone({ from: 110, to: 41, dur: 1.4, gain: 0.5, type: 'sawtooth' })
    this.tone({ from: 55, to: 27.5, dur: 1.8, gain: 0.6 })
    this.setIntensity(0)
  }
}

export const audio = new AudioEngine()
