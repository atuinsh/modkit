/** Where a walked type stops being JSON, and what it found there. */
export interface NotJson {
  path: string
  found: string
}

/** Thrown by a {@link TypeWalk} at the first part of a type that isn't JSON. */
export class NotJsonError extends Error {
  override readonly name = 'NotJsonError'
  readonly notJson: NotJson

  constructor(notJson: NotJson) {
    super(`${notJson.found} at ${notJson.path}`)
    this.notJson = notJson
  }
}
