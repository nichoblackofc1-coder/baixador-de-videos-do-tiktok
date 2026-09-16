"use client"

import { useState, useRef, useEffect } from "react"
import { useLanguage } from "@/context/language-context"
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/i18n"
import { Globe, ChevronDown, Check } from "lucide-react"

export function LanguageSwitcher() {
  const { lang, setLang, currentOption } = useLanguage()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  function handleSelect(code: SupportedLanguage) {
    setLang(code)
    setOpen(false)
  }

  return (
    <div ref={menuRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 rounded-full border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900 transition-all cursor-pointer"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Globe className="size-3.5 text-blue-600" />
        <span className="text-sm leading-none">{currentOption.flag}</span>
        <span className="font-medium hidden sm:inline">{currentOption.name}</span>
        <ChevronDown className={`size-3 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-48 origin-top-right rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_10px_30px_-5px_rgba(0,0,0,0.1)] ring-1 ring-black/5 z-50 animate-in fade-in-0 zoom-in-95">
          <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 mb-1">
            Selecione o Idioma / Language
          </div>
          <div className="space-y-0.5">
            {SUPPORTED_LANGUAGES.map((opt) => {
              const isSelected = opt.code === lang
              return (
                <button
                  key={opt.code}
                  type="button"
                  onClick={() => handleSelect(opt.code)}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs font-medium transition-all cursor-pointer ${
                    isSelected
                      ? "bg-blue-50 text-blue-700 font-semibold"
                      : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base leading-none">{opt.flag}</span>
                    <span>{opt.name}</span>
                  </div>
                  {isSelected && <Check className="size-3.5 text-blue-600 shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
