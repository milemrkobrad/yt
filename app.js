const express = require('express');
const scraperSearch = require('./scraperSearch');
const scraperWatch = require('./scraperWatch');
const app = express();
const scraperStream = require('./scraperStream');
const { Readable } = require('stream');
app.use(express.json()); //Used to parse JSON bodies
app.use(express.urlencoded()); //Parse URL-encoded bodies

//Home page
app.get('/', (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate"); // HTTP 1.1.
  res.setHeader("Pragma", "no-cache"); // HTTP 1.0.
  res.setHeader("Expires", "0"); // Proxies.
  res.sendFile(__dirname + "/index.html");
});


//API route
app.get('/api/hello', (req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Hello !');
});

app.get('/api/search', (req, res) => {  
//   res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate"); // HTTP 1.1.
//   res.setHeader("Pragma", "no-cache"); // HTTP 1.0.
//   res.setHeader("Expires", "0"); // Proxies.
//   scraperSearch.youtube(req.query.q, req.query.type)
//         .then(x => res.json(x))
//         .catch(e => res.send(e));

    (async () => {
        let data = await scraperSearch.youtube(req.query.q, 3); // fetch 3 pages
        console.log(data.results.length);
        return res.json(data);
    })();

});

app.get('/api/suggestions', (req, res) => {
//   scraperWatch.youtubeWatchSuggestions(req.query.videoId)
//         .then(x => res.json(x))
//         .catch(e => res.send(e));

    (async () => {
        let data = await scraperWatch.youtubeWatchSuggestions(req.query.videoId, 3); // fetch 3 pages
        console.log(data.length);
        return res.json(data);
    })();
});

app.get('/api/stream/:videoId', async (req, res) => {
    try {
        const data = await scraperStream.getAudioStream(req.params.videoId);
        res.json(data);
    } catch (err) {
        console.error('stream error:', err.message);
        res.status(500).json({ error: 'Failed to extract stream', details: err.message });
    }
});

// --- Audio proxy ---
// googlevideo.com URLs are IP-locked to whichever server fetched them (your Render
// instance). A phone on a different network gets 403 if it hits that URL directly.
// This route re-fetches from Render's IP and streams the bytes through to the client,
// so the client only ever talks to your own backend.
//
// Also caches the extracted URL briefly so a burst of Range requests for the same
// video (normal for audio players seeking/buffering) doesn't re-run extraction every time.
const streamCache = new Map(); // videoId -> { audioUrl, mimeType, fetchedAt }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min -- comfortably under googlevideo's multi-hour URL expiry

async function getCachedAudioInfo(videoId) {
    const cached = streamCache.get(videoId);
    if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
        return cached;
    }
    const info = await scraperStream.getAudioStream(videoId);
    const entry = { audioUrl: info.audioUrl, mimeType: info.mimeType, fetchedAt: Date.now() };
    streamCache.set(videoId, entry);
    return entry;
}

app.get('/api/audio/:videoId', async (req, res) => {
    try {
        const { audioUrl, mimeType } = await getCachedAudioInfo(req.params.videoId);

        const upstreamHeaders = {};
        if (req.headers.range) upstreamHeaders['Range'] = req.headers.range;

        const upstream = await fetch(audioUrl, { headers: upstreamHeaders });

        res.status(upstream.status);
        res.setHeader('Content-Type', mimeType || 'audio/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        const cl = upstream.headers.get('content-length');
        const cr = upstream.headers.get('content-range');
        if (cl) res.setHeader('Content-Length', cl);
        if (cr) res.setHeader('Content-Range', cr);

        Readable.fromWeb(upstream.body).pipe(res);
    } catch (err) {
        console.error('audio proxy error:', err.message);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to proxy audio', details: err.message });
    }
});


app.listen(process.env.PORT || 8080, function () {
  console.log('Listening on port 8080');
});