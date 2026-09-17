import { execFile, execSync } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs"
import { detectPlatform, type PlatformId } from "./platform-detector"

const execFileAsync = promisify(execFile)

// Caminho do FFmpeg embutido no Python do sistema (Windows local)
const DEFAULT_FFMPEG =
  "C:\\Users\\eusou\\AppData\\Local\\Programs\\Python\\Python312\\Lib\\site-packages\\imageio_ffmpeg\\binaries\\ffmpeg-win-x86_64-v7.1.exe"

export function getFfmpegPath(): string {
  try {
    if (fs.existsSync(DEFAULT_FFMPEG)) {
      return DEFAULT_FFMPEG
    }
  } catch {}
  return "ffmpeg"
}

/** Verifica de forma segura e síncrona se o Python está disponível no ambiente */
let _pythonAvailable: boolean | null = null
export function isPythonAvailable(): boolean {
  if (_pythonAvailable !== null) return _pythonAvailable
  try {
    execSync("python --version", { stdio: "ignore", timeout: 2000 })
    _pythonAvailable = true
  } catch {
    _pythonAvailable = false
  }
  return _pythonAvailable
}

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

/** Executa yt-dlp e retorna metadados completos em JSON de forma segura */
export async function runYtDlpJson(targetUrl: string, extraArgs: string[] = []): Promise<any | null> {
  if (!isPythonAvailable()) {
    return null
  }

  const ffmpegPath = getFfmpegPath()
  const args = [
    "-m",
    "yt_dlp",
    "--dump-single-json",
    "--no-playlist",
    "--remote-components",
    "ejs:github",
    "--ffmpeg-location",
    ffmpegPath,
    "--js-runtimes",
    "node",
    ...extraArgs,
    targetUrl,
  ]

  try {
    const { stdout } = await execFileAsync("python", args, {
      maxBuffer: 25 * 1024 * 1024,
      timeout: 30000,
    })
    return JSON.parse(stdout)
  } catch (err: any) {
    console.warn(`[yt-dlp] Falha ao extrair JSON para ${targetUrl.slice(0, 60)}:`, err?.message || err)
    return null
  }
}

/* =========================================================================
   1. YOUTUBE EXTRACTOR (Suporta 100% localhost E produção/Vercel)
   ========================================================================= */
export async function extractYouTube(rawUrl: string): Promise<UniversalMediaResult | null> {
  const match = rawUrl.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  )
  if (!match) return null
  const videoId = match[1]
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`

  // 1. Scraping direto do HTML oficial do YouTube (funciona em 100% dos servidores, sem bloqueios de IP)
  const htmlPromise = (async () => {
    try {
      const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(3500),
        cache: "no-store",
      })
      if (res.ok) {
        const html = await res.text()
        const titleMatch = html.match(/<title>([^<]+)<\/title>/)
        const authorMatch =
          html.match(/"ownerChannelName":"([^"]+)"/) || html.match(/"author":"([^"]+)"/)
        return {
          title: titleMatch ? titleMatch[1].replace(/\s*-\s*YouTube$/i, "").trim() : null,
          author: authorMatch ? authorMatch[1] : null,
        }
      }
    } catch {}
    return null
  })()

  // 2. oEmbed oficial (resposta rápida em < 500ms)
  const oEmbedPromise = (async () => {
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
        { signal: AbortSignal.timeout(3000), cache: "no-store" },
      )
      if (res.ok) return await res.json()
    } catch {}
    return null
  })()

  // 3. yt-dlp se disponível localmente
  const ytDlpPromise = isPythonAvailable() ? runYtDlpJson(canonicalUrl) : Promise.resolve(null)

  const [htmlData, oEmbedData, ytData] = await Promise.all([
    htmlPromise,
    oEmbedPromise,
    ytDlpPromise,
  ])

  const title = ytData?.title || oEmbedData?.title || htmlData?.title || "Vídeo do YouTube"
  const author =
    ytData?.uploader || ytData?.channel || oEmbedData?.author_name || htmlData?.author || "Canal do YouTube"
  const authorUniqueId = ytData?.uploader_id ? `@${ytData.uploader_id}` : `@${author}`
  const cover =
    ytData?.thumbnail ||
    oEmbedData?.thumbnail_url ||
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  const duration = ytData?.duration ?? null

  return {
    platform: "youtube",
    platformName: "YouTube",
    title,
    author,
    authorUniqueId,
    cover,
    mediaType: "video",
    quality: "Full HD 1080p",
    // Retorna a URL canônica limpa (o componente e a rota de download resolvem sem double-wrapping)
    mp4: canonicalUrl,
    downloadUrl: canonicalUrl,
    music: canonicalUrl,
    musicTitle: `${title} (Áudio MP3)`,
    duration,
    original: canonicalUrl,
    videoId,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
  }
}

/* =========================================================================
   2. INSTAGRAM EXTRACTOR (btch.igdl puro Node.js + yt-dlp fallback)
   ========================================================================= */
export async function extractInstagram(rawUrl: string): Promise<UniversalMediaResult | null> {
  // Estratégia 1: Extração direta pura Node.js via btch.igdl e oEmbed em paralelo (funciona 100% na Vercel e Localhost)
  try {
    const [btchRes, oembedRes] = await Promise.all([
      import("btch-downloader")
        .then((m) => (m.default || m).igdl(rawUrl))
        .catch(() => null),
      fetch(`https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(rawUrl)}`, {
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])

    const validMedia = btchRes?.result?.find((r: any) => r.url && r.url.length > 5)
    if (validMedia?.url) {
      const title =
        oembedRes?.title?.split("\n")?.[0]?.slice(0, 150) ||
        "Vídeo do Instagram"
      const author = oembedRes?.author_name || "Instagram"
      const cover = validMedia.thumbnail || oembedRes?.thumbnail_url || ""
      const directUrl = validMedia.url

      return {
        platform: "instagram",
        platformName: "Instagram",
        title: title.replace(/\s+/g, " ").trim(),
        author,
        authorUniqueId: `@${author}`,
        cover,
        mediaType: "video",
        quality: "HD Original",
        mp4: directUrl,
        downloadUrl: directUrl,
        music: directUrl,
        musicTitle: `${title} (Áudio)`,
        duration: null,
        original: rawUrl,
      }
    }
  } catch (err) {
    console.warn("[Instagram Extractor] Erro no btch.igdl:", err)
  }

  // Estratégia 2: yt-dlp local se Python estiver disponível
  if (isPythonAvailable()) {
    const data = await runYtDlpJson(rawUrl)
    if (data) {
      const title =
        data.title ||
        data.description?.split("\n")?.[0]?.slice(0, 150) ||
        `Vídeo de @${data.uploader || "instagram"}`
      const author = data.uploader || data.channel || "Instagram"
      const authorUniqueId = data.uploader_id ? `@${data.uploader_id}` : `@${author}`
      const cover = data.thumbnail || ""
      const directUrl = data.url || (data.formats ? data.formats[data.formats.length - 1]?.url : "")
      const isVideo = Boolean(directUrl && !directUrl.includes(".jpg") && !directUrl.includes(".webp"))

      if (directUrl) {
        return {
          platform: "instagram",
          platformName: "Instagram",
          title: title.replace(/\s+/g, " ").trim(),
          author,
          authorUniqueId,
          cover,
          mediaType: isVideo ? "video" : "image",
          quality: "HD Original",
          mp4: isVideo ? directUrl : "",
          downloadUrl: directUrl,
          music: directUrl,
          musicTitle: `${title} (Áudio)`,
          duration: data.duration ?? null,
          original: rawUrl,
        }
      }
    }
  }

  return null
}

/* =========================================================================
   3. TIKTOK EXTRACTOR (TikWM POST puro Node.js + yt-dlp fallback)
   ========================================================================= */
export async function extractTikTok(rawUrl: string): Promise<UniversalMediaResult | null> {
  let targetUrl = rawUrl
  if (rawUrl.includes("vm.tiktok.com") || rawUrl.includes("vt.tiktok.com")) {
    try {
      const head = await fetch(rawUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(4000),
      })
      if (head.url && head.url.includes("tiktok.com")) {
        targetUrl = head.url
      }
    } catch {}
  }

  // Estratégia 1: TikWM POST API (Puro Node.js, funciona perfeitamente em Vercel e Localhost)
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
      signal: AbortSignal.timeout(6000),
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
            music:
              typeof data.music === "string" && data.music.startsWith("http")
                ? data.music
                : mp4,
            musicTitle: data.music_info?.title || "Áudio Original",
            duration: data.duration ?? null,
            original: rawUrl,
          }
        }
      }
    }
  } catch {}

  // Estratégia 2: yt-dlp local com impersonação de Chrome
  if (isPythonAvailable()) {
    const ytData = await runYtDlpJson(targetUrl, ["--impersonate", "chrome"])
    if (ytData && ytData.url) {
      return {
        platform: "tiktok",
        platformName: "TikTok",
        title: ytData.title || "Vídeo do TikTok",
        author: ytData.uploader || "TikTok Criador",
        authorUniqueId: ytData.uploader_id ? `@${ytData.uploader_id}` : "",
        cover: ytData.thumbnail || "",
        mediaType: "video",
        quality: "HD Sem Marca",
        mp4: ytData.url,
        downloadUrl: ytData.url,
        music: ytData.url,
        duration: ytData.duration ?? null,
        original: rawUrl,
      }
    }
  }

  return null
}

/* =========================================================================
   4. FACEBOOK EXTRACTOR (snapsave puro Node.js + yt-dlp fallback)
   ========================================================================= */
export async function extractFacebook(rawUrl: string): Promise<UniversalMediaResult | null> {
  // Estratégia 1: snapsave-media-downloader (Puro Node.js, funciona em Vercel e Localhost)
  try {
    const { snapsave } = await import("snapsave-media-downloader")
    const snapRes = await snapsave(rawUrl)
    if (snapRes && snapRes.success && snapRes.data?.media?.length) {
      const best = snapRes.data.media[0]
      if (best.url) {
        return {
          platform: "facebook",
          platformName: "Facebook",
          title: snapRes.data.description || "Vídeo do Facebook",
          author: "Página do Facebook",
          cover: snapRes.data.preview || "",
          mediaType: "video",
          quality: best.resolution || "HD",
          mp4: best.url,
          downloadUrl: best.url,
          music: best.url,
          duration: null,
          original: rawUrl,
        }
      }
    }
  } catch {}

  // Estratégia 2: yt-dlp local
  if (isPythonAvailable()) {
    const data = await runYtDlpJson(rawUrl)
    if (data) {
      const directUrl = data.url || (data.formats ? data.formats[data.formats.length - 1]?.url : "")
      if (directUrl) {
        return {
          platform: "facebook",
          platformName: "Facebook",
          title: data.title || data.description?.split("\n")?.[0]?.slice(0, 150) || "Vídeo do Facebook",
          author: data.uploader || "Página do Facebook",
          authorUniqueId: data.uploader_id ? `@${data.uploader_id}` : "",
          cover: data.thumbnail || "",
          mediaType: "video",
          quality: "HD Original",
          mp4: directUrl,
          downloadUrl: directUrl,
          music: directUrl,
          duration: data.duration ?? null,
          original: rawUrl,
        }
      }
    }
  }

  return null
}

/* =========================================================================
   5. TWITTER / X EXTRACTOR (fxtwitter puro Node.js + yt-dlp fallback)
   ========================================================================= */
export async function extractTwitter(rawUrl: string): Promise<UniversalMediaResult | null> {
  const match = rawUrl.match(/(?:twitter\.com|x\.com)\/(?:[a-zA-Z0-9_]+)\/status\/([0-9]+)/)
  if (!match) return null
  const tweetId = match[1]

  try {
    const res = await fetch(`https://api.fxtwitter.com/status/${tweetId}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
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
            music: isVideo ? mp4 : undefined,
            duration: null,
            original: rawUrl,
          }
        }
      }
    }
  } catch {}

  if (isPythonAvailable()) {
    const ytData = await runYtDlpJson(rawUrl)
    if (ytData && ytData.url) {
      return {
        platform: "twitter",
        platformName: "Twitter / X",
        title: ytData.title || "Vídeo do Twitter / X",
        author: ytData.uploader || "Usuário do X",
        cover: ytData.thumbnail || "",
        mediaType: "video",
        quality: "HD",
        mp4: ytData.url,
        downloadUrl: ytData.url,
        music: ytData.url,
        duration: ytData.duration ?? null,
        original: rawUrl,
      }
    }
  }

  return null
}

/* =========================================================================
   6. PINTEREST & KWAI EXTRACTORS
   ========================================================================= */
export async function extractPinterest(rawUrl: string): Promise<UniversalMediaResult | null> {
  // Scraper de meta tags de alta resolução puro Node.js
  try {
    const res = await fetch(rawUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    })
    const html = await res.text()

    const rawTitle =
      html.match(/<title>([^<]+)<\/title>/)?.[1] ||
      html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ||
      "Pin do Pinterest"
    const title = rawTitle.replace(/\s*-\s*Pinterest.*$/i, "").trim() || "Pin do Pinterest"

    const videos = html.match(/https:\/\/[a-zA-Z0-9_.-]*pinimg\.com\/[a-zA-Z0-9/_.-]+\.mp4/gi)
    const images = html.match(/https:\/\/i\.pinimg\.com\/originals\/[a-zA-Z0-9/_.-]+\.(jpg|jpeg|png|webp)/gi)
    const standardImages = html.match(/https:\/\/i\.pinimg\.com\/736x\/[a-zA-Z0-9/_.-]+\.(jpg|jpeg|png|webp)/gi)

    const bestVid = videos ? [...new Set(videos)][0] : ""
    const bestImg = images ? images[0] : standardImages ? standardImages[0] : ""

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
        music: bestVid || undefined,
        duration: null,
        original: rawUrl,
      }
    }
  } catch {}

  if (isPythonAvailable()) {
    const ytData = await runYtDlpJson(rawUrl)
    if (ytData && (ytData.url || ytData.thumbnail)) {
      const isVideo = Boolean(ytData.url && ytData.url.includes(".mp4"))
      return {
        platform: "pinterest",
        platformName: "Pinterest",
        title: ytData.title || "Mídia do Pinterest",
        author: ytData.uploader || "Pinterest",
        cover: ytData.thumbnail || ytData.url || "",
        mediaType: isVideo ? "video" : "image",
        quality: "Resolução Original",
        mp4: isVideo ? ytData.url : "",
        downloadUrl: ytData.url || ytData.thumbnail,
        music: isVideo ? ytData.url : undefined,
        duration: ytData.duration ?? null,
        original: rawUrl,
      }
    }
  }
  return null
}

export async function extractKwai(rawUrl: string): Promise<UniversalMediaResult | null> {
  try {
    const res = await fetch(rawUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    })
    const html = await res.text()
    const ogVid =
      html.match(/<meta property="og:video" content="([^"]+)"/)?.[1] ||
      html.match(/https?:\/\/[^"'\s\\]+kwai[^"'\s\\]*\.mp4[^"'\s\\]*/i)?.[0] ||
      ""
    const ogImg = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || ""
    const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || "Vídeo do Kwai"

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
        music: ogVid,
        duration: null,
        original: rawUrl,
      }
    }
  } catch {}

  if (isPythonAvailable()) {
    const ytData = await runYtDlpJson(rawUrl)
    if (ytData && ytData.url) {
      return {
        platform: "kwai",
        platformName: "Kwai",
        title: ytData.title || "Vídeo do Kwai",
        author: ytData.uploader || "Criador do Kwai",
        cover: ytData.thumbnail || "",
        mediaType: "video",
        quality: "HD Sem Marca",
        mp4: ytData.url,
        downloadUrl: ytData.url,
        music: ytData.url,
        duration: ytData.duration ?? null,
        original: rawUrl,
      }
    }
  }
  return null
}

/* =========================================================================
   7. UNIVERSAL EXTRACTOR (Qualquer link público de qualquer site)
   ========================================================================= */
export async function extractUniversalFallback(rawUrl: string): Promise<UniversalMediaResult | null> {
  // 1. Tenta yt-dlp se disponível
  if (isPythonAvailable()) {
    const ytData = await runYtDlpJson(rawUrl)
    if (ytData && (ytData.url || ytData.thumbnail)) {
      const isVideo = Boolean(ytData.url && (ytData.url.includes(".mp4") || ytData.vcodec !== "none"))
      const downloadTarget = ytData.url || ytData.thumbnail
      return {
        platform: "other",
        platformName: ytData.extractor_key || "Mídia Online",
        title: ytData.title || "Mídia Online",
        author: ytData.uploader || "Autor Público",
        cover: ytData.thumbnail || ytData.url || "",
        mediaType: isVideo ? "video" : "image",
        quality: "Resolução Original",
        mp4: isVideo ? ytData.url : "",
        downloadUrl: downloadTarget,
        music: isVideo ? ytData.url : undefined,
        duration: ytData.duration ?? null,
        original: rawUrl,
      }
    }
  }

  // 2. Scraper genérico de meta tags OpenGraph (puro Node.js, 100% universal)
  try {
    const res = await fetch(rawUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
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
        music: isVideo ? ogVid : undefined,
        duration: null,
        original: rawUrl,
      }
    }
  } catch {}

  return null
}

/** Roteador mestre de extração universal */
export async function extractUniversalMedia(rawUrl: string): Promise<UniversalMediaResult | null> {
  const platformInfo = detectPlatform(rawUrl)
  const platformId = platformInfo ? platformInfo.id : "other"

  let result: UniversalMediaResult | null = null

  switch (platformId) {
    case "youtube":
      result = await extractYouTube(rawUrl)
      break
    case "instagram":
      result = await extractInstagram(rawUrl)
      break
    case "tiktok":
      result = await extractTikTok(rawUrl)
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
    default:
      result = await extractUniversalFallback(rawUrl)
      break
  }

  if (!result && platformId !== "other") {
    result = await extractUniversalFallback(rawUrl)
  }

  return result
}
