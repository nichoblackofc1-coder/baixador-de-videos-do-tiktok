import Link from "next/link"
import { RotateCcw } from "lucide-react"

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#F8FAFC] px-4 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(circle at 50% 30%, rgba(37, 99, 235, 0.08) 0%, transparent 60%)",
        }}
      />
      <div className="relative z-10 max-w-md rounded-3xl border border-slate-200/90 bg-white p-8 shadow-[0_15px_35px_-5px_rgba(0,0,0,0.06)]">
        <span className="text-6xl font-black text-blue-600">404</span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Página não encontrada
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          O link que você tentou acessar não existe ou foi movido.
        </p>
        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-6 py-3 font-bold text-white shadow-md shadow-blue-500/25 transition hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-500/35 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
          >
            <RotateCcw className="size-4" />
            Voltar para o Início
          </Link>
        </div>
      </div>
    </main>
  )
}
