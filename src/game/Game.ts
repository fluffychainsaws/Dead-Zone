import * as THREE from 'three'
import { buildArena, type Arena } from './arena'
import { Player } from './player'
import { Input } from './input'
import { WeaponSystem, WEAPONS } from './weapons'
import { Effects } from './effects'
import { Hud } from '../ui/hud'

type Mode = 'menu' | 'playing'

export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(72, 1, 0.08, 200)
  private arena: Arena
  private player = new Player()
  private input: Input
  private weapon: WeaponSystem
  private effects: Effects
  private hud: Hud
  private clock = new THREE.Clock()
  private mode: Mode = 'menu'

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.arena = buildArena(this.scene)
    this.scene.add(this.camera) // so viewmodel (camera child) renders
    // dim carry-light so the viewmodel and nearby ground stay readable
    const carryLight = new THREE.PointLight(0x99aa88, 3.5, 7, 1.5)
    carryLight.position.set(0, 0.2, -0.3)
    this.camera.add(carryLight)
    this.input = new Input(canvas)
    this.effects = new Effects(this.scene)
    this.weapon = new WeaponSystem(WEAPONS.pistol, this.camera)
    this.weapon.viewmodel.visible = false
    this.hud = new Hud(this.input.isTouch)

    window.addEventListener('resize', () => this.resize())
    this.resize()
    this.renderer.setAnimationLoop(() => this.tick())
  }

  start() {
    this.mode = 'playing'
    this.weapon.viewmodel.visible = true
    this.hud.show()
    this.input.requestLock()
  }

  private resize() {
    const { innerWidth: w, innerHeight: h } = window
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05)

    if (this.mode === 'menu') {
      const t = this.clock.getElapsedTime()
      this.camera.position.set(Math.sin(t * 0.07) * 16, 7, Math.cos(t * 0.07) * 16)
      this.camera.lookAt(0, 1, 0)
    } else {
      this.player.update(dt, this.input, this.arena.colliders)
      this.player.applyCamera(this.camera)
      this.weapon.update(dt, this.input, this.camera, this.arena.colliderMeshes, this.effects)
      this.hud.setAmmo(this.weapon.mag, this.weapon.reserve, this.weapon.reloading)
    }

    this.effects.update(dt)
    this.renderer.render(this.scene, this.camera)
  }
}
