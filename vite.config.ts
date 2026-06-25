import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: resolve(__dirname, "node_modules/react"),
      "react-dom": resolve(__dirname, "node_modules/react-dom"),
    },
  },
  server: {
    // The browser talks to LiveKit at ws://localhost:7880 directly; only the
    // token mint is proxied. The old /ws relay is gone (replaced by LiveKit).
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});