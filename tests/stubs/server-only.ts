/**
 * Stand-in for the `server-only` package during tests.
 *
 * The real package throws when imported outside a React Server Component
 * graph. Vitest is not one, so it is aliased to this empty module in
 * vitest.config.ts.
 */
export {};
