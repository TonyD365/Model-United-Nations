// 语音聊天：Trystero 音频流 P2P + WebAudio 按距离/语音区/发言权路由音量
import { S, local, emit } from './state.js'
import { avatarPosition } from './avatars.js'
import { position as selfPosition } from './player.js'
import { VOICE_FULL_DIST, VOICE_MAX_DIST } from './config.js'

let ctx = null
let localStream = null
let micTrack = null
let enabled = false
const peers = {}   // peerId -> { el, source, gain, speaking }

export async function initVoice(room) {
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    micTrack = localStream.getAudioTracks()[0]
    micTrack.enabled = false        // 默认静音，按钮开启
    room.addStream(localStream)
    room.onPeerStream = (stream, peerId) => attach(peerId, stream)
    emit('voiceReady', true)
    return true
  } catch (e) {
    console.warn('mic unavailable', e)
    emit('voiceReady', false)
    return false
  }
}

function attach(peerId, stream) {
  if (peers[peerId]) detach(peerId)
  // Chrome 需要把流也挂到 <audio>（静音）才会真正解码
  const el = new Audio()
  el.srcObject = stream; el.muted = true
  el.play().catch(() => {})
  const source = ctx.createMediaStreamSource(stream)
  const gain = ctx.createGain()
  gain.gain.value = 0
  source.connect(gain).connect(ctx.destination)
  peers[peerId] = { el, source, gain, speaking: false }
}

function detach(peerId) {
  const p = peers[peerId]; if (!p) return
  try { p.source.disconnect(); p.gain.disconnect(); p.el.srcObject = null } catch {}
  delete peers[peerId]
}

export function removeVoicePeer(peerId) { detach(peerId) }

export function setMicEnabled(on) {
  enabled = on
  if (micTrack) micTrack.enabled = on
  if (ctx && ctx.state === 'suspended') ctx.resume()
  return enabled
}
export function micEnabled() { return enabled }
export function hasVoice() { return !!micTrack }

function falloff(d) {
  if (d <= VOICE_FULL_DIST) return 1
  if (d >= VOICE_MAX_DIST) return 0
  return 1 - (d - VOICE_FULL_DIST) / (VOICE_MAX_DIST - VOICE_FULL_DIST)
}

// 每帧/低频调用：根据规则更新每个远端音量
export function updateVoice() {
  if (!ctx) return
  const myZone = local.zone || 'hall'
  const myPos = selfPosition()
  for (const peerId in peers) {
    const g = peers[peerId].gain
    const pl = S.players[peerId]
    const pPos = avatarPosition(peerId)
    let target = 0
    if (pl && pPos) {
      const pZone = pl.zone || 'hall'
      if (S.floor === peerId && myZone === 'hall') {
        target = 1                                   // 大厅广播发言权：全场可听
      } else if (myZone === pZone) {
        if (myZone === 'hall') {
          target = falloff(myPos.distanceTo(pPos))   // 大厅按距离
        } else {
          target = 1                                 // 同一办公室：满音量
        }
      }
    }
    // 平滑过渡
    g.gain.value += (target - g.gain.value) * 0.25
  }
}
