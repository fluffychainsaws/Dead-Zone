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
  // the music/SFX buttons are redundant once gameplay starts — the pause menu
  // has its own mute + volume controls now
  document.getElementById('audio-toggles')?.classList.add('hidden')
}

document.getElementById('play-btn')!.addEventListener('click', () => {
  hideTitle()
  game.startSolo()
})

// invite deep-links: dead-zone/#join=CODE drops you straight into the game
const joinMatch = location.hash.match(/^#join=([A-Z0-9]{4,6})$/i)
if (joinMatch) {
  history.replaceState(null, '', location.pathname)
  hideTitle()
  game.startClient(joinMatch[1].toUpperCase())
}

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

// ---------------- platform detection ----------------

const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
const isIos =
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true

// ---------------- info panel (help / install) ----------------

const infoPanel = document.getElementById('info-panel')!
const infoTitle = document.getElementById('info-title')!
const infoBody = document.getElementById('info-body')!

function openInfo(title: string, html: string) {
  lobbyPanel.classList.remove('open')
  infoTitle.textContent = title
  infoBody.innerHTML = html
  infoPanel.classList.add('open')
}

document.getElementById('info-close')!.addEventListener('click', () => {
  infoPanel.classList.remove('open')
})

document.getElementById('help-btn')!.addEventListener('click', () => {
  const controls = isTouchDevice
    ? `<li><b>LEFT SIDE</b> — drag to move (push far to sprint)</li>
       <li><b>RIGHT SIDE</b> — drag to aim</li>
       <li><b>AUTO-FIRE</b> — shoots automatically once the reticle is on a zombie</li>
       <li><b>DOUBLE-TAP RIGHT SIDE</b> — reload (also reloads automatically when empty)</li>
       <li><b>⇄</b> — swap weapon &nbsp;·&nbsp; <b>USE</b> — buy / revive</li>`
    : `<li><b>WASD</b> — move &nbsp;·&nbsp; <b>SHIFT</b> — sprint</li>
       <li><b>MOUSE</b> — aim &nbsp;·&nbsp; <b>CLICK</b> — fire</li>
       <li><b>R</b> — reload &nbsp;·&nbsp; <b>Q</b> — swap weapon</li>
       <li><b>E</b> — buy weapons / ammo, revive teammates</li>`
  openInfo(
    'HOW TO PLAY',
    `<ul>${controls}</ul>
     <p>Survive endless waves. Kills earn <b>points</b> — spend them at the glowing
     wall-buy stations for bigger guns and ammo. Headshots pay more.</p>
     <p><b>HOST</b> a game and share your code, browse the <b>LOBBY</b> to join
     strangers, or go it alone. Downed friends can be revived — nobody left standing
     means the zone wins.</p>`,
  )
})

// ---------------- PWA install ----------------

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: string }>
}

let deferredInstall: BeforeInstallPromptEvent | null = null
const installBtn = document.getElementById('install-btn')!

if (isStandalone) installBtn.style.display = 'none'

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredInstall = e as BeforeInstallPromptEvent
})

window.addEventListener('appinstalled', () => {
  installBtn.style.display = 'none'
  infoPanel.classList.remove('open')
})

installBtn.addEventListener('click', async () => {
  if (deferredInstall) {
    await deferredInstall.prompt()
    deferredInstall = null
    return
  }
  const steps = isIos
    ? `<ol>
         <li>Tap the <b>Share</b> button <span class="kbd">⎋⃞</span> in Safari's toolbar</li>
         <li>Scroll down and tap <b>Add to Home Screen</b> <span class="kbd">＋</span></li>
         <li>Tap <b>Add</b> — DEAD ZONE appears on your home screen</li>
       </ol>
       <p>Launching from the icon gives you fullscreen, offline-ready play.</p>`
    : isTouchDevice
      ? `<ol>
           <li>Open your browser's <b>⋮ menu</b></li>
           <li>Tap <b>Add to Home screen</b> (or <b>Install app</b>)</li>
           <li>Confirm — DEAD ZONE installs like a native app</li>
         </ol>`
      : `<ol>
           <li>Look for the <b>install icon</b> in your address bar (Chrome/Edge)</li>
           <li>Or open the browser menu → <b>Install DEAD ZONE…</b></li>
           <li>The game opens in its own window, works offline</li>
         </ol>`
  openInfo('INSTALL AS APP', steps)
})

// ---------------- orientation hint ----------------

if (isTouchDevice) {
  const hint = document.getElementById('rotate-hint')!
  const orient = window.matchMedia('(orientation: portrait)')
  const reflectOrient = () => hint.classList.toggle('show', orient.matches)
  orient.addEventListener('change', reflectOrient)
  hint.addEventListener('click', () => hint.classList.remove('show'))
  reflectOrient()
}

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
