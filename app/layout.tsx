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
    default: "TikSave Pro - Baixar Vídeo do TikTok Sem Marca d'Água Grátis",
    template: "%s | TikSave Pro",
  },
  description:
    "Baixe vídeos do TikTok em alta qualidade MP4 HD e áudios em MP3 sem marca d'água. Rápido, direto no seu celular ou PC e 100% gratuito.",
  keywords: [
    "baixar video tiktok",
    "baixar video do tiktok sem marca d agua",
    "tiktok downloader",
    "salvar video tiktok",
    "tiktok mp4 hd",
    "baixar audio tiktok mp3",
    "tiksave pro",
    "snaptik",
    "ssstik",
    "tiktok sem marca",
  ],
  authors: [{ name: "TikSave Pro" }],
  creator: "TikSave Pro",
  publisher: "TikSave Pro",
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
    title: "TikSave Pro - Baixar Vídeo do TikTok Sem Marca d'Água",
    description:
      "Baixe vídeos do TikTok em MP4 HD e áudio MP3 sem marca d'água. 100% gratuito e direto pelo navegador.",
    url: siteUrl,
    siteName: "TikSave Pro",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: "/home.png",
        width: 1200,
        height: 630,
        alt: "TikSave Pro - Baixador de Vídeos do TikTok",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "TikSave Pro - Baixar Vídeo do TikTok Sem Marca d'Água",
    description:
      "Baixe vídeos do TikTok em MP4 HD sem marca d'água direto pelo navegador.",
    images: ["/home.png"],
  },
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || "",
  },
}

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0a0a0c",
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "TikSave Pro",
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
    "Ferramenta online para baixar vídeos do TikTok em MP4 HD e áudios em MP3 sem marca d'água gratuitamente.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} bg-background`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="font-sans antialiased">
        {children}
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
