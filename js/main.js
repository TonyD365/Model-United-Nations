// 引导：装配场景 + 网络 + UI，运行主循环
import { camera, overviewCamera, setActiveCamera, onTick, startLoop } from './scene.js'
import { buildHall, ROSTRUM_SEAT_IDS } from './hall.js'
import { buildOffices, zoneAt } from './office.js'
import { VOICE_UPDATE_HZ } from './config.js'
import { S, local, on, isHost } from './state.js'
import { initPlayer, updatePlayer, position, setSeated, standUp } from './player.js'
import { spawnAvatar, removeAvatar, setAvatarTarget, placeAvatar, updateAvatars, setAvatarName, getAvatar } from './avatars.js'
import { initVoice, updateVoice, removeVoicePeer } from './voice.js'
import * as net from './net.js'
import { pickSeat, seatById, setSeatHighlight } from './seats.js'
import { initUI, toast } from './ui.js'

// ---- 场景 ----
buildHall()
buildOffices()
S.rostrumSeatIds = ROSTRUM_SEAT_IDS   // 确定性，所有端一致

// ---- UI ----
initUI({ onEnterScene, onEnterDashboard })

let mode = null   // 'player' | 'dashboard'

function onEnterScene() {
  mode = 'player'
  local.inScene = true
  setActiveCamera(camera)
  initPlayer(local.selfId, { name: local.name, color: local.color })
  initVoice(net.getRoom()).then(ok => { if (!ok) toast('Mic blocked — others still hear you once allowed') })
  spawnExisting()
  placeSeated()
  setupSeatClicks()
}

function onEnterDashboard() {
  mode = 'dashboard'
  setActiveCamera(overviewCamera)
  spawnExisting()
  placeSeated()
}

// 为已在房间内的玩家生成 avatar（不含自己）
function spawnExisting() {
  for (const id in S.players) {
    const p = S.players[id]
    if (!p.iso) continue
    if (id === local.selfId && mode === 'player') continue
    spawnAvatar(id, { name: p.name, color: p.color })
    placeAvatar(id, p.x, p.y, p.z, p.ry)
  }
}

function placeSeated() {
  for (const seatId in S.seats) {
    const peerId = S.seats[seatId]; if (!peerId) continue
    const seat = seatById(seatId); if (!seat) continue
    if (peerId === local.selfId && mode === 'player') { setSeated(seat); continue }
    placeAvatar(peerId, seat.position.x, seat.position.y, seat.position.z, seat.ry)
  }
}

// ---- 事件：玩家增删 ----
on('playerAdded', id => {
  if (id === local.selfId && mode === 'player') return
  if (mode === null) return
  const p = S.players[id]; if (!p || !p.iso) return
  if (!getAvatar(id)) { spawnAvatar(id, { name: p.name, color: p.color }); placeAvatar(id, p.x, p.y, p.z, p.ry) }
  else setAvatarName(id, p.name)
})
on('playerRemoved', id => { removeAvatar(id); removeVoicePeer(id) })

// ---- 事件：世界位置广播（非主机） ----
on('world', arr => {
  for (const e of arr) {
    if (e.id === local.selfId) continue
    if (!getAvatar(e.id)) {
      const p = S.players[e.id]
      spawnAvatar(e.id, { name: p?.name || '???', color: p?.color || '#ccc' })
    }
    setAvatarTarget(e.id, e)
  }
})

// ---- 事件：座位变化 ----
on('seats', d => {
  if (!d || !d.seatId) return
  const seat = seatById(d.seatId); if (!seat) return
  const peerId = d.peerId
  if (peerId) {
    if (peerId === local.selfId && mode === 'player') setSeated(seat)
    else placeAvatar(peerId, seat.position.x, seat.position.y, seat.position.z, seat.ry)
  } else {
    if (d.prevSelf && mode === 'player') standUp()
  }
})

// ---- 事件：阶段变化 → 座位高亮 ----
function refreshSeatHi() {
  const p = S.agenda.phase
  setSeatHighlight(p === 'session' || p === 'debate', S.seats, S.rostrumSeatIds)
}
on('agenda', refreshSeatHi); on('snapshot', refreshSeatHi)

// ---- 座位点击（左键） ----
function setupSeatClicks() {
  const canvas = document.getElementById('app')
  canvas.addEventListener('click', e => {
    if (e.button !== 0) return
    const phase = S.agenda.phase
    if (phase !== 'session' && phase !== 'debate') return
    const seatId = pickSeat(e.clientX, e.clientY)
    if (!seatId) return
    if (S.seats[seatId]) return toast('Seat taken')
    const rostrum = S.rostrumSeatIds.includes(seatId)
    net.requestSeat(seatId, rostrum)
    toast(rostrum ? 'Requested rostrum seat (chair must approve)' : 'Taking seat…')
  })
}

// ---- 主循环 ----
let voiceAcc = 0
onTick(dt => {
  if (mode === 'player' && local.inScene) {
    const st = updatePlayer(dt)
    net.setLocalState(st)
    const z = zoneAt(position(), S.roster)
    net.updateZone(z)
  }
  updateAvatars(dt, mode === 'player' ? local.selfId : '__none__')
  voiceAcc += dt
  if (voiceAcc >= 1 / VOICE_UPDATE_HZ) { voiceAcc = 0; updateVoice() }
})

startLoop()
