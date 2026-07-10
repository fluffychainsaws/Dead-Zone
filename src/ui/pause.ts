import { audio } from '../audio/audio'

export class PauseMenu {
  onResume: (() => void) | null = null
  onLeave: (() => void) | null = null

  private root: HTMLElement
  private inviteBtn: HTMLElement
  private inviteCode: string | null = null
  private pausedNote: HTMLElement
  private refreshAudioUI: () => void = () => {}

  constructor() {
    this.root = document.createElement('div')
    this.root.id = 'pause-menu'
    this.root.innerHTML = `
      <div id="pause-box">
        <h2>DEAD ZONE</h2>
        <p id="pause-note"></p>
        <div id="pause-audio">
          <div class="pause-audio-row">
            <button id="pause-music-toggle" class="pause-audio-toggle">♫ MUSIC</button>
            <input id="pause-music-volume" type="range" min="0" max="100" step="1" />
          </div>
          <div class="pause-audio-row">
            <button id="pause-sfx-toggle" class="pause-audio-toggle">🔊 SFX</button>
            <input id="pause-sfx-volume" type="range" min="0" max="100" step="1" />
          </div>
        </div>
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
    this.bindAudioControls()
  }

  private bindAudioControls() {
    const musicToggle = this.root.querySelector<HTMLButtonElement>('#pause-music-toggle')!
    const sfxToggle = this.root.querySelector<HTMLButtonElement>('#pause-sfx-toggle')!
    const musicVolume = this.root.querySelector<HTMLInputElement>('#pause-music-volume')!
    const sfxVolume = this.root.querySelector<HTMLInputElement>('#pause-sfx-volume')!

    const reflectMain = () => {
      // keep the title-screen music/sfx buttons in sync — they read the same
      // shared audio settings but have their own DOM state to reflect
      const mainMusic = document.getElementById('music-toggle')
      const mainSfx = document.getElementById('sfx-toggle')
      mainMusic?.classList.toggle('off', !audio.settings.music)
      mainSfx?.classList.toggle('off', !audio.settings.sfx)
      if (mainSfx) mainSfx.textContent = audio.settings.sfx ? '🔊' : '🔇'
    }

    const reflect = () => {
      musicToggle.classList.toggle('off', !audio.settings.music)
      sfxToggle.classList.toggle('off', !audio.settings.sfx)
      musicVolume.value = String(Math.round(audio.settings.musicVolume * 100))
      sfxVolume.value = String(Math.round(audio.settings.sfxVolume * 100))
      reflectMain()
    }

    musicToggle.addEventListener('click', () => {
      audio.toggleMusic()
      reflect()
    })
    sfxToggle.addEventListener('click', () => {
      audio.toggleSfx()
      reflect()
    })
    musicVolume.addEventListener('input', () => {
      audio.setMusicVolume(Number(musicVolume.value) / 100)
    })
    sfxVolume.addEventListener('input', () => {
      audio.setSfxVolume(Number(sfxVolume.value) / 100)
    })

    reflect()
    this.refreshAudioUI = reflect
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
    this.refreshAudioUI()
  }

  close() {
    this.root.classList.remove('open')
  }
}
