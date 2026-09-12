// scraperStream.js
// Extracts a direct, playable audio stream URL for a given YouTube videoId.
//
// Uses youtubei.js (https://github.com/LuanRT/YouTube.js), which talks to YouTube's
// internal InnerTube API directly. @distube/ytdl-core was archived in Aug 2025 and its
// own README now points people to youtubei.js instead.
//
// npm install youtubei.js
//
// CONTEXT (read this if extraction stops working again):
// YouTube now requires a "PO Token" (proof-of-origin, generated via a BotGuard challenge
// in a real browser) for the default WEB client's stream URLs -- omitted, YouTube's
// player response drops url/signatureCipher entirely for that client. This is not a bug
// in this code, it's YouTube's current anti-bot enforcement, and enforcement is
// inconsistent request-to-request -- the same video/client can succeed once and fail
// moments later. We try a small set of clients in order as a partial workaround, and
// cache successful results so we don't re-roll those dice more than necessary. If this
// stops working across the board, the real long-term fix is a proper PO Token provider
// (e.g. bgutils-js) or running yt-dlp with a maintained PO token plugin.

let ytPromise = null;
function getClient() {
    if (!ytPromise) {
        ytPromise = import('youtubei.js').then(({ Innertube }) => Innertube.create());
    }
    return ytPromise;
}

const CLIENT_FALLBACK_ORDER = ['ANDROID', 'IOS', 'WEB_EMBEDDED', 'TV', undefined]; // undefined = library default (WEB)

// Shared cache so a metadata request (/api/stream) and a playback request (/api/audio)
// for the same video within a short window reuse one extraction attempt instead of two
// independent (and independently flaky) ones.
const cache = new Map(); // videoId -> { data, fetchedAt }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min -- comfortably under googlevideo's multi-hour URL expiry

/**
 * Get the best available audio-only stream for a video, plus basic metadata.
 * Tries several InnerTube clients in order since YouTube's PO-token requirement
 * currently varies by client and by request.
 * @param {string} videoId
 */
async function getAudioStream(videoId) {
    const cached = cache.get(videoId);
    if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
        return cached.data;
    }

    const yt = await getClient();

    let lastError;
    for (const client of CLIENT_FALLBACK_ORDER) {
        try {
            const info = await yt.getBasicInfo(videoId, client ? { client } : undefined);
            const format = info.chooseFormat({ type: 'audio', quality: 'best' });
            if (!format) throw new Error('No playable audio format found for this video');

            const audioUrl = await format.decipher(yt.session.player);
            if (!audioUrl) throw new Error('No valid URL to decipher');

            const details = info.basic_info;
            const data = {
                audioUrl,
                mimeType: format.mime_type,
                bitrate: format.bitrate || 0,
                title: details.title,
                author: details.author,
                duration: details.duration || 0,
                thumbnail: details.thumbnail && details.thumbnail.length
                    ? details.thumbnail[details.thumbnail.length - 1].url
                    : null,
                clientUsed: client || 'WEB',
            };

            cache.set(videoId, { data, fetchedAt: Date.now() });
            return data;
        } catch (err) {
            lastError = err;
            // try the next client in the list
        }
    }

    throw new Error(`All client fallbacks failed. Last error: ${lastError && lastError.message}`);
}

module.exports = { getAudioStream };