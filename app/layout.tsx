import { Analytics } from "@vercel/analytics/next"
import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://baixador-de-videos-do-tiktok.vercel.app"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Save Web - Baixar Vídeos do TikTok, Instagram, YouTube e Pinterest",
    template: "%s | Save Web",
  },
  description:
    "Baixe vídeos do TikTok, Reels do Instagram, Shorts do YouTube, pins do Pinterest e Kwai em MP4 HD sem marca d'água. 100% gratuito e direto pelo navegador.",
  keywords: [
    "save web",
    "baixar video tiktok",
    "baixar reels instagram",
    "baixar shorts youtube",
    "baixar video pinterest",
    "baixar video kwai",
    "baixar video sem marca d agua",
    "tiktok downloader",
    "instagram downloader",
    "youtube downloader",
    "pinterest video download",
    "salvar video tiktok",
  ],
  authors: [{ name: "Save Web" }],
  creator: "Save Web",
  publisher: "Save Web",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    title: "Save Web - Baixar Vídeos e Fotos Sem Marca d'Água",
    description:
      "Baixe vídeos do TikTok, Reels do Instagram, YouTube, Pinterest e Kwai em MP4 HD e áudio MP3 sem marca d'água. 100% gratuito.",
    url: siteUrl,
    siteName: "Save Web",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: "/home.png",
        width: 1200,
        height: 630,
        alt: "Save Web - Baixador Universal de Mídias",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Save Web - Baixar Vídeos e Fotos Sem Marca d'Água",
    description:
      "Baixe vídeos do TikTok, Reels do Instagram, YouTube, Pinterest e Kwai sem marca d'água direto pelo navegador.",
    images: ["/home.png"],
  },
  icons: {
    icon: [
      {
        url: "/icon.png",
        type: "image/png",
      },
      {
        url: "/favicon.ico",
      },
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    apple: "/apple-icon.png",
    shortcut: "/favicon.ico",
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || "",
  },
}

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#F8FAFC",
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Save Web",
  url: siteUrl,
  applicationCategory: "MultimediaApplication",
  operatingSystem: "All",
  browserRequirements: "Requires JavaScript. Requires HTML5.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "BRL",
  },
  description:
    "Ferramenta online para baixar vídeos do TikTok, Instagram, YouTube, Pinterest e Kwai em MP4 HD e áudios em MP3 sem marca d'água gratuitamente.",
}

import { LanguageProvider } from "@/context/language-context"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} bg-background`}
      suppressHydrationWarning
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="font-sans antialiased">
        <LanguageProvider>
          {children}
        </LanguageProvider>
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
