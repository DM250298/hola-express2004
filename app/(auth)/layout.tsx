export default function LayoutAuth({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#f9d2a2] via-[#fdf5e8] to-[#fff9f0]">
      {children}
    </div>
  )
}
