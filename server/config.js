import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const activityPath = path.join(projectRoot, 'config', 'activity.json')

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`)
}

function optionalArtwork(value, field) {
  if (value === undefined || value === null) return
  if (typeof value !== 'string' || !/^\/art\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:webp|png|jpe?g|svg)$/i.test(value) || value.includes('..')) {
    throw new Error(`${field} must be a local /art/ image path or null`)
  }
}

function optionalCopy(value, field) {
  if (value === undefined) return
  requiredString(value, field)
  if (value.length > 160) throw new Error(`${field} must not exceed 160 characters`)
}

function optionalMapPosition(value, field) {
  if (value === undefined || value === null) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object or null`)
  const { x, y } = value
  if (!Number.isFinite(x) || x < 5 || x > 95 || !Number.isFinite(y) || y < 5 || y > 95) {
    throw new Error(`${field} must use x/y 5–95 percentages`)
  }
}

export function validateActivityConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('activity config must be an object')
  requiredString(config.activityName, 'activityName')
  if (typeof config.enabled !== 'boolean') throw new Error('enabled must be a boolean')
  requiredString(config.claimLocationText, 'claimLocationText')
  if (!config.rules || typeof config.rules !== 'object') throw new Error('rules must be an object')
  if (config.rules.photoRequired !== true) throw new Error('rules.photoRequired must be true')
  if (!Number.isInteger(config.rules.maxPhotoBytes) || config.rules.maxPhotoBytes <= 0) throw new Error('rules.maxPhotoBytes must be a positive integer')
  if (!config.wechat || typeof config.wechat !== 'object') throw new Error('wechat must be an object')
  requiredString(config.wechat.officialAccountName, 'wechat.officialAccountName')
  requiredString(config.wechat.guideText, 'wechat.guideText')
  optionalArtwork(config.wechat.officialAccountQr, 'wechat.officialAccountQr')
  if (!Array.isArray(config.points) || config.points.length === 0) throw new Error('points must be a non-empty array')

  const keys = new Set()
  const orders = new Set()
  for (const [index, point] of config.points.entries()) {
    if (!point || typeof point !== 'object') throw new Error(`points[${index}] must be an object`)
    requiredString(point.key, `points[${index}].key`)
    requiredString(point.name, `points[${index}].name`)
    if (point.image !== null && typeof point.image !== 'string') throw new Error(`points[${index}].image must be a string or null`)
    optionalArtwork(point.image, `points[${index}].image`)
    optionalCopy(point.imageAlt, `points[${index}].imageAlt`)
    optionalCopy(point.photoTip, `points[${index}].photoTip`)
    if (point.imageWidth !== undefined || point.imageHeight !== undefined) {
      if (![point.imageWidth, point.imageHeight].every(value => Number.isInteger(value) && value > 0 && value <= 16000)) {
        throw new Error(`points[${index}].imageWidth/imageHeight must be paired positive pixel dimensions`)
      }
    }
    if (point.imagePosition !== undefined && (typeof point.imagePosition !== 'string' || !/^(?:100|[1-9]?\d)% (?:100|[1-9]?\d)%$/.test(point.imagePosition))) {
      throw new Error(`points[${index}].imagePosition must contain two 0–100% values`)
    }
    optionalMapPosition(point.mapPosition, `points[${index}].mapPosition`)
    if (!Number.isInteger(point.displayOrder) || point.displayOrder < 1) throw new Error(`points[${index}].displayOrder must be a positive integer`)
    if (keys.has(point.key)) throw new Error(`duplicate point key: ${point.key}`)
    if (orders.has(point.displayOrder)) throw new Error(`duplicate displayOrder: ${point.displayOrder}`)
    keys.add(point.key)
    orders.add(point.displayOrder)
  }
  return config
}

export function loadActivityConfig(filePath = activityPath) {
  const config = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  return validateActivityConfig(config)
}

export function publicActivityConfig(config) {
  return {
    activityName: config.activityName,
    enabled: config.enabled,
    rules: config.rules,
    claimLocationText: config.claimLocationText,
    wechat: config.wechat,
    points: [...config.points].sort((a, b) => a.displayOrder - b.displayOrder)
  }
}
