import * as THREE from 'three'
import type { Collider } from './arena'

const RADIUS = 0.38
const ATTACK_RANGE = 1.45
const ATTACK_WINDUP = 0.45
const ATTACK_COOLDOWN = 1.0
const ATTACK_DAMAGE = 14

// Midget Zombie: tiny, fragile, always dies to a headshot — but leaps from
// medium range with a predicted (not tracking) trajectory and latches onto
// the target's head, blocking their view until pried off.
const MIDGET_SCALE = 0.25
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

export type ZombieState = 'chasing' | 'attacking' | 'dying'
export type MidgetPhase = 'ground' | 'jumping' | 'latched'

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
  nextWaypoint(pos: THREE.Vector3, target: THREE.Vector3): THREE.Vector3
  inOpeningZone(pos: THREE.Vector3): boolean
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
  luminescent: boolean
  state: ZombieState = 'chasing'
  dead = false // fully finished (despawn)

  // midget-only state
  midgetPhase: MidgetPhase = 'ground'
  latchedTargetId: string | null = null
  /** True for the one frame a jump launches — Game.ts checks this to trigger a sound. */
  justJumped = false

  private parts: Parts
  private animT = Math.random() * 10
  private attackT = 0
  private deathT = 0
  private scene: THREE.Scene
  private lastPos = new THREE.Vector3()
  private stuckT = 0
  private sideStep = 0 // seconds of lateral escape left
  private sideSign = 1
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

  constructor(
    scene: THREE.Scene,
    pos: THREE.Vector3,
    hp: number,
    runner: boolean,
    isMidget = false,
    wave = 1,
    luminescent = false,
  ) {
    this.scene = scene
    this.hp = hp
    this.maxHp = hp
    this.runner = runner
    this.isMidget = isMidget
    this.luminescent = luminescent
    if (isMidget) {
      this.speed = 2.4 + Math.random() * 0.5 // ground-scuttle speed between jumps
    } else if (runner) {
      // ramps in slowly after wave 5, hard-capped — never an unbeatable sprint
      this.speed = Math.min(3.6 + Math.max(0, wave - 5) * 0.12, 5.2) + Math.random() * 0.3
    } else {
      this.speed = 1.5 + Math.random() * 0.7
    }
    const { group, parts } = buildZombieMesh(runner, luminescent)
    this.group = group
    this.parts = parts
    if (isMidget) group.scale.setScalar(MIDGET_SCALE)
    group.position.copy(pos)
    group.userData.zombie = this
    scene.add(group)
  }

  get alive(): boolean {
    return this.state !== 'dying'
  }

  /** Apply damage; returns true if this hit killed it. */
  damage(amount: number): boolean {
    if (!this.alive) return false
    this.hp -= amount
    if (this.hp <= 0) {
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

    this.animT += dt * (this.runner ? 2.4 : 1.0)
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

    let dealt = 0
    if (dist < ATTACK_RANGE || this.state === 'attacking') {
      this.state = 'attacking'
      this.attackT += dt
      if (this.attackT >= ATTACK_WINDUP && this.attackT - dt < ATTACK_WINDUP) {
        if (dist < ATTACK_RANGE + 0.4) dealt = ATTACK_DAMAGE
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
      const wp = nav.nextWaypoint(pos, target.pos)
      const wx = wp.x - pos.x
      const wz = wp.z - pos.z
      const wd = Math.hypot(wx, wz) || 1
      let mx = (wx / wd) * this.speed
      let mz = (wz / wd) * this.speed
      // whisker steering: if the path directly ahead is blocked by an obstacle,
      // swing the heading in 45° steps until a clear probe is found
      if (this.blockedAhead(nav.colliders, mx, mz)) {
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
      // anti-stuck: barely moving while chasing → briefly strafe sideways
      if (this.sideStep > 0) {
        this.sideStep -= dt
        const px = -mz * this.sideSign
        const pz = mx * this.sideSign
        mx = px
        mz = pz
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
          this.sideStep = 0.6
          this.sideSign = Math.random() < 0.5 ? 1 : -1
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
): { group: THREE.Group; parts: Parts } {
  return buildZombieMesh(runner, luminescent)
}

function buildZombieMesh(
  runner: boolean,
  luminescent = false,
): { group: THREE.Group; parts: Parts } {
  const group = new THREE.Group()
  // rotting skin: sickly green-grey, runners redder; lab specimens glow in the dark
  const hue = luminescent ? 0.42 : runner ? 0.02 + Math.random() * 0.03 : 0.24 + Math.random() * 0.1
  const skin = new THREE.MeshLambertMaterial({
    color: new THREE.Color().setHSL(hue, 0.35, 0.22 + Math.random() * 0.1),
  })
  const cloth = new THREE.MeshLambertMaterial({
    color: new THREE.Color().setHSL(luminescent ? 0.5 : Math.random(), 0.2, 0.12 + Math.random() * 0.08),
  })
  if (luminescent) {
    // emissive makes them self-lit — the only zombies you can see in the pitch-black Lab
    skin.emissive = new THREE.Color(0x1cff9a)
    skin.emissiveIntensity = 0.9
    cloth.emissive = new THREE.Color(0x1060ff)
    cloth.emissiveIntensity = 0.7
  }

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.58, 0.16), cloth)
  legL.position.set(-0.12, 0.29, 0)
  legL.geometry.translate(0, -0.29, 0)
  legL.position.y = 0.58
  const legR = legL.clone()
  legR.position.x = 0.12

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.26), cloth)
  torso.position.y = 0.88

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skin)
  head.position.y = 1.34
  head.name = 'head'
  // glowing eyes + slack mouth on the front face (+z = facing direction)
  const eyeMat = new THREE.MeshBasicMaterial({ color: runner ? 0xff2a1a : 0xc8e04a })
  const eyeGeo = new THREE.BoxGeometry(0.055, 0.045, 0.02)
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat)
  eyeL.position.set(-0.062, 0.045, 0.132)
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat)
  eyeR.position.set(0.062, 0.045, 0.132)
  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, runner ? 0.07 : 0.045, 0.02),
    new THREE.MeshBasicMaterial({ color: 0x140404 }),
  )
  mouth.position.set(0, -0.075, 0.132)
  head.add(eyeL, eyeR, mouth)

  const armGeo = new THREE.BoxGeometry(0.12, 0.52, 0.12)
  armGeo.translate(0, -0.26, 0) // pivot at shoulder
  const armL = new THREE.Mesh(armGeo, skin)
  armL.position.set(-0.32, 1.12, 0)
  armL.rotation.x = -Math.PI / 2
  const armR = new THREE.Mesh(armGeo.clone(), skin)
  armR.position.set(0.32, 1.12, 0)
  armR.rotation.x = -Math.PI / 2

  group.add(legL, legR, torso, head, armL, armR)
  return { group, parts: { head, armL, armR, legL, legR, torso } }
}
