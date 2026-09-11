import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig(({ command }) => {
  const packaged = command === "build";
  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        __KINETIC_DEV_TOOLS__: JSON.stringify(!packaged),
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
    },
    renderer: {
      plugins: packaged
        ? [
            {
              name: "strip-frame-debug",
              enforce: "pre",
              load(id) {
                const path = id.split("?")[0].replaceAll("\\", "/");
                if (!path.endsWith("/frame-debug.ts")) return null;
                return readFileSync(resolve("src/renderer/src/frame-debug.prod.ts"), "utf8");
              },
            },
          ]
        : [],
      build: {
        rollupOptions: {
          input: {
            index: resolve("src/renderer/index.html"),
          },
        },
      },
    },
  };
});
