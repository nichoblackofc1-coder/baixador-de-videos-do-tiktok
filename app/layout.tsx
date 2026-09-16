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
        url: "/icon.svg?v=3",
        type: "image/svg+xml",
      },
      {
        url: "/favicon.ico?v=3",
        sizes: "any",
      },
      {
        url: "/icon-32x32.png?v=3",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/icon.png?v=3",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: "/apple-icon.png?v=3",
    shortcut: "/favicon.ico?v=3",
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
  description:
    "Baixe vídeos e fotos do TikTok, Instagram, YouTube, Pinterest e Kwai em alta resolução sem marca d'água.",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "All",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "BRL",
  },
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
        <link rel="icon" href="/icon.svg?v=3" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico?v=3" sizes="any" />
        <link rel="icon" href="/icon-32x32.png?v=3" type="image/png" sizes="32x32" />
        <link rel="icon" href="/icon.png?v=3" type="image/png" sizes="512x512" />
        <link rel="apple-touch-icon" href="/apple-icon.png?v=3" />
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
