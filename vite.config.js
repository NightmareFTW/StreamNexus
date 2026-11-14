import { defineConfig } from 'vite';

// Caminhos relativos: a app empacotada carrega o index.html por file://
export default defineConfig({ base: './' });
