import { collectFormats } from './formats.js';

/** Normalised view of a /player response. */
export function parsePlayerResponse(response) {
  const status = response?.playabilityStatus ?? {};
  const details = response?.videoDetails ?? {};
  const micro = response?.microformat?.playerMicroformatRenderer ?? {};
  const streaming = response?.streamingData ?? {};

  return {
    playable: status.status === 'OK',
    status: status.status ?? 'UNKNOWN',
    reason: status.reason ?? status.messages?.join(' ') ?? null,
    subreason:
      status.errorScreen?.playerErrorMessageRenderer?.subreason?.runs
        ?.map((r) => r.text)
        .join('') ?? null,

    videoId: details.videoId ?? null,
    title: details.title ?? null,
    author: details.author ?? null,
    channelId: details.channelId ?? null,
    durationSeconds: details.lengthSeconds ? Number(details.lengthSeconds) : null,
    viewCount: details.viewCount ? Number(details.viewCount) : null,
    isLive: Boolean(details.isLive || details.isLiveContent),
    isPrivate: Boolean(details.isPrivate),
    isUnlisted: Boolean(micro.isUnlisted),
    shortDescription: details.shortDescription ?? null,
    keywords: details.keywords ?? [],
    thumbnails: details.thumbnail?.thumbnails ?? [],
    publishDate: micro.publishDate ?? null,
    uploadDate: micro.uploadDate ?? null,
    category: micro.category ?? null,

    formats: collectFormats(streaming),
    expiresInSeconds: streaming.expiresInSeconds ? Number(streaming.expiresInSeconds) : null,
    serverAbrStreamingUrl: streaming.serverAbrStreamingUrl ?? null,
    hlsManifestUrl: streaming.hlsManifestUrl ?? null,
    dashManifestUrl: streaming.dashManifestUrl ?? null,
    ustreamerConfig:
      response?.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig
        ?.videoPlaybackUstreamerConfig ?? null,

    captions:
      response?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.map((t) => ({
        languageCode: t.languageCode,
        name: t.name?.simpleText ?? t.name?.runs?.[0]?.text ?? t.languageCode,
        url: t.baseUrl,
        isAutomatic: t.kind === 'asr',
      })) ?? [],
  };
}

export class UnplayableError extends Error {
  constructor(info) {
    const detail = [info.reason, info.subreason].filter(Boolean).join(' — ');
    super(`video is not playable (${info.status})${detail ? `: ${detail}` : ''}`);
    this.name = 'UnplayableError';
    this.status = info.status;
    this.reason = info.reason;
  }
}
