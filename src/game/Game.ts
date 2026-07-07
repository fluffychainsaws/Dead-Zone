import * as THREE from 'three'
import { buildArena, type Arena } from './arena'
import { Player } from './player'
import { Input } from './input'
import { WeaponSystem } from './weapons'
import { Effects } from './effects'
import { Horde, WaveSystem } from './waves'
import { Economy, POINTS } from './economy'
import { Hud } from '../ui/hud'

type Mode = 'menu' | 'playing' | 'dead'

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
  private horde: Horde
  private waves: WaveSystem
  private economy = new Economy()
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
    this.weapon = new WeaponSystem(this.camera)
    this.economy.buildStations(this.scene)
    this.hud = new Hud(this.input.isTouch)
    this.horde = new Horde(this.scene)
    this.waves = new WaveSystem(this.horde, this.arena.spawnPoints, {
      onWaveStart: (w) => {
        this.hud.setWave(w)
        this.hud.banner(`WAVE ${w}`)
      },
      onIntermission: (next) => this.hud.banner(`WAVE ${next} INCOMING…`, 3200),
    })

    window.addEventListener('resize', () => this.resize())
    this.resize()
    this.renderer.setAnimationLoop(() => this.tick())
  }

  start() {
    this.mode = 'playing'
    this.weapon.setVisible(true)
    this.hud.show()
    this.hud.setPoints(this.economy.points)
    this.input.requestLock()
    this.waves.begin()
  }

  private earn(amount: number) {
    this.economy.earn(amount)
    this.hud.setPoints(this.economy.points)
    this.hud.pointsDelta(amount)
  }

  private handleShopping() {
    const station = this.economy.nearestStation(this.player.pos)
    if (!station) {
      this.hud.setPrompt(null)
      return
    }
    const owned = this.weapon.owns(station.def.id)
    const price = owned ? station.ammoPrice : station.price
    const action = owned ? 'AMMO' : station.def.name
    const key = this.input.isTouch ? 'USE' : '[E]'
    this.hud.setPrompt(`${key} ${action} — ${price}`)
    if (this.input.consumeInteract()) {
      if (this.economy.spend(price)) {
        this.hud.setPoints(this.economy.points)
        this.hud.pointsDelta(-price)
        if (owned) this.weapon.refill(station.def.id)
        else this.weapon.give(station.def)
      } else {
        this.hud.banner('NOT ENOUGH POINTS', 1200)
      }
    }
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
    } else if (this.mode === 'playing') {
      this.player.update(dt, this.input, this.arena.colliders)
      this.player.applyCamera(this.camera)

      const targets = [...this.arena.colliderMeshes, ...this.horde.targets()]
      const hits = this.weapon.update(dt, this.input, this.camera, targets, this.effects)
      for (const hit of hits) {
        if (!hit.object) continue
        const zombie = this.horde.zombieFor(hit.object)
        if (!zombie) continue
        this.effects.impact(hit.point.clone(), 'blood')
        const headshot = zombie.isHeadPart(hit.object)
        const dmg = this.weapon.def.damage * (headshot ? this.weapon.def.headshotMult : 1)
        this.earn(POINTS.hit)
        if (zombie.damage(dmg)) {
          this.waves.registerKill(zombie, headshot)
          this.earn(headshot ? POINTS.headshotKill : POINTS.kill)
          this.hud.hitmarker(headshot ? 'headshot' : 'kill')
        } else {
          this.hud.hitmarker('hit')
        }
      }

      this.handleShopping()
      this.economy.update(dt)

      const zombieDamage = this.horde.update(dt, this.player.pos, this.arena.colliders)
      if (zombieDamage > 0) this.player.takeDamage(zombieDamage)
      this.waves.update(dt)

      this.hud.setAmmo(this.weapon.mag, this.weapon.reserve, this.weapon.reloading)
      this.hud.setWeaponName(this.weapon.def.name)
      this.hud.setHealth(this.player.hp, this.player.maxHp, this.player.recentlyHit)

      if (!this.player.alive) {
        this.mode = 'dead'
        document.exitPointerLock?.()
        this.hud.showGameOver(
          this.waves.wave,
          this.waves.kills,
          this.economy.totalEarned,
          () => location.reload(),
        )
      }
    } else {
      // dead: keep rendering the world, horde keeps milling around
      this.horde.update(dt, this.player.pos, this.arena.colliders)
    }

    this.effects.update(dt)
    this.renderer.render(this.scene, this.camera)
  }
}
