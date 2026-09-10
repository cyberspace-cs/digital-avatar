/**
 * @digital-avatar/shared — Jing/Tao 数字分身共享契约包
 * 消费方：client（vite/TS 直接 import dist 类型）与 server（Node ESM）
 */
export * from './events.js'
export * from './assets.js'
export * from './choreography.js'
export * from './errors.js'
export {
  parseInteractionEvent,
  parseSharedMoment,
  parseMemory,
  isSupportedSchemaVersion,
  isValidActionId,
} from './schema.js'
export type { AnchorName } from './assets.js'
