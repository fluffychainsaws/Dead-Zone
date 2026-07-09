import * as THREE from 'three'
import type { PlayerState, ZombieState } from '../net/room'
import { buildZombieMeshExternal, MIDGET_SCALE } from './zombie'

function makeNameTag(name: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.textAlign = 'center'
  ctx.font = 'bold 34px Impact, Arial Black, sans-serif'
  ctx.fillStyle = '#84ff5a'
  ctx.shadowColor = '#000'
  ctx.shadowBlur = 8
  ctx.fillText(name.toUpperCase(), 128, 42)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  )
  sprite.scale.set(1.8, 0.45, 1)
  return sprite
}

/** Another survivor, interpolated from network updates. */
export class RemotePlayer {
  group: THREE.Group
  hp = 100
  down = false
  crouched = false

  private targetPos = new THREE.Vector3()
  private targetYaw = 0
  private crouchT = 0

  constructor(scene: THREE.Scene, name: string) {
    this.group = new THREE.Group()
    const uniform = new THREE.MeshLambertMaterial({ color: 0x2e3b2a })
    const skin = new THREE.MeshLambertMaterial({ color: 0x8a7a5a })
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.26), uniform)
    body.position.y = 1.0
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), skin)
    head.position.y = 1.48
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.66, 0.24), uniform)
    legs.position.y = 0.36
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.09, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x22232a }),
    )
    gun.position.set(0.22, 1.12, -0.3)
    const tag = makeNameTag(name)
    tag.position.y = 1.95
    this.group.add(body, head, legs, gun, tag)
    scene.add(this.group)
  }

  applyState(s: PlayerState) {
    this.targetPos.set(s[0], s[5] ?? 0, s[1])
    this.targetYaw = s[2]
    this.hp = s[3]
    this.down = s[4] === 1
    this.crouched = s[6] === 1
    this.group.rotation.z = this.down ? Math.PI / 2 : 0
  }

  update(dt: number) {
    const k = Math.min(1, dt * 12)
    this.group.position.lerp(this.targetPos, k)
    // shortest-arc yaw lerp
    let d = this.targetYaw - this.group.rotation.y
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    this.group.rotation.y += d * k
    this.crouchT += ((this.crouched && !this.down ? 1 : 0) - this.crouchT) * Math.min(1, dt * 10)
    this.group.scale.y = 1 - this.crouchT * 0.28
  }

  get pos(): THREE.Vector3 {
    return this.group.position
  }
}

interface RemoteZombie {
  group: THREE.Group
  head: THREE.Mesh
  targetPos: THREE.Vector3
  targetRy: number
  state: number
  runner: boolean
  midget: boolean
  luminescent: boolean
  animT: number
  deathT: number
  parts: ReturnType<typeof buildZombieMeshExternal>['parts']
}

/** Client-side rendering of the host's zombies. */
export class RemoteZombieField {
  private scene: THREE.Scene
  private zombies = new Map<number, RemoteZombie>()

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  /** Reconcile against the authoritative list from the host. */
  applyState(list: ZombieState[]) {
    const seen = new Set<number>()
    for (const [id, x, z, ry, state, runner, midget, lum] of list) {
      seen.add(id)
      let rz = this.zombies.get(id)
      if (!rz) {
        const built = buildZombieMeshExternal(runner === 1, lum === 1)
        if (midget === 1) built.group.scale.setScalar(MIDGET_SCALE)
        built.group.position.set(x, 0, z)
        built.group.userData.zombieId = id
        this.scene.add(built.group)
        rz = {
          group: built.group,
          head: built.parts.head,
          targetPos: new THREE.Vector3(x, 0, z),
          targetRy: ry,
          state,
          runner: runner === 1,
          midget: midget === 1,
          luminescent: lum === 1,
          animT: Math.random() * 10,
          deathT: 0,
          parts: built.parts,
        }
        this.zombies.set(id, rz)
      }
      rz.targetPos.set(x, 0, z)
      rz.targetRy = ry
      rz.state = state
    }
    // remove zombies the host no longer tracks
    for (const [id, rz] of this.zombies) {
      if (!seen.has(id)) {
        this.scene.remove(rz.group)
        this.zombies.delete(id)
      }
    }
  }

  update(dt: number) {
    for (const rz of this.zombies.values()) {
      if (rz.state === 2) {
        // dying: local fall animation
        rz.deathT += dt
        rz.group.rotation.x = -Math.min(1, rz.deathT / 0.35) * (Math.PI / 2)
        continue
      }
      const k = Math.min(1, dt * 10)
      rz.group.position.lerp(rz.targetPos, k)
      let d = rz.targetRy - rz.group.rotation.y
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      rz.group.rotation.y += d * k
      // shamble animation (client-side cosmetic)
      rz.animT += dt * (rz.runner ? 2.4 : 1.0)
      const swing = Math.sin(rz.animT * (rz.runner ? 7 : 4.4))
      rz.parts.legL.rotation.x = swing * 0.55
      rz.parts.legR.rotation.x = -swing * 0.55
      rz.parts.torso.rotation.z = Math.sin(rz.animT * 2.1) * 0.07
    }
  }

  /** Meshes for local hit-testing on the client. `excludeId` skips one zombie (e.g. a midget latched onto the local player, which shouldn't body-block them). */
  targets(excludeId?: number): THREE.Object3D[] {
    const out: THREE.Object3D[] = []
    for (const [id, rz] of this.zombies) {
      if (rz.state !== 2 && id !== excludeId) out.push(rz.group)
    }
    return out
  }

  /** Host migration: hand the last-known horde layout to a newly-promoted host. */
  snapshot(): Array<{
    x: number
    z: number
    runner: boolean
    midget: boolean
    luminescent: boolean
    dying: boolean
  }> {
    return [...this.zombies.values()].map((rz) => ({
      x: rz.group.position.x,
      z: rz.group.position.z,
      runner: rz.runner,
      midget: rz.midget,
      luminescent: rz.luminescent,
      dying: rz.state === 2,
    }))
  }

  /** Zombie ids within `range` and in the 180° arc in front of (fwdX, fwdZ) — for a client's melee to report to the host. */
  meleeCandidates(originX: number, originZ: number, fwdX: number, fwdZ: number, range: number): number[] {
    const ids: number[] = []
    for (const [id, rz] of this.zombies) {
      if (rz.state === 2) continue // already dying
      const dx = rz.group.position.x - originX
      const dz = rz.group.position.z - originZ
      const dist = Math.hypot(dx, dz)
      if (dist > range || dist < 0.001) continue
      const dot = (dx / dist) * fwdX + (dz / dist) * fwdZ
      if (dot <= 0) continue
      ids.push(id)
    }
    return ids
  }

  randomGroanSource(): { pos: THREE.Vector3; runner: boolean } | null {
    const alive = [...this.zombies.values()].filter((z) => z.state !== 2)
    if (alive.length === 0) return null
    const z = alive[Math.floor(Math.random() * alive.length)]
    return { pos: z.group.position, runner: z.runner }
  }

  idFor(obj: THREE.Object3D): { id: number; head: boolean } | null {
    let cur: THREE.Object3D | null = obj
    let head = false
    while (cur) {
      if (cur.name === 'head') head = true
      if (cur.userData.zombieId !== undefined)
        return { id: cur.userData.zombieId as number, head }
      cur = cur.parent
    }
    return null
  }

  clear() {
    for (const rz of this.zombies.values()) this.scene.remove(rz.group)
    this.zombies.clear()
  }
}
