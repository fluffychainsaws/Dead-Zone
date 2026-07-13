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

/** A tileable strip of layered pine-tree silhouettes — nearer trees darker/taller
 *  in front, distant ones smaller and dimmer behind, transparent above the
 *  treeline so the sky/moon still show through. */
export function forestLineTexture(): THREE.CanvasTexture {
  const w = 512
  const h = 256
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!

  const layers: Array<{ color: string; baseY: number; minH: number; maxH: number; count: number }> = [
    { color: '#050e08', baseY: h * 0.74, minH: h * 0.26, maxH: h * 0.48, count: 13 },
    { color: '#081b0e', baseY: h * 0.84, minH: h * 0.38, maxH: h * 0.64, count: 11 },
    { color: '#0c2814', baseY: h * 0.95, minH: h * 0.52, maxH: h * 0.86, count: 9 },
  ]
  for (const layer of layers) {
    ctx.fillStyle = layer.color
    const slot = w / layer.count
    for (let i = 0; i < layer.count; i++) {
      const cx = (i + 0.5) * slot + (Math.random() - 0.5) * slot * 0.6
      const treeW = slot * (0.7 + Math.random() * 0.5)
      const treeH = layer.minH + Math.random() * (layer.maxH - layer.minH)
      const topY = layer.baseY - treeH
      const tiers = 3
      for (let t = 0; t < tiers; t++) {
        const tierTop = topY + (treeH / tiers) * t
        const tierBase = topY + (treeH / tiers) * (t + 1) + treeH * 0.08
        const tierW = treeW * (0.35 + ((t + 1) / tiers) * 0.65)
        ctx.beginPath()
        ctx.moveTo(cx, tierTop)
        ctx.lineTo(cx - tierW / 2, tierBase)
        ctx.lineTo(cx + tierW / 2, tierBase)
        ctx.closePath()
        ctx.fill()
      }
    }
  }

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
