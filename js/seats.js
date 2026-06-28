// 座位拾取（射线）与可视高亮
import * as THREE from 'three'
import { raycaster, getActiveCamera } from './scene.js'
import { SEATS } from './hall.js'

// 注意：SEATS 在 buildHall() 时才填充，所以这里都在调用时动态读取，
// 不能在模块加载时快照（那时数组还是空的）。
export function seatById(id) { return SEATS.find(s => s.id === id) || null }

const ndc = new THREE.Vector2()

// 屏幕坐标 → 命中座位 id
export function pickSeat(clientX, clientY) {
  ndc.x = (clientX / innerWidth) * 2 - 1
  ndc.y = -(clientY / innerHeight) * 2 + 1
  raycaster.setFromCamera(ndc, getActiveCamera())
  const hits = raycaster.intersectObjects(SEATS.map(s => s.mesh), false)
  return hits.length ? hits[0].object.userData.seatId : null
}

// 高亮可用座位（session/debate 阶段开启）
export function setSeatHighlight(on, seatsState, rostrumIds) {
  for (const s of SEATS) {
    const occupied = !!seatsState[s.id]
    const restricted = rostrumIds.includes(s.id)
    const m = s.mesh.material
    if (!on || occupied) {
      m.opacity = 0.0
    } else {
      m.opacity = 0.55
      m.color.setHex(restricted ? 0xffcc33 : 0x44ff99)
    }
    m.needsUpdate = true
  }
}
