import * as THREE from 'three'

function makeGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30)
  g.addColorStop(0, 'rgba(255,240,180,1)')
  g.addColorStop(0.4, 'rgba(255,180,60,0.7)')
  g.addColorStop(1, 'rgba(255,120,20,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

interface Spark {
  sprite: THREE.Sprite
  life: number
}

interface Tracer {
  line: THREE.Line
  life: number
}

export class Effects {
  private scene: THREE.Scene
  private glowTex = makeGlowTexture()
  private sparks: Spark[] = []
  private tracers: Tracer[] = []
  muzzleLight: THREE.PointLight

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.muzzleLight = new THREE.PointLight(0xffbb55, 0, 9, 2)
    scene.add(this.muzzleLight)
  }

  muzzleFlash(worldPos: THREE.Vector3) {
    this.muzzleLight.position.copy(worldPos)
    this.muzzleLight.intensity = 26
  }

  impact(point: THREE.Vector3) {
    const mat = new THREE.SpriteMaterial({
      map: this.glowTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.position.copy(point)
    sprite.scale.setScalar(0.35)
    this.scene.add(sprite)
    this.sparks.push({ sprite, life: 0.12 })
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to])
    const mat = new THREE.LineBasicMaterial({
      color: 0xffcc77,
      transparent: true,
      opacity: 0.8,
    })
    const line = new THREE.Line(geo, mat)
    this.scene.add(line)
    this.tracers.push({ line, life: 0.055 })
  }

  update(dt: number) {
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 300)
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]
      s.life -= dt
      s.sprite.scale.multiplyScalar(1 + dt * 6)
      ;(s.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, s.life / 0.12)
      if (s.life <= 0) {
        this.scene.remove(s.sprite)
        s.sprite.material.dispose()
        this.sparks.splice(i, 1)
      }
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]
      t.life -= dt
      if (t.life <= 0) {
        this.scene.remove(t.line)
        t.line.geometry.dispose()
        ;(t.line.material as THREE.Material).dispose()
        this.tracers.splice(i, 1)
      }
    }
  }
}
