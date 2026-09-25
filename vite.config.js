import { defineConfig } from 'vite';

// three.js e a biblioteca de CSG em chunks próprios (cache melhor e sem aviso de chunk grande)
export default defineConfig({
  // caminhos relativos: o app desktop (Electron) abre o dist/ via file://
  base: './',
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          csg: ['three-bvh-csg', 'three-mesh-bvh'],
        },
      },
    },
  },
});
