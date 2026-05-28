import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: '¡Hola! Express — Tienda Online',
  description:
    'Pedí online en Hola Express. Autoservicio 24hs, La Rioja, Argentina.',
}

export const viewport: Viewport = {
  themeColor: '#391511',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function LayoutTienda({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#fdfaf6] flex flex-col">
      {children}
    </div>
  )
}
