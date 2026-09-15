import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    rollupOptions: {
      // The example is one page, served at the root. `app.html` is the same file under its old name, kept
      // until the two browser checks that still reach for the old demo's ids have been moved across; that
      // one is `legacy-demo.html` and is on its way out.
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        app: resolve(import.meta.dirname, "app.html"),
        legacy: resolve(import.meta.dirname, "legacy-demo.html")
      }
    }
  },
  optimizeDeps: {
    exclude: ["@matrix-org/matrix-sdk-crypto-wasm"]
  }
});
