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
        'src/background/utils.ts',
        'src/background/index.ts'
      ],
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        '**/*.d.ts',
        '**/*.config.ts'
      ],
      // Keep thresholds aligned with the current post-upgrade V8 baseline.
      // Raise these as targeted coverage expands.
      thresholds: {
        lines: 18,
        functions: 6,
        branches: 18,
        statements: 18
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
