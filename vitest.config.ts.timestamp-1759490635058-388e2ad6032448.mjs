// vitest.config.ts
import { defineConfig } from "file:///C:/Users/chuck/git/pushbullet-chrome-extension/node_modules/vitest/dist/config.js";
import path from "path";
var __vite_injected_original_dirname = "C:\\Users\\chuck\\git\\pushbullet-chrome-extension";
var vitest_config_default = defineConfig({
  test: {
    // Setup file to initialize Chrome API mocks
    setupFiles: ["./tests/setup.ts"],
    // Test environment
    environment: "node",
    // Global test timeout
    testTimeout: 1e4,
    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "src/app/session/**/*.ts",
        "src/background/utils.ts",
        "src/background/index.ts"
      ],
      exclude: [
        "node_modules/**",
        "dist/**",
        "tests/**",
        "**/*.d.ts",
        "**/*.config.ts"
      ],
      // Aim for high coverage on tested modules
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80
      }
    },
    // Globals (optional, allows using describe/it without imports)
    globals: true,
    // Include/exclude patterns
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"]
  },
  // Resolve configuration for TypeScript paths
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  }
});
export {
  vitest_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZXN0LmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXGNodWNrXFxcXGdpdFxcXFxwdXNoYnVsbGV0LWNocm9tZS1leHRlbnNpb25cIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXGNodWNrXFxcXGdpdFxcXFxwdXNoYnVsbGV0LWNocm9tZS1leHRlbnNpb25cXFxcdml0ZXN0LmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvY2h1Y2svZ2l0L3B1c2hidWxsZXQtY2hyb21lLWV4dGVuc2lvbi92aXRlc3QuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZXN0L2NvbmZpZyc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgdGVzdDoge1xuICAgIC8vIFNldHVwIGZpbGUgdG8gaW5pdGlhbGl6ZSBDaHJvbWUgQVBJIG1vY2tzXG4gICAgc2V0dXBGaWxlczogWycuL3Rlc3RzL3NldHVwLnRzJ10sXG4gICAgXG4gICAgLy8gVGVzdCBlbnZpcm9ubWVudFxuICAgIGVudmlyb25tZW50OiAnbm9kZScsXG4gICAgXG4gICAgLy8gR2xvYmFsIHRlc3QgdGltZW91dFxuICAgIHRlc3RUaW1lb3V0OiAxMDAwMCxcbiAgICBcbiAgICAvLyBDb3ZlcmFnZSBjb25maWd1cmF0aW9uXG4gICAgY292ZXJhZ2U6IHtcbiAgICAgIHByb3ZpZGVyOiAndjgnLFxuICAgICAgcmVwb3J0ZXI6IFsndGV4dCcsICdqc29uJywgJ2h0bWwnXSxcbiAgICAgIGluY2x1ZGU6IFtcbiAgICAgICAgJ3NyYy9hcHAvc2Vzc2lvbi8qKi8qLnRzJyxcbiAgICAgICAgJ3NyYy9iYWNrZ3JvdW5kL3V0aWxzLnRzJyxcbiAgICAgICAgJ3NyYy9iYWNrZ3JvdW5kL2luZGV4LnRzJ1xuICAgICAgXSxcbiAgICAgIGV4Y2x1ZGU6IFtcbiAgICAgICAgJ25vZGVfbW9kdWxlcy8qKicsXG4gICAgICAgICdkaXN0LyoqJyxcbiAgICAgICAgJ3Rlc3RzLyoqJyxcbiAgICAgICAgJyoqLyouZC50cycsXG4gICAgICAgICcqKi8qLmNvbmZpZy50cydcbiAgICAgIF0sXG4gICAgICAvLyBBaW0gZm9yIGhpZ2ggY292ZXJhZ2Ugb24gdGVzdGVkIG1vZHVsZXNcbiAgICAgIHRocmVzaG9sZHM6IHtcbiAgICAgICAgbGluZXM6IDgwLFxuICAgICAgICBmdW5jdGlvbnM6IDgwLFxuICAgICAgICBicmFuY2hlczogNzUsXG4gICAgICAgIHN0YXRlbWVudHM6IDgwXG4gICAgICB9XG4gICAgfSxcbiAgICBcbiAgICAvLyBHbG9iYWxzIChvcHRpb25hbCwgYWxsb3dzIHVzaW5nIGRlc2NyaWJlL2l0IHdpdGhvdXQgaW1wb3J0cylcbiAgICBnbG9iYWxzOiB0cnVlLFxuICAgIFxuICAgIC8vIEluY2x1ZGUvZXhjbHVkZSBwYXR0ZXJuc1xuICAgIGluY2x1ZGU6IFsndGVzdHMvKiovKi50ZXN0LnRzJ10sXG4gICAgZXhjbHVkZTogWydub2RlX21vZHVsZXMnLCAnZGlzdCddXG4gIH0sXG4gIFxuICAvLyBSZXNvbHZlIGNvbmZpZ3VyYXRpb24gZm9yIFR5cGVTY3JpcHQgcGF0aHNcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYycpXG4gICAgfVxuICB9XG59KTtcblxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUEwVSxTQUFTLG9CQUFvQjtBQUN2VyxPQUFPLFVBQVU7QUFEakIsSUFBTSxtQ0FBbUM7QUFHekMsSUFBTyx3QkFBUSxhQUFhO0FBQUEsRUFDMUIsTUFBTTtBQUFBO0FBQUEsSUFFSixZQUFZLENBQUMsa0JBQWtCO0FBQUE7QUFBQSxJQUcvQixhQUFhO0FBQUE7QUFBQSxJQUdiLGFBQWE7QUFBQTtBQUFBLElBR2IsVUFBVTtBQUFBLE1BQ1IsVUFBVTtBQUFBLE1BQ1YsVUFBVSxDQUFDLFFBQVEsUUFBUSxNQUFNO0FBQUEsTUFDakMsU0FBUztBQUFBLFFBQ1A7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFBQSxNQUNBLFNBQVM7QUFBQSxRQUNQO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFBQTtBQUFBLE1BRUEsWUFBWTtBQUFBLFFBQ1YsT0FBTztBQUFBLFFBQ1AsV0FBVztBQUFBLFFBQ1gsVUFBVTtBQUFBLFFBQ1YsWUFBWTtBQUFBLE1BQ2Q7QUFBQSxJQUNGO0FBQUE7QUFBQSxJQUdBLFNBQVM7QUFBQTtBQUFBLElBR1QsU0FBUyxDQUFDLG9CQUFvQjtBQUFBLElBQzlCLFNBQVMsQ0FBQyxnQkFBZ0IsTUFBTTtBQUFBLEVBQ2xDO0FBQUE7QUFBQSxFQUdBLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssS0FBSyxRQUFRLGtDQUFXLE9BQU87QUFBQSxJQUN0QztBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
