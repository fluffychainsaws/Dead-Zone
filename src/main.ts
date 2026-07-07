import './theme.css'
import * as THREE from 'three'
import { registerSW } from 'virtual:pwa-register'

registerSW({ immediate: true })

// ---- Placeholder atmosphere scene (replaced by the game in later phases) ----

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0b0f0b)
scene.fog = new THREE.FogExp2(0x0b120b, 0.09)

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100)
camera.position.set(0, 1.7, 8)

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0x101510, roughness: 1 }),
)
ground.rotation.x = -Math.PI / 2
scene.add(ground)

// scattered debris silhouettes in the fog
const debrisMat = new THREE.MeshStandardMaterial({ color: 0x151d15, roughness: 0.9 })
const rng = (min: number, max: number) => min + Math.random() * (max - min)
for (let i = 0; i < 40; i++) {
  const w = rng(0.4, 2.2)
  const h = rng(0.5, 3)
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, rng(0.4, 2.2)), debrisMat)
  const angle = rng(0, Math.PI * 2)
  const dist = rng(4, 30)
  box.position.set(Math.cos(angle) * dist, h / 2, Math.sin(angle) * dist)
  box.rotation.y = rng(0, Math.PI)
  scene.add(box)
}

scene.add(new THREE.AmbientLight(0x1c2a1c, 0.8))
const flickerLight = new THREE.PointLight(0x66ff44, 14, 30, 1.6)
flickerLight.position.set(0, 3.5, 0)
scene.add(flickerLight)
const moonLight = new THREE.DirectionalLight(0x334433, 0.5)
moonLight.position.set(-6, 10, -4)
scene.add(moonLight)

function resize() {
  const { innerWidth: w, innerHeight: h } = window
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

const clock = new THREE.Clock()
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime()
  camera.position.x = Math.sin(t * 0.08) * 9
  camera.position.z = Math.cos(t * 0.08) * 9
  camera.lookAt(0, 1.2, 0)
  flickerLight.intensity = 11 + Math.sin(t * 13.7) * 2 + Math.sin(t * 41.3) * 1.5
  renderer.render(scene, camera)
})
