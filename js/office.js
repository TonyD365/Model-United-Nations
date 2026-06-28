// 各国办公室：大厅之外的独立封闭房间。墙上国旗、办公桌、靠墙豪华椅、对面2把来宾椅、可签字文件。
import * as THREE from 'three'
import { palette } from './config.js'
import { scene } from './scene.js'
import { SEATS, COLLIDERS } from './hall.js'
import { flagOf, COUNTRY_BY_ISO } from './countries.js'
import { flagTexture } from './flags.js'

const COLS = 10
const CELL_W = 8      // 单元宽(x)
const CELL_D = 10     // 单元深(z)
const ORIGIN_X = 50
const ORIGIN_Z = -20
const RW = 6.4        // 房间内宽
const RD = 8.0        // 房间内深
const WALL_H = 4.6    // 加高墙体
const DOOR_W = 2.0    // 门洞宽
const DOOR_H = 3.0    // 门高
export const OFFICE_MAX = 50

// 可签字文件网格（供射线拾取）：userData.signDoc
export const DOCUMENTS = []

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, ...o })
const flagSprites = {}   // booth -> sprite (墙上国旗)
const nameSprites = {}   // booth -> sprite (门牌名)
const doors = []         // {pivot, center, open} 自动开合的门

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
    // 前墙(-X) 两段，中间留门洞
    const seg = (RD - DOOR_W) / 2
    g.add(wall(0.2, WALL_H, seg, -RW / 2, WALL_H / 2, -(RD / 2) + seg / 2, wallMat))
    g.add(wall(0.2, WALL_H, seg, -RW / 2, WALL_H / 2, (RD / 2) - seg / 2, wallMat))
    // 门楣（门洞上方过梁）
    g.add(wall(0.2, WALL_H - DOOR_H, DOOR_W, -RW / 2, DOOR_H + (WALL_H - DOOR_H) / 2, 0, wallMat))

    // 踢脚线 / 墙裙（深色木饰）
    const baseMat = mat(0x5a4632, { roughness: 0.7 })
    g.add(wall(0.24, 0.3, RD, RW / 2 - 0.02, 0.15, 0, baseMat))
    g.add(wall(RW, 0.3, 0.24, 0, 0.15, -RD / 2 + 0.02, baseMat))
    g.add(wall(RW, 0.3, 0.24, 0, 0.15, RD / 2 - 0.02, baseMat))

    // 天花板
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), mat(0xdcd6c4, { roughness: 1 }))
    ceil.rotation.x = Math.PI / 2; ceil.position.y = WALL_H - 0.02; g.add(ceil)
    // 顶灯（发光面板）
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 1.6),
      new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff2d6, emissiveIntensity: 0.9, roughness: 0.5 }))
    lamp.position.set(0.4, WALL_H - 0.12, 0); g.add(lamp)

    // 精美闭合门（铰接在 +Z 门柱，向房内开）
    g.add(makeDoor(i, c, -RW / 2, seg))

    // 墙体碰撞(AABB)
    pushBox(c.x + RW / 2, c.z, 0.2, RD)
    pushBox(c.x, c.z - RD / 2, RW, 0.2)
    pushBox(c.x, c.z + RD / 2, RW, 0.2)
    // 前墙两段碰撞（门洞处不挡，门是装饰）
    pushBox(c.x - RW / 2, c.z - (RD / 2) + seg / 2, 0.2, seg)
    pushBox(c.x - RW / 2, c.z + (RD / 2) - seg / 2, 0.2, seg)

    // 办公桌靠后墙：窄边朝里(X)、长边沿墙(Z)。桌中心 x=1.7
    const DX = 1.7
    const desk = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 2.4), mat(palette.desk))
    desk.position.set(DX, 0.45, 0); desk.castShadow = true; g.add(desk)
    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 2.5), mat(palette.deskTop))
    deskTop.position.set(DX, 0.92, 0); g.add(deskTop)
    pushBox(c.x + DX, c.z, 0.9, 2.4)   // 桌子碰撞(贴合)

    // 行政豪华椅：在桌与后墙之间(x=2.6)，面向房门 -X
    const lux = makeLuxChair()
    lux.position.set(2.6, 0, 0); lux.rotation.y = Math.PI; g.add(lux)
    registerSeat('oL' + i, c.x + 2.6, c.z, -Math.PI / 2)

    // 对面 2 把来宾椅(x=0.6)，面向办公桌 +X
    ;[-0.9, 0.9].forEach((dz, k) => {
      const ch = makeGuestChair()
      ch.position.set(0.6, 0, dz); ch.rotation.y = 0; g.add(ch)
      registerSeat('oG' + i + '_' + k, c.x + 0.6, c.z + dz, Math.PI / 2)
    })

    // 桌上可签字文件（2 份）
    ;[-0.45, 0.45].forEach((dz, k) => {
      const paper = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.8), new THREE.MeshStandardMaterial({ color: 0xfdfdf5, roughness: 0.6 }))
      paper.position.set(DX, 0.97, dz); paper.rotation.y = Math.PI / 2 + 0.1 * k
      paper.userData.signDoc = k === 0 ? 'resolution' : 'treaty'
      paper.userData.booth = i
      g.add(paper); DOCUMENTS.push(paper)
    })

    // 角落盆栽
    const plant = makePlant()
    plant.position.set(RW / 2 - 0.6, 0, -RD / 2 + 0.6); g.add(plant)

    // 墙上国旗（真实 SVG 贴图的平面，贴在后墙朝向房间 -X）
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.8),
      new THREE.MeshBasicMaterial({ color: 0x1a1f1d }))
    flag.position.set(c.x + RW / 2 - 0.12, 2.35, c.z); flag.rotation.y = -Math.PI / 2
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

// 精美木门：铰接于门洞 +Z 侧门柱，靠近时自动内开
function makeDoor(i, c, frontX, seg) {
  const pivot = new THREE.Group()
  pivot.position.set(frontX, 0, DOOR_W / 2)   // 铰链在门洞 +Z 边

  const wood = mat(0x6b4a2a, { roughness: 0.6, metalness: 0.05 })
  const woodDark = mat(0x523619, { roughness: 0.6 })
  const gold = mat(palette.gold, { metalness: 0.7, roughness: 0.35 })

  // 门扇主体（厚 0.1，宽=DOOR_W，高=DOOR_H），中心偏向 -Z
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.1, DOOR_H, DOOR_W), wood)
  slab.position.set(0, DOOR_H / 2, -DOOR_W / 2); slab.castShadow = true
  pivot.add(slab)
  // 凹板装饰（两块）
  ;[DOOR_H * 0.66, DOOR_H * 0.3].forEach(py => {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.14, DOOR_H * 0.26, DOOR_W * 0.62), woodDark)
    panel.position.set(0, py, -DOOR_W / 2); pivot.add(panel)
  })
  // 金色门把手（靠 -Z 自由端）
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), gold)
  knob.position.set(-0.12, DOOR_H * 0.46, -DOOR_W + 0.25); pivot.add(knob)
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.12), gold)
  plate.position.set(-0.08, DOOR_H * 0.46, -DOOR_W + 0.25); pivot.add(plate)
  // 门框（贴门洞两侧 + 顶）
  const frameMat = mat(0x4a3318, { roughness: 0.7 })
  const fl = new THREE.Mesh(new THREE.BoxGeometry(0.28, DOOR_H + 0.1, 0.16), frameMat)
  fl.position.set(0.02, (DOOR_H + 0.1) / 2, 0.08); pivot.add(fl)

  doors.push({ pivot, cx: c.x + frontX, cz: c.z, open: 0 })
  return pivot
}

// 玩家靠近门洞时缓动开门；远离则关上。每帧调用。
export function updateDoors(pos) {
  for (const d of doors) {
    const dist = Math.hypot(pos.x - d.cx, pos.z - d.cz)
    const target = dist < 3.2 ? 1 : 0
    d.open += (target - d.open) * 0.15
    d.pivot.rotation.y = -d.open * 1.35   // 向房内(+X)开
  }
}

// 盆栽装饰
function makePlant() {
  const g = new THREE.Group()
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.34, 12), mat(0x8a5a3a, { roughness: 0.8 }))
  pot.position.y = 0.17; pot.castShadow = true
  const foliage = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 10), mat(0x2f6b3a, { roughness: 1 }))
  foliage.position.y = 0.7; foliage.scale.y = 1.3
  g.add(pot, foliage); return g
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

function setNameTag(spr, text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96
  const x = c.getContext('2d')
  x.fillStyle = '#0d1412'; x.fillRect(0, 0, 256, 96)
  x.fillStyle = '#fff'; x.font = 'bold 30px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'
  x.fillText((text || '').slice(0, 22), 128, 48)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  spr.material.map?.dispose(); spr.material.map = tex; spr.material.needsUpdate = true
}

// 按 roster 更新各办公室墙上国旗 + 国名
export function refreshOfficeSigns(roster) {
  const byBooth = {}
  for (const iso in roster) { const b = roster[iso].booth; if (b != null) byBooth[b] = iso }
  for (let i = 0; i < OFFICE_MAX; i++) {
    const iso = byBooth[i]
    const plane = flagSprites[i]
    if (plane) {
      if (iso) { plane.material.map = flagTexture(iso); plane.material.color.set(0xffffff) }
      else { plane.material.map = null; plane.material.color.set(0x1a1f1d) }
      plane.material.needsUpdate = true
    }
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
