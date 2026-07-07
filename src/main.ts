import './theme.css'
import { registerSW } from 'virtual:pwa-register'
import { Game } from './game/Game'

registerSW({ immediate: true })

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!
const titleScreen = document.getElementById('title-screen')!

const game = new Game(canvas)
// debug handle (harmless in prod, invaluable for automated testing)
;(window as unknown as { __game: Game }).__game = game

function startGame() {
  titleScreen.classList.add('hidden')
  game.start()
}

document.getElementById('play-btn')!.addEventListener('click', startGame)
