import * as THREE from 'three'
import { WEAPONS, buildViewmodel, type WeaponDef } from './weapons'

export const POINTS = {
  hit: 10,
  kill: 50,
  headshotKill: 90,
  start: 500,
  repair: 20,
}

export interface WallBuy {
  def: WeaponDef
  price: number
  ammoPrice: number
  pos: THREE.Vector3
  display: THREE.Group
}

// mirrors arena.ts's exterior wall bounds/thickness — kept local since economy.ts
// doesn't otherwise depend on arena.ts
const X0 = -30
const X1 = 30
const Z0 = -22
const Z1 = 22
const WALL_T = 1

type Facing = 'west' | 'east' | 'north' | 'south'

// Weapon tiers deepen with the map: cell block → showers/warden → armory.
// pos is the along-wall coordinate (x for north/south, z for east/west) — the
// perpendicular coordinate snaps flush to whichever wall `facing` names.
const STATIONS: Array<{ weapon: string; price: number; pos: number; facing: Facing }> = [
  { weapon: 'garand', price: 600, pos: 4, facing: 'west' }, // cell block, near the entrance — the south-wall cells are sealed behind bars and unreachable
  { weapon: 'trench', price: 1200, pos: -6, facing: 'west' }, // showers
  { weapon: 'kurz', price: 1500, pos: -6, facing: 'east' }, // warden's wing
  { weapon: 'magnum', price: 1800, pos: -18, facing: 'east' }, // warden's wing, right by the yard door
  { weapon: 'liberator', price: 2500, pos: -8.5, facing: 'north' }, // armory west
  { weapon: 'hellfire', price: 3200, pos: 8.5, facing: 'north' }, // armory east
  { weapon: 'grinder', price: 3000, pos: 0, facing: 'north' }, // armory center — belt-fed
]

export function makeLabelSprite(lines: string[]): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 128
  const ctx = c.getContext('2d')!
  ctx.textAlign = 'center'
  ctx.fillStyle = '#84ff5a'
  ctx.shadowColor = '#3f8a2a'
  ctx.shadowBlur = 12
  ctx.font = 'bold 44px Impact, Arial Black, sans-serif'
  ctx.fillText(lines[0], 256, 52)
  ctx.font = 'bold 34px Impact, Arial Black, sans-serif'
  ctx.fillStyle = '#e0c020'
  ctx.fillText(lines[1], 256, 100)
  const tex = new THREE.CanvasTexture(c)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  )
  sprite.scale.set(3.4, 0.85, 1)
  return sprite
}

export class Economy {
  points = POINTS.start
  totalEarned = 0
  stations: WallBuy[] = []

  buildStations(scene: THREE.Scene) {
    for (const s of STATIONS) {
      const def = WEAPONS[s.weapon]
      const display = new THREE.Group()

      // snap to just inside the wall's interior face, and figure out which way
      // the gun's own barrel axis (local -Z) needs to turn to lie flat along it
      const STAND_OFF = 0.14
      let x: number
      let z: number
      let yaw: number
      // extra gun-local yaw (on top of the board's own `yaw` below) needed to
      // keep the muzzle pointing toward a viewer's right hand on this wall —
      // rotating about the gun's own up axis, so it never disturbs "up"
      let gunYaw: number
      switch (s.facing) {
        case 'west':
          x = X0 + WALL_T / 2 + STAND_OFF
          z = s.pos
          yaw = 0 // barrel already runs along Z, parallel to this wall
          gunYaw = 0
          break
        case 'east':
          x = X1 - WALL_T / 2 - STAND_OFF
          z = s.pos
          yaw = Math.PI
          gunYaw = 0
          break
        case 'north':
          x = s.pos
          z = Z0 + WALL_T / 2 + STAND_OFF
          yaw = Math.PI / 2 // turn the barrel to run along X instead
          gunYaw = Math.PI
          break
        case 'south':
          x = s.pos
          z = Z1 - WALL_T / 2 - STAND_OFF
          yaw = -Math.PI / 2
          gunYaw = Math.PI
          break
      }
      display.position.set(x, 0, z)
      display.rotation.y = yaw

      // mounted upright on the wall — sights to the ceiling, muzzle
      // toward a viewer's right hand — like a rack display —
      // buildViewmodel() bundles in first-person hands, which read as a
      // pair of disembodied arms once the gun is unhooked from the player's
      // own viewmodel rig, so strip them and mount just the gun itself
      const gun = buildViewmodel(def.id)
      const leftArm = gun.userData.leftArm as THREE.Object3D | undefined
      const rightArm = gun.userData.rightArm as THREE.Object3D | undefined
      if (leftArm) gun.remove(leftArm)
      if (rightArm) gun.remove(rightArm)

      // a white outline traced around the gun's own silhouette, computed
      // while it's still untransformed so the box lines up regardless of
      // this station's position/rotation/scale — added as a child of the
      // gun itself so it rides along with all three. buildViewmodel() bakes
      // in a first-person screen-space offset on the root group, which has
      // to be zeroed first or Box3 measures around the wrong center; gun's
      // matrixWorld also needs a forced refresh since it was never added to
      // a scene yet.
      gun.position.set(0, 0, 0)
      gun.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(gun)
      const outlineSize = box.getSize(new THREE.Vector3()).addScalar(0.03)
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(outlineSize.x, outlineSize.y, outlineSize.z)),
        new THREE.LineBasicMaterial({ color: 0xffffff }),
      )
      outline.position.copy(box.getCenter(new THREE.Vector3()))
      gun.add(outline)

      gun.position.set(0.08, 1.5, 0)
      // rotating only about the gun's own up axis keeps "up" pointing at the
      // ceiling no matter which wall it's mounted on — gunYaw just steers
      // the muzzle toward a viewer's right hand (it depends on which way
      // the wall faces, see the switch above)
      gun.rotation.y = gunYaw
      gun.scale.setScalar(1.8)
      gun.name = 'display-gun'
      display.add(gun)

      // sprites always billboard toward the camera on their own regardless of
      // parent rotation, so no extra facing logic needed here
      const label = makeLabelSprite([def.name, `${s.price}`])
      label.position.set(0.1, 2.5, 0)
      display.add(label)

      scene.add(display)
      this.stations.push({
        def,
        price: s.price,
        ammoPrice: Math.round(s.price / 2 / 50) * 50,
        pos: new THREE.Vector3(x, 0, z),
        display,
      })
    }
  }

  nearestStation(playerPos: THREE.Vector3, maxDist = 2.8): WallBuy | null {
    let best: WallBuy | null = null
    let bestD = maxDist
    for (const s of this.stations) {
      const d = Math.hypot(playerPos.x - s.pos.x, playerPos.z - s.pos.z)
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best
  }

  earn(amount: number) {
    this.points += amount
    this.totalEarned += amount
  }

  spend(amount: number): boolean {
    if (this.points < amount) return false
    this.points -= amount
    return true
  }

  /** No-op now that displays are static wall mounts, not spinning pedestals —
   *  kept so callers don't need to change. */
  update(_dt: number) {}
}
