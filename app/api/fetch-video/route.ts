import { type NextRequest, NextResponse } from "next/server"
import { detectPlatform, type PlatformId } from "@/lib/platform-detector"
import * as btch from "btch-downloader"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

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
   1. YOUTUBE EXTRACTOR (Invidious Multi-Node + Innertube Failover)
   ========================================================================= */
const INVIDIOUS_INSTANCES = [
  "https://invidious.f5.si",
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://yt.chocolatemoo53.com",
  "https://invidious.tiekoetter.com",
]

async function extractYouTube(rawUrl: string): Promise<UniversalMediaResult | null> {
  const match = rawUrl.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  )
  if (!match) return null
  const videoId = match[1]

  // Estratégia 1: Engine nativa especializada YTdownload (Gera URLs n-transformadas com áudio e vídeo muxed em MP4)
  try {
    const YTdownload = (await import("@/lib/ytdown/index.js")).default
    const desc = await YTdownload.describe(videoId)
    if (desc && desc.title) {
      const muxed = desc.recommended.muxed || desc.formats.find((f: any) => f.muxed && f.url)
      const audio = desc.recommended.audio || desc.formats.find((f: any) => f.kind === "audio" && f.url)
      const bestVideo = desc.recommended.video || desc.formats.find((f: any) => f.kind === "video" && f.url)

      const vidUrl = muxed?.url || bestVideo?.url || ""
      const audioUrl = audio?.url || muxed?.url || ""

      if (vidUrl || audioUrl) {
        const bestThumb =
          desc.thumbnails?.[desc.thumbnails.length - 1]?.url ||
          `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

        const quality = muxed?.qualityLabel
          ? `${muxed.qualityLabel} HD`
          : bestVideo?.qualityLabel
            ? `${bestVideo.qualityLabel} HD`
            : "HD 720p"

        return {
          platform: "youtube",
          platformName: "YouTube",
          title: desc.title,
          author: desc.author || "Canal do YouTube",
          authorUniqueId: desc.channelId ? `@${desc.author}` : "",
          cover: bestThumb,
          mediaType: "video",
          quality,
          mp4: vidUrl,
          downloadUrl: vidUrl || audioUrl,
          music: audioUrl,
          musicTitle: `${desc.title} (Áudio)`,
          duration: desc.durationSeconds || null,
          original: rawUrl,
        }
      }
    }
  } catch (err) {
    console.warn("[YouTube] ytdown extractor falhou, tentando fallback Invidious:", err)
  }

  // Estratégia 2: Invidious Instances (Suporta qualquer vídeo público, inclusive restritos e músicas)
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${base}/api/v1/videos/${videoId}`, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      })
      if (!res.ok) continue
      const data = await res.json()
      if (!data || !data.title) continue

      // Tenta formato progressivo primeiro (vídeo + áudio embutido)
      const progressive = (data.formatStreams || []).find(
        (f: any) => f.url && f.type?.includes("video/mp4"),
      )

      // Se não houver progressivo, pega o melhor formato MP4 H.264 (evita AV1 não suportado por browsers e arquivos gigantescos)
      const adaptiveMp4s = (data.adaptiveFormats || []).filter(
        (f: any) =>
          f.url &&
          f.type?.includes("video/mp4") &&
          !f.type?.includes("av01"),
      )

      // Ordena decrescente até 1080p (qualidade Full HD ideal, tamanho leve e alta velocidade)
      adaptiveMp4s.sort((a: any, b: any) => {
        const ha = parseInt(a.qualityLabel || a.resolution || "0") || a.height || 0
        const hb = parseInt(b.qualityLabel || b.resolution || "0") || b.height || 0
        const capA = ha > 1080 ? 0 : ha
        const capB = hb > 1080 ? 0 : hb
        return capB - capA
      })
      const bestAdaptive = adaptiveMp4s[0]

      // Áudio para download opcional em MP3/AAC
      const audio = (data.adaptiveFormats || []).find(
        (f: any) => f.url && f.type?.startsWith("audio/"),
      )

      const vidUrl = progressive?.url || bestAdaptive?.url || ""
      const audioUrl = audio?.url || ""

      if (vidUrl || audioUrl) {
        const thumbs = data.videoThumbnails || []
        const bestThumb =
          thumbs.sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0]?.url ||
          `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

        const rawQuality =
          progressive?.qualityLabel ||
          bestAdaptive?.qualityLabel ||
          bestAdaptive?.resolution ||
          "HD 720p"
        const quality = rawQuality.includes("1080")
          ? "1080p Full HD"
          : rawQuality.includes("720")
            ? "720p HD"
            : rawQuality

        return {
          platform: "youtube",
          platformName: "YouTube",
          title: data.title,
          author: data.author || "Canal do YouTube",
          authorUniqueId: data.authorId ? `@${data.author}` : "",
          authorAvatar: data.authorThumbnails?.[0]?.url || "",
          cover: bestThumb,
          mediaType: "video",
          quality,
          mp4: vidUrl,
          downloadUrl: vidUrl || audioUrl,
          music: audioUrl,
          musicTitle: `${data.title} (Áudio)`,
          duration: Number(data.lengthSeconds) || null,
          original: rawUrl,
        }
      }
    } catch {
      // Tenta próxima instância do Invidious
    }
  }

  // Estratégia 2: Innertube Direct Player
  const clients = [
    {
      name: "ANDROID_VR",
      context: { client: { clientName: "ANDROID_VR", clientVersion: "1.62.27", hl: "en", gl: "US" } },
      userAgent: "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12; Quest 3) gzip",
    },
    {
      name: "IOS",
      context: { client: { clientName: "IOS", clientVersion: "20.10.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en", gl: "US" } },
      userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; en_US)",
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
      // Próximo cliente
    }
  }

  // Estratégia 3: btch.youtube fallback
  try {
    const data = await btch.youtube(rawUrl)
    if (data && (data.mp4 || data.mp3)) {
      return {
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
    }
  } catch {}

  return null
}

/* =========================================================================
   2. INSTAGRAM EXTRACTOR (Snapsave Core + Direct Scraper Fallback)
   ========================================================================= */
async function extractInstagram(rawUrl: string): Promise<UniversalMediaResult | null> {
  // Estratégia 1: snapsave-media-downloader (Mais recente e estável)
  try {
    const { snapsave } = await import("snapsave-media-downloader")
    const res = await snapsave(rawUrl)
    if (res && res.success && res.data?.media && res.data.media.length > 0) {
      const first = res.data.media[0]
      const mediaUrl = first.url || ""
      const isVideo = first.type === "video" || mediaUrl.includes(".mp4")
      if (mediaUrl) {
        return {
          platform: "instagram",
          platformName: "Instagram",
          title: "Publicação do Instagram",
          author: "Instagram Criador",
          cover: first.thumbnail || mediaUrl,
          mediaType: isVideo ? "video" : "image",
          quality: isVideo ? "HD Original" : "Alta Resolução",
          mp4: isVideo ? mediaUrl : "",
          downloadUrl: mediaUrl,
          duration: null,
          original: rawUrl,
        }
      }
    }
  } catch {}

  // Estratégia 2: btch.igdl
  try {
    const data = await btch.igdl(rawUrl)
    if (data && data.status && Array.isArray(data.result) && data.result.length > 0) {
      const valid = data.result.find((r: any) => r.url && r.url.length > 5) || data.result[0]
      if (valid && valid.url) {
        const isVideo = valid.url.includes(".mp4") || valid.url.includes("video")
        return {
          platform: "instagram",
          platformName: "Instagram",
          title: "Publicação do Instagram",
          author: "Instagram Criador",
          cover: valid.thumbnail || valid.url,
          mediaType: isVideo ? "video" : "image",
          quality: "Alta Resolução",
          mp4: isVideo ? valid.url : "",
          downloadUrl: valid.url,
          duration: null,
          original: rawUrl,
        }
      }
    }
  } catch {}

  return null
}

/* =========================================================================
   3. FACEBOOK EXTRACTOR (Snapsave Core + btch.fbdown Fallback)
   ========================================================================= */
async function extractFacebook(rawUrl: string): Promise<UniversalMediaResult | null> {
  // Estratégia 1: snapsave-media-downloader
  try {
    const { snapsave } = await import("snapsave-media-downloader")
    const res = await snapsave(rawUrl)
    if (res && res.success && res.data?.media && res.data.media.length > 0) {
      // Pega a versão com maior resolução (HD preferencial)
      const hdVid =
        res.data.media.find((m: any) => m.resolution?.includes("HD") || m.resolution?.includes("720") || m.resolution?.includes("1080")) ||
        res.data.media[0]

      if (hdVid && hdVid.url) {
        return {
          platform: "facebook",
          platformName: "Facebook",
          title: res.data.description || "Vídeo do Facebook",
          author: "Página do Facebook",
          cover: res.data.preview || "",
          mediaType: "video",
          quality: hdVid.resolution || "HD",
          mp4: hdVid.url,
          downloadUrl: hdVid.url,
          duration: null,
          original: rawUrl,
        }
      }
    }
  } catch {}

  // Estratégia 2: btch.fbdown
  try {
    const data = await btch.fbdown(rawUrl)
    if (data && (data.HD || data.Normal_video)) {
      const mp4 = data.HD || data.Normal_video || ""
      return {
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
      }
    }
  } catch {}

  return null
}

/* =========================================================================
   4. TWITTER / X EXTRACTOR (fxtwitter + vxtwitter API)
   ========================================================================= */
async function extractTwitter(rawUrl: string): Promise<UniversalMediaResult | null> {
  const match = rawUrl.match(/(?:twitter\.com|x\.com)\/(?:[a-zA-Z0-9_]+)\/status\/([0-9]+)/)
  if (!match) return null
  const tweetId = match[1]

  // Estratégia 1: fxtwitter
  try {
    const res = await fetch(`https://api.fxtwitter.com/status/${tweetId}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
    if (res.ok) {
      const data = await res.json()
      const tweet = data.tweet
      if (tweet) {
        const video = tweet.media?.videos?.[0]
        const photo = tweet.media?.photos?.[0]
        const mp4 = video?.url || ""
        const isVideo = Boolean(mp4)
        const cover = video?.thumbnail_url || photo?.url || ""
        const downloadUrl = mp4 || photo?.url || ""

        if (downloadUrl) {
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
        }
      }
    }
  } catch {}

  // Estratégia 2: vxtwitter
  try {
    const res = await fetch(`https://api.vxtwitter.com/status/${tweetId}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
    if (res.ok) {
      const tweet = await res.json()
      if (tweet) {
        const mp4 = tweet.video_url || tweet.mediaURLs?.[0] || ""
        const isVideo = Boolean(tweet.video_url || mp4?.includes(".mp4"))
        if (mp4) {
          return {
            platform: "twitter",
            platformName: "Twitter / X",
            title: tweet.text?.slice(0, 150) || "Publicação do X (Twitter)",
            author: tweet.user_name || tweet.user_screen_name || "Usuário do X",
            authorUniqueId: tweet.user_screen_name ? `@${tweet.user_screen_name}` : "",
            cover: tweet.mediaURLs?.[0] || "",
            mediaType: isVideo ? "video" : "image",
            quality: isVideo ? "HD" : "Alta Resolução",
            mp4: isVideo ? mp4 : "",
            downloadUrl: mp4,
            duration: null,
            original: rawUrl,
          }
        }
      }
    }
  } catch {}

  // Estratégia 3: btch.twitter
  try {
    const data = await btch.twitter(rawUrl)
    if (data && data.url) {
      return {
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
      }
    }
  } catch {}

  return null
}

/* =========================================================================
   5. PINTEREST EXTRACTOR (Direct Googlebot CDN original scraper + btch)
   ========================================================================= */
async function extractPinterest(rawUrl: string): Promise<UniversalMediaResult | null> {
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
  } catch {}

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
        return {
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
        }
      }
    }
  } catch {}

  return null
}

/* =========================================================================
   6. KWAI EXTRACTOR (Mobile follow-redirect scraper + btch)
   ========================================================================= */
async function extractKwai(rawUrl: string): Promise<UniversalMediaResult | null> {
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
  } catch {}

  try {
    const data = await btch.kuaishou(rawUrl)
    if (data && data.status && data.result) {
      const resObj = data.result as any
      const mp4 = resObj.url || resObj.mp4 || resObj.video
      if (mp4) {
        return {
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
        }
      }
    }
  } catch {}

  return null
}

/* =========================================================================
   7. TIKTOK EXTRACTOR (TikWM HD API + btch fallback)
   ========================================================================= */
async function extractTikTok(rawUrl: string): Promise<UniversalMediaResult | null> {
  // Resolve redirecionamento de links encurtados (vm.tiktok.com, vt.tiktok.com)
  let targetUrl = rawUrl
  if (rawUrl.includes("vm.tiktok.com") || rawUrl.includes("vt.tiktok.com")) {
    try {
      const head = await fetch(rawUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        redirect: "follow",
      })
      if (head.url && head.url.includes("tiktok.com")) {
        targetUrl = head.url
      }
    } catch {}
  }

  // Estratégia 1: TikWM POST (Formato mais estável e recomendado)
  try {
    const params = new URLSearchParams()
    params.append("url", targetUrl)
    params.append("hd", "1")
    const res = await fetch("https://www.tikwm.com/api/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      body: params.toString(),
      cache: "no-store",
    })

    if (res.ok) {
      const json = await res.json()
      if (json && json.code === 0 && json.data) {
        const data = json.data
        const mp4: string | undefined = data.hdplay || data.play || data.wmplay
        if (mp4 && typeof mp4 === "string" && mp4.startsWith("http")) {
          return {
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
            music: typeof data.music === "string" && data.music.startsWith("http") ? data.music : "",
            musicTitle: data.music_info?.title || "Áudio Original",
            duration: data.duration ?? null,
            original: rawUrl,
          }
        }
      }
    }
  } catch {}

  // Estratégia 2: TikWM GET
  try {
    const api = "https://www.tikwm.com/api/?hd=1&url=" + encodeURIComponent(targetUrl)
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
        if (mp4 && typeof mp4 === "string" && mp4.startsWith("http")) {
          return {
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
            music: typeof data.music === "string" && data.music.startsWith("http") ? data.music : "",
            musicTitle: data.music_info?.title || "Áudio Original",
            duration: data.duration ?? null,
            original: rawUrl,
          }
        }
      }
    }
  } catch {}

  // Estratégia 3: btch.ttdl com checagem segura de array
  try {
    const data = await btch.ttdl(targetUrl)
    if (data) {
      const rawMp4 = (data as any).nowm || data.video
      const mp4 = Array.isArray(rawMp4)
        ? rawMp4.find((v: any) => typeof v === "string" && v.startsWith("http")) || ""
        : typeof rawMp4 === "string" && rawMp4.startsWith("http")
          ? rawMp4
          : ""

      const rawAudio = data.audio
      const music = Array.isArray(rawAudio)
        ? rawAudio.find((a: any) => typeof a === "string" && a.startsWith("http")) || ""
        : typeof rawAudio === "string" && rawAudio.startsWith("http")
          ? rawAudio
          : ""

      if (mp4) {
        return {
          platform: "tiktok",
          platformName: "TikTok",
          title: data.title || "Vídeo do TikTok",
          author: "TikTok Criador",
          cover: typeof data.thumbnail === "string" ? data.thumbnail : "",
          mediaType: "video",
          quality: "HD Sem Marca",
          mp4,
          downloadUrl: mp4,
          music,
          duration: null,
          original: rawUrl,
        }
      }
    }
  } catch {}

  return null
}

/* =========================================================================
   8. UNIVERSAL FALLBACK SCRAPER (OpenGraph / HTML5 video)
   ========================================================================= */
async function extractUniversalFallback(rawUrl: string): Promise<UniversalMediaResult | null> {
  // Tenta snapsave como fallback universal (reconhece IG, FB, TT, etc.)
  try {
    const { snapsave } = await import("snapsave-media-downloader")
    const res = await snapsave(rawUrl)
    if (res && res.success && res.data?.media && res.data.media.length > 0) {
      const first = res.data.media[0]
      const mediaUrl = first.url || ""
      const isVideo = first.type === "video" || mediaUrl.includes(".mp4")
      if (mediaUrl) {
        return {
          platform: "other",
          platformName: "Download Direto",
          title: typeof res.data.description === "string" ? res.data.description : "Mídia Baixada",
          author: "Criador",
          cover: first.thumbnail || (typeof res.data.preview === "string" ? res.data.preview : "") || mediaUrl,
          mediaType: isVideo ? "video" : "image",
          quality: first.resolution || "HD Original",
          mp4: isVideo ? mediaUrl : "",
          downloadUrl: mediaUrl,
          duration: null,
          original: rawUrl,
        }
      }
    }
  } catch {}

  // Scraper genérico de meta tags
  try {
    const res = await fetch(rawUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      cache: "no-store",
    })
    const html = await res.text()

    const ogVid =
      html.match(/<meta property="og:video" content="([^"]+)"/)?.[1] ||
      html.match(/<meta property="og:video:url" content="([^"]+)"/)?.[1] ||
      html.match(/<meta property="og:video:secure_url" content="([^"]+)"/)?.[1]

    const ogImg =
      html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ||
      html.match(/<meta property="og:image:url" content="([^"]+)"/)?.[1]

    const title =
      html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ||
      html.match(/<title>([^<]+)<\/title>/)?.[1] ||
      "Conteúdo Multimídia"

    if (ogVid || ogImg) {
      const isVideo = Boolean(ogVid)
      const downloadUrl = ogVid || ogImg || ""
      return {
        platform: "other",
        platformName: "Mídia Online",
        title: title.replace(/\s+/g, " ").trim(),
        author: "Autor Público",
        cover: ogImg || ogVid || "",
        mediaType: isVideo ? "video" : "image",
        quality: "Original",
        mp4: ogVid || "",
        downloadUrl,
        duration: null,
        original: rawUrl,
      }
    }
  } catch {}

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
    let result: UniversalMediaResult | null = null

    switch (platformId) {
      case "youtube":
        result = await extractYouTube(rawUrl)
        break
      case "instagram":
        result = await extractInstagram(rawUrl)
        break
      case "facebook":
        result = await extractFacebook(rawUrl)
        break
      case "twitter":
        result = await extractTwitter(rawUrl)
        break
      case "pinterest":
        result = await extractPinterest(rawUrl)
        break
      case "kwai":
        result = await extractKwai(rawUrl)
        break
      case "tiktok":
        result = await extractTikTok(rawUrl)
        break
      default:
        result = await extractUniversalFallback(rawUrl)
        break
    }

    // Se o extrator primário da rede específica falhou, tenta o fallback universal inteligente
    if (!result && platformId !== "other") {
      result = await extractUniversalFallback(rawUrl)
    }

    if (result) {
      const validMp4 = typeof result.mp4 === "string" && result.mp4.startsWith("http") ? result.mp4 : ""
      const validDl = typeof result.downloadUrl === "string" && result.downloadUrl.startsWith("http") ? result.downloadUrl : ""
      const validMusic = typeof result.music === "string" && result.music.startsWith("http") ? result.music : ""
      const validCover = typeof result.cover === "string" && result.cover.startsWith("http") ? result.cover : ""

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
