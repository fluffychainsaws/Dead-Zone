import * as THREE from 'three'

export interface Collider {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface Arena {
  colliders: Collider[]
  colliderMeshes: THREE.Mesh[]
  spawnPoints: THREE.Vector3[]
  size: number
}

const SIZE = 44 // playable square, walls at ±SIZE/2

export function buildArena(scene: THREE.Scene): Arena {
  const colliders: Collider[] = []
  const colliderMeshes: THREE.Mesh[] = []
  const half = SIZE / 2

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE + 2, SIZE + 2, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x11170f, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)
  colliderMeshes.push(ground)

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a231a, roughness: 0.95 })
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x24301f, roughness: 0.9 })
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x202a24, roughness: 0.85 })

  function addBox(
    cx: number,
    cz: number,
    w: number,
    d: number,
    h: number,
    mat: THREE.Material,
    solid = true,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    mesh.position.set(cx, h / 2, cz)
    scene.add(mesh)
    colliderMeshes.push(mesh)
    if (solid) {
      colliders.push({
        minX: cx - w / 2,
        maxX: cx + w / 2,
        minZ: cz - d / 2,
        maxZ: cz + d / 2,
      })
    }
    return mesh
  }

  // Perimeter walls with spawn gaps on each side (gap centered per segment).
  // Each side is two wall segments leaving a 4-unit opening.
  const T = 1 // wall thickness
  const H = 4.5
  const GAP = 4
  const seg = (half * 2 - GAP) / 2 // length of each wall segment
  const segOff = GAP / 2 + seg / 2
  // north (-z) and south (+z)
  for (const z of [-half, half]) {
    addBox(-segOff, z, seg, T, H, wallMat)
    addBox(segOff, z, seg, T, H, wallMat)
  }
  // west (-x) and east (+x)
  for (const x of [-half, half]) {
    addBox(x, -segOff, T, seg, H, wallMat)
    addBox(x, segOff, T, seg, H, wallMat)
  }
  // low barricades across the gaps: zombies climb over, players can shoot over
  const barricadeMat = new THREE.MeshStandardMaterial({ color: 0x33271a, roughness: 1 })
  for (const [x, z, w, d] of [
    [0, -half, GAP, T],
    [0, half, GAP, T],
    [-half, 0, T, GAP],
    [half, 0, T, GAP],
  ] as const) {
    addBox(x, z, w, d, 1.1, barricadeMat)
  }

  // Interior cover: hand-placed for readable sightlines
  const layout: Array<[number, number, number, number, number, THREE.Material]> = [
    // center ruin
    [0, -3, 6, 0.8, 2.6, wallMat],
    [2.6, -0.4, 0.8, 5, 2.6, wallMat],
    // crates
    [-8, -8, 2, 2, 2, crateMat],
    [-6.5, -8.5, 1.6, 1.6, 1.4, crateMat],
    [9, 6, 2.2, 2.2, 2.1, crateMat],
    [10.5, 4.5, 1.5, 1.5, 1.2, crateMat],
    [-11, 9, 2, 2, 1.8, crateMat],
    [6, -12, 1.8, 1.8, 1.6, crateMat],
    [-4, 13, 2.4, 2.4, 2, crateMat],
    [14, -6, 2, 2, 1.7, crateMat],
    // pillars
    [-14, -13, 1.2, 1.2, 6, pillarMat],
    [13, 13, 1.2, 1.2, 6, pillarMat],
    [-13, 2, 1.2, 1.2, 6, pillarMat],
    [7, 14, 1.2, 1.2, 6, pillarMat],
    // long low walls
    [-7, 3, 5, 0.7, 1.3, wallMat],
    [8, -4, 0.7, 5, 1.3, wallMat],
  ]
  for (const [x, z, w, d, h, m] of layout) addBox(x, z, w, d, h, m)

  // Zombie spawn points: just outside each wall gap
  const spawnPoints = [
    new THREE.Vector3(0, 0, -half - 2),
    new THREE.Vector3(0, 0, half + 2),
    new THREE.Vector3(-half - 2, 0, 0),
    new THREE.Vector3(half + 2, 0, 0),
  ]

  // Atmosphere
  scene.fog = new THREE.FogExp2(0x0a100a, 0.028)
  scene.background = new THREE.Color(0x0a100a)
  scene.add(new THREE.AmbientLight(0x36463a, 1.6))
  scene.add(new THREE.HemisphereLight(0x3d4a3d, 0x141210, 1.4))
  const moon = new THREE.DirectionalLight(0x44553f, 0.7)
  moon.position.set(-10, 20, -6)
  scene.add(moon)
  // sickly lamps at the pillars
  for (const [x, z] of [
    [-14, -13],
    [13, 13],
    [-13, 2],
    [7, 14],
  ]) {
    const lamp = new THREE.PointLight(0x55ff33, 10, 18, 1.8)
    lamp.position.set(x, 5.6, z)
    scene.add(lamp)
  }
  // red glow at spawn gaps (danger markers)
  for (const p of spawnPoints) {
    const glow = new THREE.PointLight(0xaa1111, 7, 12, 1.7)
    glow.position.set(p.x * 0.94, 1.6, p.z * 0.94)
    scene.add(glow)
  }

  return { colliders, colliderMeshes, spawnPoints, size: SIZE }
}
