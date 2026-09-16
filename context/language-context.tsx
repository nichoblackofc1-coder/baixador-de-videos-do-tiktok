"use client"

import React, { createContext, useContext, useEffect, useState } from "react"
import {
  type SupportedLanguage,
  type Translations,
  TRANSLATIONS,
  detectInitialLanguage,
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
    const detected = detectInitialLanguage()
    setLangState(detected)
    setMounted(true)
    if (typeof document !== "undefined") {
      document.documentElement.lang = detected
    }
  }, [])

  const setLang = (newLang: SupportedLanguage) => {
    setLangState(newLang)
    if (typeof document !== "undefined") {
      document.documentElement.lang = newLang
    }
    try {
      localStorage.setItem("user_lang", newLang)
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
    // Fallback safe context if used outside provider
    return {
      lang: "pt" as SupportedLanguage,
      setLang: () => {},
      t: TRANSLATIONS.pt,
      currentOption: SUPPORTED_LANGUAGES[0],
    }
  }
  return context
}
