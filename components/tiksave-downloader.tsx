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
import { useLanguage } from "@/context/language-context"

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
  videoId?: string
  embedUrl?: string
}

function buildDownloadHref(
  fileUrl: string,
  type: "video" | "audio" | "image",
  name: string,
  direct?: boolean,
) {
  const params = new URLSearchParams({ url: fileUrl, type, name })
  if (direct) params.set("direct", "1")
  return `/api/download?${params.toString()}`
}

function safeFileName(name: string, ext: string) {
  const base =
    name
      .replace(/["'“”«»‘’`´\\]/g, "")
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

/** Renderiza a legenda com hashtags destacadas em azul refinado */
function FormattedCaption({ text, emptyText }: { text: string; emptyText: string }) {
  if (!text) return <span className="text-slate-500">{emptyText}</span>

  const words = text.split(/(\s+)/)
  return (
    <p className="text-balance text-base font-medium leading-relaxed text-slate-800">
      {words.map((part, index) => {
        if (part.startsWith("#") && part.length > 1) {
          return (
            <span
              key={index}
              className="text-blue-600 font-semibold hover:underline cursor-default"
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
  const { t } = useLanguage()
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<UniversalResult | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<{
    type: "video" | "audio" | "image" | null
    percent: number
    label: string
  }>({ type: null, percent: 0, label: "" })
  const [copied, setCopied] = useState(false)
  const [videoPlaybackError, setVideoPlaybackError] = useState(false)

  const detectedPlatform = detectPlatform(url)

  async function handleDownloadMedia(
    mediaUrl: string,
    type: "video" | "audio" | "image",
    rawTitle: string,
  ) {
    if (downloadProgress.type) return

    if (mediaUrl.includes("ssyoutube") || mediaUrl.includes("savefrom") || mediaUrl.includes("y2mate")) {
      window.open(mediaUrl, "_blank")
      return
    }

    const ext = type === "audio" ? "mp3" : type === "image" ? "jpg" : "mp4"
    const fileName = safeFileName(rawTitle, ext)

    setDownloadProgress({
      type,
      percent: 10,
      label: "Iniciando...",
    })

    try {
      const downloadApiUrl = buildDownloadHref(mediaUrl, type, rawTitle)

      // Fetch com credenciais para evitar bloqueios de SSO da Vercel e antivírus
      const res = await fetch(downloadApiUrl, { credentials: "include" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const contentLength = res.headers.get("content-length")
      const total = contentLength ? parseInt(contentLength, 10) : 0

      if (res.body && total > 0) {
        const reader = res.body.getReader()
        let received = 0
        const chunks: Uint8Array[] = []

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          received += value.length
          const pct = Math.min(99, Math.round((received / total) * 100))
          setDownloadProgress({
            type,
            percent: pct,
            label: `${pct}% (${(received / 1024 / 1024).toFixed(1)}MB)`,
          })
        }

        const mime =
          type === "audio"
            ? "audio/mpeg"
            : type === "image"
              ? "image/jpeg"
              : "video/mp4"
        const blob = new Blob(chunks, { type: mime })
        const blobUrl = window.URL.createObjectURL(blob)

        const a = document.createElement("a")
        a.href = blobUrl
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => window.URL.revokeObjectURL(blobUrl), 30000)

        setDownloadProgress({
          type,
          percent: 100,
          label: t.downloadStarted || "Download concluído!",
        })
        setTimeout(() => {
          setDownloadProgress({ type: null, percent: 0, label: "" })
        }, 3000)
        return
      }

      // Fallback sem stream: converte para blob direto
      const blob = await res.blob()
      const blobUrl = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = blobUrl
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 30000)

      setDownloadProgress({
        type,
        percent: 100,
        label: t.downloadStarted || "Download concluído!",
      })
      setTimeout(() => {
        setDownloadProgress({ type: null, percent: 0, label: "" })
      }, 3000)
    } catch (err) {
      console.warn("[Download] Proxy via stream indisponível, abrindo direto da CDN:", err)
      // Fallback 100% infalível: Abre direto da CDN da rede
      window.open(mediaUrl, "_blank")
      setDownloadProgress({ type: null, percent: 0, label: "" })
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    setVideoPlaybackError(false)

    const trimmed = url.trim()
    if (!trimmed) {
      setError(t.emptyUrlError)
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/fetch-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      })

      const rawText = await res.text()
      let data: any = null
      try {
        data = JSON.parse(rawText)
      } catch {
        // Se a resposta foi HTML (ex: 504 Gateway Timeout ou 502 da Vercel)
        if (res.status === 504 || rawText.includes("Gateway Timeout")) {
          throw new Error("O servidor demorou para responder. Tente novamente.")
        }
        throw new Error(t.genericFetchError || "Não foi possível carregar a mídia. Verifique o link e tente novamente.")
      }

      if (!res.ok) {
        throw new Error(data?.error || t.genericFetchError)
      }

      setResult(data as UniversalResult)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t.genericFetchError,
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
      {/* Badges de Redes Sociais Suportadas - Estilo Light Canvas */}
      <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
        <span className="text-xs font-medium text-slate-500 mr-1">
          {t.networkLabel}
        </span>
        {SUPPORTED_PLATFORMS.map((p) => {
          const isCurrent = detectedPlatform?.id === p.id
          return (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all duration-150"
              style={{
                backgroundColor: isCurrent ? p.badgeBg : "#FFFFFF",
                borderColor: isCurrent ? p.badgeBorder : "#E2E8F0",
                color: isCurrent ? p.badgeText : "#475569",
                borderWidth: 1,
                boxShadow: isCurrent
                  ? "0 2px 8px -1px rgba(37, 99, 235, 0.12)"
                  : "0 1px 2px rgba(0,0,0,0.03)",
                transform: isCurrent ? "scale(1.04)" : "scale(1)",
              }}
            >
              <span
                className="size-1.5 rounded-full shrink-0"
                style={{ backgroundColor: p.color }}
              />
              {p.name}
            </span>
          )
        })}
      </div>

      {/* Caixa de Pesquisa com Detecção Automática - Estilo Light Canvas */}
      <div className="rounded-2xl sm:rounded-3xl border border-slate-200/90 bg-white p-3 sm:p-4 shadow-[0_10px_35px_-5px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.03)]">
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
              placeholder={t.inputPlaceholder}
              className="min-h-14 w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-4 sm:px-5 pr-20 text-sm sm:text-base text-slate-900 placeholder:text-slate-400 outline-none transition focus:bg-white focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
            />
            {!url && (
              <button
                type="button"
                onClick={handlePaste}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl bg-slate-200/60 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition cursor-pointer"
              >
                {t.pasteButton}
              </button>
            )}
            {url && (
              <button
                type="button"
                onClick={() => setUrl("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                title="Limpar"
              >
                ✕
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-14 items-center justify-center gap-2.5 rounded-2xl bg-blue-600 px-8 text-base font-bold text-white shadow-md shadow-blue-500/25 transition-all hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-500/35 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 shrink-0 cursor-pointer"
          >
            {loading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Search className="size-5" />
            )}
            {loading ? t.processingButton : t.downloadButton}
          </button>
        </form>

        {/* Feedback de Detecção Automática em Tempo Real */}
        {detectedPlatform && !error && (
          <div className="mt-3 flex items-center gap-2 px-1">
            <span className="text-xs text-slate-500 font-medium">
              {t.detectedPlatformLabel}
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold"
              style={{
                backgroundColor: detectedPlatform.badgeBg,
                color: detectedPlatform.badgeText,
                border: `1px solid ${detectedPlatform.badgeBorder}`,
              }}
            >
              <span
                className="size-1.5 rounded-full shrink-0"
                style={{ backgroundColor: detectedPlatform.color }}
              />
              {detectedPlatform.name} ({detectedPlatform.label})
            </span>
          </div>
        )}

        {error ? (
          <div
            role="alert"
            className="mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            <AlertCircle className="size-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>

      {/* Card de Resultado em Estilo Canvas Light */}
      {result ? (
        <div className="relative mt-8 overflow-hidden rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-7 md:p-8 shadow-[0_20px_45px_-12px_rgba(0,0,0,0.08),0_4px_16px_rgba(0,0,0,0.03)] transition-all duration-300">
          {/* Barra Superior com Status e Identificação da Rede */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-emerald-700">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <span>{t.readyStatus}</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-800">
                {t.networkLabel} {result.platformName}
              </span>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 shadow-2xs transition-all cursor-pointer"
              >
                <RotateCcw className="size-3" />
                {t.newSearchButton}
              </button>
            </div>
          </div>

          {/* Grid Principal: Mídia (Vídeo ou Foto) + Painel de Download */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start text-left">
            {/* Coluna Esquerda: Preview da Mídia */}
            <div className="lg:col-span-5 flex flex-col items-center">
              {result.platform === "youtube" ? (
                <div className="relative aspect-video w-full max-w-[340px] sm:max-w-[400px] overflow-hidden rounded-2xl bg-black shadow-lg border border-slate-200/80">
                  <iframe
                    src={result.embedUrl || `https://www.youtube-nocookie.com/embed/${result.videoId || ""}?rel=0`}
                    title={result.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="h-full w-full border-0"
                  />
                </div>
              ) : result.mediaType === "video" ? (
                <div className="relative aspect-[9/16] w-full max-w-[280px] sm:max-w-[310px] overflow-hidden rounded-2xl bg-slate-950 shadow-lg border border-slate-200/80 group">
                  <div className="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-md">
                    <Film className="size-3 text-blue-400" />
                    <span>{result.quality || "HD 1080p"}</span>
                  </div>

                  {durationStr && (
                    <div className="pointer-events-none absolute top-3 right-3 z-10 flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
                      <Clock className="size-3 text-blue-400" />
                      <span>{durationStr}</span>
                    </div>
                  )}

                  {videoPlaybackError ? (
                    <div className="relative h-full w-full flex flex-col items-center justify-center bg-slate-900 text-white p-4 text-center">
                      {result.cover && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={result.cover}
                          alt={result.title}
                          className="absolute inset-0 h-full w-full object-cover opacity-35 blur-[2px]"
                        />
                      )}
                      <div className="relative z-10 flex flex-col items-center gap-2.5">
                        <div className="flex size-12 items-center justify-center rounded-full bg-blue-600/90 text-white shadow-lg backdrop-blur-md">
                          <Film className="size-6" />
                        </div>
                        <span className="text-xs font-semibold text-slate-200">
                          {t.readyStatus || "Vídeo pronto para download"}
                        </span>
                        <a
                          href={result.mp4}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-blue-700 transition-colors"
                        >
                          <ExternalLink className="size-3" /> Assistir direto
                        </a>
                      </div>
                    </div>
                  ) : (
                    <video
                      src={result.mp4}
                      poster={result.cover}
                      controls
                      playsInline
                      preload="metadata"
                      onError={() => setVideoPlaybackError(true)}
                      className="h-full w-full object-contain bg-black"
                    />
                  )}
                </div>
              ) : (
                <div className="relative max-w-[320px] w-full overflow-hidden rounded-2xl bg-slate-100 shadow-md border border-slate-200">
                  <div className="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-md">
                    <ImageIcon className="size-3 text-blue-400" />
                    <span>{t.downloadImage}</span>
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

              <span className="mt-3 text-xs text-slate-500 flex items-center gap-1.5 font-medium">
                <span>▶</span> {t.previewNotice} {result.platformName}
              </span>
            </div>

            {/* Coluna Direita: Informações e Botões de Download */}
            <div className="lg:col-span-7 flex flex-col justify-between space-y-4 sm:space-y-5">
              {/* Autor / Canal */}
              <div className="flex items-center gap-3.5 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-xs">
                <div className="relative size-12 shrink-0 overflow-hidden rounded-full ring-2 ring-blue-600/30 bg-white flex items-center justify-center shadow-xs">
                  {result.authorAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={result.authorAvatar}
                      alt={result.author}
                      crossOrigin="anonymous"
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="font-bold text-lg text-slate-800">
                      {result.author.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate text-base font-bold text-slate-900">
                      {result.author}
                    </h3>
                    <BadgeCheck className="size-4 text-blue-600 shrink-0" />
                  </div>
                  <p className="truncate text-xs text-slate-500 font-medium">
                    {result.platformName} • {result.mediaType === "video" ? "Vídeo" : "Foto"}
                  </p>
                </div>

                <a
                  href={result.original}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:text-slate-900 hover:border-slate-300 shadow-2xs transition-all"
                  title={`${t.viewOriginal} ${result.platformName}`}
                >
                  <ExternalLink className="size-4" />
                </a>
              </div>

              {/* Título / Legenda */}
              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/40 p-4">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                  {t.captionLabel}
                </h4>
                <FormattedCaption text={result.title} emptyText={t.noCaption} />
              </div>

              {/* Badges de Qualidade */}
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                  <Sparkles className="size-3.5 text-emerald-600" />
                  {t.noWatermark}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
                  <Film className="size-3.5 text-blue-600" />
                  {result.quality || t.maxQuality}
                </span>
                {result.music && (
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
                    <Music2 className="size-3.5 text-indigo-600" />
                    {t.audioAvailable}
                  </span>
                )}
              </div>

              {/* Botões de Download */}
              <div className="space-y-3 pt-1">
                {/* Botão Principal: Download de Vídeo com Progresso e Salvamento Local */}
                {result.mediaType === "video" && result.mp4 ? (
                  <button
                    type="button"
                    onClick={() => handleDownloadMedia(result.mp4, "video", result.title)}
                    disabled={downloadProgress.type === "video"}
                    className="group relative flex w-full min-h-14 items-center justify-center gap-3 rounded-2xl bg-blue-600 px-6 py-4 font-bold text-white shadow-md shadow-blue-500/25 transition-all hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-500/35 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] cursor-pointer disabled:opacity-90"
                  >
                    {downloadProgress.type === "video" ? (
                      <>
                        {downloadProgress.percent === 100 ? (
                          <Check className="size-5 text-white" />
                        ) : (
                          <Loader2 className="size-5 animate-spin text-white" />
                        )}
                        <span className="text-base sm:text-lg tracking-wide">
                          {downloadProgress.percent === 100
                            ? (t.downloadStarted || "Download concluído!")
                            : `Baixando... ${downloadProgress.label}`}
                        </span>
                      </>
                    ) : (
                      <>
                        <Download className="size-5 transition-transform group-hover:-translate-y-0.5" />
                        <span className="text-base sm:text-lg tracking-wide">
                          {t.downloadVideo} ({result.quality || "MP4 HD"})
                        </span>
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleDownloadMedia(mainDownloadUrl, "image", result.title)}
                    disabled={downloadProgress.type === "image"}
                    className="group relative flex w-full min-h-14 items-center justify-center gap-3 rounded-2xl bg-blue-600 px-6 py-4 font-bold text-white shadow-md shadow-blue-500/25 transition-all hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-500/35 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] cursor-pointer disabled:opacity-90"
                  >
                    {downloadProgress.type === "image" ? (
                      <>
                        {downloadProgress.percent === 100 ? (
                          <Check className="size-5 text-white" />
                        ) : (
                          <Loader2 className="size-5 animate-spin text-white" />
                        )}
                        <span className="text-base sm:text-lg tracking-wide">
                          {downloadProgress.percent === 100
                            ? (t.downloadImageStarted || "Salvo!")
                            : `Baixando... ${downloadProgress.label}`}
                        </span>
                      </>
                    ) : (
                      <>
                        <Download className="size-5 transition-transform group-hover:-translate-y-0.5" />
                        <span className="text-base sm:text-lg tracking-wide">
                          {t.downloadImage}
                        </span>
                      </>
                    )}
                  </button>
                )}

                {/* Botão Secundário: Baixar Áudio MP3 */}
                {result.music ? (
                  <button
                    type="button"
                    onClick={() => handleDownloadMedia(result.music!, "audio", result.title)}
                    disabled={downloadProgress.type === "audio"}
                    className="flex w-full min-h-12 items-center justify-center gap-2.5 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 px-6 py-3 font-semibold text-slate-800 shadow-2xs transition-all active:scale-[0.99] text-sm sm:text-base cursor-pointer disabled:opacity-90"
                  >
                    {downloadProgress.type === "audio" ? (
                      <>
                        {downloadProgress.percent === 100 ? (
                          <Check className="size-4 text-emerald-600" />
                        ) : (
                          <Loader2 className="size-4 animate-spin text-blue-600" />
                        )}
                        <span className="text-blue-600 font-bold">
                          {downloadProgress.percent === 100
                            ? (t.downloadAudioStarted || "Áudio salvo!")
                            : `Baixando áudio... ${downloadProgress.label}`}
                        </span>
                      </>
                    ) : (
                      <>
                        <Music2 className="size-4 text-blue-600" />
                        <span>{t.downloadAudio}</span>
                      </>
                    )}
                  </button>
                ) : null}

                {/* Servidor Alternativo para YouTube ou Link Direto CDN */}
                {result.platform === "youtube" ? (
                  <div className="pt-0.5 text-center">
                    <a
                      href={`https://ssyoutube.com/watch?v=${result.videoId || ""}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 transition-colors font-semibold"
                    >
                      <ExternalLink className="size-3.5 text-blue-500" />
                      <span>⚡ Baixar via Servidor de Alta Velocidade (1080p / MP3)</span>
                    </a>
                  </div>
                ) : result.mediaType === "video" && result.mp4 ? (
                  <div className="pt-0.5 text-center">
                    <a
                      href={result.mp4}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 transition-colors font-medium"
                    >
                      <ExternalLink className="size-3.5 text-blue-500" />
                      <span>⚡ Link direto alternativo (CDN)</span>
                    </a>
                  </div>
                ) : null}

                {/* Botões Utilitários */}
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition-all cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="size-3.5 text-emerald-600" />
                        <span className="text-emerald-700 font-bold">{t.linkCopied}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5 text-slate-500" />
                        <span>{t.copyLink}</span>
                      </>
                    )}
                  </button>

                  <a
                    href={result.original}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition-all cursor-pointer"
                  >
                    <ExternalLink className="size-3.5 text-slate-500" />
                    <span>{t.viewOriginal} {result.platformName}</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
