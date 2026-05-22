import { Skeleton } from '@/components/ui/skeleton'

interface Props {
  filas?: number
  columnas?: number
}

export function SkeletonTabla({ filas = 6, columnas = 5 }: Props) {
  return (
    <div className="w-full space-y-3">
      <div className="flex gap-3 pb-2 border-b border-[#e4c9b0]/40">
        {Array.from({ length: columnas }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-4 flex-1 bg-[#f9d2a2]/40" />
        ))}
      </div>
      {Array.from({ length: filas }).map((_, fila) => (
        <div key={fila} className="flex gap-3 py-1">
          {Array.from({ length: columnas }).map((_, col) => (
            <Skeleton
              key={`${fila}-${col}`}
              className="h-10 flex-1 bg-[#f9d2a2]/25"
            />
          ))}
        </div>
      ))}
    </div>
  )
}
