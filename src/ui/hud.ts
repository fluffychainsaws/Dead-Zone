export class Hud {
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
  private bannerTimer: ReturnType<typeof setTimeout> | null = null
  private hitTimer: ReturnType<typeof setTimeout> | null = null

  constructor(isTouch: boolean) {
    this.root = document.createElement('div')
    this.root.id = 'hud'
    this.root.innerHTML = `
      <div id="vignette"></div>
      <div id="crosshair"></div>
      <div id="wave-label">WAVE <span id="wave-num">–</span></div>
      <div id="wave-banner"></div>
      <div id="health-bar"><div id="health-fill"></div></div>
      <div id="points">500</div>
      <div id="prompt"></div>
      <div id="hitmarker"></div>
      <div id="weapon-name"></div>
      <div id="ammo">--</div>
      <div id="hint">${
        isTouch
          ? 'Left: move · Right: aim · Hold FIRE'
          : 'Click to lock aim · WASD move · Shift sprint · R reload'
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

  setWeaponName(name: string) {
    this.weaponEl.textContent = name
  }

  setPrompt(text: string | null) {
    this.promptEl.textContent = text ?? ''
    this.promptEl.classList.toggle('show', !!text)
    document.getElementById('btn-interact')?.classList.toggle('visible', !!text)
  }

  hitmarker(kind: 'hit' | 'kill' | 'headshot') {
    this.hitmarkerEl.className = `show ${kind}`
    if (this.hitTimer) clearTimeout(this.hitTimer)
    this.hitTimer = setTimeout(() => (this.hitmarkerEl.className = ''), 110)
  }

  setAmmo(mag: number, reserve: number, reloading: boolean) {
    this.ammoEl.textContent = reloading ? 'RELOADING…' : `${mag} / ${reserve}`
    this.ammoEl.classList.toggle('low', !reloading && mag <= 2)
  }

  setHealth(hp: number, maxHp: number, recentlyHit: boolean) {
    const frac = Math.max(0, hp / maxHp)
    this.healthFill.style.width = `${frac * 100}%`
    this.healthFill.classList.toggle('critical', frac < 0.35)
    // vignette: strong when hurt, pulsing red when critical
    const base = frac < 0.6 ? (0.6 - frac) * 1.3 : 0
    this.vignetteEl.style.opacity = String(Math.min(0.92, base + (recentlyHit ? 0.45 : 0)))
  }

  setWave(wave: number) {
    this.waveEl.textContent = wave > 0 ? String(wave) : '–'
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
