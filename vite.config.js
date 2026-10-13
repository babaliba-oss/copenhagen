import {defineConfig} from 'vite';
export default defineConfig({define:{__BUILD_ID__:JSON.stringify(Date.now().toString(36))},build:{rollupOptions:{output:{manualChunks:{three:['three']}}}}});
