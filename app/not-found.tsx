import Link from "next/link"
import { RotateCcw } from "lucide-react"

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 20%, rgba(254, 44, 85, 0.25), transparent 70%)",
        }}
      />
      <div className="relative z-10 max-w-md">
        <span className="text-6xl font-black text-[#FE2C55]">404</span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Página não encontrada
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          O link que você tentou acessar não existe ou foi movido.
        </p>
        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-2xl bg-[#FE2C55] px-6 py-3 font-bold text-white shadow-lg shadow-[#FE2C55]/25 transition hover:bg-[#e0264b]"
          >
            <RotateCcw className="size-4" />
            Voltar para o Início
          </Link>
        </div>
      </div>
    </main>
  )
}
