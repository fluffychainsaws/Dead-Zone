import * as THREE from 'three'
import { BOX_WEAPONS, buildViewmodel, type WeaponDef } from './weapons'
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
const PILE_Y = 0.51 // the base's top surface — where the pile actually rests
const CHUTE_X = 0.5
const CHUTE_DROP_Y = 1.05
const TRAY_POS = new THREE.Vector3(0.5, 0.42, 1.3) // further out from the cabinet, easy to reach without opening it
const TINY_SCALE = 0.44 // pile/carried size
const TROPHY_SCALE = 0.85 // "regular size" once it's popped out into the tray

// full play envelope the claw's gantry can reach — the whole cabinet floor,
// not just a narrow strip down the middle
const PLAY_X_MIN = -0.68
const PLAY_X_MAX = 0.6
const PLAY_Z_MIN = -0.48
const PLAY_Z_MAX = 0.48

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
  weapon: WeaponDef
}

/** A static display copy of a weapon's viewmodel — same mesh the FPS view uses,
 *  just re-centered and stripped of the arms (which only make sense attached to
 *  a player). Used for the pile, the one the claw carries, and the trophy in the tray. */
function buildTrophyGun(id: string, scale: number): THREE.Group {
  const g = buildViewmodel(id)
  g.position.set(0, 0, 0)
  g.rotation.set(0, 0, 0)
  for (const arm of [g.userData.leftArm, g.userData.rightArm] as (THREE.Object3D | undefined)[]) {
    if (arm) g.remove(arm)
  }
  g.scale.setScalar(scale)
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
  private crossbar: THREE.Mesh
  private prongs: THREE.Mesh[] = []
  private pile: PrizeBox[] = []
  private grabbedPile: PrizeBox | null = null
  private prizeBox: THREE.Group | null = null
  private trayBox: THREE.Group | null = null
  private breakT = 0
  private marqueeLights: THREE.Mesh[] = []
  private lightsT = 0

  private phase: Phase = 'toPile'
  private phaseT = 0
  private labelCanvas = document.createElement('canvas')
  private labelTex: THREE.CanvasTexture
  private trayLabelCanvas = document.createElement('canvas')
  private trayLabelTex: THREE.CanvasTexture
  private traySprite: THREE.Sprite
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

    // control joystick, mounted on the front face of the base for show — the
    // actual claw-play controls are the interact prompt, this just sells the look
    const stickMat = new THREE.MeshPhongMaterial({ color: 0x1c1c1e, shininess: 70 })
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.06), metal)
    panel.position.set(0, 0.4, 0.73)
    this.group.add(panel)
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.16, 8), stickMat)
    stick.position.set(0, 0.47, 0.75)
    stick.rotation.x = -0.18
    this.group.add(stick)
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 10, 10),
      new THREE.MeshPhongMaterial({ color: 0xd02020, shininess: 90 }),
    )
    knob.position.set(0, 0.55, 0.765)
    this.group.add(knob)

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

    // carnival marquee bulbs wrapping all the way around the header, twinkling
    // in update() — trace the full rectangular perimeter, not just the sides
    const bulbColors = [0xff3030, 0xffd020, 0x30a0ff, 0x30e050]
    const bulbGeo = new THREE.SphereGeometry(0.035, 8, 8)
    const HW = 0.87 // just outside the header's x half-width (0.85)
    const HD = 0.73 // just outside the header's z half-depth (0.7)
    const STEP = 0.24
    const perimeter: [number, number][] = []
    for (let z = -0.6; z <= 0.6 + 1e-6; z += STEP) perimeter.push([-HW, z]) // left
    for (let x = -0.75; x <= 0.75 + 1e-6; x += STEP) perimeter.push([x, HD]) // front
    for (let z = 0.6; z >= -0.6 - 1e-6; z -= STEP) perimeter.push([HW, z]) // right
    for (let x = 0.75; x >= -0.75 - 1e-6; x -= STEP) perimeter.push([x, -HD]) // back
    perimeter.forEach(([x, z], i) => {
      const color = bulbColors[i % bulbColors.length]
      const bulb = new THREE.Mesh(
        bulbGeo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }),
      )
      bulb.position.set(x, 2.11, z)
      this.group.add(bulb)
      this.marqueeLights.push(bulb)
    })

    // full X-Y gantry: two fixed rails run along Z on either side, and a
    // crossbar spanning X slides along them — the claw hangs from a point that
    // slides along the crossbar. Together they can reach the whole cabinet floor.
    const railSpan = new THREE.CylinderGeometry(0.03, 0.03, PLAY_Z_MAX - PLAY_Z_MIN + 0.3, 8)
    for (const x of [PLAY_X_MIN - 0.06, PLAY_X_MAX + 0.06]) {
      const sideRail = new THREE.Mesh(railSpan, postMat)
      sideRail.rotation.x = Math.PI / 2
      sideRail.position.set(x, RAIL_Y + 0.14, 0)
      this.group.add(sideRail)
    }
    this.crossbar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, PLAY_X_MAX - PLAY_X_MIN + 0.3, 8),
      postMat,
    )
    this.crossbar.rotation.z = Math.PI / 2
    this.group.add(this.crossbar)

    // the pile of prize guns, spread across the full cabinet floor rather than
    // huddled in one corner — shuffled so the mix is varied, not list order
    const shuffled = [...BOX_WEAPONS].sort(() => Math.random() - 0.5)
    const cols = 5
    const rows = 4
    let wi = 0
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (wi >= 17) break
        const x =
          PLAY_X_MIN + (c / (cols - 1)) * (PLAY_X_MAX - PLAY_X_MIN) + (Math.random() - 0.5) * 0.09
        const z =
          PLAY_Z_MIN + (r / (rows - 1)) * (PLAY_Z_MAX - PLAY_Z_MIN) + (Math.random() - 0.5) * 0.09
        const weapon = shuffled[wi++ % shuffled.length]
        const prize = buildTrophyGun(weapon.id, TINY_SCALE)
        prize.position.set(x, 0, z)
        // tumbled, not robotically upright — it's a heap of tiny guns
        prize.rotation.set(
          (Math.random() - 0.5) * 1.4,
          Math.random() * Math.PI * 2,
          (Math.random() - 0.5) * 1.4,
        )
        // rest the gun's actual lowest point on the floor — tumbling it
        // however means no fixed Y works for every rotation, so measure it
        prize.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(prize)
        prize.position.y = PILE_Y - box.min.y
        this.group.add(prize)
        this.pile.push({ group: prize, homeX: x, homeZ: z, weapon })
      }
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
    this.claw.position.set(0, RAIL_Y, 0)
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

    // small name tag that floats over the trophy gun once it's in the tray
    this.trayLabelCanvas.width = 256
    this.trayLabelCanvas.height = 64
    this.trayLabelTex = new THREE.CanvasTexture(this.trayLabelCanvas)
    this.traySprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.trayLabelTex, transparent: true, depthWrite: false }),
    )
    this.traySprite.scale.set(0.85, 0.21, 1)
    this.traySprite.position.set(TRAY_POS.x, TRAY_POS.y + 0.4, TRAY_POS.z)
    this.traySprite.visible = false
    this.group.add(this.traySprite)

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

  /** Small name tag floated over the trophy gun once it's popped out — deliberately
   *  modest, unlike the big marquee label above the cabinet. */
  private drawTrayLabel(name: string) {
    const ctx = this.trayLabelCanvas.getContext('2d')!
    ctx.clearRect(0, 0, 256, 64)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#e0c020'
    ctx.shadowColor = '#000'
    ctx.shadowBlur = 5
    ctx.font = 'bold 20px Impact, Arial Black, sans-serif'
    ctx.fillText(name, 128, 38)
    this.trayLabelTex.needsUpdate = true
  }

  private updateCable() {
    const top = RAIL_Y + 0.12
    const bottom = this.claw.position.y
    const len = Math.max(0.02, top - bottom)
    this.cable.scale.y = len
    this.cable.position.set(this.claw.position.x, bottom + len / 2, this.claw.position.z)
    // the crossbar always sits directly above the claw's current Z, spanning X —
    // it's what the claw's trolley "slides along" to reach that Z
    this.crossbar.position.set(0, RAIL_Y + 0.14, this.claw.position.z)
  }

  private setProngs(openAmount: number) {
    // 0 = closed around a box, 1 = fully open
    const angle = 0.14 + openAmount * 0.55
    this.prongs.forEach((p) => (p.rotation.x = -angle))
  }

  near(p: THREE.Vector3, maxDist = 3.2): boolean {
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < maxDist
  }

  /** Teleport the whole cabinet — only call while idle, between rounds. */
  moveTo(x: number, z: number) {
    this.pos.set(x, 0, z)
    this.group.position.set(x, 0, z)
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

  /** Call after payment succeeded — starts the claw sequence. `ownsWeapon` lets
   *  the box avoid offering something already in the player's loadout. The pile
   *  is real guns now, so what gets grabbed is what you get — no hidden swap. */
  play(ownsWeapon: (id: string) => boolean) {
    if (this.state !== 'idle' || this.pile.length === 0) return
    this.state = 'busy'
    this.phase = 'toPile'
    this.phaseT = 0
    const notOwned = this.pile.filter((p) => !ownsWeapon(p.weapon.id))
    const candidates = notOwned.length > 0 ? notOwned : this.pile
    this.grabbedPile = candidates[Math.floor(Math.random() * candidates.length)]
    this.offered = this.grabbedPile.weapon
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
    this.lightsT += dt
    for (let i = 0; i < this.marqueeLights.length; i++) {
      const mat = this.marqueeLights[i].material as THREE.MeshBasicMaterial
      mat.opacity = 0.55 + 0.45 * Math.sin(this.lightsT * 4 + i * 0.9)
    }

    if (this.trayBox && this.breakT > 0) {
      this.breakT -= dt
      const t = 1 - this.breakT / BREAK_TIME
      this.trayBox.rotation.z = Math.sin(t * Math.PI * 6) * 0.25 * (1 - t)
      this.trayBox.scale.setScalar(TROPHY_SCALE * (1 + t * 0.6))
      if (this.breakT <= 0) {
        this.group.remove(this.trayBox)
        disposeGroup(this.trayBox)
        this.trayBox = null
        this.offered = null
        this.state = 'idle'
        this.drawLabel('CLAW MACHINE', `${BOX_COST}`)
        this.traySprite.visible = false
      }
    } else if (this.trayBox) {
      this.trayBox.rotation.y += dt * 1.4 // idle spin while it waits to be taken
    }

    if (this.state !== 'busy') return
    this.phaseT += dt
    const dur = PHASE_TIME[this.phase]
    const t = Math.min(1, this.phaseT / dur)
    const e = smoothstep(t)

    switch (this.phase) {
      case 'toPile':
        // travels from home (0,0) to wherever the chosen gun actually sits —
        // the gantry uses its whole range, not a fixed spot
        this.claw.position.x = this.grabbedPile ? e * this.grabbedPile.homeX : 0
        this.claw.position.z = this.grabbedPile ? e * this.grabbedPile.homeZ : 0
        this.claw.position.y = RAIL_Y
        if (this.phaseT % 0.15 < dt) this.onTick?.()
        break
      case 'descend':
        this.claw.position.y = RAIL_Y + (PILE_Y + 0.14 - RAIL_Y) * e
        break
      case 'grab':
        this.setProngs(1 - e)
        if (t >= 1 && this.grabbedPile) {
          // the pile gun just hides — a fresh one stands in for the one being
          // carried, so the pile is never actually depleted
          this.grabbedPile.group.visible = false
          this.prizeBox = buildTrophyGun(this.offered!.id, TINY_SCALE)
          this.claw.add(this.prizeBox)
          this.prizeBox.position.set(0, -0.32, 0)
          this.prizeBox.rotation.set(0, 0, 0)
          this.drawLabel(this.offered!.name, '???')
        }
        break
      case 'choosing':
        // claw holds still with the gun in view while tension builds — nothing
        // left to decide, it's visibly the one being carried
        if (this.phaseT % 0.4 < dt) this.onTick?.()
        if (t >= 1) this.drawLabel(`IT’S A ${this.offered!.name}!`, `${BOX_COST}`)
        break
      case 'ascend':
        this.claw.position.y = (PILE_Y + 0.14) + (RAIL_Y - (PILE_Y + 0.14)) * e
        break
      case 'toChute': {
        const fromX = this.grabbedPile?.homeX ?? 0
        const fromZ = this.grabbedPile?.homeZ ?? 0
        this.claw.position.x = fromX + (CHUTE_X - fromX) * e
        this.claw.position.z = fromZ + (0 - fromZ) * e
        break
      }
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
        // landed — pops out to regular size, spinning in the tray with its name
        // over it, ready to grab
        if (this.prizeBox) {
          this.prizeBox.position.copy(TRAY_POS)
          this.prizeBox.rotation.set(0, 0, 0)
          this.prizeBox.scale.setScalar(TROPHY_SCALE)
        }
        this.trayBox = this.prizeBox
        this.prizeBox = null
        if (this.grabbedPile) this.grabbedPile.group.visible = true // restock the pile
        this.grabbedPile = null
        this.setProngs(1)
        this.claw.position.set(0, RAIL_Y, 0)
        this.updateCable()
        this.onReveal?.()
        this.state = 'ready'
        this.drawLabel('PRIZE READY', this.offered?.name ?? '')
        this.drawTrayLabel(this.offered?.name ?? '')
        this.traySprite.visible = true
      }
    }
  }
}
