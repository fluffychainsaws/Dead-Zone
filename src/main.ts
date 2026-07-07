import './theme.css'
import { registerSW } from 'virtual:pwa-register'
import { Game } from './game/Game'
import { makeGameCode } from './net/room'
import { audio } from './audio/audio'

registerSW({ immediate: true })

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!
const titleScreen = document.getElementById('title-screen')!

const game = new Game(canvas)
// debug handle (harmless in prod, invaluable for automated testing)
;(window as unknown as { __game: Game }).__game = game

function hideTitle() {
  titleScreen.classList.add('hidden')
}

document.getElementById('play-btn')!.addEventListener('click', () => {
  hideTitle()
  game.startSolo()
})

document.getElementById('host-btn')!.addEventListener('click', () => {
  hideTitle()
  game.startHost(makeGameCode())
})

const joinRow = document.getElementById('join-row')!
document.getElementById('join-btn')!.addEventListener('click', () => {
  joinRow.classList.toggle('open')
  document.getElementById('join-code')!.focus()
})

document.getElementById('join-go')!.addEventListener('click', () => {
  const code = (document.getElementById('join-code') as HTMLInputElement).value
    .trim()
    .toUpperCase()
  if (code.length < 4) return
  hideTitle()
  game.startClient(code)
})

// audio toggles — present on title screen and in-game
const toggles = document.createElement('div')
toggles.id = 'audio-toggles'
toggles.innerHTML = `
  <button id="music-toggle" title="Toggle music">♫</button>
  <button id="sfx-toggle" title="Toggle sound effects">🔊</button>
`
document.getElementById('app')!.appendChild(toggles)
const musicBtn = document.getElementById('music-toggle')!
const sfxBtn = document.getElementById('sfx-toggle')!

function reflect() {
  musicBtn.classList.toggle('off', !audio.settings.music)
  sfxBtn.classList.toggle('off', !audio.settings.sfx)
  sfxBtn.textContent = audio.settings.sfx ? '🔊' : '🔇'
}
musicBtn.addEventListener('click', () => {
  audio.unlock()
  audio.toggleMusic()
  reflect()
})
sfxBtn.addEventListener('click', () => {
  audio.unlock()
  audio.toggleSfx()
  reflect()
})
reflect()
