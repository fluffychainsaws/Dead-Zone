// Screen brightness/gamma. Applied as an SVG gamma filter on the canvas (see
// index.html) so dark scenes stay readable on phone screens without touching
// the renderer's lighting.

const STORAGE_KEY = 'dz.display'
const DEFAULT_BRIGHTNESS = 1 // neutral gamma

interface DisplaySettings {
  brightness: number // 0.5 (darker) .. 2 (brighter), 1 = neutral
}

function loadSettings(): DisplaySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed.brightness === 'number') return parsed
    }
  } catch {
    /* corrupted or unavailable storage — fall back to defaults */
  }
  return { brightness: DEFAULT_BRIGHTNESS }
}

class DisplaySettingsStore {
  settings = loadSettings()

  constructor() {
    this.apply()
  }

  setBrightness(v: number) {
    this.settings.brightness = Math.min(2, Math.max(0.5, v))
    this.persist()
    this.apply()
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings))
    } catch {
      /* storage unavailable (private browsing etc.) — setting just won't persist */
    }
  }

  private apply() {
    // SVG gamma exponent runs the other way from "brightness": a lower
    // exponent lifts dark pixels, so higher brightness -> lower exponent.
    const exponent = (1 / this.settings.brightness).toFixed(3)
    document.getElementById('gamma-r')?.setAttribute('exponent', exponent)
    document.getElementById('gamma-g')?.setAttribute('exponent', exponent)
    document.getElementById('gamma-b')?.setAttribute('exponent', exponent)
  }
}

export const display = new DisplaySettingsStore()
