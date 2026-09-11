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
      define: {
        __KINETIC_DEV_TOOLS__: JSON.stringify(!packaged),
      },
      plugins: packaged
        ? [
            {
              // Development-only modules are swapped for stubs in the release
              // build, so the packaged app ships no debug or profiling code.
              name: "strip-dev-tools",
              enforce: "pre",
              load(id) {
                const path = id.split("?")[0].replaceAll("\\", "/");
                for (const name of ["frame-debug", "perf"]) {
                  if (path.endsWith(`/${name}.ts`)) {
                    return readFileSync(resolve(`src/renderer/src/${name}.prod.ts`), "utf8");
                  }
                }
                return null;
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
