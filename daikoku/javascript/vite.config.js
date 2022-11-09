import { defineConfig } from "vite";
import { resolve } from "path";
import fs from 'fs/promises';
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  esbuild: {
    loader: "jsx",
    include: /src\/.*\.jsx?$/,
    // loader: "tsx",
    // include: /src\/.*\.[tj]sx?$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: "load-js-files-as-jsx",
          setup(build) {
            build.onLoad({ filter: /src\/.*\.js$/ }, async (args) => ({
              loader: "jsx",
              contents: await fs.readFile(args.path, "utf8"),
            }));
          },
        },
      ],
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:9000",
    },
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      plugins: [visualizer()],
      input: {
        home: resolve(__dirname, 'entrypoints/home/index.html'),
        login: resolve(__dirname, 'entrypoints/login/index.html')
      }
    },
    minify: "terser",
    terserOptions: {
      format: {
        keep_quoted_props: true
      }
    }
  }
});
