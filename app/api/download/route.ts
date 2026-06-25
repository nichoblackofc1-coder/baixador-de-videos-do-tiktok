import { type NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_HOST_PATTERNS = [
  "tikwm.com",
  "tiktokcdn",
  "tiktokcdn-us",
  "tiktokv.com",
  "byteoversea.com",
  "muscdn.com",
  "ttwstatic.com",
  "akamaized.net",
]

function isAllowed(value: string) {
  try {
    const host = new URL(value).hostname
    return ALLOWED_HOST_PATTERNS.some((allowed) => host.includes(allowed))
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  const fileUrl = request.nextUrl.searchParams.get("url")
  const type = request.nextUrl.searchParams.get("type") === "audio" ? "audio" : "video"
  const rawName = request.nextUrl.searchParams.get("name") || "tiksave"

  if (!fileUrl || !isAllowed(fileUrl)) {
    return NextResponse.json({ error: "URL de arquivo inválida." }, { status: 400 })
  }

  try {
    const upstream = await fetch(fileUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://www.tikwm.com/",
      },
      cache: "no-store",
    })

    if (!upstream.ok || !upstream.body) {
      throw new Error("Falha ao obter o arquivo.")
    }

    const ext = type === "audio" ? "mp3" : "mp4"
    const safeName =
      rawName
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .trim()
        .slice(0, 60)
        .replace(/\s+/g, "_") || "tiksave"

    const headers = new Headers()
    headers.set(
      "Content-Type",
      type === "audio" ? "audio/mpeg" : "video/mp4",
    )
    headers.set(
      "Content-Disposition",
      `attachment; filename="${safeName}.${ext}"`,
    )
    const len = upstream.headers.get("content-length")
    if (len) headers.set("Content-Length", len)
    headers.set("Cache-Control", "no-store")

    return new NextResponse(upstream.body, { status: 200, headers })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao baixar." },
      { status: 502 },
    )
  }
}
