// scraperStream.js
// Extracts a direct, playable audio (or video) stream URL for a given YouTube videoId.
//
// Uses @distube/ytdl-core, a more actively maintained fork of ytdl-core that tends to
// keep up better with YouTube's signature-cipher changes. Even so, YouTube changes things
// periodically and this can break — if that happens, bump the package version first
// (`npm update @distube/ytdl-core`) before assuming the whole approach is broken.
//
// npm install @distube/ytdl-core

const ytdl = require('@distube/ytdl-core');

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
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const info = await ytdl.getInfo(videoUrl);

    // Pick the best audio-only format (no video track) — smaller payload, exactly what
    // we want for a music-player-style app. Falls back to any format with audio if for
    // some reason no audio-only format is offered.
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
    const chosen = (audioFormats.length ? audioFormats : ytdl.filterFormats(info.formats, 'audioandvideo'))
        .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];

    if (!chosen) {
        throw new Error('No playable audio format found for this video');
    }

    const details = info.videoDetails;

    return {
        audioUrl: chosen.url,
        mimeType: chosen.mimeType,
        bitrate: chosen.audioBitrate || 0,
        title: details.title,
        author: details.author && details.author.name,
        duration: parseInt(details.lengthSeconds, 10) || 0,
        thumbnail: details.thumbnails && details.thumbnails.length
            ? details.thumbnails[details.thumbnails.length - 1].url
            : null,
    };
}

module.exports = { getAudioStream };
