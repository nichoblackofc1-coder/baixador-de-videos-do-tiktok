import { type NextRequest, NextResponse } from "next/server"
import { extractUniversalMedia, type UniversalMediaResult } from "@/lib/extractor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export type { UniversalMediaResult }

export async function POST(request: NextRequest) {
  let body: { url?: string }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 })
  }

  const rawUrl = (body.url ?? "").trim()
  if (!rawUrl) {
    return NextResponse.json(
      { error: "Cole um link válido para baixar." },
      { status: 400 },
    )
  }

  try {
    const result = await extractUniversalMedia(rawUrl)

    if (result) {
      const validMp4 = typeof result.mp4 === "string" && result.mp4.length > 0 ? result.mp4 : ""
      const validDl = typeof result.downloadUrl === "string" && result.downloadUrl.length > 0 ? result.downloadUrl : ""
      const validMusic = typeof result.music === "string" && result.music.length > 0 ? result.music : ""
      const validCover = typeof result.cover === "string" && result.cover.length > 0 ? result.cover : ""

      result.mp4 = validMp4 || validDl
      result.downloadUrl = validDl || validMp4
      result.music = validMusic || undefined
      result.cover = validCover || ""

      if (result.mp4 || result.downloadUrl || result.cover) {
        return NextResponse.json(result)
      }
    }

    return NextResponse.json(
      {
        error:
          "Não conseguimos obter o arquivo deste link no momento. Verifique se a publicação é pública e tente novamente.",
      },
      { status: 422 },
    )
  } catch (err) {
    console.error("[fetch-video] Erro ao processar requisição:", err)
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erro inesperado ao processar o link.",
      },
      { status: 502 },
    )
  }
}
