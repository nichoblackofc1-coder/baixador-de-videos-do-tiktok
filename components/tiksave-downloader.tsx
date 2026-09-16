"use client"

import { useState } from "react"
import {
  Download,
  Loader2,
  Music2,
  Search,
  AlertCircle,
  ExternalLink,
  RotateCcw,
  Check,
  Copy,
  Sparkles,
  ShieldCheck,
  BadgeCheck,
  Clock,
  Film,
  Image as ImageIcon,
} from "lucide-react"
import {
  detectPlatform,
  SUPPORTED_PLATFORMS,
  type PlatformId,
} from "@/lib/platform-detector"

type UniversalResult = {
  platform: PlatformId | "other"
  platformName: string
  title: string
  author: string
  authorUniqueId?: string
  authorAvatar?: string
  cover: string
  mediaType: "video" | "image"
  quality: string
  mp4: string
  downloadUrl?: string
  music?: string
  musicTitle?: string
  duration: number | null
  original: string
}

function buildDownloadHref(
  fileUrl: string,
  type: "video" | "audio" | "image",
  name: string,
) {
  const params = new URLSearchParams({ url: fileUrl, type, name })
  return `/api/download?${params.toString()}`
}

function safeFileName(name: string, ext: string) {
  const base =
    name
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "download"
  return `${base}.${ext}`
}

function formatDuration(seconds?: number | null) {
  if (!seconds || seconds <= 0) return null
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`
}

/** Renderiza a legenda com hashtags destacadas */
function FormattedCaption({ text }: { text: string }) {
  if (!text) return <span>Publicação sem legenda</span>

  const words = text.split(/(\s+)/)
  return (
    <p className="text-balance text-base sm:text-lg font-medium leading-snug text-foreground/90">
      {words.map((part, index) => {
        if (part.startsWith("#") && part.length > 1) {
          return (
            <span
              key={index}
              className="text-[#25F4EE] font-semibold hover:underline cursor-default"
            >
              {part}
            </span>
          )
        }
        return <span key={index}>{part}</span>
      })}
    </p>
  )
}

export function TikSaveDownloader() {
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<UniversalResult | null>(null)
  const [downloadStarted, setDownloadStarted] = useState<
    "video" | "audio" | "image" | null
  >(null)
  const [copied, setCopied] = useState(false)

  const detectedPlatform = detectPlatform(url)

  function handleTriggerDownload(type: "video" | "audio" | "image") {
    setDownloadStarted(type)
    setTimeout(() => {
      setDownloadStarted(null)
    }, 3500)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)

    const trimmed = url.trim()
    if (!trimmed) {
      setError("Cole um link válido para baixar.")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/fetch-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Não conseguimos processar este link.")
      }

      setResult(data as UniversalResult)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro ao buscar a mídia. Verifique o link e tente novamente.",
      )
    } finally {
      setLoading(false)
    }
  }

  async function handlePaste() {
    try {
      if (navigator?.clipboard?.readText) {
        const text = await navigator.clipboard.readText()
        if (text) {
          setUrl(text.trim())
          setError(null)
        }
      }
    } catch {
      // Clipboard bloqueado
    }
  }

  function handleCopyLink() {
    if (!result?.original) return
    navigator.clipboard?.writeText(result.original)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  function handleReset() {
    setUrl("")
    setResult(null)
    setError(null)
  }

  const durationStr = formatDuration(result?.duration)
  const mainDownloadUrl = result
    ? result.mediaType === "video"
      ? result.mp4
      : result.downloadUrl || result.cover
    : ""

  return (
    <div className="mx-auto w-full max-w-4xl transition-all duration-300">
      {/* Badges de Redes Sociais Suportadas */}
      <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground mr-1">
          Suporte Universal:
        </span>
        {SUPPORTED_PLATFORMS.map((p) => {
          const isCurrent = detectedPlatform?.id === p.id
          return (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-all"
              style={{
                backgroundColor: isCurrent ? p.badgeBg : "rgba(255, 255, 255, 0.05)",
                borderColor: isCurrent ? p.badgeBorder : "rgba(255, 255, 255, 0.1)",
                color: isCurrent ? p.color : "rgba(255, 255, 255, 0.7)",
                borderWidth: 1,
                transform: isCurrent ? "scale(1.06)" : "scale(1)",
                boxShadow: isCurrent ? `0 0 12px ${p.badgeBg}` : "none",
              }}
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              {p.name}
            </span>
          )
        })}
      </div>

      {/* Caixa de Pesquisa com Detecção Automática */}
      <div className="rounded-3xl border border-white/10 bg-card/70 p-3 sm:p-5 shadow-2xl backdrop-blur-2xl">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 sm:flex-row items-stretch"
        >
          <div className="relative flex-1">
            <input
              id="media-url"
              type="text"
              inputMode="url"
              autoComplete="off"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Cole qualquer link (TikTok, Instagram, YouTube, Pinterest, Kwai...)"
              className="min-h-14 w-full rounded-2xl border border-white/10 bg-background/80 px-4 sm:px-5 pr-20 text-sm sm:text-base text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
            {!url && (
              <button
                type="button"
                onClick={handlePaste}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl bg-white/5 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-white/10 hover:text-foreground transition"
              >
                Colar
              </button>
            )}
            {url && (
              <button
                type="button"
                onClick={() => setUrl("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-xs text-muted-foreground hover:bg-white/10 hover:text-foreground transition"
                title="Limpar"
              >
                ✕
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-14 items-center justify-center gap-2.5 rounded-2xl bg-[#FE2C55] px-8 text-base font-black text-white shadow-lg shadow-[#FE2C55]/25 transition-all hover:bg-[#e42049] hover:shadow-[#FE2C55]/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 shrink-0"
          >
            {loading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Search className="size-5" />
            )}
            {loading ? "Processando..." : "Baixar Agora"}
          </button>
        </form>

        {/* Feedback de Detecção Automática em Tempo Real */}
        {detectedPlatform && !error && (
          <div className="mt-3 flex items-center gap-2 px-1">
            <span className="text-xs text-muted-foreground">
              Plataforma detectada:
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold"
              style={{
                backgroundColor: detectedPlatform.badgeBg,
                color: detectedPlatform.color,
                border: `1px solid ${detectedPlatform.badgeBorder}`,
              }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: detectedPlatform.color }}
              />
              {detectedPlatform.name} ({detectedPlatform.label})
            </span>
          </div>
        )}

        {error ? (
          <div
            role="alert"
            className="mt-4 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground"
          >
            <AlertCircle className="size-4 shrink-0 text-primary" />
            <span className="text-foreground">{error}</span>
          </div>
        ) : null}
      </div>

      {/* Card de Resultado em Estilo Canvas Universal */}
      {result ? (
        <div className="relative mt-8 overflow-hidden rounded-3xl border border-white/12 bg-card/90 p-5 sm:p-7 md:p-8 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7)] backdrop-blur-3xl transition-all duration-300">
          {/* Linha de reflexo sutil no topo */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
          />

          {/* Barra Superior com Status e Identificação da Rede */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-emerald-400">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
              </span>
              <span>Conteúdo pronto para download</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-bold text-foreground">
                Rede: {result.platformName}
              </span>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-white/10 hover:text-foreground transition-all"
              >
                <RotateCcw className="size-3.5" />
                Nova busca
              </button>
            </div>
          </div>

          {/* Grid Principal: Mídia (Vídeo ou Foto) + Painel de Download */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start text-left">
            {/* Coluna Esquerda: Preview da Mídia */}
            <div className="lg:col-span-5 flex flex-col items-center">
              {result.mediaType === "video" ? (
                <div className="relative aspect-[9/16] w-full max-w-[280px] sm:max-w-[310px] overflow-hidden rounded-[2.2rem] bg-black ring-1 ring-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.7)] group border border-white/5">
                  <div className="pointer-events-none absolute top-3.5 left-3.5 z-10 flex items-center gap-1.5 rounded-full bg-black/75 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-md border border-white/15">
                    <Film className="size-3 text-[#25F4EE]" />
                    <span>{result.quality || "HD 1080p"}</span>
                  </div>

                  {durationStr && (
                    <div className="pointer-events-none absolute top-3.5 right-3.5 z-10 flex items-center gap-1 rounded-full bg-black/75 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-md border border-white/15">
                      <Clock className="size-3 text-[#25F4EE]" />
                      <span>{durationStr}</span>
                    </div>
                  )}

                  <video
                    src={result.mp4}
                    poster={result.cover}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-contain bg-black"
                  />
                </div>
              ) : (
                <div className="relative max-w-[320px] w-full overflow-hidden rounded-3xl bg-black/50 ring-1 ring-white/15 shadow-2xl">
                  <div className="pointer-events-none absolute top-3.5 left-3.5 z-10 flex items-center gap-1.5 rounded-full bg-black/75 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-md border border-white/15">
                    <ImageIcon className="size-3 text-[#25F4EE]" />
                    <span>Imagem HD</span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={result.downloadUrl || result.cover}
                    alt={result.title}
                    crossOrigin="anonymous"
                    className="max-h-[420px] w-full object-contain rounded-2xl"
                  />
                </div>
              )}

              <span className="mt-3 text-xs text-muted-foreground/75 flex items-center gap-1.5 font-medium">
                <span>▶</span> Prévia oficial de {result.platformName}
              </span>
            </div>

            {/* Coluna Direita: Informações e Botões de Download */}
            <div className="lg:col-span-7 flex flex-col justify-between space-y-4 sm:space-y-5">
              {/* Autor / Canal */}
              <div className="flex items-center gap-3.5 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 backdrop-blur-md shadow-sm hover:border-white/20 transition-all">
                <div className="relative size-12 shrink-0 overflow-hidden rounded-full ring-2 ring-[#FE2C55]/70 bg-secondary flex items-center justify-center">
                  {result.authorAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={result.authorAvatar}
                      alt={result.author}
                      crossOrigin="anonymous"
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="font-bold text-lg text-foreground">
                      {result.author.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate text-base font-bold text-foreground">
                      {result.author}
                    </h3>
                    <BadgeCheck className="size-4 text-[#25F4EE] shrink-0" />
                  </div>
                  <p className="truncate text-xs text-muted-foreground font-mono">
                    {result.platformName} • {result.mediaType === "video" ? "Vídeo" : "Foto"}
                  </p>
                </div>

                <a
                  href={result.original}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-xl border border-white/10 bg-white/5 p-2 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-all"
                  title={`Abrir no ${result.platformName}`}
                >
                  <ExternalLink className="size-4" />
                </a>
              </div>

              {/* Título / Legenda */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 shadow-sm">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80 mb-2">
                  Legenda / Título
                </h4>
                <FormattedCaption text={result.title} />
              </div>

              {/* Badges de Qualidade */}
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400">
                  <Sparkles className="size-3.5" />
                  Sem Marca D&apos;água
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#25F4EE]/25 bg-[#25F4EE]/10 px-3 py-1.5 text-xs font-semibold text-[#25F4EE]">
                  <Film className="size-3.5" />
                  {result.quality || "Qualidade Máxima"}
                </span>
                {result.music && (
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300">
                    <Music2 className="size-3.5" />
                    Áudio Disponível
                  </span>
                )}
              </div>

              {/* Botões de Download */}
              <div className="space-y-3 pt-1">
                {/* Botão Principal: Download Direto Automático */}
                {result.mediaType === "video" && result.mp4 ? (
                  <a
                    href={buildDownloadHref(result.mp4, "video", result.title)}
                    download={safeFileName(result.title, "mp4")}
                    onClick={() => handleTriggerDownload("video")}
                    className="group relative flex w-full min-h-14 items-center justify-center gap-3 rounded-2xl bg-[#FE2C55] px-6 py-4 font-black text-white shadow-[0_10px_25px_rgba(254,44,85,0.35)] transition-all hover:bg-[#e0264b] hover:shadow-[0_14px_30px_rgba(254,44,85,0.5)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] cursor-pointer"
                  >
                    {downloadStarted === "video" ? (
                      <>
                        <Check className="size-5 text-white" />
                        <span className="text-base sm:text-lg tracking-wide">
                          Download Iniciado Automaticamente!
                        </span>
                      </>
                    ) : (
                      <>
                        <Download className="size-5 transition-transform group-hover:-translate-y-0.5" />
                        <span className="text-base sm:text-lg tracking-wide">
                          Baixar Vídeo ({result.quality || "MP4 em HD"})
                        </span>
                      </>
                    )}
                  </a>
                ) : (
                  <a
                    href={buildDownloadHref(mainDownloadUrl, "image", result.title)}
                    download={safeFileName(result.title, "jpg")}
                    onClick={() => handleTriggerDownload("image")}
                    className="group relative flex w-full min-h-14 items-center justify-center gap-3 rounded-2xl bg-[#FE2C55] px-6 py-4 font-black text-white shadow-[0_10px_25px_rgba(254,44,85,0.35)] transition-all hover:bg-[#e0264b] hover:shadow-[0_14px_30px_rgba(254,44,85,0.5)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] cursor-pointer"
                  >
                    {downloadStarted === "image" ? (
                      <>
                        <Check className="size-5 text-white" />
                        <span className="text-base sm:text-lg tracking-wide">
                          Download da Imagem Iniciado!
                        </span>
                      </>
                    ) : (
                      <>
                        <Download className="size-5 transition-transform group-hover:-translate-y-0.5" />
                        <span className="text-base sm:text-lg tracking-wide">
                          Baixar Imagem em Alta Resolução
                        </span>
                      </>
                    )}
                  </a>
                )}

                {/* Botão Secundário: Baixar Áudio MP3 */}
                {result.music ? (
                  <a
                    href={buildDownloadHref(result.music, "audio", result.title)}
                    download={safeFileName(result.title, "mp3")}
                    onClick={() => handleTriggerDownload("audio")}
                    className="flex w-full min-h-12 items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.05] hover:bg-white/[0.1] hover:border-white/20 px-6 py-3 font-bold text-white transition-all active:scale-[0.99] text-sm sm:text-base cursor-pointer"
                  >
                    {downloadStarted === "audio" ? (
                      <>
                        <Check className="size-4 text-emerald-400" />
                        <span>Download do Áudio Iniciado!</span>
                      </>
                    ) : (
                      <>
                        <Music2 className="size-4 text-[#25F4EE]" />
                        <span>Baixar Apenas Áudio (MP3)</span>
                      </>
                    )}
                  </a>
                ) : null}

                {/* Botões Utilitários */}
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/15 px-3 py-2 text-xs font-semibold text-foreground/80 hover:text-foreground transition-all"
                  >
                    {copied ? (
                      <>
                        <Check className="size-3.5 text-emerald-400" />
                        <span className="text-emerald-400 font-bold">Link Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5" />
                        <span>Copiar Link</span>
                      </>
                    )}
                  </button>

                  <a
                    href={result.original}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/15 px-3 py-2 text-xs font-semibold text-foreground/80 hover:text-foreground transition-all"
                  >
                    <ExternalLink className="size-3.5" />
                    <span>Ver no {result.platformName}</span>
                  </a>
                </div>
              </div>

              {/* Garantia do Servidor */}
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-5 shrink-0 text-[#25F4EE] mt-0.5" />
                <p className="leading-relaxed">
                  <strong className="text-foreground">Download Universal e Seguro:</strong> Arquivo transferido direto pelo servidor sem marca d&apos;água, sem anúncios externos e sem bloqueios de navegador.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
