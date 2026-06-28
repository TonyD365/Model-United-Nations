// Trystero 联机封装：房间、所有 action、主机权威逻辑、主机选举/离开处理
import { joinRoom, selfId } from 'trystero'
import { APP_ID, MAX_PLAYERS, WORLD_HZ, POS_HZ } from './config.js'
import { S, local, emit, makeSnapshot, applySnapshot, isHost } from './state.js'
import { COUNTRY_BY_ISO, colorOf } from './countries.js'
import { freeBooth, refreshOfficeSigns } from './office.js'

let room = null
const A = {}                 // action 名 -> { send, on }
const pending = {}           // peerId -> name（已连接但未选国）
let lastLocal = null
let lastSentZone = 'hall'
let worldTimer = null, posTimer = null

function defAction(name) {
  // trystero 0.25.x：makeAction 返回 { send, onMessage }；
  // send(data, {target}) 用选项对象指定目标；onMessage 是可赋值属性，回调签名 (data, {peerId})。
  const a = room.makeAction(name)
  A[name] = {
    send: (data, target) => a.send(data, target ? { target } : undefined).catch(() => {}),
    on: (fn) => { a.onMessage = (data, ctx) => fn(data, ctx.peerId) },
  }
  return A[name]
}

export function getRoom() { return room }
export function selfPeerId() { return selfId }

// 建房（作为主机）
export function createRoom(roomCode, hostMode, name, onError) {
  local.selfId = selfId
  local.isHost = true
  local.name = name
  S.hostId = selfId
  S.hostMode = hostMode
  if (hostMode === 'player') {
    // 主机也作为玩家，进场后再补 iso/位置
  }
  open(roomCode, onError)
  emit('connected', { isHost: true })
}

// 加入（普通玩家）
export function joinAsPlayer(roomCode, name, onError) {
  local.selfId = selfId
  local.isHost = false
  local.name = name
  open(roomCode, onError)
}

function open(roomCode, onError) {
  // 房间码作为 roomId 即可隔离（只有知道确切码的人能相遇）。
  room = joinRoom({ appId: APP_ID }, roomCode, {
    onJoinError: info => onError && onError(info),
  })
  defActions()
  wire()
  startTimers()
}

function defActions() {
  ;['hello','snap','claimCty','ctySet','ctyRej','pos','world','seatReq','seatSet','seatRel',
    'rostReq','rostDec','phase','start','voteOpen','voteCast','voteClose',
    'signDoc','signSet','zone','floor','mic','chat','pLeft','chair'].forEach(defAction)
}

function wire() {
  room.onPeerJoin = peerId => {
    if (!local.isHost) A.hello.send({ name: local.name }, peerId) // 向(可能的)主机握手
    emit('peerJoin', peerId)
  }

  room.onPeerLeave = peerId => {
    if (!local.isHost) {
      if (peerId === S.hostId) { emit('ended', 'host'); return }
    } else {
      hostRemovePlayer(peerId)
    }
    emit('peerLeave', peerId)
  }

  // ---- 主机：响应握手，下发快照 ----
  A.hello.on((data, peerId) => {
    if (!local.isHost) return
    pending[peerId] = data.name || '???'
    A.snap.send(makeSnapshot(), peerId)
  })

  // ---- 晚加入者：应用快照 ----
  A.snap.on((snap) => {
    if (local.isHost) return
    applySnapshot(snap)
  })

  // ---- 选国家（唯一仲裁）----
  A.claimCty.on((data, peerId) => {
    if (!local.isHost) return
    hostAssignCountry(peerId, data.iso)
  })
  A.ctySet.on((d) => { applyCountrySet(d) })
  A.ctyRej.on((d) => { emit('countryRejected', d) })

  // ---- 位置同步 ----
  A.pos.on((d, peerId) => {
    if (!local.isHost) return
    const p = S.players[peerId]; if (!p) return
    p.x = d.x; p.y = d.y; p.z = d.z; p.ry = d.ry; p.anim = d.anim
  })
  A.world.on((arr) => {
    if (local.isHost) return
    emit('world', arr)
  })

  // ---- 座位 ----
  A.seatReq.on((d, peerId) => { if (local.isHost) hostSeat(peerId, d.seatId, false) })
  A.rostReq.on((d, peerId) => { if (local.isHost) emit('rostrumRequest', { peerId, seatId: d.seatId, name: nameOf(peerId) }) })
  A.seatRel.on((d, peerId) => { if (local.isHost) hostReleaseSeat(peerId) })
  A.seatSet.on((d) => { applySeatSet(d) })
  A.rostDec.on((d) => { applySeatSet(d); emit('rostrumDecision', d) })
  A.chair.on((d) => { S.chairman = d.peerId; emit('chairman') })

  // ---- 议程 / 议题 ----
  A.phase.on((d) => { S.agenda = { phase: d.phase, topic: d.topic }; emit('agenda') })
  A.start.on((d) => { S.started = true; S.startedAt = d.startedAt; emit('started') })

  // ---- 投票 ----
  A.voteOpen.on((d) => { S.vote = { ...d, open: true, casts: {}, tally: null, result: null }; emit('vote') })
  A.voteCast.on((d, peerId) => { if (local.isHost) hostRecordVote(peerId, d) })
  A.voteClose.on((d) => { if (S.vote) { S.vote.open = false; S.vote.tally = d.tally; S.vote.result = d.result }; emit('vote') })

  // ---- 签字 ----
  A.signDoc.on((d, peerId) => { if (local.isHost) hostSign(peerId, d.docId) })
  A.signSet.on((d) => { S.signed[d.docId] = d.isos; emit('signed', d.docId) })

  // ---- 语音区 / 发言权 / 麦克风 ----
  A.zone.on((d, peerId) => { const p = S.players[peerId]; if (p) p.zone = d.zone; emit('zone', peerId) })
  A.floor.on((d) => { S.floor = d.peerId; emit('floor') })
  A.mic.on((d, peerId) => emit('mic', peerId, d.on))

  // ---- 聊天 ----
  A.chat.on((d, peerId) => emit('chat', d))

  // ---- 主机移除玩家广播 ----
  A.pLeft.on((d) => {
    if (d.iso && S.roster[d.iso]) delete S.roster[d.iso]
    delete S.players[d.peerId]
    refreshOfficeSigns(S.roster)
    emit('playerRemoved', d.peerId)
    emit('roster')
  })
}

function startTimers() {
  // 主机：合并广播世界状态
  if (local.isHost) {
    worldTimer = setInterval(() => {
      const arr = []
      for (const id in S.players) {
        const p = S.players[id]
        if (!p.iso) continue
        arr.push({ id, x: p.x, y: p.y, z: p.z, ry: p.ry, anim: p.anim || 0 })
      }
      if (arr.length) A.world.send(arr)
    }, 1000 / WORLD_HZ)
  }
  // 客户端：上报本地位置给主机
  posTimer = setInterval(() => {
    if (!lastLocal) return
    if (local.isHost) {
      const p = S.players[selfId]
      if (p) Object.assign(p, lastLocal)
    } else if (S.hostId) {
      A.pos.send(lastLocal, S.hostId)
    }
  }, 1000 / POS_HZ)
}

// ============ 对外发送 API ============
export function setLocalState(s) { lastLocal = { x: s.x, y: s.y, z: s.z, ry: s.ry, anim: s.anim } }

export function claimCountry(iso) {
  if (local.isHost) hostAssignCountry(selfId, iso)
  else A.claimCty.send({ iso }, S.hostId)
}

export function updateZone(zone) {
  if (zone === lastSentZone) return
  lastSentZone = zone; local.zone = zone
  if (local.isHost) { const p = S.players[selfId]; if (p) p.zone = zone }
  A.zone.send({ zone })
  emit('zone', selfId)
}

export function requestSeat(seatId, rostrum) {
  if (rostrum) {
    if (local.isHost) emit('rostrumRequest', { peerId: selfId, seatId, name: local.name })
    else A.rostReq.send({ seatId }, S.hostId)
  } else {
    if (local.isHost) hostSeat(selfId, seatId, false)
    else A.seatReq.send({ seatId }, S.hostId)
  }
}

export function releaseSeat() {
  if (local.isHost) hostReleaseSeat(selfId)
  else A.seatRel.send({}, S.hostId)
}

export function hostDesignateChairman(peerId) {
  if (!local.isHost) return
  S.chairman = peerId
  for (const sid in S.seats) if (S.seats[sid] === peerId) S.seats[sid] = null
  S.seats['r1'] = peerId
  const p = S.players[peerId]; if (p) p.seat = 'r1'
  S.floor = peerId
  A.chair.send({ peerId }); A.seatSet.send({ seatId: 'r1', peerId }); A.floor.send({ peerId })
  applySeatSet({ seatId: 'r1', peerId }); emit('chairman'); emit('floor')
}

// 主机专用
export function hostStart() {
  if (!local.isHost) return
  S.started = true; S.startedAt = Date.now()
  A.start.send({ startedAt: S.startedAt }); emit('started')
}
export function hostSetPhase(phase, topic) {
  if (!local.isHost) return
  S.agenda = { phase, topic: topic ?? S.agenda.topic }
  A.phase.send(S.agenda); emit('agenda')
}
export function hostGrantRostrum(seatId, peerId, ok) {
  if (!local.isHost) return
  if (ok) {
    for (const sid in S.seats) if (S.seats[sid] === peerId) S.seats[sid] = null
    S.seats[seatId] = peerId
    const p = S.players[peerId]; if (p) p.seat = seatId
  }
  A.rostDec.send({ seatId, peerId: ok ? peerId : null, ok })
  applySeatSet({ seatId, peerId: ok ? peerId : null, ok })
}
export function hostSetFloor(peerId) {
  if (!local.isHost) return
  S.floor = peerId; A.floor.send({ peerId }); emit('floor')
}
export function hostOpenVote(title, options) {
  if (!local.isHost) return
  const voteId = 'v' + Date.now()
  S.vote = { voteId, title, options, open: true, casts: {}, tally: null, result: null }
  A.voteOpen.send({ voteId, title, options }); emit('vote')
}
export function castVote(choice) {
  if (!S.vote || !S.vote.open) return
  if (local.isHost) hostRecordVote(selfId, { voteId: S.vote.voteId, choice })
  else A.voteCast.send({ voteId: S.vote.voteId, choice }, S.hostId)
}
export function hostCloseVote() {
  if (!local.isHost || !S.vote) return
  const tally = {}
  for (const opt of S.vote.options) tally[opt] = 0
  for (const iso in S.vote.casts) { const c = S.vote.casts[iso]; if (tally[c] != null) tally[c]++ }
  let result = null, best = -1
  for (const opt in tally) if (tally[opt] > best) { best = tally[opt]; result = opt }
  S.vote.open = false; S.vote.tally = tally; S.vote.result = result
  A.voteClose.send({ voteId: S.vote.voteId, tally, result }); emit('vote')
}
export function signDocument(docId = 'resolution') {
  if (local.isHost) hostSign(selfId, docId)
  else A.signDoc.send({ docId }, S.hostId)
}
export function sendChat(text) {
  const d = { name: local.name, iso: local.iso, text }
  A.chat.send(d); emit('chat', d)
}
export function broadcastMic(on) { local.micOn = on; A.mic.send({ on }) }

export function leaveRoom() {
  clearInterval(worldTimer); clearInterval(posTimer)
  if (room) room.leave()
}

// ============ 主机内部逻辑 ============
function hostAssignCountry(peerId, iso) {
  if (!COUNTRY_BY_ISO[iso]) return
  if (S.roster[iso]) { A.ctyRej.send({ iso, reason: 'taken' }, peerId); return }
  if (Object.keys(S.players).length >= MAX_PLAYERS) { A.ctyRej.send({ iso, reason: 'full' }, peerId); return }
  const name = peerId === selfId ? local.name : (pending[peerId] || nameOf(peerId) || '???')
  const color = colorOf(iso)
  const booth = freeBooth(S.roster)
  S.roster[iso] = { peerId, name, color, booth }
  const spawn = spawnPoint()
  S.players[peerId] = { id: peerId, name, iso, color, x: spawn.x, y: 0, z: spawn.z, ry: 0, anim: 0, zone: 'hall', seat: null }
  delete pending[peerId]
  const payload = { iso, peerId, name, color, booth, ok: true }
  A.ctySet.send(payload)
  applyCountrySet(payload)
}

function applyCountrySet(d) {
  if (!d || !d.ok) return
  S.roster[d.iso] = { peerId: d.peerId, name: d.name, color: d.color, booth: d.booth }
  if (!S.players[d.peerId]) {
    const spawn = spawnPoint()
    S.players[d.peerId] = { id: d.peerId, name: d.name, iso: d.iso, color: d.color, x: spawn.x, y: 0, z: spawn.z, ry: 0, anim: 0, zone: 'hall', seat: null }
  } else {
    S.players[d.peerId].iso = d.iso
    S.players[d.peerId].color = d.color
  }
  refreshOfficeSigns(S.roster)
  if (d.peerId === selfId) { local.iso = d.iso; local.color = d.color; emit('countryConfirmed', d.iso) }
  emit('playerAdded', d.peerId)
  emit('roster')
}

function hostSeat(peerId, seatId, rostrum) {
  if (S.seats[seatId]) return                  // 已被占
  if (S.rostrumSeatIds.includes(seatId)) return // 主席台需走审批
  for (const sid in S.seats) if (S.seats[sid] === peerId) S.seats[sid] = null
  S.seats[seatId] = peerId
  const p = S.players[peerId]; if (p) p.seat = seatId
  const payload = { seatId, peerId }
  A.seatSet.send(payload); applySeatSet(payload)
}

function hostReleaseSeat(peerId) {
  let freed = null
  for (const sid in S.seats) if (S.seats[sid] === peerId) { S.seats[sid] = null; freed = sid }
  const p = S.players[peerId]; if (p) p.seat = null
  if (S.chairman === peerId) { S.chairman = null; A.chair.send({ peerId: null }); emit('chairman') }
  if (freed) { const payload = { seatId: freed, peerId: null, who: peerId }; A.seatSet.send(payload); applySeatSet(payload) }
}

function applySeatSet(d) {
  // 释放该 peer 旧座
  for (const sid in S.seats) if (S.seats[sid] === d.peerId && sid !== d.seatId) S.seats[sid] = null
  S.seats[d.seatId] = d.peerId || null
  for (const id in S.players) if (S.players[id].seat === d.seatId && id !== d.peerId) S.players[id].seat = null
  if (d.peerId && S.players[d.peerId]) S.players[d.peerId].seat = d.seatId
  if (!d.peerId && d.who && S.players[d.who]) S.players[d.who].seat = null
  emit('seats', d)
}

function hostRecordVote(peerId, d) {
  if (!S.vote || !S.vote.open || d.voteId !== S.vote.voteId) return
  const p = S.players[peerId]; if (!p || !p.iso) return
  S.vote.casts[p.iso] = d.choice
  emit('voteProgress', Object.keys(S.vote.casts).length)
}

function hostSign(peerId, docId) {
  const p = S.players[peerId]; if (!p || !p.iso) return
  S.signed[docId] ||= []
  if (!S.signed[docId].includes(p.iso)) S.signed[docId].push(p.iso)
  A.signSet.send({ docId, isos: S.signed[docId] })
  emit('signed', docId)
}

function hostRemovePlayer(peerId) {
  const p = S.players[peerId]
  const iso = p ? p.iso : Object.keys(S.roster).find(k => S.roster[k].peerId === peerId)
  if (iso) delete S.roster[iso]
  for (const sid in S.seats) if (S.seats[sid] === peerId) S.seats[sid] = null
  if (S.floor === peerId) S.floor = null
  if (S.chairman === peerId) { S.chairman = null; A.chair.send({ peerId: null }) }
  delete S.players[peerId]
  delete pending[peerId]
  refreshOfficeSigns(S.roster)
  A.pLeft.send({ peerId, iso: iso || null })
  emit('playerRemoved', peerId); emit('roster')
}

// ============ 辅助 ============
function nameOf(peerId) {
  const p = S.players[peerId]; if (p) return p.name
  for (const iso in S.roster) if (S.roster[iso].peerId === peerId) return S.roster[iso].name
  return null
}
function spawnPoint() {
  return { x: (Math.random() - 0.5) * 8, z: 16 + (Math.random() - 0.5) * 4 }
}
