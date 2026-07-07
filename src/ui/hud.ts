export class Hud {
  private root: HTMLElement
  private ammoEl: HTMLElement

  constructor(isTouch: boolean) {
    this.root = document.createElement('div')
    this.root.id = 'hud'
    this.root.innerHTML = `
      <div id="crosshair"></div>
      <div id="ammo">--</div>
      <div id="hint">${
        isTouch
          ? 'Left: move · Right: aim · Hold FIRE'
          : 'Click to lock aim · WASD move · Shift sprint · R reload'
      }</div>
    `
    document.getElementById('app')!.appendChild(this.root)
    this.ammoEl = this.root.querySelector('#ammo')!
  }

  setAmmo(mag: number, reserve: number, reloading: boolean) {
    this.ammoEl.textContent = reloading ? 'RELOADING…' : `${mag} / ${reserve}`
    this.ammoEl.classList.toggle('low', !reloading && mag <= 2)
  }

  show() {
    this.root.classList.add('visible')
  }
}
