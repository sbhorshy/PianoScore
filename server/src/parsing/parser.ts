// 解析层的统一产物。OSMD 渲染后只需元数据 + 原始 XML。
export interface ParsedScore {
  title: string
  composer?: string
  tempo: number
  sourceXml: string
}

// 开闭原则：新增格式只需实现此接口并 register()，导入/持久化均不改（需求 1.5）。
export interface ScoreParser {
  readonly format: string
  canParse(filename: string, bytes: Uint8Array): boolean
  parse(bytes: Uint8Array): Promise<ParsedScore>
}

// 解析失败时抛出，路由据此返回 400 结构化错误（需求 1.3）。
export class ParseError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message)
    this.name = 'ParseError'
  }
}

export class ParserRegistry {
  private parsers: ScoreParser[] = []

  register(p: ScoreParser): void {
    this.parsers.push(p)
  }

  select(filename: string, bytes: Uint8Array): ScoreParser | null {
    return this.parsers.find((p) => p.canParse(filename, bytes)) ?? null
  }

  get formats(): string[] {
    return this.parsers.map((p) => p.format)
  }
}
