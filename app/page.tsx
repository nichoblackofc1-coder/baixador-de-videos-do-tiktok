import { TikSaveDownloader } from "@/components/tiksave-downloader"

export default function Page() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      {/* Background ambient glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(60% 55% at 8% -5%, rgba(254, 44, 85, 0.45), transparent 60%), radial-gradient(55% 55% at 100% 105%, rgba(37, 244, 238, 0.35), transparent 60%), radial-gradient(45% 40% at 95% 0%, rgba(254, 44, 85, 0.2), transparent 70%)",
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-24 pt-10 sm:pt-12">
        <header className="mb-14 flex items-center justify-between sm:mb-16">
          <div className="text-2xl font-black tracking-tight">
            TikSave{" "}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Universal
            </span>
          </div>
          <span className="hidden rounded-full border border-border bg-card/60 px-4 py-2 text-xs font-semibold text-muted-foreground backdrop-blur sm:inline">
            ⚡ Baixador Tudo-em-Um
          </span>
        </header>

        <section className="text-center">
          <h1 className="text-balance text-4xl font-black leading-[0.98] tracking-tight sm:text-6xl lg:text-7xl">
            Baixe vídeos de{" "}
            <span className="bg-gradient-to-r from-[#FE2C55] to-[#25F4EE] bg-clip-text text-transparent">
              Qualquer Rede Social
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Cole o link do <strong>TikTok, Instagram, YouTube, Pinterest ou Kwai</strong>.
            Identificamos a rede automaticamente e você baixa o vídeo ou foto direto pelo nosso servidor — sem marca d&apos;água e sem anúncios.
          </p>

          <div className="mt-8">
            <TikSaveDownloader />
          </div>
        </section>

        <section className="mt-20 grid gap-4 sm:mt-24 sm:grid-cols-3">
          {[
            {
              title: "Detecção Automática",
              desc: "Basta colar o link. O sistema reconhece se é do TikTok, Instagram, YouTube, Pinterest ou Kwai na hora.",
            },
            {
              title: "Sem Marca d'Água",
              desc: "Arquivos de vídeo limpos em HD 1080p e fotos na resolução máxima original.",
            },
            {
              title: "Download Direto e Rápido",
              desc: "Transferência direta pelo servidor no seu dispositivo sem redirecionamentos ou cadastros.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-3xl border border-border/80 bg-card/50 p-6 text-left backdrop-blur-xl hover:border-white/20 transition"
            >
              <h3 className="text-lg font-bold text-foreground">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.desc}
              </p>
            </div>
          ))}
        </section>

        <footer className="mt-16 text-center text-xs text-muted-foreground">
          TikSave Universal — Use apenas para conteúdo com direito de download. Suporta TikTok, Instagram, YouTube, Pinterest, Kwai e mais.
        </footer>
      </div>
    </main>
  )
}
