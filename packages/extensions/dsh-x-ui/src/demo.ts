/** Harmless Loader target used to prove add, disable, enable, and remove. */
export const name = 'dsh-x-demo'

/** The demo has no side effects; its Loader lifecycle is the feature under test. */
export function apply(): void {}
