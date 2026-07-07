import './theme.css'
import { registerSW } from 'virtual:pwa-register'
import { Game } from './game/Game'
import { makeGameCode } from './net/room'
import { Lobby } from './net/lobby'
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
  leaveMenuLobby()
  hideTitle()
  game.startClient(code)
})

// ---------------- global lobby browser ----------------

let menuLobby: Lobby | null = null
let lobbyRenderTimer: ReturnType<typeof setInterval> | null = null
const lobbyPanel = document.getElementById('lobby-panel')!
const lobbyList = document.getElementById('lobby-list')!
const lobbyOnline = document.getElementById('lobby-online')!

function leaveMenuLobby() {
  menuLobby?.leave()
  menuLobby = null
  if (lobbyRenderTimer) clearInterval(lobbyRenderTimer)
  lobbyRenderTimer = null
  lobbyPanel.classList.remove('open')
}

function renderLobby() {
  if (!menuLobby) return
  const online = menuLobby.playersOnline()
  lobbyOnline.textContent = `${online} SURVIVOR${online === 1 ? '' : 'S'} ONLINE`
  const games = menuLobby.list()
  if (games.length === 0) {
    lobbyList.innerHTML =
      '<p class="lobby-empty">No live games found. Host one and the world will see it.</p>'
    return
  }
  lobbyList.innerHTML = ''
  for (const ad of games) {
    const row = document.createElement('div')
    row.className = 'lobby-row'
    row.innerHTML = `
      <span class="lobby-host">${ad.host}</span>
      <span class="lobby-meta">WAVE ${Math.max(ad.wave, 1)} · ${ad.players} ALIVE</span>
      <button class="lobby-join">JOIN</button>
    `
    row.querySelector('.lobby-join')!.addEventListener('click', () => {
      leaveMenuLobby()
      hideTitle()
      game.startClient(ad.code)
    })
    lobbyList.appendChild(row)
  }
}

document.getElementById('lobby-btn')!.addEventListener('click', () => {
  audio.unlock()
  if (lobbyPanel.classList.contains('open')) {
    leaveMenuLobby()
    return
  }
  lobbyPanel.classList.add('open')
  lobbyList.innerHTML = '<p class="lobby-empty">Scanning the dead zone…</p>'
  menuLobby = new Lobby()
  menuLobby.onUpdate = renderLobby
  lobbyRenderTimer = setInterval(renderLobby, 1000)
})

document.getElementById('lobby-close')!.addEventListener('click', leaveMenuLobby)

document.getElementById('play-btn')!.addEventListener('click', leaveMenuLobby)
document.getElementById('host-btn')!.addEventListener('click', leaveMenuLobby)

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
