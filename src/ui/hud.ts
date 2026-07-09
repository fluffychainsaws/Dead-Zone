export class Hud {
  onPause: (() => void) | null = null

  private root: HTMLElement
  private ammoEl: HTMLElement
  private healthFill: HTMLElement
  private waveEl: HTMLElement
  private bannerEl: HTMLElement
  private vignetteEl: HTMLElement
  private gameOverEl: HTMLElement
  private pointsEl: HTMLElement
  private promptEl: HTMLElement
  private hitmarkerEl: HTMLElement
  private weaponEl: HTMLElement
  private crosshairEl: HTMLElement
  private scopeEl: HTMLElement
  private midgetEl: HTMLElement
  private lightEl: HTMLElement
  private lastLight = ''
  private bannerTimer: ReturnType<typeof setTimeout> | null = null
  private hitTimer: ReturnType<typeof setTimeout> | null = null
  // last-written values — these setters run every frame, the DOM should not
  private lastAmmo = ''
  private lastWeapon = ''
  private lastHealth = ''

  constructor(isTouch: boolean) {
    this.root = document.createElement('div')
    this.root.id = 'hud'
    this.root.innerHTML = `
      <div id="vignette"></div>
      <div id="crosshair"></div>
      <div id="scope-overlay"><div class="lens"><div class="reticle"></div></div></div>
      <div id="midget-overlay">
        <div class="claws"></div>
        <div class="midget-prompt">MASH MELEE TO THROW IT OFF!</div>
      </div>
      <div id="wave-label">WAVE <span id="wave-num">–</span></div>
      <div id="room-info"></div>
      <button id="pause-btn">☰</button>
      <div id="wave-banner"></div>
      <div id="health-bar"><div id="health-fill"></div></div>
      <div id="points">500</div>
      <div id="prompt"></div>
      <div id="hitmarker"></div>
      <div id="weapon-name"></div>
      <div id="light-status"></div>
      <div id="ammo">--</div>
      <div id="hint">${
        isTouch
          ? 'Left: move · Right: aim · Hold FIRE · ADS to zoom'
          : 'WASD move · Shift sprint · Right-click ADS · Space jump/vault · C crouch · V melee · R reload'
      }</div>
      <div id="game-over">
        <h2>YOU DIED</h2>
        <p id="go-stats"></p>
        <button id="go-restart">RISE AGAIN</button>
      </div>
    `
    document.getElementById('app')!.appendChild(this.root)
    this.ammoEl = this.root.querySelector('#ammo')!
    this.healthFill = this.root.querySelector('#health-fill')!
    this.waveEl = this.root.querySelector('#wave-num')!
    this.bannerEl = this.root.querySelector('#wave-banner')!
    this.vignetteEl = this.root.querySelector('#vignette')!
    this.gameOverEl = this.root.querySelector('#game-over')!
    this.pointsEl = this.root.querySelector('#points')!
    this.promptEl = this.root.querySelector('#prompt')!
    this.hitmarkerEl = this.root.querySelector('#hitmarker')!
    this.weaponEl = this.root.querySelector('#weapon-name')!
    this.crosshairEl = this.root.querySelector('#crosshair')!
    this.scopeEl = this.root.querySelector('#scope-overlay')!
    this.midgetEl = this.root.querySelector('#midget-overlay')!
    this.lightEl = this.root.querySelector('#light-status')!
    this.root.querySelector('#pause-btn')!.addEventListener('click', () => this.onPause?.())
  }

  setPoints(points: number) {
    this.pointsEl.textContent = String(points)
  }

  pointsDelta(amount: number) {
    const el = document.createElement('span')
    el.className = 'points-delta'
    el.textContent = amount > 0 ? `+${amount}` : String(amount)
    if (amount < 0) el.classList.add('spend')
    this.pointsEl.appendChild(el)
    setTimeout(() => el.remove(), 900)
  }

  private scopeActive = false
  private midgetActive = false

  setScopeOverlay(active: boolean) {
    if (active === this.scopeActive) return
    this.scopeActive = active
    this.scopeEl.classList.toggle('active', active)
    this.crosshairEl.style.visibility = active ? 'hidden' : 'visible'
  }

  setMidgetOverlay(active: boolean) {
    if (active === this.midgetActive) return
    this.midgetActive = active
    this.midgetEl.classList.toggle('active', active)
  }

  setLightStatus(
    inLab: boolean,
    mode: 'off' | 'flashlight' | 'nvg',
    ownsFlash: boolean,
    ownsNvg: boolean,
  ) {
    let text = ''
    if (inLab) {
      if (mode === 'flashlight') text = '🔦 FLASHLIGHT · T'
      else if (mode === 'nvg') text = '🥽 NIGHT VISION · T'
      else text = ownsFlash || ownsNvg ? '🌑 LIGHT OFF · T' : '🌑 PITCH BLACK'
    }
    if (text === this.lastLight) return
    this.lastLight = text
    this.lightEl.textContent = text
    this.lightEl.style.display = text ? 'block' : 'none'
  }

  setWeaponName(name: string) {
    if (name === this.lastWeapon) return
    this.lastWeapon = name
    this.weaponEl.textContent = name
  }

  setPrompt(text: string | null) {
    this.promptEl.textContent = text ?? ''
    this.promptEl.classList.toggle('show', !!text)
    document.getElementById('btn-interact')?.classList.toggle('visible', !!text)
  }

  private reviveMarkers = new Map<string, HTMLElement>()

  updateReviveMarkers(list: Array<{ id: string; sx: number; sy: number; dist: number }>) {
    const seen = new Set<string>()
    for (const m of list) {
      seen.add(m.id)
      let el = this.reviveMarkers.get(m.id)
      if (!el) {
        el = document.createElement('div')
        el.className = 'revive-marker'
        el.innerHTML = '<span>REVIVE</span><b></b>'
        this.root.appendChild(el)
        this.reviveMarkers.set(m.id, el)
      }
      el.style.left = `${m.sx}%`
      el.style.top = `${m.sy}%`
      el.querySelector('b')!.textContent = `${m.dist}m`
    }
    for (const [id, el] of this.reviveMarkers) {
      if (!seen.has(id)) {
        el.remove()
        this.reviveMarkers.delete(id)
      }
    }
  }

  hitmarker(kind: 'hit' | 'kill' | 'headshot') {
    this.hitmarkerEl.className = `show ${kind}`
    if (this.hitTimer) clearTimeout(this.hitTimer)
    this.hitTimer = setTimeout(() => (this.hitmarkerEl.className = ''), 110)
  }

  setAmmo(mag: number, reserve: number, reloading: boolean) {
    const text = reloading ? 'RELOADING…' : `${mag} / ${reserve}`
    if (text === this.lastAmmo) return
    this.lastAmmo = text
    this.ammoEl.textContent = text
    this.ammoEl.classList.toggle('low', !reloading && mag <= 2)
  }

  setHealth(hp: number, maxHp: number, recentlyHit: boolean) {
    const frac = Math.max(0, hp / maxHp)
    // vignette: strong when hurt, pulsing red when critical
    const base = frac < 0.6 ? (0.6 - frac) * 1.3 : 0
    const key = `${frac.toFixed(3)}|${recentlyHit}`
    if (key === this.lastHealth) return
    this.lastHealth = key
    this.healthFill.style.width = `${frac * 100}%`
    this.healthFill.classList.toggle('critical', frac < 0.35)
    this.vignetteEl.style.opacity = String(Math.min(0.92, base + (recentlyHit ? 0.45 : 0)))
  }

  setWave(wave: number) {
    this.waveEl.textContent = wave > 0 ? String(wave) : '–'
  }

  setRoomInfo(text: string | null) {
    const el = this.root.querySelector<HTMLElement>('#room-info')!
    el.textContent = text ?? ''
    el.style.display = text ? 'block' : 'none'
  }

  banner(text: string, ms = 2600) {
    this.bannerEl.textContent = text
    this.bannerEl.classList.add('show')
    if (this.bannerTimer) clearTimeout(this.bannerTimer)
    this.bannerTimer = setTimeout(() => this.bannerEl.classList.remove('show'), ms)
  }

  showGameOver(wave: number, kills: number, points: number, onRestart: () => void) {
    this.root.querySelector('#go-stats')!.textContent =
      `You fell on wave ${wave} · ${kills} zombies destroyed · ${points} points earned`
    this.gameOverEl.classList.add('show')
    this.root
      .querySelector('#go-restart')!
      .addEventListener('click', onRestart, { once: true })
  }

  show() {
    this.root.classList.add('visible')
  }
}
