"use client"

import React, { createContext, useContext, useEffect, useState } from "react"
import {
  type SupportedLanguage,
  type Translations,
  TRANSLATIONS,
  detectInitialLanguage,
  mapCountryToLanguage,
  SUPPORTED_LANGUAGES,
  type LanguageOption,
} from "@/lib/i18n"

interface LanguageContextType {
  lang: SupportedLanguage
  setLang: (lang: SupportedLanguage) => void
  t: Translations
  currentOption: LanguageOption
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<SupportedLanguage>("pt")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // 1. Detecção inicial pelo navegador (síncrona para zero flicker)
    const initial = detectInitialLanguage()
    setLangState(initial)
    if (typeof document !== "undefined") {
      document.documentElement.lang = initial
    }

    // 2. Detecção automática e precisa pelo país real do usuário (GeoIP / Vercel Edge Headers)
    // Permite que ao conectar por VPN ou acessar da Rússia, EUA, Europa, etc.,
    // o site mude automaticamente para o idioma do país sem intervenção manual.
    const autoDetectCountryLanguage = async () => {
      try {
        // Se o usuário já escolheu manualmente um idioma nesta sessão, respeitamos
        const manual = typeof window !== "undefined" ? sessionStorage.getItem("user_manual_lang") : null
        if (manual && TRANSLATIONS[manual as SupportedLanguage]) {
          setLangState(manual as SupportedLanguage)
          return
        }

        const res = await fetch("/api/detect-country", { cache: "no-store" })
        if (res.ok) {
          const data = await res.json()
          if (data && data.country) {
            const countryLang = mapCountryToLanguage(data.country)
            setLangState(countryLang)
            if (typeof document !== "undefined") {
              document.documentElement.lang = countryLang
            }
          }
        }
      } catch {
        // Se falhar a requisição GeoIP, mantém o idioma do navegador
      }
    }

    autoDetectCountryLanguage()
    setMounted(true)
  }, [])

  const setLang = (newLang: SupportedLanguage) => {
    setLangState(newLang)
    if (typeof document !== "undefined") {
      document.documentElement.lang = newLang
    }
    try {
      sessionStorage.setItem("user_manual_lang", newLang)
    } catch {}
  }

  const t = TRANSLATIONS[lang] || TRANSLATIONS.en
  const currentOption =
    SUPPORTED_LANGUAGES.find((opt) => opt.code === lang) || SUPPORTED_LANGUAGES[0]

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, currentOption }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    return {
      lang: "pt" as SupportedLanguage,
      setLang: () => {},
      t: TRANSLATIONS.pt,
      currentOption: SUPPORTED_LANGUAGES[0],
    }
  }
  return context
}
