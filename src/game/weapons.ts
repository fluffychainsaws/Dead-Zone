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
  /** Viewmodel/sound archetype — defaults to the weapon's own id. */
  model?:
    | 'pistol'
    | 'garand'
    | 'trench'
    | 'kurz'
    | 'magnum'
    | 'liberator'
    | 'hellfire'
    | 'mg'
    | 'sniper'
    | 'saw'
    | 'ww2smg'
    | 'vietnam'
    | 'm4'
    | 'mp5'
    | 'sniper50'
    | 'p90'
    | 'dualpistols'
    | 'chainsaw'
    | 'flamethrower'
  /** Aim-down-sights: FOV multiplier while aiming, and whether it's a true magnified scope. */
  ads?: { zoom: number; scope?: boolean }
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
    ads: { zoom: 0.92 },
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
    ads: { zoom: 0.8 },
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
    ads: { zoom: 0.95 },
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
    ads: { zoom: 0.9 },
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
    ads: { zoom: 0.9 },
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
    ads: { zoom: 0.88 },
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
    ads: { zoom: 0.95 },
  },
  grinder: {
    id: 'grinder',
    name: 'M1919 GRINDER',
    damage: 38,
    headshotMult: 2.4,
    rpm: 550,
    magSize: 100,
    maxReserve: 300,
    reloadTime: 4.0,
    spread: 0.034,
    auto: true,
    pellets: 1,
    model: 'mg',
    ads: { zoom: 0.9 },
  },
}

// Weapons that only come out of the Mystery Box — never on a wall.
const box = (
  id: string,
  name: string,
  model: NonNullable<WeaponDef['model']>,
  stats: Pick<
    WeaponDef,
    'damage' | 'headshotMult' | 'rpm' | 'magSize' | 'maxReserve' | 'reloadTime' | 'spread' | 'auto' | 'pellets'
  >,
  ads?: WeaponDef['ads'],
): WeaponDef => ({ id, name, model, ads, ...stats })

export const BOX_WEAPONS: WeaponDef[] = [
  box('vampir', 'VAMPIR MP40', 'ww2smg', { damage: 30, headshotMult: 2.2, rpm: 850, magSize: 40, maxReserve: 240, reloadTime: 2.0, spread: 0.03, auto: true, pellets: 1 }, { zoom: 0.88 }),
  box('reaper', 'REAPER SAW', 'saw', { damage: 40, headshotMult: 2.4, rpm: 600, magSize: 120, maxReserve: 360, reloadTime: 4.2, spread: 0.032, auto: true, pellets: 1 }, { zoom: 0.9 }),
  box('dragon', 'DRAGON’S BREATH', 'trench', { damage: 15, headshotMult: 2, rpm: 90, magSize: 8, maxReserve: 56, reloadTime: 2.4, spread: 0.09, auto: false, pellets: 10 }, { zoom: 0.95 }),
  box('longtooth', 'LONGTOOTH', 'sniper', { damage: 250, headshotMult: 5, rpm: 45, magSize: 5, maxReserve: 40, reloadTime: 2.8, spread: 0.001, auto: false, pellets: 1 }, { zoom: 0.35, scope: true }),
  box('twins', 'THE TWINS', 'pistol', { damage: 34, headshotMult: 2.5, rpm: 900, magSize: 16, maxReserve: 128, reloadTime: 1.8, spread: 0.04, auto: true, pellets: 1 }, { zoom: 0.9 }),
  box('ripsaw', 'RIPSAW', 'mg', { damage: 34, headshotMult: 2.2, rpm: 1000, magSize: 150, maxReserve: 300, reloadTime: 4.6, spread: 0.045, auto: true, pellets: 1 }, { zoom: 0.9 }),
  box('judge', 'THE JUDGE', 'magnum', { damage: 130, headshotMult: 4, rpm: 120, magSize: 5, maxReserve: 40, reloadTime: 2.2, spread: 0.004, auto: false, pellets: 1 }, { zoom: 0.88 }),
  box('sweeper', 'STREET SWEEPER', 'hellfire', { damage: 13, headshotMult: 2, rpm: 240, magSize: 12, maxReserve: 72, reloadTime: 2.8, spread: 0.085, auto: true, pellets: 8 }, { zoom: 0.95 }),
  box('needler', 'NEEDLER-47', 'vietnam', { damage: 20, headshotMult: 2.2, rpm: 1100, magSize: 60, maxReserve: 300, reloadTime: 2.2, spread: 0.035, auto: true, pellets: 1 }, { zoom: 0.88 }),
  box('bear', 'BEAR KILLER', 'garand', { damage: 110, headshotMult: 3.5, rpm: 140, magSize: 10, maxReserve: 80, reloadTime: 2.0, spread: 0.006, auto: false, pellets: 1 }, { zoom: 0.8 }),
  box('spitfire', 'SPITFIRE', 'mg', { damage: 28, headshotMult: 2.2, rpm: 750, magSize: 100, maxReserve: 400, reloadTime: 3.6, spread: 0.03, auto: true, pellets: 1 }, { zoom: 0.9 }),
  box('widow', 'WIDOWMAKER', 'liberator', { damage: 85, headshotMult: 3, rpm: 260, magSize: 12, maxReserve: 96, reloadTime: 2.0, spread: 0.004, auto: false, pellets: 1 }, { zoom: 0.88 }),
  box('hammer', 'WAR HAMMER', 'mg', { damage: 55, headshotMult: 2.5, rpm: 420, magSize: 110, maxReserve: 220, reloadTime: 4.4, spread: 0.04, auto: true, pellets: 1 }, { zoom: 0.9 }),
  box('hornet', 'HORNET', 'pistol', { damage: 22, headshotMult: 2.2, rpm: 950, magSize: 30, maxReserve: 210, reloadTime: 1.7, spread: 0.05, auto: true, pellets: 1 }, { zoom: 0.92 }),
  box('goliath', 'GOLIATH .50', 'sniper', { damage: 400, headshotMult: 4, rpm: 30, magSize: 3, maxReserve: 21, reloadTime: 3.4, spread: 0.002, auto: false, pellets: 1 }, { zoom: 0.3, scope: true }),

  // ---- real-world-inspired arsenal ----
  box('m4carbine', 'M4 CARBINE', 'm4', { damage: 40, headshotMult: 2.6, rpm: 750, magSize: 30, maxReserve: 240, reloadTime: 2.0, spread: 0.018, auto: true, pellets: 1 }, { zoom: 0.82 }),
  box('m240', 'M240', 'mg', { damage: 42, headshotMult: 2.3, rpm: 650, magSize: 200, maxReserve: 400, reloadTime: 4.5, spread: 0.036, auto: true, pellets: 1 }, { zoom: 0.92 }),
  box('ak47', 'AK-47', 'vietnam', { damage: 38, headshotMult: 2.4, rpm: 600, magSize: 30, maxReserve: 210, reloadTime: 2.0, spread: 0.024, auto: true, pellets: 1 }, { zoom: 0.9 }),
  box('mp5', 'MP5', 'mp5', { damage: 26, headshotMult: 2.2, rpm: 800, magSize: 30, maxReserve: 270, reloadTime: 1.8, spread: 0.02, auto: true, pellets: 1 }, { zoom: 0.88 }),
  box('barrett50', 'BARRETT .50 CAL', 'sniper50', { damage: 350, headshotMult: 4.5, rpm: 35, magSize: 5, maxReserve: 35, reloadTime: 3.0, spread: 0.001, auto: false, pellets: 1 }, { zoom: 0.28, scope: true }),
  box('p90', 'P90', 'p90', { damage: 27, headshotMult: 2.2, rpm: 900, magSize: 50, maxReserve: 300, reloadTime: 2.0, spread: 0.024, auto: true, pellets: 1 }, { zoom: 0.88 }),
  box('m249saw', 'M249 SAW', 'saw', { damage: 38, headshotMult: 2.3, rpm: 680, magSize: 150, maxReserve: 450, reloadTime: 4.0, spread: 0.03, auto: true, pellets: 1 }, { zoom: 0.92 }),
  box('akimbo', 'AKIMBO 1911S', 'dualpistols', { damage: 30, headshotMult: 2.3, rpm: 500, magSize: 32, maxReserve: 192, reloadTime: 1.6, spread: 0.028, auto: true, pellets: 2 }, { zoom: 0.95 }),
  box('chainsaw', 'CHAINSAW', 'chainsaw', { damage: 9, headshotMult: 1.4, rpm: 1200, magSize: 999, maxReserve: 999, reloadTime: 0.1, spread: 0.05, auto: true, pellets: 1 }),
  box('flamethrower', 'FLAMETHROWER', 'flamethrower', { damage: 6, headshotMult: 1.2, rpm: 1800, magSize: 120, maxReserve: 360, reloadTime: 3.5, spread: 0.05, auto: true, pellets: 3 }),
]

export const ALL_WEAPONS: Record<string, WeaponDef> = {
  ...WEAPONS,
  ...Object.fromEntries(BOX_WEAPONS.map((w) => [w.id, w])),
}

/** Visual/sound archetype for a weapon id — several weapons can share one look+sound. */
export function weaponKind(id: string): string {
  return ALL_WEAPONS[id]?.model ?? id
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
  /** Muzzle world position from the most recent shot — for broadcasting shot fx to peers. */
  lastMuzzle = new THREE.Vector3()
  /** True while the active weapon supports ADS and the aim button is held. */
  aiming = false

  private cooldown = 0
  private reloadT = 0
  private kick = 0
  private meleeT = 0
  private aimK = 0 // smoothed 0..1 aim-down-sights blend
  private raycaster = new THREE.Raycaster()
  private camera: THREE.PerspectiveCamera
  private visible = false
  private stashedIdx: number | null = null
  private downedTemp: WeaponInstance | null = null
  private downedMode = false

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
    this.give(WEAPONS.pistol)
  }

  /** Going down swaps to a sidearm — your own pistol, or a loaner with 3 mags. */
  enterDowned() {
    if (this.downedMode) return
    this.downedMode = true
    this.cancelReload()
    this.stashedIdx = this.activeIdx
    const pistolIdx = this.slots.findIndex((s) => s.def.id === 'pistol')
    if (pistolIdx >= 0) {
      this.activeIdx = pistolIdx
    } else {
      this.downedTemp = new WeaponInstance(WEAPONS.pistol)
      this.downedTemp.reserve = 16
      this.camera.add(this.downedTemp.viewmodel)
      this.slots.push(this.downedTemp)
      this.activeIdx = this.slots.length - 1
    }
    this.syncVisibility()
  }

  exitDowned() {
    if (!this.downedMode) return
    this.downedMode = false
    this.cancelReload()
    if (this.downedTemp) {
      this.camera.remove(this.downedTemp.viewmodel)
      this.slots.pop()
      this.downedTemp = null
    }
    this.activeIdx = Math.min(this.stashedIdx ?? 0, this.slots.length - 1)
    this.stashedIdx = null
    this.syncVisibility()
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
    return ALL_WEAPONS
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
    if (this.downedMode || this.slots.length < 2) return
    this.cancelReload()
    this.activeIdx = (this.activeIdx + 1) % this.slots.length
    this.kick = 0.6 // small raise animation
    this.syncVisibility()
  }

  /** Kicks off the gun-bash melee lunge animation (called once per swing). */
  triggerMelee() {
    this.meleeT = 0.25
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
    this.meleeT = Math.max(0, this.meleeT - dt)

    this.aiming = !!(w.def.ads && input.aimHeld && !this.reloading)
    this.aimK += ((this.aiming ? 1 : 0) - this.aimK) * Math.min(1, dt * 12)
    // a true scope hides the gun model once you're mostly aimed in
    if (w.def.ads?.scope) w.viewmodel.visible = this.visible && this.aimK < 0.85

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
    this.lastMuzzle.copy(muzzle)
    effects.muzzleFlash(muzzle)

    const spread = this.aiming ? w.def.spread * 0.15 : w.def.spread
    for (let p = 0; p < w.def.pellets; p++) {
      const dir = new THREE.Vector3()
      camera.getWorldDirection(dir)
      dir.x += (Math.random() - 0.5) * 2 * spread
      dir.y += (Math.random() - 0.5) * 2 * spread
      dir.z += (Math.random() - 0.5) * 2 * spread
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
    // gun-bash melee: a quick forward-and-down thrust, independent of firing kick
    const meleeK = this.meleeT > 0 ? Math.sin((1 - this.meleeT / 0.25) * Math.PI) : 0
    // ADS: raise the sights toward center screen. Kept close to the hip depth (rather
    // than pulled in tight to the camera) and slightly scaled down so the gun's body
    // doesn't balloon up and block the view — only the sight itself should sit on the
    // crosshair. Scoped weapons go further and hide behind the scope overlay instead.
    const hipX = 0.28
    const hipY = -0.26
    const hipZ = -0.55
    const aimX = 0
    const aimY = -0.15
    const aimZ = -0.5
    const k = this.aimK
    vm.position.set(
      hipX + (aimX - hipX) * k,
      hipY + (aimY - hipY) * k - this.kick * 0.01 - meleeK * 0.05,
      hipZ + (aimZ - hipZ) * k + this.kick * 0.06 - meleeK * 0.35,
    )
    vm.scale.setScalar(1 - 0.14 * k)
    vm.rotation.x = this.kick * 0.09 - meleeK * 0.5
  }
}

export function buildViewmodel(defId: string): THREE.Group {
  const g = new THREE.Group()
  const dark = new THREE.MeshPhongMaterial({ color: 0x2b2b30, shininess: 45 })
  const wood = new THREE.MeshLambertMaterial({ color: 0x4a3520 })
  const grip = new THREE.MeshLambertMaterial({ color: 0x3a2d20 })
  const kind = weaponKind(defId)
  const drab = new THREE.MeshLambertMaterial({ color: 0x3d4a34 }) // olive-drab furniture

  // First child is always the muzzle anchor (barrel tip).
  if (kind === 'saw') {
    // M249-style: bipod + top-forward box mag set it apart from the belt-fed 'mg'
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.72, 8), dark)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.04, -0.46)
    g.add(barrel)
    const foresight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.02), dark)
    foresight.position.set(0, 0.11, -0.68)
    g.add(foresight)
    const handguard = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.32, 8), drab)
    handguard.rotation.x = Math.PI / 2
    handguard.position.set(0, 0.02, -0.28)
    g.add(handguard)
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.02), dark)
      leg.position.set(side * 0.09, -0.08, -0.42)
      leg.rotation.z = side * 0.35
      g.add(leg)
    }
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.36), drab)
    g.add(body)
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.09), dark)
    mag.position.set(0, 0.14, -0.1) // top-mounted, unlike the SAW's belt box
    g.add(mag)
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.22), drab)
    stock.position.set(0, -0.01, 0.27)
    g.add(stock)
  } else if (kind === 'ww2smg') {
    // Thompson-style: drum magazine + vertical foregrip + wood furniture
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.34, 8), dark)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.03, -0.32)
    g.add(barrel)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.28), dark)
    g.add(body)
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 12), dark)
    drum.rotation.x = Math.PI / 2
    drum.position.set(0, -0.13, -0.06)
    g.add(drum)
    const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.04), wood)
    foregrip.position.set(0, -0.09, -0.24)
    g.add(foregrip)
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.24), wood)
    stock.position.set(0, -0.02, 0.24)
    g.add(stock)
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.1, 0.05), wood)
    handle.position.set(0, -0.09, 0.08)
    handle.rotation.x = 0.3
    g.add(handle)
  } else if (kind === 'vietnam') {
    // AK-style: curved banana magazine is the unmistakable silhouette here
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.42, 8), dark)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.03, -0.36)
    g.add(barrel)
    const foresight = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.07, 0.018), dark)
    foresight.position.set(0, 0.09, -0.55)
    g.add(foresight)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.1, 0.34), dark)
    g.add(body)
    // curved magazine: two angled segments approximate the banana curve
    const magUpper = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.14, 0.055), dark)
    magUpper.position.set(0, -0.1, -0.05)
    magUpper.rotation.x = 0.22
    g.add(magUpper)
    const magLower = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.13, 0.05), dark)
    magLower.position.set(0, -0.21, -0.14)
    magLower.rotation.x = 0.5
    g.add(magLower)
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.18), wood)
    handguard.position.set(0, -0.01, -0.32)
    g.add(handguard)
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.26), wood)
    stock.position.set(0, -0.01, 0.27)
    g.add(stock)
  } else if (kind === 'm4') {
    // M4 Carbine: flat-top upper + red dot, telescoping stock
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.4, 8), dark)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.03, -0.4)
    g.add(barrel)
    const foresight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.02), dark)
    foresight.position.set(0, 0.09, -0.58)
    g.add(foresight)
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.06, 0.28), drab)
    handguard.position.set(0, 0.01, -0.32)
    g.add(handguard)
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.075, 0.32), dark)
    upper.position.set(0, 0.03, -0.06)
    g.add(upper)
    // red dot: base + a small glowing lens
    const dotBase = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.05), dark)
    dotBase.position.set(0, 0.095, -0.12)
    g.add(dotBase)
    const dotLens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.025, 10),
      new THREE.MeshBasicMaterial({ color: 0xff2020 }),
    )
    dotLens.rotation.z = Math.PI / 2
    dotLens.position.set(0, 0.1, -0.12)
    g.add(dotLens)
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.24, 0.08), drab)
    mag.position.set(0, -0.16, -0.02)
    mag.rotation.x = 0.1
    g.add(mag)
    const m4Grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.05), grip)
    m4Grip.position.set(0, -0.1, 0.08)
    m4Grip.rotation.x = 0.3
    g.add(m4Grip)
    const stockTube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 8), dark)
    stockTube.rotation.x = Math.PI / 2
    stockTube.position.set(0, 0.03, 0.24)
    g.add(stockTube)
    const stockPad = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.05), drab)
    stockPad.position.set(0, 0.02, 0.33)
    g.add(stockPad)
  } else if (kind === 'mp5') {
    // MP5: slim profile, curved mag, rotary rear sight, retractable stock
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.28, 8), dark)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.025, -0.28)
    g.add(barrel)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.09, 0.32), dark)
    g.add(body)
    const rearSight = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 10), dark)
    rearSight.rotation.x = Math.PI / 2
    rearSight.position.set(0, 0.075, 0.02)
    g.add(rearSight)
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.06), dark)
    mag.position.set(0, -0.14, -0.04)
    mag.rotation.x = 0.16
    g.add(mag)
    const mp5Grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.11, 0.05), grip)
    mp5Grip.position.set(0, -0.08, 0.1)
    mp5Grip.rotation.x = 0.25
    g.add(mp5Grip)
    const stockTube = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.18, 8), dark)
    stockTube.rotation.x = Math.PI / 2
    stockTube.position.set(0, 0.01, 0.24)
    g.add(stockTube)
  } else if (kind === 'sniper50') {
    // .50 cal: long barrel, prominent muzzle brake, bipod, big 3x scope
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.95, 8), dark)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.04, -0.6)
    g.add(barrel)
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 8), dark)
    brake.rotation.x = Math.PI / 2
    brake.position.set(0, 0.04, -1.02)
    g.add(brake)
    for (const side of [-1, 1]) {
      const port = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.02, 0.03), dark)
      port.position.set(side * 0.035, 0.04, -1.02)
      g.add(port)
    }
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.24, 0.02), dark)
      leg.position.set(side * 0.08, -0.1, -0.55)
      leg.rotation.z = side * 0.3
      g.add(leg)
    }
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.11, 0.45), dark)
    g.add(body)
    const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.34, 10), dark)
    scopeTube.rotation.x = Math.PI / 2
    scopeTube.position.set(0, 0.13, -0.15)
    g.add(scopeTube)
    for (const zOff of [-0.26, -0.06]) {
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 8), dark)
      turret.position.set(0, 0.16, zOff)
      g.add(turret)
    }
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.3), dark)
    stock.position.set(0, -0.02, 0.32)
    g.add(stock)
  } else if (kind === 'p90') {
    // P90: bullpup body with the signature top-mounted, front-to-back magazine
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.18, 8), dark)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0, -0.32)
    g.add(barrel)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.44), drab)
    body.position.set(0, 0, -0.02)
    g.add(body)
    const mag = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.06, 0.36),
      new THREE.MeshPhongMaterial({ color: 0x9fb8c0, transparent: true, opacity: 0.55, shininess: 70 }),
    )
    mag.position.set(0, 0.08, -0.03)
    g.add(mag)
    const sightRail = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.02, 0.3), dark)
    sightRail.position.set(0, 0.11, -0.03)
    g.add(sightRail)
    const p90Grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.05), grip)
    p90Grip.position.set(0, -0.09, 0.08)
    p90Grip.rotation.x = 0.35
    g.add(p90Grip)
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.1), dark)
    trigger.position.set(0, -0.04, 0.1)
    g.add(trigger)
  } else if (kind === 'dualpistols') {
    // Akimbo: two mirrored pistols side by side
    for (const side of [-1, 1]) {
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.065, 0.28), dark)
      slide.position.set(side * 0.13, 0.01, -0.12)
      g.add(slide)
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.14), dark)
      body.position.set(side * 0.13, -0.03, 0)
      g.add(body)
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.055), grip)
      handle.position.set(side * 0.13, -0.11, 0.05)
      handle.rotation.x = 0.25
      g.add(handle)
    }
  } else if (kind === 'chainsaw') {
    // Gas chainsaw: engine block + guide bar + chain, rear handle with trigger
    const chainMat = new THREE.MeshPhongMaterial({ color: 0x1c1c1e, shininess: 70 })
    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.14, 0.22), drab)
    engine.position.set(0, -0.02, 0.06)
    g.add(engine)
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.58), dark)
    bar.position.set(0, 0.0, -0.28)
    g.add(bar)
    for (const side of [-1, 1]) {
      const chain = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.095, 0.58), chainMat)
      chain.position.set(side * 0.017, 0.0, -0.28)
      g.add(chain)
    }
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 10), dark)
    tip.rotation.x = Math.PI / 2
    tip.position.set(0, 0, -0.56)
    g.add(tip)
    const pullCord = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 10), chainMat)
    pullCord.rotation.z = Math.PI / 2
    pullCord.position.set(0.08, 0.02, 0.14)
    g.add(pullCord)
    const rearHandle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.13, 0.06), dark)
    rearHandle.position.set(0, -0.11, 0.16)
    rearHandle.rotation.x = 0.3
    g.add(rearHandle)
    const frontHandle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.03), dark)
    frontHandle.position.set(0, 0.07, -0.02)
    g.add(frontHandle)
  } else if (kind === 'flamethrower') {
    // Wand + pilot light + a side fuel tank feeding the nozzle
    const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 10), dark)
    wand.rotation.x = Math.PI / 2
    wand.position.set(0, 0.0, -0.28)
    g.add(wand)
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.12, 10), dark)
    nozzle.rotation.x = Math.PI / 2
    nozzle.position.set(0, 0.0, -0.55)
    g.add(nozzle)
    const pilotLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff7710 }),
    )
    pilotLight.position.set(0, 0, -0.62)
    g.add(pilotLight)
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.26, 10), drab)
    tank.rotation.z = Math.PI / 2
    tank.position.set(0.02, -0.14, 0.14)
    g.add(tank)
    const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 8), dark)
    hose.position.set(0.02, -0.02, -0.02)
    hose.rotation.x = 0.9
    g.add(hose)
    const flameGrip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.05), grip)
    flameGrip.position.set(0, -0.1, 0.02)
    flameGrip.rotation.x = 0.3
    g.add(flameGrip)
  } else if (kind === 'mg') {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.66, 8), dark)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.03, -0.42)
    g.add(barrel)
    const jacket = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), dark)
    jacket.rotation.x = Math.PI / 2
    jacket.position.set(0, 0.03, -0.25)
    g.add(jacket)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.4), dark)
    g.add(body)
    const beltBox = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.18), grip)
    beltBox.position.set(0, -0.14, -0.02)
    g.add(beltBox)
    const butt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, 0.2), wood)
    butt.position.set(0, -0.02, 0.28)
    g.add(butt)
  } else if (kind === 'sniper') {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.85, 8), dark)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.03, -0.5)
    g.add(barrel)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.4), wood)
    g.add(body)
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 8), dark)
    scope.rotation.x = Math.PI / 2
    scope.position.set(0, 0.1, -0.05)
    g.add(scope)
    const butt = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.12, 0.24), wood)
    butt.position.set(0, -0.03, 0.28)
    g.add(butt)
  } else if (kind === 'garand') {
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.55), dark)
    barrel.position.set(0, 0.02, -0.35)
    g.add(barrel)
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.5), wood)
    stock.position.set(0, -0.02, 0.02)
    g.add(stock)
    const butt = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.12, 0.18), wood)
    butt.position.set(0, -0.05, 0.3)
    g.add(butt)
  } else if (kind === 'trench') {
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
  } else if (kind === 'kurz') {
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
  } else if (kind === 'magnum') {
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
  } else if (kind === 'liberator') {
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
  } else if (kind === 'hellfire') {
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
