import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          if (id.includes("@xyflow/")) return "vendor-xyflow";
          if (id.includes("@dagrejs/dagre")) return "vendor-dagre";
          return undefined;
        },
      },
    },
  },
});
