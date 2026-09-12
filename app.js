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


// --- Metadata endpoint (title/author/duration/thumbnail) ---
// Also warms the shared cache in scraperStream.js, so a /api/audio call for the same
// video right after this one reuses the result instead of extracting again.
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
app.get('/api/audio/:videoId', async (req, res) => {
    try {
        const { audioUrl, mimeType } = await scraperStream.getAudioStream(req.params.videoId);

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

// Then in package.json (already added if you followed the earlier step):
// "dependencies": { ... "youtubei.js": "^18.0.0" ... }


app.listen(process.env.PORT || 8080, function () {
  console.log('Listening on port 8080');
});