// 程序化方块角色（类 Roblox）+ 头顶昵称牌 + 远端插值
import * as THREE from 'three'
import { scene } from './scene.js'

const avatars = {}   // peerId -> { group, parts, target, nameSprite, anim }

function makeNameSprite(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64
  const x = c.getContext('2d')
  x.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(x, 8, 8, 240, 48, 10); x.fill()
  x.fillStyle = '#fff'; x.font = 'bold 28px sans-serif'
  x.textAlign = 'center'; x.textBaseline = 'middle'
  x.fillText(text.slice(0, 16), 128, 34)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  spr.scale.set(1.8, 0.45, 1)
  spr.position.y = 2.25
  return spr
}
function roundRect(x, px, py, w, h, r) {
  x.beginPath(); x.moveTo(px + r, py)
  x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r)
  x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath()
}

function buildBody(colorStr) {
  const g = new THREE.Group()
  const skin = new THREE.MeshStandardMaterial({ color: 0xf1c8a0, roughness: 0.8 })
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorStr), roughness: 0.7 })
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.8 })

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.35), body)
  torso.position.y = 1.1; torso.castShadow = true
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), skin)
  head.position.y = 1.68; head.castShadow = true

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.16), body)
  armL.position.set(-0.4, 1.15, 0); armL.geometry.translate(0, -0.3, 0); armL.position.y = 1.45
  const armR = armL.clone(); armR.position.x = 0.4

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.18), legMat)
  legL.geometry.translate(0, -0.35, 0); legL.position.set(-0.15, 0.75, 0); legL.castShadow = true
  const legR = legL.clone(); legR.position.x = 0.15

  g.add(torso, head, armL, armR, legL, legR)
  return { group: g, parts: { armL, armR, legL, legR } }
}

export function spawnAvatar(peerId, { name, color }) {
  if (avatars[peerId]) return avatars[peerId]
  const { group, parts } = buildBody(color || '#cccccc')
  const nameSprite = makeNameSprite(name || '???')
  group.add(nameSprite)
  scene.add(group)
  const a = {
    group, parts, nameSprite, anim: 0, walkT: 0,
    target: { x: group.position.x, y: 0, z: group.position.z, ry: 0 },
  }
  avatars[peerId] = a
  return a
}

export function removeAvatar(peerId) {
  const a = avatars[peerId]; if (!a) return
  scene.remove(a.group)
  a.nameSprite.material.map.dispose()
  delete avatars[peerId]
}

export function getAvatar(peerId) { return avatars[peerId] }
export function avatarPosition(peerId) {
  const a = avatars[peerId]; return a ? a.group.position : null
}

export function setAvatarName(peerId, name) {
  const a = avatars[peerId]; if (!a) return
  a.group.remove(a.nameSprite)
  a.nameSprite.material.map.dispose()
  a.nameSprite = makeNameSprite(name)
  a.group.add(a.nameSprite)
}

// 远端更新目标（来自 world 广播）
export function setAvatarTarget(peerId, t) {
  const a = avatars[peerId]; if (!a) return
  a.target.x = t.x; a.target.y = t.y; a.target.z = t.z; a.target.ry = t.ry
  a.anim = t.anim || 0
}

// 直接放置（落座/快照初始）
export function placeAvatar(peerId, x, y, z, ry) {
  const a = avatars[peerId]; if (!a) return
  a.group.position.set(x, y, z); a.group.rotation.y = ry
  a.target = { x, y, z, ry }
}

// 每帧插值所有远端 avatar（自己的 avatar 由 player.js 直接驱动，不在此列）
export function updateAvatars(dt, selfId) {
  for (const id in avatars) {
    const a = avatars[id]
    if (id !== selfId) {
      const p = a.group.position
      p.x += (a.target.x - p.x) * Math.min(1, dt * 12)
      p.y += (a.target.y - p.y) * Math.min(1, dt * 12)
      p.z += (a.target.z - p.z) * Math.min(1, dt * 12)
      let dr = a.target.ry - a.group.rotation.y
      while (dr > Math.PI) dr -= Math.PI * 2
      while (dr < -Math.PI) dr += Math.PI * 2
      a.group.rotation.y += dr * Math.min(1, dt * 12)
    }
    // 走路摆动
    if (a.anim === 1) {
      a.walkT += dt * 9
      const s = Math.sin(a.walkT) * 0.5
      a.parts.legL.rotation.x = s; a.parts.legR.rotation.x = -s
      a.parts.armL.rotation.x = -s; a.parts.armR.rotation.x = s
    } else {
      for (const k of ['legL', 'legR', 'armL', 'armR'])
        a.parts[k].rotation.x *= (1 - Math.min(1, dt * 8))
    }
  }
}
