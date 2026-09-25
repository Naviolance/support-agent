// Injection token for the store's pg Pool. A token instead of the Pool class,
// so the agent's own database can never be injected here by mistake.
export const STORE_POOL = Symbol('STORE_POOL');
