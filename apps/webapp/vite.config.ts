import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

// The W100 API sends no CORS headers, so the browser can never call it
// directly. In dev this proxy stands in for the CloudFront `/w100/*` behavior
// that fronts it in production -- both rewrite /w100/<path> to
// https://w100as.web.app/api/<path>, so app code is identical in both.
export default defineConfig({
  plugins: [solidPlugin(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      "/w100": {
        target: "https://w100as.web.app",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/w100/, "/api"),
      },
    },
  },
  build: {
    target: "esnext",
  },
});
