import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Forzar el root del proyecto a esta carpeta. En el directorio padre
  // (HEX-V1/) hay un package-lock.json propio del script generar-fichas.cjs,
  // y Turbopack infería ESE como workspace root (warning "multiple lockfiles").
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        // El service worker no debe quedar cacheado: así el navegador
        // siempre toma la versión más nueva (FASE 2 — POS offline).
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
