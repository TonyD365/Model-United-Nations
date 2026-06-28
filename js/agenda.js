// 议程辅助：阶段查找与下一/上一阶段
import { PHASES } from './config.js'

export function phaseMeta(id) { return PHASES.find(p => p.id === id) || PHASES[0] }
export function phaseIndex(id) { return Math.max(0, PHASES.findIndex(p => p.id === id)) }
export function nextPhase(id) { return PHASES[Math.min(PHASES.length - 1, phaseIndex(id) + 1)].id }
export function prevPhase(id) { return PHASES[Math.max(0, phaseIndex(id) - 1)].id }
export function phaseLabel(id) { const m = phaseMeta(id); return `${m.icon} ${m.label}` }
