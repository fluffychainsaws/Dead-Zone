// Unified input: desktop (pointer lock + WASD) and touch (joystick + drag-aim).
export class Input {
  readonly isTouch =
    'ontouchstart' in window || navigator.maxTouchPoints > 0

  locked = false
  fireHeld = false
  aimHeld = false

  private keys = new Set<string>()
  private lookX = 0
  private lookY = 0
  private firePresses = 0
  private reloadPresses = 0
  private interactPresses = 0
  private switchPresses = 0
  private jumpPresses = 0
  private crouchPresses = 0
  private meleePresses = 0
  private lightPresses = 0
  private joyX = 0
  private joyY = 0
  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    if (this.isTouch) {
      this.buildTouchControls()
    } else {
      this.bindDesktop()
    }
    document.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  // -1..1; x = strafe right, z = forward
  moveVec(): { x: number; z: number } {
    if (this.isTouch) return { x: this.joyX, z: -this.joyY }
    let x = 0
    let z = 0
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1
    const len = Math.hypot(x, z)
    return len > 1 ? { x: x / len, z: z / len } : { x, z }
  }

  get sprint(): boolean {
    if (this.isTouch) return Math.hypot(this.joyX, this.joyY) > 0.92
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
  }

  consumeLook(): { x: number; y: number } {
    const out = { x: this.lookX, y: this.lookY }
    this.lookX = 0
    this.lookY = 0
    return out
  }

  consumeFirePress(): boolean {
    if (this.firePresses > 0) {
      this.firePresses--
      return true
    }
    return false
  }

  consumeReload(): boolean {
    if (this.reloadPresses > 0) {
      this.reloadPresses--
      return true
    }
    return false
  }

  consumeInteract(): boolean {
    if (this.interactPresses > 0) {
      this.interactPresses--
      return true
    }
    return false
  }

  consumeSwitch(): boolean {
    if (this.switchPresses > 0) {
      this.switchPresses--
      return true
    }
    return false
  }

  consumeJump(): boolean {
    if (this.jumpPresses > 0) {
      this.jumpPresses--
      return true
    }
    return false
  }

  consumeCrouch(): boolean {
    if (this.crouchPresses > 0) {
      this.crouchPresses--
      return true
    }
    return false
  }

  consumeMelee(): boolean {
    if (this.meleePresses > 0) {
      this.meleePresses--
      return true
    }
    return false
  }

  consumeLightToggle(): boolean {
    if (this.lightPresses > 0) {
      this.lightPresses--
      return true
    }
    return false
  }

  requestLock() {
    if (!this.isTouch && !this.locked) this.canvas.requestPointerLock()
  }

  /** Is this key currently held? (desktop only — always false on touch). */
  isDown(code: string): boolean {
    return this.keys.has(code)
  }

  // ---------------- desktop ----------------

  private bindDesktop() {
    document.addEventListener('keydown', (e) => {
      if (e.repeat) return
      this.keys.add(e.code)
      if (e.code === 'KeyR') this.reloadPresses++
      if (e.code === 'KeyE') this.interactPresses++
      if (e.code === 'KeyQ' || e.code === 'Digit1' || e.code === 'Digit2')
        this.switchPresses++
      if (e.code === 'Space') this.jumpPresses++
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.crouchPresses++
      if (e.code === 'KeyV') this.meleePresses++
      if (e.code === 'KeyT') this.lightPresses++
    })
    document.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0 && e.button !== 2) return
      if (!this.locked) {
        this.canvas.requestPointerLock()
        return
      }
      if (e.button === 0) {
        this.fireHeld = true
        this.firePresses++
      } else {
        this.aimHeld = true
      }
    })
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false
      else if (e.button === 2) this.aimHeld = false
    })
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas
      if (!this.locked) {
        this.fireHeld = false
        this.aimHeld = false
      }
    })
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return
      this.lookX += e.movementX * 0.0022
      this.lookY += e.movementY * 0.0022
    })
  }

  // ---------------- touch ----------------

  private buildTouchControls() {
    const root = document.createElement('div')
    root.id = 'touch-controls'
    root.innerHTML = `
      <div id="joy-zone"><div id="joy-base"><div id="joy-knob"></div></div></div>
      <div id="look-zone"></div>
      <button id="btn-fire">FIRE</button>
      <button id="btn-aim">ADS</button>
      <button id="btn-reload">R</button>
      <button id="btn-swap">⇄</button>
      <button id="btn-jump">▲</button>
      <button id="btn-crouch">⤓</button>
      <button id="btn-melee">✊</button>
      <button id="btn-light">🔦</button>
      <button id="btn-interact">USE</button>
    `
    document.getElementById('app')!.appendChild(root)

    const joyZone = root.querySelector<HTMLElement>('#joy-zone')!
    const joyBase = root.querySelector<HTMLElement>('#joy-base')!
    const joyKnob = root.querySelector<HTMLElement>('#joy-knob')!
    const lookZone = root.querySelector<HTMLElement>('#look-zone')!

    let joyId = -1
    let joyCX = 0
    let joyCY = 0
    const RADIUS = 52

    joyZone.addEventListener('pointerdown', (e) => {
      if (joyId !== -1) return
      joyId = e.pointerId
      joyZone.setPointerCapture(e.pointerId)
      joyCX = e.clientX
      joyCY = e.clientY
      joyBase.style.left = `${e.clientX}px`
      joyBase.style.top = `${e.clientY}px`
      joyBase.classList.add('active')
    })
    joyZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== joyId) return
      let dx = e.clientX - joyCX
      let dy = e.clientY - joyCY
      const len = Math.hypot(dx, dy)
      if (len > RADIUS) {
        dx = (dx / len) * RADIUS
        dy = (dy / len) * RADIUS
      }
      joyKnob.style.transform = `translate(${dx}px, ${dy}px)`
      this.joyX = dx / RADIUS
      this.joyY = dy / RADIUS
    })
    const joyEnd = (e: PointerEvent) => {
      if (e.pointerId !== joyId) return
      joyId = -1
      this.joyX = 0
      this.joyY = 0
      joyKnob.style.transform = ''
      joyBase.classList.remove('active')
    }
    joyZone.addEventListener('pointerup', joyEnd)
    joyZone.addEventListener('pointercancel', joyEnd)

    let lookId = -1
    let lastX = 0
    let lastY = 0
    lookZone.addEventListener('pointerdown', (e) => {
      if (lookId !== -1) return
      lookId = e.pointerId
      lookZone.setPointerCapture(e.pointerId)
      lastX = e.clientX
      lastY = e.clientY
    })
    lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return
      this.lookX += (e.clientX - lastX) * 0.0055
      this.lookY += (e.clientY - lastY) * 0.0055
      lastX = e.clientX
      lastY = e.clientY
    })
    const lookEnd = (e: PointerEvent) => {
      if (e.pointerId === lookId) lookId = -1
    }
    lookZone.addEventListener('pointerup', lookEnd)
    lookZone.addEventListener('pointercancel', lookEnd)

    const fire = root.querySelector<HTMLElement>('#btn-fire')!
    fire.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.fireHeld = true
      this.firePresses++
    })
    const fireEnd = () => (this.fireHeld = false)
    fire.addEventListener('pointerup', fireEnd)
    fire.addEventListener('pointercancel', fireEnd)

    const aim = root.querySelector<HTMLElement>('#btn-aim')!
    aim.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.aimHeld = true
    })
    const aimEnd = () => (this.aimHeld = false)
    aim.addEventListener('pointerup', aimEnd)
    aim.addEventListener('pointercancel', aimEnd)

    root.querySelector('#btn-reload')!.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.reloadPresses++
    })
    root.querySelector('#btn-interact')!.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.interactPresses++
    })
    root.querySelector('#btn-swap')!.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.switchPresses++
    })
    root.querySelector('#btn-jump')!.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.jumpPresses++
    })
    root.querySelector('#btn-crouch')!.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.crouchPresses++
    })
    root.querySelector('#btn-melee')!.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.meleePresses++
    })
    root.querySelector('#btn-light')!.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.lightPresses++
    })
  }
}
