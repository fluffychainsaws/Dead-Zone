import * as THREE from 'three'
import { buildArena, type Arena } from './arena'
import { Player } from './player'
import { Input } from './input'
import { WeaponSystem } from './weapons'
import { Effects } from './effects'
import { Horde, WaveSystem } from './waves'
import { Economy, POINTS } from './economy'
import { RemotePlayer, RemoteZombieField } from './remote'
import { NetRoom, selfId, type GameState, type PlayerState } from '../net/room'
import { Lobby, shortName } from '../net/lobby'
import type { TargetInfo } from './zombie'
import { audio } from '../audio/audio'
import { Hud } from '../ui/hud'
import { PauseMenu } from '../ui/pause'

type Mode = 'menu' | 'playing' | 'dead'
type NetMode = 'solo' | 'host' | 'client'

const NET_RATE = 1 / 12 // send rate for state/input
const REVIVE_RANGE = 2.4

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

  // --- multiplayer state ---
  private netMode: NetMode = 'solo'
  private net: NetRoom | null = null
  private remotePlayers = new Map<string, RemotePlayer>()
  private peerStates = new Map<string, PlayerState>()
  private remoteZombies: RemoteZombieField
  private netTimer = 0
  private hostId: string | null = null
  private clientWave = 0
  private lobby: Lobby | null = null
  private pause = new PauseMenu()
  private paused = false

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
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
    this.remoteZombies = new RemoteZombieField(this.scene)
    this.waves = new WaveSystem(this.horde, () => this.arena.activeSpawns(), {
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

    this.pause.onResume = () => {
      this.paused = false
      this.input.requestLock()
    }
    this.pause.onLeave = () => {
      this.net?.leave()
      this.lobby?.leave()
      location.reload()
    }
    // Esc in pointer lock releases the lock — treat that as "open the menu"
    document.addEventListener('pointerlockchange', () => {
      if (
        !document.pointerLockElement &&
        this.mode === 'playing' &&
        !this.input.isTouch &&
        !this.paused
      ) {
        this.openPause()
      }
    })
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.mode === 'playing') {
        if (this.paused) {
          this.pause.close()
          this.paused = false
          this.input.requestLock()
        } else {
          this.openPause()
        }
      }
    })

    window.addEventListener('resize', () => this.resize())
    this.resize()
    this.renderer.setAnimationLoop(() => this.tick())
  }

  private openPause() {
    if (this.mode !== 'playing' || this.paused) return
    this.paused = true
    this.pause.setInvite(this.netMode === 'solo' ? null : (this.net?.code ?? null))
    this.pause.setPauseNote(this.netMode === 'solo')
    this.pause.open()
    document.exitPointerLock?.()
  }

  // ------------------------------ session starts ------------------------------

  startSolo() {
    this.netMode = 'solo'
    this.beginPlaying()
    this.waves.begin()
  }

  startHost(code: string) {
    this.netMode = 'host'
    this.net = new NetRoom(code)
    this.bindCommonNet()
    this.net.onInput((s, from) => {
      this.peerStates.set(from, s)
      this.ensureAvatar(from).applyState(s)
    })
    this.net.onDoor((id) => this.openDoorEverywhere(id))
    this.net.onShot((shot, from) => {
      // trust the peer's hit — co-op, host applies authoritative damage
      this.effects.tracer(
        new THREE.Vector3(...shot.from),
        new THREE.Vector3(...shot.to),
      )
      const z = this.horde.zombies.find((x) => x.id === shot.zid && x.alive)
      if (!z) return
      this.effects.impact(new THREE.Vector3(...shot.to), 'blood')
      const def = Object.values(this.weaponDefs()).find((d) => d.id === shot.wid)
      const dmg = (def?.damage ?? 30) * (shot.head ? (def?.headshotMult ?? 2) : 1)
      const killed = z.damage(dmg)
      if (killed) this.waves.registerKill(z, shot.head === 1)
      this.net!.sendScore(
        { amt: POINTS.hit + (killed ? (shot.head ? POINTS.headshotKill : POINTS.kill) : 0), kill: killed ? 1 : 0, head: shot.head },
        from,
      )
    })
    this.hud.setRoomInfo(`CODE: ${code}`)
    this.beginPlaying()
    this.waves.begin()
    // announce this game to the global lobby while it's joinable
    this.lobby = new Lobby()
    this.lobby.startAnnouncing(() => ({
      code,
      host: shortName(),
      wave: this.waves.wave,
      players: (this.net?.peers().length ?? 0) + 1,
    }))
  }

  startClient(code: string) {
    this.netMode = 'client'
    this.net = new NetRoom(code)
    this.bindCommonNet()
    this.net.onState((s, from) => {
      this.hostId = from
      this.applyHostState(s, from)
    })
    this.net.onScore((s) => {
      this.earn(s.amt)
      audio.zombieHit()
      this.hud.hitmarker(s.kill ? (s.head ? 'headshot' : 'kill') : 'hit')
    })
    this.net.onAttack((dmg) => {
      this.player.takeDamage(dmg)
      audio.playerHurt()
    })
    this.net.onOver(() => this.gameOver())
    this.hud.setRoomInfo(`JOINED: ${code}`)
    this.beginPlaying()
    this.hud.banner('CONNECTING…', 4000)
  }

  private bindCommonNet() {
    if (!this.net) return
    this.net.onRevive((target) => {
      if (target === selfId && this.player.downed) {
        this.player.revive()
        this.hud.banner('REVIVED', 1500)
      }
    })
    this.net.onPeerJoin((id) => {
      this.hud.banner('SURVIVOR JOINED', 1800)
      this.ensureAvatar(id)
      this.updateRoomCount()
    })
    this.net.onPeerLeave((id) => {
      const avatar = this.remotePlayers.get(id)
      if (avatar) this.scene.remove(avatar.group)
      this.remotePlayers.delete(id)
      this.peerStates.delete(id)
      this.updateRoomCount()
      if (this.netMode === 'client' && id === this.hostId) {
        this.hud.banner('HOST LEFT — GAME ENDED', 5000)
        setTimeout(() => location.reload(), 3200)
      } else {
        this.hud.banner('SURVIVOR LEFT', 1800)
      }
    })
  }

  private updateRoomCount() {
    if (!this.net) return
    const n = this.net.peers().length + 1
    const label = this.netMode === 'host' ? `CODE: ${this.net.code}` : `JOINED: ${this.net.code}`
    this.hud.setRoomInfo(`${label} · ${n} SURVIVOR${n > 1 ? 'S' : ''}`)
  }

  private beginPlaying() {
    this.mode = 'playing'
    this.weapon.setVisible(true)
    this.hud.show()
    this.hud.onPause = () => this.openPause()
    this.hud.setPoints(this.economy.points)
    this.input.requestLock()
    audio.unlock()
    audio.startMusic()
    audio.setIntensity(0.1)
  }

  private weaponDefs() {
    // avoids importing WEAPONS at use sites; single source in weapons.ts
    return this.weapon.allDefs()
  }

  private zombieNav() {
    return {
      colliders: this.arena.zombieColliders,
      nextWaypoint: (p: THREE.Vector3, t: THREE.Vector3) => this.arena.nextWaypoint(p, t),
      inOpeningZone: (p: THREE.Vector3) => this.arena.inOpeningZone(p),
    }
  }

  private ensureAvatar(id: string): RemotePlayer {
    let avatar = this.remotePlayers.get(id)
    if (!avatar) {
      avatar = new RemotePlayer(this.scene, id.slice(0, 6))
      this.remotePlayers.set(id, avatar)
    }
    return avatar
  }

  // ------------------------------ client state sync ------------------------------

  private applyHostState(s: GameState, hostId: string) {
    if (s.w !== this.clientWave) {
      this.clientWave = s.w
      this.hud.setWave(s.w)
      if (s.w > 0) {
        this.hud.banner(`WAVE ${s.w}`)
        audio.waveStinger()
        audio.setIntensity(Math.min(0.15 + s.w * 0.08, 1))
      }
    }
    for (const id of s.d ?? []) {
      if (!this.arena.doors[id]?.open) this.openDoorEverywhere(id, false)
    }
    this.remoteZombies.applyState(s.z)
    for (const [pid, ps] of Object.entries(s.p)) {
      if (pid === selfId) continue
      // host relays every player's state (including its own under hostId)
      this.ensureAvatar(pid === 'host' ? hostId : pid).applyState(ps)
    }
  }

  // ------------------------------ scoring / shopping / groans ------------------------------

  private earn(amount: number) {
    this.economy.earn(amount)
    this.hud.setPoints(this.economy.points)
    this.hud.pointsDelta(amount)
  }

  private updateGroans(dt: number) {
    this.groanTimer -= dt
    if (this.groanTimer > 0) return
    let source: { pos: THREE.Vector3; runner: boolean } | null = null
    if (this.netMode === 'client') {
      source = this.remoteZombies.randomGroanSource()
    } else {
      const alive = this.horde.zombies.filter((z) => z.alive)
      if (alive.length > 0) {
        const z = alive[Math.floor(Math.random() * alive.length)]
        source = { pos: z.group.position, runner: z.runner }
      }
    }
    if (!source) {
      this.groanTimer = 2
      return
    }
    this.groanTimer = 1.1 + Math.random() * 2.4
    const dx = source.pos.x - this.player.pos.x
    const dz = source.pos.z - this.player.pos.z
    const dist = Math.hypot(dx, dz)
    const angle = Math.atan2(dx, dz) - this.player.yaw
    audio.groan(-Math.sin(angle), Math.max(0, 1 - dist / 30), source.runner)
  }

  /** Revive prompt takes priority over wall-buys. Returns true if it owned the prompt. */
  private handleRevive(): boolean {
    if (this.netMode === 'solo' || this.player.downed) return false
    for (const [id, avatar] of this.remotePlayers) {
      if (!avatar.down) continue
      const d = this.player.pos.distanceTo(avatar.pos)
      if (d < REVIVE_RANGE) {
        const key = this.input.isTouch ? 'USE' : '[E]'
        this.hud.setPrompt(`${key} REVIVE SURVIVOR`)
        if (this.input.consumeInteract()) {
          this.net?.sendRevive(id)
          this.hud.banner('SURVIVOR REVIVED', 1500)
          audio.purchase()
        }
        return true
      }
    }
    return false
  }

  /** Buy open a locked gate. Returns true if it owned the prompt. */
  private handleDoors(): boolean {
    const door = this.arena.nearestClosedDoor(this.player.pos)
    if (!door) return false
    const key = this.input.isTouch ? 'USE' : '[E]'
    this.hud.setPrompt(`${key} OPEN ${door.name} — ${door.cost}`)
    if (this.input.consumeInteract()) {
      if (this.economy.spend(door.cost)) {
        this.hud.setPoints(this.economy.points)
        this.hud.pointsDelta(-door.cost)
        this.openDoorEverywhere(door.id)
        audio.purchase()
      } else {
        this.hud.banner('NOT ENOUGH POINTS', 1200)
        audio.deny()
      }
    }
    return true
  }

  private openDoorEverywhere(id: number, broadcast = true) {
    const door = this.arena.doors[id]
    if (!door || door.open) return
    const closedRoom = this.arena.rooms.find(
      (r) => door.rooms.includes(r.id) && !r.open,
    )
    this.arena.openDoor(id)
    this.hud.banner(closedRoom ? `${closedRoom.name} OPENED` : 'GATE OPENED', 2600)
    audio.waveStinger()
    if (broadcast && this.netMode === 'client') this.net?.sendDoor(id)
    // host: openDoorIds() rides along in the next state broadcast
  }

  private handleShopping() {
    if (this.handleRevive()) return
    if (this.handleDoors()) return
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

  // ------------------------------ death / downs ------------------------------

  private handleZeroHp() {
    if (this.player.hp > 0 || this.player.downed || !this.player.alive) return
    if (this.netMode === 'solo') {
      this.player.alive = false
      this.gameOver()
      return
    }
    // co-op: go down, teammates can revive
    const teammatesUp = [...this.remotePlayers.values()].some((p) => !p.down && p.hp > 0)
    if (teammatesUp) {
      this.player.downed = true
      this.hud.banner('YOU ARE DOWN — WAIT FOR A REVIVE', 4000)
      audio.playerHurt()
    } else {
      this.player.alive = false
      if (this.netMode === 'host') this.net?.sendOver()
      this.gameOver()
    }
  }

  private gameOver() {
    if (this.mode === 'dead') return
    this.mode = 'dead'
    this.pause.close()
    this.paused = false
    this.lobby?.leave()
    this.lobby = null
    audio.deathSting()
    document.exitPointerLock?.()
    this.hud.showGameOver(
      this.netMode === 'client' ? this.clientWave : this.waves.wave,
      this.waves.kills,
      this.economy.totalEarned,
      () => location.reload(),
    )
  }

  // ------------------------------ net send ------------------------------

  private netSend() {
    if (!this.net) return
    this.netTimer -= 1
    if (this.netTimer > 0) return
    this.netTimer = Math.max(1, Math.round(NET_RATE / 0.0166))

    const self: PlayerState = [
      this.player.pos.x,
      this.player.pos.z,
      this.player.yaw,
      Math.round(this.player.hp),
      this.player.downed ? 1 : 0,
      Number(this.player.pos.y.toFixed(2)),
    ]
    if (this.netMode === 'client') {
      this.net.sendInput(self)
      return
    }
    // host: broadcast the world
    const state: GameState = {
      w: this.waves.wave,
      ph: this.waves.phase,
      z: this.horde.zombies
        .filter((z) => !z.dead)
        .map((z) => [
          z.id,
          Number(z.group.position.x.toFixed(2)),
          Number(z.group.position.z.toFixed(2)),
          Number(z.group.rotation.y.toFixed(2)),
          z.state === 'dying' ? 2 : z.state === 'attacking' ? 1 : 0,
          z.runner ? 1 : 0,
        ]),
      p: { ...Object.fromEntries(this.peerStates), host: self },
      d: this.arena.openDoorIds(),
    }
    this.net.sendState(state)
  }

  // ------------------------------ main loop ------------------------------

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
      if (this.paused) {
        // discard buffered input so nothing fires or jerks on resume
        this.input.consumeLook()
        this.input.consumeFirePress()
        this.input.consumeReload()
        this.input.consumeInteract()
        this.input.consumeSwitch()
        this.input.consumeJump()
        if (this.netMode === 'solo') {
          // solo pause freezes the whole world
          this.renderer.render(this.scene, this.camera)
          return
        }
      } else {
        this.player.update(dt, this.input, this.arena.playerColliders)
      }
      // the horde has mass — you can't wade through it
      const bodies =
        this.netMode === 'client'
          ? this.remoteZombies.targets().map((t) => t.position)
          : this.horde.zombies.filter((z) => z.alive).map((z) => z.group.position)
      this.player.collideWithBodies(bodies, 0.38, this.arena.playerColliders)
      this.player.applyCamera(this.camera)

      // shooting (disabled while downed or in the menu)
      if (!this.player.downed && !this.paused) {
        const zombieTargets =
          this.netMode === 'client' ? this.remoteZombies.targets() : this.horde.targets()
        const targets = [...this.arena.colliderMeshes, ...zombieTargets]
        const hits = this.weapon.update(dt, this.input, this.camera, targets, this.effects)
        if (this.weapon.events.fired) audio.gunshot(this.weapon.def.id)
        if (this.weapon.events.dryFired) audio.dryFire()
        if (this.weapon.events.reloadStarted) audio.reload()
        for (const hit of hits) {
          if (!hit.object) continue
          if (this.netMode === 'client') {
            const target = this.remoteZombies.idFor(hit.object)
            if (!target) continue
            this.effects.impact(hit.point.clone(), 'blood')
            const origin = this.camera.getWorldPosition(new THREE.Vector3())
            this.net?.sendShot({
              zid: target.id,
              head: target.head ? 1 : 0,
              wid: this.weapon.def.id,
              from: [origin.x, origin.y, origin.z],
              to: [hit.point.x, hit.point.y, hit.point.z],
            })
          } else {
            const zombie = this.horde.zombieFor(hit.object)
            if (!zombie) continue
            this.effects.impact(hit.point.clone(), 'blood')
            const headshot = zombie.isHeadPart(hit.object)
            const dmg =
              this.weapon.def.damage * (headshot ? this.weapon.def.headshotMult : 1)
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
        }
        this.handleShopping()
      } else {
        this.hud.setPrompt(null)
      }
      this.economy.update(dt)

      // simulation: host & solo run the horde; clients interpolate
      if (this.netMode === 'client') {
        this.remoteZombies.update(dt)
      } else {
        const targetInfos: TargetInfo[] = []
        if (!this.player.downed && this.player.hp > 0)
          targetInfos.push({ id: 'self', pos: this.player.pos })
        for (const [id, avatar] of this.remotePlayers) {
          if (!avatar.down && avatar.hp > 0) targetInfos.push({ id, pos: avatar.pos })
        }
        // nobody left standing? zombies idle on the last known spot
        if (targetInfos.length === 0)
          targetInfos.push({ id: 'nobody', pos: this.player.pos })
        const damage = this.horde.update(dt, targetInfos, this.zombieNav())
        if (damage['self']) {
          this.player.takeDamage(damage['self'])
          audio.playerHurt()
        }
        for (const [id, dmg] of Object.entries(damage)) {
          if (id !== 'self' && id !== 'nobody') this.net?.sendAttack(dmg, id)
        }
        this.waves.update(dt)
      }

      for (const avatar of this.remotePlayers.values()) avatar.update(dt)
      this.updateGroans(dt)
      this.netSend()
      this.handleZeroHp()

      this.hud.setAmmo(this.weapon.mag, this.weapon.reserve, this.weapon.reloading)
      this.hud.setWeaponName(this.weapon.def.name)
      this.hud.setHealth(this.player.hp, this.player.maxHp, this.player.recentlyHit)
    } else {
      // dead: keep rendering; host keeps simulating so spectators see the end
      if (this.netMode !== 'client') {
        this.horde.update(dt, [{ id: 'nobody', pos: this.player.pos }], this.zombieNav())
      } else {
        this.remoteZombies.update(dt)
      }
      for (const avatar of this.remotePlayers.values()) avatar.update(dt)
    }

    this.effects.update(dt)
    this.renderer.render(this.scene, this.camera)
  }
}
