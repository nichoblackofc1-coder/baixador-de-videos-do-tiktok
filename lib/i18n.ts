export type SupportedLanguage = "pt" | "en" | "es" | "fr" | "de" | "it"

export interface LanguageOption {
  code: SupportedLanguage
  name: string
  flag: string
  country: string
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "pt", name: "Português", flag: "🇧🇷", country: "Brasil / Portugal" },
  { code: "en", name: "English", flag: "🇺🇸", country: "United States / Global" },
  { code: "es", name: "Español", flag: "🇪🇸", country: "España / Latinoamérica" },
  { code: "fr", name: "Français", flag: "🇫🇷", country: "France / Canada" },
  { code: "de", name: "Deutsch", flag: "🇩🇪", country: "Deutschland" },
  { code: "it", name: "Italiano", flag: "🇮🇹", country: "Italia" },
]

export interface Translations {
  headerBadge: string
  heroTag: string
  heroTitlePrefix: string
  heroTitleGradient: string
  heroSubtitle: string
  heroPlatformsHighlight: string
  inputPlaceholder: string
  pasteButton: string
  downloadButton: string
  processingButton: string
  detectedPlatformLabel: string
  readyStatus: string
  networkLabel: string
  newSearchButton: string
  previewNotice: string
  qualityLabel: string
  noWatermark: string
  maxQuality: string
  audioAvailable: string
  captionLabel: string
  noCaption: string
  downloadVideo: string
  downloadImage: string
  downloadAudio: string
  downloadStarted: string
  downloadImageStarted: string
  downloadAudioStarted: string
  copyLink: string
  linkCopied: string
  viewOriginal: string
  emptyUrlError: string
  genericFetchError: string
  features: {
    title1: string
    desc1: string
    title2: string
    desc2: string
    title3: string
    desc3: string
  }
  footerText: string
}

export const TRANSLATIONS: Record<SupportedLanguage, Translations> = {
  pt: {
    headerBadge: "Multi-Plataformas Ativo",
    heroTag: "Baixador Universal sem marca D'Água",
    heroTitlePrefix: "Baixe vídeos e fotos de ",
    heroTitleGradient: "Qualquer Rede Social",
    heroSubtitle:
      "Cole o link do TikTok, Instagram, YouTube, Pinterest, Kwai ou X. A plataforma é detectada automaticamente para download direto no seu dispositivo com máxima qualidade.",
    heroPlatformsHighlight: "TikTok, Instagram, YouTube, Pinterest, Kwai ou X",
    inputPlaceholder: "Cole o link do TikTok, Instagram, YouTube, Pinterest, Kwai...",
    pasteButton: "Colar",
    downloadButton: "Baixar Mídia",
    processingButton: "Processando...",
    detectedPlatformLabel: "Rede detectada:",
    readyStatus: "Conteúdo pronto para download",
    networkLabel: "Rede:",
    newSearchButton: "Nova busca",
    previewNotice: "Prévia oficial de",
    qualityLabel: "Qualidade Máxima",
    noWatermark: "Sem Marca D'água",
    maxQuality: "Qualidade Original",
    audioAvailable: "Áudio Disponível",
    captionLabel: "Legenda / Título",
    noCaption: "Publicação sem legenda",
    downloadVideo: "Baixar Vídeo",
    downloadImage: "Baixar Imagem em Alta Resolução",
    downloadAudio: "Baixar Apenas Áudio (MP3)",
    downloadStarted: "Download Iniciado com Sucesso!",
    downloadImageStarted: "Download da Imagem Iniciado!",
    downloadAudioStarted: "Download do Áudio Iniciado!",
    copyLink: "Copiar Link",
    linkCopied: "Link Copiado!",
    viewOriginal: "Ver no",
    emptyUrlError: "Cole um link válido para baixar.",
    genericFetchError: "Não conseguimos obter o arquivo deste link. Verifique se a publicação é pública.",
    features: {
      title1: "Detecção Automática",
      desc1: "Basta colar o link. O sistema reconhece se é do TikTok, Instagram, YouTube, Pinterest ou Kwai instantaneamente.",
      title2: "Sem Marca d'Água",
      desc2: "Arquivos de vídeo limpos em Full HD 1080p e fotos na resolução máxima original sem compressão extra.",
      title3: "Download Direto",
      desc3: "Transferência direta e privada pelo navegador, sem páginas de anúncios invasivos ou necessidade de cadastro.",
    },
    footerText:
      "Save Web • Ferramenta gratuita para download de mídias públicas com autorização. Suporta TikTok, Instagram, YouTube, Pinterest, Kwai, Twitter/X e Facebook.",
  },
  en: {
    headerBadge: "All-in-One Active",
    heroTag: "Universal Downloader Without Watermark",
    heroTitlePrefix: "Download videos and photos from ",
    heroTitleGradient: "Any Social Media",
    heroSubtitle:
      "Paste any link from TikTok, Instagram, YouTube, Pinterest, Kwai or X. The platform is automatically detected for direct high-speed download to your device in full quality.",
    heroPlatformsHighlight: "TikTok, Instagram, YouTube, Pinterest, Kwai or X",
    inputPlaceholder: "Paste any link from TikTok, Instagram, YouTube, Pinterest, Kwai...",
    pasteButton: "Paste",
    downloadButton: "Download Media",
    processingButton: "Processing...",
    detectedPlatformLabel: "Detected platform:",
    readyStatus: "Media ready for download",
    networkLabel: "Platform:",
    newSearchButton: "New search",
    previewNotice: "Official preview from",
    qualityLabel: "Best Quality",
    noWatermark: "No Watermark",
    maxQuality: "Original Resolution",
    audioAvailable: "Audio Available",
    captionLabel: "Caption / Title",
    noCaption: "Post with no caption",
    downloadVideo: "Download Video",
    downloadImage: "Download High-Res Image",
    downloadAudio: "Download Audio Only (MP3)",
    downloadStarted: "Download Started Successfully!",
    downloadImageStarted: "Image Download Started!",
    downloadAudioStarted: "Audio Download Started!",
    copyLink: "Copy Link",
    linkCopied: "Link Copied!",
    viewOriginal: "View on",
    emptyUrlError: "Please paste a valid URL to download.",
    genericFetchError: "Could not retrieve media from this link. Make sure the post is public.",
    features: {
      title1: "Auto Detection",
      desc1: "Simply paste the link. The system detects TikTok, Instagram, YouTube, Pinterest or Kwai instantly.",
      title2: "No Watermark",
      desc2: "Crisp Full HD 1080p video files and full-resolution images without annoying watermarks.",
      title3: "Direct Download",
      desc3: "Direct stream download to your device without redirects, popups, or required account sign-up.",
    },
    footerText:
      "Save Web • Free web utility to download public media with permission. Supports TikTok, Instagram, YouTube, Pinterest, Kwai, Twitter/X, and Facebook.",
  },
  es: {
    headerBadge: "Multiplataforma Activo",
    heroTag: "Descargador Todo en Uno Sin Marca de Agua",
    heroTitlePrefix: "Descarga videos y fotos de ",
    heroTitleGradient: "Cualquier Red Social",
    heroSubtitle:
      "Pega el enlace de TikTok, Instagram, YouTube, Pinterest, Kwai o X. Detectamos la plataforma automáticamente para descarga directa en tu dispositivo con máxima calidad.",
    heroPlatformsHighlight: "TikTok, Instagram, YouTube, Pinterest, Kwai o X",
    inputPlaceholder: "Pega el enlace de TikTok, Instagram, YouTube, Pinterest, Kwai...",
    pasteButton: "Pegar",
    downloadButton: "Descargar",
    processingButton: "Procesando...",
    detectedPlatformLabel: "Red detectada:",
    readyStatus: "Contenido listo para descargar",
    networkLabel: "Red:",
    newSearchButton: "Nueva búsqueda",
    previewNotice: "Vista previa oficial de",
    qualityLabel: "Máxima Calidad",
    noWatermark: "Sin Marca de Agua",
    maxQuality: "Resolución Original",
    audioAvailable: "Audio Disponible",
    captionLabel: "Título / Descripción",
    noCaption: "Publicación sin descripción",
    downloadVideo: "Descargar Video",
    downloadImage: "Descargar Imagen en Alta Resolución",
    downloadAudio: "Descargar Solo Audio (MP3)",
    downloadStarted: "¡Descarga iniciada con éxito!",
    downloadImageStarted: "¡Descarga de imagen iniciada!",
    downloadAudioStarted: "¡Descarga de audio iniciada!",
    copyLink: "Copiar Enlace",
    linkCopied: "¡Enlace Copiado!",
    viewOriginal: "Ver en",
    emptyUrlError: "Por favor pega un enlace válido para descargar.",
    genericFetchError: "No pudimos obtener el archivo. Verifica que la publicación sea pública.",
    features: {
      title1: "Detección Automática",
      desc1: "Solo pega el enlace. El sistema identifica al instante si es de TikTok, Instagram, YouTube, Pinterest o Kwai.",
      title2: "Sin Marca de Agua",
      desc2: "Archivos limpios en Full HD 1080p y fotos en su resolución máxima original.",
      title3: "Descarga Directa",
      desc3: "Descarga directa a tu teléfono o computadora sin anuncios invasivos ni registros.",
    },
    footerText:
      "Save Web • Herramienta gratuita para descargar contenido público autorizado. Compatible con TikTok, Instagram, YouTube, Pinterest, Kwai, Twitter/X y Facebook.",
  },
  fr: {
    headerBadge: "Multi-Plateformes Actif",
    heroTag: "Téléchargeur Tout-en-Un Sans Filigrane",
    heroTitlePrefix: "Téléchargez vidéos et photos de ",
    heroTitleGradient: "Tous les Réseaux Sociaux",
    heroSubtitle:
      "Collez n'importe quel lien TikTok, Instagram, YouTube, Pinterest, Kwai ou X. La plateforme est détectée automatiquement pour un téléchargement direct et haute qualité.",
    heroPlatformsHighlight: "TikTok, Instagram, YouTube, Pinterest, Kwai ou X",
    inputPlaceholder: "Collez un lien TikTok, Instagram, YouTube, Pinterest, Kwai...",
    pasteButton: "Coller",
    downloadButton: "Télécharger",
    processingButton: "Traitement...",
    detectedPlatformLabel: "Plateforme détectée :",
    readyStatus: "Média prêt pour le téléchargement",
    networkLabel: "Réseau :",
    newSearchButton: "Nouvelle recherche",
    previewNotice: "Aperçu officiel de",
    qualityLabel: "Meilleure Qualité",
    noWatermark: "Sans Filigrane",
    maxQuality: "Résolution Originale",
    audioAvailable: "Audio Disponible",
    captionLabel: "Légende / Titre",
    noCaption: "Publication sans légende",
    downloadVideo: "Télécharger la Vidéo",
    downloadImage: "Télécharger l'Image HD",
    downloadAudio: "Télécharger l'Audio Seul (MP3)",
    downloadStarted: "Téléchargement lancé avec succès !",
    downloadImageStarted: "Téléchargement de l'image lancé !",
    downloadAudioStarted: "Téléchargement audio lancé !",
    copyLink: "Copier le Lien",
    linkCopied: "Lien Copié !",
    viewOriginal: "Voir sur",
    emptyUrlError: "Veuillez coller un lien valide.",
    genericFetchError: "Impossible de récupérer ce fichier. Vérifiez que la publication est publique.",
    features: {
      title1: "Détection Automatique",
      desc1: "Collez simplement le lien. Le système reconnaît immédiatement TikTok, Instagram, YouTube, Pinterest ou Kwai.",
      title2: "Sans Filigrane",
      desc2: "Fichiers vidéo Full HD 1080p propres et photos en résolution maximale d'origine.",
      title3: "Téléchargement Direct",
      desc3: "Téléchargement rapide et sécurisé directement dans votre navigateur sans redirections.",
    },
    footerText:
      "Save Web • Outil gratuit pour télécharger des médias publics autorisés. Compatible avec TikTok, Instagram, YouTube, Pinterest, Kwai, Twitter/X et Facebook.",
  },
  de: {
    headerBadge: "Multi-Plattform Aktiv",
    heroTag: "All-in-One Downloader Ohne Wasserzeichen",
    heroTitlePrefix: "Lade Videos und Fotos von ",
    heroTitleGradient: "Allen Sozialen Netzwerken",
    heroSubtitle:
      "Füge einen Link von TikTok, Instagram, YouTube, Pinterest, Kwai oder X ein. Die Plattform wird automatisch für einen direkten Download in bester Qualität erkannt.",
    heroPlatformsHighlight: "TikTok, Instagram, YouTube, Pinterest, Kwai oder X",
    inputPlaceholder: "Link von TikTok, Instagram, YouTube, Pinterest, Kwai einfügen...",
    pasteButton: "Einfügen",
    downloadButton: "Herunterladen",
    processingButton: "Verarbeitung...",
    detectedPlatformLabel: "Erkannte Plattform:",
    readyStatus: "Medium bereit zum Download",
    networkLabel: "Netzwerk:",
    newSearchButton: "Neue Suche",
    previewNotice: "Offizielle Vorschau von",
    qualityLabel: "Beste Qualität",
    noWatermark: "Ohne Wasserzeichen",
    maxQuality: "Originale Auflösung",
    audioAvailable: "Audio Verfügbar",
    captionLabel: "Titel / Beschreibung",
    noCaption: "Beitrag ohne Beschreibung",
    downloadVideo: "Video Herunterladen",
    downloadImage: "HD-Bild Herunterladen",
    downloadAudio: "Nur Audio (MP3) Herunterladen",
    downloadStarted: "Download erfolgreich gestartet!",
    downloadImageStarted: "Bild-Download gestartet!",
    downloadAudioStarted: "Audio-Download gestartet!",
    copyLink: "Link Kopieren",
    linkCopied: "Link Kopiert!",
    viewOriginal: "Öffnen auf",
    emptyUrlError: "Bitte füge einen gültigen Link ein.",
    genericFetchError: "Medium konnte nicht geladen werden. Bitte prüfe, ob der Beitrag öffentlich ist.",
    features: {
      title1: "Automatische Erkennung",
      desc1: "Einfach den Link einfügen. Das System erkennt TikTok, Instagram, YouTube, Pinterest oder Kwai sofort.",
      title2: "Ohne Wasserzeichen",
      desc2: "Saubere Full HD 1080p Videos und hochauflösende Fotos ohne störende Wasserzeichen.",
      title3: "Direkter Download",
      desc3: "Direkter Download auf dein Gerät ohne störende Werbung oder Registrierungszwang.",
    },
    footerText:
      "Save Web • Kostenloses Tool zum Herunterladen autorisierter öffentlicher Medien. Unterstützt TikTok, Instagram, YouTube, Pinterest, Kwai, Twitter/X und Facebook.",
  },
  it: {
    headerBadge: "Multi-Piattaforma Attivo",
    heroTag: "Downloader Tutto-in-Uno Senza Filigrana",
    heroTitlePrefix: "Scarica video e foto da ",
    heroTitleGradient: "Tutti i Social Network",
    heroSubtitle:
      "Incolla il link di TikTok, Instagram, YouTube, Pinterest, Kwai o X. La piattaforma viene rilevata automaticamente per il download diretto in alta qualità.",
    heroPlatformsHighlight: "TikTok, Instagram, YouTube, Pinterest, Kwai o X",
    inputPlaceholder: "Incolla il link da TikTok, Instagram, YouTube, Pinterest, Kwai...",
    pasteButton: "Incolla",
    downloadButton: "Scarica File",
    processingButton: "Elaborazione...",
    detectedPlatformLabel: "Rete rilevata:",
    readyStatus: "Contenuto pronto per il download",
    networkLabel: "Rete:",
    newSearchButton: "Nuova ricerca",
    previewNotice: "Anteprima ufficiale da",
    qualityLabel: "Massima Qualità",
    noWatermark: "Senza Filigrana",
    maxQuality: "Risoluzione Originale",
    audioAvailable: "Audio Disponibile",
    captionLabel: "Titolo / Didascalia",
    noCaption: "Post senza didascalia",
    downloadVideo: "Scarica Video",
    downloadImage: "Scarica Immagine HD",
    downloadAudio: "Scarica Solo Audio (MP3)",
    downloadStarted: "Download avviato con successo!",
    downloadImageStarted: "Download immagine avviato!",
    downloadAudioStarted: "Download audio avviato!",
    copyLink: "Copia Link",
    linkCopied: "Link Copiato!",
    viewOriginal: "Vedi su",
    emptyUrlError: "Incolla un link valido per scaricare.",
    genericFetchError: "Impossibile recuperare il file. Verifica che il post sia pubblico.",
    features: {
      title1: "Rilevamento Automatico",
      desc1: "Basta incollare il link. Il sistema riconosce immediatamente se proviene da TikTok, Instagram, YouTube o Pinterest.",
      title2: "Senza Filigrana",
      desc2: "File video nitidi in Full HD 1080p e immagini alla massima risoluzione originale.",
      title3: "Download Diretto",
      desc3: "Download immediato sul tuo dispositivo tramite browser senza annunci invasivi né registrazione.",
    },
    footerText:
      "Save Web • Strumento gratuito per il download di contenuti multimediali pubblici autorizzati. Supporta TikTok, Instagram, YouTube, Pinterest, Kwai, Twitter/X e Facebook.",
  },
}

/**
 * Detects visitor language automatically based on browser environment.
 * If Spanish-speaking country -> 'es'
 * If Portuguese-speaking country -> 'pt'
 * If French -> 'fr'
 * If German -> 'de'
 * If Italian -> 'it'
 * Any other country/region (including US, UK, Canada, Australia, Asia, etc.) -> 'en'
 */
export function detectInitialLanguage(): SupportedLanguage {
  if (typeof window === "undefined") return "pt"

  // 1. Saved preference in localStorage
  try {
    const saved = localStorage.getItem("user_lang") as SupportedLanguage
    if (saved && TRANSLATIONS[saved]) return saved
  } catch {}

  // 2. Browser language detection
  const navLangs = [
    ...(navigator.languages || []),
    navigator.language,
    (navigator as any).userLanguage,
  ].filter(Boolean) as string[]

  for (const raw of navLangs) {
    const code = raw.toLowerCase().split("-")[0]
    if (code === "pt") return "pt"
    if (code === "es") return "es"
    if (code === "en") return "en"
    if (code === "fr") return "fr"
    if (code === "de") return "de"
    if (code === "it") return "it"
  }

  // 3. Fallback to English for worldwide audience
  return "en"
}
