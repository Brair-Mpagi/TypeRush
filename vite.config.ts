/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Absolute, not relative: the SPA rewrite serves index.html for any path, and
  // relative asset URLs would resolve against that path instead of the root.
  base: '/',
  test: {
    globals: true,
    // Default to Node — the simulation core has no DOM dependency at all.
    // Files that need a DOM opt in with a `@vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
