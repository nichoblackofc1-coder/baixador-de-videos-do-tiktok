import { type NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  // 1. Vercel Header (Instantâneo no deploy)
  let country =
    request.headers.get("x-vercel-ip-country") ||
    request.headers.get("cf-ipcountry") ||
    ""

  // 2. Fallback para localhost / ambiente de desenvolvimento (IP público da VPN/conexão)
  if (!country || country === "ZZ" || country.length !== 2) {
    try {
      const res = await fetch("https://ipwho.is/", {
        signal: AbortSignal.timeout(1800),
        cache: "no-store",
      })
      if (res.ok) {
        const data = await res.json()
        if (data && data.country_code) {
          country = data.country_code
        }
      }
    } catch {
      try {
        const res2 = await fetch("http://ip-api.com/json", {
          signal: AbortSignal.timeout(1800),
          cache: "no-store",
        })
        if (res2.ok) {
          const data2 = await res2.json()
          if (data2 && data2.countryCode) {
            country = data2.countryCode
          }
        }
      } catch {}
    }
  }

  return NextResponse.json({
    country: (country || "").toUpperCase().trim(),
  })
}
