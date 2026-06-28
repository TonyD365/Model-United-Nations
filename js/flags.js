// 共享国旗资源：3D 用 THREE 贴图缓存，UI 用 SVG 路径。
import * as THREE from 'three'

const loader = new THREE.TextureLoader()
const cache = {}

export function flagUrl(iso) { return './assets/flags/' + String(iso).toUpperCase() + '.svg' }

export function flagTexture(iso) {
  const key = String(iso).toUpperCase()
  if (cache[key]) return cache[key]
  const t = loader.load(flagUrl(key))
  t.colorSpace = THREE.SRGBColorSpace
  cache[key] = t
  return t
}
