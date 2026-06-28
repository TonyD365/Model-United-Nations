// Trystero 联机封装：房间、所有 action、主机权威逻辑、主机选举/离开处理
import { joinRoom, selfId } from 'trystero'
import { APP_ID, MAX_PLAYERS, WORLD_HZ, POS_HZ, SESSION_PRESETS, PRESET_COUNTDOWN_MS, PHASE_DURATIONS, AUTO_PHASE_MS } from './config.js'
import { S, local, emit, makeSnapshot, applySnapshot, isHost } from './state.js'
import { COUNTRY_BY_ISO, colorOf } from './countries.js'
import { freeBooth, refreshOfficeSigns } from './office.js'
import { initStats, applyEffects } from './stats.js'
import { nextPhase } from './agenda.js'

let room = null
const A = {}                 // action 名 -> { send, on }
const pending = {}           // peerId -> name（已连接但未选国）
let lastLocal = null
let lastSentZone = 'hall'
let worldTimer = null, posTimer = null, orchTimer = null
let phaseStartedAt = null, lastTeleType = null

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
    'signDoc','signSet','zone','floor','mic','chat','pLeft','chair',
    'roll','gsl','draft','dSponsor','dSign','statsSet','result',
    'sched','orch','elect','teleAll','say','splash','present'].forEach(defAction)
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

  // —— 真实流程 ——
  A.roll.on((d, peerId) => {
    if (d.rollCall) { S.rollCall = d.rollCall; emit('roll') }        // 主机→全体：全表
    else if (local.isHost && d.status) hostRoll(peerId, d.status)    // 代表→主机：上报
  })
  A.gsl.on((d, peerId) => {
    if (d.gsl) { S.gsl = d.gsl; emit('gsl') }                        // 主机→全体
    else if (local.isHost && d.join) hostGslAdd(peerId)              // 代表→主机：入队
  })
  A.draft.on((d) => { S.draft = d.draft; emit('draft') })
  A.dSponsor.on((d, peerId) => { if (local.isHost) hostDraftJoin(peerId, 'sponsors') })
  A.dSign.on((d, peerId) => { if (local.isHost) hostDraftJoin(peerId, 'signatories') })
  A.statsSet.on((d) => { const p = S.players[d.peerId]; if (p) p.stats = d.stats; emit('stats', d.peerId) })
  A.result.on((d) => { S.lastResult = d; emit('result') })

  // —— 会议编排 ——
  A.sched.on((d, peer) => {
    if (d.schedReq) { if (local.isHost && peer === S.chairman) hostSetSchedule(d.schedReq); return }
    if (d.schedule != null) S.schedule = d.schedule
    if ('autoTeleport' in d) S.autoTeleport = d.autoTeleport
    if ('autoFlow' in d) S.autoFlow = d.autoFlow
    emit('orch')
  })
  A.orch.on((d, peer) => {
    if (d.presetReq) { if (local.isHost && peer === S.chairman) applyPreset(d.presetReq); return }
    if ('gameStage' in d) S.gameStage = d.gameStage
    if ('preset' in d) S.preset = d.preset
    if ('presetDeadline' in d) S.presetDeadline = d.presetDeadline
    emit('orch')
  })
  A.elect.on((d, peer) => {
    if (d.election) { S.election = d.election; emit('election') }
    else if (local.isHost && d.vote) hostElectionVote(peer, d.vote)
  })
  A.teleAll.on((d) => emit('teleport', d.type))

  // —— 庭审式：对话 / 弹屏 / 展示文件 ——
  A.say.on((d) => emit('say', d))
  A.splash.on((d) => emit('splash', d))
  A.present.on((d) => emit('present', d))

  // ---- 议程 / 议题 ----
  A.phase.on((d) => { S.agenda = { phase: d.phase, topic: d.topic }; emit('agenda') })
  A.start.on((d) => { S.started = true; S.startedAt = d.startedAt; emit('started') })

  // ---- 投票 ----
  A.voteOpen.on((d) => { S.vote = { ...d, open: true, casts: {}, tally: null, result: null }; emit('vote') })
  A.voteCast.on((d, peerId) => { if (local.isHost) hostRecordVote(peerId, d) })
  A.voteClose.on((d) => { if (S.vote) { S.vote.open = false; S.vote.tally = d.tally; S.vote.result = d.result }; emit('vote') })

  // ---- 签字 ----
  A.signDoc.on((d, peerId) => { if (local.isHost) hostSign(peerId, d.docId, d.approve, d.name) })
  A.signSet.on((d) => { S.signed[d.docId] = d.entries; emit('signed', d.docId) })

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

  // 主机：会议编排 tick（预设倒计时、自动流程、按时刻表传送）
  if (local.isHost) {
    orchTimer = setInterval(() => {
      const now = Date.now()
      // 选预设倒计时到点 → 系统自动选
      if (S.gameStage === 'preset' && S.presetDeadline && !S.preset && now >= S.presetDeadline) {
        const topics = SESSION_PRESETS.filter(p => p.kind === 'topic')
        applyPreset(topics[Math.floor(now / 1000) % topics.length].id)
      }
      // 自动流程推进
      if (S.autoFlow && S.gameStage === 'running' && S.started && !(S.election && S.election.open)) {
        if (phaseStartedAt == null) phaseStartedAt = now
        const dur = PHASE_DURATIONS[S.agenda.phase] ?? AUTO_PHASE_MS
        if (dur > 0 && now - phaseStartedAt >= dur) {
          const np = nextPhase(S.agenda.phase)
          if (np !== S.agenda.phase) { S.agenda = { phase: np, topic: S.agenda.topic }; A.phase.send(S.agenda); emit('agenda'); phaseStartedAt = now }
        }
      }
      // 按时刻表自动传送
      if (S.autoTeleport && S.schedule.length) {
        const t = activeScheduleType(S.schedule, now)
        if (t && t !== lastTeleType) { lastTeleType = t; A.teleAll.send({ type: t }); emit('teleport', t) }
      }
    }, 1000)
  }
}

function hm(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null }
function activeScheduleType(sched, now) {
  const d = new Date(now); const cur = d.getHours() * 60 + d.getMinutes()
  for (const b of sched) { const s = hm(b.start), e = hm(b.end); if (s == null || e == null) continue; if (cur >= s && cur < e) return b.type }
  return null
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
export function hostOpenVote(title, options, kind = 'generic') {
  if (!local.isHost) return
  const voteId = 'v' + Date.now()
  S.vote = { voteId, title, options, kind, open: true, casts: {}, tally: null, result: null }
  A.voteOpen.send({ voteId, title, options, kind }); emit('vote')
}
// 对当前起草决议发起实质性表决（Yes/No/Abstain）
export function hostOpenResolutionVote() {
  if (!local.isHost || !S.draft) return
  hostOpenVote('Resolution: ' + S.draft.title, ['Yes', 'No', 'Abstain'], 'resolution')
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
  // 实质性决议：Yes 多于 No 即通过，并对 scope 国家施加效果
  if (S.vote.kind === 'resolution' && S.draft) {
    const passed = (tally['Yes'] || 0) > (tally['No'] || 0)
    result = passed ? 'PASSED' : 'FAILED'
    S.vote.open = false; S.vote.tally = tally; S.vote.result = result
    A.voteClose.send({ voteId: S.vote.voteId, tally, result }); emit('vote')
    finalizeResolution(passed, tally)
    return
  }
  S.vote.open = false; S.vote.tally = tally; S.vote.result = result
  A.voteClose.send({ voteId: S.vote.voteId, tally, result }); emit('vote')
}

// 应用决议效果到 scope 国家，广播指标变更与结果
function finalizeResolution(passed, tally) {
  const draft = S.draft
  const changes = []
  if (passed && draft.effects && Object.keys(draft.effects).length) {
    let isos
    if (draft.scope === 'all') isos = Object.keys(S.roster)
    else isos = [...new Set([...(draft.sponsors || []), ...(draft.signatories || [])])]
    for (const iso of isos) {
      const r = S.roster[iso]; if (!r) continue
      const p = S.players[r.peerId]; if (!p || !p.stats) continue
      const before = { ...p.stats }
      applyEffects(p.stats, draft.effects)
      changes.push({ iso, name: r.name, before, after: { ...p.stats } })
      A.statsSet.send({ peerId: r.peerId, stats: p.stats })
    }
  }
  S.lastResult = { title: draft.title, passed, tally, scope: draft.scope, effects: draft.effects, changes }
  A.result.send(S.lastResult); emit('result')
}

// —— Roll Call / GSL / Draft 主机逻辑 ——
function hostRoll(peerId, status) {
  const p = S.players[peerId]; if (!p || !p.iso) return
  S.rollCall[p.iso] = status
  A.roll.send({ rollCall: S.rollCall }) // 用同名 action 广播全表
  emit('roll')
}
export function markRollCall(status) {
  if (local.isHost) hostRoll(selfId, status)
  else A.roll.send({ status }, S.hostId)
}
export function requestGsl() {
  if (local.isHost) hostGslAdd(selfId)
  else A.gsl.send({ join: true }, S.hostId)
}
function hostGslAdd(peerId) {
  if (!S.gsl.includes(peerId)) S.gsl.push(peerId)
  A.gsl.send({ gsl: S.gsl }); emit('gsl')
}
export function hostGslNext() {
  if (!local.isHost) return
  const next = S.gsl.shift() || null
  if (next) hostSetFloor(next)
  A.gsl.send({ gsl: S.gsl }); emit('gsl')
}
export function hostSetDraft(draft) {
  if (!local.isHost) return
  S.draft = { sponsors: [], signatories: [], ...draft }
  A.draft.send({ draft: S.draft }); emit('draft')
}
export function sponsorDraft() {
  if (local.isHost) hostDraftJoin(selfId, 'sponsors')
  else A.dSponsor.send({}, S.hostId)
}
export function signDraft() {
  if (local.isHost) hostDraftJoin(selfId, 'signatories')
  else A.dSign.send({}, S.hostId)
}
function hostDraftJoin(peerId, role) {
  if (!S.draft) return
  const p = S.players[peerId]; if (!p || !p.iso) return
  const other = role === 'sponsors' ? 'signatories' : 'sponsors'
  S.draft[other] = (S.draft[other] || []).filter(i => i !== p.iso)
  S.draft[role] = S.draft[role] || []
  if (!S.draft[role].includes(p.iso)) S.draft[role].push(p.iso)
  A.draft.send({ draft: S.draft }); emit('draft')
}
export function signDocument(docId = 'resolution', approve = true, name = '') {
  if (local.isHost) hostSign(selfId, docId, approve, name)
  else A.signDoc.send({ docId, approve, name }, S.hostId)
}
export function sendChat(text) {
  const d = { name: local.name, iso: local.iso, text }
  A.chat.send(d); emit('chat', d)
}
export function broadcastMic(on) { local.micOn = on; A.mic.send({ on }) }

// —— 庭审式发言/弹屏/展示 ——
export function sayLine(text) {
  const d = { peerId: selfId, name: local.name, iso: local.iso, text: String(text).slice(0, 220) }
  A.say.send(d); emit('say', d)
}
export function sendSplash(kind, label) {
  const d = { kind, label, name: local.name, iso: local.iso }
  A.splash.send(d); emit('splash', d)
}
export function presentDoc(docId) {
  const d = { docId, name: local.name, iso: local.iso }
  A.present.send(d); emit('present', d)
}

export function leaveRoom() {
  clearInterval(worldTimer); clearInterval(posTimer); clearInterval(orchTimer)
  if (room) room.leave()
}

// ============ 会议编排（主机/主席）============
function broadcastOrch() { A.orch.send({ gameStage: S.gameStage, preset: S.preset, presetDeadline: S.presetDeadline }); emit('orch') }

export function hostSetSchedule(schedule) {
  if (!local.isHost) return
  S.schedule = schedule
  A.sched.send({ schedule, autoTeleport: S.autoTeleport, autoFlow: S.autoFlow }); emit('orch')
}
// 主席(可能非房主)修改时刻表
export function setScheduleAsChair(schedule) {
  if (local.isHost) hostSetSchedule(schedule)
  else if (local.selfId === S.chairman) A.sched.send({ schedReq: schedule }, S.hostId)
}
export function hostSetAuto(a) {
  if (!local.isHost) return
  if ('autoTeleport' in a) S.autoTeleport = a.autoTeleport
  if ('autoFlow' in a) S.autoFlow = a.autoFlow
  if (!S.autoTeleport) lastTeleType = null
  A.sched.send({ schedule: S.schedule, autoTeleport: S.autoTeleport, autoFlow: S.autoFlow }); emit('orch')
}

// 房主点"开始" → 可选先竞选主席，否则进入选预设倒计时
export function hostStartSession(opts) {
  if (!local.isHost) return
  S.started = true; S.startedAt = Date.now()
  S.autoFlow = !!opts.autoFlow; S.autoTeleport = !!opts.autoTeleport
  A.start.send({ startedAt: S.startedAt })
  A.sched.send({ schedule: S.schedule, autoTeleport: S.autoTeleport, autoFlow: S.autoFlow })
  emit('started')
  if (opts.campaign) { S.gameStage = 'campaign'; broadcastOrch(); hostOpenElection('chairman', 1) }
  else hostBeginPreset()
}
export function hostBeginPreset() {
  if (!local.isHost) return
  S.gameStage = 'preset'; S.preset = null; S.presetDeadline = Date.now() + PRESET_COUNTDOWN_MS
  broadcastOrch()
}
// 主席选预设（房主直接生效；非房主主席发请求给房主）
export function chairPickPreset(id) {
  if (local.isHost) applyPreset(id)
  else if (local.selfId === S.chairman) A.orch.send({ presetReq: id }, S.hostId)
}
export function hostSetPreset(id) { if (local.isHost) applyPreset(id) }
// 议事中的"点/动议"——以聊天广播通知全场
export function raisePoint(text) {
  const d = { name: local.name, iso: local.iso, text }
  A.chat.send(d); emit('chat', d)
}
function applyPreset(id) {
  const p = SESSION_PRESETS.find(x => x.id === id) || SESSION_PRESETS[0]
  S.preset = id; S.presetDeadline = null; S.gameStage = 'running'
  phaseStartedAt = Date.now()
  if (p.kind === 'topic') {
    S.agenda = { phase: 'rollcall', topic: p.topic }
    A.phase.send(S.agenda); emit('agenda')
  } else if (p.kind === 'election') {
    S.agenda = { phase: 'voting', topic: p.label }
    A.phase.send(S.agenda); emit('agenda')
    hostOpenElection(p.election, p.seats)
  }
  broadcastOrch()
}

// ---- 选举（主席/理事国）----
export function hostOpenElection(kind, seats) {
  if (!local.isHost) return
  const candidates = kind === 'chairman'
    ? Object.entries(S.roster).map(([iso, r]) => ({ id: r.peerId, label: (COUNTRY_BY_ISO[iso]?.name || iso) + ' — ' + r.name, iso }))
    : Object.keys(S.roster).map(iso => ({ id: iso, label: COUNTRY_BY_ISO[iso]?.name || iso, iso }))
  S.election = { kind, seats, candidates, votes: {}, open: true, winners: [], tally: null }
  A.elect.send({ election: S.election }); emit('election')
}
export function castElectionVote(candId) {
  if (!S.election || !S.election.open) return
  if (local.isHost) hostElectionVote(selfId, candId)
  else A.elect.send({ vote: candId }, S.hostId)
}
function hostElectionVote(peerId, candId) {
  if (!S.election || !S.election.open) return
  const p = S.players[peerId]; if (!p || !p.iso) return
  S.election.votes[p.iso] = candId
  A.elect.send({ election: S.election }); emit('election')
}
export function hostCloseElection() {
  if (!local.isHost || !S.election) return
  const tally = {}
  for (const iso in S.election.votes) { const c = S.election.votes[iso]; tally[c] = (tally[c] || 0) + 1 }
  const winners = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, S.election.seats).map(([id]) => id)
  S.election.open = false; S.election.winners = winners; S.election.tally = tally
  if (S.election.kind === 'chairman' && winners[0]) hostDesignateChairman(winners[0])
  if (S.election.kind === 'council') S.council = winners.slice()
  A.elect.send({ election: S.election }); emit('election')
  if (S.gameStage === 'campaign') hostBeginPreset()   // 竞选结束 → 选预设
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
  S.players[peerId] = { id: peerId, name, iso, color, x: spawn.x, y: 0, z: spawn.z, ry: 0, anim: 0, zone: 'hall', seat: null, stats: initStats(iso) }
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
    S.players[d.peerId] = { id: d.peerId, name: d.name, iso: d.iso, color: d.color, x: spawn.x, y: 0, z: spawn.z, ry: 0, anim: 0, zone: 'hall', seat: null, stats: initStats(d.iso) }
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

function hostSign(peerId, docId, approve, name) {
  const p = S.players[peerId]; if (!p || !p.iso) return
  S.signed[docId] = (S.signed[docId] || []).filter(e => e.iso !== p.iso)
  S.signed[docId].push({ iso: p.iso, name: (name || p.name || '').slice(0, 24), approve: !!approve })
  A.signSet.send({ docId, entries: S.signed[docId] })
  emit('signed', docId)
}

function hostRemovePlayer(peerId) {
  const p = S.players[peerId]
  const iso = p ? p.iso : Object.keys(S.roster).find(k => S.roster[k].peerId === peerId)
  if (iso) delete S.roster[iso]
  for (const sid in S.seats) if (S.seats[sid] === peerId) S.seats[sid] = null
  if (S.floor === peerId) S.floor = null
  if (S.chairman === peerId) { S.chairman = null; A.chair.send({ peerId: null }) }
  const gi = S.gsl.indexOf(peerId); if (gi >= 0) { S.gsl.splice(gi, 1); A.gsl.send({ gsl: S.gsl }) }
  if (iso) { delete S.rollCall[iso]; if (S.draft) { S.draft.sponsors = (S.draft.sponsors || []).filter(i => i !== iso); S.draft.signatories = (S.draft.signatories || []).filter(i => i !== iso) } }
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
  // 中庭开阔处（主席台前、座位环内侧），避免生成在座位堆里
  return { x: (Math.random() - 0.5) * 6, z: 1 + Math.random() * 4 }
}
