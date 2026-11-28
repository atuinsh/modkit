/**
 * Converts a TypeScript {@link Type} into a structural JSON {@link Shape}, or reports the first
 * non-JSON member encountered.
 *
 * Accepts strings, numbers, booleans, `null`, literals, arrays, tuples, and plain object types
 * (with `undefined` permitted only on optional properties). Branded primitives such as
 * `string & { __brand: 'Id' }` collapse to their underlying primitive. Built-in non-array library
 * interfaces (`Date`, `Map`, `Promise`), classes, functions, `any`, `unknown`, `bigint`, and
 * `symbol` are rejected.
 *
 * @module
 */

import { NotJsonError, type NotJson } from './not-json.ts'
import type { Checker, Program, TsProject, Type } from './program.ts'
import type { Shape } from './shape.ts'
import { TypeWalk } from './type-walk.ts'

/** Result of converting a TypeScript type to a JSON {@link Shape}. */
export type ShapeResult = { isJson: true; shape: Shape } | { isJson: false; notJson: NotJson }

/** Project-bound TypeScript-to-JSON {@link Shape} converter. */
export class TypeShape {
  readonly #checker: Checker
  readonly #program: Program

  constructor({ checker, program }: { checker: Checker; program: Program }) {
    this.#checker = checker
    this.#program = program
  }

  /** Bind a {@link TypeShape} converter to `project`'s checker and program. */
  static in(project: TsProject): TypeShape {
    return new TypeShape({ checker: project.checker, program: project.program })
  }

  /** Walk `type` into a JSON {@link Shape}, or return the path and kind of the first bad node. */
  of(type: Type): ShapeResult {
    try {
      return {
        isJson: true,
        shape: new TypeWalk({ checker: this.#checker, program: this.#program }).shapeOf(type),
      }
    } catch (error) {
      if (error instanceof NotJsonError) return { isJson: false, notJson: error.notJson }
      throw error
    }
  }
}
