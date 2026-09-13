import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    rollupOptions: {
      // Two pages on purpose: index.html is the demo the browser checks drive, and app.html is the design.
      // Growing one into the other would take the checks with it.
      input: {
        demo: resolve(import.meta.dirname, "index.html"),
        app: resolve(import.meta.dirname, "app.html")
      }
    }
  },
  optimizeDeps: {
    exclude: ["@matrix-org/matrix-sdk-crypto-wasm"]
  }
});
