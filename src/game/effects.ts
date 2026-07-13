import * as THREE from 'three'

function makeGlowTexture(stops: [string, string, string]): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30)
  g.addColorStop(0, stops[0])
  g.addColorStop(0.4, stops[1])
  g.addColorStop(1, stops[2])
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

/** A tileable strip of dense forest — three overlapping jagged canopy ridges
 *  (solid fill, not individual trees with gaps between them, so nothing
 *  behind — stars included — shows through), plus a grass strip along the base. */
export function forestLineTexture(): THREE.CanvasTexture {
  const w = 512
  const h = 256
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!

  const grassTop = h * 0.87
  const grassGrad = ctx.createLinearGradient(0, grassTop, 0, h)
  grassGrad.addColorStop(0, '#1c3a1a')
  grassGrad.addColorStop(1, '#0d1f0d')
  ctx.fillStyle = grassGrad
  ctx.fillRect(0, grassTop, w, h - grassTop)

  // dense, fully-opaque black canopy ridges — a continuous silhouette per
  // layer (random-walk top edge) instead of separate trees with sky gaps
  // between them, so the whole strip reads as solid forest
  const drawRidge = (amp: number, jag: number, points: number) => {
    const ys: number[] = []
    let y = grassTop - Math.random() * amp * 0.5
    for (let i = 0; i <= points; i++) {
      y += (Math.random() - 0.5) * jag
      y = Math.max(grassTop - amp, Math.min(grassTop - amp * 0.15, y))
      ys.push(y)
    }
    ctx.beginPath()
    ctx.moveTo(0, grassTop)
    for (let i = 0; i <= points; i++) ctx.lineTo((i / points) * w, ys[i])
    ctx.lineTo(w, grassTop)
    ctx.closePath()
    ctx.fillStyle = '#000000'
    ctx.fill()
  }
  drawRidge(h * 0.34, h * 0.05, 40)
  drawRidge(h * 0.46, h * 0.07, 46)
  drawRidge(h * 0.6, h * 0.1, 52)

  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}

/** Small soft-edged circle — round PointsMaterial dots instead of square ones. */
export function dotTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 16, 16)
  return new THREE.CanvasTexture(c)
}

/** Cheap emissive marker — replaces a real PointLight for pure set dressing. */
export function glowSprite(
  stops: [string, string, string],
  scale: number,
  opacity = 0.6,
): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(stops),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity,
    }),
  )
  sprite.scale.setScalar(scale)
  return sprite
}

export const GLOW_RED: [string, string, string] = [
  'rgba(255,70,45,0.9)',
  'rgba(170,17,17,0.45)',
  'rgba(170,17,17,0)',
]
export const GLOW_GOLD: [string, string, string] = [
  'rgba(255,230,120,0.9)',
  'rgba(224,192,32,0.45)',
  'rgba(224,192,32,0)',
]
export const GLOW_CYAN: [string, string, string] = [
  'rgba(120,255,250,0.95)',
  'rgba(40,200,220,0.5)',
  'rgba(40,200,220,0)',
]
export const GLOW_BIO: [string, string, string] = [
  'rgba(150,255,150,0.95)',
  'rgba(60,230,110,0.5)',
  'rgba(60,230,110,0)',
]
export const GLOW_VIOLET: [string, string, string] = [
  'rgba(200,140,255,0.95)',
  'rgba(150,70,240,0.5)',
  'rgba(150,70,240,0)',
]

const TRACER_LIFE = 0.055
const SPARK_LIFE = 0.12
const TRACER_POOL = 24
const SPARK_POOL = 16

interface PooledSprite {
  sprite: THREE.Sprite
  life: number
}

interface PooledTracer {
  line: THREE.Line
  positions: THREE.BufferAttribute
  mat: THREE.LineBasicMaterial
  life: number
}

// Everything is pre-allocated and recycled — zero allocation during firefights.
export class Effects {
  muzzleLight: THREE.PointLight
  private explosionLight: THREE.PointLight

  private sparkTex = makeGlowTexture([
    'rgba(255,240,180,1)',
    'rgba(255,180,60,0.7)',
    'rgba(255,120,20,0)',
  ])
  private bloodTex = makeGlowTexture([
    'rgba(190,20,20,1)',
    'rgba(130,10,10,0.75)',
    'rgba(60,0,0,0)',
  ])
  private sparks: PooledSprite[] = []
  private bloods: PooledSprite[] = []
  private tracers: PooledTracer[] = []
  private sparkIdx = 0
  private bloodIdx = 0
  private tracerIdx = 0

  constructor(scene: THREE.Scene) {
    this.muzzleLight = new THREE.PointLight(0xffbb55, 0, 9, 2)
    scene.add(this.muzzleLight)
    this.explosionLight = new THREE.PointLight(0xffaa44, 0, 15, 2)
    scene.add(this.explosionLight)

    const makePool = (tex: THREE.Texture, blending: THREE.Blending): PooledSprite[] =>
      Array.from({ length: SPARK_POOL }, () => {
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: tex,
            blending,
            depthWrite: false,
            transparent: true,
          }),
        )
        sprite.visible = false
        scene.add(sprite)
        return { sprite, life: 0 }
      })
    this.sparks = makePool(this.sparkTex, THREE.AdditiveBlending)
    this.bloods = makePool(this.bloodTex, THREE.NormalBlending)

    for (let i = 0; i < TRACER_POOL; i++) {
      const positions = new THREE.BufferAttribute(new Float32Array(6), 3)
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', positions)
      const mat = new THREE.LineBasicMaterial({
        color: 0xffcc77,
        transparent: true,
        opacity: 0.8,
      })
      const line = new THREE.Line(geo, mat)
      line.visible = false
      line.frustumCulled = false
      scene.add(line)
      this.tracers.push({ line, positions, mat, life: 0 })
    }
  }

  muzzleFlash(worldPos: THREE.Vector3) {
    this.muzzleLight.position.copy(worldPos)
    this.muzzleLight.intensity = 26
  }

  impact(point: THREE.Vector3, kind: 'spark' | 'blood' = 'spark') {
    const pool = kind === 'blood' ? this.bloods : this.sparks
    const idx = kind === 'blood' ? this.bloodIdx++ : this.sparkIdx++
    const s = pool[idx % SPARK_POOL]
    s.sprite.position.copy(point)
    s.sprite.scale.setScalar(kind === 'blood' ? 0.55 : 0.35)
    ;(s.sprite.material as THREE.SpriteMaterial).opacity = 1
    s.sprite.visible = true
    s.life = SPARK_LIFE
  }

  /** A grenade blast — a bright flash plus a scattered burst of scaled-up sparks. */
  explosion(point: THREE.Vector3) {
    this.explosionLight.position.copy(point)
    this.explosionLight.intensity = 70
    for (let i = 0; i < 8; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5).normalize()
      this.impact(point.clone().addScaledVector(dir, Math.random() * 1.2), 'spark')
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const t = this.tracers[this.tracerIdx++ % TRACER_POOL]
    t.positions.setXYZ(0, from.x, from.y, from.z)
    t.positions.setXYZ(1, to.x, to.y, to.z)
    t.positions.needsUpdate = true
    t.mat.opacity = 0.8
    t.line.visible = true
    t.life = TRACER_LIFE
  }

  update(dt: number) {
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 300)
    this.explosionLight.intensity = Math.max(0, this.explosionLight.intensity - dt * 140)
    for (const pool of [this.sparks, this.bloods]) {
      for (const s of pool) {
        if (!s.sprite.visible) continue
        s.life -= dt
        if (s.life <= 0) {
          s.sprite.visible = false
          continue
        }
        s.sprite.scale.multiplyScalar(1 + dt * 6)
        ;(s.sprite.material as THREE.SpriteMaterial).opacity = s.life / SPARK_LIFE
      }
    }
    for (const t of this.tracers) {
      if (!t.line.visible) continue
      t.life -= dt
      if (t.life <= 0) t.line.visible = false
    }
  }
}
