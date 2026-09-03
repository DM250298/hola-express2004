'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Layers, Printer, Sticker, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { InputNumero } from './InputNumero'
import {
  EtiquetaElaboracion,
  OPCIONES_POR_VARIANTE,
  type OpcionesEtiqueta,
  type VarianteEtiqueta,
} from './EtiquetaElaboracion'
import { useDatosEtiquetaElaboracion } from '@/lib/hooks/useProduccion'
import { formatearFechaCortaISO } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

type Plantilla = VarianteEtiqueta | 'ambas'

const PLANTILLAS: {
  valor: Plantilla
  titulo: string
  ayuda: string
  icono: React.ElementType
}[] = [
  {
    valor: 'unidad',
    titulo: 'Por unidad',
    ayuda: 'Una etiqueta chica por sándwich',
    icono: Sticker,
  },
  {
    valor: 'bandeja',
    titulo: 'Bandeja o docena',
    ayuda: 'Una etiqueta por bandeja, con la cantidad',
    icono: Layers,
  },
  {
    valor: 'ambas',
    titulo: 'Bandeja + unidades',
    ayuda: 'Las dos, en una sola pasada',
    icono: Printer,
  },
]

/** Atajos de cantidad: la docena y sus múltiplos, que es como arman las tandas. */
const ATAJOS = [1, 6, 12, 24]

/** A partir de acá conviene avisar: es un corte de rollo por etiqueta. */
const AVISO_CORTES = 30

interface Props {
  /** Orden ya cerrada de la que salen los datos. */
  ordenId: number | undefined
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

export function ModalEtiquetasElaboracion({
  ordenId,
  abierto,
  onCambioAbierto,
}: Props) {
  const { data: datos, isLoading } = useDatosEtiquetaElaboracion(
    abierto ? ordenId : undefined
  )

  const [plantilla, setPlantilla] = useState<Plantilla>('unidad')
  const [copiasUnidad, setCopiasUnidad] = useState(1)
  const [copiasBandeja, setCopiasBandeja] = useState(1)
  const [porBandeja, setPorBandeja] = useState(12)
  const [opciones, setOpciones] = useState<OpcionesEtiqueta>(
    OPCIONES_POR_VARIANTE.unidad
  )

  // Precarga con lo realmente producido, una vez que llegan los datos.
  useEffect(() => {
    if (!abierto || !datos) return
    const producido = Math.max(1, Math.ceil(datos.cantidad))
    setCopiasUnidad(producido)
    setCopiasBandeja(Math.max(1, Math.ceil(producido / 12)))
  }, [abierto, datos])

  // Los bloques opcionales siguen a la plantilla elegida, salvo que el usuario
  // los toque después (cada cambio de plantilla vuelve a su default).
  function elegirPlantilla(v: Plantilla) {
    setPlantilla(v)
    setOpciones(OPCIONES_POR_VARIANTE[v === 'ambas' ? 'bandeja' : v])
  }

  function alternar(clave: keyof OpcionesEtiqueta, valor: boolean) {
    setOpciones((prev) => ({ ...prev, [clave]: valor }))
  }

  const muestraUnidad = plantilla === 'unidad' || plantilla === 'ambas'
  const muestraBandeja = plantilla === 'bandeja' || plantilla === 'ambas'

  const totalEtiquetas =
    (muestraUnidad ? copiasUnidad : 0) + (muestraBandeja ? copiasBandeja : 0)

  /**
   * La receta quedó sin vida útil: el lote nace venciendo el mismo día. Se
   * puede imprimir igual, pero hay que verlo antes de pegar 24 etiquetas.
   * Se mira `vida_util_dias`, no las fechas: `elaborado_en` es timestamptz y
   * `vence_el` una fecha local, compararlas por texto se cae de noche.
   */
  const venceElMismoDia = !!datos && datos.vida_util_dias === 0

  function imprimir() {
    if (totalEtiquetas === 0) return
    // El @media print de globals.css oculta todo menos `.etiquetas-imprimir`.
    window.print()
  }

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="sm:max-w-4xl p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Printer className="h-5 w-5 text-[#f9b44c]" />
            Etiquetas de elaboración
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {datos
              ? `${datos.producto_nombre} · lo que se imprime sale del lote de esta tanda.`
              : 'Impresora térmica de 80mm.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="p-10 text-center text-[#6f3a2a] text-sm">
              Cargando los datos de la tanda…
            </div>
          ) : !datos ? (
            <div className="p-10 text-center text-[#6f3a2a] text-sm">
              No se encontraron datos de producción para esta orden.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-0">
              {/* ── Controles ── */}
              <div className="p-6 space-y-5">
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                    Qué etiqueta
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {PLANTILLAS.map(({ valor, titulo, ayuda, icono: Icono }) => (
                      <button
                        key={valor}
                        type="button"
                        onClick={() => elegirPlantilla(valor)}
                        className={cn(
                          'text-left rounded-xl border p-3 transition-all',
                          plantilla === valor
                            ? 'border-[#f9b44c] bg-[#f9b44c]/10 shadow-sm'
                            : 'border-[#e4c9b0]/60 bg-white hover:border-[#f9b44c]'
                        )}
                      >
                        <Icono
                          className={cn(
                            'h-4 w-4 mb-1.5',
                            plantilla === valor
                              ? 'text-[#b07d1e]'
                              : 'text-[#c8a58a]'
                          )}
                        />
                        <div className="text-sm font-semibold text-[#391511]">
                          {titulo}
                        </div>
                        <div className="text-[11px] text-[#6f3a2a] leading-snug mt-0.5">
                          {ayuda}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {muestraUnidad && (
                  <div className="space-y-2">
                    <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                      Etiquetas por unidad
                    </Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <InputNumero
                        min={0}
                        value={copiasUnidad}
                        onChange={setCopiasUnidad}
                        className="w-24 text-center font-bold"
                      />
                      {ATAJOS.map((n) => (
                        <Button
                          key={n}
                          type="button"
                          variant="outline"
                          onClick={() => setCopiasUnidad(n)}
                          className="border-[#e4c9b0] text-[#6f3a2a] h-9 px-3"
                        >
                          ×{n}
                        </Button>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setCopiasUnidad(Math.max(1, Math.ceil(datos.cantidad)))
                        }
                        className="border-[#e4c9b0] text-[#6f3a2a] h-9"
                      >
                        Todo lo producido
                      </Button>
                    </div>
                  </div>
                )}

                {muestraBandeja && (
                  <div className="space-y-2">
                    <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                      Etiquetas de bandeja
                    </Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <InputNumero
                        min={0}
                        value={copiasBandeja}
                        onChange={setCopiasBandeja}
                        className="w-24 text-center font-bold"
                      />
                      <span className="text-sm text-[#6f3a2a]">
                        bandejas de
                      </span>
                      <InputNumero
                        min={1}
                        value={porBandeja}
                        onChange={setPorBandeja}
                        className="w-24 text-center font-bold"
                      />
                      <span className="text-sm text-[#6f3a2a]">
                        {datos.unidad === 'unidad' ? 'unidades' : datos.unidad}{' '}
                        c/u
                      </span>
                    </div>
                    <p className="text-xs text-[#c8a58a]">
                      {copiasBandeja} × {porBandeja} ={' '}
                      {copiasBandeja * porBandeja} · producidas{' '}
                      {datos.cantidad}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                    Qué información incluir
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(
                      [
                        ['ingredientes', 'Ingredientes'],
                        ['alergenos', 'Alérgenos'],
                        ['conservacion', 'Conservación'],
                        ['elaborador', 'Quién elaboró'],
                      ] as [keyof OpcionesEtiqueta, string][]
                    ).map(([clave, texto]) => (
                      <div
                        key={clave}
                        className="flex items-center gap-2 rounded-lg border border-[#e4c9b0]/60 bg-white px-3 py-2"
                      >
                        <Switch
                          id={`op-${clave}`}
                          checked={opciones[clave]}
                          onCheckedChange={(v) => alternar(clave, v)}
                        />
                        <Label
                          htmlFor={`op-${clave}`}
                          className="text-sm text-[#391511] cursor-pointer"
                        >
                          {texto}
                        </Label>
                      </div>
                    ))}
                  </div>
                  {opciones.alergenos && !datos.alergenos && (
                    <p className="text-xs text-[#c45e14]">
                      La receta no tiene alérgenos cargados: el bloque no se
                      imprime. Cargalos en la pestaña Recetas.
                    </p>
                  )}
                </div>

                {venceElMismoDia && (
                  <div className="flex items-start gap-2 rounded-xl border border-[#c43e2c]/40 bg-[#c43e2c]/10 px-3 py-2.5">
                    <AlertTriangle className="h-4 w-4 text-[#c43e2c] shrink-0 mt-0.5" />
                    <p className="text-xs text-[#9e2f25] leading-snug">
                      La receta no tiene vida útil cargada, así que la etiqueta
                      no lleva fecha de vencimiento
                      {datos.vence_el
                        ? ` (dice ${formatearFechaCortaISO(datos.vence_el)})`
                        : ''}
                      . Cargá la vida útil en la receta antes de imprimir.
                    </p>
                  </div>
                )}

                {totalEtiquetas > AVISO_CORTES && (
                  <p className="text-xs text-[#c45e14]">
                    Son {totalEtiquetas} cortes de rollo: la impresora va a
                    tardar un rato.
                  </p>
                )}
              </div>

              {/* ── Vista previa a escala real ── */}
              <div className="border-t lg:border-t-0 lg:border-l border-[#e4c9b0]/60 bg-[#fdfaf6] p-5 space-y-3">
                <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Vista previa (tamaño real)
                </div>
                <div className="overflow-x-auto space-y-3">
                  {muestraBandeja && (
                    <div className="w-max">
                      <EtiquetaElaboracion
                        datos={datos}
                        variante="bandeja"
                        opciones={opciones}
                        cantidadPorEtiqueta={porBandeja}
                      />
                    </div>
                  )}
                  {muestraUnidad && (
                    <div className="w-max">
                      <EtiquetaElaboracion
                        datos={datos}
                        variante="unidad"
                        opciones={opciones}
                        cantidadPorEtiqueta={1}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            className="flex-1 h-11 border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
          >
            <X className="h-4 w-4" />
            No imprimir
          </Button>
          <Button
            onClick={imprimir}
            disabled={!datos || totalEtiquetas === 0}
            className="flex-[2] h-11 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-extrabold rounded-xl disabled:opacity-50 gap-2"
          >
            <Printer className="h-4 w-4" />
            Imprimir {totalEtiquetas}{' '}
            {totalEtiquetas === 1 ? 'etiqueta' : 'etiquetas'}
          </Button>
        </div>
      </DialogContent>

      {/* Render off-screen de lo que realmente se imprime. El @media print de
          globals.css lo hace visible y oculta el resto de la app. */}
      {datos && totalEtiquetas > 0 && (
        <div className="etiquetas-imprimir" aria-hidden>
          {muestraBandeja &&
            Array.from({ length: copiasBandeja }).map((_, i) => (
              <EtiquetaElaboracion
                key={`bandeja-${i}`}
                datos={datos}
                variante="bandeja"
                opciones={opciones}
                cantidadPorEtiqueta={porBandeja}
              />
            ))}
          {muestraUnidad &&
            Array.from({ length: copiasUnidad }).map((_, i) => (
              <EtiquetaElaboracion
                key={`unidad-${i}`}
                datos={datos}
                variante="unidad"
                opciones={opciones}
                cantidadPorEtiqueta={1}
              />
            ))}
        </div>
      )}
    </Dialog>
  )
}
