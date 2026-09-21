import assert from 'node:assert/strict'
import { loadActivityConfig, validateActivityConfig } from '../server/config.js'

const config = loadActivityConfig()
assert.ok(config.points.length > 0)
assert.throws(() => validateActivityConfig({ ...config, points: [] }), /non-empty array/)
assert.throws(() => validateActivityConfig({ ...config, points: [...config.points, { ...config.points[0] }] }), /duplicate point key/)
console.log(`config ok: ${config.points.length} points; invalid configurations rejected`)
