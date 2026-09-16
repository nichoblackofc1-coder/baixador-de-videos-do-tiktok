export type PlatformId =
  | "tiktok"
  | "youtube"
  | "instagram"
  | "pinterest"
  | "kwai"
  | "twitter"
  | "facebook"
  | "threads"

export interface PlatformConfig {
  id: PlatformId
  name: string
  label: string
  color: string
  badgeBg: string
  badgeBorder: string
  badgeText: string
  domains: string[]
  supportedMedia: ("video" | "audio" | "image")[]
}

export const SUPPORTED_PLATFORMS: PlatformConfig[] = [
  {
    id: "tiktok",
    name: "TikTok",
    label: "TikTok Vídeos",
    color: "#FE2C55",
    badgeBg: "rgba(254, 44, 85, 0.12)",
    badgeBorder: "rgba(254, 44, 85, 0.3)",
    badgeText: "#FE2C55",
    domains: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
    supportedMedia: ["video", "audio"],
  },
  {
    id: "instagram",
    name: "Instagram",
    label: "Reels & Fotos",
    color: "#E1306C",
    badgeBg: "rgba(225, 48, 108, 0.12)",
    badgeBorder: "rgba(225, 48, 108, 0.3)",
    badgeText: "#E1306C",
    domains: ["instagram.com", "instagr.am"],
    supportedMedia: ["video", "image", "audio"],
  },
  {
    id: "youtube",
    name: "YouTube",
    label: "Shorts & Vídeos",
    color: "#FF0000",
    badgeBg: "rgba(255, 0, 0, 0.12)",
    badgeBorder: "rgba(255, 0, 0, 0.3)",
    badgeText: "#FF4444",
    domains: ["youtube.com", "youtu.be", "m.youtube.com"],
    supportedMedia: ["video", "audio"],
  },
  {
    id: "pinterest",
    name: "Pinterest",
    label: "Vídeos & Imagens",
    color: "#E60023",
    badgeBg: "rgba(230, 0, 35, 0.12)",
    badgeBorder: "rgba(230, 0, 35, 0.3)",
    badgeText: "#FF334B",
    domains: ["pinterest.com", "pin.it", "pinterest.ca", "pinterest.co.uk"],
    supportedMedia: ["video", "image"],
  },
  {
    id: "kwai",
    name: "Kwai",
    label: "Vídeos do Kwai",
    color: "#FF6600",
    badgeBg: "rgba(255, 102, 0, 0.12)",
    badgeBorder: "rgba(255, 102, 0, 0.3)",
    badgeText: "#FF7711",
    domains: ["kwai.com", "kwai-video.com", "kuaishou.com", "m.kwai.com"],
    supportedMedia: ["video", "audio"],
  },
  {
    id: "twitter",
    name: "Twitter / X",
    label: "Vídeos do X",
    color: "#1DA1F2",
    badgeBg: "rgba(29, 161, 242, 0.12)",
    badgeBorder: "rgba(29, 161, 242, 0.3)",
    badgeText: "#1DA1F2",
    domains: ["twitter.com", "x.com", "t.co"],
    supportedMedia: ["video"],
  },
  {
    id: "facebook",
    name: "Facebook",
    label: "Vídeos & Reels",
    color: "#1877F2",
    badgeBg: "rgba(24, 119, 242, 0.12)",
    badgeBorder: "rgba(24, 119, 242, 0.3)",
    badgeText: "#4593F7",
    domains: ["facebook.com", "fb.watch", "fb.com", "m.facebook.com"],
    supportedMedia: ["video"],
  },
]

export function detectPlatform(input: string): PlatformConfig | null {
  if (!input) return null
  const cleaned = input.trim().toLowerCase()

  try {
    let hostname = ""
    if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
      hostname = new URL(cleaned).hostname
    } else {
      // Tenta inferir o hostname se colou sem https://
      const match = cleaned.match(/^(?:https?:\/\/)?([^\/\s]+)/i)
      hostname = match ? match[1] : ""
    }

    for (const platform of SUPPORTED_PLATFORMS) {
      if (
        platform.domains.some(
          (d) => hostname === d || hostname.endsWith("." + d),
        )
      ) {
        return platform
      }
    }
  } catch {
    // URL inválida ainda sendo digitada
  }

  // Fallback rápido por regex caso a URL seja incompleta ou tenha texto junto
  for (const platform of SUPPORTED_PLATFORMS) {
    if (platform.domains.some((d) => cleaned.includes(d))) {
      return platform
    }
  }

  return null
}
