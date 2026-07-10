import * as THREE from 'three'
import { buildArena, type Arena, type Collider, FLASHLIGHT_POS, NVG_POS } from './arena'
import { Player } from './player'
import { Input } from './input'
import { WeaponSystem, weaponKind } from './weapons'
import { Effects } from './effects'
import { Horde, WaveSystem, type WavePhase } from './waves'
import { Economy, POINTS } from './economy'
import { MysteryBox, BOX_COST } from './mysterybox'
import { RemotePlayer, RemoteZombieField } from './remote'
import {
  NetRoom,
  selfId,
  type GameState,
  type PlayerState,
  type ShotFxMsg,
  type MidgetLatch,
  type GrabInfo,
} from '../net/room'
import { Lobby, shortName } from '../net/lobby'
import type { TargetInfo, Zombie } from './zombie'
import {
  ZUGGERNAUT_STUN_TIME,
  ZUGGERNAUT_THROW_MIN_DIST,
  ZUGGERNAUT_THROW_MAX_DIST,
  ZUGGERNAUT_HEAD_HEIGHT,
  ZUGGERNAUT_HOLD_FORWARD_OFFSET,
} from './zombie'
import { audio } from '../audio/audio'
import { Hud } from '../ui/hud'
import { PauseMenu } from '../ui/pause'

type Mode = 'menu' | 'playing' | 'dead'
type NetMode = 'solo' | 'host' | 'client'

const NET_RATE = 1 / 12 // send rate for state/input
const REVIVE_RANGE = 2.4
const MELEE_RANGE = 2.4
const MELEE_DAMAGE = 25
const MELEE_PUSH = 2.0
const MELEE_COOLDOWN = 0.7
const BASE_FOV = 72

export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.08, 200)
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
  private clientPhase: WavePhase = 'active'
  private lobby: Lobby | null = null
  private pause = new PauseMenu()
  private paused = false
  private migrating = false
  private migrationWatchdog: ReturnType<typeof setTimeout> | null = null
  private wasDowned = false
  private downNotified = new Set<string>()
  private mysteryBox!: MysteryBox
  private clawCollider: Collider = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, height: 2.4 }
  private meleeCooldown = 0

  // --- The Lab: light sources & darkness ---
  private ownsFlashlight = false
  private ownsNVG = false
  private lightMode: 'off' | 'flashlight' | 'nvg' = 'off'
  private flashlight!: THREE.SpotLight
  private nvgLight!: THREE.AmbientLight
  private baseAmbient = 0
  private baseHemi = 0
  private baseMoon = 0
  private jailFog!: THREE.FogExp2
  private labFog = new THREE.FogExp2(0x01040a, 0.045)
  private inLab = false

  // --- midget zombie latch state ---
  private lastPlayerPos = new THREE.Vector3()
  private lastAvatarPos = new Map<string, THREE.Vector3>()
  private myLatchZombie: Zombie | null = null // solo/host: the real Zombie object latched onto me
  private myLatchClientZid: number | null = null // client: id of the zombie latched onto me (via wire)
  private wasLatched = false

  // --- zuggernaut grab state ---
  private myGrabZombie: Zombie | null = null // solo/host: the real Zombie object holding me
  private myGrabClientZid: number | null = null // client: id of the zombie holding me (via wire)
  private wasGrabbed = false
  // remembers the most recent grabber past the moment of release, so the throw
  // knows which direction to launch the player in
  private lastGrabZombie: Zombie | null = null
  private lastGrabClientZid: number | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.arena = buildArena(this.scene)
    this.scene.add(this.camera) // so viewmodel (camera child) renders
    this.player.attachBody(this.scene) // first-person legs, visible looking down
    // dim carry-light so the viewmodel and nearby ground stay readable
    const carryLight = new THREE.PointLight(0x99aa88, 3.5, 7, 1.5)
    carryLight.position.set(0, 0.2, -0.3)
    this.camera.add(carryLight)

    // remember normal-light levels so we can plunge The Lab into darkness and restore
    this.baseAmbient = this.arena.ambient.intensity
    this.baseHemi = this.arena.hemi.intensity
    this.baseMoon = this.arena.moon.intensity
    this.jailFog = this.scene.fog as THREE.FogExp2

    // flashlight: a tight cone bolted to the camera, off until you buy + toggle it
    this.flashlight = new THREE.SpotLight(0xfff2d0, 0, 26, 0.62, 0.45, 1.2)
    this.flashlight.position.set(0, 0, 0.2)
    this.flashlight.target.position.set(0, 0, -1)
    this.camera.add(this.flashlight)
    this.camera.add(this.flashlight.target)

    // night vision: a flat green wash over everything, off until bought + toggled
    this.nvgLight = new THREE.AmbientLight(0x1cff5a, 0)
    this.scene.add(this.nvgLight)
    this.input = new Input(canvas)
    this.effects = new Effects(this.scene)
    this.weapon = new WeaponSystem(this.camera)
    this.economy.buildStations(this.scene)
    this.mysteryBox = new MysteryBox(this.scene, {
      tick: () => audio.boxTick(),
      reveal: () => audio.boxReveal(),
    })
    // the cabinet is solid — no walking through it — and the collider tags
    // along wherever the box relocates to
    this.updateClawCollider(this.mysteryBox.pos.x, this.mysteryBox.pos.z)
    this.arena.playerColliders.push(this.clawCollider)
    this.arena.zombieColliders.push(this.clawCollider)
    this.hud = new Hud(this.input.isTouch)
    this.horde = new Horde(this.scene)
    this.remoteZombies = new RemoteZombieField(this.scene)
    this.waves = new WaveSystem(this.horde, () => this.arena.activeSpawns(), {
      onWaveStart: (w) => {
        this.hud.setWave(w)
        this.hud.banner(`WAVE ${w}`)
        audio.waveStinger()
        audio.setIntensity(Math.min(0.15 + w * 0.08, 1))
        this.maybeRelocateMysteryBox()
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
    // Esc in pointer lock releases the lock — treat that as "open the menu".
    // Some browsers/OSes also silently release pointer lock while a modifier
    // key (Ctrl, used for crouch) is held — that's not the player asking to
    // pause, so if Ctrl is still down when the lock drops, just re-lock
    // instead of popping the pause screen.
    document.addEventListener('pointerlockchange', () => {
      if (
        !document.pointerLockElement &&
        this.mode === 'playing' &&
        !this.input.isTouch &&
        !this.paused
      ) {
        if (this.input.isDown('ControlLeft') || this.input.isDown('ControlRight')) {
          this.input.requestLock()
          return
        }
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
    this.waves.setPlayerCount(1)
    this.beginPlaying()
    this.waves.begin()
  }

  startHost(code: string) {
    this.netMode = 'host'
    this.net = new NetRoom(code)
    this.bindCommonNet()
    this.bindHostNet()
    this.waves.setPlayerCount(1)
    this.hud.setRoomInfo(`CODE: ${code}`)
    this.beginPlaying()
    this.waves.begin()
    this.announceToLobby(code)
  }

  /** Host-side message handlers — bound at game start, and again on host migration. */
  private bindHostNet() {
    if (!this.net) return
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
      const killed = z.applyBulletDamage(dmg, shot.head === 1)
      if (killed) this.waves.registerKill(z, shot.head === 1)
      this.net!.sendScore(
        { amt: POINTS.hit + (killed ? (shot.head ? POINTS.headshotKill : POINTS.kill) : 0), kill: killed ? 1 : 0, head: shot.head },
        from,
      )
    })
    this.net.onMelee((msg, from) => {
      let amt = 0
      let anyKill = false
      for (const id of msg.ids) {
        const z = this.horde.zombies.find((x) => x.id === id && x.alive)
        if (!z) continue
        // sanity check against latency/spoofing — same trust model as onShot, just bounded
        const dist = Math.hypot(z.group.position.x - msg.px, z.group.position.z - msg.pz)
        if (dist > MELEE_RANGE + 2) continue
        const dx = z.group.position.x - msg.px
        const dz = z.group.position.z - msg.pz
        const d = Math.hypot(dx, dz) || 1
        const killed = z.meleeHit(MELEE_DAMAGE, dx / d, dz / d, MELEE_PUSH, this.arena.zombieColliders)
        amt += POINTS.hit
        if (killed) {
          this.waves.registerKill(z, false)
          amt += POINTS.kill
          anyKill = true
        }
      }
      if (amt > 0) this.net!.sendScore({ amt, kill: anyKill ? 1 : 0, head: 0 }, from)
    })
    this.net.onPry((msg) => {
      const z = this.horde.zombies.find((x) => x.id === msg.zid)
      z?.registerPry()
    })
  }

  private announceToLobby(code: string) {
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
      if (this.migrating) {
        this.migrating = false
        if (this.migrationWatchdog) {
          clearTimeout(this.migrationWatchdog)
          this.migrationWatchdog = null
        }
        this.hud.banner('NEW HOST CONNECTED', 1800)
      }
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
    this.net.onFx((fx) => this.renderRemoteFx(fx))
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
      if (this.netMode !== 'client') this.waves.setPlayerCount((this.net?.peers().length ?? 0) + 1)
    })
    this.net.onPeerLeave((id) => {
      const avatar = this.remotePlayers.get(id)
      if (avatar) this.scene.remove(avatar.group)
      this.remotePlayers.delete(id)
      this.peerStates.delete(id)
      this.lastAvatarPos.delete(id)
      this.updateRoomCount()
      if (this.netMode !== 'client') this.waves.setPlayerCount((this.net?.peers().length ?? 0) + 1)
      if (this.netMode === 'client' && id === this.hostId) {
        this.beginHostMigration()
      } else {
        this.hud.banner('SURVIVOR LEFT', 1800)
      }
    })
  }

  // ------------------------------ host migration ------------------------------

  /** The host disconnected — freeze, elect a successor, and hand off without ending the game. */
  private beginHostMigration() {
    if (this.migrating) return
    this.migrating = true
    this.hud.banner('HOST LEFT — MIGRATING…', 12000)
    audio.deny()
    // give the WebRTC mesh a moment to settle so every survivor sees the same peer set
    setTimeout(() => this.resolveMigration(), 900)
  }

  private resolveMigration() {
    if (!this.net || this.netMode !== 'client') return
    // deterministic election: every survivor computes the same sorted list independently
    const survivors = [selfId, ...this.net.peers()].sort()
    const newHostId = survivors[0]
    if (newHostId === selfId) {
      this.promoteToHost()
      return
    }
    // someone else is taking over — wait for their first state broadcast to arrive
    // (onState already clears `migrating` the moment any state message shows up)
    this.migrationWatchdog = setTimeout(() => {
      if (this.migrating) {
        this.hud.banner('CONNECTION LOST — GAME ENDED', 4000)
        setTimeout(() => location.reload(), 3200)
      }
    }, 8000)
  }

  private promoteToHost() {
    this.netMode = 'host'
    this.hostId = null
    this.bindHostNet()

    // rebuild the horde from the last positions we saw as a client
    this.horde.reset()
    const wave = Math.max(this.clientWave, 1)
    this.waves.setPlayerCount((this.net?.peers().length ?? 0) + 1)
    for (const z of this.remoteZombies.snapshot()) {
      if (z.dying) continue // don't resurrect a zombie mid-death animation
      const hp =
        z.juggernaut || z.zuggernaut
          ? this.waves.zombieHp(wave) * 5
          : z.midget
            ? Math.round(this.waves.zombieHp(wave) / 2)
            : this.waves.zombieHp(wave)
      this.horde.spawn(
        new THREE.Vector3(z.x, 0, z.z),
        hp,
        z.runner,
        z.midget,
        wave,
        z.luminescent,
        z.juggernaut,
        z.zuggernaut,
      )
    }
    this.remoteZombies.clear()
    this.waves.resumeAt(this.clientWave, this.clientPhase)

    this.hud.setRoomInfo(`CODE: ${this.net!.code}`)
    this.hud.banner('YOU ARE NOW HOST', 2400)
    this.announceToLobby(this.net!.code)
    this.migrating = false
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
    this.lastPlayerPos.copy(this.player.pos)
    this.input.requestLock()
    this.input.showTouchControls()
    audio.unlock()
    audio.startMusic()
    audio.startClawTune()
    audio.setIntensity(0.1)
  }

  private weaponDefs() {
    // avoids importing WEAPONS at use sites; single source in weapons.ts
    return this.weapon.allDefs()
  }

  /** Smoothly zooms the camera FOV for ADS, and shows the scope overlay for true-magnification optics. */
  private updateAimZoom(dt: number) {
    const ads = this.weapon.def.ads
    const targetFov = this.weapon.aiming && ads ? BASE_FOV * ads.zoom : BASE_FOV
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10)
    this.camera.updateProjectionMatrix()
    this.hud.setScopeOverlay(this.weapon.aiming && !!ads?.scope)
    // red-dot weapons: hide the green crosshair once the sight has risen into
    // view — the dot itself is the aim point from there
    this.hud.setAdsCrosshairHidden(
      this.weapon.aiming && !!ads && !ads.scope && this.weapon.aimAmount > 0.5,
    )
  }

  private zombieNav() {
    return {
      colliders: this.arena.zombieColliders,
      nextWaypoint: (p: THREE.Vector3, t: THREE.Vector3) => this.arena.nextWaypoint(p, t),
      inOpeningZone: (p: THREE.Vector3) => this.arena.inOpeningZone(p),
    }
  }

  /** Darkness/vision for the local player only — swaps to pitch black inside The Lab. */
  private updateVision() {
    const nowInLab = this.arena.isLab(this.player.pos.x, this.player.pos.z)
    if (nowInLab !== this.inLab) {
      this.inLab = nowInLab
      this.scene.fog = nowInLab ? this.labFog : this.jailFog
      if (nowInLab) {
        // pitch black — only bioluminescence + your own light source show anything
        this.arena.ambient.intensity = 0.015
        this.arena.hemi.intensity = 0.0
        this.arena.moon.intensity = 0.0
      } else {
        this.arena.ambient.intensity = this.baseAmbient
        this.arena.hemi.intensity = this.baseHemi
        this.arena.moon.intensity = this.baseMoon
      }
    }
    // light sources only do anything in the dark
    const flashOn = nowInLab && this.lightMode === 'flashlight'
    const nvgOn = nowInLab && this.lightMode === 'nvg'
    this.flashlight.intensity = flashOn ? 6 : 0
    this.nvgLight.intensity = nvgOn ? 2.2 : 0
    this.hud.setLightStatus(nowInLab, this.lightMode, this.ownsFlashlight, this.ownsNVG)
  }

  /** T cycles: off → owned flashlight → owned NVG → off. */
  private cycleLight() {
    const modes: Array<'off' | 'flashlight' | 'nvg'> = ['off']
    if (this.ownsFlashlight) modes.push('flashlight')
    if (this.ownsNVG) modes.push('nvg')
    if (modes.length === 1) {
      this.hud.banner('NO LIGHT SOURCE — BUY ONE IN THE LAB', 2000)
      return
    }
    const idx = modes.indexOf(this.lightMode)
    this.lightMode = modes[(idx + 1) % modes.length]
    audio.purchase()
  }

  /** Flashlight (20k) & Night-Vision Goggles (40k) at the bottom of the lab stairs. Returns true if it owned the prompt. */
  private handleLightBuys(): boolean {
    const near = (p: THREE.Vector3) => Math.hypot(this.player.pos.x - p.x, this.player.pos.z - p.z) < 2.8
    const key = this.input.isTouch ? 'USE' : '[E]'
    if (near(FLASHLIGHT_POS)) {
      this.hud.setPrompt(this.ownsFlashlight ? 'FLASHLIGHT — OWNED (T to toggle)' : `${key} FLASHLIGHT — 20000`)
      if (this.input.consumeInteract() && !this.ownsFlashlight) {
        if (this.economy.spend(20000)) {
          this.ownsFlashlight = true
          this.lightMode = 'flashlight'
          this.hud.setPoints(this.economy.points)
          this.hud.pointsDelta(-20000)
          this.hud.banner('FLASHLIGHT ACQUIRED — T TO TOGGLE', 2600)
          audio.purchase()
        } else {
          this.hud.banner('NOT ENOUGH POINTS', 1200)
          audio.deny()
        }
      }
      return true
    }
    if (near(NVG_POS)) {
      this.hud.setPrompt(this.ownsNVG ? 'NIGHT VISION — OWNED (T to toggle)' : `${key} NIGHT VISION GOGGLES — 40000`)
      if (this.input.consumeInteract() && !this.ownsNVG) {
        if (this.economy.spend(40000)) {
          this.ownsNVG = true
          this.lightMode = 'nvg'
          this.hud.setPoints(this.economy.points)
          this.hud.pointsDelta(-40000)
          this.hud.banner('NIGHT VISION ACQUIRED — T TO TOGGLE', 2600)
          audio.purchase()
        } else {
          this.hud.banner('NOT ENOUGH POINTS', 1200)
          audio.deny()
        }
      }
      return true
    }
    return false
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
        this.maybeRelocateMysteryBox()
      }
    }
    this.clientPhase = s.ph === 'intermission' ? 'intermission' : 'active'
    for (const id of s.d ?? []) {
      if (!this.arena.doors[id]?.open) this.openDoorEverywhere(id, false)
    }
    this.remoteZombies.applyState(s.z)
    const myLatch = (s.mg ?? []).find(([, targetId]) => targetId === selfId)
    this.myLatchClientZid = myLatch ? myLatch[0] : null
    const myGrab = (s.gr ?? []).find(([, targetId]) => targetId === selfId)
    this.myGrabClientZid = myGrab ? myGrab[0] : null
    for (const [pid, ps] of Object.entries(s.p)) {
      if (pid === selfId) continue
      // host relays every player's state (including its own under hostId)
      this.ensureAvatar(pid === 'host' ? hostId : pid).applyState(ps)
    }
  }

  // ------------------------------ remote shot fx ------------------------------

  /** Render another player's tracers/impacts so everyone can see where teammates are shooting. */
  private renderRemoteFx(fx: ShotFxMsg) {
    const muzzle = new THREE.Vector3(...fx.muzzle)
    audio.gunshot(weaponKind(fx.wid))
    this.effects.muzzleFlash(muzzle)
    for (const [x, y, z, hit] of fx.pts) {
      const point = new THREE.Vector3(x, y, z)
      this.effects.tracer(muzzle, point)
      if (hit) this.effects.impact(point, this.isNearAnyZombie(point, 0.5) ? 'blood' : 'spark')
    }
  }

  private isNearAnyZombie(point: THREE.Vector3, maxDist: number): boolean {
    const positions =
      this.netMode === 'client'
        ? this.remoteZombies.targets().map((o) => o.position)
        : this.horde.zombies.filter((z) => z.alive).map((z) => z.group.position)
    for (const p of positions) if (point.distanceTo(p) < maxDist) return true
    return false
  }

  /** Punch forward: light damage + a shove, clearing space rather than farming kills. */
  private handleMelee() {
    if (!this.input.consumeMelee()) return
    if (this.player.downed || this.meleeCooldown > 0) return
    this.meleeCooldown = MELEE_COOLDOWN
    this.weapon.triggerMelee()
    audio.melee()
    const fwdX = -Math.sin(this.player.yaw)
    const fwdZ = -Math.cos(this.player.yaw)
    if (this.netMode === 'client') {
      const ids = this.remoteZombies.meleeCandidates(
        this.player.pos.x,
        this.player.pos.z,
        fwdX,
        fwdZ,
        MELEE_RANGE,
      )
      if (ids.length > 0) {
        this.net?.sendMelee({ ids, px: this.player.pos.x, pz: this.player.pos.z, dx: fwdX, dz: fwdZ })
      }
    } else {
      const results = this.horde.meleeSweep(
        this.player.pos.x,
        this.player.pos.z,
        fwdX,
        fwdZ,
        MELEE_RANGE,
        MELEE_DAMAGE,
        MELEE_PUSH,
        this.zombieNav(),
      )
      for (const r of results) {
        this.earn(POINTS.hit)
        if (r.killed) {
          this.waves.registerKill(r.zombie, false)
          this.earn(POINTS.kill)
          this.hud.hitmarker('kill')
        } else {
          this.hud.hitmarker('hit')
        }
      }
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

  /** Bannered alert + live screen-space REVIVE markers for downed teammates. */
  private watchTeammates() {
    if (this.netMode === 'solo') return
    const markers: Array<{ id: string; sx: number; sy: number; dist: number }> = []
    for (const [id, avatar] of this.remotePlayers) {
      if (!avatar.down) {
        this.downNotified.delete(id)
        continue
      }
      if (!this.downNotified.has(id)) {
        this.downNotified.add(id)
        this.hud.banner('SURVIVOR DOWN — REVIVE THEM!', 2800)
        audio.playerHurt()
      }
      const v = avatar.pos.clone()
      v.y += 1.5
      v.project(this.camera)
      let sx = ((v.x + 1) / 2) * 100
      let sy = ((1 - v.y) / 2) * 100
      if (v.z > 1) {
        // behind the camera — pin to the closest screen edge (projection flips)
        sx = v.x > 0 ? 6 : 94
        sy = 50
      }
      markers.push({
        id,
        sx: Math.min(94, Math.max(6, sx)),
        sy: Math.min(90, Math.max(8, sy)),
        dist: Math.round(this.player.pos.distanceTo(avatar.pos)),
      })
    }
    this.hud.updateReviveMarkers(markers)
  }

  /** The Mystery Box interaction. Returns true if it owned the prompt. */
  private handleMysteryBox(): boolean {
    if (!this.mysteryBox.near(this.player.pos)) return false
    const key = this.input.isTouch ? 'USE' : '[E]'
    this.hud.setPrompt(this.mysteryBox.prompt(key))
    if (!this.input.consumeInteract()) return true
    if (this.mysteryBox.state === 'idle') {
      if (this.economy.spend(BOX_COST)) {
        this.hud.setPoints(this.economy.points)
        this.hud.pointsDelta(-BOX_COST)
        this.mysteryBox.play((id) => this.weapon.owns(id))
        audio.purchase()
      } else {
        this.hud.banner('NOT ENOUGH POINTS', 1200)
        audio.deny()
      }
    } else if (this.mysteryBox.state === 'ready') {
      const def = this.mysteryBox.take()
      if (def) {
        this.weapon.give(def)
        this.hud.banner(`IT'S A ${def.name}!`, 2400)
        audio.purchase()
      }
    }
    return true
  }

  private updateClawCollider(x: number, z: number) {
    const HALF_X = 1.0
    const HALF_Z = 0.85
    this.clawCollider.minX = x - HALF_X
    this.clawCollider.maxX = x + HALF_X
    this.clawCollider.minZ = z - HALF_Z
    this.clawCollider.maxZ = z + HALF_Z
  }

  /** 5–10% chance per wave the claw machine teleports to a random spot anywhere
   *  on the map — including rooms whose doors are still locked — so its locator
   *  jingle (see updateClawTune) is the only way to track it down between rounds. */
  private maybeRelocateMysteryBox() {
    if (this.mysteryBox.state !== 'idle') return
    if (Math.random() >= 0.05 + Math.random() * 0.05) return
    const HALF_X = 1.0
    const HALF_Z = 0.85
    const MARGIN = 3
    for (let i = 0; i < 40; i++) {
      const room = this.arena.rooms[Math.floor(Math.random() * this.arena.rooms.length)]
      const w = room.maxX - room.minX
      const d = room.maxZ - room.minZ
      if (w < MARGIN * 2 + HALF_X * 2 || d < MARGIN * 2 + HALF_Z * 2) continue
      const x = room.minX + MARGIN + Math.random() * (w - MARGIN * 2)
      const z = room.minZ + MARGIN + Math.random() * (d - MARGIN * 2)
      const blocked = this.arena.playerColliders.some(
        (c) =>
          c !== this.clawCollider &&
          x + HALF_X > c.minX &&
          x - HALF_X < c.maxX &&
          z + HALF_Z > c.minZ &&
          z - HALF_Z < c.maxZ,
      )
      if (blocked) continue
      this.mysteryBox.moveTo(x, z)
      this.updateClawCollider(x, z)
      this.hud.banner('THE CLAW MACHINE HAS MOVED…', 2600)
      return
    }
  }

  /** Fades the claw machine's locator jingle in as the player closes in on it. */
  private updateClawTune() {
    const dist = Math.hypot(
      this.player.pos.x - this.mysteryBox.pos.x,
      this.player.pos.z - this.mysteryBox.pos.z,
    )
    const NEAR = 4
    const FAR = 32
    const proximity = 1 - THREE.MathUtils.clamp((dist - NEAR) / (FAR - NEAR), 0, 1)
    audio.setClawTuneVolume(proximity * proximity) // ease-in — stays faint until fairly close
  }

  private handleShopping() {
    if (this.handleRevive()) return
    if (this.handleLightBuys()) return
    if (this.handleDoors()) return
    if (this.handleMysteryBox()) return
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
      this.player.crouched ? 1 : 0,
    ]
    if (this.netMode === 'client') {
      this.net.sendInput(self)
      return
    }
    // host: broadcast the world
    const latches: MidgetLatch[] = []
    const grabs: GrabInfo[] = []
    for (const z of this.horde.zombies) {
      if (z.isMidget && z.midgetPhase === 'latched' && z.latchedTargetId) {
        // 'self' means the host's own player — translate to the host's real peer id
        // so remote clients (who only know peer ids) can recognize their own target
        latches.push([z.id, z.latchedTargetId === 'self' ? selfId : z.latchedTargetId])
      }
      if (z.isZuggernaut && z.zuggernautPhase === 'grabbing' && z.grabTargetId) {
        grabs.push([z.id, z.grabTargetId === 'self' ? selfId : z.grabTargetId])
      }
    }
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
          z.state === 'dying' ? 2 : z.state === 'resurrecting' ? 3 : z.state === 'attacking' ? 1 : 0,
          z.runner ? 1 : 0,
          z.isMidget ? 1 : 0,
          z.luminescent ? 1 : 0,
          z.isJuggernaut ? 1 : 0,
          z.isZuggernaut ? 1 : 0,
        ]),
      p: { ...Object.fromEntries(this.peerStates), host: self },
      d: this.arena.openDoorIds(),
      mg: latches,
      gr: grabs,
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
      if (this.migrating) {
        // world-wide freeze while a successor host is elected and takes over
        this.renderer.render(this.scene, this.camera)
        return
      }
      // find whether a Midget Zombie is latched onto ME specifically (host/solo: real
      // object; client: learned from the host's broadcast) — blocks fire/shop, halves
      // movement speed, and excludes it from body-pushback (it's riding us, not colliding)
      if (this.netMode === 'client') {
        this.myLatchZombie = null
      } else {
        this.myLatchZombie =
          this.horde.zombies.find(
            (z) => z.isMidget && z.midgetPhase === 'latched' && z.latchedTargetId === 'self',
          ) ?? null
      }
      const isLatched = this.myLatchZombie !== null || this.myLatchClientZid !== null
      this.hud.setMidgetOverlay(isLatched)
      if (isLatched && !this.wasLatched) audio.midgetLatch()
      this.wasLatched = isLatched

      // same idea for a Zuggernaut currently holding ME — position gets pinned to it
      // below, but unlike a midget latch, shooting still works while grabbed
      if (this.netMode === 'client') {
        this.myGrabZombie = null
      } else {
        this.myGrabZombie =
          this.horde.zombies.find(
            (z) => z.isZuggernaut && z.zuggernautPhase === 'grabbing' && z.grabTargetId === 'self',
          ) ?? null
      }
      const isGrabbed = this.myGrabZombie !== null || this.myGrabClientZid !== null
      if (isGrabbed) {
        this.lastGrabZombie = this.myGrabZombie
        this.lastGrabClientZid = this.myGrabClientZid
      }
      if (isGrabbed && !this.wasGrabbed) audio.zuggernautGrab()
      if (!isGrabbed && this.wasGrabbed) {
        // thrown — launch 10-15ft in the direction the Zuggernaut was facing when it let go
        const ry =
          this.netMode === 'client'
            ? this.lastGrabClientZid !== null
              ? this.remoteZombies.rotationOf(this.lastGrabClientZid)
              : null
            : (this.lastGrabZombie?.group.rotation.y ?? null)
        if (ry !== null) {
          const dist =
            ZUGGERNAUT_THROW_MIN_DIST + Math.random() * (ZUGGERNAUT_THROW_MAX_DIST - ZUGGERNAUT_THROW_MIN_DIST)
          this.player.throwTo(Math.sin(ry), Math.cos(ry), dist, this.arena.playerColliders)
        }
        // the hold pins the player at head height — land them on the ground
        // immediately rather than leaving them floating through the stun
        this.player.pos.y = 0
        this.player.stunT = ZUGGERNAUT_STUN_TIME
        this.lastGrabZombie = null
        this.lastGrabClientZid = null
      }
      this.wasGrabbed = isGrabbed

      if (this.paused) {
        // discard buffered input so nothing fires or jerks on resume
        this.input.consumeLook()
        this.input.consumeFirePress()
        this.input.consumeReload()
        this.input.consumeInteract()
        this.input.consumeSwitch()
        this.input.consumeJump()
        this.input.consumeCrouch()
        this.input.consumeMelee()
        this.input.consumeLightToggle()
        if (this.netMode === 'solo') {
          // solo pause freezes the whole world
          this.arena.updateFlora(this.clock.getElapsedTime())
          this.renderer.render(this.scene, this.camera)
          return
        }
      } else {
        this.player.update(
          dt,
          this.input,
          this.arena.playerColliders,
          isLatched,
          isGrabbed,
          this.weapon.aiming,
        )
        if (this.input.consumeLightToggle()) this.cycleLight()
      }
      // pin a grabbed player's position to whatever's holding them, every frame,
      // same idea as a latched midget pinning itself to its host — held at head
      // height, out in front of its face rather than inside its head
      if (isGrabbed) {
        const holderPos =
          this.netMode === 'client'
            ? this.myGrabClientZid !== null
              ? this.remoteZombies.posOf(this.myGrabClientZid)
              : null
            : (this.myGrabZombie?.group.position ?? null)
        const holderRy =
          this.netMode === 'client'
            ? this.myGrabClientZid !== null
              ? this.remoteZombies.rotationOf(this.myGrabClientZid)
              : null
            : (this.myGrabZombie?.group.rotation.y ?? null)
        if (holderPos && holderRy !== null) {
          this.player.pos.set(
            holderPos.x + Math.sin(holderRy) * ZUGGERNAUT_HOLD_FORWARD_OFFSET,
            ZUGGERNAUT_HEAD_HEIGHT,
            holderPos.z + Math.cos(holderRy) * ZUGGERNAUT_HOLD_FORWARD_OFFSET,
          )
        } else if (holderPos) {
          this.player.pos.set(holderPos.x, ZUGGERNAUT_HEAD_HEIGHT, holderPos.z)
        }
      }
      // the horde has mass — you can't wade through it (except a zombie latched onto or grabbing us)
      const bodies =
        this.netMode === 'client'
          ? this.remoteZombies
              .targets(this.myLatchClientZid ?? undefined, this.myGrabClientZid ?? undefined)
              .map((t) => t.position)
          : this.horde.zombies
              .filter((z) => z.alive && z !== this.myLatchZombie && z !== this.myGrabZombie)
              .map((z) => z.group.position)
      this.player.collideWithBodies(bodies, 0.38, this.arena.playerColliders)
      this.player.applyCamera(this.camera)
      this.player.updateBody()
      this.updateVision()
      this.arena.updateFlora(this.clock.getElapsedTime())

      // downed players drop to their sidearm but keep fighting
      if (this.player.downed !== this.wasDowned) {
        this.wasDowned = this.player.downed
        if (this.player.downed) this.weapon.enterDowned()
        else this.weapon.exitDowned()
      }

      if (!this.paused && isLatched) {
        // both hands are busy prying it off — no shooting, no shopping, melee = pry
        this.hud.setPrompt(null)
        if (this.input.consumeMelee()) {
          audio.melee()
          if (this.netMode === 'client') {
            if (this.myLatchClientZid !== null) this.net?.sendPry({ zid: this.myLatchClientZid })
          } else if (this.myLatchZombie?.registerPry()) {
            audio.purchase() // distinct "thrown off" cue
          }
        }
      } else if (!this.paused) {
        const zombieTargets =
          this.netMode === 'client' ? this.remoteZombies.targets() : this.horde.targets()
        const targets = [...this.arena.colliderMeshes, ...zombieTargets]
        const hits = this.weapon.update(dt, this.input, this.camera, targets, this.effects)
        this.updateAimZoom(dt)
        if (this.weapon.events.fired) audio.gunshot(weaponKind(this.weapon.def.id))
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
            if (zombie.applyBulletDamage(dmg, headshot)) {
              this.waves.registerKill(zombie, headshot)
              this.earn(headshot ? POINTS.headshotKill : POINTS.kill)
              this.hud.hitmarker(headshot ? 'headshot' : 'kill')
            } else {
              this.hud.hitmarker('hit')
            }
          }
        }
        // let every peer see where teammates are shooting
        if (this.weapon.events.fired && this.netMode !== 'solo' && hits.length > 0) {
          this.net?.sendFx({
            wid: this.weapon.def.id,
            muzzle: [this.weapon.lastMuzzle.x, this.weapon.lastMuzzle.y, this.weapon.lastMuzzle.z],
            pts: hits.map((h) => [h.point.x, h.point.y, h.point.z, h.object ? 1 : 0]),
          })
        }
        this.meleeCooldown = Math.max(0, this.meleeCooldown - dt)
        if (isGrabbed) {
          // held aloft — arms are pinned, no melee/shopping, but still free to shoot
          this.hud.setPrompt(null)
        } else {
          this.handleMelee()
          if (!this.player.downed) this.handleShopping()
          else this.hud.setPrompt(null)
        }
        // an E press that hit nothing this frame is spent, not saved for whatever
        // you happen to walk up to next
        this.input.clearInteract()
      } else {
        this.hud.setPrompt(null)
      }
      this.economy.update(dt)
      this.mysteryBox.update(dt)
      this.updateClawTune()
      this.watchTeammates()

      // simulation: host & solo run the horde; clients interpolate
      if (this.netMode === 'client') {
        this.remoteZombies.update(dt)
      } else {
        // velocities are only ever sampled at the instant a midget jumps — safe to
        // recompute every frame from simple position deltas
        const selfVel =
          dt > 0
            ? {
                x: (this.player.pos.x - this.lastPlayerPos.x) / dt,
                z: (this.player.pos.z - this.lastPlayerPos.z) / dt,
              }
            : { x: 0, z: 0 }
        this.lastPlayerPos.copy(this.player.pos)

        const targetInfos: TargetInfo[] = []
        if (!this.player.downed && this.player.hp > 0)
          targetInfos.push({ id: 'self', pos: this.player.pos, vel: selfVel })
        for (const [id, avatar] of this.remotePlayers) {
          if (!avatar.down && avatar.hp > 0) {
            const last = this.lastAvatarPos.get(id) ?? avatar.pos.clone()
            const vel =
              dt > 0 ? { x: (avatar.pos.x - last.x) / dt, z: (avatar.pos.z - last.z) / dt } : { x: 0, z: 0 }
            this.lastAvatarPos.set(id, avatar.pos.clone())
            targetInfos.push({ id, pos: avatar.pos, vel })
          }
        }
        // nobody left standing? zombies idle on the last known spot
        if (targetInfos.length === 0)
          targetInfos.push({ id: 'nobody', pos: this.player.pos })
        const damage = this.horde.update(dt, targetInfos, this.zombieNav())
        for (const z of this.horde.zombies) if (z.justJumped) audio.midgetScreech()
        for (const z of this.horde.zombies) if (z.justStartedCharge) audio.juggernautYell()
        for (const z of this.horde.zombies) {
          if (!z.justStartedResurrect) continue
          audio.zuggernautRoar()
          const at = z.group.position
          for (let i = 0; i < 10; i++) {
            this.effects.impact(
              new THREE.Vector3(
                at.x + (Math.random() - 0.5) * 1.2,
                0.2 + Math.random() * 0.6,
                at.z + (Math.random() - 0.5) * 1.2,
              ),
              'blood',
            )
          }
        }
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
      this.hud.setReloadProgress(this.weapon.reloadProgress)
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
