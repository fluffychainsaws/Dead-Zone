import * as THREE from 'three'
import { Zombie } from './zombie'
import type { Collider } from './arena'

export type WavePhase = 'idle' | 'intermission' | 'active'

const INTERMISSION_TIME = 7
const FIRST_WAVE_DELAY = 3
const SPAWN_INTERVAL = 1.1
const MAX_ALIVE = 22

export interface WaveEvents {
  onWaveStart?: (wave: number) => void
  onIntermission?: (nextWave: number) => void
  onKill?: (zombie: Zombie, headshot: boolean) => void
}

export class Horde {
  zombies: Zombie[] = []
  private scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  get aliveCount(): number {
    return this.zombies.filter((z) => z.alive).length
  }

  /** All zombie meshes, for shot raycasts. */
  targets(): THREE.Object3D[] {
    return this.zombies.filter((z) => z.alive).map((z) => z.group)
  }

  spawn(pos: THREE.Vector3, hp: number, runner: boolean): Zombie {
    const z = new Zombie(this.scene, pos, hp, runner)
    this.zombies.push(z)
    return z
  }

  /** Returns total damage dealt to the player this frame. */
  update(dt: number, playerPos: THREE.Vector3, colliders: Collider[]): number {
    let damage = 0
    for (const z of this.zombies) {
      damage += z.update(dt, playerPos, colliders, this.zombies)
    }
    this.zombies = this.zombies.filter((z) => !z.dead)
    return damage
  }

  /** Find the zombie owning a hit object (walks up the parent chain). */
  zombieFor(obj: THREE.Object3D): Zombie | null {
    let cur: THREE.Object3D | null = obj
    while (cur) {
      if (cur.userData.zombie) return cur.userData.zombie as Zombie
      cur = cur.parent
    }
    return null
  }

  reset() {
    for (const z of this.zombies) this.scene.remove(z.group)
    this.zombies = []
  }
}

export class WaveSystem {
  wave = 0
  phase: WavePhase = 'idle'
  kills = 0

  private timer = 0
  private pendingSpawns = 0
  private spawnTimer = 0
  private horde: Horde
  private spawnPoints: THREE.Vector3[]
  private events: WaveEvents

  constructor(horde: Horde, spawnPoints: THREE.Vector3[], events: WaveEvents = {}) {
    this.horde = horde
    // spawn just inside the wall gaps
    this.spawnPoints = spawnPoints.map((p) =>
      new THREE.Vector3(p.x * 0.92, 0, p.z * 0.92),
    )
    this.events = events
  }

  begin() {
    this.phase = 'intermission'
    this.wave = 0
    this.kills = 0
    this.timer = FIRST_WAVE_DELAY
  }

  zombieCount(wave: number): number {
    return Math.min(5 + (wave - 1) * 3, 32)
  }

  zombieHp(wave: number): number {
    return Math.round(60 * (1 + 0.17 * (wave - 1)))
  }

  runnerChance(wave: number): number {
    return Math.min(0.05 + wave * 0.05, 0.5)
  }

  update(dt: number) {
    if (this.phase === 'idle') return

    if (this.phase === 'intermission') {
      this.timer -= dt
      if (this.timer <= 0) {
        this.wave++
        this.phase = 'active'
        this.pendingSpawns = this.zombieCount(this.wave)
        this.spawnTimer = 0
        this.events.onWaveStart?.(this.wave)
      }
      return
    }

    // active
    if (this.pendingSpawns > 0) {
      this.spawnTimer -= dt
      if (this.spawnTimer <= 0 && this.horde.aliveCount < MAX_ALIVE) {
        this.spawnTimer = SPAWN_INTERVAL
        this.pendingSpawns--
        const p = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)]
        const jitter = new THREE.Vector3(
          (Math.random() - 0.5) * 2.5,
          0,
          (Math.random() - 0.5) * 2.5,
        )
        this.horde.spawn(
          p.clone().add(jitter),
          this.zombieHp(this.wave),
          Math.random() < this.runnerChance(this.wave),
        )
      }
    } else if (this.horde.aliveCount === 0) {
      this.phase = 'intermission'
      this.timer = INTERMISSION_TIME
      this.events.onIntermission?.(this.wave + 1)
    }
  }

  registerKill(z: Zombie, headshot: boolean) {
    this.kills++
    this.events.onKill?.(z, headshot)
  }
}
