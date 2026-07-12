import * as THREE from 'three'
import type { Collider } from './arena'

/** Frees geometry/materials for a zombie mesh being replaced or thrown away. */
function disposeZombieMesh(g: THREE.Group) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose()
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
      else o.material.dispose()
    }
  })
}

const RADIUS = 0.38
const ATTACK_RANGE = 1.45
const ATTACK_WINDUP = 0.45
const ATTACK_COOLDOWN = 1.0
const ATTACK_DAMAGE = 14 // midgets (and the rare zuggernaut fallback attack) — unchanged
// Plain zombies: damage ramps from ATTACK_DAMAGE up each wave, reaching a flat
// two-hit kill (50 dmg) by wave 15 and staying there.
const PLAIN_ATTACK_DAMAGE_START = 14
const PLAIN_ATTACK_DAMAGE_CAP_WAVE = 15
const PLAIN_ATTACK_DAMAGE_CAP = 50

// Midget Zombie: tiny, fragile, always dies to a headshot — but leaps from
// medium range with a predicted (not tracking) trajectory and latches onto
// the target's head, blocking their view until pried off.
export const MIDGET_SCALE = 0.5
const MIDGET_JUMP_MIN_RANGE = 3.0
const MIDGET_JUMP_MAX_RANGE = 9.0
const MIDGET_JUMP_DURATION = 0.55
const MIDGET_JUMP_ARC = 1.3
const MIDGET_CONTACT_RADIUS = 1.15
const MIDGET_JUMP_COOLDOWN = 3.5
const MIDGET_LATCH_TICK = 0.5
const MIDGET_LATCH_DAMAGE = 6
const MIDGET_PRY_NEEDED = 2
const MIDGET_PRY_KNOCKBACK_DAMAGE = 15

// Juggernaut Zombie: a slow-moving brute — 5x wave HP, kills in two basic hits,
// and periodically winds up (an audible yell) before charging in a dead-straight
// line at high speed. Easy to outrun sideways, brutal if it catches you head-on.
export const JUGGERNAUT_SCALE = 1.7
const JUGGERNAUT_SPEED = 0.5 // ~1/4 of a normal zombie's average shamble speed
const JUGGERNAUT_ATTACK_DAMAGE = 50 // two basic hits kill a full-health player
const JUGGERNAUT_CHARGE_MIN_RANGE = 5
const JUGGERNAUT_CHARGE_MAX_RANGE = 15
const JUGGERNAUT_WINDUP_TIME = 1.1 // the "yell" telegraph — time to get clear
const JUGGERNAUT_CHARGE_SPEED = 9.5
const JUGGERNAUT_CHARGE_MAX_TIME = 2.2 // charge gives up if it hasn't hit anything by then
const JUGGERNAUT_CHARGE_DAMAGE = 60
const JUGGERNAUT_CHARGE_CONTACT_RADIUS = 1.1
const JUGGERNAUT_CHARGE_COOLDOWN = 5.5
const JUGGERNAUT_CHARGE_INSTAKILL_WAVE = 30 // charge contact is a guaranteed kill from here on
const JUGGERNAUT_CHARGE_INSTAKILL_DAMAGE = 9999

// Zuggernaut Zombie: a normal zombie has a chance to rise back up as one of these
// after it dies — a roar, a burst of blood, and it slowly stands up transformed.
// Taller than the Juggernaut, pulses red, runs at full runner speed (no charge),
// and instead grabs its target for a few seconds before throwing them — and can
// also grab a nearby ordinary zombie and hurl it at you from range.
export const ZUGGERNAUT_SCALE = 2.05 // taller than the Juggernaut's 1.7
const ZUGGERNAUT_EVOLVE_START_WAVE = 20 // no resurrections at all before this
const ZUGGERNAUT_EVOLVE_CHANCE_MIN = 0.02
const ZUGGERNAUT_EVOLVE_CHANCE_MAX = 0.05
export const ZUGGERNAUT_RESURRECT_TIME = 2.6 // lying in blood, then rising
const ZUGGERNAUT_GRAB_RANGE = 1.6
export const ZUGGERNAUT_GRAB_DURATION = 2.0
export const ZUGGERNAUT_THROW_DAMAGE = 75 // 3/4 of a full-health player's HP
export const ZUGGERNAUT_STUN_TIME = 1.0
/** How far (30-40ft) and where the grabbed player is held — matched by Game.ts. */
export const ZUGGERNAUT_THROW_MIN_DIST = 9.1 // ~30ft
export const ZUGGERNAUT_THROW_MAX_DIST = 12.2 // ~40ft
export const ZUGGERNAUT_HEAD_HEIGHT = 1.34 * ZUGGERNAUT_SCALE // matches the head mesh's local y
export const ZUGGERNAUT_HOLD_FORWARD_OFFSET = 0.6 // held out in front of its face, not inside its head
const ZUGGERNAUT_GRAB_COOLDOWN = 7.0
const ZUGGERNAUT_ZOMBIE_GRAB_RADIUS = 2.2 // how close a fodder zombie must be to get grabbed
const ZUGGERNAUT_ZOMBIE_THROW_MIN_RANGE = 4
const ZUGGERNAUT_ZOMBIE_THROW_MAX_RANGE = 16
const ZUGGERNAUT_ZOMBIE_THROW_DURATION = 0.6
const ZUGGERNAUT_ZOMBIE_THROW_DAMAGE = 22
const ZUGGERNAUT_ZOMBIE_THROW_CONTACT_RADIUS = 1.3
const ZUGGERNAUT_ZOMBIE_THROW_COOLDOWN = 4.5
const THROWN_PRONE_TIME = 1.6 // a thrown plain zombie lies here before rising
const THROWN_RISE_TIME = 0.7

export type ZombieState = 'chasing' | 'attacking' | 'dying' | 'resurrecting'
export type MidgetPhase = 'ground' | 'jumping' | 'latched'
export type JuggernautPhase = 'ground' | 'winding' | 'charging'
export type ZuggernautPhase = 'ground' | 'grabbing' | 'throwingZombie'

/** Mirrors WaveSystem.zombieHp() — Zombie has no reference to WaveSystem, so the
 *  wave-scaled HP formula is duplicated here for the evolve-into-Zuggernaut case. */
function zombieHpForWave(wave: number): number {
  return Math.round(60 * (1 + 0.17 * (wave - 1)))
}

/** Ramps a plain zombie's basic-attack damage up linearly from wave 1, reaching
 *  a flat two-hit kill (50) at wave 15 and staying there beyond it. */
function plainZombieAttackDamage(wave: number): number {
  if (wave >= PLAIN_ATTACK_DAMAGE_CAP_WAVE) return PLAIN_ATTACK_DAMAGE_CAP
  const step = (PLAIN_ATTACK_DAMAGE_CAP - PLAIN_ATTACK_DAMAGE_START) / (PLAIN_ATTACK_DAMAGE_CAP_WAVE - 1)
  return Math.round(PLAIN_ATTACK_DAMAGE_START + (wave - 1) * step)
}

/** No resurrections before wave 20, then a slow ramp from 2% up to a 5% cap. */
function zuggernautEvolveChance(wave: number): number {
  if (wave < ZUGGERNAUT_EVOLVE_START_WAVE) return 0
  return Math.min(
    ZUGGERNAUT_EVOLVE_CHANCE_MIN + (wave - ZUGGERNAUT_EVOLVE_START_WAVE) * 0.001,
    ZUGGERNAUT_EVOLVE_CHANCE_MAX,
  )
}

export interface TargetInfo {
  id: string
  pos: THREE.Vector3
  /** Current velocity — used only at the instant a midget jumps, never mid-flight. */
  vel?: { x: number; z: number }
}

export interface AttackResult {
  targetId: string
  damage: number
}

/** What a zombie needs to find its way: colliders it respects + waypoint routing. */
export interface ZombieNav {
  colliders: Collider[]
  nextWaypoint(pos: THREE.Vector3, target: THREE.Vector3, id: number): THREE.Vector3
  inOpeningZone(pos: THREE.Vector3): boolean
  /** The claw machine's position — a persistently-stuck zombie gets teleported near here
   *  if there's nowhere else to send it. */
  clawPos: THREE.Vector3
  /** Every currently-active spawn point — a zombie that hasn't moved in a
   *  while gets teleported to a random one of these instead. */
  spawns: THREE.Vector3[]
}

interface Parts {
  head: THREE.Mesh
  armL: THREE.Mesh
  armR: THREE.Mesh
  legL: THREE.Mesh
  legR: THREE.Mesh
  torso: THREE.Mesh
}

let nextId = 1

export class Zombie {
  id = nextId++
  group: THREE.Group
  hp: number
  maxHp: number
  speed: number
  runner: boolean
  isMidget: boolean
  isJuggernaut: boolean
  isZuggernaut: boolean
  luminescent: boolean
  state: ZombieState = 'chasing'
  dead = false // fully finished (despawn)

  // midget-only state
  midgetPhase: MidgetPhase = 'ground'
  latchedTargetId: string | null = null
  /** True for the one frame a jump launches — Game.ts checks this to trigger a sound. */
  justJumped = false

  // juggernaut-only state
  juggernautPhase: JuggernautPhase = 'ground'
  /** True for the one frame a windup starts — Game.ts checks this to trigger the yell. */
  justStartedCharge = false

  // zuggernaut-only state
  zuggernautPhase: ZuggernautPhase = 'ground'
  grabTargetId: string | null = null
  /** True for the one frame a normal zombie starts rising back up as a Zuggernaut. */
  justStartedResurrect = false

  private parts: Parts
  private animT = Math.random() * 10
  private attackT = 0
  private deathT = 0
  private scene: THREE.Scene
  private lastPos = new THREE.Vector3()
  private stuckT = 0 // seconds of near-zero net progress — escalates to a respawn-elsewhere teleport
  private hop = 0 // vault height, eased

  // midget jump/latch internals
  private jumpCooldown = 0.6 + Math.random() * 1.5 // don't jump the instant it spawns
  private jumpT = 0
  private jumpStartX = 0
  private jumpStartZ = 0
  private jumpTargetX = 0
  private jumpTargetZ = 0
  private latchDamageT = 0
  private pryCount = 0

  // juggernaut windup/charge internals
  private chargeCooldown = 1.5 + Math.random() * 1.5
  private windupT = 0
  private chargeT = 0
  private chargeDirX = 0
  private chargeDirZ = 0
  private chargeHitIds = new Set<string>() // don't double-hit the same target mid-charge

  // zuggernaut grab/throw internals
  private spawnWave = 1
  private grabCooldown = 0.5 + Math.random() * 1.5
  private grabT = 0
  private throwCooldown = 1 + Math.random() * 2
  private throwT = 0

  // "thrown" state — any plain zombie flung by a Zuggernaut lands prone, then
  // slowly stands back up on its own; it isn't killed by the throw
  private thrownPhase: 'none' | 'flying' | 'prone' | 'rising' = 'none'
  private thrownT = 0
  private thrownStartX = 0
  private thrownStartZ = 0
  private thrownTargetX = 0
  private thrownTargetZ = 0

  constructor(
    scene: THREE.Scene,
    pos: THREE.Vector3,
    hp: number,
    runner: boolean,
    isMidget = false,
    wave = 1,
    luminescent = false,
    isJuggernaut = false,
    isZuggernaut = false,
  ) {
    this.scene = scene
    this.hp = hp
    this.maxHp = hp
    this.runner = runner
    this.isMidget = isMidget
    this.isJuggernaut = isJuggernaut
    this.isZuggernaut = isZuggernaut
    this.luminescent = luminescent
    this.spawnWave = wave
    if (isZuggernaut) {
      // runs like a fast zombie — same formula as a runner
      this.speed = Math.min(3.6 + Math.max(0, wave - 5) * 0.12, 5.2) + Math.random() * 0.3
    } else if (isJuggernaut) {
      this.speed = JUGGERNAUT_SPEED
    } else if (isMidget) {
      this.speed = 2.4 + Math.random() * 0.5 // ground-scuttle speed between jumps
    } else if (runner) {
      // ramps in slowly after wave 5, hard-capped — never an unbeatable sprint
      this.speed = Math.min(3.6 + Math.max(0, wave - 5) * 0.12, 5.2) + Math.random() * 0.3
    } else {
      this.speed = 1.5 + Math.random() * 0.7
    }
    const { group, parts } = buildZombieMesh(runner, luminescent, isJuggernaut, isZuggernaut)
    this.group = group
    this.parts = parts
    if (isMidget) group.scale.setScalar(MIDGET_SCALE)
    if (isJuggernaut) group.scale.setScalar(JUGGERNAUT_SCALE)
    if (isZuggernaut) group.scale.setScalar(ZUGGERNAUT_SCALE)
    group.position.copy(pos)
    group.userData.zombie = this
    scene.add(group)
  }

  get alive(): boolean {
    return this.state !== 'dying' && this.state !== 'resurrecting'
  }

  /** True for plain zombies only — the only kind that can evolve or get thrown. */
  get isPlain(): boolean {
    return !this.isMidget && !this.isJuggernaut && !this.isZuggernaut
  }

  /** Apply damage; returns true if this hit killed it. A plain zombie has a chance
   *  to rise back up as a Zuggernaut instead of dying outright. */
  damage(amount: number): boolean {
    if (!this.alive) return false
    this.hp -= amount
    if (this.hp <= 0) {
      if (this.isPlain && Math.random() < zuggernautEvolveChance(this.spawnWave)) {
        this.state = 'resurrecting'
        this.deathT = 0
        this.justStartedResurrect = true
        return true
      }
      this.state = 'dying'
      this.deathT = 0
      if (this.midgetPhase === 'latched') this.detach()
      return true
    }
    return false
  }

  /** Bullet hits go through here so a midget headshot can be an automatic kill. */
  applyBulletDamage(amount: number, headshot: boolean): boolean {
    if (this.isMidget && headshot) return this.damage(this.hp + 1)
    return this.damage(amount)
  }

  /** Light damage + a shove along (dirX, dirZ) — crowd control more than a kill. */
  meleeHit(amount: number, dirX: number, dirZ: number, pushDist: number, colliders: Collider[]): boolean {
    const killed = this.damage(amount)
    if (killed) return true
    this.group.position.x += dirX * pushDist
    this.group.position.z += dirZ * pushDist
    this.resolve(colliders, 'x')
    this.resolve(colliders, 'z')
    // stagger: interrupt an attack windup so the shove actually buys space
    this.attackT = 0
    if (this.state === 'attacking') this.state = 'chasing'
    return false
  }

  /** A pry attempt against a latched midget. Returns true once it's thrown off. */
  registerPry(): boolean {
    if (this.midgetPhase !== 'latched') return false
    this.pryCount++
    if (this.pryCount >= MIDGET_PRY_NEEDED) {
      this.damage(MIDGET_PRY_KNOCKBACK_DAMAGE)
      if (this.alive) this.detach()
      return true
    }
    return false
  }

  private detach() {
    this.midgetPhase = 'ground'
    this.latchedTargetId = null
    this.pryCount = 0
    this.jumpCooldown = MIDGET_JUMP_COOLDOWN
    this.state = 'chasing'
  }

  /** Chases the nearest target; returns an attack that landed this frame, if any. */
  update(
    dt: number,
    targets: TargetInfo[],
    nav: ZombieNav,
    others: Zombie[],
  ): AttackResult | null {
    this.justJumped = false
    this.justStartedCharge = false
    this.justStartedResurrect = false
    if (this.state === 'dying') {
      this.deathT += dt
      // fall over, then sink
      this.group.rotation.x = -Math.min(1, this.deathT / 0.35) * (Math.PI / 2)
      if (this.deathT > 1.1) this.group.position.y -= dt * 0.9
      if (this.deathT > 2.0) {
        this.scene.remove(this.group)
        this.dead = true
      }
      return null
    }
    if (this.state === 'resurrecting') {
      this.deathT += dt
      const t = this.deathT / ZUGGERNAUT_RESURRECT_TIME
      // lying flat in the blood for the first half, then rising back up
      const lying = -Math.PI / 2
      this.group.rotation.x = t < 0.5 ? lying : lying * (1 - (t - 0.5) / 0.5)
      if (t >= 1) this.evolveIntoZuggernaut()
      return null
    }
    if (this.thrownPhase !== 'none') return this.updateThrown(dt, targets)

    this.animT += dt * (this.runner || this.isZuggernaut ? 2.4 : 1.0)
    if (this.isZuggernaut) {
      // slow pulsing red glow
      const mats = this.group.userData.pulseMats as THREE.MeshLambertMaterial[] | undefined
      if (mats) {
        const pulse = 0.55 + Math.sin(this.animT * 3.2) * 0.4
        for (const m of mats) m.emissiveIntensity = pulse
      }
    }
    const pos = this.group.position

    // nearest target
    let target: TargetInfo | null = null
    let dist = Infinity
    for (const t of targets) {
      const d = Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z)
      if (d < dist) {
        dist = d
        target = t
      }
    }

    if (this.isMidget) {
      if (this.midgetPhase === 'latched') return this.updateLatched(dt, targets)
      if (this.midgetPhase === 'jumping') return this.updateJumping(dt, targets)
    }
    if (this.isJuggernaut) {
      if (this.juggernautPhase === 'winding') return this.updateWinding(dt, target)
      if (this.juggernautPhase === 'charging') return this.updateCharging(dt, targets, nav)
    }
    if (this.isZuggernaut) {
      if (this.zuggernautPhase === 'grabbing') return this.updateGrabbing(dt)
      if (this.zuggernautPhase === 'throwingZombie') return this.updateThrowingZombie(dt)
    }

    if (!target) return null
    const dx = target.pos.x - pos.x
    const dz = target.pos.z - pos.z
    this.group.rotation.y = Math.atan2(dx, dz)

    if (
      this.isMidget &&
      this.jumpCooldown <= 0 &&
      dist >= MIDGET_JUMP_MIN_RANGE &&
      dist <= MIDGET_JUMP_MAX_RANGE
    ) {
      this.startJump(target)
      return null
    }
    if (this.isMidget) this.jumpCooldown = Math.max(0, this.jumpCooldown - dt)

    if (
      this.isJuggernaut &&
      this.chargeCooldown <= 0 &&
      dist >= JUGGERNAUT_CHARGE_MIN_RANGE &&
      dist <= JUGGERNAUT_CHARGE_MAX_RANGE
    ) {
      this.justStartedCharge = true
      this.juggernautPhase = 'winding'
      this.windupT = 0
      // direction locks in now — the charge itself never tracks the target
      const dlen = Math.hypot(dx, dz) || 1
      this.chargeDirX = dx / dlen
      this.chargeDirZ = dz / dlen
      this.state = 'attacking' // borrow this state so Horde/host treat it as "engaged"
      return null
    }
    if (this.isJuggernaut) this.chargeCooldown = Math.max(0, this.chargeCooldown - dt)

    if (
      this.isZuggernaut &&
      this.grabCooldown <= 0 &&
      dist <= ZUGGERNAUT_GRAB_RANGE &&
      // a target already in another Zuggernaut's grip can't be snatched away
      !others.some((o) => o !== this && o.isZuggernaut && o.zuggernautPhase === 'grabbing' && o.grabTargetId === target.id)
    ) {
      this.zuggernautPhase = 'grabbing'
      this.grabT = 0
      this.grabTargetId = target.id
      // facing at the moment of the grab is what the throw direction uses on release
      this.group.rotation.y = Math.atan2(dx, dz)
      this.state = 'attacking'
      return null
    }
    if (this.isZuggernaut) this.grabCooldown = Math.max(0, this.grabCooldown - dt)

    if (
      this.isZuggernaut &&
      this.throwCooldown <= 0 &&
      dist >= ZUGGERNAUT_ZOMBIE_THROW_MIN_RANGE &&
      dist <= ZUGGERNAUT_ZOMBIE_THROW_MAX_RANGE
    ) {
      const fodder = others.find(
        (o) =>
          o !== this &&
          o.alive &&
          o.isPlain &&
          Math.hypot(o.group.position.x - pos.x, o.group.position.z - pos.z) <= ZUGGERNAUT_ZOMBIE_GRAB_RADIUS,
      )
      if (fodder) {
        this.startThrowZombie(fodder, target)
        return null
      }
    }
    if (this.isZuggernaut) this.throwCooldown = Math.max(0, this.throwCooldown - dt)

    let dealt = 0
    if (dist < ATTACK_RANGE || this.state === 'attacking') {
      this.state = 'attacking'
      this.attackT += dt
      if (this.attackT >= ATTACK_WINDUP && this.attackT - dt < ATTACK_WINDUP) {
        if (dist < ATTACK_RANGE + 0.4) {
          dealt = this.isJuggernaut
            ? JUGGERNAUT_ATTACK_DAMAGE
            : this.isPlain
              ? plainZombieAttackDamage(this.spawnWave)
              : ATTACK_DAMAGE
        }
      }
      if (this.attackT >= ATTACK_COOLDOWN) {
        this.attackT = 0
        if (dist > ATTACK_RANGE) this.state = 'chasing'
      }
      // lunge animation
      const lunge = Math.sin(Math.min(this.attackT / ATTACK_WINDUP, 1) * Math.PI)
      this.parts.armL.rotation.x = -Math.PI / 2 - lunge * 0.5
      this.parts.armR.rotation.x = -Math.PI / 2 - lunge * 0.5
    } else {
      // route via openings/gates, then shamble with light flock separation
      const wp = nav.nextWaypoint(pos, target.pos, this.id)
      const wx = wp.x - pos.x
      const wz = wp.z - pos.z
      const wd = Math.hypot(wx, wz) || 1
      let mx = (wx / wd) * this.speed
      let mz = (wz / wd) * this.speed
      // whisker steering: if the path directly ahead is blocked by an obstacle,
      // swing the heading in 45° steps until a clear probe is found. Skip this
      // once the zombie has reached a window/gate/breach's approach zone — there
      // the "obstacle" ahead is the objective itself (boarded windows must be
      // hammered down, not evaded), so route-around logic just makes them pace
      // sideways along the wall forever instead of pressing against it.
      const atChokepoint = nav.inOpeningZone(pos)
      if (!atChokepoint && this.blockedAhead(nav.colliders, mx, mz)) {
        const flip = this.id % 2 === 0 ? 1 : -1
        for (const a of [0.785, -0.785, 1.57, -1.57]) {
          const ang = a * flip
          const ca = Math.cos(ang)
          const sa = Math.sin(ang)
          const rx = mx * ca - mz * sa
          const rz = mx * sa + mz * ca
          if (!this.blockedAhead(nav.colliders, rx, rz)) {
            mx = rx
            mz = rz
            break
          }
        }
      }
      this.group.rotation.y = Math.atan2(mx, mz)
      for (const o of others) {
        if (o === this || !o.alive) continue
        const ox = pos.x - o.group.position.x
        const oz = pos.z - o.group.position.z
        const od = Math.hypot(ox, oz)
        if (od > 0.01 && od < 0.9) {
          mx += (ox / od) * 2.2
          mz += (oz / od) * 2.2
        }
      }
      pos.x += mx * dt
      this.resolve(nav.colliders, 'x')
      pos.z += mz * dt
      this.resolve(nav.colliders, 'z')

      const moved = Math.hypot(pos.x - this.lastPos.x, pos.z - this.lastPos.z)
      if (moved < this.speed * dt * 0.2) {
        this.stuckT += dt
        if (this.stuckT > 1.0) {
          this.stuckT = 0
          // a full second with no real progress — whatever's wrong with this
          // spot (bad collider, bad routing, wedged against something), don't
          // bother diagnosing it: just drop the zombie at a different active
          // spawn point and let it try again from there. Falls back to the
          // claw machine only if there's nowhere else registered right now.
          if (nav.spawns.length > 0) {
            const s = nav.spawns[Math.floor(Math.random() * nav.spawns.length)]
            pos.x = s.x
            pos.z = s.z
          } else {
            const ang = Math.random() * Math.PI * 2
            pos.x = nav.clawPos.x + Math.cos(ang) * 2.5
            pos.z = nav.clawPos.z + Math.sin(ang) * 2.5
          }
        }
      } else {
        this.stuckT = Math.max(0, this.stuckT - dt * 2)
      }
      this.lastPos.copy(pos)

      // vault hop through breaches and window frames
      const wantHop = nav.inOpeningZone(pos) ? 0.42 : 0
      this.hop += (wantHop - this.hop) * Math.min(1, dt * 8)
      pos.y = this.hop

      // shamble animation
      const swing = Math.sin(this.animT * (this.runner ? 7 : 4.4))
      this.parts.legL.rotation.x = swing * 0.55
      this.parts.legR.rotation.x = -swing * 0.55
      this.parts.torso.rotation.z = Math.sin(this.animT * 2.1) * 0.07
      this.parts.armL.rotation.x = -Math.PI / 2 + Math.sin(this.animT * 2.3) * 0.15
      this.parts.armR.rotation.x = -Math.PI / 2 + Math.cos(this.animT * 2.0) * 0.15
      this.parts.head.rotation.z = Math.sin(this.animT * 1.7) * 0.12
    }
    return dealt > 0 ? { targetId: target.id, damage: dealt } : null
  }

  private startJump(target: TargetInfo) {
    this.justJumped = true
    this.midgetPhase = 'jumping'
    this.state = 'attacking' // borrow this state so Horde/host treat it as "engaged"
    this.jumpT = 0
    this.jumpStartX = this.group.position.x
    this.jumpStartZ = this.group.position.z
    const vx = target.vel?.x ?? 0
    const vz = target.vel?.z ?? 0
    // predicted once, at launch — no mid-air correction
    this.jumpTargetX = target.pos.x + vx * MIDGET_JUMP_DURATION
    this.jumpTargetZ = target.pos.z + vz * MIDGET_JUMP_DURATION
  }

  private updateJumping(dt: number, targets: TargetInfo[]): AttackResult | null {
    this.jumpT += dt
    const t = Math.min(1, this.jumpT / MIDGET_JUMP_DURATION)
    const pos = this.group.position
    pos.x = this.jumpStartX + (this.jumpTargetX - this.jumpStartX) * t
    pos.z = this.jumpStartZ + (this.jumpTargetZ - this.jumpStartZ) * t
    pos.y = Math.sin(Math.PI * t) * MIDGET_JUMP_ARC
    this.group.rotation.x = t * Math.PI * 2.4 // tumbling through the air
    const dx = this.jumpTargetX - this.jumpStartX
    const dz = this.jumpTargetZ - this.jumpStartZ
    if (Math.hypot(dx, dz) > 0.01) this.group.rotation.y = Math.atan2(dx, dz)

    if (t < 1) return null
    this.group.rotation.x = 0
    pos.y = 0
    // contact check uses the target's REAL current position — no tracking mid-flight,
    // so a player who juked will make it miss
    let best: TargetInfo | null = null
    let bestD = Infinity
    for (const tt of targets) {
      const d = Math.hypot(tt.pos.x - pos.x, tt.pos.z - pos.z)
      if (d < bestD) {
        bestD = d
        best = tt
      }
    }
    if (best && bestD <= MIDGET_CONTACT_RADIUS) {
      this.midgetPhase = 'latched'
      this.latchedTargetId = best.id
      this.pryCount = 0
      this.latchDamageT = MIDGET_LATCH_TICK
      this.state = 'attacking'
    } else {
      this.midgetPhase = 'ground'
      this.jumpCooldown = MIDGET_JUMP_COOLDOWN
      this.state = 'chasing'
    }
    return null
  }

  private updateLatched(dt: number, targets: TargetInfo[]): AttackResult | null {
    const host = targets.find((t) => t.id === this.latchedTargetId)
    if (host) {
      this.group.position.set(host.pos.x, 1.3, host.pos.z)
    }
    this.latchDamageT -= dt
    if (this.latchDamageT > 0) return null
    this.latchDamageT = MIDGET_LATCH_TICK
    return this.latchedTargetId ? { targetId: this.latchedTargetId, damage: MIDGET_LATCH_DAMAGE } : null
  }

  /** Rebuilds this zombie in-place as a Zuggernaut — same id, same instance, new mesh. */
  private evolveIntoZuggernaut() {
    const at = this.group.position.clone()
    this.scene.remove(this.group)
    disposeZombieMesh(this.group)

    this.isZuggernaut = true
    this.isMidget = false
    this.isJuggernaut = false
    this.runner = true
    this.hp = zombieHpForWave(this.spawnWave) * 5
    this.maxHp = this.hp
    this.speed = Math.min(3.6 + Math.max(0, this.spawnWave - 5) * 0.12, 5.2) + Math.random() * 0.3
    this.state = 'chasing'
    this.zuggernautPhase = 'ground'
    this.grabCooldown = 1 + Math.random()
    this.throwCooldown = 1 + Math.random() * 2

    const { group, parts } = buildZombieMesh(true, false, false, true)
    this.group = group
    this.parts = parts
    group.scale.setScalar(ZUGGERNAUT_SCALE)
    group.position.copy(at)
    group.userData.zombie = this
    this.scene.add(group)
  }

  /** Holds its target aloft — Game.ts pins the grabbed player's position to this
   *  zombie and still lets them shoot; only the final frame deals damage (a throw). */
  private updateGrabbing(dt: number): AttackResult | null {
    this.grabT += dt
    const lift = Math.min(1, this.grabT / 0.3)
    this.parts.armL.rotation.x = -Math.PI / 2 - lift * 1.0
    this.parts.armR.rotation.x = -Math.PI / 2 - lift * 1.0
    if (this.grabT < ZUGGERNAUT_GRAB_DURATION) return null
    this.zuggernautPhase = 'ground'
    this.grabCooldown = ZUGGERNAUT_GRAB_COOLDOWN
    this.state = 'chasing'
    const targetId = this.grabTargetId
    this.grabTargetId = null
    return targetId ? { targetId, damage: ZUGGERNAUT_THROW_DAMAGE } : null
  }

  /** Hurls a nearby plain zombie at the target in a locked-in arc — a ranged
   *  option when the player is out of grab range. The fodder animates its own
   *  flight (see becomeThrown/updateThrown); it lands prone, not dead. */
  private startThrowZombie(fodder: Zombie, target: TargetInfo) {
    this.zuggernautPhase = 'throwingZombie'
    this.throwT = 0
    fodder.becomeThrown(this.group.position.x, this.group.position.z, target.pos.x, target.pos.z)
    this.state = 'attacking'
  }

  /** Brief throw-motion beat on the Zuggernaut's end — the fodder handles its own flight. */
  private updateThrowingZombie(dt: number): AttackResult | null {
    this.throwT += dt
    if (this.throwT < 0.3) return null
    this.zuggernautPhase = 'ground'
    this.throwCooldown = ZUGGERNAUT_ZOMBIE_THROW_COOLDOWN
    this.state = 'chasing'
    return null
  }

  /** Launches this (plain) zombie into a thrown arc — called by the Zuggernaut
   *  that grabbed it. It isn't killed: it flies, lands prone, then stands back up. */
  becomeThrown(fromX: number, fromZ: number, toX: number, toZ: number) {
    this.thrownPhase = 'flying'
    this.thrownT = 0
    this.thrownStartX = fromX
    this.thrownStartZ = fromZ
    this.thrownTargetX = toX
    this.thrownTargetZ = toZ
    this.group.position.set(fromX, 1.2, fromZ)
  }

  private updateThrown(dt: number, targets: TargetInfo[]): AttackResult | null {
    this.thrownT += dt
    if (this.thrownPhase === 'flying') {
      const t = Math.min(1, this.thrownT / ZUGGERNAUT_ZOMBIE_THROW_DURATION)
      const arc = Math.sin(Math.PI * t) * 1.6
      this.group.position.set(
        this.thrownStartX + (this.thrownTargetX - this.thrownStartX) * t,
        1.2 + arc,
        this.thrownStartZ + (this.thrownTargetZ - this.thrownStartZ) * t,
      )
      this.group.rotation.x += dt * 10
      if (t < 1) return null
      this.thrownPhase = 'prone'
      this.thrownT = 0
      this.group.position.y = 0
      this.group.rotation.x = -Math.PI / 2
      for (const tt of targets) {
        const d = Math.hypot(tt.pos.x - this.group.position.x, tt.pos.z - this.group.position.z)
        if (d <= ZUGGERNAUT_ZOMBIE_THROW_CONTACT_RADIUS) {
          return { targetId: tt.id, damage: ZUGGERNAUT_ZOMBIE_THROW_DAMAGE }
        }
      }
      return null
    }
    if (this.thrownPhase === 'prone') {
      if (this.thrownT >= THROWN_PRONE_TIME) {
        this.thrownPhase = 'rising'
        this.thrownT = 0
      }
      return null
    }
    // rising
    const t = Math.min(1, this.thrownT / THROWN_RISE_TIME)
    this.group.rotation.x = -(Math.PI / 2) * (1 - t)
    if (t >= 1) {
      this.thrownPhase = 'none'
      this.group.rotation.x = 0
      this.state = 'chasing'
    }
    return null
  }

  /** Braced, roaring wind-up — telegraphs the charge direction long enough to dodge. */
  private updateWinding(dt: number, target: TargetInfo | null): AttackResult | null {
    if (target) {
      const dx = target.pos.x - this.group.position.x
      const dz = target.pos.z - this.group.position.z
      if (Math.hypot(dx, dz) > 0.01) this.group.rotation.y = Math.atan2(dx, dz)
    }
    this.windupT += dt
    // shaking, bracing-to-charge animation
    const shake = Math.sin(this.windupT * 26) * 0.06
    this.parts.armL.rotation.x = -Math.PI / 2 - 0.3 + shake
    this.parts.armR.rotation.x = -Math.PI / 2 - 0.3 - shake
    if (this.windupT < JUGGERNAUT_WINDUP_TIME) return null
    this.juggernautPhase = 'charging'
    this.chargeT = 0
    this.chargeHitIds.clear()
    return null
  }

  /** Barrels forward in a dead-straight line until it hits someone, a wall, or times out. */
  private updateCharging(dt: number, targets: TargetInfo[], nav: ZombieNav): AttackResult | null {
    this.chargeT += dt
    const pos = this.group.position
    pos.x += this.chargeDirX * JUGGERNAUT_CHARGE_SPEED * dt
    pos.z += this.chargeDirZ * JUGGERNAUT_CHARGE_SPEED * dt
    // any collider nudge ends the charge right there — a straight-line charge that got
    // deflected sideways by wall-sliding would drift off course and could miss a target
    // standing dead ahead of it
    const preX = pos.x
    const preZ = pos.z
    this.resolve(nav.colliders, 'x')
    this.resolve(nav.colliders, 'z')
    const hitWall = pos.x !== preX || pos.z !== preZ
    this.group.rotation.z = Math.sin(this.chargeT * 30) * 0.05 // juddering charge shake

    const chargeDamage =
      this.spawnWave >= JUGGERNAUT_CHARGE_INSTAKILL_WAVE ? JUGGERNAUT_CHARGE_INSTAKILL_DAMAGE : JUGGERNAUT_CHARGE_DAMAGE
    let result: AttackResult | null = null
    for (const t of targets) {
      if (this.chargeHitIds.has(t.id)) continue
      const d = Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z)
      if (d <= JUGGERNAUT_CHARGE_CONTACT_RADIUS) {
        this.chargeHitIds.add(t.id)
        if (!result) result = { targetId: t.id, damage: chargeDamage }
      }
    }

    if (hitWall || this.chargeT >= JUGGERNAUT_CHARGE_MAX_TIME) {
      this.group.rotation.z = 0
      this.juggernautPhase = 'ground'
      this.chargeCooldown = JUGGERNAUT_CHARGE_COOLDOWN
      this.state = 'chasing'
    }
    return result
  }

  isHeadPart(obj: THREE.Object3D): boolean {
    return obj === this.parts.head || obj.parent === this.parts.head
  }

  private blockedAhead(colliders: Collider[], dx: number, dz: number): boolean {
    const len = Math.hypot(dx, dz) || 1
    const px = this.group.position.x + (dx / len) * 1.0
    const pz = this.group.position.z + (dz / len) * 1.0
    for (const c of colliders) {
      if (
        px > c.minX - RADIUS &&
        px < c.maxX + RADIUS &&
        pz > c.minZ - RADIUS &&
        pz < c.maxZ + RADIUS
      ) {
        return true
      }
    }
    return false
  }

  private resolve(colliders: Collider[], axis: 'x' | 'z') {
    const pos = this.group.position
    for (const c of colliders) {
      if (
        pos.x > c.minX - RADIUS &&
        pos.x < c.maxX + RADIUS &&
        pos.z > c.minZ - RADIUS &&
        pos.z < c.maxZ + RADIUS
      ) {
        if (axis === 'x') {
          const mid = (c.minX + c.maxX) / 2
          pos.x = pos.x < mid ? c.minX - RADIUS : c.maxX + RADIUS
        } else {
          const mid = (c.minZ + c.maxZ) / 2
          pos.z = pos.z < mid ? c.minZ - RADIUS : c.maxZ + RADIUS
        }
      }
    }
  }
}

/** Exported for client-side rendering of host-simulated zombies. */
export function buildZombieMeshExternal(
  runner: boolean,
  luminescent = false,
  juggernaut = false,
  zuggernaut = false,
): { group: THREE.Group; parts: Parts } {
  return buildZombieMesh(runner, luminescent, juggernaut, zuggernaut)
}

function buildZombieMesh(
  runner: boolean,
  luminescent = false,
  juggernaut = false,
  zuggernaut = false,
): { group: THREE.Group; parts: Parts } {
  const group = new THREE.Group()
  // rotting skin: sickly green-grey, runners redder, juggernauts ash-grey,
  // zuggernauts a deep pulsing red; lab specimens glow in the dark
  const skin = new THREE.MeshLambertMaterial(
    zuggernaut
      ? { color: 0x200404 }
      : juggernaut
        ? { color: 0x353030 }
        : {
            color: new THREE.Color().setHSL(
              luminescent ? 0.42 : runner ? 0.02 + Math.random() * 0.03 : 0.24 + Math.random() * 0.1,
              0.35,
              0.22 + Math.random() * 0.1,
            ),
          },
  )
  const cloth = new THREE.MeshLambertMaterial(
    zuggernaut
      ? { color: 0x140202 }
      : juggernaut
        ? { color: 0x2c0a0a }
        : { color: new THREE.Color().setHSL(luminescent ? 0.5 : Math.random(), 0.2, 0.12 + Math.random() * 0.08) },
  )
  if (luminescent) {
    // emissive makes them self-lit — the only zombies you can see in the pitch-black Lab
    skin.emissive = new THREE.Color(0x1cff9a)
    skin.emissiveIntensity = 0.9
    cloth.emissive = new THREE.Color(0x1060ff)
    cloth.emissiveIntensity = 0.7
  }
  if (zuggernaut) {
    // base emissive — Zombie.update() pulses the intensity every frame
    skin.emissive = new THREE.Color(0xff1010)
    skin.emissiveIntensity = 0.6
    cloth.emissive = new THREE.Color(0xdd0000)
    cloth.emissiveIntensity = 0.5
  }

  // bulk multiplier fattens every limb — juggernaut is squat and hulking, zuggernaut
  // leaner but still broad; overall height comes from the caller's uniform group scale
  const b = juggernaut ? 1.55 : zuggernaut ? 1.3 : 1

  const legGeo = new THREE.BoxGeometry(0.16 * b, 0.58, 0.16 * b)
  legGeo.translate(0, -0.29, 0)
  const legL = new THREE.Mesh(legGeo, cloth)
  legL.position.set(-0.12 * b, 0.58, 0)
  const legR = new THREE.Mesh(legGeo.clone(), cloth)
  legR.position.set(0.12 * b, 0.58, 0)

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5 * b, 0.6, 0.26 * b), cloth)
  torso.position.y = 0.88

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26 * b, 0.28 * b, 0.26 * b), skin)
  head.position.y = 1.34
  head.name = 'head'
  // glowing eyes + slack mouth on the front face (+z = facing direction) — juggernauts/zuggernauts always burn red
  const eyeMat = new THREE.MeshBasicMaterial({ color: runner || juggernaut || zuggernaut ? 0xff2a1a : 0xc8e04a })
  const eyeGeo = new THREE.BoxGeometry(0.055 * b, 0.045 * b, 0.02)
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat)
  eyeL.position.set(-0.062 * b, 0.045 * b, 0.132 * b)
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat)
  eyeR.position.set(0.062 * b, 0.045 * b, 0.132 * b)
  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.13 * b, (runner || juggernaut || zuggernaut ? 0.07 : 0.045) * b, 0.02),
    new THREE.MeshBasicMaterial({ color: 0x140404 }),
  )
  mouth.position.set(0, -0.075 * b, 0.132 * b)
  head.add(eyeL, eyeR, mouth)

  const armGeo = new THREE.BoxGeometry(0.12 * b, 0.52, 0.12 * b)
  armGeo.translate(0, -0.26, 0) // pivot at shoulder
  const armL = new THREE.Mesh(armGeo, skin)
  armL.position.set(-0.32 * b, 1.12, 0)
  armL.rotation.x = -Math.PI / 2
  const armR = new THREE.Mesh(armGeo.clone(), skin)
  armR.position.set(0.32 * b, 1.12, 0)
  armR.rotation.x = -Math.PI / 2

  group.add(legL, legR, torso, head, armL, armR)
  if (zuggernaut) group.userData.pulseMats = [skin, cloth]
  return { group, parts: { head, armL, armR, legL, legR, torso } }
}
