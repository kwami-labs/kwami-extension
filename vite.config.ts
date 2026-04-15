import { defineConfig } from 'vite';
import webExtensionDefault from 'vite-plugin-web-extension';
import { resolve } from 'path';

// Depending on the environment, the plugin might be exported as a default or a named export
const webExtension = (webExtensionDefault as any).default || webExtensionDefault;

export default defineConfig({
  plugins: [
    webExtension({
      manifest: 'manifest.json',
      watchMode: true,
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    minify: false, // Easier to debug extensions
  },
});
