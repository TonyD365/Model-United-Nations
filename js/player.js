// 本地玩家控制器：桌面 WASD+鼠标视角 / 移动端虚拟摇杆+拖拽视角
import * as THREE from 'three'
import { camera } from './scene.js'
import { MOVE_SPEED, RUN_SPEED, FLOOR_BOUNDS } from './config.js'
import { spawnAvatar, getAvatar } from './avatars.js'

export const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0

const keys = {}
const input = { move: new THREE.Vector2(), lookDX: 0, lookDY: 0, run: false }
let camYaw = Math.PI, camPitch = -0.15
let camDist = 5.5         // 第三人称距离（滚轮缩放）
let thirdPerson = true
let seated = null         // 落座时冻结移动
let self = null           // 自己的 avatar
let selfId = null
let dragging = false      // 右键拖动转视角中

const pos = new THREE.Vector3(0, 0, 18)
const tmp = new THREE.Vector3()

export function initPlayer(id, meta) {
  selfId = id
  self = spawnAvatar(id, meta)
  self.group.position.copy(pos)
  setupDesktop()
  if (isMobile) document.body.classList.add('mobile')
}

export function setThirdPerson(v) { thirdPerson = v }
export function toggleView() { thirdPerson = !thirdPerson; return thirdPerson }

// 落座 / 起身
export function setSeated(seat) {
  seated = seat
  if (seat) { pos.copy(seat.position); camYaw = seat.ry + Math.PI }
}
export function standUp() {
  if (seated) { pos.copy(seated.position); pos.z += 1.2; seated = null }
}
export function isSeated() { return !!seated }

export function teleport(x, z) { pos.set(x, 0, z) }
export function position() { return pos }

// 供 ui.js 移动端调用
export function setJoystick(x, y) { input.move.set(x, y) }
export function addLook(dx, dy) { input.lookDX += dx; input.lookDY += dy }

function setupDesktop() {
  addEventListener('keydown', e => {
    keys[e.code] = true
    if (e.code === 'KeyV') toggleView()
  })
  addEventListener('keyup', e => { keys[e.code] = false })
  const canvas = document.getElementById('app')
  // Roblox 式：按住右键拖动转视角（左键留给点击交互）
  canvas.addEventListener('contextmenu', e => e.preventDefault())
  canvas.addEventListener('mousedown', e => {
    if (e.button === 2) { dragging = true; canvas.style.cursor = 'grabbing' }
  })
  addEventListener('mouseup', e => {
    if (e.button === 2) { dragging = false; canvas.style.cursor = '' }
  })
  addEventListener('mousemove', e => {
    if (dragging) { input.lookDX += e.movementX; input.lookDY += e.movementY }
  })
  // 滚轮缩放第三人称距离
  canvas.addEventListener('wheel', e => {
    e.preventDefault()
    camDist = Math.max(2.5, Math.min(12, camDist + Math.sign(e.deltaY) * 0.6))
  }, { passive: false })
}

function readKeys() {
  if (isMobile) return // 移动端用摇杆
  const m = input.move
  m.set(0, 0)
  if (keys['KeyW'] || keys['ArrowUp']) m.y += 1
  if (keys['KeyS'] || keys['ArrowDown']) m.y -= 1
  if (keys['KeyA'] || keys['ArrowLeft']) m.x -= 1
  if (keys['KeyD'] || keys['ArrowRight']) m.x += 1
  if (m.lengthSq() > 1) m.normalize()
  input.run = keys['ShiftLeft'] || keys['ShiftRight']
}

// 每帧更新；返回当前发送给网络的状态
export function updatePlayer(dt) {
  readKeys()
  // 视角
  camYaw -= input.lookDX * 0.0025
  camPitch -= input.lookDY * 0.0025
  camPitch = Math.max(-1.1, Math.min(0.5, camPitch))
  input.lookDX = 0; input.lookDY = 0

  let moving = false
  if (!seated) {
    const speed = (input.run ? RUN_SPEED : MOVE_SPEED) * dt
    if (input.move.lengthSq() > 0.001) {
      const fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw))
      const rightV = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw))
      tmp.set(0, 0, 0)
        .addScaledVector(fwd, input.move.y)
        .addScaledVector(rightV, input.move.x)
      if (tmp.lengthSq() > 0.0001) {
        tmp.normalize()
        pos.addScaledVector(tmp, speed)
        pos.x = Math.max(FLOOR_BOUNDS.minX, Math.min(FLOOR_BOUNDS.maxX, pos.x))
        pos.z = Math.max(FLOOR_BOUNDS.minZ, Math.min(FLOOR_BOUNDS.maxZ, pos.z))
        self.group.rotation.y = Math.atan2(tmp.x, tmp.z)
        moving = true
      }
    }
  }

  self.group.position.copy(pos)
  self.anim = moving ? 1 : 0

  // 相机
  if (thirdPerson) {
    const dist = camDist, height = 2.6
    const off = new THREE.Vector3(
      Math.sin(camYaw) * Math.cos(camPitch),
      -Math.sin(camPitch) + 0.4,
      Math.cos(camYaw) * Math.cos(camPitch),
    ).multiplyScalar(dist)
    camera.position.copy(pos).add(off).setY(pos.y + height + Math.sin(camPitch) * dist)
    camera.lookAt(pos.x, pos.y + 1.5, pos.z)
  } else {
    camera.position.set(pos.x, pos.y + 1.62, pos.z)
    camera.rotation.set(camPitch, camYaw + Math.PI, 0, 'YXZ')
  }

  return {
    x: round(pos.x), y: round(pos.y), z: round(pos.z),
    ry: round(self.group.rotation.y), anim: self.anim, moving,
  }
}

function round(v) { return Math.round(v * 100) / 100 }
