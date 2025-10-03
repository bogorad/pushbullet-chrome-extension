import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Setup file to initialize Chrome API mocks
    setupFiles: ['./tests/setup.ts'],
    
    // Test environment
    environment: 'node',
    
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

