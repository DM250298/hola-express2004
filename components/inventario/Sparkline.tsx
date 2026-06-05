interface Props {
  /** Serie de valores; debería tener al menos 2. */
  datos: number[]
  ancho?: number
  alto?: number
  color?: string
  /** Si los puntos son <= ancho/2, dibuja también un fill bajo la curva. */
  conRelleno?: boolean
  className?: string
  ariaLabel?: string
}

export function Sparkline({
  datos,
  ancho = 80,
  alto = 20,
  color = '#c43e2c',
  conRelleno = true,
  className,
  ariaLabel,
}: Props) {
  if (!datos || datos.length < 2) {
    return (
      <svg
        width={ancho}
        height={alto}
        viewBox={`0 0 ${ancho} ${alto}`}
        className={className}
        aria-hidden="true"
      >
        <line
          x1={0}
          y1={alto / 2}
          x2={ancho}
          y2={alto / 2}
          stroke="#e4c9b0"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      </svg>
    )
  }

  const max = Math.max(...datos)
  const min = Math.min(...datos)
  const rango = max - min || 1
  const padding = 1.5
  const usableAncho = ancho - padding * 2
  const usableAlto = alto - padding * 2

  const puntos = datos.map((v, i) => {
    const x = padding + (i * usableAncho) / (datos.length - 1)
    const y = padding + (1 - (v - min) / rango) * usableAlto
    return [x, y] as const
  })

  const pathLinea = puntos
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ')

  const pathRelleno = conRelleno
    ? `${pathLinea} L ${puntos[puntos.length - 1][0].toFixed(2)} ${alto} L ${puntos[0][0].toFixed(2)} ${alto} Z`
    : null

  return (
    <svg
      width={ancho}
      height={alto}
      viewBox={`0 0 ${ancho} ${alto}`}
      className={className}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      {pathRelleno && (
        <path d={pathRelleno} fill={color} fillOpacity={0.12} stroke="none" />
      )}
      <path
        d={pathLinea}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
