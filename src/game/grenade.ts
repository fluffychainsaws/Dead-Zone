import * as THREE from 'three'
import type { Collider } from './arena'

const GRAVITY = 22 // matches player.ts's own jump/fall gravity, for a consistent feel
const RADIUS = 0.1
const GROUND_BOUNCE = 0.35
const GROUND_FRICTION = 0.6
export const GRENADE_FUSE_TIME = 1.8

/** Pure physics — no scene/mesh dependency, so the host can headlessly replay a
 *  remote player's throw (for authoritative damage) without ever rendering it. */
export class Grenade {
  pos: THREE.Vector3
  vel: THREE.Vector3
  fuseT = GRENADE_FUSE_TIME

  constructor(origin: THREE.Vector3, vel: THREE.Vector3) {
    this.pos = origin.clone()
    this.vel = vel.clone()
  }

  /** Advances physics by dt; returns true the instant it detonates (fuse expired). */
  update(dt: number, colliders: Collider[]): boolean {
    this.fuseT -= dt
    this.vel.y -= GRAVITY * dt
    this.pos.x += this.vel.x * dt
    this.pos.z += this.vel.z * dt
    this.resolveAxis(colliders, 'x')
    this.resolveAxis(colliders, 'z')
    this.pos.y += this.vel.y * dt
    if (this.pos.y < RADIUS) {
      this.pos.y = RADIUS
      if (this.vel.y < 0) this.vel.y = -this.vel.y * GROUND_BOUNCE
      this.vel.x *= GROUND_FRICTION
      this.vel.z *= GROUND_FRICTION
    }
    return this.fuseT <= 0
  }

  private resolveAxis(colliders: Collider[], axis: 'x' | 'z') {
    for (const c of colliders) {
      if (
        this.pos.x > c.minX - RADIUS &&
        this.pos.x < c.maxX + RADIUS &&
        this.pos.z > c.minZ - RADIUS &&
        this.pos.z < c.maxZ + RADIUS
      ) {
        if (axis === 'x') {
          const mid = (c.minX + c.maxX) / 2
          this.pos.x = this.pos.x < mid ? c.minX - RADIUS : c.maxX + RADIUS
          this.vel.x *= -GROUND_BOUNCE
        } else {
          const mid = (c.minZ + c.maxZ) / 2
          this.pos.z = this.pos.z < mid ? c.minZ - RADIUS : c.maxZ + RADIUS
          this.vel.z *= -GROUND_BOUNCE
        }
      }
    }
  }
}

/** The tossed prop itself — only built for grenades a player actually watches
 *  fly (the thrower's own throw), never for a remote client's headless replay. */
export function buildGrenadeMesh(): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0x3a4a2e }),
  )
  g.add(body)
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.03, 0.05, 6),
    new THREE.MeshLambertMaterial({ color: 0x22281f }),
  )
  cap.position.y = 0.1
  g.add(cap)
  return g
}
