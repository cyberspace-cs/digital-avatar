/** 全包统一 schema 错误类型（各领域模块 re-export，保证 instanceof 一致） */
export class SchemaError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(`schema 校验失败: ${issues.join('; ')}`)
    this.name = 'SchemaError'
    this.issues = issues
  }
}
