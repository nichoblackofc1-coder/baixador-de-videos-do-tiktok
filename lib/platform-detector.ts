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
    color: "#0F172A",
    badgeBg: "#F1F5F9",
    badgeBorder: "#E2E8F0",
    badgeText: "#0F172A",
    domains: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
    supportedMedia: ["video", "audio"],
  },
  {
    id: "instagram",
    name: "Instagram",
    label: "Reels & Fotos",
    color: "#E1306C",
    badgeBg: "rgba(225, 48, 108, 0.08)",
    badgeBorder: "rgba(225, 48, 108, 0.25)",
    badgeText: "#BE185D",
    domains: ["instagram.com", "instagr.am"],
    supportedMedia: ["video", "image", "audio"],
  },
  {
    id: "youtube",
    name: "YouTube",
    label: "Shorts & Vídeos",
    color: "#DC2626",
    badgeBg: "rgba(220, 38, 38, 0.08)",
    badgeBorder: "rgba(220, 38, 38, 0.25)",
    badgeText: "#B91C1C",
    domains: ["youtube.com", "youtu.be", "m.youtube.com"],
    supportedMedia: ["video", "audio"],
  },
  {
    id: "pinterest",
    name: "Pinterest",
    label: "Vídeos & Imagens",
    color: "#E60023",
    badgeBg: "rgba(230, 0, 35, 0.08)",
    badgeBorder: "rgba(230, 0, 35, 0.25)",
    badgeText: "#991B1B",
    domains: ["pinterest.com", "pin.it", "pinterest.ca", "pinterest.co.uk"],
    supportedMedia: ["video", "image"],
  },
  {
    id: "kwai",
    name: "Kwai",
    label: "Vídeos do Kwai",
    color: "#EA580C",
    badgeBg: "rgba(234, 88, 12, 0.08)",
    badgeBorder: "rgba(234, 88, 12, 0.25)",
    badgeText: "#C2410C",
    domains: ["kwai.com", "kwai-video.com", "kuaishou.com", "m.kwai.com"],
    supportedMedia: ["video", "audio"],
  },
  {
    id: "twitter",
    name: "Twitter / X",
    label: "Vídeos do X",
    color: "#0F172A",
    badgeBg: "#F1F5F9",
    badgeBorder: "#E2E8F0",
    badgeText: "#0F172A",
    domains: ["twitter.com", "x.com", "t.co"],
    supportedMedia: ["video"],
  },
  {
    id: "facebook",
    name: "Facebook",
    label: "Vídeos & Reels",
    color: "#2563EB",
    badgeBg: "rgba(37, 99, 235, 0.08)",
    badgeBorder: "rgba(37, 99, 235, 0.25)",
    badgeText: "#1D4ED8",
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

    return null
  } catch {
    return null
  }
}
