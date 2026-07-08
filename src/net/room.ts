import { joinRoom, selfId, type Room } from 'trystero'

export { selfId }

const APP_ID = 'dead-zone-fps-v1'

// Compact wire formats (arrays keep packets small at 10-15Hz)
export type PlayerState = [
  x: number,
  z: number,
  yaw: number,
  hp: number,
  down: 0 | 1,
  y: number,
  crouch: 0 | 1,
]
export type ZombieState = [
  id: number,
  x: number,
  z: number,
  ry: number,
  state: 0 | 1 | 2, // 0 chasing, 1 attacking, 2 dying
  runner: 0 | 1,
  midget: 0 | 1,
]

/** A midget currently latched onto someone's head: [zombie id, target id]. */
export type MidgetLatch = [number, string]

export type GameState = {
  w: number // wave
  ph: string // phase
  z: ZombieState[]
  p: Record<string, PlayerState>
  d: number[] // opened door ids
  mg: MidgetLatch[]
}

export type ShotMsg = {
  zid: number // zombie hit
  head: 0 | 1
  wid: string
  from: [number, number, number]
  to: [number, number, number]
}

export type ScoreMsg = {
  amt: number
  kill: 0 | 1
  head: 0 | 1
}

/** One pellet's tracer endpoint: [x, y, z, hit] — broadcast so every peer can see everyone's bullets. */
export type ShotFxMsg = {
  wid: string
  muzzle: [number, number, number]
  pts: Array<[number, number, number, 0 | 1]>
}

export type MeleeMsg = {
  ids: number[]
  px: number
  pz: number
  dx: number
  dz: number
}

/** A pry attempt against the Midget Zombie latched onto the sender's head. */
export type PryMsg = {
  zid: number
}

export function makeGameCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

export class NetRoom {
  room: Room
  code: string

  private state
  private input
  private shot
  private score
  private attack
  private revive
  private over
  private door
  private fx
  private melee
  private pry

  constructor(code: string, roomPrefix = 'game') {
    this.code = code
    this.room = joinRoom({ appId: APP_ID }, `${roomPrefix}-${code}`)
    this.state = this.room.makeAction<GameState>('state')
    this.input = this.room.makeAction<PlayerState>('input')
    this.shot = this.room.makeAction<ShotMsg>('shot')
    this.score = this.room.makeAction<ScoreMsg>('score')
    this.attack = this.room.makeAction<number>('attack')
    this.revive = this.room.makeAction<string>('revive')
    this.over = this.room.makeAction<null>('over')
    this.door = this.room.makeAction<number>('door')
    this.fx = this.room.makeAction<ShotFxMsg>('fx')
    this.melee = this.room.makeAction<MeleeMsg>('melee')
    this.pry = this.room.makeAction<PryMsg>('pry')
  }

  sendPry(s: PryMsg) {
    void this.pry.send(s)
  }
  onPry(cb: (s: PryMsg, from: string) => void) {
    this.pry.onMessage = (s, ctx) => cb(s, ctx.peerId)
  }

  sendFx(s: ShotFxMsg) {
    void this.fx.send(s)
  }
  onFx(cb: (s: ShotFxMsg, from: string) => void) {
    this.fx.onMessage = (s, ctx) => cb(s, ctx.peerId)
  }

  sendMelee(s: MeleeMsg) {
    void this.melee.send(s)
  }
  onMelee(cb: (s: MeleeMsg, from: string) => void) {
    this.melee.onMessage = (s, ctx) => cb(s, ctx.peerId)
  }

  sendDoor(id: number) {
    void this.door.send(id)
  }
  onDoor(cb: (id: number, from: string) => void) {
    this.door.onMessage = (id, ctx) => cb(id, ctx.peerId)
  }

  sendState(s: GameState) {
    void this.state.send(s)
  }
  onState(cb: (s: GameState, from: string) => void) {
    this.state.onMessage = (s, ctx) => cb(s, ctx.peerId)
  }

  sendInput(s: PlayerState) {
    void this.input.send(s)
  }
  onInput(cb: (s: PlayerState, from: string) => void) {
    this.input.onMessage = (s, ctx) => cb(s, ctx.peerId)
  }

  sendShot(s: ShotMsg) {
    void this.shot.send(s)
  }
  onShot(cb: (s: ShotMsg, from: string) => void) {
    this.shot.onMessage = (s, ctx) => cb(s, ctx.peerId)
  }

  sendScore(s: ScoreMsg, to: string) {
    void this.score.send(s, { target: to })
  }
  onScore(cb: (s: ScoreMsg) => void) {
    this.score.onMessage = (s) => cb(s)
  }

  sendAttack(dmg: number, to: string) {
    void this.attack.send(dmg, { target: to })
  }
  onAttack(cb: (dmg: number) => void) {
    this.attack.onMessage = (dmg) => cb(dmg)
  }

  sendRevive(target: string) {
    void this.revive.send(target)
  }
  onRevive(cb: (target: string) => void) {
    this.revive.onMessage = (t) => cb(t)
  }

  sendOver() {
    void this.over.send(null)
  }
  onOver(cb: () => void) {
    this.over.onMessage = () => cb()
  }

  onPeerJoin(cb: (id: string) => void) {
    this.room.onPeerJoin = cb
  }

  onPeerLeave(cb: (id: string) => void) {
    this.room.onPeerLeave = cb
  }

  peers(): string[] {
    return Object.keys(this.room.getPeers())
  }

  leave() {
    void this.room.leave()
  }
}
