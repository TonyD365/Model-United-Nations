// 界面（全英文）：大厅入口 / 选国 / HUD / 国家数据 / 决议·投票 / 房主流程面板 / 移动端摇杆
import { S, local, on, isHost } from './state.js'
import { PHASES, TOPICS, VOTE_OPTIONS, MAX_PLAYERS, SEATED_PHASES, SESSION_PRESETS, SCHEDULE_TYPES } from './config.js'
import { COUNTRIES, COUNTRY_BY_ISO } from './countries.js'
import * as net from './net.js'
import { setMicEnabled, hasVoice, micEnabled } from './voice.js'
import { toggleView, isMobile, setJoystick, addLook, teleport } from './player.js'
import { boothCenter } from './office.js'
import { phaseLabel, phaseMeta, nextPhase, prevPhase } from './agenda.js'
import { FIELDS, fmt, devIndex, fullProfile } from './stats.js'
import { resolutionsFor, EFFECT_TEMPLATES, effectText } from './resolutions.js'
import { flagUrl } from './flags.js'
import * as sfx from './sfx.js'

const overlay = document.getElementById('overlay')
let hooks = {}

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e }
const clear = () => { overlay.innerHTML = '' }
function randCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)]; return 'MUN-' + s }
const fimg = iso => `<img class="flag-img" src="${flagUrl(iso)}" alt="">`

export function toast(msg, ms = 2600) {
  let t = document.getElementById('toast')
  if (!t) { t = el('div'); t.id = 'toast'; document.body.appendChild(t) }
  const n = el('div', 'toast-item', msg); t.appendChild(n)
  setTimeout(() => n.remove(), ms)
}

export function initUI(h) { hooks = h; showLobby(); subscribe() }

// ---------------- 大厅入口 ----------------
function showLobby() {
  clear(); overlay.style.pointerEvents = 'auto'
  const card = el('div', 'screen lobby')
  card.appendChild(el('h1', 'title', '🌐 Model United Nations'))
  card.appendChild(el('p', 'sub', 'Browser-only · P2P · No server. Share a room code to play together.'))
  const nameRow = el('div', 'field')
  nameRow.appendChild(el('label', null, 'Your name'))
  const nameIn = el('input'); nameIn.placeholder = 'Delegate name'; nameIn.maxLength = 16
  nameIn.value = localStorage.getItem('mun_name') || ''
  nameRow.appendChild(nameIn); card.appendChild(nameRow)

  const tabs = el('div', 'tabs')
  const createBtn = el('button', 'tab active', 'Create Room')
  const joinBtn = el('button', 'tab', 'Join Room')
  tabs.append(createBtn, joinBtn); card.appendChild(tabs)

  const createPane = el('div', 'pane')
  createPane.appendChild(el('label', null, 'Host role'))
  const modeWrap = el('div', 'modes')
  let hostMode = 'player'
  const mPlayer = el('button', 'mode active', '🧍 Host as Player<br><small>Join the floor with an avatar</small>')
  const mDash = el('button', 'mode', '🖥️ Dashboard Only<br><small>Control panel, no avatar</small>')
  modeWrap.append(mPlayer, mDash); createPane.appendChild(modeWrap)
  mPlayer.onclick = () => { hostMode = 'player'; mPlayer.classList.add('active'); mDash.classList.remove('active') }
  mDash.onclick = () => { hostMode = 'dashboard'; mDash.classList.add('active'); mPlayer.classList.remove('active') }
  const codeRow = el('div', 'field')
  codeRow.appendChild(el('label', null, 'Room code (share this)'))
  const codeIn = el('input'); codeIn.value = randCode(); codeRow.appendChild(codeIn); createPane.appendChild(codeRow)
  const go = el('button', 'primary', 'Create & Enter')
  go.onclick = () => {
    const name = (nameIn.value || 'Chair').trim(); localStorage.setItem('mun_name', name)
    net.createRoom(codeIn.value.trim().toUpperCase(), hostMode, name, onJoinError)
    if (hostMode === 'dashboard') showDashboard(); else showCountryPicker(true)
  }
  createPane.appendChild(go); card.appendChild(createPane)

  const joinPane = el('div', 'pane'); joinPane.style.display = 'none'
  const jcode = el('div', 'field'); jcode.appendChild(el('label', null, 'Room code'))
  const jIn = el('input'); jIn.placeholder = 'MUN-XXXXX'; jcode.appendChild(jIn); joinPane.appendChild(jcode)
  const jgo = el('button', 'primary', 'Join')
  jgo.onclick = () => {
    const name = (nameIn.value || 'Delegate').trim(); localStorage.setItem('mun_name', name)
    const code = jIn.value.trim().toUpperCase(); if (!code) return toast('Enter a room code')
    net.joinAsPlayer(code, name, onJoinError); showCountryPicker(false)
  }
  joinPane.appendChild(jgo); card.appendChild(joinPane)

  createBtn.onclick = () => { createBtn.classList.add('active'); joinBtn.classList.remove('active'); createPane.style.display = ''; joinPane.style.display = 'none' }
  joinBtn.onclick = () => { joinBtn.classList.add('active'); createBtn.classList.remove('active'); joinPane.style.display = ''; createPane.style.display = 'none' }

  card.appendChild(el('p', 'foot', 'Real Model UN flow: roll call → set agenda → speakers → caucus → draft resolutions → amendments → voting. Treaties change each country’s real-world indicators.'))
  overlay.appendChild(card)
}
function onJoinError(info) { toast('Connection problem: ' + (info?.error || 'relay error') + '. Retry.') }

// ---------------- 选国家 ----------------
function showCountryPicker(isHostPlayer) {
  clear(); overlay.style.pointerEvents = 'auto'
  const card = el('div', 'screen picker')
  card.appendChild(el('h2', 'title', 'Choose your country'))
  card.appendChild(el('p', 'sub', 'Each country can be held by only one delegate. You will represent its real-world data.'))
  const search = el('input', 'search'); search.placeholder = 'Search…'; card.appendChild(search)
  const grid = el('div', 'country-grid'); card.appendChild(grid)
  function render(filter = '') {
    grid.innerHTML = ''
    for (const c of COUNTRIES) {
      if (filter && !c.name.toLowerCase().includes(filter)) continue
      const taken = !!S.roster[c.iso]
      const b = el('button', 'country' + (taken ? ' taken' : ''), `${fimg(c.iso)}<span>${c.name}</span>`)
      if (taken) b.title = 'Taken'
      else b.onclick = () => { net.claimCountry(c.iso); b.classList.add('pending'); toast('Requesting ' + c.name + '…') }
      grid.appendChild(b)
    }
  }
  search.oninput = () => render(search.value.toLowerCase())
  render()
  const offRoster = on('roster', () => render(search.value.toLowerCase()))
  const offRej = on('countryRejected', d => { toast((COUNTRY_BY_ISO[d.iso]?.name || d.iso) + ' is taken — pick another'); render(search.value.toLowerCase()) })
  const offOk = on('countryConfirmed', () => { offRoster(); offRej(); offOk(); enterHUD() })
  overlay.appendChild(card)
}

// ---------------- 进入场景 HUD ----------------
function enterHUD() {
  clear(); overlay.style.pointerEvents = 'none'
  hooks.onEnterScene && hooks.onEnterScene()

  // 顶栏：阶段 + 议题 + 主席
  const top = el('div', 'hud-top'); top.style.pointerEvents = 'auto'
  const phaseEl = el('div', 'phase-chip'); const topicEl = el('div', 'topic-chip'); const chairEl = el('div', 'topic-chip')
  top.append(phaseEl, topicEl, chairEl); overlay.appendChild(top)
  const refreshTop = () => {
    phaseEl.innerHTML = phaseLabel(S.agenda.phase)
    topicEl.textContent = S.agenda.topic ? '📌 ' + S.agenda.topic : ''
    topicEl.style.display = S.agenda.topic ? '' : 'none'
  }
  const refreshChairChip = () => {
    let nm = null
    for (const iso in S.roster) if (S.roster[iso].peerId === S.chairman) nm = S.roster[iso].name
    chairEl.textContent = nm ? '🪑 Chair: ' + nm : ''; chairEl.style.display = nm ? '' : 'none'
  }
  refreshTop(); refreshChairChip()
  on('agenda', refreshTop); on('snapshot', refreshTop)
  on('chairman', refreshChairChip); on('snapshot', refreshChairChip)

  buildMyCountry()
  buildContextStrip()
  buildResolutionPanel()
  buildVotingModal()
  buildResultModal()
  buildPresetPanel()
  buildElectionPanel()
  on('chat', d => toast('💬 ' + (COUNTRY_BY_ISO[d.iso]?.name || d.name) + ': ' + d.text, 3600))
  on('splash', showSplash)
  on('present', d => openDocument(d.docId, true))
  on('result', () => { const r = S.lastResult; if (r) showSplash({ kind: r.passed ? 'CARRIED' : 'FAILED', label: r.passed ? 'Motion Carried' : 'Motion Failed' }) })

  // 底部 dock：对话框 + 发言输入 + 控制条 竖直堆叠，互不重叠
  const dock = el('div', 'dock'); dock.style.pointerEvents = 'none'
  buildStage(dock)
  // 底部控制条
  const bar = el('div', 'hud-bar'); bar.style.pointerEvents = 'auto'
  const micBtn = el('button', 'ctl', '🎙️ Mic')
  micBtn.onclick = () => {
    if (!hasVoice()) return toast('Microphone not available')
    const on_ = setMicEnabled(!micEnabled()); net.broadcastMic(on_)
    micBtn.textContent = on_ ? '🔴 Mic On' : '🎙️ Mic'; micBtn.classList.toggle('on', on_)
  }
  const viewBtn = el('button', 'ctl', '🎥 View'); viewBtn.onclick = () => toggleView()
  const standBtn = el('button', 'ctl', '🧍 Stand'); standBtn.style.display = 'none'
  standBtn.onclick = () => net.releaseSeat()
  const updateStand = () => { standBtn.style.display = Object.values(S.seats).includes(local.selfId) ? '' : 'none' }
  on('seats', updateStand); on('snapshot', updateStand)
  const officeBtn = el('button', 'ctl', '🏢 Office')
  officeBtn.onclick = () => { const r = S.roster[local.iso]; if (r && r.booth != null) { const c = boothCenter(r.booth); teleport(c.x, c.z - 1.5); toast('Entered your office') } }
  const hallBtn = el('button', 'ctl', '🏛️ Hall'); hallBtn.onclick = () => { teleport(0, 16); toast('Back to the hall') }
  const visitSel = el('select', 'ctl')
  const refreshVisit = () => {
    visitSel.innerHTML = '<option value="">🏢 Visit…</option>'
    for (const iso in S.roster) { const c = COUNTRY_BY_ISO[iso]; const o = el('option', null, (c ? c.name : iso)); o.value = iso; visitSel.appendChild(o) }
  }
  visitSel.onchange = () => { const r = S.roster[visitSel.value]; if (r && r.booth != null) { const cc = boothCenter(r.booth); teleport(cc.x - 2.4, cc.z); toast('Visiting ' + (COUNTRY_BY_ISO[visitSel.value]?.name || '')) } visitSel.selectedIndex = 0 }
  on('roster', refreshVisit); refreshVisit()
  const boardBtn = el('button', 'ctl', '📊 Stats'); boardBtn.onclick = () => openLeaderboard()
  const schedBtn = el('button', 'ctl', '🗓️ Schedule'); schedBtn.onclick = () => openTimetable()
  const updateSched = () => { schedBtn.style.display = (isHost() || local.selfId === S.chairman) ? '' : 'none' }
  on('chairman', updateSched); on('snapshot', updateSched); updateSched()
  const pointBtn = el('button', 'ctl', '✋ Point')
  pointBtn.onclick = () => openPointsMenu()
  const signBtn = el('button', 'ctl', '🖊️ Sign')
  signBtn.onclick = () => openDocument('resolution')
  const objBtn = el('button', 'ctl obj', '❗ Object')
  objBtn.onclick = () => { sfx.resume(); net.sendSplash('POINT', 'Point of Order!') }
  bar.append(micBtn, viewBtn, standBtn, officeBtn, hallBtn, visitSel, boardBtn, schedBtn, pointBtn, signBtn, objBtn)
  dock.appendChild(bar)
  overlay.appendChild(dock)

  if (isMobile) buildMobileControls()
  if (isHost()) buildHostPanel()

  on('floor', () => { if (S.floor === local.selfId) toast('You have the floor — the whole hall can hear you') })
  on('seats', d => { if (d && d.peerId === local.selfId && d.seatId) toast('You are now seated') })
}

// ---------------- My Country 数据面板 ----------------
let prevSelfStats = null
function buildMyCountry() {
  const card = el('div', 'mycountry'); card.style.pointerEvents = 'auto'; overlay.appendChild(card)
  const render = (withDelta) => {
    const iso = local.iso; if (!iso) { card.style.display = 'none'; return }
    card.style.display = ''
    const c = COUNTRY_BY_ISO[iso]; const me = S.players[local.selfId]; const stats = (me && me.stats) || {}
    const prof = fullProfile(iso)
    let h = `<div class="mc-head">${fimg(iso)}<div><div class="mc-name">${c?.name || iso}</div><div class="mc-sub">${prof.capital || ''} · Dev ${devIndex(iso, stats)}</div></div></div><div class="mc-stats">`
    for (const f of FIELDS) {
      const v = stats[f.key]; let delta = ''
      if (withDelta && prevSelfStats && prevSelfStats[f.key] != null && v != null) {
        const d = v - prevSelfStats[f.key]
        if (Math.abs(d) > Math.abs(v) * 1e-4 + 1e-6) delta = `<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}</span>`
      }
      h += `<div class="mc-row"><span>${f.icon} ${f.label}</span><b>${fmt(f.key, v)} ${delta}</b></div>`
    }
    h += `</div><button class="mc-more">Full profile ▾</button><div class="mc-profile" style="display:none">${profileHtml(iso)}</div>`
    card.innerHTML = h
    card.querySelector('.mc-more').onclick = () => { const p = card.querySelector('.mc-profile'); p.style.display = p.style.display === 'none' ? '' : 'none' }
    prevSelfStats = { ...stats }
  }
  on('countryConfirmed', () => render(false))
  on('snapshot', () => render(false))
  on('stats', pid => { if (pid === local.selfId) render(true) })
  on('result', () => render(true))
  render(false)
}
function profileHtml(iso) {
  const p = fullProfile(iso); const rows = [
    ['Region', p.region], ['Subregion', p.subregion], ['Capital', p.capital],
    ['Area', p.area ? p.area.toLocaleString() + ' km²' : null], ['Density', p.density ? p.density + ' /km²' : null],
    ['GDP / capita', p.gdpPerCapita ? '$' + p.gdpPerCapita.toLocaleString() : null],
    ['CO₂ / capita', p.co2PerCapita != null ? p.co2PerCapita.toFixed(1) + ' t' : null],
    ['Currency', p.currency], ['Languages', p.languages],
  ]
  return rows.filter(r => r[1]).map(r => `<div class="mc-prow"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')
}

// ---------------- 阶段上下文操作条（点名/举手）----------------
function buildContextStrip() {
  const strip = el('div', 'ctx-strip'); strip.style.pointerEvents = 'auto'; overlay.appendChild(strip)
  const render = () => {
    const ph = S.agenda.phase; strip.innerHTML = ''
    if (!local.iso) { strip.style.display = 'none'; return }
    if (ph === 'rollcall') {
      strip.style.display = ''
      const mine = S.rollCall[local.iso]
      strip.appendChild(el('span', 'ctx-label', '📋 Roll Call:'))
      const p1 = el('button', 'ctx-btn' + (mine === 'present' ? ' on' : ''), 'Present')
      const p2 = el('button', 'ctx-btn' + (mine === 'voting' ? ' on' : ''), 'Present & Voting')
      p1.onclick = () => net.markRollCall('present')
      p2.onclick = () => net.markRollCall('voting')
      strip.append(p1, p2)
    } else if (ph === 'gsl' || ph === 'modcaucus') {
      strip.style.display = ''
      const queued = S.gsl.includes(local.selfId)
      strip.appendChild(el('span', 'ctx-label', '🎤 ' + (queued ? 'In speakers’ queue (#' + (S.gsl.indexOf(local.selfId) + 1) + ')' : 'Speakers’ list')))
      if (!queued) { const b = el('button', 'ctx-btn', '✋ Raise Hand'); b.onclick = () => net.requestGsl(); strip.appendChild(b) }
    } else strip.style.display = 'none'
  }
  on('agenda', render); on('roll', render); on('gsl', render); on('snapshot', render); render()
}

// ---------------- 决议面板（提案/联署）----------------
function buildResolutionPanel() {
  const panel = el('div', 'res-panel'); panel.style.pointerEvents = 'auto'; overlay.appendChild(panel)
  const render = () => {
    const ph = S.agenda.phase
    const show = (ph === 'draft' || ph === 'amend' || ph === 'voting') && S.draft
    if (!show) { panel.style.display = 'none'; return }
    panel.style.display = ''
    const d = S.draft
    const sponsors = (d.sponsors || []).map(i => fimg(i)).join('')
    const signs = (d.signatories || []).map(i => fimg(i)).join('')
    const mine = local.iso && ((d.sponsors || []).includes(local.iso) ? 'sponsor' : (d.signatories || []).includes(local.iso) ? 'signatory' : null)
    panel.innerHTML =
      `<div class="res-title">📝 ${d.title}</div>` +
      `<div class="res-eff">${effectText(d.effects)} · applies to ${d.scope === 'all' ? 'all members' : 'sponsors & signatories'}</div>` +
      `<ol class="res-clauses">${(d.clauses || []).map(c => `<li>${c}</li>`).join('')}</ol>` +
      `<div class="res-line"><b>Sponsors</b> <span class="flags">${sponsors || '—'}</span></div>` +
      `<div class="res-line"><b>Signatories</b> <span class="flags">${signs || '—'}</span></div>` +
      `<div class="res-actions"></div>`
    const act = panel.querySelector('.res-actions')
    if (local.iso) {
      const sp = el('button', 'res-btn' + (mine === 'sponsor' ? ' on' : ''), 'Sponsor')
      const sg = el('button', 'res-btn' + (mine === 'signatory' ? ' on' : ''), 'Sign')
      sp.onclick = () => { net.sponsorDraft(); toast('You are now a sponsor') }
      sg.onclick = () => { net.signDraft(); toast('You signed on as a signatory') }
      act.append(sp, sg)
    }
  }
  on('draft', render); on('agenda', render); on('snapshot', render); render()
}

// ---------------- 投票模态 ----------------
function buildVotingModal() {
  const m = el('div', 'vote-panel'); m.style.pointerEvents = 'auto'; m.style.display = 'none'; overlay.appendChild(m)
  const render = () => {
    const v = S.vote
    if (v && v.open && local.iso) {
      m.style.display = ''
      const voted = local.iso in (v.casts || {})
      m.innerHTML = `<div class="vp-title">🗳️ ${v.title}</div>`
      // "Present & Voting" 不可弃权
      const noAbstain = S.rollCall[local.iso] === 'voting'
      const opts = el('div', 'vp-opts')
      for (const o of v.options) {
        if (o === 'Abstain' && noAbstain) continue
        const ob = el('button', 'vp-opt', o); if (voted) ob.disabled = true
        ob.onclick = () => { net.castVote(o); toast('Voted: ' + o) }
        opts.appendChild(ob)
      }
      m.appendChild(opts)
      if (noAbstain) m.appendChild(el('div', 'vp-tally', 'You are Present & Voting — abstention not allowed'))
    } else m.style.display = 'none'
  }
  on('vote', render); on('snapshot', render); render()
}

// ---------------- 结果模态（含指标变更）----------------
function buildResultModal() {
  on('result', () => {
    const r = S.lastResult; if (!r) return
    const m = el('div', 'modal'); m.style.pointerEvents = 'auto'
    const card = el('div', 'modal-card')
    card.innerHTML = `<h3>${r.passed ? '✅ Resolution PASSED' : '❌ Resolution FAILED'}</h3>` +
      `<div class="rs-sub">${r.title}</div>` +
      `<div class="rs-tally">${Object.entries(r.tally || {}).map(([k, n]) => `${k}: <b>${n}</b>`).join(' · ')}</div>`
    if (r.passed && r.changes && r.changes.length) {
      card.innerHTML += `<div class="rs-eff">Indicator changes (${effectText(r.effects)})</div>`
      const list = el('div', 'rs-changes')
      for (const ch of r.changes.slice(0, 30)) {
        const parts = FIELDS.filter(f => ch.before[f.key] != null && Math.abs((ch.after[f.key] - ch.before[f.key])) > Math.abs(ch.before[f.key]) * 1e-4 + 1e-6)
          .map(f => `${f.icon} ${fmt(f.key, ch.before[f.key])}→${fmt(f.key, ch.after[f.key])}`).join('  ')
        if (parts) list.appendChild(el('div', 'rs-crow', `${fimg(ch.iso)} <b>${ch.name}</b> ${parts}`))
      }
      card.appendChild(list)
    }
    const close = el('button', 'primary', 'Close'); close.onclick = () => m.remove(); card.appendChild(close)
    m.appendChild(card); overlay.appendChild(m)
  })
}

// ---------------- 排行榜 ----------------
function openLeaderboard() {
  const m = el('div', 'modal'); m.style.pointerEvents = 'auto'
  const card = el('div', 'modal-card wide')
  card.appendChild(el('h3', null, '📊 World Standings'))
  const sortRow = el('div', 'lb-sort')
  const keys = [['dev', 'Development'], ...FIELDS.map(f => [f.key, f.label])]
  let sortKey = 'dev'
  const body = el('div', 'lb-body')
  const render = () => {
    const rows = Object.keys(S.roster).map(iso => {
      const p = S.players[S.roster[iso].peerId]; const st = (p && p.stats) || {}
      const val = sortKey === 'dev' ? devIndex(iso, st) : st[sortKey]
      return { iso, name: COUNTRY_BY_ISO[iso]?.name || iso, val }
    }).sort((a, b) => (b.val ?? -1) - (a.val ?? -1))
    body.innerHTML = rows.map((r, i) => `<div class="lb-row"><span class="lb-rank">${i + 1}</span>${fimg(r.iso)}<span class="lb-name">${r.name}</span><b>${sortKey === 'dev' ? r.val : fmt(sortKey, r.val)}</b></div>`).join('')
  }
  for (const [k, label] of keys) { const b = el('button', 'lb-tab' + (k === sortKey ? ' on' : ''), label); b.onclick = () => { sortKey = k; sortRow.querySelectorAll('.lb-tab').forEach(x => x.classList.remove('on')); b.classList.add('on'); render() }; sortRow.appendChild(b) }
  card.append(sortRow, body)
  const close = el('button', 'primary', 'Close'); close.onclick = () => m.remove(); card.appendChild(close)
  m.appendChild(card); overlay.appendChild(m); render()
}

// ---------------- 选预设倒计时 ----------------
function buildPresetPanel() {
  const wrap = el('div', 'modal'); wrap.style.pointerEvents = 'auto'; wrap.style.display = 'none'; overlay.appendChild(wrap)
  let timer = null
  const render = () => {
    if (S.gameStage !== 'preset') { wrap.style.display = 'none'; if (timer) { clearInterval(timer); timer = null } return }
    wrap.style.display = ''
    const amChair = local.selfId === S.chairman || (isHost() && !S.chairman)
    const secs = S.presetDeadline ? Math.max(0, Math.ceil((S.presetDeadline - Date.now()) / 1000)) : 0
    let h = `<div class="modal-card"><h3>📋 Select the Session Agenda</h3><div class="rs-sub">Auto-selects in <b id="pcount">${secs}</b>s if the Chair doesn’t choose</div>`
    if (amChair) {
      h += '<div class="preset-grid">'
      for (const p of SESSION_PRESETS) h += `<button class="preset-opt" data-id="${p.id}">${p.label}</button>`
      h += '</div>'
    } else h += '<div class="rs-sub">The Chair is selecting the agenda…</div>'
    h += '</div>'
    wrap.innerHTML = h
    if (amChair) wrap.querySelectorAll('.preset-opt').forEach(b => b.onclick = () => { net.chairPickPreset(b.dataset.id); toast('Agenda selected') })
    if (!timer) timer = setInterval(() => { const c = wrap.querySelector('#pcount'); if (c && S.presetDeadline) c.textContent = Math.max(0, Math.ceil((S.presetDeadline - Date.now()) / 1000)) }, 500)
  }
  on('orch', render); on('snapshot', render); render()
}

// ---------------- 选举（主席/理事国）----------------
function buildElectionPanel() {
  const wrap = el('div', 'vote-panel'); wrap.style.pointerEvents = 'auto'; wrap.style.display = 'none'; overlay.appendChild(wrap)
  const render = () => {
    const e = S.election
    if (!e) { wrap.style.display = 'none'; return }
    wrap.style.display = ''
    const mine = local.iso && e.votes[local.iso]
    const title = e.kind === 'chairman' ? '🪑 Elect a Chairman' : `🛡️ Elect ${e.seats} Council Members · ⅔ important question`
    let h = `<div class="vp-title">${title}${e.open ? '' : ' — closed'}</div><div class="elect-list">`
    for (const c of e.candidates) {
      const votes = Object.values(e.votes).filter(v => v === c.id).length
      const won = (e.winners || []).includes(c.id)
      h += `<button class="elect-opt${mine === c.id ? ' on' : ''}${won ? ' won' : ''}" data-id="${c.id}" ${e.open ? '' : 'disabled'}>${c.iso ? fimg(c.iso) : ''} <span>${c.label}</span> <b class="elect-n">${votes || ''}${won ? ' ✓' : ''}</b></button>`
    }
    h += '</div>'
    if (isHost() && e.open) h += '<button class="vp-opt elect-close">Close Election & Tally</button>'
    if (!e.open) h += '<button class="vp-opt elect-dismiss">OK</button>'
    wrap.innerHTML = h
    wrap.querySelectorAll('.elect-opt').forEach(b => b.onclick = () => { net.castElectionVote(b.dataset.id); toast('Vote cast') })
    const cl = wrap.querySelector('.elect-close'); if (cl) cl.onclick = () => net.hostCloseElection()
    const dm = wrap.querySelector('.elect-dismiss'); if (dm) dm.onclick = () => { wrap.style.display = 'none' }
  }
  on('election', render); on('snapshot', render); render()
}

// ---------------- 时刻表编辑 ----------------
function openTimetable() {
  const m = el('div', 'modal'); m.style.pointerEvents = 'auto'
  const card = el('div', 'modal-card wide')
  card.appendChild(el('h3', null, '🗓️ Session Timetable (your local time)'))
  card.appendChild(el('p', 'rs-sub', 'Blocks define when delegates are In Session (Hall) or in Office Hours. With auto-teleport on, everyone is moved at each block start.'))
  const list = el('div', 'tt-list'); card.appendChild(list)
  let blocks = JSON.parse(JSON.stringify(S.schedule || []))
  const renderList = () => {
    list.innerHTML = ''
    blocks.forEach((b, i) => {
      const row = el('div', 'tt-row')
      const s = el('input', 'tt-time'); s.type = 'time'; s.value = b.start || ''; s.onchange = () => b.start = s.value
      const e = el('input', 'tt-time'); e.type = 'time'; e.value = b.end || ''; e.onchange = () => b.end = e.value
      const t = el('select', 'tt-type')
      for (const st of SCHEDULE_TYPES) { const o = el('option', null, st.label); o.value = st.id; if (b.type === st.id) o.selected = true; t.appendChild(o) }
      t.onchange = () => b.type = t.value
      const del = el('button', 'mini no', '✕'); del.onclick = () => { blocks.splice(i, 1); renderList() }
      row.append(s, el('span', 'tt-dash', '→'), e, t, del); list.appendChild(row)
    })
  }
  renderList()
  const add = el('button', 'hp-btn', '+ Add block'); add.onclick = () => { blocks.push({ start: '', end: '', type: 'session' }); renderList() }
  card.appendChild(add)
  const save = el('button', 'primary', 'Save Timetable')
  save.onclick = () => { net.setScheduleAsChair(blocks.filter(b => b.start && b.end)); toast('Timetable saved'); m.remove() }
  const close = el('button', 'hp-btn', 'Cancel'); close.onclick = () => m.remove()
  card.append(save, close)
  m.appendChild(card); overlay.appendChild(m)
}

// ---------------- Points & Motions ----------------
function openPointsMenu() {
  const m = el('div', 'modal'); m.style.pointerEvents = 'auto'
  const card = el('div', 'modal-card')
  card.appendChild(el('h3', null, '✋ Points & Motions'))
  const items = [
    'raises a Point of Order', 'raises a Point of Personal Privilege',
    'raises a Point of Parliamentary Inquiry', 'requests a Right of Reply',
    'motions for a Moderated Caucus', 'motions for an Unmoderated Caucus',
    'motions to move into Voting Procedure',
  ]
  const wrap = el('div', 'pm-grid')
  for (const it of items) { const b = el('button', 'hp-btn', it.replace(/^\w+s?\b/, s => s[0].toUpperCase() + s.slice(1))); b.onclick = () => { net.raisePoint(it); m.remove() } ; wrap.appendChild(b) }
  card.appendChild(wrap)
  const close = el('button', 'primary', 'Close'); close.onclick = () => m.remove(); card.appendChild(close)
  m.appendChild(card); overlay.appendChild(m)
}

// ---------------- 庭审式发言台（底部对话框 + 发言输入）----------------
function buildStage(parent) {
  const stage = el('div', 'stage'); stage.style.pointerEvents = 'auto'; (parent || overlay).appendChild(stage)
  const dlg = el('div', 'dialogue'); dlg.style.display = 'none'
  const dname = el('div', 'dlg-name'); const dtext = el('div', 'dlg-text')
  dlg.append(dname, dtext); stage.appendChild(dlg)
  const row = el('div', 'speak-row')
  const input = el('input', 'speak-input'); input.placeholder = 'Speak to the assembly…  (Enter)'; input.maxLength = 220
  const send = el('button', 'speak-send', 'Speak')
  const fire = () => { const t = input.value.trim(); if (!t) return; sfx.resume(); net.sayLine(t); input.value = '' }
  send.onclick = fire
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fire() } })
  row.append(input, send); stage.appendChild(row)

  let typer = null
  on('say', d => {
    dlg.style.display = ''
    dname.innerHTML = `${d.iso ? fimg(d.iso) : ''} ${COUNTRY_BY_ISO[d.iso]?.name || d.name}`
    clearInterval(typer); dtext.textContent = ''
    const full = d.text; let i = 0
    typer = setInterval(() => { dtext.textContent = full.slice(0, ++i); if (i >= full.length) clearInterval(typer) }, 18)
    clearTimeout(dlg._hide); dlg._hide = setTimeout(() => { dlg.style.display = 'none' }, 4000 + full.length * 45)
  })
}

// ---------------- 戏剧性弹屏（Objection! / Order! / Motion Carried）----------------
function showSplash({ kind, label, name, iso }) {
  const cls = kind === 'ORDER' ? 'gold' : kind === 'CARRIED' ? 'green' : kind === 'FAILED' ? 'red' : 'red'
  const s = el('div', 'splash ' + cls)
  s.innerHTML = `<div class="splash-text">${label || kind}</div>` + (name ? `<div class="splash-who">${iso ? fimg(iso) : ''} ${COUNTRY_BY_ISO[iso]?.name || name}</div>` : '')
  overlay.appendChild(s)
  try { if (kind === 'ORDER') sfx.gavel(); else if (kind === 'CARRIED') sfx.chime(); else sfx.sting() } catch {}
  setTimeout(() => s.remove(), 1500)
}

// ---------------- 签字文档（打开→弹文档→签名→Approve/Reject；present=只读展示）----------------
export function openDocument(docId = 'resolution', presented = false) {
  const m = el('div', 'modal'); m.style.pointerEvents = 'auto'
  const card = el('div', 'modal-card doc-card')
  const d = S.draft
  const title = d ? d.title : (docId === 'treaty' ? 'International Treaty' : 'Conference Document')
  const clauses = d ? (d.clauses || []) : ['(No active draft resolution — this is a blank conference document.)']
  let h = presented ? '<div class="doc-present-banner">📢 Presented to the assembly</div>' : ''
  h += `<div class="doc-head">📜 ${title}</div>`
  if (d && d.effects) h += `<div class="doc-effect">${effectText(d.effects)} · applies to ${d.scope === 'all' ? 'all members' : 'sponsors & signatories'}</div>`
  h += `<ol class="doc-body">${clauses.map(c => `<li>${c}</li>`).join('')}</ol>`
  card.innerHTML = h
  card.appendChild(el('div', 'sig-label', '✍️ Sign here'))
  const sig = el('input', 'sig-input'); sig.placeholder = 'Write your name'; sig.value = local.name || ''
  card.appendChild(sig)
  const sl = el('div', 'sig-list')
  const renderSigs = () => { const arr = S.signed[docId] || []; sl.innerHTML = arr.length ? arr.map(e => `${fimg(e.iso)} <b>${e.name}</b> — ${e.approve ? '✅ Approved' : '❌ Rejected'}`).join('<br>') : '<span class="hp-mini">No signatures yet</span>' }
  renderSigs(); card.appendChild(sl)
  const row = el('div', 'doc-actions')
  const ap = el('button', 'doc-btn ok', '✅ Approve & Sign')
  ap.onclick = () => { if (!sig.value.trim()) return toast('Write your name to sign'); net.signDocument(docId, true, sig.value.trim()); toast('Approved & signed'); m.remove() }
  const rj = el('button', 'doc-btn no', '❌ Reject')
  rj.onclick = () => { net.signDocument(docId, false, sig.value.trim() || local.name); toast('Rejected'); m.remove() }
  row.append(ap, rj); card.appendChild(row)
  if (!presented) {
    const pr = el('button', 'hp-btn', '📢 Present to Assembly')
    pr.onclick = () => { net.presentDoc(docId); toast('Presented to the assembly') }
    card.appendChild(pr)
  }
  const cl = el('button', 'hp-btn', 'Close'); cl.onclick = () => m.remove(); card.appendChild(cl)
  m.appendChild(card); overlay.appendChild(m)
}

// ---------------- Dashboard ----------------
function showDashboard() {
  clear(); overlay.style.pointerEvents = 'auto'
  hooks.onEnterDashboard && hooks.onEnterDashboard()
  const card = el('div', 'screen dashboard')
  card.appendChild(el('h2', 'title', '🖥️ Chair Dashboard'))
  card.appendChild(el('p', 'sub', 'You run the session from here (no avatar on the floor).'))
  const host = el('div', 'host-embed'); card.appendChild(host)
  overlay.appendChild(card)
  buildHostPanel(host)
  buildResultModal()
  buildPresetPanel()
  buildElectionPanel()
}

// ---------------- 房主流程面板 ----------------
function buildHostPanel(container) {
  const panel = el('div', 'host-panel'); panel.style.pointerEvents = 'auto'
  panel.appendChild(el('h3', null, '⚙️ Chair — Run the Session'))

  // 开始会议 + 选项
  panel.appendChild(el('label', 'hp-label', 'Start the Session'))
  const optWrap = el('div', 'hp-opts')
  const mkCb = (label, checked) => { const w = el('label', 'hp-cb'); const c = el('input'); c.type = 'checkbox'; c.checked = checked; w.append(c, document.createTextNode(' ' + label)); optWrap.appendChild(w); return c }
  const cCampaign = mkCb('Hold a Chairman election first', false)
  const cFlow = mkCb('Auto-run the procedure', false)
  const cTele = mkCb('Auto-teleport on timetable', false)
  panel.appendChild(optWrap)
  const startBtn = el('button', 'hp-btn primary', '▶ Start Session')
  startBtn.onclick = () => { net.hostStartSession({ campaign: cCampaign.checked, autoFlow: cFlow.checked, autoTeleport: cTele.checked }); toast('Session started') }
  on('started', () => { startBtn.textContent = '● Session Running'; startBtn.disabled = true })
  panel.appendChild(startBtn)
  const ttBtn = el('button', 'hp-btn', '🗓️ Edit Timetable'); ttBtn.onclick = () => openTimetable(); panel.appendChild(ttBtn)
  const presetBtn = el('button', 'hp-btn', '📋 New Agenda Vote/Preset'); presetBtn.onclick = () => { net.hostBeginPreset(); toast('Agenda selection started') }; panel.appendChild(presetBtn)
  // 运行中实时切换自动
  const autoRow = el('div', 'hp-opts')
  const wF = el('label', 'hp-cb'); const aFlow = el('input'); aFlow.type = 'checkbox'; aFlow.onchange = () => net.hostSetAuto({ autoFlow: aFlow.checked }); wF.append(aFlow, document.createTextNode(' Auto-run procedure'))
  const wT = el('label', 'hp-cb'); const aTele = el('input'); aTele.type = 'checkbox'; aTele.onchange = () => net.hostSetAuto({ autoTeleport: aTele.checked }); wT.append(aTele, document.createTextNode(' Auto-teleport'))
  autoRow.append(wF, wT); panel.appendChild(autoRow)
  const syncAuto = () => { aFlow.checked = S.autoFlow; aTele.checked = S.autoTeleport }
  on('orch', syncAuto); on('snapshot', syncAuto); syncAuto()

  // 流程阶段步进
  panel.appendChild(el('label', 'hp-label', 'Procedure'))
  const phaseRow = el('div', 'hp-row')
  const prevB = el('button', 'hp-btn', '◀'); const phaseNow = el('div', 'hp-phase'); const nextB = el('button', 'hp-btn', '▶')
  prevB.onclick = () => net.hostSetPhase(prevPhase(S.agenda.phase), S.agenda.topic)
  nextB.onclick = () => net.hostSetPhase(nextPhase(S.agenda.phase), S.agenda.topic)
  phaseRow.append(prevB, phaseNow, nextB); panel.appendChild(phaseRow)
  const phaseHint = el('div', 'hp-mini')
  const refreshPhase = () => { phaseNow.innerHTML = phaseLabel(S.agenda.phase); phaseHint.textContent = PHASE_HINTS[S.agenda.phase] || '' }
  on('agenda', refreshPhase); refreshPhase(); panel.appendChild(phaseHint)
  const gavelBtn = el('button', 'hp-btn', '🔨 Bang Gavel — “Order!”')
  gavelBtn.onclick = () => { sfx.resume(); net.sendSplash('ORDER', 'Order in the Assembly!') }
  panel.appendChild(gavelBtn)

  // 点名统计
  panel.appendChild(el('label', 'hp-label', 'Roll Call'))
  const rollInfo = el('div', 'hp-mini')
  const refreshRoll = () => {
    const present = Object.values(S.rollCall).filter(Boolean).length
    const voting = Object.values(S.rollCall).filter(v => v === 'voting').length
    rollInfo.textContent = `${present}/${Object.keys(S.roster).length} present · ${voting} present & voting`
  }
  on('roll', refreshRoll); on('roster', refreshRoll); on('snapshot', refreshRoll); refreshRoll(); panel.appendChild(rollInfo)

  // 议题
  panel.appendChild(el('label', 'hp-label', 'Agenda Topic'))
  const topicSel = el('select', 'hp-input topic-sel')
  topicSel.appendChild(el('option', null, '— select topic —'))
  for (const t of TOPICS) { const o = el('option', null, t); o.value = t; topicSel.appendChild(o) }
  const topicSet = el('button', 'hp-btn', 'Set Topic')
  topicSet.onclick = () => { const t = topicSel.value; if (!t || t.startsWith('—')) return toast('Pick a topic'); net.hostSetPhase(S.agenda.phase, t); toast('Topic set: ' + t) }
  panel.append(topicSel, topicSet)

  // 发言名单
  panel.appendChild(el('label', 'hp-label', "Speakers' List"))
  const gslInfo = el('div', 'hp-mini'); const gslNext = el('button', 'hp-btn', '🎤 Next Speaker')
  gslNext.onclick = () => net.hostGslNext()
  const refreshGsl = () => {
    gslInfo.innerHTML = S.gsl.length ? S.gsl.map((pid, i) => `${i + 1}. ${nameOfPeer(pid)}`).join('<br>') : '(empty)'
  }
  on('gsl', refreshGsl); on('snapshot', refreshGsl); refreshGsl(); panel.append(gslInfo, gslNext)

  // 决议：选预设 或 自定义
  panel.appendChild(el('label', 'hp-label', 'Draft Resolution'))
  const presetSel = el('select', 'hp-input preset-sel')
  const refreshPresets = () => {
    presetSel.innerHTML = '<option value="">— preset for topic —</option>'
    resolutionsFor(S.agenda.topic).forEach((r, i) => { const o = el('option', null, r.title); o.value = String(i); presetSel.appendChild(o) })
  }
  on('agenda', refreshPresets); refreshPresets()
  const usePreset = el('button', 'hp-btn', 'Use Preset')
  usePreset.onclick = () => {
    const list = resolutionsFor(S.agenda.topic); const r = list[+presetSel.value]
    if (!r) return toast('Pick a preset (set a topic first)')
    net.hostSetDraft({ id: r.id, title: r.title, clauses: r.clauses, effects: r.effects, scope: r.scope }); toast('Draft set: ' + r.title)
  }
  panel.append(presetSel, usePreset)

  // 自定义决议（主席自设效果）
  const custWrap = el('details', 'hp-details')
  custWrap.appendChild(el('summary', null, '✎ Custom resolution'))
  const ctitle = el('input', 'hp-input'); ctitle.placeholder = 'Title'
  const cclauses = el('textarea', 'hp-input'); cclauses.placeholder = 'One clause per line'; cclauses.rows = 3
  const tplSel = el('select', 'hp-input')
  EFFECT_TEMPLATES.forEach((t, i) => { const o = el('option', null, t.label); o.value = String(i); tplSel.appendChild(o) })
  const scopeSel = el('select', 'hp-input')
  scopeSel.append(optEl('sponsors', 'Effect on sponsors & signatories'), optEl('all', 'Effect on all members'))
  const createBtn = el('button', 'hp-btn', 'Create & Set Draft')
  createBtn.onclick = () => {
    const title = ctitle.value.trim(); if (!title) return toast('Enter a title')
    const effects = EFFECT_TEMPLATES[+tplSel.value]?.effects || {}
    const clauses = cclauses.value.split('\n').map(s => s.trim()).filter(Boolean)
    net.hostSetDraft({ id: 'custom-' + Date.now(), title, clauses, effects, scope: scopeSel.value })
    toast('Custom draft set'); custWrap.open = false
  }
  custWrap.append(ctitle, cclauses, el('label', 'hp-mini', 'Effect template'), tplSel, scopeSel, createBtn)
  panel.appendChild(custWrap)
  const draftInfo = el('div', 'hp-mini')
  on('draft', () => draftInfo.textContent = S.draft ? `Current: ${S.draft.title} · ${(S.draft.sponsors || []).length} sponsors, ${(S.draft.signatories || []).length} signatories` : '')
  panel.appendChild(draftInfo)

  // 表决
  panel.appendChild(el('label', 'hp-label', 'Voting'))
  const openRes = el('button', 'hp-btn', '🗳️ Open Vote on Draft')
  openRes.onclick = () => { if (!S.draft) return toast('Set a draft first'); net.hostOpenResolutionVote(); toast('Resolution vote open') }
  const openAgenda = el('button', 'hp-btn', 'Vote: Adopt Agenda (Y/N)')
  openAgenda.onclick = () => { if (!S.agenda.topic) return toast('Set a topic first'); net.hostOpenVote('Adopt agenda: ' + S.agenda.topic, ['Yes', 'No', 'Abstain'], 'generic'); toast('Agenda vote open') }
  const closeVote = el('button', 'hp-btn', 'Close & Tally')
  closeVote.onclick = () => net.hostCloseVote()
  const voteInfo = el('div', 'hp-mini')
  on('voteProgress', n => voteInfo.textContent = n + ' votes cast')
  on('vote', () => { if (S.vote && !S.vote.open && S.vote.result) voteInfo.textContent = 'Result: ' + S.vote.result })
  panel.append(openAgenda, openRes, closeVote, voteInfo)

  // 主席台审批
  panel.appendChild(el('label', 'hp-label', 'Rostrum requests'))
  const rostList = el('div', 'hp-list'); panel.appendChild(rostList)
  on('rostrumRequest', req => {
    const item = el('div', 'hp-item', `${req.name} → ${req.seatId}`)
    const ok = el('button', 'mini ok', 'Grant'); const no = el('button', 'mini no', 'Deny')
    ok.onclick = () => { net.hostGrantRostrum(req.seatId, req.peerId, true); net.hostSetFloor(req.peerId); item.remove() }
    no.onclick = () => item.remove()
    item.append(ok, no); rostList.appendChild(item)
  })

  // 指定主席
  panel.appendChild(el('label', 'hp-label', 'Chairman'))
  const chairRow = el('div', 'hp-row')
  const chairSel = el('select', 'hp-input chair-sel'); const chairBtn = el('button', 'hp-btn', 'Designate')
  chairBtn.onclick = () => { if (chairSel.value) { net.hostDesignateChairman(chairSel.value); toast('Chairman designated') } }
  chairRow.append(chairSel, chairBtn); panel.appendChild(chairRow)
  const chairNow = el('div', 'hp-mini'); panel.appendChild(chairNow)
  const refreshChair = () => {
    const prev = chairSel.value; chairSel.innerHTML = '<option value="">— pick delegate —</option>'
    for (const iso in S.roster) { const r = S.roster[iso]; const o = el('option', null, (COUNTRY_BY_ISO[iso]?.name || iso) + ' — ' + r.name); o.value = r.peerId; chairSel.appendChild(o) }
    chairSel.value = prev
    let nm = '(none)'; for (const iso in S.roster) if (S.roster[iso].peerId === S.chairman) nm = (COUNTRY_BY_ISO[iso]?.name || iso)
    chairNow.textContent = 'Current: ' + nm
  }
  on('roster', refreshChair); on('chairman', refreshChair); on('snapshot', refreshChair); refreshChair()

  // 名册 + 发言权
  panel.appendChild(el('label', 'hp-label', 'Delegates'))
  const roster = el('div', 'hp-list'); panel.appendChild(roster)
  const refreshRoster = () => {
    roster.innerHTML = ''
    for (const [iso, r] of Object.entries(S.roster)) {
      const item = el('div', 'hp-item', `${fimg(iso)} ${COUNTRY_BY_ISO[iso]?.name || iso} — ${r.name}`)
      const floorBtn = el('button', 'mini', S.floor === r.peerId ? '🔇' : '📢')
      floorBtn.onclick = () => { net.hostSetFloor(S.floor === r.peerId ? null : r.peerId); refreshRoster() }
      item.appendChild(floorBtn); roster.appendChild(item)
    }
  }
  on('roster', refreshRoster); on('floor', refreshRoster); on('snapshot', refreshRoster); refreshRoster()

  const wrap = container || overlay
  if (!container) {
    panel.classList.add('floating')
    const toggle = el('button', 'hp-toggle', '⚙️'); toggle.onclick = () => panel.classList.toggle('collapsed')
    panel.appendChild(toggle)
  }
  wrap.appendChild(panel)
}
function optEl(value, label) { const o = el('option', null, label); o.value = value; return o }
function nameOfPeer(pid) { for (const iso in S.roster) if (S.roster[iso].peerId === pid) return (COUNTRY_BY_ISO[iso]?.name || iso); return '?' }

const PHASE_HINTS = {
  rollcall: 'Delegates mark Present / Present & Voting.',
  agenda: 'Set a topic, then put it to a vote to adopt the agenda.',
  gsl: 'Delegates raise hands; call Next Speaker to grant the floor.',
  modcaucus: 'Call on delegates to speak on a sub-issue.',
  unmodcaucus: 'Free movement — delegates draft in their offices.',
  draft: 'Set a draft (preset or custom). Delegates sponsor & sign.',
  amend: 'Adjust the draft, then move to voting.',
  voting: 'Open the vote on the draft; close to tally and apply effects.',
  adjourn: 'Session closed.',
}

// ---------------- 移动端虚拟摇杆 ----------------
function buildMobileControls() {
  const joy = el('div', 'joystick'); const thumb = el('div', 'thumb'); joy.appendChild(thumb)
  joy.style.pointerEvents = 'auto'; overlay.appendChild(joy)
  let id = null, cx = 0, cy = 0; const R = 55
  joy.addEventListener('touchstart', e => { const t = e.changedTouches[0]; id = t.identifier; const r = joy.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; e.preventDefault() }, { passive: false })
  joy.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) if (t.identifier === id) {
      let dx = t.clientX - cx, dy = t.clientY - cy; const d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d }
      thumb.style.transform = `translate(${dx}px,${dy}px)`; setJoystick(dx / R, -dy / R)
    }
    e.preventDefault()
  }, { passive: false })
  const end = e => { for (const t of e.changedTouches) if (t.identifier === id) { id = null; thumb.style.transform = ''; setJoystick(0, 0) } }
  joy.addEventListener('touchend', end); joy.addEventListener('touchcancel', end)

  const look = el('div', 'look-zone'); look.style.pointerEvents = 'auto'; overlay.appendChild(look)
  let lid = null, lx = 0, ly = 0
  look.addEventListener('touchstart', e => { const t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; ly = t.clientY; e.preventDefault() }, { passive: false })
  look.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === lid) { addLook((t.clientX - lx) * 1.2, (t.clientY - ly) * 1.2); lx = t.clientX; ly = t.clientY } e.preventDefault() }, { passive: false })
  look.addEventListener('touchend', e => { for (const t of e.changedTouches) if (t.identifier === lid) lid = null })
}

// ---------------- 全局 ----------------
function subscribe() {
  on('ended', () => {
    clear(); overlay.style.pointerEvents = 'auto'
    const s = el('div', 'screen ended')
    s.appendChild(el('h2', 'title', 'Session ended'))
    s.appendChild(el('p', 'sub', 'The chair disconnected. The room has closed.'))
    const b = el('button', 'primary', 'Back to start'); b.onclick = () => location.reload()
    s.appendChild(b); overlay.appendChild(s)
  })
}
