import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const logoDir = path.resolve(projectRoot, "logo");
const logoRoute = "/logo/";
const logoAssetFiles = [
  "favicon.ico",
  "favicon-32x32.png",
  "favicon-16x16.png",
  "apple-touch-icon.png",
  "site.webmanifest",
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
  "maskable-192x192.png",
  "maskable-512x512.png",
  "logo-512.png"
];

const contentTypes = {
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json"
};

function logoAssetsPlugin() {
  return {
    name: "camicurt-logo-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestUrl = new URL(req.url || "/", "http://localhost");
        if (!requestUrl.pathname.startsWith(logoRoute)) {
          next();
          return;
        }

        const relativePath = decodeURIComponent(requestUrl.pathname.slice(logoRoute.length));
        const filePath = path.resolve(logoDir, relativePath);
        if (!filePath.startsWith(`${logoDir}${path.sep}`) || !fs.existsSync(filePath)) {
          next();
          return;
        }

        const stats = fs.statSync(filePath);
        if (!stats.isFile()) {
          next();
          return;
        }

        res.setHeader(
          "Content-Type",
          contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream"
        );
        res.setHeader("Cache-Control", "public, max-age=3600");
        fs.createReadStream(filePath).pipe(res);
      });
    },
    generateBundle() {
      for (const fileName of logoAssetFiles) {
        const filePath = path.join(logoDir, fileName);
        if (!fs.existsSync(filePath)) continue;
        this.emitFile({
          type: "asset",
          fileName: `logo/${fileName}`,
          source: fs.readFileSync(filePath)
        });
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), logoAssetsPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          d3: ["d3-geo", "d3-selection", "d3-zoom"],
          topojson: ["topojson-client"],
          supabase: ["@supabase/supabase-js"]
        }
      }
    }
  },
  server: {
    port: 5173
  }
});
