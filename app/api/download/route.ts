import { type NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function isAllowedUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false

    const host = url.hostname.toLowerCase()
    // Proteção básica contra SSRF (não permite acesso a rede local / localhost / metadata)
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

export async function GET(request: NextRequest) {
  const fileUrl = request.nextUrl.searchParams.get("url")
  const typeParam = request.nextUrl.searchParams.get("type") || "video"
  const type: "video" | "audio" | "image" =
    typeParam === "audio" ? "audio" : typeParam === "image" ? "image" : "video"
  const rawName = request.nextUrl.searchParams.get("name") || "download"
  const directParam = request.nextUrl.searchParams.get("direct")

  if (!fileUrl || !isAllowedUrl(fileUrl)) {
    return NextResponse.json({ error: "URL de arquivo inválida." }, { status: 400 })
  }

  // Se solicitado download direto por redirecionamento 302
  if (directParam === "1" || directParam === "true") {
    return NextResponse.redirect(fileUrl, { status: 302 })
  }

  try {
    const clientRange = request.headers.get("range")
    const upstreamHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "*/*",
    }

    if (clientRange) {
      upstreamHeaders["Range"] = clientRange
    }

    const upstream = await fetch(fileUrl, {
      headers: upstreamHeaders,
      cache: "no-store",
    })

    if (!upstream.ok || !upstream.body) {
      // Se range falhou com 416, tenta novamente sem range
      if (upstream.status === 416 && clientRange) {
        return NextResponse.redirect(request.nextUrl.pathname + "?" + request.nextUrl.searchParams.toString())
      }
      // Se a CDN rejeitou o servidor (ex: 403 Forbidden / 401), redireciona o navegador do usuário direto para a CDN
      console.warn(`[Download API] Upstream ${upstream.status}, redirecionando direto para a CDN: ${fileUrl.slice(0, 80)}`)
      return NextResponse.redirect(fileUrl, { status: 302 })
    }

    const contentType =
      upstream.headers.get("content-type") ||
      (type === "audio"
        ? "audio/mpeg"
        : type === "image"
          ? "image/jpeg"
          : "video/mp4")

    let ext = "mp4"
    if (type === "audio" || contentType.includes("audio")) {
      ext = "mp3"
    } else if (type === "image" || contentType.includes("image")) {
      ext = contentType.includes("png") ? "png" : "jpg"
    }

    // Sanitização completa de nome de arquivo contra aspas curvas e caracteres problemáticos
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

    // Suporta status 206 (Partial Content) para retomada de downloads pelo navegador
    const statusCode = upstream.status === 206 ? 206 : 200

    return new NextResponse(upstream.body, { status: statusCode, headers })
  } catch (err) {
    console.error("[Download API] Error:", err)
    if (fileUrl && isAllowedUrl(fileUrl)) {
      console.warn(`[Download API] Exceção no stream, redirecionando direto: ${fileUrl.slice(0, 80)}`)
      return NextResponse.redirect(fileUrl, { status: 302 })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao baixar." },
      { status: 502 },
    )
  }
}
