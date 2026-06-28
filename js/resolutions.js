// 预设决议库（按议题）+ 主席自定义决议的效果模板。
// effects: { gdp, co2, population 为百分比小数; lifeExp 为绝对年数 }
// scope: 'sponsors'(仅提案+联署国) | 'all'(全体会员国)

export const RESOLUTIONS = {
  'Climate Change Resolution': [
    {
      id: 'climate-emit',
      title: 'Global Emissions Reduction Pact',
      clauses: [
        'Calls upon all signatory states to reduce CO₂ emissions by 15% within the decade;',
        'Establishes a Green Technology Transfer Fund for developing nations;',
        'Requests annual emissions reporting to the Secretariat.',
      ],
      effects: { co2: -0.15, gdp: -0.03, lifeExp: 0.4 }, scope: 'sponsors',
    },
    {
      id: 'climate-adapt',
      title: 'Climate Adaptation & Green Growth',
      clauses: [
        'Funds renewable energy infrastructure across member states;',
        'Incentivises green industry through tax frameworks.',
      ],
      effects: { co2: -0.08, gdp: 0.02 }, scope: 'sponsors',
    },
  ],
  'Humanitarian Aid Appropriation': [
    {
      id: 'human-fund',
      title: 'Global Humanitarian Relief Fund',
      clauses: [
        'Appropriates emergency relief to crisis-affected populations;',
        'Coordinates delivery through UN agencies.',
      ],
      effects: { gdp: -0.02, lifeExp: 1.2 }, scope: 'all',
    },
  ],
  'Peacekeeping Deployment Authorization': [
    {
      id: 'peace-mandate',
      title: 'Peacekeeping Mission Mandate',
      clauses: [
        'Authorises deployment of peacekeeping forces to the region;',
        'Mandates protection of civilians and humanitarian corridors.',
      ],
      effects: { gdp: -0.015, lifeExp: 0.6 }, scope: 'sponsors',
    },
  ],
  'Nuclear Non-Proliferation': [
    {
      id: 'npt-disarm',
      title: 'Disarmament & Non-Proliferation Accord',
      clauses: [
        'Reaffirms commitments under the Non-Proliferation Treaty;',
        'Redirects military spending toward development.',
      ],
      effects: { gdp: 0.015, lifeExp: 0.3 }, scope: 'sponsors',
    },
  ],
  'Refugee Resettlement Framework': [
    {
      id: 'refugee-compact',
      title: 'Global Refugee Resettlement Compact',
      clauses: [
        'Establishes shared resettlement quotas among signatories;',
        'Provides integration support and legal protections.',
      ],
      effects: { gdp: -0.01, lifeExp: 0.8, population: 0.01 }, scope: 'sponsors',
    },
  ],
  'Global Public Health': [
    {
      id: 'health-access',
      title: 'Universal Health Access Initiative',
      clauses: [
        'Expands access to essential medicines and vaccines;',
        'Strengthens pandemic preparedness systems.',
      ],
      effects: { gdp: -0.02, lifeExp: 1.5 }, scope: 'all',
    },
  ],
}

export function resolutionsFor(topic) { return RESOLUTIONS[topic] || [] }

// 主席自定义决议时可一键套用的效果模板
export const EFFECT_TEMPLATES = [
  { label: 'Climate (CO₂ −15%, GDP −3%)', effects: { co2: -0.15, gdp: -0.03, lifeExp: 0.4 } },
  { label: 'Economic boom (GDP +5%, CO₂ +5%)', effects: { gdp: 0.05, co2: 0.05 } },
  { label: 'Humanitarian (Life +1.2, GDP −2%)', effects: { lifeExp: 1.2, gdp: -0.02 } },
  { label: 'Disarmament (GDP +1.5%)', effects: { gdp: 0.015 } },
  { label: 'No effect', effects: {} },
]

// 把 effects 渲染成简短文字
export function effectText(effects) {
  if (!effects || !Object.keys(effects).length) return 'No indicator effect'
  const parts = []
  if (effects.gdp != null) parts.push('GDP ' + pct(effects.gdp))
  if (effects.co2 != null) parts.push('CO₂ ' + pct(effects.co2))
  if (effects.population != null) parts.push('Population ' + pct(effects.population))
  if (effects.lifeExp != null) parts.push('Life ' + (effects.lifeExp >= 0 ? '+' : '') + effects.lifeExp + 'yr')
  return parts.join(', ')
}
function pct(v) { return (v >= 0 ? '+' : '') + Math.round(v * 100) + '%' }
