// 本国办公室"办公区"：一排可走入的小隔间。走进谁的隔间 = 进入其语音区，可互访。
import * as THREE from 'three'
import { palette } from './config.js'
import { scene } from './scene.js'
import { flagOf, COUNTRY_BY_ISO } from './countries.js'

const COLS = 10
const CELL_W = 5
const CELL_D = 9
const ORIGIN_X = 30
const ORIGIN_Z = -8
export const OFFICE_MAX = 50

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, ...o })
const signByBooth = {}   // boothIndex -> sprite

export function boothCenter(i) {
  const col = i % COLS, row = Math.floor(i / COLS)
  return new THREE.Vector3(ORIGIN_X + col * CELL_W, 0, ORIGIN_Z + row * CELL_D)
}

export function buildOffices() {
  const root = new THREE.Group()
  // 办公区地面
  const cols = COLS, rows = Math.ceil(OFFICE_MAX / COLS)
  const w = cols * CELL_W + 4, d = rows * CELL_D + 4
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(0x2a2f34, { roughness: 1 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(ORIGIN_X + (cols - 1) * CELL_W / 2, 0.02, ORIGIN_Z + (rows - 1) * CELL_D / 2)
  floor.receiveShadow = true
  root.add(floor)

  // 入口指示（连接大厅与办公区的走廊牌）
  const label = makeSign('Country Offices →', 0xffffff, '#1f5c4a')
  label.position.set(26, 2.4, 6); label.scale.set(6, 1.5, 1)
  root.add(label)

  for (let i = 0; i < OFFICE_MAX; i++) {
    const c = boothCenter(i)
    const g = new THREE.Group(); g.position.copy(c)
    // 三面隔板
    const back = new THREE.Mesh(new THREE.BoxGeometry(CELL_W - 0.6, 2.4, 0.15), mat(palette.wall))
    back.position.set(0, 1.2, -CELL_D / 2 + 0.6)
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.4, CELL_D - 1.6), mat(palette.wall))
    left.position.set(-CELL_W / 2 + 0.3, 1.2, 0)
    const right = left.clone(); right.position.x = CELL_W / 2 - 0.3
    // 桌 + 椅 + 文件
    const desk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.9), mat(palette.desk))
    desk.position.set(0, 0.45, -2.4); desk.castShadow = true
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.9), mat(0xffffff))
    paper.position.set(0, 0.92, -2.4)
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), mat(0x333a40))
    chair.position.set(0, 0.25, -1.4)
    g.add(back, left, right, desk, paper, chair)
    root.add(g)
  }

  scene.add(root)
  return root
}

function makeSign(text, color = 0xffffff, bg = '#163d31') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64
  const x = c.getContext('2d')
  x.fillStyle = bg; x.fillRect(0, 0, 256, 64)
  x.fillStyle = '#fff'; x.font = 'bold 30px sans-serif'
  x.textAlign = 'center'; x.textBaseline = 'middle'
  x.fillText(text, 128, 34)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
  spr.scale.set(3, 0.75, 1)
  return spr
}

// 根据 roster 刷新各隔间的国家招牌
export function refreshOfficeSigns(roster) {
  // roster: iso -> { peerId, name, color, booth }
  const wanted = {}
  for (const iso in roster) {
    const b = roster[iso].booth
    if (b == null) continue
    wanted[b] = iso
  }
  // 移除不再需要的
  for (const b in signByBooth) {
    if (wanted[b] == null) { scene.remove(signByBooth[b]); delete signByBooth[b] }
  }
  // 添加/更新
  for (const b in wanted) {
    const iso = wanted[b]
    const country = COUNTRY_BY_ISO[iso]
    const txt = (country ? country.name : iso)
    if (!signByBooth[b]) {
      const s = makeSign(txt)
      const c = boothCenter(+b)
      s.position.set(c.x, 2.7, c.z - CELL_D / 2 + 0.7)
      scene.add(s)
      signByBooth[b] = s
      s.userData.iso = iso
    } else if (signByBooth[b].userData.iso !== iso) {
      scene.remove(signByBooth[b]); delete signByBooth[b]
      refreshOfficeSigns(roster); return
    }
  }
}

// 根据位置 + roster 判定当前语音区
export function zoneAt(pos, roster) {
  if (pos.x <= 27) return 'hall'
  const col = Math.round((pos.x - ORIGIN_X) / CELL_W)
  const row = Math.round((pos.z - ORIGIN_Z) / CELL_D)
  if (col < 0 || col >= COLS || row < 0) return 'hall'
  const i = row * COLS + col
  if (i < 0 || i >= OFFICE_MAX) return 'hall'
  // 该隔间归属哪个国家？
  for (const iso in roster) {
    if (roster[iso].booth === i) return 'office:' + iso
  }
  return 'office:empty' + i   // 空隔间：与大厅隔离但谁也听不到
}

// 给某玩家分配最小空闲隔间号
export function freeBooth(roster) {
  const used = new Set(Object.values(roster).map(r => r.booth).filter(b => b != null))
  for (let i = 0; i < OFFICE_MAX; i++) if (!used.has(i)) return i
  return null
}
