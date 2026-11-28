import { diagnosticAt, type Diagnostic } from './diagnostics.ts'
import type { ModCall } from './entry.ts'
import type { OptionDecl } from './ir.ts'
import type { NotJson } from './not-json.ts'
import { syntax, type Node, type Project, type TsSymbol, type Type } from './program.ts'
import { cantBe, Setting } from './setting.ts'
import { canonical, type Field } from './shape.ts'
import { shapeOf } from './types.ts'

interface Read {
  options: OptionDecl[]
  diagnostics: Diagnostic[]
}

const NONE: Read = { options: [], diagnostics: [] }

const fail = ({ message, node }: { message: string; node: Node }): Read => ({
  options: [],
  diagnostics: [diagnosticAt({ code: 'option-type', message, node })],
})

/** The settings parameter of a mod's setup function, whose props are the mod's settings. */
class SettingsParameter {
  readonly #project: Project
  readonly #parameter: Node
  readonly #type: Type

  constructor({ project, parameter, type }: { project: Project; parameter: Node; type: Type }) {
    this.#project = project
    this.#parameter = parameter
    this.#type = type
  }

  read(): Read {
    const { checker, program } = this.#project
    const shaped = shapeOf({ checker, program, type: this.#type })
    if (!shaped.isJson) return this.#notJson(shaped.notJson)
    const shape = canonical(shaped.shape)
    if (shape.kind !== 'object' || shape.index !== undefined) {
      const message = "the mod's settings are each one named, so they have no index signature"
      return fail({ message, node: this.#parameter })
    }
    return this.#declared(shape.fields)
  }

  #properties(): readonly TsSymbol[] {
    return this.#project.checker.getPropertiesOfType(this.#type)
  }

  #notJson(notJson: NotJson): Read {
    const name = /^\.(?<name>[^.[]+)/u.exec(notJson.path)?.groups?.['name']
    const property =
      name === undefined ? undefined : this.#properties().find((one) => one.name === name)
    const message = cantBe({ name: name ?? "the mod's settings", holds: notJson.found })
    return fail({ message, node: property?.valueDeclaration?.resolve() ?? this.#parameter })
  }

  #declared(fields: readonly Field[]): Read {
    const defaults = this.#defaults()
    const byName = new Map(fields.map((field) => [field.name, field]))
    // In the order the props are written, which is the order the config menu lists them in.
    const read = this.#properties().flatMap((property) => {
      const field = byName.get(property.name)
      if (field === undefined) return []
      const initializer = defaults.get(field.name)
      const setting = new Setting({
        project: this.#project,
        property,
        field,
        initializer,
        fallback: this.#parameter,
      })
      return [setting.option()]
    })
    return {
      options: read.flatMap((one) => (one.isOk ? [one.option] : [])),
      diagnostics: read.flatMap((one) => (one.isOk ? [] : [one.diagnostic])),
    }
  }

  // The defaults the parameter's destructuring gives its props, by prop name.
  #defaults(): Map<string, Node> {
    const parameter = this.#parameter
    if (!syntax.isParameterDeclaration(parameter)) return new Map()
    const { name } = parameter
    if (!syntax.isObjectBindingPattern(name)) return new Map()
    return new Map(
      name.elements.flatMap((element) => {
        const key = element.propertyName ?? element.name
        if (element.initializer === undefined || element.dotDotDotToken !== undefined) return []
        if (key === undefined || !syntax.isIdentifier(key)) return []
        return [[key.text, element.initializer] as const]
      }),
    )
  }
}

export function optionsIn({ project, mod }: { project: Project; mod: ModCall }): Read {
  const [parameter] = mod.setup.parameters
  if (parameter === undefined) return NONE
  const type = project.checker.getTypeAtLocation(parameter)
  if (type === undefined) return NONE
  return new SettingsParameter({ project, parameter, type }).read()
}
