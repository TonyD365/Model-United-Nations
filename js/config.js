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

// 议程阶段（房主推进的状态机）— 界面英文
export const PHASES = [
  { id: 'lobby',      label: 'Lobby / Pick Country', icon: '🌐' },
  { id: 'office',     label: 'Country Office · Sign', icon: '🖊️' },
  { id: 'session',    label: 'Enter Session · Be Seated', icon: '🪑' },
  { id: 'debate',     label: 'Debate / Speeches', icon: '🎤' },
  { id: 'vote',       label: 'Voting', icon: '🗳️' },
  { id: 'resolution', label: 'Tally / Resolution', icon: '📜' },
]

// 预设议题（房主可选或自定义）
export const TOPICS = [
  'Election of Non-Permanent Security Council Members',
  'Climate Change Resolution',
  'Humanitarian Aid Appropriation',
  'Peacekeeping Deployment Authorization',
  'Non-Proliferation Treaty Review',
  'Refugee Resettlement Framework',
]

// 投票选项预设
export const VOTE_OPTIONS = ['Yes', 'No', 'Abstain']

// 可走范围（含大厅 + 右侧办公区走廊）
export const FLOOR_BOUNDS = { minX: -22, maxX: 78, minZ: -16, maxZ: 38 }
