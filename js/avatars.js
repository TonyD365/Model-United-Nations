// 真实骨骼动画人物（RobotExpressive, CC0）+ 头顶昵称牌 + 远端插值 + 走/坐动画
import * as THREE from 'three'
import { GLTFLoader, cloneSkeleton } from 'three-addons'
import { scene } from './scene.js'
import { CHARACTER_STYLES, DEFAULT_STYLE } from './config.js'

const styleById = id => CHARACTER_STYLES.find(s => s.id === id) || CHARACTER_STYLES.find(s => s.id === DEFAULT_STYLE)

const avatars = {}            // peerId -> avatar 对象
let base = null               // { scene, animations, scale, yOffset }
let ready = false
const pendingBuilders = []

// 预加载角色模型（main.js 启动时调用）
export function loadCharacter(url = './assets/models/character.glb') {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, gltf => {
      const root = gltf.scene
      // 计算缩放，使身高 ≈ 1.7m，并把脚底对齐到 y=0
      const box = new THREE.Box3().setFromObject(root)
      const size = new THREE.Vector3(); box.getSize(size)
      const scale = 1.7 / (size.y || 1)
      base = { scene: root, animations: gltf.animations, scale, minY: box.min.y }
      ready = true
      pendingBuilders.splice(0).forEach(fn => fn())
      resolve(true)
    }, undefined, err => { console.error('model load failed', err); reject(err) })
  })
}
export function characterReady() { return ready }

function makeNameSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64
  const x = c.getContext('2d')
  x.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(x, 8, 8, 240, 48, 10); x.fill()
  x.fillStyle = color || '#fff'; x.font = 'bold 28px sans-serif'
  x.textAlign = 'center'; x.textBaseline = 'middle'
  x.fillText((text || '???').slice(0, 16), 128, 34)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  spr.scale.set(1.9, 0.48, 1); spr.position.y = 2.15
  return spr
}
function roundRect(x, px, py, w, h, r) {
  x.beginPath(); x.moveTo(px + r, py)
  x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r)
  x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath()
}

function buildModelInto(a, color, styleId) {
  const style = styleById(styleId)
  const bodyTint = new THREE.Color(style.tint)
  const model = cloneSkeleton(base.scene)
  model.scale.setScalar(base.scale)
  model.position.y = -base.minY * base.scale     // 脚底贴地
  model.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true
      // 克隆材质并按所选外观染色（再混入代表色一点点）
      if (o.material) {
        o.material = o.material.clone()
        if (o.material.color) {
          o.material.color.lerp(bodyTint, 0.55)
          if (color) o.material.color.lerp(new THREE.Color(color), 0.12)
        }
      }
    }
  })
  a.group.add(model)
  a.model = model
  // 头部配件（程序化）
  const acc = makeAccessory(style.accent)
  if (acc) { a.group.add(acc); a.accessory = acc }
  // 动画
  a.mixer = new THREE.AnimationMixer(model)
  a.actions = {}
  for (const [key, name] of [['idle', 'Idle'], ['walk', 'Walking'], ['sit', 'Sitting']]) {
    const clip = THREE.AnimationClip.findByName(base.animations, name)
    if (clip) a.actions[key] = a.mixer.clipAction(clip)
  }
  a.cur = null
  playAnim(a, 'idle')
}

function playAnim(a, name) {
  if (!a.actions || a.cur === name || !a.actions[name]) return
  const next = a.actions[name]
  next.reset().setEffectiveWeight(1).fadeIn(0.2).play()
  if (a.cur && a.actions[a.cur]) a.actions[a.cur].fadeOut(0.2)
  a.cur = name
}

// 程序化头部/身体配件（不依赖外部模型，使外观更易区分）
function makeAccessory(accent) {
  if (!accent || accent === 'none') return null
  const g = new THREE.Group()
  const HEAD_Y = 1.62          // 头顶大致高度（米）
  const mm = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o })
  if (accent === 'tophat') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 20), mm(0x15151c))
    brim.position.y = HEAD_Y + 0.04
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.32, 20), mm(0x15151c))
    crown.position.y = HEAD_Y + 0.21
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.07, 20), mm(0x7a1f2a))
    band.position.y = HEAD_Y + 0.08
    g.add(brim, crown, band)
  } else if (accent === 'cap') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mm(0x1f6f8b))
    dome.position.y = HEAD_Y + 0.02
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.2), mm(0x14586e))
    peak.position.set(0, HEAD_Y + 0.02, -0.24)
    g.add(dome, peak)
  } else if (accent === 'beret') {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.08, 18), mm(0x7a3b9c))
    cap.position.y = HEAD_Y + 0.08; cap.rotation.z = 0.12
    const nub = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), mm(0x4a205f))
    nub.position.y = HEAD_Y + 0.14
    g.add(cap, nub)
  } else if (accent === 'crown') {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 18), mm(0xc9a227, { metalness: 0.7, roughness: 0.3 }))
    band.position.y = HEAD_Y + 0.12
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 8), mm(0xd9b94a, { metalness: 0.7, roughness: 0.3 }))
      spike.position.set(Math.cos(a) * 0.18, HEAD_Y + 0.22, Math.sin(a) * 0.18)
      g.add(spike)
    }
    g.add(band)
  } else if (accent === 'tie') {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.04), mm(0xb31f2a))
    tie.position.set(0, 1.02, 0.13); g.add(tie)
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.05), mm(0x8a141d))
    knot.position.set(0, 1.2, 0.13); g.add(knot)
  } else if (accent === 'sash') {
    const sash = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), mm(0xe8d27a, { metalness: 0.3 }))
    sash.position.y = 1.0; sash.rotation.y = Math.PI / 4; sash.rotation.x = Math.PI / 2.6
    g.add(sash)
  }
  return g
}

export function spawnAvatar(peerId, { name, color, style }) {
  if (avatars[peerId]) return avatars[peerId]
  const group = new THREE.Group()
  // 代表色脚环
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.46, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color || '#ccc'), transparent: true, opacity: 0.85, side: THREE.DoubleSide }))
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02
  group.add(ring)
  const nameSprite = makeNameSprite(name, color)
  group.add(nameSprite)
  scene.add(group)

  const a = {
    group, nameSprite, model: null, mixer: null, actions: null, cur: null,
    anim: 0, seated: false,
    target: { x: 0, y: 0, z: 0, ry: 0 },
  }
  avatars[peerId] = a
  if (ready) buildModelInto(a, color, style)
  else pendingBuilders.push(() => buildModelInto(a, color, style))
  return a
}

export function removeAvatar(peerId) {
  const a = avatars[peerId]; if (!a) return
  scene.remove(a.group)
  a.nameSprite.material.map?.dispose()
  delete avatars[peerId]
}

// 头顶语音气泡（庭审式发言）
function makeBubbleSprite(text) {
  const W = 320, lh = 30, pad = 16
  const c = document.createElement('canvas'); const x = c.getContext('2d')
  x.font = '22px sans-serif'
  const words = String(text).split(/\s+/); const lines = []; let cur = ''
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > W - pad * 2 && cur) { lines.push(cur); cur = w } else cur = t }
  if (cur) lines.push(cur)
  const show = lines.slice(0, 4)
  c.width = W; c.height = show.length * lh + pad * 2 + 12
  const x2 = c.getContext('2d')
  x2.fillStyle = 'rgba(248,248,242,0.97)'; roundRect(x2, 4, 4, W - 8, show.length * lh + pad * 2, 14); x2.fill()
  x2.beginPath(); x2.moveTo(W / 2 - 12, c.height - 14); x2.lineTo(W / 2 + 12, c.height - 14); x2.lineTo(W / 2, c.height - 2); x2.closePath(); x2.fill()
  x2.fillStyle = '#16201c'; x2.font = '22px sans-serif'; x2.textBaseline = 'top'
  show.forEach((l, i) => x2.fillText(l, pad, pad + i * lh))
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  spr.scale.set(W / 90, c.height / 90, 1)
  return spr
}
export function showBubble(peerId, text) {
  const a = avatars[peerId]; if (!a) return
  if (a.bubble) { a.group.remove(a.bubble); a.bubble.material.map?.dispose() }
  const spr = makeBubbleSprite(text); spr.position.y = 2.7
  a.group.add(spr); a.bubble = spr
  clearTimeout(a.bubbleT)
  a.bubbleT = setTimeout(() => { if (a.bubble === spr) { a.group.remove(spr); spr.material.map?.dispose(); a.bubble = null } }, 5500)
}

export function getAvatar(peerId) { return avatars[peerId] }
export function avatarPosition(peerId) { const a = avatars[peerId]; return a ? a.group.position : null }

export function setAvatarName(peerId, name, color) {
  const a = avatars[peerId]; if (!a) return
  a.group.remove(a.nameSprite); a.nameSprite.material.map?.dispose()
  a.nameSprite = makeNameSprite(name, color); a.group.add(a.nameSprite)
}

export function setAvatarTarget(peerId, t) {
  const a = avatars[peerId]; if (!a) return
  a.target.x = t.x; a.target.y = t.y; a.target.z = t.z; a.target.ry = t.ry
  a.anim = t.anim || 0
}
export function setAvatarSeated(peerId, seated) { const a = avatars[peerId]; if (a) a.seated = seated }
export function setSelfAnim(peerId, anim, seated) {
  const a = avatars[peerId]; if (!a) return
  a.anim = anim; a.seated = seated
}

export function placeAvatar(peerId, x, y, z, ry) {
  const a = avatars[peerId]; if (!a) return
  a.group.position.set(x, y, z); a.group.rotation.y = ry
  a.target = { x, y, z, ry }
}

// 每帧：插值远端 + 推进动画 + 切换 idle/walk/sit
export function updateAvatars(dt, selfId) {
  for (const id in avatars) {
    const a = avatars[id]
    if (id !== selfId) {
      const p = a.group.position, k = Math.min(1, dt * 12)
      p.x += (a.target.x - p.x) * k
      p.y += (a.target.y - p.y) * k
      p.z += (a.target.z - p.z) * k
      let dr = a.target.ry - a.group.rotation.y
      while (dr > Math.PI) dr -= Math.PI * 2
      while (dr < -Math.PI) dr += Math.PI * 2
      a.group.rotation.y += dr * k
    }
    const want = a.seated ? 'sit' : (a.anim === 1 ? 'walk' : 'idle')
    playAnim(a, want)
    a.mixer && a.mixer.update(dt)
  }
}
