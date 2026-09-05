import * as PIXI from 'pixi.js'
import { ExpressionManager } from 'pixi-live2d-display/cubism4'
// pixi-live2d-display 在运行时需要全局 PIXI
; (window as any).PIXI = PIXI

// V1.6.0 上游竞态补丁：模型 swap/销毁后，pending 的 expression 加载 promise 才 resolve，
// 基类 loadExpression 内 `this.expressions[i] = expression` 会对被 destroy() 清空成
// undefined 的数组赋值 → unhandled rejection（无功能影响，但污染 console / E2E）。
// 仅在"已销毁"（expressions === undefined）时静默吞掉，其他错误照常抛出。
const emHost = ExpressionManager.prototype as any
const origLoadExpression = emHost.loadExpression
emHost.loadExpression = function (...args: unknown[]) {
  const p: Promise<unknown> = origLoadExpression.apply(this, args)
  return p.then(
    (v) => v,
    (e) => {
      if ((this as any).expressions === undefined) return undefined // 模型已销毁：静默
      throw e
    },
  )
}
