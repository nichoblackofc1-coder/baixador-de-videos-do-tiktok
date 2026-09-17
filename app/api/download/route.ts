import { type NextRequest, NextResponse } from "next/server"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { Readable } from "node:stream"
import { getFfmpegPath } from "@/lib/extractor"

const execFileAsync = promisify(execFile)

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

function isAllowedUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false

    const host = url.hostname.toLowerCase()
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.startsWith("192.168.") ||
      host.startsWith("10.") ||
      host.startsWith("172.16.") ||
      host.startsWith("169.254.") ||
      host.endsWith(".internal") ||
      host.endsWith(".local")
    ) {
      return false
    }

    return true
  } catch {
    return false
  }
}

function sanitizeFileName(rawName: string, ext: string) {
  const safeName =
    rawName
      .replace(/["'“”«»‘’`´\\]/g, "")
      .replace(/[^\p{L}\p{N}\s_.-]/gu, "")
      .trim()
      .slice(0, 60)
      .replace(/\s+/g, "_") || "download"

  const asciiName =
    safeName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_") || "media_file"

  const encodedName = encodeURIComponent(`${safeName}.${ext}`)
  return { safeName, asciiName, encodedName }
}

function isSocialPageUrl(url: string) {
  const lower = url.toLowerCase()
  return (
    lower.includes("youtube.com") ||
    lower.includes("youtu.be") ||
    lower.includes("instagram.com") ||
    lower.includes("tiktok.com") ||
    lower.includes("facebook.com") ||
    lower.includes("fb.watch") ||
    lower.includes("twitter.com") ||
    lower.includes("x.com") ||
    lower.includes("pinterest.com") ||
    lower.includes("pin.it") ||
    lower.includes("kwai.com") ||
    lower.includes("reddit.com")
  )
}

/** Executa yt-dlp para baixar em arquivo temporário e faz stream direto */
async function downloadAndStreamWithYtDlp(
  targetUrl: string,
  type: "video" | "audio",
  rawName: string,
) {
  const ffmpegPath = getFfmpegPath()
  const ext = type === "audio" ? "mp3" : "mp4"
  const { asciiName, encodedName } = sanitizeFileName(rawName, ext)

  const tempPrefix = `tiksave_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const templatePath = path.join(os.tmpdir(), `${tempPrefix}.%(ext)s`)

  const args = [
    "-m",
    "yt_dlp",
    "--no-playlist",
    "--remote-components",
    "ejs:github",
    "--ffmpeg-location",
    ffmpegPath,
    "--js-runtimes",
    "node",
  ]

  if (type === "audio") {
    args.push("-x", "--audio-format", "mp3")
  } else {
    args.push(
      "-f",
      "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/best",
      "--merge-output-format",
      "mp4",
    )
  }

  args.push("-o", templatePath, targetUrl)

  try {
    await execFileAsync("python", args, {
      timeout: 90000,
      maxBuffer: 20 * 1024 * 1024,
    })

    // Localiza o arquivo baixado
    const files = await fs.promises.readdir(os.tmpdir())
    const createdFile = files.find((f) => f.startsWith(tempPrefix))
    if (!createdFile) {
      throw new Error("Arquivo temporário não foi gerado.")
    }

    const fullPath = path.join(os.tmpdir(), createdFile)
    const stat = await fs.promises.stat(fullPath)

    const fileStream = fs.createReadStream(fullPath)
    // Limpa o arquivo temporário após o encerramento do stream
    fileStream.on("close", () => {
      fs.promises.unlink(fullPath).catch(() => {})
    })
    fileStream.on("error", () => {
      fs.promises.unlink(fullPath).catch(() => {})
    })

    const webStream = Readable.toWeb(fileStream)
    return new Response(webStream as any, {
      status: 200,
      headers: {
        "Content-Type": type === "audio" ? "audio/mpeg" : "video/mp4",
        "Content-Disposition": `attachment; filename="${asciiName}.${ext}"; filename*=UTF-8''${encodedName}`,
        "Content-Length": String(stat.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
      },
    })
  } catch (err: any) {
    console.error(`[Download API] Falha no yt-dlp para ${targetUrl.slice(0, 60)}:`, err?.message || err)
    return null
  }
}

function normalizeDownloadUrl(raw: string, origin: string): string {
  if (!raw) return ""
  let current = raw
  while (current.includes("/api/download") && current.includes("url=")) {
    try {
      const parsed = new URL(current.startsWith("http") ? current : `${origin}${current}`)
      const inner = parsed.searchParams.get("url")
      if (inner && inner !== current) {
        current = inner
      } else {
        break
      }
    } catch {
      break
    }
  }
  return current
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url") || ""
  const origin = request.nextUrl.origin
  const fileUrl = normalizeDownloadUrl(rawUrl, origin)
  const typeParam = request.nextUrl.searchParams.get("type") || "video"
  const type: "video" | "audio" | "image" =
    typeParam === "audio" ? "audio" : typeParam === "image" ? "image" : "video"
  const rawName = request.nextUrl.searchParams.get("name") || "download"
  const originalUrl = request.nextUrl.searchParams.get("original")

  if (!fileUrl || !isAllowedUrl(fileUrl)) {
    return NextResponse.json({ error: "URL de arquivo inválida." }, { status: 400 })
  }

  let ext = type === "audio" ? "mp3" : type === "image" ? "jpg" : "mp4"
  const { asciiName, encodedName } = sanitizeFileName(rawName, ext)

  // 1. Se for YouTube, ou solicitação de áudio de uma página social, ou se a URL for a própria página de vídeo
  const isYouTube = fileUrl.includes("youtube.com") || fileUrl.includes("youtu.be") || fileUrl.includes("googlevideo.com")
  const needsYtDlp = isYouTube || (type === "audio" && !fileUrl.includes(".mp3")) || isSocialPageUrl(fileUrl)

  if (needsYtDlp) {
    const target = isYouTube ? fileUrl : (originalUrl && isSocialPageUrl(originalUrl) ? originalUrl : fileUrl)
    const ytStreamResponse = await downloadAndStreamWithYtDlp(target, type === "audio" ? "audio" : "video", rawName)
    if (ytStreamResponse) {
      return ytStreamResponse
    }
  }

  // 2. Modo Proxy Direto para URLs de CDN (Instagram, TikTok, Facebook, Twitter, etc.)
  try {
    const clientRange = request.headers.get("range")
    const upstreamHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "*/*",
    }

    if (fileUrl.includes("instagram") || fileUrl.includes("fbcdn")) {
      upstreamHeaders["Referer"] = "https://www.instagram.com/"
    } else if (fileUrl.includes("tiktok") || fileUrl.includes("tikwm")) {
      upstreamHeaders["Referer"] = "https://www.tiktok.com/"
    } else if (fileUrl.includes("twitter") || fileUrl.includes("twimg") || fileUrl.includes("x.com")) {
      upstreamHeaders["Referer"] = "https://twitter.com/"
    }

    if (clientRange) {
      upstreamHeaders["Range"] = clientRange
    }

    const upstream = await fetch(fileUrl, {
      headers: upstreamHeaders,
      cache: "no-store",
    })

    if (upstream.ok && upstream.body) {
      const contentType =
        upstream.headers.get("content-type") ||
        (type === "audio"
          ? "audio/mpeg"
          : type === "image"
            ? "image/jpeg"
            : "video/mp4")

      const headers = new Headers()
      headers.set("Content-Type", contentType)
      headers.set(
        "Content-Disposition",
        `attachment; filename="${asciiName}.${ext}"; filename*=UTF-8''${encodedName}`,
      )
      headers.set("Accept-Ranges", "bytes")
      headers.set("Content-Transfer-Encoding", "binary")
      headers.set("Cache-Control", "public, max-age=3600")

      const contentLength = upstream.headers.get("content-length")
      if (contentLength) {
        headers.set("Content-Length", contentLength)
      }

      const contentRange = upstream.headers.get("content-range")
      if (contentRange) {
        headers.set("Content-Range", contentRange)
      }

      const statusCode = upstream.status === 206 ? 206 : 200
      return new Response(upstream.body, { status: statusCode, headers })
    }

    console.warn(`[Download API] Upstream fetch retornou status ${upstream.status} para ${fileUrl.slice(0, 80)}`)
  } catch (err) {
    console.warn(`[Download API] Erro no fetch upstream para ${fileUrl.slice(0, 80)}:`, err)
  }

  // 3. Fallback de contingência: se o fetch direto da CDN falhou, executa o yt-dlp usando a URL original da página
  const fallbackUrl = originalUrl || fileUrl
  if (isSocialPageUrl(fallbackUrl)) {
    console.log(`[Download API] Ativando fallback yt-dlp para ${fallbackUrl}`)
    const fallbackResponse = await downloadAndStreamWithYtDlp(
      fallbackUrl,
      type === "audio" ? "audio" : "video",
      rawName,
    )
    if (fallbackResponse) {
      return fallbackResponse
    }
  }

  return NextResponse.json(
    {
      error:
        "Não foi possível processar o download do arquivo no momento. Verifique se o link ainda está acessível.",
    },
    { status: 502 },
  )
}
