// 渲染器 / 相机 / 灯光 / 主循环装配
import * as THREE from 'three'
import { palette } from './config.js'

export const scene = new THREE.Scene()
scene.background = new THREE.Color(palette.sky)
scene.fog = new THREE.Fog(palette.sky, 40, 90)

export const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('app'),
  antialias: true,
})
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

// 玩家相机（第一/第三人称）
export const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200)
camera.position.set(0, 1.6, 20)

// 主控(dashboard)用的俯视相机
export const overviewCamera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 300)
overviewCamera.position.set(0, 34, 30)
overviewCamera.lookAt(0, 0, 2)

let activeCamera = camera
export function setActiveCamera(cam) { activeCamera = cam }
export function getActiveCamera() { return activeCamera }

// 灯光
const hemi = new THREE.HemisphereLight(0xddeee6, palette.gold, 0.9)
scene.add(hemi)

const key = new THREE.DirectionalLight(0xffffff, 1.1)
key.position.set(18, 30, 18)
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.camera.left = -40; key.shadow.camera.right = 40
key.shadow.camera.top = 40; key.shadow.camera.bottom = -40
key.shadow.camera.far = 120
scene.add(key)

const rostrumSpot = new THREE.SpotLight(0xfff2d0, 1.4, 60, Math.PI / 5, 0.4)
rostrumSpot.position.set(0, 18, -6)
rostrumSpot.target.position.set(0, 2, -14)
scene.add(rostrumSpot)
scene.add(rostrumSpot.target)

window.addEventListener('resize', () => {
  for (const cam of [camera, overviewCamera]) {
    cam.aspect = innerWidth / innerHeight
    cam.updateProjectionMatrix()
  }
  renderer.setSize(innerWidth, innerHeight)
})

// 主循环：注册的更新回调
const updaters = new Set()
export function onTick(fn) { updaters.add(fn); return () => updaters.delete(fn) }

const clock = new THREE.Clock()
export function startLoop() {
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05)
    for (const fn of updaters) fn(dt)
    renderer.render(scene, activeCamera)
  })
}

export const raycaster = new THREE.Raycaster()
