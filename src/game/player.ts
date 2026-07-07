import * as THREE from 'three'
import type { Collider } from './arena'
import type { Input } from './input'

const RADIUS = 0.42
const EYE_HEIGHT = 1.68
const WALK_SPEED = 4.6
const SPRINT_SPEED = 7.0

export class Player {
  pos = new THREE.Vector3(0, 0, 8)
  yaw = 0 // spawn at +z looking toward the arena center (-z)
  pitch = 0
  hp = 100
  maxHp = 100
  alive = true

  private bobT = 0

  update(dt: number, input: Input, colliders: Collider[]) {
    if (!this.alive) return
    const look = input.consumeLook()
    this.yaw -= look.x
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.y, -1.45, 1.45)

    const move = input.moveVec()
    const speed = input.sprint && move.z > 0.3 ? SPRINT_SPEED : WALK_SPEED
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    // forward is -z in camera space
    const vx = (move.x * cos - move.z * sin) * speed
    const vz = (-move.x * sin - move.z * cos) * speed

    // axis-separated movement + AABB pushback keeps corners simple
    this.pos.x += vx * dt
    this.resolve(colliders, 'x')
    this.pos.z += vz * dt
    this.resolve(colliders, 'z')

    const moving = Math.hypot(vx, vz)
    this.bobT += dt * (moving > 0.5 ? moving * 1.6 : 0)
  }

  private resolve(colliders: Collider[], axis: 'x' | 'z') {
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
        } else {
          const mid = (c.minZ + c.maxZ) / 2
          this.pos.z = this.pos.z < mid ? c.minZ - RADIUS : c.maxZ + RADIUS
        }
      }
    }
  }

  applyCamera(camera: THREE.PerspectiveCamera) {
    const bob = Math.sin(this.bobT) * 0.035
    camera.position.set(this.pos.x, this.pos.y + EYE_HEIGHT + bob, this.pos.z)
    camera.rotation.set(0, 0, 0)
    camera.rotateY(this.yaw)
    camera.rotateX(this.pitch)
  }
}
