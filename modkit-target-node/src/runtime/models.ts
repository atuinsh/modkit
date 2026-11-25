export interface Known {
  provider: string
  id: string
}

export function modelFor<Model extends Known>({
  wanted,
  models,
  current,
}: {
  wanted: string
  models: readonly Model[]
  current: Known | undefined
}): Model | undefined {
  const name = wanted.trim().toLowerCase()
  if (name === '') return undefined
  const slash = name.indexOf('/')
  if (slash !== -1) {
    const provider = name.slice(0, slash)
    const id = name.slice(slash + 1)
    return models.find(
      (model) => model.provider.toLowerCase() === provider && model.id.toLowerCase() === id,
    )
  }
  const exact = models.filter((model) => model.id.toLowerCase() === name)
  const holding = models.filter((model) => model.id.toLowerCase().includes(name))
  return firstOf({ models: exact.length > 0 ? exact : holding, current })
}

function firstOf<Model extends Known>({
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
