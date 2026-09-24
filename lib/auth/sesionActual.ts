/**
 * Estado mínimo (sin React) de la sesión tal como la vio por última vez el
 * GuardianSesion. Lo leen las capas de datos —por ejemplo `crearVenta`— para
 * no mandarle al servidor una identidad que ya no es la de la sesión del
 * navegador, y para no encolar offline una venta con el usuario equivocado.
 *
 * `null` = todavía no se sabe (o no hay sesión). En ese caso el cliente NO
 * decide nada: la última palabra la tiene el servidor (`auth.uid()`).
 */
let usuarioSesion: string | null = null

/** true mientras un "Salir" propio está en curso: el guardián no redirige. */
let salidaEnCurso = false

export function getUsuarioSesion(): string | null {
  return usuarioSesion
}

export function setUsuarioSesion(id: string | null): void {
  usuarioSesion = id
}

/**
 * Marca que la pantalla está cerrando sesión por su cuenta (Header, botón
 * "Salir" móvil, cierre de turno). El guardián ve el SIGNED_OUT pero deja
 * que el que salió elija a dónde navegar (ej: /login?motivo=turno_cerrado).
 */
export function iniciarSalida(): void {
  salidaEnCurso = true
}

export function cancelarSalida(): void {
  salidaEnCurso = false
}

export function haySalidaEnCurso(): boolean {
  return salidaEnCurso
}
