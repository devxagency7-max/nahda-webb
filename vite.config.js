const API_TARGET = process.env.VITE_API_PROXY_TARGET || 'https://srv1990155.hstgr.cloud';

export default {
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  },
  server: {
    proxy: {
      // السيرفر لا يفعّل CORS حاليًا — أثناء التطوير نمرّر الطلبات عبر
      // نفس الأصل (localhost) فيتفادى المتصفح فحص CORS بالكامل.
      // في الإنتاج لازم reverse proxy مماثل (nginx) أو تفعيل CORS من الباك إند.
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        secure: false
      }
    }
  }
};
