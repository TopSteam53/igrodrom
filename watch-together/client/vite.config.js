import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Адрес нашего Node-сервера. Vite перенаправляет на него запросы /api и /socket.io,
// поэтому в коде клиента не нужно писать localhost:3001.
const SERVER_URL = 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // сайт откроется и с телефона в той же Wi-Fi сети
    proxy: {
      '/api': SERVER_URL,
      '/socket.io': { target: SERVER_URL, ws: true },
    },
  },
});
