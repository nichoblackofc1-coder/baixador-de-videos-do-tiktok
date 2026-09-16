import { type NextRequest, NextResponse } from "next/server"
import { detectPlatform, type PlatformId } from "@/lib/platform-detector"
import * as btch from "btch-downloader"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export interface UniversalMediaResult {
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

/* =========================================================================
   1. YOUTUBE INNERTUBE ENGINE (Direct player streams without third-party ads)
   ========================================================================= */
async function extractYouTubeInnertube(rawUrl: string): Promise<UniversalMediaResult | null> {
  const match = rawUrl.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  )
  if (!match) return null
  const videoId = match[1]

  const clients = [
    {
      name: "ANDROID_VR",
      context: {
        client: {
          clientName: "ANDROID_VR",
          clientVersion: "1.62.27",
          hl: "en",
          gl: "US",
        },
      },
      userAgent:
        "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12; Quest 3) gzip",
    },
    {
      name: "IOS",
      context: {
        client: {
          clientName: "IOS",
          clientVersion: "20.10.4",
          deviceMake: "Apple",
          deviceModel: "iPhone16,2",
          osName: "iPhone",
          osVersion: "18.3.2.22D82",
          hl: "en",
          gl: "US",
        },
      },
      userAgent:
        "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; en_US)",
    },
  ]

  for (const client of clients) {
    try {
      const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": client.userAgent,
          Accept: "application/json",
        },
        body: JSON.stringify({
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
          context: client.context,
        }),
      })

      if (!res.ok) continue
      const data = await res.json()

      if (data.playabilityStatus?.status === "OK") {
        const progressive = (data.streamingData?.formats ?? []).filter(
          (f: any) => f.url && !f.signatureCipher,
        )[0]
        const adaptiveVid = (data.streamingData?.adaptiveFormats ?? []).filter(
          (f: any) => f.url && !f.signatureCipher && f.mimeType?.startsWith("video/"),
        )[0]
        const audio = (data.streamingData?.adaptiveFormats ?? []).filter(
          (f: any) => f.url && !f.signatureCipher && f.mimeType?.startsWith("audio/"),
        )[0]

        const vidUrl = progressive?.url || adaptiveVid?.url || ""
        const audioUrl = audio?.url || ""

        if (vidUrl || audioUrl) {
          const thumbs = data.videoDetails?.thumbnail?.thumbnails ?? []
          const bestThumb =
            thumbs.sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0]?.url ||
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

          const title = data.videoDetails?.title || "Vídeo do YouTube"
          return {
            platform: "youtube",
            platformName: "YouTube",
            title,
            author: data.videoDetails?.author || "Canal do YouTube",
            authorUniqueId: data.videoDetails?.author || "",
            cover: bestThumb,
            mediaType: "video",
            quality: progressive?.qualityLabel || "HD 720p",
            mp4: vidUrl,
            downloadUrl: vidUrl,
            music: audioUrl,
            musicTitle: `${title} (Áudio)`,
            duration: Number(data.videoDetails?.lengthSeconds) || null,
            original: rawUrl,
          }
        }
      }
    } catch {
      // Tenta o próximo cliente
    }
  }
  return null
}

/* =========================================================================
   2. TWITTER / X ENGINE (fxtwitter API: direct video/photo without tokens)
   ========================================================================= */
async function extractTwitterFx(rawUrl: string): Promise<UniversalMediaResult | null> {
  const match = rawUrl.match(/(?:twitter\.com|x\.com)\/(?:[a-zA-Z0-9_]+)\/status\/([0-9]+)/)
  if (!match) return null
  const tweetId = match[1]

  try {
    const res = await fetch(`https://api.fxtwitter.com/status/${tweetId}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
    if (!res.ok) return null
    const data = await res.json()
    const tweet = data.tweet
    if (!tweet) return null

    const video = tweet.media?.videos?.[0]
    const photo = tweet.media?.photos?.[0]
    const mp4 = video?.url || ""
    const isVideo = Boolean(mp4)
    const cover = video?.thumbnail_url || photo?.url || ""
    const downloadUrl = mp4 || photo?.url || ""

    return {
      platform: "twitter",
      platformName: "Twitter / X",
      title: tweet.text?.slice(0, 150) || "Publicação do X (Twitter)",
      author: tweet.author?.name || tweet.author?.screen_name || "Usuário do X",
      authorUniqueId: tweet.author?.screen_name ? `@${tweet.author.screen_name}` : "",
      authorAvatar: tweet.author?.avatar_url || "",
      cover,
      mediaType: isVideo ? "video" : "image",
      quality: isVideo ? "HD" : "Alta Resolução",
      mp4,
      downloadUrl,
      duration: null,
      original: rawUrl,
    }
  } catch {
    return null
  }
}

/* =========================================================================
   3. PINTEREST ENGINE (Direct Googlebot CDN original scraper)
   ========================================================================= */
async function extractPinterestDirect(rawUrl: string): Promise<UniversalMediaResult | null> {
  try {
    const res = await fetch(rawUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      cache: "no-store",
    })
    const html = await res.text()

    const rawTitle =
      html.match(/<title>([^<]+)<\/title>/)?.[1] ||
      html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ||
      "Pin do Pinterest"
    const title = rawTitle.replace(/\s*-\s*Pinterest.*$/i, "").trim() || "Pin do Pinterest"

    // Busca imagens de resolução máxima original
    const originalImgs = html.match(
      /https:\/\/i\.pinimg\.com\/originals\/[a-zA-Z0-9/_.-]+\.(jpg|jpeg|png|webp)/gi,
    )
    const standardImgs = html.match(
      /https:\/\/i\.pinimg\.com\/736x\/[a-zA-Z0-9/_.-]+\.(jpg|jpeg|png|webp)/gi,
    )
    const videos = html.match(/https:\/\/[a-zA-Z0-9_.-]*pinimg\.com\/[a-zA-Z0-9/_.-]+\.mp4/gi)

    const bestVid = videos ? [...new Set(videos)][0] : ""
    const bestImg = originalImgs
      ? [...new Set(originalImgs)][0]
      : standardImgs
        ? [...new Set(standardImgs)][0]
        : ""

    if (bestVid || bestImg) {
      const isVideo = Boolean(bestVid)
      const downloadTarget = isVideo ? bestVid : bestImg
      return {
        platform: "pinterest",
        platformName: "Pinterest",
        title,
        author: "Pinterest Criador",
        cover: bestImg || bestVid,
        mediaType: isVideo ? "video" : "image",
        quality: "Resolução Original",
        mp4: bestVid,
        downloadUrl: downloadTarget,
        duration: null,
        original: rawUrl,
      }
    }
  } catch {
    // Fallback
  }
  return null
}

/* =========================================================================
   4. KWAI ENGINE (Mobile follow-redirect scraper)
   ========================================================================= */
async function extractKwaiDirect(rawUrl: string): Promise<UniversalMediaResult | null> {
  try {
    const res = await fetch(rawUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      cache: "no-store",
    })
    const html = await res.text()

    const ogVid =
      html.match(/<meta property="og:video" content="([^"]+)"/)?.[1] ||
      html.match(/<meta property="og:video:url" content="([^"]+)"/)?.[1] ||
      html.match(/https?:\/\/[^"'\s\\]+kwai[^"'\s\\]*\.mp4[^"'\s\\]*/i)?.[0] ||
      ""

    const ogImg =
      html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ||
      html.match(/<meta property="og:image:url" content="([^"]+)"/)?.[1] ||
      ""

    const ogTitle =
      html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || "Vídeo do Kwai"

    if (ogVid) {
      return {
        platform: "kwai",
        platformName: "Kwai",
        title: ogTitle,
        author: "Criador do Kwai",
        cover: ogImg,
        mediaType: "video",
        quality: "HD Sem Marca",
        mp4: ogVid,
        downloadUrl: ogVid,
        duration: null,
        original: rawUrl,
      }
    }
  } catch {
    // Fallback
  }
  return null
}

/* =========================================================================
   MAIN ROUTE HANDLER
   ========================================================================= */
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

  const platformInfo = detectPlatform(rawUrl)
  const platformId = platformInfo ? platformInfo.id : "other"

  try {
    // 1. TIKTOK ENGINE
    if (platformId === "tiktok") {
      try {
        const api = "https://www.tikwm.com/api/?hd=1&url=" + encodeURIComponent(rawUrl)
        const res = await fetch(api, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept: "application/json",
          },
          cache: "no-store",
        })

        if (res.ok) {
          const json = await res.json()
          if (json && json.code === 0 && json.data) {
            const data = json.data
            const mp4: string | undefined = data.hdplay || data.play || data.wmplay
            if (mp4) {
              const result: UniversalMediaResult = {
                platform: "tiktok",
                platformName: "TikTok",
                title: data.title || "Vídeo do TikTok",
                author: data.author?.nickname || data.author?.unique_id || "TikTok Criador",
                authorUniqueId: data.author?.unique_id ? `@${data.author.unique_id}` : "",
                authorAvatar: data.author?.avatar || "",
                cover: data.cover || data.origin_cover || "",
                mediaType: "video",
                quality: data.hdplay ? "HD 1080p (Sem Marca)" : "Qualidade Normal",
                mp4,
                downloadUrl: mp4,
                music: data.music || "",
                musicTitle: data.music_info?.title || "Áudio Original",
                duration: data.duration ?? null,
                original: rawUrl,
              }
              return NextResponse.json(result)
            }
          }
        }
      } catch {
        // Fallback para btch.ttdl
      }

      try {
        const data = await btch.ttdl(rawUrl)
        if (data && (data.video || (data as any).nowm)) {
          const mp4 = (data as any).nowm || data.video
          return NextResponse.json({
            platform: "tiktok",
            platformName: "TikTok",
            title: data.title || "Vídeo do TikTok",
            author: "TikTok Criador",
            cover: data.thumbnail || "",
            mediaType: "video",
            quality: "HD Sem Marca",
            mp4,
            downloadUrl: mp4,
            music: data.audio || "",
            duration: null,
            original: rawUrl,
          })
        }
      } catch {
        // Segue adiante
      }
    }

    // 2. YOUTUBE ENGINE
    if (platformId === "youtube") {
      const innertubeResult = await extractYouTubeInnertube(rawUrl)
      if (innertubeResult) {
        return NextResponse.json(innertubeResult)
      }

      try {
        const data = await btch.youtube(rawUrl)
        if (data && (data.mp4 || data.mp3)) {
          const result: UniversalMediaResult = {
            platform: "youtube",
            platformName: "YouTube",
            title: data.title || "Vídeo do YouTube",
            author: data.author || "Canal do YouTube",
            authorUniqueId: data.author || "",
            cover: data.thumbnail || "",
            mediaType: "video",
            quality: "HD 720p",
            mp4: data.mp4 || "",
            downloadUrl: data.mp4 || data.mp3,
            music: data.mp3 || "",
            musicTitle: data.title ? `${data.title} (Áudio)` : "Áudio do YouTube",
            duration: null,
            original: rawUrl,
          }
          return NextResponse.json(result)
        }
      } catch {
        // Segue adiante
      }
    }

    // 3. TWITTER / X ENGINE
    if (platformId === "twitter") {
      const fxResult = await extractTwitterFx(rawUrl)
      if (fxResult) {
        return NextResponse.json(fxResult)
      }

      try {
        const data = await btch.twitter(rawUrl)
        if (data && data.url) {
          return NextResponse.json({
            platform: "twitter",
            platformName: "Twitter / X",
            title: data.title || "Vídeo do Twitter / X",
            author: "Usuário do X",
            cover: "",
            mediaType: "video",
            quality: "HD",
            mp4: data.url,
            downloadUrl: data.url,
            duration: null,
            original: rawUrl,
          })
        }
      } catch {
        // Segue adiante
      }
    }

    // 4. PINTEREST ENGINE
    if (platformId === "pinterest") {
      const pinDirect = await extractPinterestDirect(rawUrl)
      if (pinDirect) {
        return NextResponse.json(pinDirect)
      }

      try {
        const data = await btch.pinterest(rawUrl)
        if (data && data.result) {
          const resObj = data.result as any
          const directUrl =
            typeof resObj === "string"
              ? resObj
              : resObj.url || resObj.downloadUrl || resObj.video || resObj.videos || resObj.image
          const isVideo = directUrl?.includes(".mp4") || Boolean(resObj.video || resObj.videos)

          if (directUrl) {
            return NextResponse.json({
              platform: "pinterest",
              platformName: "Pinterest",
              title: resObj.title || "Mídia do Pinterest",
              author: resObj.author || "Pinterest Pin",
              cover: resObj.thumbnail || resObj.image || directUrl,
              mediaType: isVideo ? "video" : "image",
              quality: "Resolução Original",
              mp4: isVideo ? directUrl : "",
              downloadUrl: directUrl,
              duration: null,
              original: rawUrl,
            })
          }
        }
      } catch {
        // Segue adiante
      }
    }

    // 5. KWAI ENGINE
    if (platformId === "kwai") {
      const kwaiDirect = await extractKwaiDirect(rawUrl)
      if (kwaiDirect) {
        return NextResponse.json(kwaiDirect)
      }

      try {
        const data = await btch.kuaishou(rawUrl)
        if (data && data.status && data.result) {
          const resObj = data.result as any
          const mp4 = resObj.url || resObj.mp4 || resObj.video
          if (mp4) {
            return NextResponse.json({
              platform: "kwai",
              platformName: "Kwai",
              title: resObj.title || "Vídeo do Kwai",
              author: resObj.author || "Criador do Kwai",
              cover: resObj.thumbnail || resObj.cover || "",
              mediaType: "video",
              quality: "HD Sem Marca",
              mp4,
              downloadUrl: mp4,
              duration: null,
              original: rawUrl,
            })
          }
        }
      } catch {
        // Segue adiante
      }
    }

    // 6. INSTAGRAM ENGINE
    if (platformId === "instagram") {
      try {
        const data = await btch.igdl(rawUrl)
        if (data && data.status && Array.isArray(data.result) && data.result.length > 0) {
          const valid = data.result.find((r) => r.url && r.url.length > 5) || data.result[0]
          if (valid.url) {
            const isVideo =
              valid.url.includes(".mp4") ||
              valid.url.includes("video") ||
              Boolean(valid.thumbnail)

            return NextResponse.json({
              platform: "instagram",
              platformName: "Instagram",
              title: "Publicação do Instagram",
              author: "Instagram Criador",
              cover: valid.thumbnail || valid.url || "",
              mediaType: isVideo ? "video" : "image",
              quality: "Alta Definição",
              mp4: isVideo ? valid.url : "",
              downloadUrl: valid.url,
              duration: null,
              original: rawUrl,
            })
          }
        }
      } catch {
        // Segue adiante
      }
    }

    // 7. FACEBOOK ENGINE
    if (platformId === "facebook") {
      try {
        const data = await btch.fbdown(rawUrl)
        if (data && (data.HD || data.Normal_video)) {
          const mp4 = data.HD || data.Normal_video || ""
          return NextResponse.json({
            platform: "facebook",
            platformName: "Facebook",
            title: "Vídeo do Facebook",
            author: "Página do Facebook",
            cover: "",
            mediaType: "video",
            quality: data.HD ? "HD" : "Normal",
            mp4,
            downloadUrl: mp4,
            duration: null,
            original: rawUrl,
          })
        }
      } catch {
        // Segue adiante
      }
    }

    // Se nenhuma engine retornou sucesso
    return NextResponse.json(
      {
        error:
          "Não conseguimos obter o arquivo deste link no momento. Verifique se a publicação é pública e tente novamente.",
      },
      { status: 422 },
    )
  } catch (err) {
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
