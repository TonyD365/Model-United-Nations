// Trystero 联机封装：房间、所有 action、主机权威逻辑、主机选举/离开处理
import { joinRoom, selfId } from 'trystero'
import { APP_ID, MAX_PLAYERS, WORLD_HZ, POS_HZ, SESSION_PRESETS, PRESET_COUNTDOWN_MS, PHASE_DURATIONS, AUTO_PHASE_MS, PERMANENT_MEMBERS, DEFAULT_STYLE, FLOOR_BOUNDS, RUN_SPEED } from './config.js'
import { S, local, emit, makeSnapshot, applySnapshot, isHost } from './state.js'
import { COUNTRY_BY_ISO, colorOf } from './countries.js'
import { freeBooth, refreshOfficeSigns } from './office.js'
import { COLLIDERS } from './hall.js'
import { cryptoAvailable, genKeys, exportPub, importPub, sign as signMsg, verify as verifyMsg } from './crypto.js'
import { initStats, applyEffects } from './stats.js'
import { nextPhase } from './agenda.js'

let room = null
const A = {}                 // action 名 -> { send, on }
// 需要主机签名的"权威广播"动作（单向 host→全体/定向）。snap 不在内：它是引导信任的载体(携带公钥)。
const SIGNED = new Set(['ctySet', 'ctyRej', 'world', 'seatSet', 'rostDec', 'chair', 'draft',
  'statsSet', 'result', 'phase', 'start', 'voteOpen', 'voteClose', 'signSet', 'floor', 'teleAll', 'kick', 'pLeft'])
let signKey = null           // 主机私钥
let hostVerifyKey = null     // 客户端导入的主机公钥
let cryptoReady = Promise.resolve()  // 主机密钥生成完成的 promise
let signQueue = Promise.resolve()    // 串行签名，保证发送顺序
let verifyQueue = Promise.resolve()  // 串行验签，保证应用顺序
const REJECT = Symbol('reject')
const pending = {}           // peerId -> name（已连接但未选国）
const pendingStyle = {}      // peerId -> 外观 id（握手时上报）
let lastLocal = null
let lastSentZone = 'hall'
let worldTimer = null, posTimer = null, orchTimer = null
let phaseStartedAt = null, lastTeleType = null

function defAction(name) {
  // trystero 0.25.x：makeAction 返回 { send, onMessage }；
  // send(data, {target}) 用选项对象指定目标；onMessage 是可赋值属性，回调签名 (data, {peerId})。
  const a = room.makeAction(name)
  A[name] = {
    send: (data, target) => {
      const opt = target ? { target } : undefined
      // 权威动作 + 反作弊开启 + 主机有私钥 → 串行签名后发送 { __d, __s }
      if (local.isHost && S.antiCheat && signKey && SIGNED.has(name)) {
        signQueue = signQueue.then(async () => {
          try { const s = await signMsg(signKey, name, data); a.send({ __d: data, __s: s }, opt).catch(() => {}) }
          catch { a.send(data, opt).catch(() => {}) }
        }).catch(() => {})
      } else a.send(data, opt).catch(() => {})
    },
    on: (fn) => {
      a.onMessage = (raw, ctx) => {
        const peerId = ctx.peerId
        if (S.antiCheat && SIGNED.has(name)) {
          verifyQueue = verifyQueue.then(async () => {
            const inner = await verifyInbound(name, raw, peerId)
            if (inner !== REJECT) fn(inner, peerId)
          }).catch(() => {})
        } else fn(raw, peerId)
      }
    },
  }
  return A[name]
}

// 客户端：校验一条权威消息的来源(peerId===主机) + 签名；通过则返回内层数据
async function verifyInbound(name, raw, peerId) {
  if (peerId !== S.hostId) { flagCheat(peerId, 'forged authoritative (origin)'); return REJECT }
  const signed = raw && typeof raw === 'object' && raw.__s !== undefined
  if (!signed) {
    // 主机已启用签名(我们已拿到公钥)却收到未签名消息 → 伪造；否则(主机未启用)退回仅来源校验
    if (hostVerifyKey) { flagCheat(peerId, 'unsigned authoritative message'); return REJECT }
    return raw
  }
  if (hostVerifyKey) {
    const ok = await verifyMsg(hostVerifyKey, name, raw.__d, raw.__s)
    if (!ok) { flagCheat(peerId, 'bad signature (forged authoritative)'); return REJECT }
  }
  return raw.__d
}

// 主机：开房时生成签名密钥对，公钥写入快照下发
async function initHostCrypto() {
  if (!cryptoAvailable()) return
  try {
    const kp = await genKeys()
    signKey = kp.privateKey
    S.hostPubKey = await exportPub(kp.publicKey)
  } catch { signKey = null }
}

export function getRoom() { return room }
export function selfPeerId() { return selfId }

// ============ 反作弊（房主权威校验）============
// 威胁模型：作弊者完全控制自己的浏览器，可调用任意函数、伪造任意 action 报文发给主机或其他对端。
// 因此防御核心 = 主机对收到的请求做校验 + 客户端只信任“真主机”发来的权威广播。
const cheatLog = {}                    // peerId -> { count, last, reasons:Set }
const rate = {}                        // peerId|action -> { tokens, t }  令牌桶限流
function now() { return performance.now() }

const AUTOBAN_AT = 6                    // 累计到此次数自动封禁（仅主机侧检测计数）
function flagCheat(peerId, reason) {
  const e = cheatLog[peerId] || (cheatLog[peerId] = { count: 0, reasons: new Set() })
  e.count++; e.reasons.add(reason); e.last = reason
  emit('cheat', { peerId, reason, count: e.count, name: nameOf(peerId) })
  // 反作弊自动封禁：主机侧检测到的累犯，达到阈值直接踢+封
  if (local.isHost && S.antiCheat && peerId !== selfId && !banned.has(peerId) && e.count >= AUTOBAN_AT) {
    emit('cheat', { peerId, reason: 'AUTO-BANNED (repeat offenses)', count: e.count, name: nameOf(peerId) })
    hostKick(peerId, true)
  }
}
export function cheatReport() { return cheatLog }
// 玩家是否被反作弊判定（噪声半径内）落在实心碰撞体里 = 穿墙
const PLAYER_R = 0.42
function insideSolid(x, z) {
  for (const c of COLLIDERS) {
    if (c.r != null) {
      const dx = x - c.x, dz = z - c.z
      if (dx * dx + dz * dz < (c.r - 0.1) * (c.r - 0.1)) return true       // 圆形：明显在内部
    } else if (x > c.minX + 0.1 && x < c.maxX - 0.1 && z > c.minZ + 0.1 && z < c.maxZ - 0.1) {
      return true                                                          // AABB：穿透进实心
    }
  }
  return false
}

// 仅接受“真主机”发来的权威广播（主机本身也不接受来自客户端的权威广播——主机只会直接改自己的 S）
function fromHost(peerId) { return !S.antiCheat || peerId === S.hostId }
// 包装权威广播处理器：来源非主机则丢弃并记一次作弊
function hostOnly(fn) {
  return (d, peerId) => {
    if (S.antiCheat && peerId !== S.hostId) { flagCheat(peerId, 'forged authoritative message'); return }
    fn(d, peerId)
  }
}
// 校验“声称的国家”确实属于发送者（防止身份伪装）
function ownsIso(peerId, iso) { return !iso || (S.roster[iso] && S.roster[iso].peerId === peerId) }
// 令牌桶限流：每个 (peer,action) 每秒 ratePerSec 次，最多积攒 burst 次
function rateOk(peerId, action, ratePerSec, burst) {
  if (!S.antiCheat) return true
  const k = peerId + '|' + action
  const r = rate[k] || (rate[k] = { tokens: burst, t: now() })
  const dt = (now() - r.t) / 1000; r.t = now()
  r.tokens = Math.min(burst, r.tokens + dt * ratePerSec)
  if (r.tokens < 1) { return false }
  r.tokens -= 1; return true
}
// 主机：校验位置上报（边界 + 速度），不合法则拒绝/夹取
const posState = {}                    // peerId -> { t, x, z, tpT, air }
const MAX_AIR = 1.6                     // 允许的最大离地高度（跳跃峰值约 1.0m）
function validatePos(peerId, d) {
  if (!S.antiCheat) return d
  // 数值合法性
  for (const k of ['x', 'y', 'z', 'ry']) if (typeof d[k] !== 'number' || !isFinite(d[k])) { flagCheat(peerId, 'bad pos value'); return null }
  const st = posState[peerId]; const t = now()
  const seated = !!(S.players[peerId] && S.players[peerId].seat)
  // 边界夹取
  const cx = Math.max(FLOOR_BOUNDS.minX, Math.min(FLOOR_BOUNDS.maxX, d.x))
  const cz = Math.max(FLOOR_BOUNDS.minZ, Math.min(FLOOR_BOUNDS.maxZ, d.z))
  if (cx !== d.x || cz !== d.z) flagCheat(peerId, 'out of bounds')
  // y：允许跳跃(短暂离地)，但“持续滞空”=飞行外挂。高度超上限直接判定。
  let cy = Math.max(0, Math.min(MAX_AIR, d.y))
  if (d.y > MAX_AIR + 0.05) flagCheat(peerId, 'fly hack (altitude)')
  let air = st ? (st.air || 0) : 0
  if (cy > 0.25) { if (!air) air = t; else if (t - air > 1300) { flagCheat(peerId, 'fly hack'); cy = 0 } }
  else air = 0
  // 穿墙检测：未落座时不得进入实心碰撞体内部
  if (!seated && insideSolid(cx, cz)) { flagCheat(peerId, 'noclip / wall hack'); posState[peerId] = { t, x: st ? st.x : cx, z: st ? st.z : cz, tpT: st ? st.tpT : 0, air }; return null }
  // 速度/瞬移检测：偶发大跳视为合法传送（时刻表/办公室/Visit 按钮），连续超速=加速外挂
  if (!seated && st) {
    const dt = Math.max(0.001, (t - st.t) / 1000)
    const dist = Math.hypot(cx - st.x, cz - st.z)
    const maxStep = RUN_SPEED * 1.8 * dt + 1.0
    if (dist > maxStep) {
      if (t - (st.tpT || 0) > 1500) { posState[peerId] = { t, x: cx, z: cz, tpT: t, air }; return { x: cx, y: cy, z: cz, ry: d.ry, anim: d.anim === 1 ? 1 : 0 } }
      flagCheat(peerId, 'speed/teleport hack'); posState[peerId] = { t, x: st.x, z: st.z, tpT: st.tpT, air }; return null
    }
  }
  posState[peerId] = { t, x: cx, z: cz, tpT: st ? st.tpT : 0, air }
  return { x: cx, y: cy, z: cz, ry: d.ry, anim: d.anim === 1 ? 1 : 0 }
}

// 房主开关反作弊
export function hostSetAntiCheat(on) {
  if (!local.isHost) return
  S.antiCheat = !!on
  A.orch.send({ antiCheat: S.antiCheat }); emit('orch')
}

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
  cryptoReady = initHostCrypto()   // 生成签名密钥对（异步，公钥写入 S.hostPubKey 随快照下发）
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
    'sched','orch','elect','teleAll','say','splash','present','chairReq','kick'].forEach(defAction)
}

function wire() {
  room.onPeerJoin = peerId => {
    if (!local.isHost) A.hello.send({ name: local.name, style: local.style }, peerId) // 向(可能的)主机握手
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
  A.hello.on(async (data, peerId) => {
    if (!local.isHost) return
    if (banned.has(peerId)) { A.kick.send({ peerId, ban: true }, peerId); return }   // 封禁者拒绝入场
    pending[peerId] = data.name || '???'
    pendingStyle[peerId] = data.style || DEFAULT_STYLE
    await cryptoReady                  // 确保公钥已就绪再下发快照（携带公钥）
    A.snap.send(makeSnapshot(), peerId)
  })

  // ---- 晚加入者：应用快照 ----
  A.snap.on((snap, peerId) => {
    if (local.isHost) return
    // 引导期接受第一份快照确立主机；此后只信任真主机，防止对端伪造快照劫持
    if (S.antiCheat && S.hostId && peerId !== S.hostId) { flagCheat(peerId, 'forged snapshot'); return }
    applySnapshot(snap)
    // 导入主机签名公钥（首见即信）；之后所有权威消息都要用它验签
    if (snap.hostPubKey) importPub(snap.hostPubKey).then(k => { hostVerifyKey = k }).catch(() => {})
  })

  // ---- 选国家（唯一仲裁）----
  A.claimCty.on((data, peerId) => {
    if (!local.isHost) return
    if (!rateOk(peerId, 'claim', 2, 4)) return
    hostAssignCountry(peerId, data.iso)
  })
  A.ctySet.on(hostOnly((d) => { applyCountrySet(d) }))
  A.ctyRej.on(hostOnly((d) => { emit('countryRejected', d) }))

  // ---- 位置同步 ----
  A.pos.on((d, peerId) => {
    if (!local.isHost) return
    const p = S.players[peerId]; if (!p) return
    if (!rateOk(peerId, 'pos', 30, 20)) return            // 限流：防 pos 洪水
    const v = validatePos(peerId, d); if (!v) return       // 校验：边界 + 速度
    p.x = v.x; p.y = v.y; p.z = v.z; p.ry = v.ry; p.anim = v.anim
  })
  A.world.on(hostOnly((arr) => {
    if (local.isHost) return
    emit('world', arr)
  }))

  // ---- 座位 ----
  A.seatReq.on((d, peerId) => { if (local.isHost) hostSeat(peerId, d.seatId, false) })
  A.rostReq.on((d, peerId) => { if (local.isHost) emit('rostrumRequest', { peerId, seatId: d.seatId, name: nameOf(peerId) }) })
  A.seatRel.on((d, peerId) => { if (local.isHost) hostReleaseSeat(peerId) })
  A.seatSet.on(hostOnly((d) => { applySeatSet(d) }))
  A.rostDec.on(hostOnly((d) => { applySeatSet(d); emit('rostrumDecision', d) }))
  A.chair.on(hostOnly((d) => { S.chairman = d.peerId; emit('chairman') }))

  // —— 真实流程 ——
  A.roll.on((d, peerId) => {
    if (d.rollCall) { if (!fromHost(peerId)) return flagCheat(peerId, 'forged roll call'); S.rollCall = d.rollCall; emit('roll') }
    else if (local.isHost && d.status) hostRoll(peerId, d.status)    // 代表→主机：上报
  })
  A.gsl.on((d, peerId) => {
    if (d.gsl) { if (!fromHost(peerId)) return flagCheat(peerId, 'forged speakers list'); S.gsl = d.gsl; emit('gsl') }
    else if (local.isHost && d.join) hostGslAdd(peerId)              // 代表→主机：入队
  })
  A.draft.on(hostOnly((d) => { S.draft = d.draft; emit('draft') }))
  A.dSponsor.on((d, peerId) => { if (local.isHost) hostDraftJoin(peerId, 'sponsors') })
  A.dSign.on((d, peerId) => { if (local.isHost) hostDraftJoin(peerId, 'signatories') })
  A.statsSet.on(hostOnly((d) => { const p = S.players[d.peerId]; if (p) p.stats = d.stats; emit('stats', d.peerId) }))
  A.result.on(hostOnly((d) => { S.lastResult = d; emit('result') }))

  // —— 会议编排 ——
  A.sched.on((d, peer) => {
    if (d.schedReq) { if (local.isHost && peer === S.chairman) hostSetSchedule(d.schedReq); return }
    if (!fromHost(peer)) return flagCheat(peer, 'forged schedule')
    if (d.schedule != null) S.schedule = d.schedule
    if ('autoTeleport' in d) S.autoTeleport = d.autoTeleport
    if ('autoFlow' in d) S.autoFlow = d.autoFlow
    emit('orch')
  })
  A.orch.on((d, peer) => {
    if (d.presetReq) { if (local.isHost && peer === S.chairman) applyPreset(d.presetReq); return }
    if (!fromHost(peer)) return flagCheat(peer, 'forged orchestration')
    if ('gameStage' in d) S.gameStage = d.gameStage
    if ('preset' in d) S.preset = d.preset
    if ('presetDeadline' in d) S.presetDeadline = d.presetDeadline
    if ('antiCheat' in d) S.antiCheat = d.antiCheat
    emit('orch')
  })
  A.elect.on((d, peer) => {
    if (d.election) { if (!fromHost(peer)) return flagCheat(peer, 'forged election'); S.election = d.election; emit('election') }
    else if (local.isHost && d.vote) hostElectionVote(peer, d.vote)
  })
  // 主席（可能非房主）驱动流程：转发给房主权威执行
  A.chairReq.on((d, peer) => {
    if (!local.isHost || peer !== S.chairman) { if (local.isHost) flagCheat(peer, 'non-chair procedure request'); return }
    const fn = CHAIR_CMDS[d.cmd]; if (fn) fn(...(d.args || []))
  })
  // 踢人/封禁：仅接受真主机发来的（否则任何对端都能踢人）
  A.kick.on((d, peer) => { if (S.antiCheat && peer !== S.hostId) return flagCheat(peer, 'forged kick'); if (d.peerId === selfId) emit('ended', d.ban ? 'banned' : 'kicked') })
  A.teleAll.on(hostOnly((d) => emit('teleport', d.type)))

  // —— 庭审式：对话 / 弹屏 / 展示文件（校验身份，禁止冒用他国）——
  A.say.on((d, peer) => { if (S.antiCheat && !ownsIso(peer, d.iso)) return flagCheat(peer, 'spoofed speaker identity'); if (!rateOk(peer, 'say', 4, 6)) return; emit('say', d) })
  A.splash.on((d, peer) => { if (S.antiCheat && !ownsIso(peer, d.iso)) return flagCheat(peer, 'spoofed splash identity'); if (!rateOk(peer, 'splash', 3, 5)) return; emit('splash', d) })
  A.present.on((d, peer) => { if (S.antiCheat && !ownsIso(peer, d.iso)) return flagCheat(peer, 'spoofed present identity'); emit('present', d) })

  // ---- 议程 / 议题 ----
  A.phase.on(hostOnly((d) => { S.agenda = { phase: d.phase, topic: d.topic }; emit('agenda') }))
  A.start.on(hostOnly((d) => { S.started = true; S.startedAt = d.startedAt; emit('started') }))

  // ---- 投票 ----
  A.voteOpen.on(hostOnly((d) => { S.vote = { ...d, open: true, casts: {}, tally: null, result: null }; emit('vote') }))
  A.voteCast.on((d, peerId) => { if (local.isHost) hostRecordVote(peerId, d) })
  A.voteClose.on(hostOnly((d) => { if (S.vote) { S.vote.open = false; S.vote.tally = d.tally; S.vote.result = d.result }; emit('vote') }))

  // ---- 签字 ----
  A.signDoc.on((d, peerId) => { if (local.isHost) hostSign(peerId, d.docId, d.approve, d.name) })
  A.signSet.on(hostOnly((d) => { S.signed[d.docId] = d.entries; emit('signed', d.docId) }))

  // ---- 语音区 / 发言权 / 麦克风 ----
  A.zone.on((d, peerId) => { const p = S.players[peerId]; if (p) p.zone = d.zone; emit('zone', peerId) })
  A.floor.on(hostOnly((d) => { S.floor = d.peerId; emit('floor') }))
  A.mic.on((d, peerId) => emit('mic', peerId, d.on))

  // ---- 聊天（校验身份）----
  A.chat.on((d, peerId) => { if (S.antiCheat && !ownsIso(peerId, d.iso)) return flagCheat(peerId, 'spoofed chat identity'); if (!rateOk(peerId, 'chat', 3, 5)) return; emit('chat', d) })

  // ---- 主机移除玩家广播 ----
  A.pLeft.on(hostOnly((d) => {
    if (d.iso && S.roster[d.iso]) delete S.roster[d.iso]
    delete S.players[d.peerId]
    refreshOfficeSigns(S.roster)
    emit('playerRemoved', d.peerId)
    emit('roster')
  }))
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
      if (arr.length) { A.world.send(arr); emit('world', arr) }   // 主机本地也驱动远端 avatar
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

// 玩家在选国前选择人物外观
export function setLocalStyle(styleId) { local.style = styleId || DEFAULT_STYLE }

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

// 主席（非房主）把流程指令转发给房主；房主端按 CHAIR_CMDS 调度真正执行
function relayChair(cmd, args) {
  if (local.selfId === S.chairman) A.chairReq.send({ cmd, args }, S.hostId)
}
// 函数声明会被提升，这里引用没问题
const CHAIR_CMDS = {
  setPhase: (...a) => hostSetPhase(...a),
  gslNext: () => hostGslNext(),
  setDraft: (...a) => hostSetDraft(...a),
  openVote: (...a) => hostOpenVote(...a),
  openResVote: (...a) => hostOpenResolutionVote(...a),
  closeVote: () => hostCloseVote(),
  setAuto: (...a) => hostSetAuto(...a),
  startSession: (...a) => hostStartSession(...a),
  beginPreset: () => hostBeginPreset(),
  grantRostrum: (...a) => hostGrantRostrum(...a),
  setFloor: (...a) => hostSetFloor(...a),
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
  if (!local.isHost) return relayChair('setPhase', [phase, topic])
  S.agenda = { phase, topic: topic ?? S.agenda.topic }
  A.phase.send(S.agenda); emit('agenda')
}
export function hostGrantRostrum(seatId, peerId, ok) {
  if (!local.isHost) return relayChair('grantRostrum', [seatId, peerId, ok])
  if (ok) {
    for (const sid in S.seats) if (S.seats[sid] === peerId) S.seats[sid] = null
    S.seats[seatId] = peerId
    const p = S.players[peerId]; if (p) p.seat = seatId
  }
  A.rostDec.send({ seatId, peerId: ok ? peerId : null, ok })
  applySeatSet({ seatId, peerId: ok ? peerId : null, ok })
}
export function hostSetFloor(peerId) {
  if (!local.isHost) return relayChair('setFloor', [peerId])
  S.floor = peerId; A.floor.send({ peerId }); emit('floor')
}
export function hostOpenVote(title, options, kind = 'generic', important = false, council = false) {
  if (!local.isHost) return relayChair('openVote', [title, options, kind, important, council])
  const voteId = 'v' + Date.now()
  S.vote = { voteId, title, options, kind, important, council, open: true, casts: {}, tally: null, result: null }
  A.voteOpen.send({ voteId, title, options, kind, important, council }); emit('vote')
}
// 对当前起草决议发起实质性表决（Yes/No/Abstain）。important=重要问题需 ⅔；council=安理会表决(仅理事国投票，9/15+否决)
export function hostOpenResolutionVote(important = false, council = false) {
  if (!local.isHost) return relayChair('openResVote', [important, council])
  if (!S.draft) return
  hostOpenVote('Resolution: ' + S.draft.title, ['Yes', 'No', 'Abstain'], 'resolution', important, council)
}

// 安理会表决资格：常任(P5) 或 已选出的非常任理事国
export function councilEligible(iso) {
  return PERMANENT_MEMBERS.includes(iso) || (S.council || []).includes(iso)
}
export function castVote(choice) {
  if (!S.vote || !S.vote.open) return
  if (local.isHost) hostRecordVote(selfId, { voteId: S.vote.voteId, choice })
  else A.voteCast.send({ voteId: S.vote.voteId, choice }, S.hostId)
}
export function hostCloseVote() {
  if (!local.isHost) return relayChair('closeVote', [])
  if (!S.vote) return
  const tally = {}
  for (const opt of S.vote.options) tally[opt] = 0
  for (const iso in S.vote.casts) { const c = S.vote.casts[iso]; if (tally[c] != null) tally[c]++ }
  let result = null, best = -1
  for (const opt in tally) if (tally[opt] > best) { best = tally[opt]; result = opt }
  // 实质性决议：门槛(简单多数/⅔) + 五常否决权
  if (S.vote.kind === 'resolution' && S.draft) {
    const yes = tally['Yes'] || 0, no = tally['No'] || 0
    const vetoers = PERMANENT_MEMBERS.filter(iso => S.roster[iso] && S.vote.casts[iso] === 'No')
    let passed
    if (S.vote.council) {
      // 安理会：15 国中需 9 票赞成（小型会议按 60% 折算），且无常任否决
      const eligible = Object.keys(S.roster).filter(councilEligible).length
      const threshold = eligible >= 15 ? 9 : Math.max(1, Math.ceil(eligible * 0.6))
      passed = yes >= threshold && yes > no
    } else {
      passed = S.vote.important ? (yes > no && yes >= 2 * (yes + no) / 3) : (yes > no)
    }
    const vetoed = vetoers.length > 0
    if (vetoed) passed = false
    result = vetoed ? 'VETOED' : (passed ? 'PASSED' : 'FAILED')
    S.vote.open = false; S.vote.tally = tally; S.vote.result = result
    A.voteClose.send({ voteId: S.vote.voteId, tally, result }); emit('vote')
    finalizeResolution(passed, tally, result, vetoers)
    return
  }
  S.vote.open = false; S.vote.tally = tally; S.vote.result = result
  A.voteClose.send({ voteId: S.vote.voteId, tally, result }); emit('vote')
}

// 应用决议效果到 scope 国家，广播指标变更与结果
function finalizeResolution(passed, tally, result, vetoers) {
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
  S.lastResult = { title: draft.title, passed, result: result || (passed ? 'PASSED' : 'FAILED'), vetoers: vetoers || [], important: !!(S.vote && S.vote.important), tally, scope: draft.scope, effects: draft.effects, changes }
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
  if (!local.isHost) return relayChair('gslNext', [])
  const next = S.gsl.shift() || null
  if (next) hostSetFloor(next)
  A.gsl.send({ gsl: S.gsl }); emit('gsl')
}
export function hostSetDraft(draft) {
  if (!local.isHost) return relayChair('setDraft', [draft])
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
  if (!local.isHost) return relayChair('setAuto', [a])
  if ('autoTeleport' in a) S.autoTeleport = a.autoTeleport
  if ('autoFlow' in a) S.autoFlow = a.autoFlow
  if (!S.autoTeleport) lastTeleType = null
  A.sched.send({ schedule: S.schedule, autoTeleport: S.autoTeleport, autoFlow: S.autoFlow }); emit('orch')
}

// 房主点"开始" → 可选先竞选主席，否则进入选预设倒计时
export function hostStartSession(opts) {
  if (!local.isHost) return relayChair('startSession', [opts])
  S.started = true; S.startedAt = Date.now()
  S.autoFlow = !!opts.autoFlow; S.autoTeleport = !!opts.autoTeleport
  A.start.send({ startedAt: S.startedAt })
  A.sched.send({ schedule: S.schedule, autoTeleport: S.autoTeleport, autoFlow: S.autoFlow })
  emit('started')
  if (opts.campaign) { S.gameStage = 'campaign'; broadcastOrch(); hostOpenElection('chairman', 1) }
  else hostBeginPreset()
}
export function hostBeginPreset() {
  if (!local.isHost) return relayChair('beginPreset', [])
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
  if (banned.has(peerId)) { A.kick.send({ peerId, ban: true }, peerId); return }
  // 反作弊：一个对端只能占一个国家（防止抢多国）
  if (S.antiCheat && peerId !== selfId && S.players[peerId] && S.players[peerId].iso && S.players[peerId].iso !== iso) {
    flagCheat(peerId, 'multiple country claim'); A.ctyRej.send({ iso, reason: 'one-country' }, peerId); return
  }
  if (S.roster[iso]) { A.ctyRej.send({ iso, reason: 'taken' }, peerId); return }
  if (Object.keys(S.players).length >= MAX_PLAYERS) { A.ctyRej.send({ iso, reason: 'full' }, peerId); return }
  const base = peerId === selfId ? local.name : (pending[peerId] || nameOf(peerId) || '???')
  const name = uniqueName(base, peerId)   // 房内昵称不可重名
  const color = colorOf(iso)
  const style = peerId === selfId ? (local.style || DEFAULT_STYLE) : (pendingStyle[peerId] || DEFAULT_STYLE)
  const booth = freeBooth(S.roster)
  S.roster[iso] = { peerId, name, color, booth }
  const spawn = spawnPoint()
  S.players[peerId] = { id: peerId, name, iso, color, style, x: spawn.x, y: 0, z: spawn.z, ry: 0, anim: 0, zone: 'hall', seat: null, stats: initStats(iso) }
  delete pending[peerId]; delete pendingStyle[peerId]
  const payload = { iso, peerId, name, color, style, booth, ok: true }
  A.ctySet.send(payload)
  applyCountrySet(payload)
}

function applyCountrySet(d) {
  if (!d || !d.ok) return
  S.roster[d.iso] = { peerId: d.peerId, name: d.name, color: d.color, booth: d.booth }
  if (!S.players[d.peerId]) {
    const spawn = spawnPoint()
    S.players[d.peerId] = { id: d.peerId, name: d.name, iso: d.iso, color: d.color, style: d.style || DEFAULT_STYLE, x: spawn.x, y: 0, z: spawn.z, ry: 0, anim: 0, zone: 'hall', seat: null, stats: initStats(d.iso) }
  } else {
    S.players[d.peerId].iso = d.iso
    S.players[d.peerId].color = d.color
    S.players[d.peerId].style = d.style || DEFAULT_STYLE
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
  if (S.vote.council && !councilEligible(p.iso)) return   // 安理会表决：非理事国无投票权
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

// 被封禁的 peerId（本场会话内有效）
const banned = new Set()
// 房主踢人/封禁
export function hostKick(peerId, ban = false) {
  if (!local.isHost || peerId === selfId) return
  if (ban) banned.add(peerId)
  A.kick.send({ peerId, ban: !!ban }, peerId)   // 通知被踢者退出
  hostRemovePlayer(peerId)
}
export function isBanned(peerId) { return banned.has(peerId) }

// ============ 辅助 ============
// 房内昵称去重：若已被占用则追加 (2)(3)...
function uniqueName(base, peerId) {
  base = (base || 'Delegate').trim() || 'Delegate'
  const taken = new Set()
  for (const iso in S.roster) if (S.roster[iso].peerId !== peerId) taken.add(S.roster[iso].name)
  for (const id in S.players) if (id !== peerId && S.players[id].name) taken.add(S.players[id].name)
  if (!taken.has(base)) return base
  let n = 2; while (taken.has(`${base} (${n})`)) n++
  return `${base} (${n})`
}
function nameOf(peerId) {
  const p = S.players[peerId]; if (p) return p.name
  for (const iso in S.roster) if (S.roster[iso].peerId === peerId) return S.roster[iso].name
  return null
}
function spawnPoint() {
  // 中庭开阔处（主席台前、座位环内侧），避免生成在座位堆里
  return { x: (Math.random() - 0.5) * 6, z: 1 + Math.random() * 4 }
}
