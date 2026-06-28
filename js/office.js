// 各国办公室：大厅之外的独立封闭房间。墙上国旗、办公桌、靠墙豪华椅、对面2把来宾椅、可签字文件。
import * as THREE from 'three'
import { palette } from './config.js'
import { scene } from './scene.js'
import { SEATS, COLLIDERS } from './hall.js'
import { flagOf, COUNTRY_BY_ISO } from './countries.js'

const COLS = 10
const CELL_W = 8      // 单元宽(x)
const CELL_D = 10     // 单元深(z)
const ORIGIN_X = 50
const ORIGIN_Z = -20
const RW = 6.4        // 房间内宽
const RD = 8.0        // 房间内深
const WALL_H = 3.2
export const OFFICE_MAX = 50

// 可签字文件网格（供射线拾取）：userData.signDoc
export const DOCUMENTS = []

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, ...o })
const flagSprites = {}   // booth -> sprite (墙上国旗)
const nameSprites = {}   // booth -> sprite (门牌名)

export function boothCenter(i) {
  const col = i % COLS, row = Math.floor(i / COLS)
  return new THREE.Vector3(ORIGIN_X + col * CELL_W, 0, ORIGIN_Z + row * CELL_D)
}

function wall(w, h, d, x, y, z, m) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true
  return mesh
}

export function buildOffices() {
  const root = new THREE.Group()
  const rows = Math.ceil(OFFICE_MAX / COLS)
  // 办公区地面
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(COLS * CELL_W + 8, rows * CELL_D + 8),
    mat(0x2b3036, { roughness: 1 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(ORIGIN_X + (COLS - 1) * CELL_W / 2, 0.015, ORIGIN_Z + (rows - 1) * CELL_D / 2)
  floor.receiveShadow = true
  root.add(floor)

  // 走廊指示
  const sign = makeTextSprite('◀ Hall    Country Offices', '#1f5c4a')
  sign.position.set(ORIGIN_X - 6, 2.6, ORIGIN_Z - 6); sign.scale.set(8, 1.4, 1)
  root.add(sign)

  const wallMat = mat(palette.wall)
  const carpet = mat(0x3a4a44, { roughness: 1 })

  for (let i = 0; i < OFFICE_MAX; i++) {
    const c = boothCenter(i)
    const g = new THREE.Group(); g.position.copy(c); root.add(g)

    // 房间地毯
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), carpet)
    rug.rotation.x = -Math.PI / 2; rug.position.y = 0.03; g.add(rug)

    // 墙：后墙(+X)、两侧(z±)、前墙(-X)留门洞
    g.add(wall(0.2, WALL_H, RD, RW / 2, WALL_H / 2, 0, wallMat))            // 后墙(+X)
    g.add(wall(RW, WALL_H, 0.2, 0, WALL_H / 2, -RD / 2, wallMat))           // 侧墙 -Z
    g.add(wall(RW, WALL_H, 0.2, 0, WALL_H / 2, RD / 2, wallMat))            // 侧墙 +Z
    // 前墙(-X) 两段，中间留 2m 门洞
    const seg = (RD - 2) / 2
    g.add(wall(0.2, WALL_H, seg, -RW / 2, WALL_H / 2, -(RD / 2) + seg / 2, wallMat))
    g.add(wall(0.2, WALL_H, seg, -RW / 2, WALL_H / 2, (RD / 2) - seg / 2, wallMat))

    // 墙体碰撞(AABB)
    pushBox(c.x + RW / 2, c.z, 0.2, RD)
    pushBox(c.x, c.z - RD / 2, RW, 0.2)
    pushBox(c.x, c.z + RD / 2, RW, 0.2)

    // 办公桌靠后墙
    const desk = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 1.0), mat(palette.desk))
    desk.position.set(RW / 2 - 1.1, 0.45, 0); desk.castShadow = true; g.add(desk)
    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.08, 1.1), mat(palette.deskTop))
    deskTop.position.set(RW / 2 - 1.1, 0.92, 0); g.add(deskTop)
    COLLIDERS.push({ x: c.x + RW / 2 - 1.1, z: c.z, r: 0.9 })

    // 靠墙豪华座椅（朝门 -X），注册为可坐席位 oL{i}
    const lux = makeLuxChair()
    lux.position.set(RW / 2 - 0.4, 0, 0); lux.rotation.y = -Math.PI / 2; g.add(lux)
    registerSeat('oL' + i, c.x + RW / 2 - 0.5, c.z, -Math.PI / 2)

    // 对面 2 把来宾椅（朝桌 +X）
    ;[-0.9, 0.9].forEach((dz, k) => {
      const ch = makeGuestChair()
      ch.position.set(RW / 2 - 3.0, 0, dz); ch.rotation.y = Math.PI / 2; g.add(ch)
      registerSeat('oG' + i + '_' + k, c.x + RW / 2 - 3.0, c.z + dz, Math.PI / 2)
    })

    // 桌上可签字文件（2 份）
    ;[-0.5, 0.4].forEach((dz, k) => {
      const paper = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.8), new THREE.MeshStandardMaterial({ color: 0xfdfdf5, roughness: 0.6 }))
      paper.position.set(RW / 2 - 1.1, 0.98, dz); paper.rotation.y = 0.1 * k
      paper.userData.signDoc = k === 0 ? 'resolution' : 'treaty'
      paper.userData.booth = i
      g.add(paper); DOCUMENTS.push(paper)
    })

    // 墙上国旗占位（refreshOfficeSigns 时填充）
    const flag = makeTextSprite('🏳️', '#222')
    flag.position.set(c.x + RW / 2 - 0.2, 2.1, c.z); flag.scale.set(2.4, 1.6, 1)
    flag.material.rotation = 0
    scene.add(flag); flagSprites[i] = flag
  }

  scene.add(root)
  return root
}

function makeLuxChair() {
  const g = new THREE.Group()
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), mat(0x6b1f2a))
  seat.position.y = 0.45; seat.castShadow = true
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.18), mat(0x7a2531))
  back.position.set(-0.26, 1.0, 0)
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.1, 0.74), mat(palette.gold, { metalness: 0.5, roughness: 0.4 }))
  trim.position.y = 0.72
  g.add(seat, back, trim); return g
}
function makeGuestChair() {
  const g = new THREE.Group()
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.55), mat(0x33414a))
  seat.position.y = 0.4; seat.castShadow = true
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.12), mat(0x2a363d))
  back.position.set(-0.21, 0.78, 0)
  g.add(seat, back); return g
}

function registerSeat(id, x, z, ry) {
  const pos = new THREE.Vector3(x, 0, z)
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 16),
    new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0 }))
  m.position.set(x, 0.05, z); m.userData.seatId = id
  scene.add(m)
  SEATS.push({ id, position: pos, ry, rostrum: false, office: true, mesh: m })
}

function pushBox(cx, cz, w, d) {
  COLLIDERS.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 })
}

function makeTextSprite(text, bg = '#163d31') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128
  const x = c.getContext('2d')
  x.fillStyle = bg; x.fillRect(0, 0, 256, 128)
  x.fillStyle = '#fff'; x.font = '64px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'
  x.fillText(text, 128, 64)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
}

function setFlagSprite(spr, country) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160
  const x = c.getContext('2d')
  x.fillStyle = '#0d1412'; x.fillRect(0, 0, 256, 160)
  x.font = '96px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'
  x.fillText(country ? country.flag : '🏳️', 128, 64)
  x.fillStyle = '#fff'; x.font = 'bold 26px sans-serif'
  x.fillText(country ? country.name : '', 128, 132)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  spr.material.map?.dispose(); spr.material.map = tex; spr.material.needsUpdate = true
}

// 按 roster 更新各办公室墙上国旗
export function refreshOfficeSigns(roster) {
  const byBooth = {}
  for (const iso in roster) { const b = roster[iso].booth; if (b != null) byBooth[b] = iso }
  for (let i = 0; i < OFFICE_MAX; i++) {
    const iso = byBooth[i]
    if (flagSprites[i]) setFlagSprite(flagSprites[i], iso ? COUNTRY_BY_ISO[iso] : null)
  }
}

// 位置 → 语音区
export function zoneAt(pos, roster) {
  if (pos.x < ORIGIN_X - CELL_W / 2) return 'hall'
  const col = Math.round((pos.x - ORIGIN_X) / CELL_W)
  const row = Math.round((pos.z - ORIGIN_Z) / CELL_D)
  if (col < 0 || col >= COLS || row < 0) return 'hall'
  const i = row * COLS + col
  if (i < 0 || i >= OFFICE_MAX) return 'hall'
  for (const iso in roster) if (roster[iso].booth === i) return 'office:' + iso
  return 'office:empty' + i
}

export function freeBooth(roster) {
  const used = new Set(Object.values(roster).map(r => r.booth).filter(b => b != null))
  for (let i = 0; i < OFFICE_MAX; i++) if (!used.has(i)) return i
  return null
}
