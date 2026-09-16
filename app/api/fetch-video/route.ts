import { type NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isTikTokUrl(value: string) {
  try {
    const url = new URL(value)
    return url.hostname.includes("tiktok.com")
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  let body: { url?: string }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 })
  }

  const tiktokUrl = (body.url ?? "").trim()

  if (!tiktokUrl || !isTikTokUrl(tiktokUrl)) {
    return NextResponse.json(
      { error: "Cole um link válido do TikTok." },
      { status: 400 },
    )
  }

  try {
    const api = "https://www.tikwm.com/api/?hd=1&url=" + encodeURIComponent(tiktokUrl)
    const response = await fetch(api, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "application/json",
      },
      cache: "no-store",
    })

    if (!response.ok) {
      throw new Error("Serviço indisponível no momento.")
    }

    const json = await response.json()

    if (!json || json.code !== 0 || !json.data) {
      return NextResponse.json(
        { error: "Não consegui processar esse vídeo. Tente outro link público." },
        { status: 422 },
      )
    }

    const data = json.data
    const mp4: string | undefined = data.hdplay || data.play || data.wmplay

    if (!mp4) {
      return NextResponse.json(
        { error: "Este link não retornou um arquivo MP4." },
        { status: 422 },
      )
    }

    return NextResponse.json({
      title: data.title || "Vídeo do TikTok",
      author:
        data.author?.nickname || data.author?.unique_id || "Desconhecido",
      authorUniqueId: data.author?.unique_id || "",
      authorAvatar: data.author?.avatar || "",
      cover: data.cover || data.origin_cover || data.dynamic_cover || "",
      quality: data.hdplay ? "HD" : "Normal",
      mp4,
      music: data.music || "",
      musicTitle: data.music_info?.title || "Áudio Original",
      duration: data.duration ?? null,
      size: data.size ?? null,
      hdSize: data.hd_size ?? null,
      original: tiktokUrl,
    })
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Erro ao buscar o vídeo.",
      },
      { status: 502 },
    )
  }
}
