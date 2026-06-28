// 本地玩家控制器：桌面 WASD + 右键拖动视角 / 移动端摇杆 + 拖拽视角
// 第一人称朝视角方向走；鼠标上=抬头，下=低头；带碰撞。
import * as THREE from 'three'
import { camera } from './scene.js'
import { MOVE_SPEED, RUN_SPEED, FLOOR_BOUNDS } from './config.js'
import { spawnAvatar } from './avatars.js'

export const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0
const SENS = 0.0026
const PLAYER_R = 0.42

const keys = {}
const input = { move: new THREE.Vector2(), lookDX: 0, lookDY: 0, run: false }
let camYaw = 0, camPitch = 0.05     // camPitch>0 = 抬头
let camDist = 6
let thirdPerson = true
let seated = null
let self = null
let selfId = null
let dragging = false
let colliders = []

const pos = new THREE.Vector3(0, 0, 18)
const tmpDir = new THREE.Vector3()
const lookDir = new THREE.Vector3()

export function initPlayer(id, meta) {
  selfId = id
  self = spawnAvatar(id, meta)
  self.group.position.copy(pos)
  setupDesktop()
  if (isMobile) document.body.classList.add('mobile')
}

export function setColliders(list) { colliders = list || [] }

export function setThirdPerson(v) { thirdPerson = v }
export function toggleView() { thirdPerson = !thirdPerson; return thirdPerson }

export function setSeated(seat) {
  seated = seat
  if (seat) {
    pos.copy(seat.position)
    camYaw = seat.ry                 // 面向主席台
    if (self) { self.seated = true; self.anim = 0; self.group.rotation.y = seat.ry }
  }
}
export function standUp() {
  if (seated) {
    pos.copy(seated.position)
    pos.z += 1.4
    seated = null
    if (self) self.seated = false
  }
}
export function isSeated() { return !!seated }

export function teleport(x, z) { pos.set(x, 0, z); seated = null; if (self) self.seated = false }
export function position() { return pos }

export function setJoystick(x, y) { input.move.set(x, y) }
export function addLook(dx, dy) { input.lookDX += dx; input.lookDY += dy }

function setupDesktop() {
  addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'KeyV') toggleView() })
  addEventListener('keyup', e => { keys[e.code] = false })
  const canvas = document.getElementById('app')
  canvas.addEventListener('contextmenu', e => e.preventDefault())
  canvas.addEventListener('mousedown', e => { if (e.button === 2) { dragging = true; canvas.style.cursor = 'grabbing' } })
  addEventListener('mouseup', e => { if (e.button === 2) { dragging = false; canvas.style.cursor = '' } })
  addEventListener('mousemove', e => { if (dragging) { input.lookDX += e.movementX; input.lookDY += e.movementY } })
  canvas.addEventListener('wheel', e => { e.preventDefault(); camDist = Math.max(2.5, Math.min(12, camDist + Math.sign(e.deltaY) * 0.7)) }, { passive: false })
}

function readKeys() {
  if (isMobile) return
  const m = input.move; m.set(0, 0)
  if (keys['KeyW'] || keys['ArrowUp']) m.y += 1
  if (keys['KeyS'] || keys['ArrowDown']) m.y -= 1
  if (keys['KeyA'] || keys['ArrowLeft']) m.x -= 1
  if (keys['KeyD'] || keys['ArrowRight']) m.x += 1
  if (m.lengthSq() > 1) m.normalize()
  input.run = keys['ShiftLeft'] || keys['ShiftRight']
}

function resolveCollisions() {
  for (const c of colliders) {
    if (c.r != null) {
      // 圆形碰撞
      const dx = pos.x - c.x, dz = pos.z - c.z
      const rr = c.r + PLAYER_R
      const d2 = dx * dx + dz * dz
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2)
        pos.x = c.x + (dx / d) * rr
        pos.z = c.z + (dz / d) * rr
      }
    } else {
      // AABB 碰撞（向最近的边推出）
      const minX = c.minX - PLAYER_R, maxX = c.maxX + PLAYER_R
      const minZ = c.minZ - PLAYER_R, maxZ = c.maxZ + PLAYER_R
      if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
        const pl = pos.x - minX, pr = maxX - pos.x
        const pd = pos.z - minZ, pu = maxZ - pos.z
        const m = Math.min(pl, pr, pd, pu)
        if (m === pl) pos.x = minX
        else if (m === pr) pos.x = maxX
        else if (m === pd) pos.z = minZ
        else pos.z = maxZ
      }
    }
  }
}

export function updatePlayer(dt) {
  readKeys()
  // 视角：鼠标右移=右转，下移=低头（camPitch 减小）
  camYaw -= input.lookDX * SENS
  camPitch -= input.lookDY * SENS
  camPitch = Math.max(-1.05, Math.min(1.15, camPitch))
  input.lookDX = 0; input.lookDY = 0

  // 朝向向量（含俯仰）
  lookDir.set(
    Math.sin(camYaw) * Math.cos(camPitch),
    Math.sin(camPitch),
    Math.cos(camYaw) * Math.cos(camPitch),
  )

  let moving = false
  if (!seated && input.move.lengthSq() > 0.001) {
    const speed = (input.run ? RUN_SPEED : MOVE_SPEED) * dt
    const fwd = tmpDir.set(Math.sin(camYaw), 0, Math.cos(camYaw))   // 视角水平方向
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw)            // 右方向
    const mx = fwd.x * input.move.y + rx * input.move.x
    const mz = fwd.z * input.move.y + rz * input.move.x
    const len = Math.hypot(mx, mz)
    if (len > 0.0001) {
      pos.x += (mx / len) * speed
      pos.z += (mz / len) * speed
      pos.x = Math.max(FLOOR_BOUNDS.minX, Math.min(FLOOR_BOUNDS.maxX, pos.x))
      pos.z = Math.max(FLOOR_BOUNDS.minZ, Math.min(FLOOR_BOUNDS.maxZ, pos.z))
      resolveCollisions()
      if (self) self.group.rotation.y = Math.atan2(mx, mz)         // 面向移动方向
      moving = true
    }
  }

  if (self) {
    self.group.position.copy(pos)
    self.anim = moving ? 1 : 0
  }

  // 相机
  if (thirdPerson) {
    const tx = pos.x, ty = pos.y + 1.5, tz = pos.z
    const d = cameraDist(tx, ty, tz, camDist)   // 遇墙自动拉近，避免穿墙
    camera.position.set(tx - lookDir.x * d, Math.max(0.4, ty - lookDir.y * d), tz - lookDir.z * d)
    camera.lookAt(tx, ty, tz)
  } else {
    camera.position.set(pos.x, pos.y + 1.62, pos.z)
    camera.lookAt(pos.x + lookDir.x, pos.y + 1.62 + lookDir.y, pos.z + lookDir.z)
  }

  return { x: round(pos.x), y: round(pos.y), z: round(pos.z), ry: round(self ? self.group.rotation.y : 0), anim: moving ? 1 : 0, moving }
}

// 沿视线从角色向外采样，遇到碰撞体/边界就把相机拉到墙前
function cameraDist(tx, ty, tz, maxD) {
  const M = 0.32
  let d = 0.5
  while (d < maxD) {
    const x = tx - lookDir.x * d, z = tz - lookDir.z * d
    if (x < FLOOR_BOUNDS.minX || x > FLOOR_BOUNDS.maxX || z < FLOOR_BOUNDS.minZ || z > FLOOR_BOUNDS.maxZ) break
    if (cameraBlocked(x, z, M)) break
    d += 0.3
  }
  return Math.max(0.6, d - 0.3)
}
function cameraBlocked(x, z, m) {
  for (const c of colliders) {
    if (c.r != null) {
      const dx = x - c.x, dz = z - c.z
      if (dx * dx + dz * dz < (c.r + m) * (c.r + m)) return true
    } else if (x > c.minX - m && x < c.maxX + m && z > c.minZ - m && z < c.maxZ + m) return true
  }
  return false
}

function round(v) { return Math.round(v * 100) / 100 }
