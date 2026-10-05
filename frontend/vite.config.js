import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Dev server ko inline scripts chahiye (HMR) => CSP meta sirf build me rehta hai.
// Build me %VITE_API_BASE_URL% khali/undefined na rahe => default local API.
const csp = (apiBase) => ({
  name: "csp-meta",
  transformIndexHtml(html, ctx) {
    if (ctx.server) return html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, "");
    return html.replace("%VITE_API_BASE_URL%", apiBase);
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBase = env.VITE_API_BASE_URL || "http://localhost:8000";
  return {
    plugins: [react(), csp(apiBase)],
    server: { port: 5173 },
    build: {
      sourcemap: false, // B-24: production me source maps off
      rollupOptions: {
        output: {
          // Instructor UI (answer-key field names) alag lazy chunk: student bundle me correctAnswer nahi.
          manualChunks(id) {
            if (id.includes("/features/instructor/") || id.includes("/pages/InstructorDashboard")) return "instructor";
            return undefined;
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./src/setupTests.js",
      css: false,
    },
  };
});
