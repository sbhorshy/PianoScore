export interface OcrConfig {
  javaBin: string
  jarPath: string
  tessdataDir?: string
  dbPath: string
}

export function loadOcrConfig(): OcrConfig {
  return {
    javaBin: process.env.PIANOSCORE_JAVA ?? 'java',
    jarPath: process.env.PIANOSCORE_AUDIVERIS_JAR ?? './audiveris.jar',
    tessdataDir: process.env.PIANOSCORE_TESSDATA ?? undefined,
    dbPath: process.env.PIANOSCORE_DB ?? './db.sqlite',
  }
}
