// youtubeWatchSuggestions.js
const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Fetch YouTube watch suggestions with scrolling simulation
 * @param {string} videoId - YouTube video ID
 * @param {number} maxPages - Max continuation pages to fetch (default 5)
 */


/**
 * Find balanced object starting at first '{' after`startPos`.
 * Returns { text: "...", endPos } or null.
 */
function extractBalancedObject(fullText, startPos) {
    const firstBrace = fullText.indexOf('{', startPos);
    if (firstBrace === -1) return null;

    let i = firstBrace;
    let depth = 0;
    let inString = false;
    let stringChar = null;
    let escaped = false;

    for (; i < fullText.length; i++) {
        const ch = fullText[i];

        if (inString) {
            if (escaped) { escaped = false; continue; }
            if (ch === '\\') { escaped = true; continue; }
            if (ch === stringChar) { inString = false; stringChar = null; continue; }
            continue;
        }

        if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
        if (ch === '{') { depth++; continue; }
        if (ch === '}') {
            depth--;
            if (depth === 0) {
                // include closing brace
                return { text: fullText.slice(firstBrace, i + 1), endPos: i + 1 };
            }
        }
    }

    return null; // not found / unbalanced
}

/**
 * Minimal JS-object => JSON normaliser.
 * - Converts single quotes to double (careful with apostrophes inside already quoted strings),
 * - Quotes unquoted keys,
 * - Removes trailing commas in objects/arrays,
 * - Unescapes some YouTube unicode escapes like \u0026 -> &
 *
 * This is heuristic and works well for YouTube watch-page fragments.
 */
function normalizeToJson(jsText) {
    let s = jsText;

    // 1) Replace common escaped sequences YouTube uses
    s = s.replace(/\\u0026/g, '&').replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0022/g, '"');

    // 2) Remove JS-style comments (single-line and block) — be cautious but handy
    s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // 3) Convert single-quoted strings to double-quoted (only when they appear as string delimiters)
    //    We do a pass to avoid touching already double-quoted content.
    s = s.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, function (_, inner) {
        // escape existing double quotes inside inner
        return '"' + inner.replace(/"/g, '\\"') + '"';
    });

    // 4) Quote unquoted object keys:
    //    from:  { keyName:  ... , 'other':..., "x":... }
    //    to:    { "keyName": ... , ...
    s = s.replace(/([,{]\s*)([A-Za-z0-9_@$-]+)\s*:/g, '$1"$2":');

    // 5) Remove trailing commas before } or ]
    s = s.replace(/,(\s*[}\]])/g, '$1');

    return s;
}

/**
 * Top-level function: scans the file for the token and extracts entries.
 */

async function youtubeWatchSuggestions(videoId, maxPages = 5) {
    const result = { results: [], version: require('./package.json').version, continuationCount: 0 };
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Fetch watch page HTML
    const resp = await axios.get(videoUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' },
    });

    const text = resp.data;


    const token = '"lockupMetadataViewModel"';
    let idx = 0;
    const items = [];

    while (true) {
        const tokenPos = text.indexOf(token, idx);
        if (tokenPos === -1) break;

        // find colon after token
        const colonPos = text.indexOf(':', tokenPos + token.length);
        if (colonPos === -1) { idx = tokenPos + token.length; continue; }

        // extract balanced object starting from colonPos
        const objExtract = extractBalancedObject(text, colonPos);
        if (!objExtract) { idx = tokenPos + token.length; continue; }

        const rawBlock = objExtract.text;

        // Normalize and parse to JSON
        const jsonLike = normalizeToJson(rawBlock);

        let metadata;
        try {
            metadata = JSON.parse(jsonLike);
        } catch (err) {
            // parsing failed; still attempt to salvage some fields with regex fallback
            metadata = null;
        }

        // 1) title (prefer parsed)
        let title = metadata?.title?.content ?? null;
        if (!title) {
            const m = rawBlock.match(/"title"\s*:\s*\{\s*"content"\s*:\s*"([^"]+)"/s);
            if (m) title = m[1];
        }

        // 2) views (secondary text / metadataRows)
        let views = metadata?.metadata?.contentMetadataViewModel?.metadataRows?.[1]?.metadataParts?.[0]?.text?.content ?? null;
        if (!views) {
            const m = rawBlock.match(/"secondaryText"\s*:\s*\{\s*"content"\s*:\s*"([^"]+)"/s) ||
                rawBlock.match(/"metadataParts"\s*:\s*\[\s*\{\s*"text"\s*:\s*\{\s*"content"\s*:\s*"([^"]+)"/s);
            if (m) views = m[1];
        }

        // 3) duration and thumbnail & id — often stored nearby, so take context around the extracted object
        const ctxStart = Math.max(0, tokenPos - 1500);
        const ctxEnd = Math.min(text.length, objExtract.endPos + 1500);
        const ctx = text.slice(ctxStart, ctxEnd);

        const idMatch = ctx.match(/"videoId"\s*:\s*"([^"]+)"/);
        const id = idMatch ? idMatch[1] : null;

        // thumbnail source pattern: "url":"https://i.ytimg.com/vi/ID/hqdefault.jpg" or similar
        const thumbMatch = ctx.match(/"url"\s*:\s*"((?:https?:)?\/\/i\.ytimg\.com\/[^"]+)"/) ||
            ctx.match(/"url"\s*:\s*"((?:https?:)?\/\/[^"]+\/hqdefault\.jpg[^"]*)"/);
        const thumbnailUrl = thumbMatch ? thumbMatch[1] : null;

        // duration: look for thumbnailBadge text e.g. "12:40"
        const durMatch = ctx.match(/"thumbnailBadgeViewModel"[\s\S]*?"text"\s*:\s*"([^"]+)"/) ||
            ctx.match(/"overlay".[^\n\r]{0,200}?"text"\s*:\s*"([^"]+)"/);
        const duration = durMatch ? durMatch[1] : null;

        items.push({ id, title, thumbnailUrl, duration, views });

        // continue after the extracted object
        idx = objExtract.endPos;
    }

    return items;
}

module.exports = { youtubeWatchSuggestions };

/* Usage example:
(async () => {
  const { youtubeWatchSuggestions } = require('./youtubeWatchSuggestions');
  const res = await youtubeWatchSuggestions('dQw4w9WgXcQ', 3);
  console.log(res.results.slice(0, 10));
})();
*/
