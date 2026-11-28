import { DiagnosticError } from './diagnostics.ts'
import type { ModAst } from './entry.ts'
import type { OptionDecl } from './ir.ts'
import type { NotJson } from './not-json.ts'
import { syntax, type Node, type TsProject, type TsSymbol, type Type } from './program.ts'
import { Setting } from './setting.ts'
import { JsonShape, type Field } from './shape.ts'
import { TypeShape } from './types.ts'

interface Read {
  options: OptionDecl[]
  diagnostics: DiagnosticError[]
}

const NONE: Read = { options: [], diagnostics: [] }

const fail = ({ message, node }: { message: string; node: Node }): Read => ({
  options: [],
  diagnostics: [DiagnosticError.at({ code: 'option-type', message, node })],
})

/** The settings parameter of a mod's setup function, whose props are the mod's settings. */
class SettingsParameter {
  readonly #project: TsProject
  readonly #parameter: Node
  readonly #type: Type

  constructor({ project, parameter, type }: { project: TsProject; parameter: Node; type: Type }) {
    this.#project = project
    this.#parameter = parameter
    this.#type = type
  }

  read(): Read {
    const shaped = TypeShape.in(this.#project).of(this.#type)
    if (!shaped.isJson) return this.#notJson(shaped.notJson)
    const shape = JsonShape.of(shaped.shape).canonical()
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
    const message = Setting.cantBe({ name: name ?? "the mod's settings", holds: notJson.found })
    return fail({ message, node: property?.valueDeclaration?.resolve() ?? this.#parameter })
  }

  #declared(fields: readonly Field[]): Read {
    const defaults = this.#defaults()
    const byName = new Map(fields.map((field) => [field.name, field]))
    const options: OptionDecl[] = []
    const diagnostics: DiagnosticError[] = []
    // In the order the props are written, which is the order the config menu lists them in.
    for (const property of this.#properties()) {
      const field = byName.get(property.name)
      if (field === undefined) continue
      const setting = new Setting({
        project: this.#project,
        property,
        field,
        initializer: defaults.get(field.name),
        fallback: this.#parameter,
      })
      try {
        options.push(setting.option())
      } catch (error) {
        if (error instanceof DiagnosticError) diagnostics.push(error)
        else throw error
      }
    }
    return { options, diagnostics }
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

export function optionsIn({ project, mod }: { project: TsProject; mod: ModAst }): Read {
  const [parameter] = mod.setup.parameters
  if (parameter === undefined) return NONE
  const type = project.checker.getTypeAtLocation(parameter)
  if (type === undefined) return NONE
  return new SettingsParameter({ project, parameter, type }).read()
}
