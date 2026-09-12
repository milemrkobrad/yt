// scraperStream.js
// Extracts a direct, playable audio stream URL for a given YouTube videoId.
//
// Uses youtubei.js (https://github.com/LuanRT/YouTube.js), which talks to YouTube's
// internal InnerTube API directly rather than scraping/deciphering the watch page.
// This is the actively maintained option -- @distube/ytdl-core was archived in Aug 2025
// and its own README now points people to youtubei.js instead.
//
// npm install youtubei.js
//
// NOTE: youtubei.js is ESM-only (no CommonJS export), while this project uses
// require(). We bridge that with a dynamic import() -- that's allowed inside a
// CommonJS file and works fine, it's just not a plain top-level require().

let ytPromise = null;
function getClient() {
    if (!ytPromise) {
        ytPromise = import('youtubei.js').then(({ Innertube }) => Innertube.create());
    }
    return ytPromise;
}

/**
 * Get the best available audio-only stream for a video, plus basic metadata.
 * @param {string} videoId
 * @returns {Promise<{
 *   audioUrl: string,
 *   mimeType: string,
 *   bitrate: number,
 *   title: string,
 *   author: string,
 *   duration: number,       // seconds
 *   thumbnail: string
 * }>}
 */
async function getAudioStream(videoId) {
    const yt = await getClient();
    const info = await yt.getBasicInfo(videoId);

    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    if (!format) {
        throw new Error('No playable audio format found for this video');
    }

    const audioUrl = format.decipher(yt.session.player);
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
    };
}

module.exports = { getAudioStream };