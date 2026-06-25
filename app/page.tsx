import { TikSaveDownloader } from "@/components/tiksave-downloader"

export default function Page() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      {/* Background glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(70% 60% at 12% 0%, color-mix(in oklch, var(--primary) 55%, transparent), transparent 60%), radial-gradient(70% 60% at 92% 108%, color-mix(in oklch, var(--accent) 45%, transparent), transparent 60%)",
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-24 pt-10 sm:pt-12">
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

        <section className="mt-20 grid gap-4 sm:mt-24 sm:grid-cols-3">
          {[
            {
              title: "Alta qualidade",
              desc: "Baixa o MP4 em HD, na melhor resolução disponível do vídeo.",
            },
            {
              title: "Sem marca d'água",
              desc: "Vídeo limpo, sem logo do TikTok cobrindo a imagem.",
            },
            {
              title: "Download direto",
              desc: "O arquivo é salvo no seu aparelho sem abrir outra página.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-3xl border border-border bg-card/50 p-6 text-left backdrop-blur"
            >
              <h3 className="text-lg font-bold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.desc}
              </p>
            </div>
          ))}
        </section>

        <footer className="mt-16 text-center text-xs text-muted-foreground">
          TikSave Pro — use apenas para conteúdo que você tem direito de baixar.
        </footer>
      </div>
    </main>
  )
}
