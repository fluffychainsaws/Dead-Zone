import * as THREE from 'three'
import { WEAPONS, buildViewmodel, type WeaponDef } from './weapons'

export const POINTS = {
  hit: 10,
  kill: 50,
  headshotKill: 90,
  start: 500,
}

export interface WallBuy {
  def: WeaponDef
  price: number
  ammoPrice: number
  pos: THREE.Vector3
  display: THREE.Group
}

// One tier per room: cell block → showers → warden's wing (armory tiers in phase 11)
const STATIONS: Array<{ weapon: string; price: number; pos: [number, number] }> = [
  { weapon: 'garand', price: 600, pos: [-6, 20] }, // cell block, by the cells
  { weapon: 'trench', price: 1200, pos: [-28, -6] }, // showers, west wall
  { weapon: 'kurz', price: 1500, pos: [28, -6] }, // warden's wing, east wall
]

function makeLabelSprite(lines: string[]): THREE.Sprite {
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
      display.position.set(s.pos[0], 0, s.pos[1])

      const pedestal = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.9, 1.1),
        new THREE.MeshStandardMaterial({ color: 0x1e2a1e, roughness: 0.8 }),
      )
      pedestal.position.y = 0.45
      display.add(pedestal)

      const gun = buildViewmodel(def.id)
      gun.position.set(0, 1.5, 0)
      gun.scale.setScalar(2.2)
      gun.name = 'display-gun'
      display.add(gun)

      const label = makeLabelSprite([def.name, `${s.price}`])
      label.position.y = 2.5
      display.add(label)

      const glow = new THREE.PointLight(0xe0c020, 5, 7, 1.8)
      glow.position.y = 1.8
      display.add(glow)

      scene.add(display)
      this.stations.push({
        def,
        price: s.price,
        ammoPrice: Math.round(s.price / 2 / 50) * 50,
        pos: new THREE.Vector3(s.pos[0], 0, s.pos[1]),
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

  /** Idle animation for station displays. */
  update(dt: number) {
    for (const s of this.stations) {
      const gun = s.display.getObjectByName('display-gun')
      if (gun) gun.rotation.y += dt * 0.8
    }
  }
}
