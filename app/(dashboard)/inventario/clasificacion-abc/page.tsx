import { redirect } from 'next/navigation'

// La Clasificación ABC ahora vive como pestaña "Ranking de ventas" dentro de
// Stock. Se mantiene la ruta vieja con redirect para no romper bookmarks.
export default function PaginaClasificacionAbcLegacy() {
  redirect('/inventario?tab=ranking')
}
