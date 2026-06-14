import type { Metadata, Viewport } from 'next'
import { Bricolage_Grotesque, Geist_Mono } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { Providers } from '@/lib/providers'
import { RegistrarServiceWorker } from '@/components/shared/RegistrarServiceWorker'
import './globals.css'

const bricolage = Bricolage_Grotesque({
  variable: '--font-bricolage',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: '¡Hola! Express — Sistema de Gestión',
  description: 'Sistema de gestión operativa para Hola! Express, La Rioja, Argentina',
  // Manifest por defecto (arranca en el POS). El modo móvil lo sobreescribe en
  // su propio layout con un manifest que arranca en /movil.
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Hola Express',
    statusBarStyle: 'default',
  },
}

export const viewport: Viewport = {
  themeColor: '#391511',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="es"
      className={`${bricolage.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          {children}
        </Providers>
        <Toaster richColors position="top-right" />
        <RegistrarServiceWorker />
      </body>
    </html>
  )
}
