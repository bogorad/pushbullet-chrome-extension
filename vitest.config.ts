import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Setup file to initialize Chrome API mocks
    setupFiles: ['./tests/setup.ts'],
    
    // Test environment
    environment: 'jsdom',
    
    // Global test timeout
    testTimeout: 10000,
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/app/session/**/*.ts',
        'src/app/ws/**/*.ts',
        'src/background/**/*.ts',
        'src/debug-dashboard/**/*.ts',
        'src/lib/logging/**/*.ts',
        'src/lib/security/**/*.ts'
      ],
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        '**/*.d.ts',
        '**/*.config.ts'
      ],
      // Keep thresholds aligned with the expanded lifecycle/security baseline.
      // Raise these as targeted tests land for currently uncovered modules.
      thresholds: {
        lines: 21,
        functions: 14,
        branches: 15,
        statements: 20
      }
    },
    
    // Globals (optional, allows using describe/it without imports)
    globals: true,
    
    // Include/exclude patterns
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist']
  },
  
  // Resolve configuration for TypeScript paths
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
