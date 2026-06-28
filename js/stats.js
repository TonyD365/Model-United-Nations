// 国家指标：初始化(真实数据) + 协议效果应用 + 综合发展指数
import { COUNTRY_DATA } from './country-data.js'

// 动态指标（会被协议改变）。effects 约定：
//   gdp / co2 / population 用百分比小数（-0.15 = -15%）
//   lifeExp 用绝对年数（+1.2）
export function initStats(iso) {
  const d = COUNTRY_DATA[iso] || {}
  return {
    population: d.population ?? null,
    gdp: d.gdp ?? null,
    co2: d.co2 ?? null,
    lifeExp: d.lifeExp ?? null,
  }
}

export function fullProfile(iso) { return COUNTRY_DATA[iso] || {} }

export function applyEffects(stats, effects) {
  if (!effects) return
  for (const k of ['gdp', 'co2', 'population']) {
    if (effects[k] != null && stats[k] != null) stats[k] = Math.max(0, stats[k] * (1 + effects[k]))
  }
  if (effects.lifeExp != null && stats.lifeExp != null) {
    stats.lifeExp = Math.max(20, Math.min(95, stats.lifeExp + effects.lifeExp))
  }
}

// 综合发展指数（0–100，用于排行榜）：人均GDP、寿命越高越好，人均CO₂越低越好
export function devIndex(iso, stats) {
  const d = COUNTRY_DATA[iso] || {}
  const pop = stats.population || d.population || 1
  const gdpPC = stats.gdp ? stats.gdp / pop : (d.gdpPerCapita || 0)
  const life = stats.lifeExp || d.lifeExp || 50
  const co2PC = (stats.co2 != null && pop) ? (stats.co2 * 1e6) / pop : (d.co2PerCapita || 5)
  const eco = Math.min(1, gdpPC / 60000)
  const health = Math.min(1, Math.max(0, (life - 40) / 45))
  const env = Math.max(0, 1 - Math.min(1, co2PC / 20))
  return Math.round((eco * 0.4 + health * 0.35 + env * 0.25) * 100)
}

// 数字友好格式化
export function fmt(field, v) {
  if (v == null) return '—'
  if (field === 'population') return v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v).toLocaleString()
  if (field === 'gdp') return v >= 1e12 ? '$' + (v / 1e12).toFixed(2) + 'T' : '$' + (v / 1e9).toFixed(1) + 'B'
  if (field === 'co2') return Math.round(v).toLocaleString() + ' Mt'
  if (field === 'lifeExp') return v.toFixed(1) + ' yr'
  return String(v)
}

export const FIELDS = [
  { key: 'population', label: 'Population', icon: '👥' },
  { key: 'gdp', label: 'GDP', icon: '💰' },
  { key: 'co2', label: 'CO₂ Emissions', icon: '🏭' },
  { key: 'lifeExp', label: 'Life Expectancy', icon: '❤️' },
]
