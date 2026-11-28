export interface Known {
  provider: string
  id: string
}

/** Catalog of available provider/model pairs with alias and provider-affinity resolution. */
export class ModelCatalog<Model extends Known> {
  readonly #models: readonly Model[]

  private constructor(models: readonly Model[]) {
    this.#models = models
  }

  /** Wrap `models` in a {@link ModelCatalog} for bound resolution. */
  static from<Model extends Known>(models: readonly Model[]): ModelCatalog<Model> {
    return new ModelCatalog(models)
  }

  /** Resolve a `provider/id`, exact id, or substring alias, preferring `current`'s provider. */
  resolve(wanted: string, { current }: { current?: Known | undefined } = {}): Model | undefined {
    const name = wanted.trim().toLowerCase()
    if (name === '') return undefined
    const slash = name.indexOf('/')
    if (slash !== -1) {
      const provider = name.slice(0, slash)
      const id = name.slice(slash + 1)
      return this.#models.find(
        (model) => model.provider.toLowerCase() === provider && model.id.toLowerCase() === id,
      )
    }
    const exact = this.#models.filter((model) => model.id.toLowerCase() === name)
    const holding = this.#models.filter((model) => model.id.toLowerCase().includes(name))
    return ModelCatalog.#pickFirst({ models: exact.length > 0 ? exact : holding, current })
  }

  static #pickFirst<Model extends Known>({
    models,
    current,
  }: {
    models: readonly Model[]
    current: Known | undefined
  }): Model | undefined {
    const own = models.filter((model) => model.provider === current?.provider)
    const pool =
      own.length > 0 ? own : models.filter((model) => model.provider === models[0]?.provider)
    return pool.toSorted((one, other) => other.id.localeCompare(one.id))[0]
  }
}
