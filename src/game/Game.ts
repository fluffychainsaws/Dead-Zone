import * as THREE from 'three'
import { buildArena, type Arena } from './arena'
import { Player } from './player'
import { Input } from './input'
import { WeaponSystem } from './weapons'
import { Effects } from './effects'
import { Horde, WaveSystem } from './waves'
import { Economy, POINTS } from './economy'
import { audio } from '../audio/audio'
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
  private groanTimer = 2
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
        audio.waveStinger()
        audio.setIntensity(Math.min(0.15 + w * 0.08, 1))
      },
      onIntermission: (next) => {
        this.hud.banner(`WAVE ${next} INCOMING…`, 3200)
        audio.setIntensity(0.12)
      },
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
    audio.unlock()
    audio.startMusic()
    audio.setIntensity(0.1)
  }

  private earn(amount: number) {
    this.economy.earn(amount)
    this.hud.setPoints(this.economy.points)
    this.hud.pointsDelta(amount)
  }

  private updateGroans(dt: number) {
    this.groanTimer -= dt
    if (this.groanTimer > 0) return
    const alive = this.horde.zombies.filter((z) => z.alive)
    if (alive.length === 0) {
      this.groanTimer = 2
      return
    }
    this.groanTimer = 1.1 + Math.random() * 2.4 - Math.min(alive.length * 0.05, 0.8)
    const z = alive[Math.floor(Math.random() * alive.length)]
    const dx = z.group.position.x - this.player.pos.x
    const dz = z.group.position.z - this.player.pos.z
    const dist = Math.hypot(dx, dz)
    // pan by direction relative to where the player is facing
    const angle = Math.atan2(dx, dz) - this.player.yaw
    audio.groan(-Math.sin(angle), Math.max(0, 1 - dist / 30), z.runner)
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
        audio.purchase()
      } else {
        this.hud.banner('NOT ENOUGH POINTS', 1200)
        audio.deny()
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
      if (this.weapon.events.fired) audio.gunshot(this.weapon.def.id)
      if (this.weapon.events.dryFired) audio.dryFire()
      if (this.weapon.events.reloadStarted) audio.reload()
      for (const hit of hits) {
        if (!hit.object) continue
        const zombie = this.horde.zombieFor(hit.object)
        if (!zombie) continue
        this.effects.impact(hit.point.clone(), 'blood')
        const headshot = zombie.isHeadPart(hit.object)
        const dmg = this.weapon.def.damage * (headshot ? this.weapon.def.headshotMult : 1)
        this.earn(POINTS.hit)
        audio.zombieHit()
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
      if (zombieDamage > 0) {
        this.player.takeDamage(zombieDamage)
        audio.playerHurt()
      }
      this.waves.update(dt)
      this.updateGroans(dt)

      this.hud.setAmmo(this.weapon.mag, this.weapon.reserve, this.weapon.reloading)
      this.hud.setWeaponName(this.weapon.def.name)
      this.hud.setHealth(this.player.hp, this.player.maxHp, this.player.recentlyHit)

      if (!this.player.alive) {
        this.mode = 'dead'
        audio.deathSting()
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
