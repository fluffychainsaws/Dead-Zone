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
  garand: {
    id: 'garand',
    name: 'M1 GARAND',
    damage: 72,
    headshotMult: 3,
    rpm: 170,
    magSize: 8,
    maxReserve: 96,
    reloadTime: 1.6,
    spread: 0.006,
    auto: false,
    pellets: 1,
  },
  trench: {
    id: 'trench',
    name: 'TRENCH GUN',
    damage: 13,
    headshotMult: 2,
    rpm: 66,
    magSize: 6,
    maxReserve: 48,
    reloadTime: 2.4,
    spread: 0.065,
    auto: false,
    pellets: 8,
  },
  kurz: {
    id: 'kurz',
    name: 'KURZ-9',
    damage: 24,
    headshotMult: 2.2,
    rpm: 720,
    magSize: 32,
    maxReserve: 192,
    reloadTime: 1.9,
    spread: 0.028,
    auto: true,
    pellets: 1,
  },
  magnum: {
    id: 'magnum',
    name: 'WARDEN .44',
    damage: 90,
    headshotMult: 3.5,
    rpm: 150,
    magSize: 6,
    maxReserve: 60,
    reloadTime: 2.0,
    spread: 0.005,
    auto: false,
    pellets: 1,
  },
  liberator: {
    id: 'liberator',
    name: 'LIBERATOR',
    damage: 45,
    headshotMult: 2.6,
    rpm: 480,
    magSize: 20,
    maxReserve: 160,
    reloadTime: 2.2,
    spread: 0.02,
    auto: true,
    pellets: 1,
  },
  hellfire: {
    id: 'hellfire',
    name: 'HELLFIRE',
    damage: 14,
    headshotMult: 2,
    rpm: 180,
    magSize: 8,
    maxReserve: 64,
    reloadTime: 2.6,
    spread: 0.08,
    auto: true,
    pellets: 8,
  },
}

export interface ShotHit {
  point: THREE.Vector3
  object: THREE.Object3D | null
  distance: number
}

export class WeaponInstance {
  def: WeaponDef
  mag: number
  reserve: number
  viewmodel: THREE.Group

  constructor(def: WeaponDef) {
    this.def = def
    this.mag = def.magSize
    this.reserve = def.maxReserve
    this.viewmodel = buildViewmodel(def.id)
  }
}

export interface WeaponEvents {
  fired: boolean
  dryFired: boolean
  reloadStarted: boolean
}

export class WeaponSystem {
  slots: WeaponInstance[] = []
  activeIdx = 0
  reloading = false
  events: WeaponEvents = { fired: false, dryFired: false, reloadStarted: false }

  private cooldown = 0
  private reloadT = 0
  private kick = 0
  private raycaster = new THREE.Raycaster()
  private camera: THREE.PerspectiveCamera
  private visible = false

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
    this.give(WEAPONS.pistol)
  }

  get active(): WeaponInstance {
    return this.slots[this.activeIdx]
  }

  get def(): WeaponDef {
    return this.active.def
  }

  get mag(): number {
    return this.active.mag
  }

  get reserve(): number {
    return this.active.reserve
  }

  owns(defId: string): boolean {
    return this.slots.some((s) => s.def.id === defId)
  }

  allDefs(): Record<string, WeaponDef> {
    return WEAPONS
  }

  /** Add a weapon: fills a free slot or replaces the active one. */
  give(def: WeaponDef) {
    this.cancelReload()
    const inst = new WeaponInstance(def)
    this.camera.add(inst.viewmodel)
    if (this.slots.length < 2) {
      this.slots.push(inst)
      this.activeIdx = this.slots.length - 1
    } else {
      const old = this.slots[this.activeIdx]
      this.camera.remove(old.viewmodel)
      this.slots[this.activeIdx] = inst
    }
    this.syncVisibility()
  }

  refill(defId: string) {
    const inst = this.slots.find((s) => s.def.id === defId)
    if (inst) inst.reserve = inst.def.maxReserve
  }

  switchNext() {
    if (this.slots.length < 2) return
    this.cancelReload()
    this.activeIdx = (this.activeIdx + 1) % this.slots.length
    this.kick = 0.6 // small raise animation
    this.syncVisibility()
  }

  setVisible(v: boolean) {
    this.visible = v
    this.syncVisibility()
  }

  private syncVisibility() {
    this.slots.forEach((s, i) => {
      s.viewmodel.visible = this.visible && i === this.activeIdx
    })
  }

  private cancelReload() {
    this.reloading = false
    if (this.slots[this.activeIdx]) this.active.viewmodel.rotation.x = 0
  }

  /** Returns hits for shots fired this frame (empty array if none). */
  update(
    dt: number,
    input: Input,
    camera: THREE.PerspectiveCamera,
    targets: THREE.Object3D[],
    effects: Effects,
  ): ShotHit[] {
    this.events = { fired: false, dryFired: false, reloadStarted: false }
    if (input.consumeSwitch()) this.switchNext()

    const w = this.active
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.kick = Math.max(0, this.kick - dt * 6)

    if (this.reloading) {
      this.reloadT -= dt
      w.viewmodel.rotation.x = -0.7 * Math.sin((1 - this.reloadT / w.def.reloadTime) * Math.PI)
      if (this.reloadT <= 0) {
        this.reloading = false
        const need = w.def.magSize - w.mag
        const take = Math.min(need, w.reserve)
        w.mag += take
        w.reserve -= take
        w.viewmodel.rotation.x = 0
      }
      return []
    }

    if (input.consumeReload() && w.mag < w.def.magSize && w.reserve > 0) {
      this.startReload()
      return []
    }

    const wantsFire = w.def.auto ? input.fireHeld : input.consumeFirePress()
    if (!wantsFire || this.cooldown > 0) {
      this.applyViewmodelMotion()
      return []
    }
    if (w.mag <= 0) {
      if (w.reserve > 0) this.startReload()
      else this.events.dryFired = true
      this.applyViewmodelMotion()
      return []
    }

    // fire!
    this.events.fired = true
    w.mag--
    this.cooldown = 60 / w.def.rpm
    this.kick = 1

    const hits: ShotHit[] = []
    const muzzle = new THREE.Vector3()
    w.viewmodel.children[0].getWorldPosition(muzzle)
    effects.muzzleFlash(muzzle)

    for (let p = 0; p < w.def.pellets; p++) {
      const dir = new THREE.Vector3()
      camera.getWorldDirection(dir)
      dir.x += (Math.random() - 0.5) * 2 * w.def.spread
      dir.y += (Math.random() - 0.5) * 2 * w.def.spread
      dir.z += (Math.random() - 0.5) * 2 * w.def.spread
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
    this.reloadT = this.active.def.reloadTime
    this.events.reloadStarted = true
  }

  private applyViewmodelMotion() {
    const vm = this.active.viewmodel
    vm.position.set(0.28, -0.26 - this.kick * 0.01, -0.55 + this.kick * 0.06)
    vm.rotation.x = this.kick * 0.09
  }
}

export function buildViewmodel(defId: string): THREE.Group {
  const g = new THREE.Group()
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.55, metalness: 0.5 })
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 0.85 })
  const grip = new THREE.MeshStandardMaterial({ color: 0x3a2d20, roughness: 0.9 })

  // First child is always the muzzle anchor (barrel tip).
  if (defId === 'garand') {
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.55), dark)
    barrel.position.set(0, 0.02, -0.35)
    g.add(barrel)
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.5), wood)
    stock.position.set(0, -0.02, 0.02)
    g.add(stock)
    const butt = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.12, 0.18), wood)
    butt.position.set(0, -0.05, 0.3)
    g.add(butt)
  } else if (defId === 'trench') {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6), dark)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.03, -0.32)
    g.add(barrel)
    const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22), wood)
    pump.rotation.x = Math.PI / 2
    pump.position.set(0, -0.01, -0.28)
    g.add(pump)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.3), dark)
    body.position.set(0, 0, 0)
    g.add(body)
    const butt = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.11, 0.2), wood)
    butt.position.set(0, -0.04, 0.24)
    g.add(butt)
  } else if (defId === 'kurz') {
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.3), dark)
    barrel.position.set(0, 0.02, -0.28)
    g.add(barrel)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.32), dark)
    g.add(body)
    const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.22, 0.07), dark)
    magazine.position.set(0, -0.15, -0.05)
    magazine.rotation.x = 0.12
    g.add(magazine)
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.06), grip)
    handle.position.set(0, -0.1, 0.12)
    g.add(handle)
  } else if (defId === 'magnum') {
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.34), dark)
    barrel.position.set(0, 0.03, -0.18)
    g.add(barrel)
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.09), dark)
    cylinder.rotation.z = Math.PI / 2
    cylinder.rotation.y = Math.PI / 2
    cylinder.position.set(0, 0, 0.0)
    g.add(cylinder)
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), wood)
    handle.position.set(0, -0.1, 0.07)
    handle.rotation.x = 0.3
    g.add(handle)
  } else if (defId === 'liberator') {
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.055, 0.62), dark)
    barrel.position.set(0, 0.02, -0.4)
    g.add(barrel)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.34), dark)
    g.add(body)
    const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.08), dark)
    magazine.position.set(0, -0.14, -0.08)
    g.add(magazine)
    const butt = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.11, 0.2), wood)
    butt.position.set(0, -0.03, 0.26)
    g.add(butt)
  } else if (defId === 'hellfire') {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.5), dark)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.04, -0.3)
    g.add(barrel)
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.07), dark)
    drum.rotation.z = Math.PI / 2
    drum.rotation.y = Math.PI / 2
    drum.position.set(0, -0.08, -0.05)
    g.add(drum)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.1, 0.32), dark)
    g.add(body)
    const butt = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.11, 0.18), wood)
    butt.position.set(0, -0.03, 0.24)
    g.add(butt)
  } else {
    // pistol
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
  }
  g.position.set(0.28, -0.26, -0.55)
  return g
}
