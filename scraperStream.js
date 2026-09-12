// scraperStream.js
const { Innertube, UniversalCache } = require('youtubei.js');
const vm = require('node:vm');

let ytPromise = null;

async function getClient() {
  if (!ytPromise) {
    ytPromise = Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
      js_runtime: {
        eval: async (code, env) => {
          const context = vm.createContext({
            ...env,
            console,
            Date,
            Math,
            RegExp,
            Array,
            Object,
            String,
            Number,
            parseInt,
            parseFloat,
          });
          return vm.runInContext(code, context);
        },
      },
    });
  }
  return ytPromise;
}

const CLIENT_FALLBACK_ORDER = ['YTMUSIC', 'ANDROID', 'IOS', 'TV', 'WEB'];

/**
 * Get the best available audio-only stream for a video, plus basic metadata.
 * @param {string} videoId
 */
async function getAudioStream(videoId) {
  const yt = await getClient();

  let lastError = null;

  for (const client of CLIENT_FALLBACK_ORDER) {
    try {
      const info = await yt.getInfo(videoId, { client });

      if (!info.streaming_data) {
        throw new Error(`Streaming data not available for client ${client}`);
      }

      const format = info.chooseFormat({
        type: 'audio',
        quality: 'best',
      });

      if (!format) {
        throw new Error(`No audio format found for client ${client}`);
      }

      // Now decipher works using node:vm evaluator
      const audioUrl = await format.decipher(yt.session.player);
      if (!audioUrl) {
        throw new Error(`Failed to decipher stream URL for client ${client}`);
      }

      const details = info.basic_info;

      return {
        audioUrl,
        mimeType: format.mime_type,
        bitrate: format.bitrate || 0,
        title: details.title,
        author: details.author,
        duration: details.duration || 0,
        thumbnail:
          details.thumbnail && details.thumbnail.length
            ? details.thumbnail[details.thumbnail.length - 1].url
            : null,
        clientUsed: client,
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`All client fallbacks failed. Last error: ${lastError ? lastError.message : 'Unknown'}`);
}

module.exports = { getAudioStream };