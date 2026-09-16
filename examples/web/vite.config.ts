import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    rollupOptions: {
      // The example is one page, served at the root. `legacy-demo.html` is the old single-file demo, kept
      // only until the calls check stops reaching for its ids.
      //
      // There used to be an `app.html` beside it with the same markup under its old name, and the two were
      // kept in step by hand, which is to say they were not: a field added to one of them was invisible to
      // every check, because the checks loaded the other.
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        legacy: resolve(import.meta.dirname, "legacy-demo.html")
      }
    }
  },
  optimizeDeps: {
    exclude: ["@matrix-org/matrix-sdk-crypto-wasm"]
  }
});
