import * as THREE from 'three'
import { BOX_WEAPONS, type WeaponDef } from './weapons'
import { glowSprite, GLOW_GOLD } from './effects'

export const BOX_COST = 950
const BREAK_TIME = 0.45

// Claw choreography — scripted phases, each with a fixed duration. 'choosing' is the
// suspenseful pause where the claw holds the box still while the prize is decided.
const PHASES = [
  'toPile',
  'descend',
  'grab',
  'choosing',
  'ascend',
  'toChute',
  'release',
  'falling',
] as const
type Phase = (typeof PHASES)[number]
const CHOOSING_TIME = 3.4 // at least 3s slower — the suspenseful "deciding" pause
const PHASE_TIME: Record<Phase, number> = {
  toPile: 0.5,
  descend: 0.55,
  grab: 0.3,
  choosing: CHOOSING_TIME,
  ascend: 0.55,
  toChute: 0.6,
  release: 0.25,
  falling: 0.45,
}

const RAIL_Y = 1.85
const PILE_X = -0.45
const PILE_Y = 0.58
const CHUTE_X = 0.5
const CHUTE_DROP_Y = 1.05
const TRAY_POS = new THREE.Vector3(0.5, 0.42, 0.95) // outside the cabinet, reachable without opening it

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose()
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
      else o.material.dispose()
    }
  })
}

type BoxState = 'idle' | 'busy' | 'ready'

interface PrizeBox {
  group: THREE.Group
  homeX: number
  homeZ: number
  color: number
}

function buildPrizeBox(color: number): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.2, 0.22),
    new THREE.MeshLambertMaterial({ color }),
  )
  const ribbon = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.05, 0.06),
    new THREE.MeshLambertMaterial({ color: 0xe0c020 }),
  )
  ribbon.position.y = 0.02
  const ribbon2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.05, 0.24),
    new THREE.MeshLambertMaterial({ color: 0xe0c020 }),
  )
  ribbon2.position.y = 0.02
  g.add(body, ribbon, ribbon2)
  return g
}

/** A claw machine: pay to play, the claw grabs a box and drops it in the tray, break it open to see the gun. */
export class MysteryBox {
  pos = new THREE.Vector3(-25, 0, 6)
  state: BoxState = 'idle'
  offered: WeaponDef | null = null

  private group = new THREE.Group()
  private claw = new THREE.Group()
  private cable: THREE.Mesh
  private prongs: THREE.Mesh[] = []
  private pile: PrizeBox[] = []
  private grabbedPile: PrizeBox | null = null
  private prizeBox: THREE.Group | null = null
  private trayBox: THREE.Group | null = null
  private breakT = 0

  private phase: Phase = 'toPile'
  private phaseT = 0
  private labelCanvas = document.createElement('canvas')
  private labelTex: THREE.CanvasTexture
  private onTick: (() => void) | null = null
  private onReveal: (() => void) | null = null

  constructor(scene: THREE.Scene, sfx?: { tick?: () => void; reveal?: () => void }) {
    this.onTick = sfx?.tick ?? null
    this.onReveal = sfx?.reveal ?? null
    this.group.position.copy(this.pos)

    const metal = new THREE.MeshPhongMaterial({ color: 0x3a4145, shininess: 55 })
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 1.4), metal)
    base.position.y = 0.25
    this.group.add(base)

    // corner posts read the cabinet's shape even through the transparent glass
    const postMat = new THREE.MeshPhongMaterial({ color: 0x2b3035, shininess: 40 })
    for (const [x, z] of [
      [-0.78, -0.62],
      [0.78, -0.62],
      [-0.78, 0.62],
      [0.78, 0.62],
    ]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.55, 0.06), postMat)
      post.position.set(x, 0.5 + 0.775, z)
      this.group.add(post)
    }
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(1.56, 1.5, 1.26),
      new THREE.MeshPhongMaterial({
        color: 0x7fd0e8,
        transparent: true,
        opacity: 0.16,
        shininess: 80,
      }),
    )
    glass.position.y = 0.5 + 0.75
    this.group.add(glass)

    const header = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 1.4), metal)
    header.position.y = 2.11
    this.group.add(header)

    // rail the claw rides along
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8),
      postMat,
    )
    rail.rotation.z = Math.PI / 2
    rail.position.set(0, RAIL_Y + 0.12, 0)
    this.group.add(rail)

    // the pile of prize boxes, sitting on the cabinet floor
    const colors = [0x4a3a22, 0x2e4a22, 0x3a2244, 0x224a44]
    let ci = 0
    for (const [x, z] of [
      [-0.55, -0.3],
      [-0.3, 0.1],
      [-0.55, 0.35],
      [-0.15, -0.35],
      [-0.65, 0.05],
      [-0.25, 0.4],
    ]) {
      const color = colors[ci++ % colors.length]
      const prize = buildPrizeBox(color)
      prize.position.set(x, 0.58, z)
      prize.rotation.y = Math.random() * Math.PI
      this.group.add(prize)
      this.pile.push({ group: prize, homeX: x, homeZ: z, color })
    }

    // claw head: housing + three prongs
    const clawMat = new THREE.MeshPhongMaterial({ color: 0x555f52, shininess: 60 })
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 8), clawMat)
    this.claw.add(housing)
    for (let i = 0; i < 3; i++) {
      const prong = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.05), clawMat)
      prong.position.y = -0.15
      const pivot = new THREE.Group()
      pivot.rotation.y = (i / 3) * Math.PI * 2
      pivot.add(prong)
      prong.position.set(0, -0.15, 0.06)
      this.claw.add(pivot)
      this.prongs.push(prong)
    }
    this.claw.position.set(PILE_X, RAIL_Y, 0)
    this.group.add(this.claw)

    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 6), postMat)
    this.group.add(this.cable)
    this.updateCable()

    this.labelCanvas.width = 512
    this.labelCanvas.height = 128
    this.labelTex = new THREE.CanvasTexture(this.labelCanvas)
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.labelTex, transparent: true, depthWrite: false }),
    )
    label.scale.set(3.4, 0.85, 1)
    label.position.y = 2.6
    this.group.add(label)

    const glow = glowSprite(GLOW_GOLD, 2.6, 0.45)
    glow.position.y = 1.6
    this.group.add(glow)

    this.drawLabel('CLAW MACHINE', `${BOX_COST}`)
    scene.add(this.group)
  }

  private drawLabel(top: string, bottom: string) {
    const ctx = this.labelCanvas.getContext('2d')!
    ctx.clearRect(0, 0, 512, 128)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#84ff5a'
    ctx.shadowColor = '#3f8a2a'
    ctx.shadowBlur = 12
    ctx.font = 'bold 40px Impact, Arial Black, sans-serif'
    ctx.fillText(top, 256, 52)
    ctx.font = 'bold 34px Impact, Arial Black, sans-serif'
    ctx.fillStyle = '#e0c020'
    ctx.fillText(bottom, 256, 100)
    this.labelTex.needsUpdate = true
  }

  private updateCable() {
    const top = RAIL_Y + 0.12
    const bottom = this.claw.position.y
    const len = Math.max(0.02, top - bottom)
    this.cable.scale.y = len
    this.cable.position.set(this.claw.position.x, bottom + len / 2, this.claw.position.z)
  }

  private setProngs(openAmount: number) {
    // 0 = closed around a box, 1 = fully open
    const angle = 0.14 + openAmount * 0.55
    this.prongs.forEach((p) => (p.rotation.x = -angle))
  }

  near(p: THREE.Vector3, maxDist = 3.2): boolean {
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < maxDist
  }

  prompt(interactKey: string): string | null {
    switch (this.state) {
      case 'idle':
        return `${interactKey} PLAY CLAW MACHINE — ${BOX_COST}`
      case 'busy':
        return 'WORKING…'
      case 'ready':
        return `${interactKey} TAKE BOX`
    }
  }

  /** Call after payment succeeded — starts the claw sequence. */
  play() {
    if (this.state !== 'idle' || this.pile.length === 0) return
    this.state = 'busy'
    this.phase = 'toPile'
    this.phaseT = 0
    this.offered = null // decided at the end of the 'choosing' phase, for real suspense
    this.grabbedPile = this.pile[Math.floor(Math.random() * this.pile.length)]
    this.setProngs(1)
  }

  /** Break open the box waiting in the tray. Returns the weapon it turns out to be. */
  take(): WeaponDef | null {
    if (this.state !== 'ready' || !this.offered) return null
    const def = this.offered
    this.breakT = BREAK_TIME
    return def
  }

  update(dt: number) {
    if (this.trayBox && this.breakT > 0) {
      this.breakT -= dt
      const t = 1 - this.breakT / BREAK_TIME
      this.trayBox.rotation.z = Math.sin(t * Math.PI * 6) * 0.25 * (1 - t)
      this.trayBox.scale.setScalar(1 + t * 0.6)
      if (this.breakT <= 0) {
        this.group.remove(this.trayBox)
        disposeGroup(this.trayBox)
        this.trayBox = null
        this.offered = null
        this.state = 'idle'
        this.drawLabel('CLAW MACHINE', `${BOX_COST}`)
      }
    }

    if (this.state !== 'busy') return
    this.phaseT += dt
    const dur = PHASE_TIME[this.phase]
    const t = Math.min(1, this.phaseT / dur)
    const e = smoothstep(t)

    switch (this.phase) {
      case 'toPile':
        this.claw.position.x = e * PILE_X
        this.claw.position.z = 0
        this.claw.position.y = RAIL_Y
        if (this.phaseT % 0.15 < dt) this.onTick?.()
        break
      case 'descend':
        this.claw.position.y = RAIL_Y + (PILE_Y + 0.14 - RAIL_Y) * e
        break
      case 'grab':
        this.setProngs(1 - e)
        if (t >= 1 && this.grabbedPile) {
          // the pile box just hides — a fresh box stands in for the one being carried,
          // so the pile is never actually depleted
          this.grabbedPile.group.visible = false
          this.prizeBox = buildPrizeBox(this.grabbedPile.color)
          this.claw.add(this.prizeBox)
          this.prizeBox.position.set(0, -0.32, 0)
          this.prizeBox.rotation.set(0, 0, 0)
        }
        break
      case 'choosing':
        // claw holds still with the box while the prize is decided — the suspense beat
        if (this.phaseT % 0.15 < dt) {
          const random = BOX_WEAPONS[Math.floor(Math.random() * BOX_WEAPONS.length)]
          this.drawLabel(random.name, '???')
          this.onTick?.()
        }
        if (t >= 1) {
          this.offered = BOX_WEAPONS[Math.floor(Math.random() * BOX_WEAPONS.length)]
          this.drawLabel('IT’S DECIDED…', '???')
        }
        break
      case 'ascend':
        this.claw.position.y = (PILE_Y + 0.14) + (RAIL_Y - (PILE_Y + 0.14)) * e
        break
      case 'toChute':
        this.claw.position.x = PILE_X + (CHUTE_X - PILE_X) * e
        break
      case 'release':
        this.claw.position.y = RAIL_Y + (CHUTE_DROP_Y - RAIL_Y) * e
        this.setProngs(e)
        if (t >= 1 && this.prizeBox) {
          const world = new THREE.Vector3()
          this.prizeBox.getWorldPosition(world)
          this.claw.remove(this.prizeBox)
          this.group.worldToLocal(world)
          this.prizeBox.position.copy(world)
          this.group.add(this.prizeBox)
        }
        break
      case 'falling':
        if (this.prizeBox) {
          this.prizeBox.position.x = CHUTE_X + (TRAY_POS.x - CHUTE_X) * e
          this.prizeBox.position.z = 0 + (TRAY_POS.z - 0) * e
          // a little arc rather than a straight drop
          const arc = Math.sin(Math.PI * t) * 0.35
          this.prizeBox.position.y = CHUTE_DROP_Y + (TRAY_POS.y - CHUTE_DROP_Y) * e + arc
          this.prizeBox.rotation.x += dt * 4
        }
        break
    }

    this.updateCable()

    if (t >= 1) {
      const idx = PHASES.indexOf(this.phase)
      if (idx < PHASES.length - 1) {
        this.phase = PHASES[idx + 1]
        this.phaseT = 0
      } else {
        // landed — box waits in the tray, still a mystery until broken open
        if (this.prizeBox) {
          this.prizeBox.position.copy(TRAY_POS)
          this.prizeBox.rotation.set(0, Math.random() * Math.PI, 0)
        }
        this.trayBox = this.prizeBox
        this.prizeBox = null
        if (this.grabbedPile) this.grabbedPile.group.visible = true // restock the pile
        this.grabbedPile = null
        this.setProngs(1)
        this.claw.position.set(PILE_X, RAIL_Y, 0)
        this.updateCable()
        this.onReveal?.()
        this.state = 'ready'
        this.drawLabel('PRIZE READY', 'BREAK IT OPEN')
      }
    }
  }
}
