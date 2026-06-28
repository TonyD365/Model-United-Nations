// 程序化建模联合国大会厅 + 注册座位
import * as THREE from 'three'
import { palette } from './config.js'
import { scene } from './scene.js'

// 座位注册表：{ id, position:Vector3, ry:number, rostrum:bool, mesh }
export const SEATS = []
export const ROSTRUM_SEAT_IDS = []

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts })

function makeEmblemTexture() {
  // 程序绘制 UN 徽标风格：橄榄枝环 + 地图圆盘
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const x = c.getContext('2d')
  x.fillStyle = '#3a6ea5'; x.fillRect(0, 0, 512, 512)
  // 极投影网格
  x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = 2
  for (let r = 40; r < 256; r += 38) { x.beginPath(); x.arc(256, 256, r, 0, Math.PI * 2); x.stroke() }
  for (let a = 0; a < 12; a++) {
    x.beginPath(); x.moveTo(256, 256)
    x.lineTo(256 + 240 * Math.cos(a * Math.PI / 6), 256 + 240 * Math.sin(a * Math.PI / 6)); x.stroke()
  }
  // 橄榄枝环
  x.strokeStyle = '#e8e1cf'; x.lineWidth = 10
  x.beginPath(); x.arc(256, 270, 210, Math.PI * 0.62, Math.PI * 0.38, false); x.stroke()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function buildHall() {
  const root = new THREE.Group()

  // 地面
  const floor = new THREE.Mesh(new THREE.CircleGeometry(38, 64), mat(palette.carpet, { roughness: 1 }))
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  root.add(floor)

  // 中央地毯走道
  const aisle = new THREE.Mesh(new THREE.PlaneGeometry(4, 40), mat(palette.carpetDark, { roughness: 1 }))
  aisle.rotation.x = -Math.PI / 2; aisle.position.set(0, 0.01, 4)
  root.add(aisle)

  // ---- 阶梯代表席（半圆剧场，面向 -Z 的主席台）----
  const seatMatBox = mat(palette.desk)
  const seatTop = mat(palette.deskTop)
  const tiers = 4
  const seatsPerTier = [9, 11, 13, 15]
  let seatIndex = 0
  for (let t = 0; t < tiers; t++) {
    const radius = 11 + t * 4
    const y = t * 0.7
    const count = seatsPerTier[t]
    const spread = Math.PI * 1.05         // ~190°
    const start = Math.PI / 2 + spread / 2 // 居中朝 +Z 一侧展开

    // 该层弧形台阶
    const step = new THREE.Mesh(
      new THREE.CylinderGeometry(radius + 2.2, radius + 2.2, 0.7, 64, 1, true, start - spread, spread),
      mat(palette.carpetDark, { side: THREE.DoubleSide, roughness: 1 }))
    step.position.y = y - 0.35
    root.add(step)

    for (let i = 0; i < count; i++) {
      const a = start - (i + 0.5) * (spread / count)
      const px = Math.cos(a) * radius
      const pz = Math.sin(a) * radius
      const ry = Math.atan2(-px, -pz) // 面向圆心(主席台方向)

      const deskG = new THREE.Group()
      deskG.position.set(px, y, pz)
      deskG.rotation.y = ry

      const desk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.7), seatMatBox)
      desk.position.set(0, 0.45, -0.6); desk.castShadow = true
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 0.8), seatTop)
      top.position.set(0, 0.92, -0.6)
      const chair = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), mat(0x333a40))
      chair.position.set(0, 0.25, 0.1)
      deskG.add(desk, top, chair)
      root.add(deskG)

      // 座位标记（落座点 + 拾取）
      const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 16),
        new THREE.MeshBasicMaterial({ color: 0x44ff99, transparent: true, opacity: 0.0 }))
      marker.position.set(px, y + 0.03, pz + Math.sin(ry) * 0 )
      // 标记放在椅子位置
      const seatPos = new THREE.Vector3(px - Math.sin(ry) * -0.1, y, pz)
      marker.position.copy(seatPos).setY(y + 0.03)
      marker.userData.seatId = 's' + seatIndex
      root.add(marker)

      SEATS.push({ id: 's' + seatIndex, position: seatPos.clone(), ry, rostrum: false, mesh: marker })
      seatIndex++
    }
  }

  // ---- 中央主席台（多级 dais）----
  const daisColor = mat(palette.rostrum)
  for (let l = 0; l < 3; l++) {
    const w = 16 - l * 4
    const dais = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, 4 - l * 0.6), daisColor)
    dais.position.set(0, 0.45 + l * 0.9, -12 - l * 1.2)
    dais.castShadow = true; dais.receiveShadow = true
    root.add(dais)
  }
  // 讲台
  const lectern = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.8), mat(palette.gold, { metalness: 0.4, roughness: 0.4 }))
  lectern.position.set(0, 3.3, -10.4)
  root.add(lectern)

  // 主席台高位（3 个：主席 + 2 发言席）
  const rostrumY = 2.7
  const rostrumZ = -13.6
  const rxs = [-3.2, 0, 3.2]
  rxs.forEach((rx, i) => {
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.9), mat(palette.gold, { metalness: 0.3 }))
    chair.position.set(rx, rostrumY + 0.6, rostrumZ)
    root.add(chair)
    const id = 'r' + i
    const pos = new THREE.Vector3(rx, rostrumY, rostrumZ)
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 16),
      new THREE.MeshBasicMaterial({ color: 0xffcc33, transparent: true, opacity: 0.0 }))
    marker.position.copy(pos).setY(rostrumY + 1.3)
    marker.userData.seatId = id
    root.add(marker)
    SEATS.push({ id, position: pos.clone(), ry: 0, rostrum: true, mesh: marker })
    ROSTRUM_SEAT_IDS.push(id)
  })

  // ---- 背景墙 + 徽标 ----
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(20, 20, 16, 48, 1, true, Math.PI * 0.66, Math.PI * 0.68),
    mat(palette.wall, { side: THREE.DoubleSide }))
  wall.position.set(0, 8, -2)
  root.add(wall)

  const emblem = new THREE.Mesh(new THREE.CircleGeometry(4.5, 48),
    new THREE.MeshStandardMaterial({ map: makeEmblemTexture(), roughness: 0.6 }))
  emblem.position.set(0, 8.5, -19.4)
  root.add(emblem)

  // ---- 金色穹顶 ----
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(34, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: palette.goldDark, side: THREE.BackSide, metalness: 0.5, roughness: 0.6 }))
  dome.position.y = 0
  root.add(dome)
  // 放射状吸顶板
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 18), mat(palette.gold, { metalness: 0.6, roughness: 0.4 }))
    spoke.position.set(Math.cos(a) * 9, 15, Math.sin(a) * 9)
    spoke.rotation.y = -a
    root.add(spoke)
  }
  const oculus = new THREE.Mesh(new THREE.CircleGeometry(3, 32), mat(0x111511))
  oculus.rotation.x = Math.PI / 2; oculus.position.y = 16.5
  root.add(oculus)

  scene.add(root)
  return root
}
