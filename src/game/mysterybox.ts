import * as THREE from 'three'
import { BOX_WEAPONS, buildViewmodel, type WeaponDef } from './weapons'
import { glowSprite, GLOW_GOLD } from './effects'

export const BOX_COST = 950
const SPIN_TIME = 2.6
const OFFER_TIME = 10
const CYCLE_STEP = 0.13

type BoxState = 'idle' | 'spinning' | 'offering'

/** The Mystery Box: 950 points a spin, 15 weapons you can't buy off a wall. */
export class MysteryBox {
  pos = new THREE.Vector3(-25, 0, 6)
  state: BoxState = 'idle'
  offered: WeaponDef | null = null

  private group = new THREE.Group()
  private spinT = 0
  private offerT = 0
  private cycleT = 0
  private displayGun: THREE.Group | null = null
  private labelCanvas = document.createElement('canvas')
  private labelTex: THREE.CanvasTexture
  private onTick: (() => void) | null = null
  private onReveal: (() => void) | null = null

  constructor(scene: THREE.Scene, sfx?: { tick?: () => void; reveal?: () => void }) {
    this.onTick = sfx?.tick ?? null
    this.onReveal = sfx?.reveal ?? null
    this.group.position.copy(this.pos)

    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.85, 0.95),
      new THREE.MeshLambertMaterial({ color: 0x4a3a22 }),
    )
    crate.position.y = 0.42
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(1.56, 0.12, 1.0),
      new THREE.MeshPhongMaterial({ color: 0x3a4145, shininess: 55 }),
    )
    trim.position.y = 0.86
    this.group.add(crate, trim)

    this.labelCanvas.width = 512
    this.labelCanvas.height = 128
    this.labelTex = new THREE.CanvasTexture(this.labelCanvas)
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.labelTex, transparent: true, depthWrite: false }),
    )
    label.scale.set(3.4, 0.85, 1)
    label.position.y = 2.1
    this.group.add(label)

    const glow = glowSprite(GLOW_GOLD, 2.6, 0.5)
    glow.position.y = 1.2
    this.group.add(glow)

    this.drawLabel('MYSTERY BOX', `${BOX_COST}`)
    scene.add(this.group)
  }

  private drawLabel(top: string, bottom: string) {
    const ctx = this.labelCanvas.getContext('2d')!
    ctx.clearRect(0, 0, 512, 128)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#84ff5a'
    ctx.shadowColor = '#3f8a2a'
    ctx.shadowBlur = 12
    ctx.font = 'bold 44px Impact, Arial Black, sans-serif'
    ctx.fillText(top, 256, 52)
    ctx.font = 'bold 34px Impact, Arial Black, sans-serif'
    ctx.fillStyle = '#e0c020'
    ctx.fillText(bottom, 256, 100)
    this.labelTex.needsUpdate = true
  }

  near(p: THREE.Vector3, maxDist = 2.9): boolean {
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < maxDist
  }

  prompt(interactKey: string): string | null {
    switch (this.state) {
      case 'idle':
        return `${interactKey} MYSTERY BOX — ${BOX_COST}`
      case 'spinning':
        return 'SPINNING…'
      case 'offering':
        return `${interactKey} TAKE ${this.offered!.name} (${Math.ceil(this.offerT)}s)`
    }
  }

  /** Call after payment succeeded. */
  spin() {
    if (this.state !== 'idle') return
    this.state = 'spinning'
    this.spinT = SPIN_TIME
    this.cycleT = 0
  }

  /** Take the offered weapon. */
  take(): WeaponDef | null {
    if (this.state !== 'offering' || !this.offered) return null
    const def = this.offered
    this.reset()
    return def
  }

  update(dt: number) {
    if (this.state === 'spinning') {
      this.spinT -= dt
      this.cycleT -= dt
      if (this.cycleT <= 0) {
        this.cycleT = CYCLE_STEP
        const random = BOX_WEAPONS[Math.floor(Math.random() * BOX_WEAPONS.length)]
        this.drawLabel(random.name, '???')
        this.onTick?.()
      }
      if (this.spinT <= 0) {
        this.state = 'offering'
        this.offerT = OFFER_TIME
        this.offered = BOX_WEAPONS[Math.floor(Math.random() * BOX_WEAPONS.length)]
        this.drawLabel(this.offered.name, 'TAKE IT!')
        this.displayGun = buildViewmodel(this.offered.id)
        this.displayGun.scale.setScalar(2.4)
        this.displayGun.position.set(0, 1.35, 0)
        this.group.add(this.displayGun)
        this.onReveal?.()
      }
      return
    }
    if (this.state === 'offering') {
      this.offerT -= dt
      if (this.displayGun) {
        this.displayGun.rotation.y += dt * 1.2
        this.displayGun.position.y = 1.35 + Math.sin(this.offerT * 2.2) * 0.06
      }
      if (this.offerT <= 0) this.reset() // too slow — it sinks back into the box
    }
  }

  private reset() {
    this.state = 'idle'
    this.offered = null
    if (this.displayGun) {
      this.group.remove(this.displayGun)
      this.displayGun = null
    }
    this.drawLabel('MYSTERY BOX', `${BOX_COST}`)
  }
}
