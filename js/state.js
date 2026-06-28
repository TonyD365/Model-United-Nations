// 权威房间状态 + 本地状态 + 轻量事件总线
// 设计：只有主机修改 S 的权威字段；客户端收到广播后调用 apply* 同步。

const listeners = {}
export function on(ev, cb) {
  ;(listeners[ev] ||= new Set()).add(cb)
  return () => listeners[ev]?.delete(cb)
}
export function emit(ev, ...args) {
  listeners[ev]?.forEach(cb => { try { cb(...args) } catch (e) { console.error(e) } })
}

// 共享房间状态（主机为权威源）
export const S = {
  hostId: null,
  hostMode: 'player',        // 'player' | 'dashboard'
  started: false,
  startedAt: null,
  roster: {},                // iso -> { peerId, name, color }
  players: {},               // peerId -> { id,name,iso,color,x,y,z,ry,anim,zone,seat }
  seats: {},                 // seatId -> peerId | null
  rostrumSeatIds: [],        // 主席台受限高位 seatId
  agenda: { phase: 'rollcall', topic: '' },
  vote: null,                // { voteId,title,options,open,casts:{iso:choice},tally,result }
  signed: {},                // docId -> [iso]
  floor: null,               // 拥有大厅广播发言权的 peerId
  chairman: null,            // 被指定为主席的 peerId
  // —— 真实模联流程状态 ——
  rollCall: {},              // iso -> 'present' | 'voting'(present & voting)
  gsl: [],                   // General Speakers' List：排队的 peerId
  draft: null,               // 当前起草决议 { id,title,clauses,effects,scope,sponsors:[iso],signatories:[iso] }
  lastResult: null,          // 上次表决结果 { title,passed,tally,scope,changes:[{iso,name,before,after}] }
  // —— 会议编排 ——
  schedule: [],              // [{ start:'HH:MM', end:'HH:MM', type:'session'|'office' }]
  autoTeleport: false,       // 到点自动传送所有人
  autoFlow: false,           // 自动推进真实流程
  gameStage: 'setup',        // 'setup' | 'campaign' | 'preset' | 'running'
  preset: null,              // 选定的会议预设 id
  presetDeadline: null,      // 选预设截止时间戳(ms)
  election: null,            // { kind, seats, candidates:[{id,label,iso}], votes:{iso:candId}, open, winners:[] }
  council: [],               // 已选出的(非常任)理事国 iso
}

// 本地（仅本端）状态
export const local = {
  selfId: null,
  isHost: false,
  name: '',
  iso: null,
  color: '#cccccc',
  micOn: false,
  inScene: false,
  zone: 'hall',              // 'hall' | 'office:<iso>'
}

export function isHost() { return local.isHost }
export function me() { return S.players[local.selfId] || null }

// ---- 工具 ----
export function countryTaken(iso) { return !!S.roster[iso] }
export function playerCount() { return Object.keys(S.players).length }

// 生成发给晚加入者的全量快照
export function makeSnapshot() {
  return {
    hostId: S.hostId,
    hostMode: S.hostMode,
    started: S.started,
    startedAt: S.startedAt,
    roster: S.roster,
    players: Object.fromEntries(
      Object.entries(S.players).map(([id, p]) => [id, {
        id: p.id, name: p.name, iso: p.iso, color: p.color,
        x: p.x, y: p.y, z: p.z, ry: p.ry, anim: p.anim || 0,
        zone: p.zone || 'hall', seat: p.seat || null, stats: p.stats || null,
      }])),
    seats: S.seats,
    rostrumSeatIds: S.rostrumSeatIds,
    agenda: S.agenda,
    vote: S.vote,
    signed: S.signed,
    floor: S.floor,
    chairman: S.chairman,
    rollCall: S.rollCall,
    gsl: S.gsl,
    draft: S.draft,
    lastResult: S.lastResult,
    schedule: S.schedule,
    autoTeleport: S.autoTeleport,
    autoFlow: S.autoFlow,
    gameStage: S.gameStage,
    preset: S.preset,
    presetDeadline: S.presetDeadline,
    election: S.election,
    council: S.council,
  }
}

// 晚加入者应用快照
export function applySnapshot(snap) {
  S.hostId = snap.hostId
  S.hostMode = snap.hostMode
  S.started = snap.started
  S.startedAt = snap.startedAt
  S.roster = snap.roster || {}
  S.players = snap.players || {}
  S.seats = snap.seats || {}
  S.rostrumSeatIds = snap.rostrumSeatIds || []
  S.agenda = snap.agenda || { phase: 'lobby', topic: '' }
  S.vote = snap.vote || null
  S.signed = snap.signed || {}
  S.floor = snap.floor || null
  S.chairman = snap.chairman || null
  S.rollCall = snap.rollCall || {}
  S.gsl = snap.gsl || []
  S.draft = snap.draft || null
  S.lastResult = snap.lastResult || null
  S.schedule = snap.schedule || []
  S.autoTeleport = !!snap.autoTeleport
  S.autoFlow = !!snap.autoFlow
  S.gameStage = snap.gameStage || 'setup'
  S.preset = snap.preset || null
  S.presetDeadline = snap.presetDeadline || null
  S.election = snap.election || null
  S.council = snap.council || []
  emit('snapshot')
  emit('orch'); emit('election')
  emit('roster')
  emit('agenda')
  emit('vote')
  emit('seats')
  emit('floor')
}
