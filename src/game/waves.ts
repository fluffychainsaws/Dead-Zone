import * as THREE from 'three'
import { Zombie, type TargetInfo, type ZombieNav } from './zombie'

export type WavePhase = 'idle' | 'intermission' | 'active'

const INTERMISSION_TIME = 7
const FIRST_WAVE_DELAY = 3
const SPAWN_INTERVAL = 1.1
const BASE_MAX_ALIVE = 22
const RUNNER_START_WAVE = 6 // no runners at all before this
const MIDGET_START_WAVE = 4

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

  spawn(pos: THREE.Vector3, hp: number, runner: boolean, isMidget = false, wave = 1): Zombie {
    const z = new Zombie(this.scene, pos, hp, runner, isMidget, wave)
    this.zombies.push(z)
    return z
  }

  /** Returns damage dealt this frame, keyed by target id. */
  update(dt: number, targets: TargetInfo[], nav: ZombieNav): Record<string, number> {
    const damage: Record<string, number> = {}
    for (const z of this.zombies) {
      const hit = z.update(dt, targets, nav, this.zombies)
      if (hit) damage[hit.targetId] = (damage[hit.targetId] ?? 0) + hit.damage
    }
    this.zombies = this.zombies.filter((z) => !z.dead)
    return damage
  }

  /** Zombies alive within `range` and in the 180° arc in front of (fwdX, fwdZ). */
  meleeSweep(
    originX: number,
    originZ: number,
    fwdX: number,
    fwdZ: number,
    range: number,
    damage: number,
    pushDist: number,
    nav: ZombieNav,
  ): Array<{ zombie: Zombie; killed: boolean }> {
    const results: Array<{ zombie: Zombie; killed: boolean }> = []
    for (const z of this.zombies) {
      if (!z.alive) continue
      const dx = z.group.position.x - originX
      const dz = z.group.position.z - originZ
      const dist = Math.hypot(dx, dz)
      if (dist > range || dist < 0.001) continue
      const dot = (dx / dist) * fwdX + (dz / dist) * fwdZ
      if (dot <= 0) continue // behind the player — outside the 180° arc
      const killed = z.meleeHit(damage, dx / dist, dz / dist, pushDist, nav.colliders)
      results.push({ zombie: z, killed })
    }
    return results
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
  /** 1.0 for solo; scales up with player count so co-op stays challenging. */
  playerMultiplier = 1

  private timer = 0
  private pendingSpawns = 0
  private spawnTimer = 0
  private horde: Horde
  private getSpawns: () => THREE.Vector3[]
  private events: WaveEvents

  constructor(horde: Horde, getSpawns: () => THREE.Vector3[], events: WaveEvents = {}) {
    this.horde = horde
    this.getSpawns = getSpawns
    this.events = events
  }

  /** Call whenever the player count changes (join/leave) — solo stays at 1.0. */
  setPlayerCount(count: number) {
    this.playerMultiplier = 1 + Math.max(0, count - 1) * 0.75
  }

  get maxAlive(): number {
    return Math.round(BASE_MAX_ALIVE * this.playerMultiplier)
  }

  begin() {
    this.phase = 'intermission'
    this.wave = 0
    this.kills = 0
    this.timer = FIRST_WAVE_DELAY
  }

  /** Host migration: continue an in-progress game instead of restarting the wave clock. */
  resumeAt(wave: number, phase: WavePhase) {
    this.wave = Math.max(wave, 1)
    if (phase === 'intermission') {
      this.phase = 'intermission'
      this.timer = 4
    } else {
      this.phase = 'active'
      // the surviving horde covers the rest of this wave — don't double-spawn
      this.pendingSpawns = 0
      this.spawnTimer = SPAWN_INTERVAL
    }
  }

  zombieCount(wave: number): number {
    const base = Math.min(5 + (wave - 1) * 3, 32)
    return Math.round(base * this.playerMultiplier)
  }

  zombieHp(wave: number): number {
    return Math.round(60 * (1 + 0.17 * (wave - 1)))
  }

  /** No runners at all before wave 6 — then a growing share, capped. */
  runnerChance(wave: number): number {
    if (wave < RUNNER_START_WAVE) return 0
    return Math.min((wave - RUNNER_START_WAVE + 1) * 0.08, 0.55)
  }

  midgetChance(wave: number): number {
    if (wave < MIDGET_START_WAVE) return 0
    return Math.min(0.08 + (wave - MIDGET_START_WAVE) * 0.02, 0.22)
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
      if (this.spawnTimer <= 0 && this.horde.aliveCount < this.maxAlive) {
        const spawns = this.getSpawns()
        if (spawns.length === 0) return
        this.spawnTimer = SPAWN_INTERVAL
        this.pendingSpawns--
        const p = spawns[Math.floor(Math.random() * spawns.length)]
        const jitter = new THREE.Vector3(
          (Math.random() - 0.5) * 1.4,
          0,
          (Math.random() - 0.5) * 1.4,
        )
        const isMidget = Math.random() < this.midgetChance(this.wave)
        const runner = !isMidget && Math.random() < this.runnerChance(this.wave)
        this.horde.spawn(
          p.clone().add(jitter),
          isMidget ? Math.round(this.zombieHp(this.wave) / 2) : this.zombieHp(this.wave),
          runner,
          isMidget,
          this.wave,
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
