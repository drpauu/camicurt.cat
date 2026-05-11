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
  "logo 264x264_transparent.png"
];

const contentTypes = {
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

function logoAssetsPlugin() {
  function keepStableLogoUrls(html) {
    return html
      .replace(/href="\/assets\/favicon-[^"]+\.ico"/g, 'href="/logo/favicon.ico"');
  }

  return {
    name: "camicurt-logo-assets",
    enforce: "post",
    transformIndexHtml(html) {
      return keepStableLogoUrls(html);
    },
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
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === "asset" && chunk.fileName.endsWith(".html")) {
          chunk.source = keepStableLogoUrls(String(chunk.source));
        }
      }

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
