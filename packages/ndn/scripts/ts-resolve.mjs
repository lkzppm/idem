// Resolve hook for running the TypeScript sources directly with Node's type stripping (a copy of
// packages/sim/scripts/ts-resolve.mjs, so this package runs its scripts on its own).
// The packages use bundler-style specifiers ("./config", "@idem/core" → src/index.ts); Node's ESM
// resolver wants file extensions, so a relative specifier without one is retried as `.ts` and
// `/index.ts`. Registered with `node --import ./scripts/ts-resolve.mjs` (see the `cli` script).
import { registerHooks } from "node:module";

const CANDIDATES = [".ts", "/index.ts"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) throw error;
      for (const suffix of CANDIDATES) {
        try {
          return nextResolve(specifier + suffix, context);
        } catch {
          // try the next candidate
        }
      }
      throw error;
    }
  },
});
