import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const backendPort = Number(process.env.AGENT_PORT || process.env.VITE_API_PORT || 3011);
  const frontendPort = Number(process.env.VITE_DEV_PORT || 3010);
  const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || `http://localhost:${backendPort}`;

  return {
    envPrefix: ["VITE_"],
    server: {
      host: "::",
      port: frontendPort,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
  };
});
