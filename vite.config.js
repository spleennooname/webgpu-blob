import { defineConfig } from 'vite';
import vitePluginString from 'vite-plugin-string';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  server: {
    https: true,
  },
  plugins: [
    basicSsl(),
    vitePluginString({
      include: '**/*.wgsl',
    }),
  ],
});
