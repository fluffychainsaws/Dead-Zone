import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { makeLabelSprite } from './economy'
import {
  glowSprite,
  GLOW_RED,
  GLOW_GOLD,
  GLOW_CYAN,
  GLOW_BIO,
  GLOW_VIOLET,
} from './effects'

// Blackmarsh Penitentiary — a broken-down jail. Zombies crawl in through
// breached cell walls and boarded windows (player-blocking, zombie-passable);
// locked gates split the block into purchasable rooms.
// All static geometry is merged into one mesh per material to keep draw calls low.

export interface Collider {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  /** Top of the obstacle — players can jump over / stand on anything this low. Omit = wall. */
  height?: number
}

export interface Room {
  id: number
  name: string
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  open: boolean
}

export interface Door {
  id: number
  name: string
  cost: number
  x: number
  z: number
  rooms: [number, number]
  open: boolean
  group: THREE.Group
  colliders: Collider[]
  meshes: THREE.Mesh[]
}

export interface Opening {
  roomId: number
  outside: THREE.Vector3 // zombie spawn point
  inside: THREE.Vector3 // first waypoint after crawling in
  zone: Collider // vault-hop zone straddling the wall
}

/** A boarded-up window — CoD-Zombies style: zombies knock boards down over
 *  time to get through, players can hammer them back up. Players can never
 *  climb out through it regardless of board state (see the full-height
 *  collider in playerColliders) — only the zombie-facing collider toggles. */
export interface WindowBarrier {
  id: number
  pos: THREE.Vector3
  boards: number
  maxBoards: number
  plankMeshes: THREE.Mesh[]
  zombieCollider: Collider
}

const X0 = -30
const X1 = 30
const Z0 = -22
const Z1 = 22
const H = 5 // wall height
const T = 1 // wall thickness
const GATE_W = 3
const WIN_W = 2.6

// The Lab — a bioluminescent basement north of the Showers, reached down a stairwell.
const LAB_X0 = -40
const LAB_X1 = 34
const LAB_Z0 = -70 // far (north) wall
const LAB_CEIL = 4.6 // 15 ft ceilings
const DOME_CX = -3
const DOME_CZ = -50
const DOME_R = 11
const STAIR_X = -26 // stairwell gate + corridor centre
const TUNNEL_SPAWN_OFF = 2.4 // how far outside the wall a tunnel spawn point sits
export const FLASHLIGHT_POS = new THREE.Vector3(-33, 0, -30)
export const NVG_POS = new THREE.Vector3(-19, 0, -30)

export class Arena {
  playerColliders: Collider[] = []
  zombieColliders: Collider[] = []
  colliderMeshes: THREE.Mesh[] = []
  rooms: Room[] = [
    { id: 0, name: 'CELL BLOCK', minX: X0, maxX: X1, minZ: 0, maxZ: Z1, open: true },
    { id: 1, name: 'SHOWERS', minX: X0, maxX: -10, minZ: Z0, maxZ: 0, open: false },
    { id: 2, name: 'WARDEN’S WING', minX: 10, maxX: X1, minZ: Z0, maxZ: 0, open: false },
    { id: 3, name: 'ARMORY', minX: -10, maxX: 10, minZ: Z0, maxZ: 0, open: false },
    { id: 4, name: 'THE LAB', minX: LAB_X0, maxX: LAB_X1, minZ: LAB_Z0, maxZ: -22, open: false },
  ]
  doors: Door[] = []
  openings: Opening[] = []
  windows: WindowBarrier[] = []

  // exposed so the Game can plunge The Lab into darkness for the local player
  ambient!: THREE.AmbientLight
  hemi!: THREE.HemisphereLight
  moon!: THREE.DirectionalLight
  private floraPulse: THREE.Sprite[] = []
  private labSpecimens: THREE.Group[] = []

  private scene: THREE.Scene
  private wallMat = new THREE.MeshLambertMaterial({ color: 0x2a3230 })
  private cellMat = new THREE.MeshLambertMaterial({ color: 0x232b28 })
  private barMat = new THREE.MeshPhongMaterial({ color: 0x3a4145, shininess: 55 })
  private plankMat = new THREE.MeshLambertMaterial({ color: 0x4a3a22 })
  private rubbleMat = new THREE.MeshLambertMaterial({ color: 0x35393a })
  private labWallMat = new THREE.MeshLambertMaterial({ color: 0x161c22 })
  private labFloorMat = new THREE.MeshLambertMaterial({ color: 0x0d1013 })
  private labTrimMat = new THREE.MeshLambertMaterial({ color: 0x20303a })
  // static geometry buckets, merged into one mesh per material after build
  private statics = new Map<THREE.Material, THREE.BufferGeometry[]>()

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.buildFloorAndSky()
    this.buildExteriorWalls()
    this.buildInteriorWalls()
    this.buildGates()
    this.buildCells()
    this.buildProps()
    this.buildLights()
    this.buildLab()
    this.mergeStatics()
    // invisible world edge so nobody sprints off into the fog (wraps jail + lab).
    // Kept well clear of the lab's tunnel spawn points (LAB_Z0/LAB_X0 - TUNNEL_SPAWN_OFF) —
    // this used to sit right on top of them, trapping freshly-spawned zombies against it.
    const frameX0 = LAB_X0 - TUNNEL_SPAWN_OFF - 3
    const frameZ0 = LAB_Z0 - TUNNEL_SPAWN_OFF - 3
    const bounds: Collider[] = [
      { minX: frameX0, maxX: 44, minZ: frameZ0, maxZ: frameZ0 + 2 }, // far north
      { minX: frameX0, maxX: 44, minZ: 34, maxZ: 36 }, // far south
      { minX: frameX0, maxX: frameX0 + 2, minZ: frameZ0, maxZ: 36 }, // west
      { minX: 42, maxX: 44, minZ: frameZ0, maxZ: 36 }, // east
    ]
    this.playerColliders.push(...bounds)
    this.zombieColliders.push(...bounds)
  }

  /** The dark basement region — used to swap the local player into pitch-black vision. */
  isLab(x: number, z: number): boolean {
    // includes the stairwell corridor so darkness creeps in as you descend
    return z <= -23 && x >= LAB_X0 && x <= LAB_X1
  }

  /** Gentle bioluminescent breathing on the flora glow sprites + drifting specimens. */
  updateFlora(t: number) {
    for (let i = 0; i < this.floraPulse.length; i++) {
      const s = this.floraPulse[i]
      const base = s.userData.baseOpacity as number
      ;(s.material as THREE.SpriteMaterial).opacity = base * (0.72 + 0.28 * Math.sin(t * 1.4 + i))
    }
    for (let i = 0; i < this.labSpecimens.length; i++) {
      const spec = this.labSpecimens[i]
      spec.rotation.y = t * 0.4 + i
      spec.position.y = 1.3 + Math.sin(t * 0.9 + i) * 0.12 // bob in the fluid
    }
  }

  // ---------------------------------------------------------------- geometry

  private addStatic(geo: THREE.BufferGeometry, mat: THREE.Material) {
    let list = this.statics.get(mat)
    if (!list) {
      list = []
      this.statics.set(mat, list)
    }
    list.push(geo)
  }

  private mergeStatics() {
    for (const [mat, geos] of this.statics) {
      const merged = mergeGeometries(geos)
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, mat)
      this.scene.add(mesh)
      this.colliderMeshes.push(mesh)
      for (const g of geos) g.dispose()
    }
    this.statics.clear()
  }

  private box(
    cx: number,
    cz: number,
    w: number,
    d: number,
    h: number,
    mat: THREE.Material,
    opts: { blocksPlayer?: boolean; blocksZombie?: boolean; y?: number } = {},
  ) {
    const { blocksPlayer = true, blocksZombie = true, y } = opts
    const geo = new THREE.BoxGeometry(w, h, d)
    geo.translate(cx, y ?? h / 2, cz)
    this.addStatic(geo, mat)
    const c: Collider = {
      minX: cx - w / 2,
      maxX: cx + w / 2,
      minZ: cz - d / 2,
      maxZ: cz + d / 2,
      height: (y ?? h / 2) + h / 2,
    }
    if (blocksPlayer) this.playerColliders.push(c)
    if (blocksZombie) this.zombieColliders.push(c)
  }

  private buildFloorAndSky() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 74, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0x181d1a }),
    )
    ground.rotation.x = -Math.PI / 2
    this.scene.add(ground)
    this.colliderMeshes.push(ground)
    this.scene.fog = new THREE.FogExp2(0x0a100a, 0.026)
    this.scene.background = new THREE.Color(0x0a100a)
  }

  /** Wall run along one axis, split by gaps; each gap becomes an opening/tunnel/clean gate gap. */
  private wallWithOpenings(
    axis: 'x' | 'z',
    fixed: number,
    from: number,
    to: number,
    gaps: Array<{ at: number; roomId: number; kind: 'window' | 'breach' | 'tunnel' | 'gate' }>,
    mat = this.wallMat,
    height = H,
  ) {
    const sorted = [...gaps].sort((a, b) => a.at - b.at)
    let cursor = from
    for (const gap of sorted) {
      const w = gap.kind === 'gate' ? GATE_W : WIN_W
      const g0 = gap.at - w / 2
      const g1 = gap.at + w / 2
      this.wallSegment(axis, fixed, cursor, g0, mat, height)
      if (gap.kind === 'tunnel') this.makeTunnel(axis, fixed, gap.at, gap.roomId, height)
      else if (gap.kind !== 'gate') this.makeOpening(axis, fixed, gap.at, gap.roomId, gap.kind)
      cursor = g1
    }
    this.wallSegment(axis, fixed, cursor, to, mat, height)
  }

  private wallSegment(
    axis: 'x' | 'z',
    fixed: number,
    from: number,
    to: number,
    mat = this.wallMat,
    height = H,
  ) {
    if (to - from < 0.05) return
    const len = to - from
    const mid = (from + to) / 2
    if (axis === 'x') this.box(mid, fixed, len, T, height, mat)
    else this.box(fixed, mid, T, len, height, mat)
  }

  /** A collapsed-wall spawn tunnel: fully blocks players, lets zombies crawl through from beyond. */
  private makeTunnel(axis: 'x' | 'z', fixed: number, at: number, roomId: number, height: number) {
    const isX = axis === 'x'
    const w = isX ? WIN_W : T
    const d = isX ? T : WIN_W
    const cx = isX ? at : fixed
    const cz = isX ? fixed : at
    // full-height blocker — players cannot pass into the tunnel
    this.playerColliders.push({
      minX: cx - w / 2,
      maxX: cx + w / 2,
      minZ: cz - d / 2,
      maxZ: cz + d / 2,
      height: height + 1,
    })
    // jagged broken-wall rubble framing the breach (dark, needs light to see)
    for (let i = 0; i < 5; i++) {
      const chunk = new THREE.BoxGeometry(
        isX ? 0.4 + Math.random() * 0.3 : T,
        0.4 + Math.random() * 0.7,
        isX ? T : 0.4 + Math.random() * 0.3,
      )
      const off = (Math.random() - 0.5) * WIN_W
      chunk.translate(isX ? at + off : cx, 0.3 + Math.random() * 1.4, isX ? cz : at + off)
      this.addStatic(chunk, this.labWallMat)
    }
    // faint green glow bleeding from the tunnel mouth
    const glow = glowSprite(GLOW_BIO, 2.0, 0.4)
    glow.position.set(cx, 1.2, cz)
    this.scene.add(glow)

    // spawn just outside the wall (in the tunnel), first waypoint just inside the lab
    const off = TUNNEL_SPAWN_OFF
    const outward = isX
      ? new THREE.Vector3(at, 0, fixed + (fixed <= LAB_Z0 + T ? -off : off))
      : new THREE.Vector3(fixed + (fixed <= LAB_X0 + T ? -off : off), 0, at)
    const inside = isX
      ? new THREE.Vector3(at, 0, fixed + (fixed <= LAB_Z0 + T ? off : -off))
      : new THREE.Vector3(fixed + (fixed <= LAB_X0 + T ? off : -off), 0, at)
    this.openings.push({
      roomId,
      outside: outward,
      inside,
      zone: {
        minX: cx - w / 2 - 1,
        maxX: cx + w / 2 + 1,
        minZ: cz - d / 2 - 1,
        maxZ: cz + d / 2 + 1,
      },
    })
  }

  private makeOpening(
    axis: 'x' | 'z',
    fixed: number,
    at: number,
    roomId: number,
    kind: 'window' | 'breach',
  ) {
    const isX = axis === 'x'
    const w = isX ? WIN_W : T
    const d = isX ? T : WIN_W
    const cx = isX ? at : fixed
    const cz = isX ? fixed : at
    const footprint = { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 }

    if (kind === 'window') {
      // full-height invisible wall — players can never climb out through a
      // window no matter how battered the boards get; only zombies ever get
      // through, and only by breaking the boards down first
      this.playerColliders.push({ ...footprint, height: H + 1 })
      const zombieCollider: Collider = { ...footprint, height: H + 1 }
      this.zombieColliders.push(zombieCollider)

      // individual, non-merged planks — need to be independently knocked down
      // and hammered back up, unlike the rest of the static geometry
      const plankMeshes: THREE.Mesh[] = []
      for (const y of [0.35, 0.75]) {
        const geo = new THREE.BoxGeometry(isX ? WIN_W : T * 0.5, 0.18, isX ? T * 0.5 : WIN_W)
        const mesh = new THREE.Mesh(geo, this.plankMat)
        mesh.position.set(cx, y, cz)
        mesh.rotation.y = (Math.random() - 0.5) * 0.08
        this.scene.add(mesh)
        plankMeshes.push(mesh)
      }
      // shattered frame stubs above — always present, never destroyed
      const lintel = new THREE.BoxGeometry(
        isX ? WIN_W + 0.4 : T,
        H - 3.1,
        isX ? T : WIN_W + 0.4,
      )
      lintel.translate(cx, 3.1 + (H - 3.1) / 2, cz)
      this.addStatic(lintel, this.wallMat)

      this.windows.push({
        id: this.windows.length,
        pos: new THREE.Vector3(cx, 0, cz),
        boards: plankMeshes.length,
        maxBoards: plankMeshes.length,
        plankMeshes,
        zombieCollider,
      })
    } else {
      // breach: a low sill players can vault, zombies crawl straight through —
      // already-broken openings have nothing left to board up
      this.playerColliders.push({ ...footprint, height: 0.6 })
      const rubble = new THREE.BoxGeometry(
        isX ? WIN_W + 0.3 : T + 0.5,
        0.55,
        isX ? T + 0.5 : WIN_W + 0.3,
      )
      rubble.rotateY(0.1)
      rubble.translate(cx, 0.27, cz)
      this.addStatic(rubble, this.rubbleMat)
    }

    // spawn outside, first waypoint inside — offset perpendicular to the wall
    const inward = this.inwardSign(axis, fixed)
    const off = 2.1
    const outside = isX
      ? new THREE.Vector3(at, 0, fixed - inward * off)
      : new THREE.Vector3(fixed - inward * off, 0, at)
    const inside = isX
      ? new THREE.Vector3(at, 0, fixed + inward * off)
      : new THREE.Vector3(fixed + inward * off, 0, at)
    this.openings.push({
      roomId,
      outside,
      inside,
      zone: {
        minX: footprint.minX - 1,
        maxX: footprint.maxX + 1,
        minZ: footprint.minZ - 1,
        maxZ: footprint.maxZ + 1,
      },
    })
    // danger marker — emissive sprite, not a real light
    const glow = glowSprite(GLOW_RED, 2.4, 0.5)
    glow.position.set(cx, 1.5, cz)
    this.scene.add(glow)
  }

  nearestDamagedWindow(pos: THREE.Vector3, maxDist = 2.6): WindowBarrier | null {
    let best: WindowBarrier | null = null
    let bestD = maxDist
    for (const w of this.windows) {
      if (w.boards >= w.maxBoards) continue
      const dist = Math.hypot(pos.x - w.pos.x, pos.z - w.pos.z)
      if (dist < bestD) {
        bestD = dist
        best = w
      }
    }
    return best
  }

  private applyWindowBoards(w: WindowBarrier, boards: number) {
    const clamped = Math.max(0, Math.min(w.maxBoards, boards))
    if (clamped === w.boards) return
    const wasOpen = w.boards === 0
    w.boards = clamped
    for (let i = 0; i < w.maxBoards; i++) w.plankMeshes[i].visible = i < clamped
    const nowOpen = clamped === 0
    if (wasOpen !== nowOpen) {
      const idx = this.zombieColliders.indexOf(w.zombieCollider)
      if (nowOpen && idx >= 0) this.zombieColliders.splice(idx, 1)
      else if (!nowOpen && idx < 0) this.zombieColliders.push(w.zombieCollider)
    }
  }

  /** Hammers one board back up — call from the repair interaction. */
  repairWindowBoard(id: number) {
    const w = this.windows[id]
    if (w) this.applyWindowBoards(w, w.boards + 1)
  }

  /** Knocks one board loose — call from the zombie-damage tick. */
  damageWindowBoard(id: number) {
    const w = this.windows[id]
    if (w) this.applyWindowBoards(w, w.boards - 1)
  }

  /** Client-side: snap straight to the host's authoritative board count. */
  setWindowBoards(id: number, boards: number) {
    const w = this.windows[id]
    if (w) this.applyWindowBoards(w, boards)
  }

  private inwardSign(axis: 'x' | 'z', fixed: number): number {
    // returns +1 if inside lies in the positive direction from this wall
    if (axis === 'x') return fixed <= Z0 + T ? 1 : -1 // north wall → inside is +z
    return fixed <= X0 + T ? 1 : -1 // west wall → inside is +x
  }

  private buildExteriorWalls() {
    // south (z=Z1): two breached cell walls — the horde's main way in
    this.wallWithOpenings('x', Z1, X0, X1, [
      { at: -15, roomId: 0, kind: 'breach' },
      { at: 15, roomId: 0, kind: 'breach' },
    ])
    // north (z=Z0): a stairwell gate down to The Lab, plus windows into showers, armory (x2), warden
    this.wallWithOpenings('x', Z0, X0, X1, [
      { at: STAIR_X, roomId: 1, kind: 'gate' },
      { at: -20, roomId: 1, kind: 'window' },
      { at: -5, roomId: 3, kind: 'window' },
      { at: 5, roomId: 3, kind: 'window' },
      { at: 20, roomId: 2, kind: 'window' },
    ])
    // west (x=X0): cell block + showers windows
    this.wallWithOpenings('z', X0, Z0, Z1, [
      { at: 11, roomId: 0, kind: 'window' },
      { at: -11, roomId: 1, kind: 'window' },
    ])
    // east (x=X1): cell block + warden windows
    this.wallWithOpenings('z', X1, Z0, Z1, [
      { at: 11, roomId: 0, kind: 'window' },
      { at: -11, roomId: 2, kind: 'window' },
    ])
  }

  private buildInteriorWalls() {
    // z=0 wall dividing the cell block from the north wing, gate gaps at ±20
    const g = GATE_W / 2
    this.wallSegment('x', 0, X0, -20 - g)
    this.wallSegment('x', 0, -20 + g, 20 - g)
    this.wallSegment('x', 0, 20 + g, X1)
    // x=±10 walls dividing the north wing, gate gaps at z=-11
    this.wallSegment('z', -10, Z0, -11 - g)
    this.wallSegment('z', -10, -11 + g, 0)
    this.wallSegment('z', 10, Z0, -11 - g)
    this.wallSegment('z', 10, -11 + g, 0)
  }

  private buildGates() {
    const defs: Array<{ name: string; cost: number; x: number; z: number; axis: 'x' | 'z'; rooms: [number, number] }> = [
      { name: 'CELL DOOR', cost: 750, x: -20, z: 0, axis: 'x', rooms: [0, 1] },
      { name: 'SECURITY GATE', cost: 1250, x: 20, z: 0, axis: 'x', rooms: [0, 2] },
      { name: 'ARMORY GATE', cost: 2000, x: -10, z: -11, axis: 'z', rooms: [1, 3] },
      { name: 'ARMORY GATE', cost: 2000, x: 10, z: -11, axis: 'z', rooms: [2, 3] },
      { name: 'THE LAB', cost: 10000, x: STAIR_X, z: Z0, axis: 'x', rooms: [1, 4] },
    ]
    defs.forEach((d, id) => {
      const group = new THREE.Group()
      group.position.set(d.x, 0, d.z)
      const isX = d.axis === 'x'
      // whole gate is one merged mesh: 5 bars + 3 crossbars
      const parts: THREE.BufferGeometry[] = []
      for (let i = -2; i <= 2; i++) {
        const bar = new THREE.CylinderGeometry(0.055, 0.055, 3.4)
        const off = i * (GATE_W / 5.2)
        bar.translate(isX ? off : 0, 1.7, isX ? 0 : off)
        parts.push(bar)
      }
      for (const y of [0.4, 1.7, 3.0]) {
        const cross = new THREE.BoxGeometry(isX ? GATE_W : 0.12, 0.12, isX ? 0.12 : GATE_W)
        cross.translate(0, y, 0)
        parts.push(cross)
      }
      const gateMesh = new THREE.Mesh(mergeGeometries(parts), this.barMat)
      group.add(gateMesh)
      const label = makeLabelSprite([d.name, `${d.cost}`])
      label.position.y = 4.1
      group.add(label)
      this.scene.add(group)
      this.colliderMeshes.push(gateMesh)
      const c: Collider = {
        minX: d.x - (isX ? GATE_W / 2 : T / 2),
        maxX: d.x + (isX ? GATE_W / 2 : T / 2),
        minZ: d.z - (isX ? T / 2 : GATE_W / 2),
        maxZ: d.z + (isX ? T / 2 : GATE_W / 2),
      }
      this.playerColliders.push(c)
      this.zombieColliders.push(c)
      this.doors.push({
        id,
        name: d.name,
        cost: d.cost,
        x: d.x,
        z: d.z,
        rooms: d.rooms,
        open: false,
        group,
        colliders: [c],
        meshes: [gateMesh],
      })
    })
  }

  private buildCells() {
    // holding cells along the south wall: dividers between slots, and every slot
    // fully barred shut — except the two breach corridors the horde pours through.
    // Nobody (player or zombie) can enter a cell, so nobody gets trapped in one.
    for (let x = -27.5; x <= 27.5; x += 5) {
      this.box(x, 20.5, 0.3, 3, 3.2, this.cellMat)
    }
    const barSlot = (cx: number, width: number) => {
      const count = Math.floor(width / 0.52)
      for (let i = 0; i < count; i++) {
        const bar = new THREE.CylinderGeometry(0.045, 0.045, 3.0, 6)
        bar.translate(cx - width / 2 + (i + 0.5) * (width / count), 1.5, 19)
        this.addStatic(bar, this.barMat)
      }
      for (const y of [0.15, 2.95]) {
        const rail = new THREE.BoxGeometry(width - 0.2, 0.12, 0.12)
        rail.translate(cx, y, 19)
        this.addStatic(rail, this.barMat)
      }
      const c: Collider = { minX: cx - width / 2, maxX: cx + width / 2, minZ: 18.9, maxZ: 19.1 }
      this.playerColliders.push(c)
      this.zombieColliders.push(c)
    }
    for (let cx = -25; cx <= 25; cx += 5) {
      if (Math.abs(cx) === 15) continue // breach corridors stay open
      barSlot(cx, 4.7)
    }
    // corner stubs beyond the last dividers
    barSlot(-28.75, 2.3)
    barSlot(28.75, 2.3)
  }

  private buildProps() {
    // scattered cover: overturned tables, crates, a fallen pillar per room
    const props: Array<[number, number, number, number, number]> = [
      // cell block
      [-8, 8, 2.2, 1.1, 1.0],
      [8, 12, 1.6, 1.6, 1.2],
      [0, 6, 3.2, 0.9, 0.9],
      [-20, 14, 1.4, 1.4, 1.5],
      [22, 6, 1.2, 2.6, 1.1],
      // showers
      [-24, -6, 1.1, 3.4, 1.0],
      [-15, -15, 1.8, 1.0, 1.0],
      [-22, -17, 1.3, 1.3, 1.4],
      // warden
      [18, -6, 2.8, 1.2, 1.0],
      [25, -15, 1.4, 1.4, 1.2],
      [14, -17, 1.0, 2.2, 1.0],
      // armory
      [-4, -17, 1.5, 1.5, 1.3],
      [4, -14, 1.2, 2.4, 1.0],
      [0, -7, 2.6, 1.0, 1.1],
    ]
    for (const [x, z, w, d, h] of props) this.box(x, z, w, d, h, this.cellMat)
  }

  // ---------------------------------------------------------------- the lab

  private addBloom(
    x: number,
    y: number,
    z: number,
    stops: [string, string, string],
    scale: number,
    opacity: number,
  ) {
    const s = glowSprite(stops, scale, opacity)
    s.position.set(x, y, z)
    s.userData.baseOpacity = opacity
    this.floraPulse.push(s)
    this.scene.add(s)
  }

  /** An oriented tapered cylinder running between two points — trunk/branch/root limbs. */
  private addLimb(
    a: THREE.Vector3,
    b: THREE.Vector3,
    r0: number,
    r1: number,
    mat: THREE.Material,
    radialSegs = 6,
  ) {
    const dir = new THREE.Vector3().subVectors(b, a)
    const len = dir.length()
    if (len < 0.01) return
    dir.normalize()
    const geo = new THREE.CylinderGeometry(r1, r0, len, radialSegs)
    geo.translate(0, len / 2, 0)
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    geo.applyQuaternion(quat)
    geo.translate(a.x, a.y, a.z)
    this.addStatic(geo, mat)
  }

  /** A cluster of irregular dark blobs at a branch tip — real canopy mass, not a floating glow. */
  private addFoliageClump(at: THREE.Vector3, mat: THREE.Material) {
    const puffs = 2 + Math.floor(Math.random() * 2)
    for (let i = 0; i < puffs; i++) {
      const r = 0.32 + Math.random() * 0.26
      const geo = new THREE.IcosahedronGeometry(r, 0)
      geo.translate(
        at.x + (Math.random() - 0.5) * 0.4,
        at.y + (Math.random() - 0.5) * 0.3,
        at.z + (Math.random() - 0.5) * 0.4,
      )
      this.addStatic(geo, mat)
    }
  }

  private buildLab() {
    const bioG = new THREE.MeshBasicMaterial({ color: 0x38ff78 })
    const cyanG = new THREE.MeshBasicMaterial({ color: 0x40e8ff })
    const violetG = new THREE.MeshBasicMaterial({ color: 0xb466ff })
    const barkMat = new THREE.MeshBasicMaterial({ color: 0x0c1116 })
    const glassMat = new THREE.MeshPhongMaterial({
      color: 0x8fd8e8,
      transparent: true,
      opacity: 0.22,
      shininess: 90,
    })

    // ---- stairwell corridor from the Showers down into the dark ----
    for (const wx of [-28, -24]) {
      this.wallSegment('z', wx, -28, -22, this.labWallMat, LAB_CEIL)
    }
    this.addFlatMesh(STAIR_X, 0.03, -25, GATE_W, 6, this.labFloorMat, -Math.PI / 2)
    this.addFlatMesh(STAIR_X, LAB_CEIL, -25, GATE_W, 6, this.labWallMat, Math.PI / 2)

    // ---- lab floor + ceiling (its own slab, well north of the jail ground) ----
    const labW = LAB_X1 - LAB_X0
    const labD = -28 - LAB_Z0
    const labCX = (LAB_X0 + LAB_X1) / 2
    const labCZ = (LAB_Z0 - 28) / 2
    this.addFlatMesh(labCX, 0.03, labCZ, labW, labD, this.labFloorMat, -Math.PI / 2)
    this.addFlatMesh(labCX, LAB_CEIL, labCZ, labW, labD, this.labWallMat, Math.PI / 2)

    // ---- perimeter walls with player-proof spawn tunnels ----
    this.wallWithOpenings('x', -28, LAB_X0, LAB_X1, [{ at: STAIR_X, roomId: 4, kind: 'gate' }], this.labWallMat, LAB_CEIL)
    this.wallWithOpenings('x', LAB_Z0, LAB_X0, LAB_X1, [
      { at: -20, roomId: 4, kind: 'tunnel' },
      { at: 0, roomId: 4, kind: 'tunnel' },
      { at: 20, roomId: 4, kind: 'tunnel' },
    ], this.labWallMat, LAB_CEIL)
    this.wallWithOpenings('z', LAB_X0, LAB_Z0, -28, [
      { at: -40, roomId: 4, kind: 'tunnel' },
      { at: -58, roomId: 4, kind: 'tunnel' },
    ], this.labWallMat, LAB_CEIL)
    this.wallWithOpenings('z', LAB_X1, LAB_Z0, -28, [
      { at: -40, roomId: 4, kind: 'tunnel' },
      { at: -58, roomId: 4, kind: 'tunnel' },
    ], this.labWallMat, LAB_CEIL)

    // ---- the central dome: a ring wall with a south-facing entrance ----
    const domeSegs = 22
    const entranceGap = Math.PI / 2 // south (+z) side stays open
    for (let i = 0; i < domeSegs; i++) {
      const a = (i / domeSegs) * Math.PI * 2
      if (Math.abs(this.angleDelta(a, entranceGap)) < 0.42) continue // leave the doorway
      const px = DOME_CX + Math.cos(a) * DOME_R
      const pz = DOME_CZ + Math.sin(a) * DOME_R
      const seg = new THREE.BoxGeometry(1.0, 3.6, 3.4)
      seg.rotateY(-a)
      seg.translate(px, 1.8, pz)
      this.addStatic(seg, this.labTrimMat)
      // players are walled out of the dome (enter via the south gap); zombies drift
      // through the ornamental shell so they never wedge circling it
      this.playerColliders.push({ minX: px - 1.4, maxX: px + 1.4, minZ: pz - 1.4, maxZ: pz + 1.4, height: 3.6 })
      // cyan rim light on top of each dome segment
      if (i % 2 === 0) this.addBloom(px, 3.4, pz, GLOW_CYAN, 1.6, 0.4)
    }

    // ---- the black luminescent tree at the dome's heart ----
    // gnarled, gently-curving trunk built from oriented segments (not one straight
    // pole), a real forked branch skeleton, and dark foliage clumps that the
    // bioluminescent blooms glow from within — rather than floating light blobs.
    const foliageMat = new THREE.MeshLambertMaterial({ color: 0x0a1410 })
    const trunkBase = new THREE.Vector3(DOME_CX, 0, DOME_CZ)

    // root flare: short thick limbs splaying from the base out to the floor
    const rootCount = 5
    for (let i = 0; i < rootCount; i++) {
      const a = (i / rootCount) * Math.PI * 2 + Math.random() * 0.4
      const end = new THREE.Vector3(
        DOME_CX + Math.cos(a) * (0.75 + Math.random() * 0.3),
        0.02,
        DOME_CZ + Math.sin(a) * (0.75 + Math.random() * 0.3),
      )
      this.addLimb(new THREE.Vector3(DOME_CX, 0.55, DOME_CZ), end, 0.24, 0.09, barkMat)
    }

    // trunk: 4 stacked segments, each drifting slightly off-axis for a gnarled lean
    const trunkH = 3.3
    const trunkSegs = 4
    const trunkPts: THREE.Vector3[] = [trunkBase.clone()]
    let cx = DOME_CX
    let cz = DOME_CZ
    for (let i = 1; i <= trunkSegs; i++) {
      cx += (Math.random() - 0.5) * 0.3
      cz += (Math.random() - 0.5) * 0.3
      trunkPts.push(new THREE.Vector3(cx, (i / trunkSegs) * trunkH, cz))
    }
    for (let i = 0; i < trunkSegs; i++) {
      const t0 = i / trunkSegs
      const t1 = (i + 1) / trunkSegs
      const r0 = THREE.MathUtils.lerp(0.62, 0.16, t0)
      const r1 = THREE.MathUtils.lerp(0.62, 0.16, t1)
      this.addLimb(trunkPts[i], trunkPts[i + 1], r0, r1, barkMat)
    }
    const crown = trunkPts[trunkSegs] // top of the trunk — where branches fan out from

    // branch skeleton: main limbs fanning from the crown, some forking into a
    // secondary branch, each ending in a foliage clump (+ a glow bloom on half of them)
    const branchCount = 8
    for (let i = 0; i < branchCount; i++) {
      const a = (i / branchCount) * Math.PI * 2 + Math.random() * 0.5
      const reach = 1.5 + Math.random() * 1.1
      const rise = 0.5 + Math.random() * 0.7
      const start = crown.clone().add(new THREE.Vector3(0, -0.15 + Math.random() * 0.3, 0))
      const tip = new THREE.Vector3(
        crown.x + Math.cos(a) * reach,
        Math.min(4.15, crown.y + rise),
        crown.z + Math.sin(a) * reach,
      )
      this.addLimb(start, tip, 0.15, 0.05, barkMat)
      this.addFoliageClump(tip, foliageMat)
      if (i % 2 === 0) {
        this.addBloom(tip.x, tip.y, tip.z, i % 4 ? GLOW_VIOLET : GLOW_CYAN, 1.1 + Math.random() * 0.5, 0.55)
      }
      // fork a thinner sub-branch off roughly the midpoint, for canopy fullness
      if (i % 2 === 1) {
        const mid = start.clone().lerp(tip, 0.55)
        const forkA = a + (Math.random() - 0.5) * 1.4
        const forkTip = new THREE.Vector3(
          mid.x + Math.cos(forkA) * (0.8 + Math.random() * 0.6),
          Math.min(4.2, mid.y + 0.4 + Math.random() * 0.5),
          mid.z + Math.sin(forkA) * (0.8 + Math.random() * 0.6),
        )
        this.addLimb(mid, forkTip, 0.07, 0.03, barkMat)
        this.addFoliageClump(forkTip, foliageMat)
        if (i % 3 === 0) this.addBloom(forkTip.x, forkTip.y, forkTip.z, GLOW_CYAN, 0.9, 0.5)
      }
    }
    // a little extra canopy mass around the crown itself so it doesn't read as bare
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * 0.6
      this.addFoliageClump(
        new THREE.Vector3(crown.x + Math.cos(a) * r, crown.y + 0.3 + Math.random() * 0.5, crown.z + Math.sin(a) * r),
        foliageMat,
      )
    }

    // glowing veins climbing the trunk's core
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const vein = new THREE.BoxGeometry(0.04, trunkH * 0.9, 0.04)
      vein.translate(DOME_CX + Math.cos(a) * 0.4, trunkH * 0.48, DOME_CZ + Math.sin(a) * 0.4)
      this.addStatic(vein, cyanG)
    }

    // ---- luminescent flora carpeting the dome floor ----
    this.scatterFlora(DOME_CX, DOME_CZ, DOME_R - 1.5, 30, [bioG, cyanG, violetG])

    // ---- vines leeching out the dome entrance, south toward the lab ----
    for (let i = 0; i < 12; i++) {
      const t = i / 11
      const vx = DOME_CX + (Math.random() - 0.5) * 3
      const vz = DOME_CZ + DOME_R - 1 + t * 9
      const vine = new THREE.BoxGeometry(0.12 + Math.random() * 0.1, 0.06, 1.4 + Math.random())
      vine.rotateY((Math.random() - 0.5) * 0.7)
      vine.translate(vx, 0.04, vz)
      this.addStatic(vine, bioG)
      if (i % 2 === 0) this.addBloom(vx, 0.15, vz, GLOW_BIO, 0.9, 0.4)
    }

    // ---- lab cubicles ringing the dome ----
    const cubicleRing = DOME_R + 5.5
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3
      const cx = DOME_CX + Math.cos(a) * cubicleRing
      const cz = DOME_CZ + Math.sin(a) * cubicleRing
      if (cx < LAB_X0 + 3 || cx > LAB_X1 - 3 || cz < LAB_Z0 + 3 || cz > -31) continue
      this.buildCubicle(cx, cz, -a)
    }

    // ---- specimen test tubes: six mutant strains, glowing in the black ----
    const tubeColors: Array<[THREE.Material, [string, string, string]]> = [
      [bioG, GLOW_BIO],
      [cyanG, GLOW_CYAN],
      [violetG, GLOW_VIOLET],
      [bioG, GLOW_BIO],
      [cyanG, GLOW_CYAN],
      [violetG, GLOW_VIOLET],
    ]
    tubeColors.forEach(([mat, stops], i) => {
      const a = (i / 6) * Math.PI * 2 + 0.8
      const tx = DOME_CX + Math.cos(a) * (DOME_R + 2.6)
      const tz = DOME_CZ + Math.sin(a) * (DOME_R + 2.6)
      this.buildTestTube(tx, tz, glassMat, mat, stops, i)
    })

    // ---- light-source vendors, right at the bottom of the stairs ----
    this.buildItemStation(FLASHLIGHT_POS.x, FLASHLIGHT_POS.z, 'FLASHLIGHT', '20000', GLOW_GOLD)
    this.buildItemStation(NVG_POS.x, NVG_POS.z, 'NIGHT VISION', '40000', GLOW_CYAN)
  }

  private buildItemStation(x: number, z: number, top: string, bottom: string, stops: [string, string, string]) {
    const pedestal = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.0, 0.9),
      this.labTrimMat,
    )
    pedestal.position.set(x, 0.5, z)
    this.scene.add(pedestal)
    this.colliderMeshes.push(pedestal)
    this.playerColliders.push({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5, height: 1.0 })
    // a bright, always-visible glow so you can find the vendor in the dark
    this.addBloom(x, 1.3, z, stops, 1.8, 0.7)
    const label = makeLabelSprite([top, bottom])
    label.position.set(x, 2.2, z)
    this.scene.add(label)
  }

  private angleDelta(a: number, b: number): number {
    let d = a - b
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    return d
  }

  private addFlatMesh(
    cx: number,
    y: number,
    cz: number,
    w: number,
    d: number,
    mat: THREE.Material,
    rotX: number,
  ) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat)
    mesh.rotation.x = rotX
    mesh.position.set(cx, y, cz)
    this.scene.add(mesh)
    this.colliderMeshes.push(mesh)
  }

  private scatterFlora(cx: number, cz: number, radius: number, count: number, mats: THREE.Material[]) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * radius
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r
      const mat = mats[Math.floor(Math.random() * mats.length)]
      const kind = Math.random()
      if (kind < 0.4) {
        // mushroom: stem + cap
        const stem = new THREE.CylinderGeometry(0.04, 0.06, 0.28, 5)
        stem.translate(x, 0.14, z)
        this.addStatic(stem, new THREE.MeshBasicMaterial({ color: 0x203028 }))
        const cap = new THREE.SphereGeometry(0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2)
        cap.translate(x, 0.28, z)
        this.addStatic(cap, mat)
        this.addBloom(x, 0.32, z, GLOW_BIO, 0.7, 0.35)
      } else if (kind < 0.75) {
        // grass/fungi blades
        for (let b = 0; b < 3; b++) {
          const blade = new THREE.BoxGeometry(0.03, 0.3 + Math.random() * 0.3, 0.03)
          blade.rotateZ((Math.random() - 0.5) * 0.5)
          blade.translate(x + (Math.random() - 0.5) * 0.3, 0.2, z + (Math.random() - 0.5) * 0.3)
          this.addStatic(blade, mat)
        }
      } else {
        // glowing pod
        const pod = new THREE.SphereGeometry(0.1 + Math.random() * 0.1, 8, 6)
        pod.translate(x, 0.12, z)
        this.addStatic(pod, mat)
        this.addBloom(x, 0.14, z, GLOW_VIOLET, 0.55, 0.3)
      }
    }
  }

  private buildCubicle(cx: number, cz: number, rot: number) {
    const g = new THREE.Group()
    g.position.set(cx, 0, cz)
    g.rotation.y = rot
    const parts: THREE.BufferGeometry[] = []
    // two partition walls forming an L
    const back = new THREE.BoxGeometry(2.6, 1.8, 0.12)
    back.translate(0, 0.9, -1.2)
    parts.push(back)
    const side = new THREE.BoxGeometry(0.12, 1.8, 2.4)
    side.translate(-1.3, 0.9, 0)
    parts.push(side)
    // a desk / lab bench
    const desk = new THREE.BoxGeometry(2.2, 0.1, 0.8)
    desk.translate(0, 0.85, -0.7)
    parts.push(desk)
    const mesh = new THREE.Mesh(mergeGeometries(parts), this.labTrimMat)
    g.add(mesh)
    this.scene.add(g)
    this.colliderMeshes.push(mesh)
    // a small monitor glow on the desk
    const monitor = glowSprite(GLOW_CYAN, 0.8, 0.35)
    monitor.position.set(cx, 1.15, cz)
    monitor.userData.baseOpacity = 0.35
    this.floraPulse.push(monitor)
    this.scene.add(monitor)
    // knee-high partition footprint so you can duck into the cubicle but not phase through the bench
    this.playerColliders.push({ minX: cx - 1.5, maxX: cx + 1.5, minZ: cz - 1.5, maxZ: cz + 1.5, height: 0.95 })
  }

  private buildTestTube(
    x: number,
    z: number,
    glassMat: THREE.Material,
    specimenMat: THREE.Material,
    stops: [string, string, string],
    variant: number,
  ) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.3, 12), this.labTrimMat)
    base.position.set(x, 0.15, z)
    this.scene.add(base)
    this.colliderMeshes.push(base)
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.2, 12, 1, true), glassMat)
    glass.position.set(x, 1.4, z)
    this.scene.add(glass)
    // a floating mutant specimen — a different silhouette per tube
    const spec = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.4, 0.16), specimenMat)
    spec.add(body)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), specimenMat)
    head.position.y = 0.32
    spec.add(head)
    if (variant % 3 === 0) {
      // extra arms
      for (const s of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 0.06), specimenMat)
        arm.position.set(s * 0.25, 0.1, 0)
        spec.add(arm)
      }
    } else if (variant % 3 === 1) {
      // bloated
      body.scale.set(1.6, 1.1, 1.6)
    } else {
      // spindly tall
      body.scale.set(0.6, 1.6, 0.6)
      head.scale.setScalar(0.7)
    }
    spec.position.set(x, 1.3, z)
    spec.name = `specimen-${variant}`
    this.scene.add(spec)
    this.labSpecimens.push(spec)
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.16, 12), this.labTrimMat)
    cap.position.set(x, 2.55, z)
    this.scene.add(cap)
    this.colliderMeshes.push(cap)
    this.addBloom(x, 1.4, z, stops, 1.2, 0.45)
    // a tube blocks movement
    this.playerColliders.push({ minX: x - 0.42, maxX: x + 0.42, minZ: z - 0.42, maxZ: z + 0.42, height: 2.6 })
    this.zombieColliders.push({ minX: x - 0.42, maxX: x + 0.42, minZ: z - 0.42, maxZ: z + 0.42, height: 2.6 })
  }

  private buildLights() {
    this.ambient = new THREE.AmbientLight(0x3d4f42, 2.1)
    this.scene.add(this.ambient)
    this.hemi = new THREE.HemisphereLight(0x46543f, 0x181512, 1.8)
    this.scene.add(this.hemi)
    this.moon = new THREE.DirectionalLight(0x51624a, 0.9)
    this.moon.position.set(-10, 20, -6)
    this.scene.add(this.moon)
    // failing prison floodlights — three across the cell block, one per wing
    for (const [x, z] of [
      [-20, 11],
      [0, 11],
      [20, 11],
      [-20, -11],
      [20, -11],
      [0, -11],
    ]) {
      const lamp = new THREE.PointLight(0x66ff44, 16, 26, 1.7)
      lamp.position.set(x, 4.6, z)
      this.scene.add(lamp)
    }
  }

  // ---------------------------------------------------------------- gameplay

  /** Spawn points for all currently-open rooms; lab spawns are flagged luminescent. */
  activeSpawns(): Array<{ pos: THREE.Vector3; lab: boolean }> {
    return this.openings
      .filter((o) => this.rooms[o.roomId].open)
      .map((o) => ({ pos: o.outside, lab: o.roomId === 4 }))
  }

  roomOf(x: number, z: number): number {
    for (const r of this.rooms) {
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r.id
    }
    return -1
  }

  nearestClosedDoor(pos: THREE.Vector3, maxDist = 3.0): Door | null {
    let best: Door | null = null
    let bestD = maxDist
    for (const d of this.doors) {
      if (d.open) continue
      // only buyable from an already-open side
      if (!this.rooms[d.rooms[0]].open && !this.rooms[d.rooms[1]].open) continue
      const dist = Math.hypot(pos.x - d.x, pos.z - d.z)
      if (dist < bestD) {
        bestD = dist
        best = d
      }
    }
    return best
  }

  openDoor(id: number): boolean {
    const d = this.doors[id]
    if (!d || d.open) return false
    d.open = true
    this.scene.remove(d.group)
    for (const c of d.colliders) {
      const pi = this.playerColliders.indexOf(c)
      if (pi >= 0) this.playerColliders.splice(pi, 1)
      const zi = this.zombieColliders.indexOf(c)
      if (zi >= 0) this.zombieColliders.splice(zi, 1)
    }
    for (const m of d.meshes) {
      const i = this.colliderMeshes.indexOf(m)
      if (i >= 0) this.colliderMeshes.splice(i, 1)
    }
    for (const rid of d.rooms) this.rooms[rid].open = true
    return true
  }

  openDoorIds(): number[] {
    return this.doors.filter((d) => d.open).map((d) => d.id)
  }

  // ------------------------------- zombie navigation -------------------------------

  inOpeningZone(pos: THREE.Vector3): boolean {
    for (const o of this.openings) {
      const z = o.zone
      if (pos.x > z.minX && pos.x < z.maxX && pos.z > z.minZ && pos.z < z.maxZ) return true
    }
    return false
  }

  /**
   * Where a zombie at `pos` should head to reach `target`:
   * outside → nearest opening; cross-room → next open gate on the BFS path.
   */
  private nearestOpening(
    pos: THREE.Vector3,
    roomId: number | null,
  ): Opening | null {
    let best: Opening | null = null
    let bestD = Infinity
    for (const o of this.openings) {
      if (roomId !== null && o.roomId !== roomId) continue
      const d = Math.hypot(pos.x - o.outside.x, pos.z - o.outside.z)
      if (d < bestD) {
        bestD = d
        best = o
      }
    }
    return best
  }

  nextWaypoint(pos: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    const ra = this.roomOf(pos.x, pos.z)
    const rb = this.roomOf(target.x, target.z)
    if (ra === rb) return target
    if (ra === -1) {
      // outside the building (a spawn tunnel/window): crawl in through the nearest
      // opening — almost always its own — then the room graph routes it onward
      const o = this.nearestOpening(pos, null)
      return o ? o.inside : target
    }
    if (rb === -1) {
      // target fled outside: leave through this room's nearest opening
      const o = this.nearestOpening(pos, ra)
      if (!o) return target
      const distToGap = Math.hypot(pos.x - o.inside.x, pos.z - o.inside.z)
      return distToGap > 1.4 ? o.inside : o.outside
    }

    // BFS over rooms connected by open doors
    const prevDoor = new Map<number, Door>()
    const prevRoom = new Map<number, number>()
    const queue = [ra]
    const seen = new Set([ra])
    while (queue.length) {
      const r = queue.shift()!
      if (r === rb) break
      for (const d of this.doors) {
        if (!d.open || (d.rooms[0] !== r && d.rooms[1] !== r)) continue
        const other = d.rooms[0] === r ? d.rooms[1] : d.rooms[0]
        if (seen.has(other)) continue
        seen.add(other)
        prevDoor.set(other, d)
        prevRoom.set(other, r)
        queue.push(other)
      }
    }
    if (!seen.has(rb)) return target // unreachable — press against the gate menacingly
    // walk back to find the first door out of ra
    let cur = rb
    while (prevRoom.get(cur) !== undefined && prevRoom.get(cur) !== ra) {
      cur = prevRoom.get(cur)!
    }
    const door = prevDoor.get(cur)
    return door ? new THREE.Vector3(door.x, 0, door.z) : target
  }
}

export function buildArena(scene: THREE.Scene): Arena {
  return new Arena(scene)
}
