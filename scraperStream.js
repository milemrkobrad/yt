// scraperStream.js
// Extracts a direct, playable audio stream URL for a given YouTube videoId.
//
// Uses youtubei.js (https://github.com/LuanRT/YouTube.js), which talks to YouTube's
// internal InnerTube API directly. @distube/ytdl-core was archived in Aug 2025 and its
// own README now points people to youtubei.js instead.
//
// npm install youtubei.js
//
// IMPORTANT CONTEXT (read this if it stops working again):
// YouTube now requires a "PO Token" (proof-of-origin, generated via a BotGuard challenge
// in a real browser) for the default WEB client's stream URLs. Without one, YouTube's
// player response omits url/signatureCipher entirely for that client -- this is not a bug
// in this code, it's YouTube's current anti-bot enforcement, and it's a moving target.
// As a workaround, we try a small set of InnerTube clients in order; mobile-app clients
// (ANDROID/IOS) have historically been less strict about this than the WEB client, but
// YouTube changes this periodically, so if ALL of these start failing again, the next
// step is a proper PO Token provider (e.g. bgutils-js) or running yt-dlp with a
// maintained PO token plugin -- both meaningfully bigger lifts than this file.

let ytPromise = null;
function getClient() {
    if (!ytPromise) {
        ytPromise = import('youtubei.js').then(({ Innertube }) => Innertube.create());
    }
    return ytPromise;
}

const CLIENT_FALLBACK_ORDER = ['ANDROID', 'IOS', 'WEB_EMBEDDED', 'TV', undefined]; // undefined = library default (WEB)

/**
 * Get the best available audio-only stream for a video, plus basic metadata.
 * Tries several InnerTube clients in order since YouTube's PO-token requirement
 * currently varies by client.
 * @param {string} videoId
 */
async function getAudioStream(videoId) {
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
            return {
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
        } catch (err) {
            lastError = err;
            // try the next client in the list
        }
    }

    throw new Error(`All client fallbacks failed. Last error: ${lastError && lastError.message}`);
}

module.exports = { getAudioStream };