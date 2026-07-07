import * as THREE from 'three'
import type { Input } from './input'
import type { Effects } from './effects'

export interface WeaponDef {
  id: string
  name: string
  damage: number
  headshotMult: number
  rpm: number
  magSize: number
  maxReserve: number
  reloadTime: number
  spread: number // radians
  auto: boolean
  pellets: number
}

export const WEAPONS: Record<string, WeaponDef> = {
  pistol: {
    id: 'pistol',
    name: 'M1911',
    damage: 34,
    headshotMult: 2.5,
    rpm: 320,
    magSize: 8,
    maxReserve: 64,
    reloadTime: 1.3,
    spread: 0.012,
    auto: false,
    pellets: 1,
  },
}

export interface ShotHit {
  point: THREE.Vector3
  object: THREE.Object3D | null
  distance: number
}

export class WeaponSystem {
  def: WeaponDef
  mag: number
  reserve: number
  reloading = false

  private cooldown = 0
  private reloadT = 0
  private kick = 0
  private raycaster = new THREE.Raycaster()
  viewmodel: THREE.Group

  constructor(def: WeaponDef, camera: THREE.PerspectiveCamera) {
    this.def = def
    this.mag = def.magSize
    this.reserve = def.maxReserve
    this.viewmodel = buildViewmodel()
    camera.add(this.viewmodel)
  }

  /** Returns hits for shots fired this frame (empty array if none). */
  update(
    dt: number,
    input: Input,
    camera: THREE.PerspectiveCamera,
    targets: THREE.Object3D[],
    effects: Effects,
  ): ShotHit[] {
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.kick = Math.max(0, this.kick - dt * 6)

    if (this.reloading) {
      this.reloadT -= dt
      this.viewmodel.rotation.x = -0.7 * Math.sin((1 - this.reloadT / this.def.reloadTime) * Math.PI)
      if (this.reloadT <= 0) {
        this.reloading = false
        const need = this.def.magSize - this.mag
        const take = Math.min(need, this.reserve)
        this.mag += take
        this.reserve -= take
        this.viewmodel.rotation.x = 0
      }
      return []
    }

    if (input.consumeReload() && this.mag < this.def.magSize && this.reserve > 0) {
      this.startReload()
      return []
    }

    const wantsFire = this.def.auto ? input.fireHeld : input.consumeFirePress()
    if (!wantsFire || this.cooldown > 0) {
      this.applyViewmodelMotion()
      return []
    }
    if (this.mag <= 0) {
      if (this.reserve > 0) this.startReload()
      this.applyViewmodelMotion()
      return []
    }

    // fire!
    this.mag--
    this.cooldown = 60 / this.def.rpm
    this.kick = 1

    const hits: ShotHit[] = []
    const muzzle = new THREE.Vector3()
    this.viewmodel.children[0].getWorldPosition(muzzle)
    effects.muzzleFlash(muzzle)

    for (let p = 0; p < this.def.pellets; p++) {
      const dir = new THREE.Vector3()
      camera.getWorldDirection(dir)
      dir.x += (Math.random() - 0.5) * 2 * this.def.spread
      dir.y += (Math.random() - 0.5) * 2 * this.def.spread
      dir.z += (Math.random() - 0.5) * 2 * this.def.spread
      dir.normalize()

      this.raycaster.set(camera.getWorldPosition(new THREE.Vector3()), dir)
      this.raycaster.far = 120
      const intersections = this.raycaster.intersectObjects(targets, true)
      const first = intersections[0]
      const point = first
        ? first.point
        : this.raycaster.ray.origin.clone().addScaledVector(dir, 60)
      hits.push({
        point,
        object: first ? first.object : null,
        distance: first ? first.distance : Infinity,
      })
      effects.tracer(muzzle.clone(), point.clone())
      if (first) effects.impact(point.clone())
    }

    this.applyViewmodelMotion()
    return hits
  }

  private startReload() {
    this.reloading = true
    this.reloadT = this.def.reloadTime
  }

  private applyViewmodelMotion() {
    this.viewmodel.position.set(0.28, -0.26, -0.55 + this.kick * 0.06)
    this.viewmodel.rotation.x = this.kick * 0.09
  }
}

function buildViewmodel(): THREE.Group {
  const g = new THREE.Group()
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.55, metalness: 0.5 })
  const grip = new THREE.MeshStandardMaterial({ color: 0x3a2d20, roughness: 0.9 })
  // barrel/slide — first child, used as the muzzle anchor
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.07, 0.3), dark)
  slide.position.set(0, 0.015, -0.14)
  g.add(slide)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.16), dark)
  body.position.set(0, -0.03, -0.02)
  g.add(body)
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.06), grip)
  handle.position.set(0, -0.11, 0.03)
  handle.rotation.x = 0.25
  g.add(handle)
  g.position.set(0.28, -0.26, -0.55)
  return g
}
