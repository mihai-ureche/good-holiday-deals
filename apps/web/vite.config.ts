import { defineConfig } from 'vite';
export default defineConfig({ server: { proxy: { '/api': { target: 'http://127.0.0.1:3000', timeout: 330000, proxyTimeout: 330000 } } } });
