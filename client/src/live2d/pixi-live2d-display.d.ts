declare module 'pixi-live2d-display/cubism4' {
  import { Container } from 'pixi.js'
  export class Live2DModel extends Container {
    static from(source: any): Promise<Live2DModel>
    motion(group: string, index?: number, priority?: number): Promise<boolean>
    expression(id?: number | string): Promise<boolean>
    anchor: any
    internalModel: any
  }
  export const MotionPriority: { FORCE: number; IDLE: number; NORMAL: number }
  export class ExpressionManager {
    expressions: unknown[]
    loadExpression(index: number | string): Promise<unknown>
  }
}
