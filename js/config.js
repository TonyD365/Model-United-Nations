// 全局配置与可调参数
export const APP_ID = 'model-un-ga-v1'   // Trystero appId，避免与别的应用在公共中继上撞车
export const VERSION = '0.1.0'

export const MAX_PLAYERS = 50            // 房主握手时校验的人数上限
export const POS_HZ = 12                 // 客户端上报位置频率
export const WORLD_HZ = 10               // 主机合并广播频率
export const VOICE_UPDATE_HZ = 6         // 语音音量重算频率

// 移动参数（米/秒）
export const MOVE_SPEED = 4.2
export const RUN_SPEED = 7.5
export const EYE_HEIGHT = 1.6
export const PLAYER_HEIGHT = 1.7

// 语音距离衰减
export const VOICE_FULL_DIST = 3.0       // 该距离内满音量
export const VOICE_MAX_DIST = 15.0       // 超过则听不到

// 配色（联合国大会厅绿/金）
export const palette = {
  carpet: 0x1f5c4a,
  carpetDark: 0x174436,
  desk: 0x9c7a4d,
  deskTop: 0xb98f5a,
  wall: 0xe8e1cf,
  gold: 0xc9a227,
  goldDark: 0x9c7d1c,
  rostrum: 0x6b4f2a,
  sky: 0x223a33,
  emblem: 0xcfe8df,
}

// 真实模联议事流程（固定序列，主席推进）— 界面英文
export const PHASES = [
  { id: 'rollcall',     label: 'Roll Call', icon: '📋' },
  { id: 'agenda',       label: 'Set the Agenda', icon: '🗂️' },
  { id: 'gsl',          label: "General Speakers' List", icon: '🎤' },
  { id: 'modcaucus',    label: 'Moderated Caucus', icon: '💬' },
  { id: 'unmodcaucus',  label: 'Unmoderated Caucus', icon: '🚶' },
  { id: 'draft',        label: 'Draft Resolutions', icon: '📝' },
  { id: 'amend',        label: 'Amendments', icon: '✏️' },
  { id: 'voting',       label: 'Voting Procedure', icon: '🗳️' },
  { id: 'adjourn',      label: 'Adjournment', icon: '🔚' },
]
// 进入会议落座的阶段（座位可点）
export const SEATED_PHASES = ['gsl', 'modcaucus', 'draft', 'amend', 'voting']

// 议程可选议题（Set the Agenda 阶段，主席动议+表决选定）
export const TOPICS = [
  'Climate Change Resolution',
  'Humanitarian Aid Appropriation',
  'Peacekeeping Deployment Authorization',
  'Nuclear Non-Proliferation',
  'Refugee Resettlement Framework',
  'Global Public Health',
]

// 投票选项预设
export const VOTE_OPTIONS = ['Yes', 'No', 'Abstain']

// 可走范围（含大厅 + 右侧办公区）
export const FLOOR_BOUNDS = { minX: -24, maxX: 128, minZ: -28, maxZ: 32 }

// 会议预设（开会前由 Chairman 选择；含选举类）
export const SESSION_PRESETS = [
  { id: 'climate', label: '🌍 Climate Change', kind: 'topic', topic: 'Climate Change Resolution' },
  { id: 'humanitarian', label: '🤝 Humanitarian Aid', kind: 'topic', topic: 'Humanitarian Aid Appropriation' },
  { id: 'peace', label: '🕊️ Peacekeeping', kind: 'topic', topic: 'Peacekeeping Deployment Authorization' },
  { id: 'npt', label: '☢️ Non-Proliferation', kind: 'topic', topic: 'Nuclear Non-Proliferation' },
  { id: 'refugee', label: '🛂 Refugee Resettlement', kind: 'topic', topic: 'Refugee Resettlement Framework' },
  { id: 'health', label: '🏥 Global Public Health', kind: 'topic', topic: 'Global Public Health' },
  { id: 'elect-chair', label: '🪑 Elect a New Chairman', kind: 'election', election: 'chairman', seats: 1 },
  { id: 'elect-council', label: '🛡️ Elect Security Council Members', kind: 'election', election: 'council', seats: 5 },
]

// 安理会常任理事国（拥有否决权 veto）：中、法、俄、英、美
export const PERMANENT_MEMBERS = ['CN', 'FR', 'RU', 'GB', 'US']

export const PRESET_COUNTDOWN_MS = 60_000   // 开会前 1 分钟选预设，超时自动选
export const AUTO_PHASE_MS = 30_000         // 自动流程每阶段时长

// 自动流程下各阶段推进时长（毫秒，可不同）
export const PHASE_DURATIONS = {
  rollcall: 25_000, agenda: 30_000, gsl: 35_000, modcaucus: 35_000,
  unmodcaucus: 45_000, draft: 60_000, amend: 30_000, voting: 40_000, adjourn: 0,
}

// 默认时刻表为空，Chairman 自行添加（时间为电脑本地时间 HH:MM）
export const SCHEDULE_TYPES = [
  { id: 'session', label: '🏛️ In Session (Hall)' },
  { id: 'office', label: '🏢 Office Hours' },
]
