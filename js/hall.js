// 程序化建模联合国大会厅 + 注册座位 + 碰撞体
import * as THREE from 'three'
import { palette } from './config.js'
import { scene } from './scene.js'

// 座位注册表：{ id, position:Vector3, ry, rostrum, mesh }
export const SEATS = []
export const ROSTRUM_SEAT_IDS = []
// 碰撞圆柱：{ x, z, r }
export const COLLIDERS = []

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts })

function makeEmblemTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512
  const x = c.getContext('2d')
  x.fillStyle = '#3a6ea5'; x.fillRect(0, 0, 512, 512)
  x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = 2
  for (let r = 40; r < 256; r += 38) { x.beginPath(); x.arc(256, 256, r, 0, Math.PI * 2); x.stroke() }
  for (let a = 0; a < 12; a++) { x.beginPath(); x.moveTo(256, 256); x.lineTo(256 + 240 * Math.cos(a * Math.PI / 6), 256 + 240 * Math.sin(a * Math.PI / 6)); x.stroke() }
  x.strokeStyle = '#e8e1cf'; x.lineWidth = 10
  x.beginPath(); x.arc(256, 270, 210, Math.PI * 0.62, Math.PI * 0.38, false); x.stroke()
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeRostrumChair() {
  const g = new THREE.Group()
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.7), mat(0x6b4f2a)); seat.position.y = 0.42; seat.castShadow = true
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.15, 0.16), mat(0x5a4327)); back.position.set(0, 1.0, -0.3)
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.08, 0.76), new THREE.MeshStandardMaterial({ color: palette.gold, metalness: 0.5, roughness: 0.4 })); trim.position.y = 0.66
  g.add(seat, back, trim); return g
}

function seatMarker(id, pos, restricted) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 18),
    new THREE.MeshBasicMaterial({ color: restricted ? 0xffcc33 : 0x44ff99, transparent: true, opacity: 0 }))
  m.position.set(pos.x, pos.y + 0.04, pos.z)
  m.userData.seatId = id
  return m
}

export function buildHall() {
  const root = new THREE.Group()

  // 地面
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), mat(palette.carpet, { roughness: 1 }))
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true
  root.add(floor)
  // 中央走道
  const aisle = new THREE.Mesh(new THREE.PlaneGeometry(4, 36), mat(palette.carpetDark, { roughness: 1 }))
  aisle.rotation.x = -Math.PI / 2; aisle.position.set(0, 0.01, 6)
  root.add(aisle)

  // ---- 阶梯代表席（每座实心台座，面向 -Z 主席台；不再悬空）----
  const tiers = 4
  const seatsPerTier = [10, 12, 14, 16]
  const spread = Math.PI * 1.08
  const start = Math.PI / 2 + spread / 2
  let idx = 0
  for (let t = 0; t < tiers; t++) {
    const y = t * 0.6                 // 台阶高度
    const midR = 10 + t * 3.3         // 座位环半径
    const count = seatsPerTier[t]
    for (let i = 0; i < count; i++) {
      const a = start - (i + 0.5) * (spread / count)
      const rDesk = midR - 0.8, rChair = midR + 0.6
      const dx = Math.cos(a) * rDesk, dz = Math.sin(a) * rDesk
      const cx = Math.cos(a) * rChair, cz = Math.sin(a) * rChair
      const mx = Math.cos(a) * midR, mz = Math.sin(a) * midR
      const ry = Math.atan2(-cx, -cz)   // 面向圆心(主席台)

      // 实心台座：从地面 0 直达本层高度 y，桌椅落在其顶面（消除悬空）
      if (y > 0.01) {
        const ped = new THREE.Mesh(new THREE.BoxGeometry(3.7, y, 3.5), mat(palette.carpetDark, { roughness: 1 }))
        ped.position.set(mx, y / 2, mz); ped.rotation.y = ry; ped.receiveShadow = true
        root.add(ped)
      }
      // 桌
      const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.85, 0.75), mat(palette.desk))
      desk.position.set(dx, y + 0.43, dz); desk.rotation.y = ry; desk.castShadow = true
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 0.85), mat(palette.deskTop))
      top.position.set(dx, y + 0.9, dz); top.rotation.y = ry
      // 椅（椅背朝外，坐者面向主席台）
      const chair = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.55), mat(0x33414a))
      chair.position.set(cx, y + 0.25, cz); chair.rotation.y = ry
      const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.1), mat(0x2a363d))
      chairBack.position.set(cx - Math.sin(ry) * 0.28, y + 0.6, cz - Math.cos(ry) * 0.28); chairBack.rotation.y = ry
      root.add(desk, top, chair, chairBack)

      const seatPos = new THREE.Vector3(cx, y, cz)
      const marker = seatMarker('s' + idx, seatPos, false)
      root.add(marker)
      SEATS.push({ id: 's' + idx, position: seatPos.clone(), ry, rostrum: false, mesh: marker })
      // 不给每张桌子加碰撞（否则代表被困在座位环里走不动；落座靠点击座位）
      idx++
    }
  }

  // ---- 中央主席台（presiding rostrum）----
  const gold = mat(palette.gold, { metalness: 0.5, roughness: 0.4 })
  const wood = mat(0x5a4327)
  // 两级台基（前向台阶）
  const base0 = new THREE.Mesh(new THREE.BoxGeometry(15, 0.75, 4.4), mat(palette.rostrum))
  base0.position.set(0, 0.375, -13); base0.receiveShadow = true; root.add(base0)
  const base1 = new THREE.Mesh(new THREE.BoxGeometry(12.5, 0.75, 3.4), mat(palette.rostrum))
  base1.position.set(0, 1.125, -13.4); base1.receiveShadow = true; root.add(base1)
  const ROST_Y = 1.5
  // 主席长桌（朝 +Z），坐者从桌后看向会场
  const bench = new THREE.Mesh(new THREE.BoxGeometry(11, 1.0, 0.8), wood)
  bench.position.set(0, ROST_Y + 0.5, -12.0); bench.castShadow = true; root.add(bench)
  const benchTop = new THREE.Mesh(new THREE.BoxGeometry(11.3, 0.1, 1.0), gold)
  benchTop.position.set(0, ROST_Y + 1.0, -12.0); root.add(benchTop)
  const benchEmblem = new THREE.Mesh(new THREE.CircleGeometry(0.62, 32),
    new THREE.MeshStandardMaterial({ map: makeEmblemTexture(), roughness: 0.6 }))
  benchEmblem.position.set(0, ROST_Y + 0.5, -11.58); root.add(benchEmblem)
  // 演讲台（台前地面，代表发言用）
  const podium = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.85, 1.3, 6), wood)
  podium.position.set(0, 0.65, -9); podium.castShadow = true; root.add(podium)
  const podTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.8), gold)
  podTop.position.set(0, 1.32, -9); podTop.rotation.x = -0.2; root.add(podTop)
  // 碰撞：台体方块 + 演讲台
  COLLIDERS.push({ minX: -7.6, maxX: 7.6, minZ: -15.6, maxZ: -11.3 })
  COLLIDERS.push({ x: 0, z: -9, r: 0.95 })

  // 主席台 3 个高位（主席居中 + 2 副），面向 +Z（朝代表）
  ;[-3.4, 0, 3.4].forEach((rx, i) => {
    const ch = makeRostrumChair()
    ch.position.set(rx, ROST_Y, -13.5); root.add(ch)
    const pos = new THREE.Vector3(rx, ROST_Y, -13.5)
    const marker = seatMarker('r' + i, new THREE.Vector3(rx, ROST_Y + 1.0, -13.5), true)
    root.add(marker)
    SEATS.push({ id: 'r' + i, position: pos.clone(), ry: 0, rostrum: true, mesh: marker })
    ROSTRUM_SEAT_IDS.push('r' + i)
  })

  // ---- 背景墙 + 徽标 ----
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(20, 20, 16, 48, 1, true, Math.PI * 0.66, Math.PI * 0.68),
    mat(palette.wall, { side: THREE.DoubleSide }))
  wall.position.set(0, 8, -2); root.add(wall)
  const emblem = new THREE.Mesh(new THREE.CircleGeometry(4.5, 48),
    new THREE.MeshStandardMaterial({ map: makeEmblemTexture(), roughness: 0.6 }))
  emblem.position.set(0, 8.5, -19.4); root.add(emblem)

  // ---- 金色穹顶 ----
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(36, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: palette.goldDark, side: THREE.BackSide, metalness: 0.5, roughness: 0.6 }))
  root.add(dome)
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 18), mat(palette.gold, { metalness: 0.6, roughness: 0.4 }))
    spoke.position.set(Math.cos(a) * 9, 15, Math.sin(a) * 9); spoke.rotation.y = -a
    root.add(spoke)
  }
  const oculus = new THREE.Mesh(new THREE.CircleGeometry(3, 32), mat(0x111511))
  oculus.rotation.x = Math.PI / 2; oculus.position.y = 16.5; root.add(oculus)

  scene.add(root)
  return root
}
