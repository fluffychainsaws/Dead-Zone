import * as THREE from 'three'
import type { Collider } from './arena'

const RADIUS = 0.38
const ATTACK_RANGE = 1.45
const ATTACK_WINDUP = 0.45
const ATTACK_COOLDOWN = 1.0
const ATTACK_DAMAGE = 14

export type ZombieState = 'chasing' | 'attacking' | 'dying'

export interface TargetInfo {
  id: string
  pos: THREE.Vector3
}

export interface AttackResult {
  targetId: string
  damage: number
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
  state: ZombieState = 'chasing'
  dead = false // fully finished (despawn)

  private parts: Parts
  private animT = Math.random() * 10
  private attackT = 0
  private deathT = 0
  private scene: THREE.Scene

  constructor(scene: THREE.Scene, pos: THREE.Vector3, hp: number, runner: boolean) {
    this.scene = scene
    this.hp = hp
    this.maxHp = hp
    this.runner = runner
    this.speed = runner ? 4.2 + Math.random() * 0.8 : 1.5 + Math.random() * 0.7
    const { group, parts } = buildZombieMesh(runner)
    this.group = group
    this.parts = parts
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
      return true
    }
    return false
  }

  /** Chases the nearest target; returns an attack that landed this frame, if any. */
  update(
    dt: number,
    targets: TargetInfo[],
    colliders: Collider[],
    others: Zombie[],
  ): AttackResult | null {
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
    if (!target) return null
    const dx = target.pos.x - pos.x
    const dz = target.pos.z - pos.z
    this.group.rotation.y = Math.atan2(dx, dz)

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
      // shamble toward the player with light flock separation
      let mx = (dx / dist) * this.speed
      let mz = (dz / dist) * this.speed
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
      this.resolve(colliders, 'x')
      pos.z += mz * dt
      this.resolve(colliders, 'z')

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

  isHeadPart(obj: THREE.Object3D): boolean {
    return obj === this.parts.head
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
export function buildZombieMeshExternal(runner: boolean): { group: THREE.Group; parts: Parts } {
  return buildZombieMesh(runner)
}

function buildZombieMesh(runner: boolean): { group: THREE.Group; parts: Parts } {
  const group = new THREE.Group()
  // rotting skin: sickly green-grey, runners redder
  const hue = runner ? 0.02 + Math.random() * 0.03 : 0.24 + Math.random() * 0.1
  const skin = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(hue, 0.35, 0.22 + Math.random() * 0.1),
    roughness: 0.95,
  })
  const cloth = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(Math.random(), 0.15, 0.12 + Math.random() * 0.08),
    roughness: 1,
  })

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
