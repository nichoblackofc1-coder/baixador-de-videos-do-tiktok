"use client"

import { useState } from "react"
import {
  Download,
  Loader2,
  Music,
  Play,
  Search,
  AlertCircle,
  ExternalLink,
} from "lucide-react"

type VideoResult = {
  title: string
  author: string
  cover: string
  quality: string
  mp4: string
  music: string
  duration: number | null
  original: string
}

function buildDownloadHref(
  fileUrl: string,
  type: "video" | "audio",
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
      .slice(0, 60) || "tiktok"
  return `${base}.${ext}`
}

export function TikSaveDownloader() {
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<VideoResult | null>(null)
  const [downloading, setDownloading] = useState<"video" | "audio" | null>(null)

  async function handleDownload(
    fileUrl: string,
    type: "video" | "audio",
    name: string,
  ) {
    if (downloading) return
    setError(null)
    setDownloading(type)
    try {
      const res = await fetch(buildDownloadHref(fileUrl, type, name))
      if (!res.ok) {
        throw new Error("Não consegui baixar o arquivo. Tente novamente.")
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = objectUrl
      link.download = safeFileName(name, type === "video" ? "mp4" : "mp3")
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erro ao baixar o arquivo.",
      )
    } finally {
      setDownloading(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)

    const trimmed = url.trim()
    if (!trimmed) {
      setError("Cole um link válido do TikTok.")
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
        throw new Error(data.error || "Erro ao buscar o vídeo.")
      }

      setResult(data as VideoResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao buscar o vídeo.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Search box */}
      <div className="rounded-3xl border border-border bg-card/60 p-4 shadow-2xl backdrop-blur-xl sm:p-5">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <label htmlFor="tiktok-url" className="sr-only">
            Link do TikTok
          </label>
          <input
            id="tiktok-url"
            type="text"
            inputMode="url"
            autoComplete="off"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Cole aqui o link do TikTok"
            className="min-h-14 flex-1 rounded-2xl border border-border bg-background px-5 text-base text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/40"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-primary px-7 text-base font-extrabold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Search className="size-5" />
            )}
            {loading ? "Buscando..." : "Buscar"}
          </button>
        </form>

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

      {/* Result */}
      {result ? (
        <div className="mt-8 grid gap-5 text-left md:grid-cols-[300px_1fr]">
          {/* Cover / preview */}
          <div className="relative overflow-hidden rounded-3xl border border-border bg-secondary">
            {result.cover ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.cover || "/placeholder.svg"}
                  alt={`Capa do vídeo: ${result.title}`}
                  crossOrigin="anonymous"
                  className="h-[420px] w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/15">
                  <Play className="size-16 fill-foreground text-foreground drop-shadow-lg" />
                </div>
              </>
            ) : (
              <div className="grid h-[420px] place-items-center text-muted-foreground">
                Sem miniatura
              </div>
            )}
          </div>

          {/* Info + actions */}
          <div className="rounded-3xl border border-border bg-card/60 p-5 backdrop-blur-xl">
            <video
              src={result.mp4}
              controls
              playsInline
              className="mb-4 max-h-[420px] w-full rounded-2xl bg-black"
            />

            <h2 className="text-balance text-2xl font-bold leading-tight">
              {result.title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Autor: {result.author}
              <span className="mx-2 text-border">•</span>
              <span className="font-semibold text-accent">
                {result.quality}
              </span>
            </p>

            <div className="mt-5 grid gap-3">
              <button
                type="button"
                onClick={() =>
                  handleDownload(result.mp4, "video", result.title)
                }
                disabled={downloading !== null}
                className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3 font-extrabold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {downloading === "video" ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Download className="size-5" />
                )}
                {downloading === "video"
                  ? "Baixando..."
                  : `Baixar MP4 ${result.quality === "HD" ? "em HD" : "(qualidade máxima)"}`}
              </button>

              {result.music ? (
                <button
                  type="button"
                  onClick={() =>
                    handleDownload(result.music, "audio", result.title)
                  }
                  disabled={downloading !== null}
                  className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-border bg-secondary px-6 py-3 font-semibold text-secondary-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {downloading === "audio" ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <Music className="size-5" />
                  )}
                  {downloading === "audio"
                    ? "Baixando..."
                    : "Baixar Áudio (MP3)"}
                </button>
              ) : null}

              <a
                href={result.original}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-border bg-secondary px-6 py-3 font-semibold text-secondary-foreground transition hover:bg-muted"
              >
                <ExternalLink className="size-5" />
                Abrir no TikTok
              </a>
            </div>

            <p className="mt-5 rounded-2xl border border-accent/25 bg-accent/10 px-4 py-3 text-xs leading-relaxed text-foreground/80">
              O download é processado pelo nosso servidor, então o arquivo é
              salvo direto no seu dispositivo — sem bloqueio de CORS e sem abrir
              sites externos.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
