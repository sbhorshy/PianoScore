export type ErrorCode =
  | 'no_java'
  | 'no_audiveris'
  | 'engine_crash'
  | 'no_output'
  | 'low_confidence'

export class OcrError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'OcrError'
  }
}
