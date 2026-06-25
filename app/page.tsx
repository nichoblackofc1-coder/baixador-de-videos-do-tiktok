import { TikSaveDownloader } from "@/components/tiksave-downloader"

export default function Page() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Background glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(circle at top left, color-mix(in oklch, var(--primary) 30%, transparent), transparent 35%), radial-gradient(circle at bottom right, color-mix(in oklch, var(--accent) 22%, transparent), transparent 40%)",
        }}
      />

      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-10 sm:pt-12">
        <header className="mb-16 flex items-center justify-between sm:mb-20">
          <div className="text-2xl font-black tracking-tight">
            TikSave{" "}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Pro
            </span>
          </div>
          <span className="hidden rounded-full border border-border bg-card/60 px-4 py-2 text-xs text-muted-foreground backdrop-blur sm:inline">
            Download via servidor
          </span>
        </header>

        <section className="text-center">
          <h1 className="text-balance text-4xl font-black leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
            Baixe vídeos do TikTok em{" "}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              MP4
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Cole o link do TikTok. A prévia aparece na hora e o MP4 é baixado
            direto pelo nosso servidor — sem marca d&apos;água e sem bloqueios do
            navegador.
          </p>

          <div className="mt-10">
            <TikSaveDownloader />
          </div>
        </section>
      </div>
    </main>
  )
}
