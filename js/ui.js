// 界面（全英文）：大厅入口 / 选国 / HUD / 房主面板 / 移动端虚拟摇杆 / 提示
import { S, local, on, isHost } from './state.js'
import { PHASES, TOPICS, VOTE_OPTIONS, MAX_PLAYERS } from './config.js'
import { COUNTRIES, COUNTRY_BY_ISO } from './countries.js'
import * as net from './net.js'
import { setMicEnabled, hasVoice, micEnabled } from './voice.js'
import { toggleView, isMobile, setJoystick, addLook, teleport } from './player.js'
import { boothCenter } from './office.js'
import { phaseLabel, nextPhase, prevPhase } from './agenda.js'

const overlay = document.getElementById('overlay')
let hooks = {}

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e }
const clear = () => { overlay.innerHTML = '' }
function randCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)]; return 'MUN-' + s }

export function toast(msg, ms = 2600) {
  let t = document.getElementById('toast')
  if (!t) { t = el('div'); t.id = 'toast'; document.body.appendChild(t) }
  const n = el('div', 'toast-item', msg); t.appendChild(n)
  setTimeout(() => n.remove(), ms)
}

export function initUI(h) {
  hooks = h
  showLobby()
  subscribe()
}

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
  nameRow.appendChild(nameIn)
  card.appendChild(nameRow)

  const tabs = el('div', 'tabs')
  const createBtn = el('button', 'tab active', 'Create Room')
  const joinBtn = el('button', 'tab', 'Join Room')
  tabs.append(createBtn, joinBtn); card.appendChild(tabs)

  // 建房面板
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
  const codeIn = el('input'); codeIn.value = randCode()
  codeRow.appendChild(codeIn); createPane.appendChild(codeRow)

  const go = el('button', 'primary', 'Create & Enter')
  go.onclick = () => {
    const name = (nameIn.value || 'Host').trim(); localStorage.setItem('mun_name', name)
    net.createRoom(codeIn.value.trim().toUpperCase(), hostMode, name, onJoinError)
    if (hostMode === 'dashboard') { showDashboard() } else { showCountryPicker(true) }
  }
  createPane.appendChild(go)
  card.appendChild(createPane)

  // 加入面板
  const joinPane = el('div', 'pane'); joinPane.style.display = 'none'
  const jcode = el('div', 'field'); jcode.appendChild(el('label', null, 'Room code'))
  const jIn = el('input'); jIn.placeholder = 'MUN-XXXXX'; jcode.appendChild(jIn); joinPane.appendChild(jcode)
  const jgo = el('button', 'primary', 'Join')
  jgo.onclick = () => {
    const name = (nameIn.value || 'Delegate').trim(); localStorage.setItem('mun_name', name)
    const code = jIn.value.trim().toUpperCase()
    if (!code) return toast('Enter a room code')
    net.joinAsPlayer(code, name, onJoinError)
    showCountryPicker(false)
  }
  joinPane.appendChild(jgo); card.appendChild(joinPane)

  createBtn.onclick = () => { createBtn.classList.add('active'); joinBtn.classList.remove('active'); createPane.style.display = ''; joinPane.style.display = 'none' }
  joinBtn.onclick = () => { joinBtn.classList.add('active'); createBtn.classList.remove('active'); joinPane.style.display = ''; createPane.style.display = 'none' }

  card.appendChild(el('p', 'foot', 'Voice chat is proximity-based in the hall, room-based in offices, and hall-wide when the chair grants you the floor.'))
  overlay.appendChild(card)
}

function onJoinError(info) { toast('Connection problem: ' + (info?.error || 'relay error') + '. Retry.') }

// ---------------- 选国家（唯一） ----------------
function showCountryPicker(isHostPlayer) {
  clear(); overlay.style.pointerEvents = 'auto'
  const card = el('div', 'screen picker')
  card.appendChild(el('h2', 'title', 'Choose your country'))
  card.appendChild(el('p', 'sub', 'Each country can be held by only one delegate.'))
  const search = el('input', 'search'); search.placeholder = 'Search…'; card.appendChild(search)
  const grid = el('div', 'country-grid'); card.appendChild(grid)

  function render(filter = '') {
    grid.innerHTML = ''
    for (const c of COUNTRIES) {
      if (filter && !c.name.toLowerCase().includes(filter)) continue
      const taken = !!S.roster[c.iso]
      const b = el('button', 'country' + (taken ? ' taken' : ''), `<span class="flag">${c.flag}</span><span>${c.name}</span>`)
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

  // 顶栏：阶段 + 议题
  const top = el('div', 'hud-top'); top.style.pointerEvents = 'auto'
  const phaseEl = el('div', 'phase-chip'); const topicEl = el('div', 'topic-chip'); const chairEl = el('div', 'topic-chip')
  top.append(phaseEl, topicEl, chairEl); overlay.appendChild(top)
  const refreshTop = () => {
    phaseEl.innerHTML = phaseLabel(S.agenda.phase)
    topicEl.textContent = S.agenda.topic ? '📌 ' + S.agenda.topic : 'No topic set'
    topicEl.style.display = S.agenda.topic ? '' : 'none'
  }
  const refreshChairChip = () => {
    let nm = null
    for (const iso in S.roster) if (S.roster[iso].peerId === S.chairman) nm = S.roster[iso].name
    chairEl.textContent = nm ? '🪑 Chair: ' + nm : ''
    chairEl.style.display = nm ? '' : 'none'
  }
  refreshTop(); refreshChairChip()
  on('agenda', refreshTop); on('snapshot', refreshTop)
  on('chairman', refreshChairChip); on('snapshot', refreshChairChip)

  // 底部控制条
  const bar = el('div', 'hud-bar'); bar.style.pointerEvents = 'auto'
  const micBtn = el('button', 'ctl', '🎙️ Mic: Off')
  micBtn.onclick = () => {
    if (!hasVoice()) return toast('Microphone not available')
    const on_ = setMicEnabled(!micEnabled()); net.broadcastMic(on_)
    micBtn.textContent = on_ ? '🔴 Mic: On' : '🎙️ Mic: Off'
    micBtn.classList.toggle('on', on_)
  }
  const viewBtn = el('button', 'ctl', '🎥 View')
  viewBtn.onclick = () => toggleView()
  const officeBtn = el('button', 'ctl', '🏢 My Office')
  officeBtn.onclick = () => {
    const r = S.roster[local.iso]
    if (r && r.booth != null) { const c = boothCenter(r.booth); teleport(c.x, c.z - 1.5); toast('Entered your office') }
  }
  const hallBtn = el('button', 'ctl', '🏛️ Hall')
  hallBtn.onclick = () => { teleport(0, 16); toast('Back to the hall') }
  const standBtn = el('button', 'ctl', '🧍 Stand Up'); standBtn.style.display = 'none'
  standBtn.onclick = () => { net.releaseSeat() }
  const updateStand = () => { standBtn.style.display = Object.values(S.seats).includes(local.selfId) ? '' : 'none' }
  on('seats', updateStand); on('snapshot', updateStand)
  const visitSel = el('select', 'ctl')
  const refreshVisit = () => {
    visitSel.innerHTML = '<option value="">🏢 Visit office…</option>'
    for (const iso in S.roster) { const c = COUNTRY_BY_ISO[iso]; const o = el('option', null, c ? c.flag + ' ' + c.name : iso); o.value = iso; visitSel.appendChild(o) }
  }
  visitSel.onchange = () => {
    const iso = visitSel.value, r = S.roster[iso]
    if (r && r.booth != null) { const cc = boothCenter(r.booth); teleport(cc.x - 2.4, cc.z); toast('Visiting ' + (COUNTRY_BY_ISO[iso]?.name || iso) + "'s office") }
    visitSel.selectedIndex = 0
  }
  on('roster', refreshVisit); refreshVisit()
  const signBtn = el('button', 'ctl', '🖊️ Sign')
  signBtn.onclick = () => { net.signDocument('resolution'); toast('You signed the resolution') }
  bar.append(micBtn, viewBtn, standBtn, officeBtn, hallBtn, visitSel, signBtn)
  overlay.appendChild(bar)

  // 投票面板
  const votePanel = el('div', 'vote-panel'); votePanel.style.pointerEvents = 'auto'; votePanel.style.display = 'none'
  overlay.appendChild(votePanel)
  const refreshVote = () => {
    const v = S.vote
    if (v && v.open && local.iso) {
      votePanel.style.display = ''
      votePanel.innerHTML = `<div class="vp-title">🗳️ ${v.title}</div>`
      const opts = el('div', 'vp-opts')
      for (const o of v.options) {
        const ob = el('button', 'vp-opt', o); ob.onclick = () => { net.castVote(o); toast('Voted: ' + o); votePanel.style.display = 'none' }
        opts.appendChild(ob)
      }
      votePanel.appendChild(opts)
    } else if (v && !v.open && v.result) {
      votePanel.style.display = ''
      votePanel.innerHTML = `<div class="vp-title">📜 Result: ${v.result}</div><div class="vp-tally">${Object.entries(v.tally || {}).map(([k, n]) => `${k}: ${n}`).join(' · ')}</div>`
      setTimeout(() => { if (S.vote && !S.vote.open) votePanel.style.display = 'none' }, 6000)
    } else votePanel.style.display = 'none'
  }
  on('vote', refreshVote); refreshVote()

  if (isMobile) buildMobileControls()
  if (isHost()) buildHostPanel()

  // 被授予主席台 / 发言权提示
  on('floor', () => { if (S.floor === local.selfId) toast('You have the floor — the whole hall can hear you') })
  on('seats', d => { if (d && d.peerId === local.selfId && d.seatId) toast('You are now seated') })
}

// ---------------- 纯主控面板（dashboard） ----------------
function showDashboard() {
  clear(); overlay.style.pointerEvents = 'auto'
  hooks.onEnterDashboard && hooks.onEnterDashboard()
  const card = el('div', 'screen dashboard')
  card.appendChild(el('h2', 'title', '🖥️ Chair Dashboard'))
  card.appendChild(el('p', 'sub', 'Room code: <b>' + currentCodeHint() + '</b> — you are not on the floor.'))
  const host = el('div', 'host-embed'); card.appendChild(host)
  overlay.appendChild(card)
  buildHostPanel(host)
}
function currentCodeHint() { return '(shown in your invite)'; }

// ---------------- 房主控制面板 ----------------
function buildHostPanel(container) {
  const panel = el('div', 'host-panel'); panel.style.pointerEvents = 'auto'
  panel.appendChild(el('h3', null, '⚙️ Chair Controls'))

  // 开始会议
  const startBtn = el('button', 'hp-btn primary', 'Start Session')
  startBtn.onclick = () => { net.hostStart(); toast('Session started') }
  on('started', () => { startBtn.textContent = 'Session Running'; startBtn.disabled = true })
  panel.appendChild(startBtn)

  // 议题
  panel.appendChild(el('label', 'hp-label', 'Topic'))
  const topicSel = el('select', 'hp-input')
  topicSel.appendChild(el('option', null, '— select preset —'))
  for (const t of TOPICS) { const o = el('option', null, t); o.value = t; topicSel.appendChild(o) }
  const topicCustom = el('input', 'hp-input'); topicCustom.placeholder = 'or type a custom topic'
  const topicSet = el('button', 'hp-btn', 'Set Topic')
  topicSet.onclick = () => {
    const t = (topicCustom.value || topicSel.value || '').trim()
    if (!t || t.startsWith('—')) return toast('Pick or type a topic')
    net.hostSetPhase(S.agenda.phase, t); toast('Topic set')
  }
  panel.append(topicSel, topicCustom, topicSet)

  // 阶段步进
  panel.appendChild(el('label', 'hp-label', 'Agenda phase'))
  const phaseRow = el('div', 'hp-row')
  const prevB = el('button', 'hp-btn', '◀ Prev')
  const phaseNow = el('div', 'hp-phase')
  const nextB = el('button', 'hp-btn', 'Next ▶')
  prevB.onclick = () => net.hostSetPhase(prevPhase(S.agenda.phase), S.agenda.topic)
  nextB.onclick = () => net.hostSetPhase(nextPhase(S.agenda.phase), S.agenda.topic)
  phaseRow.append(prevB, phaseNow, nextB); panel.appendChild(phaseRow)
  const refreshPhase = () => phaseNow.innerHTML = phaseLabel(S.agenda.phase)
  on('agenda', refreshPhase); refreshPhase()

  // 投票
  panel.appendChild(el('label', 'hp-label', 'Vote'))
  const vtitle = el('input', 'hp-input'); vtitle.placeholder = 'Vote title (e.g. Adopt resolution?)'
  const vopen = el('button', 'hp-btn', 'Open Vote (Yes/No/Abstain)')
  const vclose = el('button', 'hp-btn', 'Close & Tally')
  vopen.onclick = () => { net.hostOpenVote((vtitle.value || S.agenda.topic || 'Motion').trim(), VOTE_OPTIONS); toast('Vote opened') }
  vclose.onclick = () => { net.hostCloseVote(); toast('Vote closed') }
  const vprog = el('div', 'hp-mini')
  on('voteProgress', n => vprog.textContent = n + ' countries voted')
  on('vote', () => { if (S.vote && !S.vote.open && S.vote.result) vprog.textContent = 'Result: ' + S.vote.result })
  panel.append(vtitle, vopen, vclose, vprog)

  // 主席台审批队列
  panel.appendChild(el('label', 'hp-label', 'Rostrum requests'))
  const rostList = el('div', 'hp-list'); panel.appendChild(rostList)
  on('rostrumRequest', req => {
    const item = el('div', 'hp-item', `${req.name} → ${req.seatId}`)
    const ok = el('button', 'mini ok', 'Grant'); const no = el('button', 'mini no', 'Deny')
    ok.onclick = () => { net.hostGrantRostrum(req.seatId, req.peerId, true); net.hostSetFloor(req.peerId); item.remove(); toast('Granted rostrum + floor') }
    no.onclick = () => { item.remove() }
    item.append(ok, no); rostList.appendChild(item)
  })

  // 指定主席（尤其 dashboard 模式）
  panel.appendChild(el('label', 'hp-label', 'Chairman'))
  const chairRow = el('div', 'hp-row')
  const chairSel = el('select', 'hp-input chair-sel')
  const chairBtn = el('button', 'hp-btn', 'Designate')
  chairBtn.onclick = () => { if (chairSel.value) { net.hostDesignateChairman(chairSel.value); toast('Chairman designated') } }
  chairRow.append(chairSel, chairBtn); panel.appendChild(chairRow)
  const chairNow = el('div', 'hp-mini'); panel.appendChild(chairNow)
  const refreshChair = () => {
    const prev = chairSel.value
    chairSel.innerHTML = '<option value="">— pick delegate —</option>'
    for (const iso in S.roster) { const r = S.roster[iso]; const c = COUNTRY_BY_ISO[iso]; const o = el('option', null, (c ? c.name : iso) + ' — ' + r.name); o.value = r.peerId; chairSel.appendChild(o) }
    chairSel.value = prev
    let nm = '(none)'
    for (const iso in S.roster) if (S.roster[iso].peerId === S.chairman) nm = (COUNTRY_BY_ISO[iso]?.name || iso) + ' / ' + S.roster[iso].name
    chairNow.textContent = 'Current: ' + nm
  }
  on('roster', refreshChair); on('chairman', refreshChair); on('snapshot', refreshChair); refreshChair()

  // 名册 + 发言权
  panel.appendChild(el('label', 'hp-label', 'Delegates'))
  const roster = el('div', 'hp-list'); panel.appendChild(roster)
  const refreshRoster = () => {
    roster.innerHTML = ''
    const entries = Object.entries(S.roster)
    panel.querySelector('.hp-count')?.remove()
    panel.insertBefore(el('div', 'hp-count hp-mini', `${entries.length}/${MAX_PLAYERS} delegates`), roster)
    for (const [iso, r] of entries) {
      const c = COUNTRY_BY_ISO[iso]
      const item = el('div', 'hp-item', `${c ? c.flag : ''} ${c ? c.name : iso} — ${r.name}`)
      const floorBtn = el('button', 'mini', S.floor === r.peerId ? '🔇 Floor' : '📢 Floor')
      floorBtn.onclick = () => { net.hostSetFloor(S.floor === r.peerId ? null : r.peerId); refreshRoster() }
      item.appendChild(floorBtn); roster.appendChild(item)
    }
  }
  on('roster', refreshRoster); on('floor', refreshRoster); on('snapshot', refreshRoster); refreshRoster()

  // 折叠
  const wrap = container || overlay
  if (!container) {
    panel.classList.add('floating')
    const toggle = el('button', 'hp-toggle', '⚙️')
    toggle.onclick = () => panel.classList.toggle('collapsed')
    panel.appendChild(toggle)
  }
  wrap.appendChild(panel)
}

// ---------------- 移动端虚拟摇杆 ----------------
function buildMobileControls() {
  const joy = el('div', 'joystick'); const thumb = el('div', 'thumb'); joy.appendChild(thumb)
  joy.style.pointerEvents = 'auto'; overlay.appendChild(joy)
  let id = null, cx = 0, cy = 0
  const R = 55
  joy.addEventListener('touchstart', e => { const t = e.changedTouches[0]; id = t.identifier; const r = joy.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; e.preventDefault() }, { passive: false })
  joy.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) if (t.identifier === id) {
      let dx = t.clientX - cx, dy = t.clientY - cy
      const d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d }
      thumb.style.transform = `translate(${dx}px,${dy}px)`
      setJoystick(dx / R, -dy / R)
    }
    e.preventDefault()
  }, { passive: false })
  const end = e => { for (const t of e.changedTouches) if (t.identifier === id) { id = null; thumb.style.transform = ''; setJoystick(0, 0) } }
  joy.addEventListener('touchend', end); joy.addEventListener('touchcancel', end)

  // 右半屏拖拽转视角
  const look = el('div', 'look-zone'); look.style.pointerEvents = 'auto'; overlay.appendChild(look)
  let lid = null, lx = 0, ly = 0
  look.addEventListener('touchstart', e => { const t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; ly = t.clientY; e.preventDefault() }, { passive: false })
  look.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) if (t.identifier === lid) { addLook((t.clientX - lx) * 1.2, (t.clientY - ly) * 1.2); lx = t.clientX; ly = t.clientY }
    e.preventDefault()
  }, { passive: false })
  look.addEventListener('touchend', e => { for (const t of e.changedTouches) if (t.identifier === lid) lid = null })
}

// ---------------- 全局事件 ----------------
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
