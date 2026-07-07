// Generates the DEAD ZONE icon set as PNGs with zero native dependencies:
// pixels are rasterized in JS and encoded via node's zlib.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})

function crc32(buf) {
  let c = -1
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // scanlines, each prefixed with filter type 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const inEllipse = (u, v, cx, cy, rx, ry) =>
  ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1

function skullAlpha(u, v) {
  // 1 = bone, 0 = empty; cutouts return 0
  const cranium = inEllipse(u, v, 0.5, 0.44, 0.3, 0.27)
  const jaw =
    Math.abs(u - 0.5) < 0.16 && v > 0.6 && v < 0.8 &&
    (v < 0.76 || inEllipse(u, v, 0.5, 0.76, 0.16, 0.04))
  if (!cranium && !jaw) return 0
  // eye sockets
  if (inEllipse(u, v, 0.385, 0.46, 0.082, 0.098)) return 0
  if (inEllipse(u, v, 0.615, 0.46, 0.082, 0.098)) return 0
  // nose: triangle, apex up
  if (v > 0.52 && v < 0.63 && Math.abs(u - 0.5) < ((v - 0.52) / 0.11) * 0.05) return 0
  // teeth gaps
  if (v > 0.66 && v < 0.8) {
    for (const gx of [0.435, 0.5, 0.565]) {
      if (Math.abs(u - gx) < 0.011) return 0
    }
  }
  return 1
}

function render(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4)
  const scale = maskable ? 0.72 : 0.92
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (y * size + x) * 4
      let u = (x + 0.5) / size
      let v = (y + 0.5) / size
      // background: near-black with a sickly green radial glow behind the skull
      const d = Math.hypot(u - 0.5, v - 0.5)
      let r = 8 + 6 * Math.max(0, 0.5 - d)
      let g = 12 + 26 * Math.max(0, 0.55 - d)
      let b = 8 + 5 * Math.max(0, 0.5 - d)
      // draw skull in safe-zone-scaled coords, 2x2 supersampling for smoother edges
      let cov = 0
      for (const [ox, oy] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
        const su = 0.5 + ((x + 0.5 + ox) / size - 0.5) / scale
        const sv = 0.5 + ((y + 0.5 + oy) / size - 0.5) / scale
        cov += skullAlpha(su, sv) / 4
      }
      if (cov > 0) {
        // toxic-green bone, slightly darker toward the bottom
        const shade = 1 - 0.25 * Math.max(0, (v - 0.35) / 0.45)
        r = r * (1 - cov) + 132 * shade * cov
        g = g * (1 - cov) + 255 * shade * cov
        b = b * (1 - cov) + 90 * shade * cov
      }
      rgba[px] = Math.min(255, r | 0)
      rgba[px + 1] = Math.min(255, g | 0)
      rgba[px + 2] = Math.min(255, b | 0)
      rgba[px + 3] = 255
    }
  }
  return encodePng(size, rgba)
}

const targets = [
  ['icon-64.png', 64, {}],
  ['icon-180.png', 180, {}],
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-512-maskable.png', 512, { maskable: true }],
]
for (const [name, size, opts] of targets) {
  writeFileSync(join(outDir, name), render(size, opts))
  console.log(`wrote public/icons/${name}`)
}
