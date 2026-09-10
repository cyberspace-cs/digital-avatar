import { describe, it, expect } from 'vitest'
import { parseAvatarManifest, parseActionCapability, ANCHOR_NAMES, SchemaError } from './assets.js'

const baseCapability = { actionId: 'wave', motion: 'motions/wave.motion3.json' }

describe('ANCHOR_NAMES', () => {
  it('包含契约 §3.3 的全部 9 个统一锚点，且不多不少', () => {
    expect([...ANCHOR_NAMES].sort()).toEqual(
      [
        'head',
        'hand.left',
        'hand.right',
        'foot.left',
        'foot.right',
        'heart',
        'shoulder',
        'hug.chest',
        'root',
      ].sort(),
    )
  })
})

describe('parseActionCapability', () => {
  it('接受合法能力声明', () => {
    const cap = parseActionCapability({ ...baseCapability, degradesTo: ['positive', 'idle'] })
    expect(cap.motion).toBe('motions/wave.motion3.json')
  })

  it('拒绝无效 actionId / 空 motion', () => {
    expect(() => parseActionCapability({ ...baseCapability, actionId: 'WAVE' })).toThrow(SchemaError)
    expect(() => parseActionCapability({ ...baseCapability, motion: '' })).toThrow(SchemaError)
  })
})

describe('parseAvatarManifest', () => {
  const validManifest = {
    avatarId: 'jing',
    name: 'Jing',
    engine: 'cubism5',
    version: '1.0.0',
    model3Url: 'models/jing/jing.model3.json',
    anchors: {
      head: { x: 0.5, y: 0.1 },
      'hand.left': { x: 0.3, y: 0.5 },
      'hand.right': { x: 0.7, y: 0.5 },
      'foot.left': { x: 0.4, y: 0.95 },
      'foot.right': { x: 0.6, y: 0.95 },
      heart: { x: 0.5, y: 0.4 },
      shoulder: { x: 0.5, y: 0.25 },
      'hug.chest': { x: 0.5, y: 0.45 },
      root: { x: 0.5, y: 0.9 },
    },
    capabilities: [baseCapability, { actionId: 'heart', motion: 'motions/heart.motion3.json' }],
    textures: { '2048': 'textures/2048/', '1024': 'textures/1024/' },
  }

  it('接受合法 manifest', () => {
    const m = parseAvatarManifest(validManifest)
    expect(m.engine).toBe('cubism5')
    expect(m.capabilities).toHaveLength(2)
  })

  it('锚点必须覆盖全部 9 个，缺一个即拒绝', () => {
    const { heart: _drop, ...missing } = validManifest.anchors
    expect(() => parseAvatarManifest({ ...validManifest, anchors: missing })).toThrow(SchemaError)
  })

  it('未知锚点名被拒绝', () => {
    expect(() =>
      parseAvatarManifest({ ...validManifest, anchors: { ...validManifest.anchors, tail: { x: 0, y: 0 } } }),
    ).toThrow(SchemaError)
  })

  it('engine 只允许 cubism5 / legacy-pixi', () => {
    expect(() => parseAvatarManifest({ ...validManifest, engine: 'png-frames' })).toThrow(SchemaError)
  })

  it('capabilities 为空数组被拒绝（至少需要 idle 能力）', () => {
    expect(() => parseAvatarManifest({ ...validManifest, capabilities: [] })).toThrow(SchemaError)
  })

  it('version 必须是 semver 三段式', () => {
    expect(() => parseAvatarManifest({ ...validManifest, version: 'v1' })).toThrow(SchemaError)
  })
})
