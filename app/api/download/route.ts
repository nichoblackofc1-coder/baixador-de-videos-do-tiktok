import { type NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

  if (!fileUrl || !isAllowedUrl(fileUrl)) {
    return NextResponse.json({ error: "URL de arquivo inválida." }, { status: 400 })
  }

  try {
    const upstream = await fetch(fileUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
      cache: "no-store",
    })

    if (!upstream.ok || !upstream.body) {
      throw new Error(`Falha ao obter o arquivo: ${upstream.statusText || upstream.status}`)
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

    const safeName =
      rawName
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
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
    headers.set("Content-Transfer-Encoding", "binary")

    const len = upstream.headers.get("content-length")
    if (len) headers.set("Content-Length", len)
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate")
    headers.set("Pragma", "no-cache")

    return new NextResponse(upstream.body, { status: 200, headers })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao baixar." },
      { status: 502 },
    )
  }
}
