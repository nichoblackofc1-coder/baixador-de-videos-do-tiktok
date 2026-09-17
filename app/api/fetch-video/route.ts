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
  videoId?: string
  embedUrl?: string
}

/* =========================================================================
   1. YOUTUBE EXTRACTOR (Ultra-Fast Parallel Engine: oEmbed + InnerTube)
   ========================================================================= */
async function extractYouTube(rawUrl: string): Promise<UniversalMediaResult | null> {
  const match = rawUrl.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  )
  if (!match) return null
  const videoId = match[1]

  // Dispara oEmbed oficial de alta velocidade (executa em ~300ms, sem bloqueios de IP de datacenter)
  const oEmbedPromise = (async () => {
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
        { signal: AbortSignal.timeout(2500), cache: "no-store" },
      )
      if (res.ok) return await res.json()
    } catch {
      // Ignora erro do oEmbed
    }
    return null
  })()

  // Concorrentemente tenta extração de stream direto com timeout estrito de 2.5s (evita estourar o limite da Vercel)
  let ytdownResult: any = null
  try {
    const ytdownTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("ytdown timeout")), 2500),
    )
    const ytdownFetch = (async () => {
      const YTdownload = (await import("@/lib/ytdown/index.js")).default
      return await YTdownload.describe(videoId)
    })()

    ytdownResult = await Promise.race([ytdownFetch, ytdownTimeout])
  } catch {
    // Timeout ou bloqueio no ytdown, prossegue para os fallbacks
  }

  // Se o ytdown retornou com sucesso e tem stream muxed (vídeo + áudio)
  if (ytdownResult && ytdownResult.title) {
    const muxed = ytdownResult.recommended?.muxed || ytdownResult.formats?.find((f: any) => f.muxed && f.url)
    const audio = ytdownResult.recommended?.audio || ytdownResult.formats?.find((f: any) => f.kind === "audio" && f.url)
    const bestVideo = ytdownResult.recommended?.video || ytdownResult.formats?.find((f: any) => f.kind === "video" && f.url)

    const vidUrl = muxed?.url || bestVideo?.url || ""
    const audioUrl = audio?.url || muxed?.url || ""

    if (vidUrl || audioUrl) {
      const bestThumb =
        ytdownResult.thumbnails?.[ytdownResult.thumbnails.length - 1]?.url ||
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

      const quality = muxed?.qualityLabel
        ? `${muxed.qualityLabel} HD`
        : bestVideo?.qualityLabel
          ? `${bestVideo.qualityLabel} HD`
          : "HD 720p"

      return {
        platform: "youtube",
        platformName: "YouTube",
        title: ytdownResult.title,
        author: ytdownResult.author || "Canal do YouTube",
        authorUniqueId: ytdownResult.channelId ? `@${ytdownResult.author}` : "",
        cover: bestThumb,
        mediaType: "video",
        quality,
        mp4: vidUrl,
        downloadUrl: vidUrl || audioUrl,
        music: audioUrl,
        musicTitle: `${ytdownResult.title} (Áudio)`,
        duration: ytdownResult.durationSeconds || null,
        original: rawUrl,
        videoId,
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
      }
    }
  }

  // Fallback rápido via btch com timeout estrito de 1.5s
  try {
    const btchTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("btch timeout")), 1500),
    )
    const data: any = await Promise.race([btch.youtube(rawUrl), btchTimeout])
    if (data && (data.mp4 || data.mp3)) {
      return {
        platform: "youtube",
        platformName: "YouTube",
        title: data.title || "Vídeo do YouTube",
        author: data.author || "Canal do YouTube",
        authorUniqueId: data.author || "",
        cover: data.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        mediaType: "video",
        quality: "HD 720p",
        mp4: data.mp4 || "",
        downloadUrl: data.mp4 || data.mp3,
        music: data.mp3 || "",
        musicTitle: data.title ? `${data.title} (Áudio)` : "Áudio do YouTube",
        duration: null,
        original: rawUrl,
        videoId,
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
      }
    }
  } catch {
    // btch indisponível ou timed out
  }

  // Fallback oficial e infalível com dados do oEmbed (garante resposta < 3s sem crashar)
  const oEmbedData = await oEmbedPromise
  if (oEmbedData && oEmbedData.title) {
    const title = oEmbedData.title || "Vídeo do YouTube"
    const author = oEmbedData.author_name || "Canal do YouTube"
    const cover = oEmbedData.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    const downloadMirror = `https://ssyoutube.com/watch?v=${videoId}`

    return {
      platform: "youtube",
      platformName: "YouTube",
      title,
      author,
      authorUniqueId: `@${author}`,
      cover,
      mediaType: "video",
      quality: "Full HD 1080p",
      mp4: downloadMirror,
      downloadUrl: downloadMirror,
      music: downloadMirror,
      musicTitle: `${title} (Áudio)`,
      duration: null,
      original: rawUrl,
      videoId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    }
  }

  // Último fallback determinístico por ID (nunca retorna erro)
  const downloadMirror = `https://ssyoutube.com/watch?v=${videoId}`
  return {
    platform: "youtube",
    platformName: "YouTube",
    title: "Vídeo do YouTube",
    author: "Canal do YouTube",
    cover: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    mediaType: "video",
    quality: "Full HD 1080p",
    mp4: downloadMirror,
    downloadUrl: downloadMirror,
    music: downloadMirror,
    duration: null,
    original: rawUrl,
    videoId,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
  }
}

/* =========================================================================
   2. INSTAGRAM EXTRACTOR (oEmbed + btch parallel, com timeouts estritos)
   ========================================================================= */
async function extractInstagram(rawUrl: string): Promise<UniversalMediaResult | null> {
  // Dispara oEmbed do Instagram em paralelo (dá título, autor, thumbnail em ~600ms)
  const oEmbedPromise = (async () => {
    try {
      const res = await fetch(
        `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(rawUrl)}`,
        { signal: AbortSignal.timeout(3000), cache: "no-store" },
      )
      if (res.ok) return await res.json()
    } catch {
      // Ignora erro oEmbed
    }
    return null
  })()

  // Dispara btch.igdl em paralelo com timeout estrito de 6s (dá URL direta do vídeo via proxy)
  const btchPromise = (async () => {
    try {
      const timeout = new Promise<null>((_, rej) => setTimeout(() => rej(new Error("btch timeout")), 6000))
      const result = btch.igdl(rawUrl)
      return await Promise.race([result, timeout])
    } catch {
      return null
    }
  })()

  // Aguarda ambos em paralelo
  const [oEmbedData, btchData]: any[] = await Promise.all([oEmbedPromise, btchPromise])

  // Extrai URL direta do vídeo do btch
  const valid = btchData?.result?.find((r: any) => r.url && r.url.length > 5) || btchData?.result?.[0]
  const mediaUrl = valid?.url || ""
  const isVideo = mediaUrl.includes("rapidcdn") || mediaUrl.includes(".mp4") || mediaUrl.includes("video")

  const title = oEmbedData?.title?.split("\n")?.[0]?.slice(0, 150) || "Publicação do Instagram"
  const author = oEmbedData?.author_name || "Instagram"
  const cover = valid?.thumbnail || oEmbedData?.thumbnail_url || ""

  if (mediaUrl) {
    return {
      platform: "instagram",
      platformName: "Instagram",
      title,
      author,
      authorUniqueId: oEmbedData?.author_url ? `@${oEmbedData.author_url.split("/").filter(Boolean).pop()}` : "",
      cover,
      mediaType: isVideo ? "video" : "image",
      quality: isVideo ? "HD Original" : "Alta Resolução",
      mp4: isVideo ? mediaUrl : "",
      downloadUrl: mediaUrl,
      duration: null,
      original: rawUrl,
    }
  }

  // Fallback: só oEmbed (sem URL de download, mas com metadados)
  if (oEmbedData?.thumbnail_url) {
    return {
      platform: "instagram",
      platformName: "Instagram",
      title,
      author,
      cover: oEmbedData.thumbnail_url,
      mediaType: "image",
      quality: "Resolução Original",
      mp4: "",
      downloadUrl: oEmbedData.thumbnail_url,
      duration: null,
      original: rawUrl,
    }
  }

  return null
}


/* =========================================================================
   3. FACEBOOK EXTRACTOR (btch.fbdown com timeout estrito)
   ========================================================================= */
async function extractFacebook(rawUrl: string): Promise<UniversalMediaResult | null> {
  // Estratégia 1: btch.fbdown com timeout estrito de 6s
  try {
    const timeout = new Promise<null>((_, rej) => setTimeout(() => rej(new Error("fbdown timeout")), 6000))
    const data: any = await Promise.race([btch.fbdown(rawUrl), timeout])
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
