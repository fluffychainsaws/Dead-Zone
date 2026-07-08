import * as THREE from 'three'
import { makeLabelSprite } from './economy'

// Blackmarsh Penitentiary — a broken-down jail. Zombies crawl in through
// breached cell walls and boarded windows (player-blocking, zombie-passable);
// locked gates split the block into purchasable rooms.

export interface Collider {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
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

const X0 = -30
const X1 = 30
const Z0 = -22
const Z1 = 22
const H = 5 // wall height
const T = 1 // wall thickness
const GATE_W = 3
const WIN_W = 2.6

export class Arena {
  playerColliders: Collider[] = []
  zombieColliders: Collider[] = []
  colliderMeshes: THREE.Mesh[] = []
  rooms: Room[] = [
    { id: 0, name: 'CELL BLOCK', minX: X0, maxX: X1, minZ: 0, maxZ: Z1, open: true },
    { id: 1, name: 'SHOWERS', minX: X0, maxX: -10, minZ: Z0, maxZ: 0, open: false },
    { id: 2, name: 'WARDEN’S WING', minX: 10, maxX: X1, minZ: Z0, maxZ: 0, open: false },
    { id: 3, name: 'ARMORY', minX: -10, maxX: 10, minZ: Z0, maxZ: 0, open: false },
  ]
  doors: Door[] = []
  openings: Opening[] = []

  private scene: THREE.Scene
  private wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3230, roughness: 0.95 })
  private cellMat = new THREE.MeshStandardMaterial({ color: 0x232b28, roughness: 0.9 })
  private barMat = new THREE.MeshStandardMaterial({
    color: 0x3a4145,
    roughness: 0.45,
    metalness: 0.7,
  })
  private plankMat = new THREE.MeshStandardMaterial({ color: 0x4a3a22, roughness: 1 })
  private rubbleMat = new THREE.MeshStandardMaterial({ color: 0x35393a, roughness: 1 })

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.buildFloorAndSky()
    this.buildExteriorWalls()
    this.buildInteriorWalls()
    this.buildGates()
    this.buildCells()
    this.buildProps()
    this.buildLights()
  }

  // ---------------------------------------------------------------- geometry

  private box(
    cx: number,
    cz: number,
    w: number,
    d: number,
    h: number,
    mat: THREE.Material,
    opts: { blocksPlayer?: boolean; blocksZombie?: boolean; y?: number } = {},
  ): THREE.Mesh {
    const { blocksPlayer = true, blocksZombie = true, y } = opts
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    mesh.position.set(cx, y ?? h / 2, cz)
    this.scene.add(mesh)
    this.colliderMeshes.push(mesh)
    const c: Collider = {
      minX: cx - w / 2,
      maxX: cx + w / 2,
      minZ: cz - d / 2,
      maxZ: cz + d / 2,
    }
    if (blocksPlayer) this.playerColliders.push(c)
    if (blocksZombie) this.zombieColliders.push(c)
    return mesh
  }

  private buildFloorAndSky() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 74, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x181d1a, roughness: 1 }),
    )
    ground.rotation.x = -Math.PI / 2
    this.scene.add(ground)
    this.colliderMeshes.push(ground as unknown as THREE.Mesh)
    this.scene.fog = new THREE.FogExp2(0x0a100a, 0.026)
    this.scene.background = new THREE.Color(0x0a100a)
  }

  /** Wall run along one axis, split by gaps; each gap becomes a zombie opening. */
  private wallWithOpenings(
    axis: 'x' | 'z',
    fixed: number,
    from: number,
    to: number,
    gaps: Array<{ at: number; roomId: number; kind: 'window' | 'breach' }>,
  ) {
    const sorted = [...gaps].sort((a, b) => a.at - b.at)
    let cursor = from
    for (const gap of sorted) {
      const g0 = gap.at - WIN_W / 2
      const g1 = gap.at + WIN_W / 2
      this.wallSegment(axis, fixed, cursor, g0)
      this.makeOpening(axis, fixed, gap.at, gap.roomId, gap.kind)
      cursor = g1
    }
    this.wallSegment(axis, fixed, cursor, to)
  }

  private wallSegment(axis: 'x' | 'z', fixed: number, from: number, to: number) {
    if (to - from < 0.05) return
    const len = to - from
    const mid = (from + to) / 2
    if (axis === 'x') this.box(mid, fixed, len, T, H, this.wallMat)
    else this.box(fixed, mid, T, len, H, this.wallMat)
  }

  private makeOpening(
    axis: 'x' | 'z',
    fixed: number,
    at: number,
    roomId: number,
    kind: 'window' | 'breach',
  ) {
    // player-only blocker filling the gap (zombies pass through it)
    const isX = axis === 'x'
    const w = isX ? WIN_W : T
    const d = isX ? T : WIN_W
    const cx = isX ? at : fixed
    const cz = isX ? fixed : at
    const blocker: Collider = {
      minX: cx - w / 2,
      maxX: cx + w / 2,
      minZ: cz - d / 2,
      maxZ: cz + d / 2,
    }
    this.playerColliders.push(blocker)

    if (kind === 'window') {
      // two weathered planks bullets can pass between
      for (const y of [0.55, 1.1]) {
        const plank = new THREE.Mesh(
          new THREE.BoxGeometry(isX ? WIN_W : T * 0.5, 0.18, isX ? T * 0.5 : WIN_W),
          this.plankMat,
        )
        plank.position.set(cx, y, cz)
        plank.rotation.y = (Math.random() - 0.5) * 0.08
        this.scene.add(plank)
        this.colliderMeshes.push(plank)
      }
      // shattered frame stubs above
      const lintel = new THREE.Mesh(
        new THREE.BoxGeometry(isX ? WIN_W + 0.4 : T, H - 2.2, isX ? T : WIN_W + 0.4),
        this.wallMat,
      )
      lintel.position.set(cx, 2.2 + (H - 2.2) / 2, cz)
      this.scene.add(lintel)
      this.colliderMeshes.push(lintel)
    } else {
      // breach: pile of rubble at the base of a collapsed wall section
      const rubble = new THREE.Mesh(
        new THREE.BoxGeometry(isX ? WIN_W + 0.3 : T + 0.5, 0.55, isX ? T + 0.5 : WIN_W + 0.3),
        this.rubbleMat,
      )
      rubble.position.set(cx, 0.27, cz)
      rubble.rotation.y = 0.1
      this.scene.add(rubble)
      this.colliderMeshes.push(rubble)
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
        minX: blocker.minX - 1,
        maxX: blocker.maxX + 1,
        minZ: blocker.minZ - 1,
        maxZ: blocker.maxZ + 1,
      },
    })
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
    // north (z=Z0): windows into showers, armory (x2), warden
    this.wallWithOpenings('x', Z0, X0, X1, [
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
    ]
    defs.forEach((d, id) => {
      const group = new THREE.Group()
      group.position.set(d.x, 0, d.z)
      const meshes: THREE.Mesh[] = []
      const isX = d.axis === 'x'
      // vertical bars across the gap
      for (let i = -2; i <= 2; i++) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 3.4), this.barMat)
        const off = i * (GATE_W / 5.2)
        bar.position.set(isX ? off : 0, 1.7, isX ? 0 : off)
        group.add(bar)
        meshes.push(bar)
      }
      // crossbars
      for (const y of [0.4, 1.7, 3.0]) {
        const cross = new THREE.Mesh(
          new THREE.BoxGeometry(isX ? GATE_W : 0.12, 0.12, isX ? 0.12 : GATE_W),
          this.barMat,
        )
        cross.position.set(0, y, 0)
        group.add(cross)
        meshes.push(cross)
      }
      const label = makeLabelSprite([d.name, `${d.cost}`])
      label.position.y = 4.1
      group.add(label)
      this.scene.add(group)
      this.colliderMeshes.push(...meshes)
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
        meshes,
      })
    })
  }

  private buildCells() {
    // holding cells along the south wall of the cell block: dividers + bar fronts
    for (let x = -25; x <= 25; x += 5) {
      if (Math.abs(x - -15) < 2.5 || Math.abs(x - 15) < 2.5) {
        // keep breach cells clear so zombies pour straight through
        this.box(x, 20.5, 0.3, 3, 3.2, this.cellMat)
        continue
      }
      this.box(x, 20.5, 0.3, 3, 3.2, this.cellMat)
      // partial bar front with an open doorway (players can duck into cells)
      const front = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 0.12), this.barMat)
      front.position.set(x - 1.2, 1.3, 19)
      this.scene.add(front)
      this.colliderMeshes.push(front)
      this.playerColliders.push({ minX: x - 2.4, maxX: x - 0.05, minZ: 18.9, maxZ: 19.1 })
      this.zombieColliders.push({ minX: x - 2.4, maxX: x - 0.05, minZ: 18.9, maxZ: 19.1 })
    }
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

  private buildLights() {
    this.scene.add(new THREE.AmbientLight(0x3d4f42, 2.1))
    this.scene.add(new THREE.HemisphereLight(0x46543f, 0x181512, 1.8))
    const moon = new THREE.DirectionalLight(0x51624a, 0.9)
    moon.position.set(-10, 20, -6)
    this.scene.add(moon)
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
    // danger glow at every opening
    for (const o of this.openings) {
      const glow = new THREE.PointLight(0xaa1111, 6, 9, 1.7)
      glow.position.set(o.inside.x, 1.4, o.inside.z)
      this.scene.add(glow)
    }
  }

  // ---------------------------------------------------------------- gameplay

  /** Spawn points for all currently-open rooms. */
  activeSpawns(): THREE.Vector3[] {
    return this.openings
      .filter((o) => this.rooms[o.roomId].open)
      .map((o) => o.outside)
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
  nextWaypoint(pos: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    const ra = this.roomOf(pos.x, pos.z)
    if (ra === -1) {
      // outside the building: crawl in through the nearest opening
      let best: Opening | null = null
      let bestD = Infinity
      for (const o of this.openings) {
        const d = Math.hypot(pos.x - o.outside.x, pos.z - o.outside.z)
        if (d < bestD) {
          bestD = d
          best = o
        }
      }
      return best ? best.inside : target
    }
    const rb = this.roomOf(target.x, target.z)
    if (rb === -1 || ra === rb) return target

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
