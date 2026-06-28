// 引导：装配场景 + 网络 + UI，运行主循环
import * as THREE from 'three'
import { camera, overviewCamera, setActiveCamera, getActiveCamera, onTick, startLoop, raycaster } from './scene.js'
import { buildHall, ROSTRUM_SEAT_IDS, COLLIDERS } from './hall.js'
import { buildOffices, zoneAt, DOCUMENTS } from './office.js'
import { VOICE_UPDATE_HZ } from './config.js'
import { S, local, on } from './state.js'
import { initPlayer, updatePlayer, position, setSeated, standUp, setColliders } from './player.js'
import { loadCharacter, spawnAvatar, removeAvatar, setAvatarTarget, placeAvatar, updateAvatars, setAvatarName, setAvatarSeated, getAvatar } from './avatars.js'
import { initVoice, updateVoice, removeVoicePeer } from './voice.js'
import * as net from './net.js'
import { pickSeat, seatById, setSeatHighlight } from './seats.js'
import { initUI, toast } from './ui.js'

// ---- 场景 ----
buildHall()
buildOffices()
S.rostrumSeatIds = ROSTRUM_SEAT_IDS
setColliders(COLLIDERS)
loadCharacter().catch(() => toast('3D model failed to load'))

// ---- UI ----
initUI({ onEnterScene, onEnterDashboard })

let mode = null

function onEnterScene() {
  mode = 'player'
  local.inScene = true
  setActiveCamera(camera)
  initPlayer(local.selfId, { name: local.name, color: local.color })
  initVoice(net.getRoom()).then(ok => { if (!ok) toast('Mic blocked — allow it to talk') })
  spawnExisting()
  placeSeated()
  setupInteract()
}

function onEnterDashboard() {
  mode = 'dashboard'
  setActiveCamera(overviewCamera)
  spawnExisting()
  placeSeated()
}

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
    setAvatarSeated(peerId, true)
  }
}

// ---- 玩家增删 ----
on('playerAdded', id => {
  if (id === local.selfId && mode === 'player') return
  if (mode === null) return
  const p = S.players[id]; if (!p || !p.iso) return
  if (!getAvatar(id)) { spawnAvatar(id, { name: p.name, color: p.color }); placeAvatar(id, p.x, p.y, p.z, p.ry) }
  else setAvatarName(id, p.name, p.color)
})
on('playerRemoved', id => { removeAvatar(id); removeVoicePeer(id) })

// ---- 世界位置广播 ----
on('world', arr => {
  for (const e of arr) {
    if (e.id === local.selfId) continue
    if (!getAvatar(e.id)) { const p = S.players[e.id]; spawnAvatar(e.id, { name: p?.name || '???', color: p?.color || '#ccc' }) }
    setAvatarTarget(e.id, e)
  }
})

// ---- 座位变化（落座 / 起立）----
on('seats', d => {
  if (!d || !d.seatId) return
  const seat = seatById(d.seatId)
  if (d.peerId) {
    if (!seat) return
    if (d.peerId === local.selfId && mode === 'player') setSeated(seat)
    else { placeAvatar(d.peerId, seat.position.x, seat.position.y, seat.position.z, seat.ry); setAvatarSeated(d.peerId, true) }
  } else {
    const who = d.who
    if (who === local.selfId && mode === 'player') standUp()
    else if (who) setAvatarSeated(who, false)
  }
})

// ---- 阶段 → 座位高亮 ----
function refreshSeatHi() {
  const p = S.agenda.phase
  setSeatHighlight(p === 'session' || p === 'debate', S.seats, S.rostrumSeatIds)
}
on('agenda', refreshSeatHi); on('snapshot', refreshSeatHi)

// ---- 交互：左键点击（签字优先，其次座位）----
const ndc = new THREE.Vector2()
function pick(meshes, x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1)
  raycaster.setFromCamera(ndc, getActiveCamera())
  const h = raycaster.intersectObjects(meshes, false)
  return h.length ? h[0].object : null
}
function setupInteract() {
  const canvas = document.getElementById('app')
  canvas.addEventListener('click', e => {
    if (e.button !== 0) return
    // 1) 签字文件
    const doc = pick(DOCUMENTS, e.clientX, e.clientY)
    if (doc) { net.signDocument(doc.userData.signDoc); toast('You signed: ' + doc.userData.signDoc); return }
    // 2) 座位
    const seatId = pickSeat(e.clientX, e.clientY)
    if (!seatId) return
    const seat = seatById(seatId)
    const office = seat && seat.office
    const phase = S.agenda.phase
    if (!office && phase !== 'session' && phase !== 'debate') return toast('Seats open during Session/Debate')
    if (S.seats[seatId]) return toast('Seat taken')
    net.requestSeat(seatId, S.rostrumSeatIds.includes(seatId))
    toast(S.rostrumSeatIds.includes(seatId) ? 'Requested rostrum seat (chair approval)' : 'Taking seat…')
  })
}

// ---- 主循环 ----
let voiceAcc = 0
onTick(dt => {
  if (mode === 'player' && local.inScene) {
    const st = updatePlayer(dt)
    net.setLocalState(st)
    net.updateZone(zoneAt(position(), S.roster))
  }
  updateAvatars(dt, mode === 'player' ? local.selfId : '__none__')
  voiceAcc += dt
  if (voiceAcc >= 1 / VOICE_UPDATE_HZ) { voiceAcc = 0; updateVoice() }
})

startLoop()
