import fs from 'node:fs';
import { defineConfig } from 'vite';

// versão do programa (bloco "Sobre" do diálogo Atalhos) vem do package.json
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// three.js e a biblioteca de CSG em chunks próprios (cache melhor e sem aviso de chunk grande)
export default defineConfig({
  // caminhos relativos: o app desktop (Electron) abre o dist/ via file://
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
