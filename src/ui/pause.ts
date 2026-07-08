export class PauseMenu {
  onResume: (() => void) | null = null
  onLeave: (() => void) | null = null

  private root: HTMLElement
  private inviteBtn: HTMLElement
  private inviteCode: string | null = null
  private pausedNote: HTMLElement

  constructor() {
    this.root = document.createElement('div')
    this.root.id = 'pause-menu'
    this.root.innerHTML = `
      <div id="pause-box">
        <h2>DEAD ZONE</h2>
        <p id="pause-note"></p>
        <button id="pause-resume">RESUME</button>
        <button id="pause-invite">INVITE</button>
        <button id="pause-leave">LEAVE GAME</button>
      </div>
    `
    document.getElementById('app')!.appendChild(this.root)
    this.inviteBtn = this.root.querySelector('#pause-invite')!
    this.pausedNote = this.root.querySelector('#pause-note')!

    this.root.querySelector('#pause-resume')!.addEventListener('click', () => {
      this.close()
      this.onResume?.()
    })
    this.root.querySelector('#pause-leave')!.addEventListener('click', () => {
      this.onLeave?.()
    })
    this.inviteBtn.addEventListener('click', () => void this.invite())
  }

  /** null hides the invite button (solo games). */
  setInvite(code: string | null) {
    this.inviteCode = code
    this.inviteBtn.style.display = code ? 'block' : 'none'
    if (code) this.inviteBtn.textContent = `INVITE · ${code}`
  }

  setPauseNote(solo: boolean) {
    this.pausedNote.textContent = solo
      ? 'GAME PAUSED'
      : 'GAME STILL RUNNING — THE HORDE DOESN’T WAIT'
  }

  private async invite() {
    if (!this.inviteCode) return
    const url = `${location.origin}${location.pathname}#join=${this.inviteCode}`
    const text = `Fight the horde with me in DEAD ZONE — game code ${this.inviteCode}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'DEAD ZONE', text, url })
      } else {
        await navigator.clipboard.writeText(url)
        this.inviteBtn.textContent = 'LINK COPIED!'
        setTimeout(() => {
          this.inviteBtn.textContent = `INVITE · ${this.inviteCode}`
        }, 1600)
      }
    } catch {
      /* user dismissed the share sheet */
    }
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open')
  }

  open() {
    this.root.classList.add('open')
  }

  close() {
    this.root.classList.remove('open')
  }
}
