"use client"

import { TikSaveDownloader } from "@/components/tiksave-downloader"
import { LanguageSwitcher } from "@/components/language-switcher"
import { useLanguage } from "@/context/language-context"
import { Zap, ShieldCheck, Download, Sparkles } from "lucide-react"

export default function Page() {
  const { t } = useLanguage()

  const featureList = [
    {
      icon: Zap,
      title: t.features.title1,
      desc: t.features.desc1,
    },
    {
      icon: ShieldCheck,
      title: t.features.title2,
      desc: t.features.desc2,
    },
    {
      icon: Download,
      title: t.features.title3,
      desc: t.features.desc3,
    },
  ]

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#F8FAFC]">
      {/* Background ambient lighting - Canvas Design */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 0%, rgba(37, 99, 235, 0.08) 0%, transparent 55%), radial-gradient(circle at 85% 15%, rgba(99, 102, 241, 0.05) 0%, transparent 45%), radial-gradient(circle at 15% 25%, rgba(14, 165, 233, 0.05) 0%, transparent 45%)",
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-24 pt-8 sm:pt-12">
        {/* Header com Logo, Status e Seletor de Idioma */}
        <header className="mb-12 flex items-center justify-between sm:mb-16">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon.png"
              alt="Logo Save Web"
              className="size-9 sm:size-10 rounded-xl shadow-md ring-1 ring-black/5"
            />
            <div className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
              Save{" "}
              <span className="text-blue-600">
                Web
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              {t.headerBadge}
            </span>
            <LanguageSwitcher />
          </div>
        </header>

        {/* Hero Section */}
        <section className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-200/80 bg-blue-50/70 px-3.5 py-1 text-xs font-semibold text-blue-700 mb-6 shadow-2xs">
            <Sparkles className="size-3.5" />
            <span>{t.heroTag}</span>
          </div>

          <h1 className="text-balance text-4xl font-extrabold leading-[1.08] tracking-tight text-slate-900 sm:text-6xl lg:text-7xl">
            {t.heroTitlePrefix}
            <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-600 bg-clip-text text-transparent">
              {t.heroTitleGradient}
            </span>
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
            {t.heroSubtitle}
          </p>

          <div className="mt-8 sm:mt-10">
            <TikSaveDownloader />
          </div>
        </section>

        {/* Destaques / Benefícios em Estilo Cartões Canvas */}
        <section className="mt-20 grid gap-5 sm:mt-24 sm:grid-cols-3">
          {featureList.map((item) => {
            const Icon = item.icon
            return (
              <div
                key={item.title}
                className="group rounded-2xl border border-slate-200/80 bg-white p-6 text-left shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:shadow-[0_10px_25px_-5px_rgba(0,0,0,0.08)] hover:border-slate-300 transition-all duration-200"
              >
                <div className="mb-4 inline-flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 group-hover:scale-105 transition-transform">
                  <Icon className="size-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  {item.desc}
                </p>
              </div>
            )
          })}
        </section>

        {/* Rodapé Clean Internacional */}
        <footer className="mt-20 border-t border-slate-200/60 pt-8 text-center text-xs text-slate-500">
          {t.footerText}
        </footer>
      </div>
    </main>
  )
}
