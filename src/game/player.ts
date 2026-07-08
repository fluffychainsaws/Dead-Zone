import * as THREE from 'three'
import type { Collider } from './arena'
import type { Input } from './input'

const RADIUS = 0.42
const EYE_HEIGHT = 1.68
const CROUCH_EYE_HEIGHT = 1.05
const WALK_SPEED = 4.6
const SPRINT_SPEED = 7.0
const CROUCH_SPEED = 2.3
const JUMP_VELOCITY = 7.6 // apex ≈ 1.3m — clears window sills and low props
const GRAVITY = 22

// Vaulting: a low obstacle directly ahead gets a scripted climb instead of a
// plain jump, so clearing crates/sills doesn't depend on sprint-jump timing.
const VAULT_MIN_H = 0.25
const VAULT_MAX_H = 1.55
const VAULT_PROBE_DIST = 0.85
const VAULT_VELOCITY = 5.6
const VAULT_PUSH_SPEED = 3.4
const VAULT_TIME = 0.45

export class Player {
  pos = new THREE.Vector3(0, 0, 11) // middle of the cell block
  yaw = 0 // facing north, toward the locked gates
  pitch = 0
  hp = 100
  maxHp = 100
  alive = true
  downed = false
  grounded = true
  crouched = false

  private velY = 0
  private bobT = 0
  private time = 0
  private lastHitAt = -10
  private crouchT = 0 // 0 = standing, 1 = fully crouched (smoothed)
  private vaultT = 0
  private vaultDirX = 0
  private vaultDirZ = 0
  private static readonly REGEN_DELAY = 4
  private static readonly REGEN_RATE = 20

  /** Floors hp at 0 — the Game decides whether that means downed or dead. */
  takeDamage(amount: number) {
    if (!this.alive || this.downed || amount <= 0) return
    this.hp = Math.max(0, this.hp - amount)
    this.lastHitAt = this.time
  }

  revive() {
    this.downed = false
    this.hp = 50
  }

  get recentlyHit(): boolean {
    return this.time - this.lastHitAt < 0.35
  }

  update(dt: number, input: Input, colliders: Collider[]) {
    if (!this.alive) return
    this.time += dt
    if (
      !this.downed &&
      this.time - this.lastHitAt > Player.REGEN_DELAY &&
      this.hp < this.maxHp &&
      this.hp > 0
    ) {
      this.hp = Math.min(this.maxHp, this.hp + Player.REGEN_RATE * dt)
    }
    const look = input.consumeLook()
    this.yaw -= look.x
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.y, -1.45, 1.45)
    if (this.downed) {
      input.consumeJump()
      input.consumeCrouch()
      return // can look around while waiting for a revive, not move
    }

    if (input.consumeCrouch()) this.crouched = !this.crouched
    this.crouchT += ((this.crouched ? 1 : 0) - this.crouchT) * Math.min(1, dt * 10)

    const move = input.moveVec()
    const speed = this.crouched
      ? CROUCH_SPEED
      : input.sprint && move.z > 0.3
        ? SPRINT_SPEED
        : WALK_SPEED
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

    // vertical: jump/vault + gravity, landing on the ground or on low colliders
    if (input.consumeJump() && this.grounded) {
      if (this.crouched) {
        this.crouched = false // stand up instead of jumping
      } else {
        const fwdX = -Math.sin(this.yaw)
        const fwdZ = -Math.cos(this.yaw)
        if (this.probeVault(colliders, fwdX, fwdZ)) {
          this.velY = VAULT_VELOCITY
          this.vaultT = VAULT_TIME
          this.vaultDirX = fwdX
          this.vaultDirZ = fwdZ
        } else {
          this.velY = JUMP_VELOCITY
        }
        this.grounded = false
      }
    }
    if (this.vaultT > 0) {
      this.vaultT -= dt
      // scripted carry over the obstacle — deliberately skips resolve() so the
      // climb doesn't stall against the very ledge it's meant to clear
      this.pos.x += this.vaultDirX * VAULT_PUSH_SPEED * dt
      this.pos.z += this.vaultDirZ * VAULT_PUSH_SPEED * dt
    }
    this.velY -= GRAVITY * dt
    this.pos.y += this.velY * dt
    const floor = this.floorHeight(colliders)
    if (this.pos.y <= floor && this.velY <= 0) {
      this.pos.y = floor
      this.velY = 0
      this.grounded = true
    } else if (this.pos.y > floor + 0.01) {
      this.grounded = false
    }

    const moving = Math.hypot(vx, vz)
    this.bobT += dt * (moving > 0.5 && this.grounded ? moving * 1.6 : 0)
  }

  /** Push the player out of zombie bodies (treated as circles). */
  collideWithBodies(bodies: THREE.Vector3[], bodyRadius: number, colliders: Collider[]) {
    if (!this.alive || this.pos.y > 1.2) return // airborne over their heads
    const minDist = RADIUS + bodyRadius
    let pushed = false
    for (const b of bodies) {
      const dx = this.pos.x - b.x
      const dz = this.pos.z - b.z
      const d = Math.hypot(dx, dz)
      if (d > 0.001 && d < minDist) {
        const push = (minDist - d) / d
        this.pos.x += dx * push
        this.pos.z += dz * push
        pushed = true
      }
    }
    if (pushed) {
      this.resolve(colliders, 'x')
      this.resolve(colliders, 'z')
    }
  }

  /** A collider blocks horizontally only if its top is above the player's feet. */
  private blocks(c: Collider): boolean {
    return (c.height ?? Infinity) > this.pos.y + 0.05
  }

  /** Is there a vaultable (low, non-wall) obstacle directly ahead? */
  private probeVault(colliders: Collider[], dirX: number, dirZ: number): boolean {
    const px = this.pos.x + dirX * VAULT_PROBE_DIST
    const pz = this.pos.z + dirZ * VAULT_PROBE_DIST
    for (const c of colliders) {
      const h = c.height
      if (h === undefined || h < VAULT_MIN_H || h > VAULT_MAX_H) continue
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

  private floorHeight(colliders: Collider[]): number {
    let floor = 0
    for (const c of colliders) {
      const h = c.height ?? Infinity
      if (h === Infinity || h > this.pos.y + 0.05) continue // not below us
      if (
        this.pos.x > c.minX - RADIUS * 0.4 &&
        this.pos.x < c.maxX + RADIUS * 0.4 &&
        this.pos.z > c.minZ - RADIUS * 0.4 &&
        this.pos.z < c.maxZ + RADIUS * 0.4
      ) {
        floor = Math.max(floor, h)
      }
    }
    return floor
  }

  private resolve(colliders: Collider[], axis: 'x' | 'z') {
    for (const c of colliders) {
      if (!this.blocks(c)) continue
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
    const downedOffset = this.downed ? -0.9 : 0
    const crouchOffset = -this.crouchT * (EYE_HEIGHT - CROUCH_EYE_HEIGHT)
    camera.position.set(
      this.pos.x,
      this.pos.y + EYE_HEIGHT + bob + downedOffset + crouchOffset,
      this.pos.z,
    )
    camera.rotation.set(0, 0, 0)
    camera.rotateY(this.yaw)
    camera.rotateX(this.pitch)
  }
}
