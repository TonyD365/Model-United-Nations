// 程序合成音效（无外部音频资源）：法槌、戏剧性"sting"、通过的钟声
let ctx = null
function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}
function tone(type, f0, f1, dur, peak, t0 = 0) {
  const c = ac(); const o = c.createOscillator(), g = c.createGain()
  o.type = type; const s = c.currentTime + t0
  o.frequency.setValueAtTime(f0, s)
  if (f1 != null) o.frequency.exponentialRampToValueAtTime(f1, s + dur)
  o.connect(g); g.connect(c.destination)
  g.gain.setValueAtTime(0.0001, s)
  g.gain.exponentialRampToValueAtTime(peak, s + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, s + dur)
  o.start(s); o.stop(s + dur + 0.02)
}
export function gavel() { tone('triangle', 95, 60, 0.16, 0.5); tone('triangle', 95, 60, 0.16, 0.5, 0.19) }
export function sting() { tone('sawtooth', 480, 150, 0.32, 0.35) }
export function thud() { tone('sine', 140, 50, 0.3, 0.4) }
export function chime() {[523, 659, 784].forEach((f, i) => tone('sine', f, f, 0.5, 0.25, i * 0.08)) }
export function resume() { try { ac() } catch {} }
