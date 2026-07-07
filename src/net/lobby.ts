import { joinRoom, selfId, type Room } from 'trystero'

// The global presence room: every menu browser and every active host joins
// `lobby-global-v1`. Hosts heartbeat their game ad; browsers list what's live.

const APP_ID = 'dead-zone-fps-v1'
const LOBBY_ROOM = 'lobby-global-v1'
const AD_INTERVAL_MS = 3000
const AD_EXPIRY_MS = 9000

export type GameAd = {
  code: string
  host: string
  wave: number
  players: number
}

export interface LobbyEntry {
  ad: GameAd
  seen: number
}

export class Lobby {
  private room: Room
  private ad
  private games = new Map<string, LobbyEntry>()
  private heartbeat: ReturnType<typeof setInterval> | null = null
  onUpdate: (() => void) | null = null

  constructor() {
    this.room = joinRoom({ appId: APP_ID }, LOBBY_ROOM)
    this.ad = this.room.makeAction<GameAd>('ad')
    this.ad.onMessage = (ad) => {
      this.games.set(ad.code, { ad, seen: Date.now() })
      this.onUpdate?.()
    }
    this.room.onPeerJoin = () => this.onUpdate?.()
    this.room.onPeerLeave = () => this.onUpdate?.()
  }

  /** Live, unexpired game ads, busiest first. */
  list(): GameAd[] {
    const now = Date.now()
    for (const [code, entry] of this.games) {
      if (now - entry.seen > AD_EXPIRY_MS) this.games.delete(code)
    }
    return [...this.games.values()]
      .map((e) => e.ad)
      .sort((a, b) => b.players - a.players)
  }

  /** Peers visible in the lobby right now (excluding self). */
  playersOnline(): number {
    return Object.keys(this.room.getPeers()).length
  }

  /** Host side: start heartbeating this game's ad. */
  startAnnouncing(getAd: () => GameAd) {
    this.stopAnnouncing()
    const send = () => void this.ad.send(getAd())
    send()
    this.heartbeat = setInterval(send, AD_INTERVAL_MS)
  }

  stopAnnouncing() {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  leave() {
    this.stopAnnouncing()
    void this.room.leave()
  }
}

export function shortName(): string {
  return `SURVIVOR-${selfId.slice(0, 4).toUpperCase()}`
}
