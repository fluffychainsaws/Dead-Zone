// All audio is synthesized with WebAudio — no samples, no licensing, tiny bundle.

interface AudioSettings {
  music: boolean
  sfx: boolean
  musicVolume: number // 0..1
  sfxVolume: number // 0..1
}

const STORAGE_KEY = 'dz.audio'
const DEFAULT_SETTINGS: AudioSettings = { music: true, sfx: true, musicVolume: 1, sfxVolume: 1 }

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    /* corrupted or unavailable storage — fall back to defaults */
  }
  return { ...DEFAULT_SETTINGS }
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
  private clawGain: GainNode | null = null
  private clawVolume = 0

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

  setMusicVolume(v: number) {
    this.settings.musicVolume = Math.min(1, Math.max(0, v))
    this.persist()
  }

  setSfxVolume(v: number) {
    this.settings.sfxVolume = Math.min(1, Math.max(0, v))
    this.persist()
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
    this.musicBus.gain.value = this.settings.music ? 0.42 * this.settings.musicVolume : 0
    this.sfxBus.gain.value = this.settings.sfx ? 0.9 * this.settings.sfxVolume : 0
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
    drone(77.78, 'triangle', 0.07) // D#2 — a tritone against the root, not a "safe" fifth

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

    // distant wind — filtered noise with a slow breathing sweep, barely audible
    // but fills the silence between motifs with unease instead of dead air
    const windSrc = ctx.createBufferSource()
    windSrc.buffer = this.noiseBuf
    windSrc.loop = true
    const windFilter = ctx.createBiquadFilter()
    windFilter.type = 'bandpass'
    windFilter.frequency.value = 300
    windFilter.Q.value = 0.7
    const windGain = ctx.createGain()
    windGain.gain.value = 0.055
    const windLfo = ctx.createOscillator()
    windLfo.frequency.value = 0.037
    const windLfoGain = ctx.createGain()
    windLfoGain.gain.value = 220
    windLfo.connect(windLfoGain)
    windLfoGain.connect(windFilter.frequency)
    windSrc.connect(windFilter)
    windFilter.connect(windGain)
    windGain.connect(out)
    windSrc.start()
    windLfo.start()

    // hear the horror right away instead of waiting through a long random
    // first delay — the recurring schedule kicks in after that
    setTimeout(() => this.playMotif(), 1800)
    setTimeout(() => this.playMusicBox(), 4500)
    setTimeout(() => this.playBellToll(), 9000)
    this.scheduleMotif()
    this.scheduleMusicBox()
    this.scheduleBellToll()
  }

  setIntensity(level: number) {
    this.intensity = Math.max(0, Math.min(1, level))
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.musicNodes.cutoff?.frequency.linearRampToValueAtTime(180 + this.intensity * 640, t + 2)
    this.musicNodes.pulseGain?.gain.linearRampToValueAtTime(this.intensity * 0.05, t + 2)
  }

  /** A looping circus-y jingle that marks the claw machine's location — call
   *  setClawTuneVolume() every frame with a 0..1 proximity factor so players
   *  can home in on it after it relocates. Started once and left running;
   *  silent (gain 0) until a caller raises the volume. */
  startClawTune() {
    if (!this.ctx || this.clawGain) return
    const ctx = this.ctx
    this.clawGain = ctx.createGain()
    this.clawGain.gain.value = 0
    this.clawGain.connect(this.musicBus)
    const notes = [523.25, 659.25, 783.99, 659.25, 987.77, 783.99] // a tinkling little arpeggio
    const playLoop = () => {
      if (!this.ctx || !this.clawGain) return
      const t = this.ctx.currentTime
      if (this.clawVolume > 0.005) {
        notes.forEach((f, i) => {
          const nt = t + i * 0.2
          const o = ctx.createOscillator()
          o.type = 'triangle'
          o.frequency.value = f
          const g = ctx.createGain()
          g.gain.setValueAtTime(0, nt)
          g.gain.linearRampToValueAtTime(0.4, nt + 0.02)
          g.gain.exponentialRampToValueAtTime(0.0001, nt + 0.55)
          o.connect(g)
          g.connect(this.clawGain!)
          o.start(nt)
          o.stop(nt + 0.6)
        })
      }
      setTimeout(playLoop, 2400)
    }
    playLoop()
  }

  /** 0 = silent, 1 = right on top of it. */
  setClawTuneVolume(proximity: number) {
    this.clawVolume = Math.max(0, Math.min(1, proximity))
    if (!this.ctx || !this.clawGain) return
    this.clawGain.gain.linearRampToValueAtTime(this.clawVolume * 0.55, this.ctx.currentTime + 0.2)
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
    // A phrygian fragments — minor seconds and a tritone for unease
    const scale = [220, 233.08, 261.63, 311.13, 329.63, 349.23]
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

  private scheduleMusicBox() {
    const delay = 14000 + Math.random() * 16000
    setTimeout(() => {
      this.playMusicBox()
      this.scheduleMusicBox()
    }, delay)
  }

  /** A haunted-music-box fragment — the classic "wrong nursery rhyme" horror
   *  cue. Rare and quiet; it's meant to catch players off guard, not loop. */
  private playMusicBox() {
    if (!this.ctx || !this.settings.music) return
    const ctx = this.ctx
    const scale = [523.25, 587.33, 622.25, 698.46, 739.99, 830.61]
    const length = 4 + Math.floor(Math.random() * 3)
    const out = ctx.createGain()
    out.gain.value = 0.065
    out.connect(this.musicBus)
    for (let i = 0; i < length; i++) {
      const t = ctx.currentTime + i * (0.4 + Math.random() * 0.08)
      const freq = scale[Math.floor(Math.random() * scale.length)]
      // two barely-detuned sines — a tuning-fork tone that's just slightly wrong
      for (const detune of [0, 7]) {
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = freq
        o.detune.value = detune
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(0.5, t + 0.008)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1)
        o.connect(g)
        g.connect(out)
        o.start(t)
        o.stop(t + 1.2)
      }
    }
  }

  private scheduleBellToll() {
    const delay = 22000 + Math.random() * 20000
    setTimeout(() => {
      this.playBellToll()
      this.scheduleBellToll()
    }, delay)
  }

  /** A single distant, decaying bell strike — the unmistakable "something is
   *  watching" horror-movie cue. Loud enough to notice, rare enough to land. */
  private playBellToll() {
    if (!this.ctx || !this.settings.music) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const fundamental = 196 // G3 — low, mournful
    const out = ctx.createGain()
    out.gain.value = 0.16
    const bellFilter = ctx.createBiquadFilter()
    bellFilter.type = 'lowpass'
    bellFilter.frequency.value = 1400
    out.connect(bellFilter)
    bellFilter.connect(this.musicBus)
    // inharmonic partials — what makes a struck metal bell sound like a bell
    // instead of a musical note
    for (const [mult, gain] of [
      [1, 1],
      [1.5, 0.55],
      [2.4, 0.35],
      [3.8, 0.18],
    ] as const) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = fundamental * mult
      const g = ctx.createGain()
      g.gain.setValueAtTime(gain, t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5)
      o.connect(g)
      g.connect(out)
      o.start(t)
      o.stop(t + 4.6)
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

  /** `kind` is a weapon archetype (see weaponKind() in weapons.ts), not a raw weapon id —
   *  several weapons can share a look+sound, but every archetype is distinct from every other. */
  gunshot(kind: string) {
    switch (kind) {
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
      case 'mg':
        // heavy belt-fed chug — deep and long-tailed
        this.noiseHit({ decay: 0.22, freq: 550, gain: 1.0 })
        this.tone({ from: 90, to: 30, dur: 0.22, gain: 0.85 })
        break
      case 'saw':
        // lighter and quicker than the belt-fed 'mg', still meaty
        this.noiseHit({ decay: 0.16, freq: 780, gain: 0.95 })
        this.tone({ from: 105, to: 36, dur: 0.15, gain: 0.75 })
        break
      case 'sniper': {
        // a sharp crack transient in front of a big, slow boom
        this.noiseHit({ decay: 0.03, freq: 4200, filterType: 'highpass', gain: 0.5 })
        this.noiseHit({ decay: 0.55, freq: 380, gain: 1.0 })
        this.tone({ from: 65, to: 20, dur: 0.55, gain: 1.0 })
        break
      }
      case 'ww2smg':
        // boxy, echoey mid-range chatter — Thompson/MP40 flavor
        this.noiseHit({ decay: 0.13, freq: 1300, gain: 0.85 })
        this.tone({ from: 160, to: 55, dur: 0.11, gain: 0.6 })
        break
      case 'vietnam':
        // sharp AK-style crack, distinct from the SMG buzz of 'kurz'
        this.noiseHit({ decay: 0.14, freq: 1000, gain: 0.9 })
        this.tone({ from: 135, to: 42, dur: 0.12, gain: 0.65 })
        break
      case 'm4':
        // crisp, punchy carbine crack
        this.noiseHit({ decay: 0.1, freq: 2000, gain: 0.85 })
        this.tone({ from: 150, to: 48, dur: 0.09, gain: 0.6 })
        break
      case 'mp5':
        // tight, quick, slightly muffled SMG report
        this.noiseHit({ decay: 0.09, freq: 1900, gain: 0.75 })
        this.tone({ from: 150, to: 60, dur: 0.08, gain: 0.5 })
        break
      case 'sniper50': {
        // the biggest boom in the game — sharp crack, then a huge sustained roar
        this.noiseHit({ decay: 0.05, freq: 4600, filterType: 'highpass', gain: 0.65 })
        this.noiseHit({ decay: 0.7, freq: 300, gain: 1.0 })
        this.tone({ from: 50, to: 15, dur: 0.7, gain: 1.0 })
        break
      }
      case 'p90':
        // high-pitched, very rapid buzz
        this.noiseHit({ decay: 0.06, freq: 2400, gain: 0.7 })
        this.tone({ from: 170, to: 65, dur: 0.06, gain: 0.45 })
        break
      case 'dualpistols':
        // sharper and punchier than the single pistol
        this.noiseHit({ decay: 0.09, freq: 1700, gain: 0.75 })
        this.tone({ from: 148, to: 55, dur: 0.09, gain: 0.55 })
        break
      case 'chainsaw':
        // gritty revving snarl rather than a gunshot
        this.noiseHit({ decay: 0.05, freq: 550, filterType: 'bandpass', gain: 0.85 })
        this.tone({ from: 200, to: 175, dur: 0.05, gain: 0.35, type: 'sawtooth' })
        break
      case 'flamethrower':
        // low roaring whoosh
        this.noiseHit({ decay: 0.08, freq: 480, filterType: 'bandpass', gain: 0.6 })
        this.tone({ from: 80, to: 55, dur: 0.08, gain: 0.3, type: 'sawtooth' })
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

  /** A Midget Zombie launching its jump. */
  midgetScreech() {
    const ctx = this.sfxReady()
    if (!ctx) return
    const t = ctx.currentTime
    this.tone({ at: t, from: 900, to: 1600, dur: 0.18, gain: 0.45, type: 'sawtooth' })
    this.tone({ at: t, from: 1300, to: 2200, dur: 0.14, gain: 0.3, type: 'square' })
    this.noiseHit({ at: t, decay: 0.1, freq: 3000, filterType: 'highpass', gain: 0.25 })
  }

  /** A Juggernaut winding up its charge — a long, deep, warning roar. */
  juggernautYell() {
    const ctx = this.sfxReady()
    if (!ctx) return
    const t = ctx.currentTime
    const dur = 0.9
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(90, t)
    o.frequency.linearRampToValueAtTime(150, t + dur * 0.4)
    o.frequency.linearRampToValueAtTime(70, t + dur)
    // vocal wobble for a guttural, roaring texture
    const wob = ctx.createOscillator()
    wob.frequency.value = 7
    const wobGain = ctx.createGain()
    wobGain.gain.value = 22
    wob.connect(wobGain)
    wobGain.connect(o.frequency)
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 380
    f.Q.value = 1.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.85, t + dur * 0.25)
    g.gain.setValueAtTime(0.85, t + dur * 0.7)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(f)
    f.connect(g)
    this.route(g)
    o.start(t)
    o.stop(t + dur + 0.05)
    wob.start(t)
    wob.stop(t + dur + 0.05)
    this.noiseHit({ at: t, decay: dur, freq: 350, gain: 0.4 })
  }

  /** A normal zombie's corpse roaring back to life as a Zuggernaut — louder, more
   *  ragged than the Juggernaut's yell, with a wetter transient underneath. */
  zuggernautRoar() {
    const ctx = this.sfxReady()
    if (!ctx) return
    const t = ctx.currentTime
    const dur = 1.3
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(70, t)
    o.frequency.linearRampToValueAtTime(190, t + dur * 0.35)
    o.frequency.linearRampToValueAtTime(55, t + dur)
    const wob = ctx.createOscillator()
    wob.frequency.value = 9
    const wobGain = ctx.createGain()
    wobGain.gain.value = 34
    wob.connect(wobGain)
    wobGain.connect(o.frequency)
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 420
    f.Q.value = 1.4
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(1.0, t + dur * 0.2)
    g.gain.setValueAtTime(1.0, t + dur * 0.75)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(f)
    f.connect(g)
    this.route(g)
    o.start(t)
    o.stop(t + dur + 0.05)
    wob.start(t)
    wob.stop(t + dur + 0.05)
    // a wet burst under the roar for the blood
    this.noiseHit({ at: t, decay: 0.3, freq: 900, filterType: 'bandpass', gain: 0.5 })
    this.noiseHit({ at: t + 0.05, decay: 0.5, freq: 300, gain: 0.55 })
  }

  /** A Zuggernaut snatching its target off the ground. */
  zuggernautGrab() {
    const ctx = this.sfxReady()
    if (!ctx) return
    const t = ctx.currentTime
    this.tone({ at: t, from: 300, to: 140, dur: 0.3, gain: 0.5, type: 'sawtooth' })
    this.noiseHit({ at: t, decay: 0.2, freq: 700, gain: 0.5 })
  }

  /** The startled moment a Midget Zombie lands and latches on. */
  midgetLatch() {
    const ctx = this.sfxReady()
    if (!ctx) return
    const t = ctx.currentTime
    this.tone({ at: t, from: 1800, to: 300, dur: 0.22, gain: 0.5, type: 'sawtooth' })
    this.noiseHit({ at: t, decay: 0.15, freq: 1200, gain: 0.5 })
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
