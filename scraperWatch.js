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
    //const result = { results: [], version: require('./package.json').version, continuationCount: 0 };
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Fetch watch page HTML
    const resp = await axios.get(videoUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' },
    });

    const text = resp.data;

    const match = text.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});/);

    if (match) {
        const json = match[1];
        const parsed = JSON.parse(json);
        //save to text file for debugging
        require('fs').writeFileSync('ytInitialData.json', JSON.stringify(parsed, null, 2));

        // Extract blocks
        const blocks = extractBlocksByKey(text, 'lockupViewModel');

        const results = [];

        for (const raw of blocks) {
            const parsed = safeParse(raw);
            if (!parsed) continue;

            // parsed should be an object like { lockupViewModel: { ... } } or already the inner object.
            const vm = parsed.lockupViewModel ? parsed.lockupViewModel : parsed;

            // videoId: prefer contentId, else try to find watchEndpoint.videoId in nested commandContext
            let videoId = vm.contentId || null;
            try {
                if (!videoId) {
                    const cmd = vm.rendererContext && vm.rendererContext.commandContext && vm.rendererContext.commandContext.onTap && vm.rendererContext.commandContext.onTap.innertubeCommand;
                    if (cmd && cmd.watchEndpoint && cmd.watchEndpoint.videoId) {
                        videoId = cmd.watchEndpoint.videoId;
                    } else {
                        // sometimes nested deeper
                        const watchEndpoint = JSON.stringify(vm).match(/"watchEndpoint":\s*{[^}]*"videoId"\s*:\s*"([^"]+)"/);
                        if (watchEndpoint) videoId = watchEndpoint[1];
                    }
                }
            } catch (e) { /* ignore */ }

            // title: try rendererContext.accessibilityContext.label, else look for title.simpleText or title.runs[].text
            let title = null;
            try {
                title = vm.rendererContext && vm.rendererContext.accessibilityContext && vm.rendererContext.accessibilityContext.label;
                if (!title) {
                    // search for common title locations
                    const t1 = vm.title && (vm.title.simpleText || (vm.title.runs && vm.title.runs.map(r => r.text).join('')));
                    if (t1) title = t1;
                    else {
                        // fallback: try shortByline / adjacent title text in object
                        const match = JSON.stringify(vm).match(/"simpleText"\s*:\s*"([^"]{1,200})"/);
                        if (match) title = match[1];
                    }
                }
            } catch (e) { /* ignore */ }

            // url: prefer commandMetadata.webCommandMetadata.url if present, else construct from videoId
            let url = null;
            try {
                const meta = vm.rendererContext && vm.rendererContext.commandContext && vm.rendererContext.commandContext.onTap && vm.rendererContext.commandContext.onTap.innertubeCommand && vm.rendererContext.commandContext.onTap.innertubeCommand.commandMetadata && vm.rendererContext.commandContext.onTap.innertubeCommand.commandMetadata.webCommandMetadata;
                if (meta && meta.url) url = meta.url;
                else if (videoId) url = `/watch?v=${videoId}`;
            } catch (e) { /* ignore */ }

            // push result (skip if we have neither id nor title)
            if (videoId || title || url) {
                results.push({
                    videoId: videoId || null,
                    title: title || null,
                    url: url || null
                });
            }
        }
        console.log('results:', results);
        return results;
    }
}

// Helper: find all JSON-ish blocks that follow a given keyName, by matching balanced braces.
// Handles quoted strings and escaped quotes so braces inside strings are ignored.
function extractBlocksByKey(text, keyName) {
    const blocks = [];
    const needle = `"${keyName}"`;
    let idx = 0;

    while (true) {
        const pos = text.indexOf(needle, idx);
        if (pos === -1) break;

        // find first '{' after the key
        let i = text.indexOf('{', pos + needle.length);
        if (i === -1) { idx = pos + needle.length; continue; }

        let depth = 0;
        let inString = false;
        let stringChar = null;
        let escaped = false;
        let j = i;

        for (; j < text.length; j++) {
            const ch = text[j];

            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (ch === '\\') {
                    escaped = true;
                } else if (ch === stringChar) {
                    inString = false;
                    stringChar = null;
                }
                // else continue inside string
            } else {
                if (ch === '"' || ch === "'") {
                    inString = true;
                    stringChar = ch;
                } else if (ch === '{') {
                    depth++;
                } else if (ch === '}') {
                    depth--;
                    if (depth === 0) { // closed the top-level object
                        const blockText = text.slice(i, j + 1);
                        blocks.push(blockText);
                        idx = j + 1;
                        break;
                    }
                }
            }
        }

        // if loop finished without finding matching close, break to avoid infinite loop
        if (j >= text.length) break;
    }

    return blocks;
}

// Try to safely parse a JSON-ish string. If JSON.parse fails, try a few mild cleanups.
function safeParse(jsonText) {
    try {
        return JSON.parse(jsonText);
    } catch (e) {
        // common issue: trailing commas -> remove simple trailing commas before closing braces/brackets
        let cleaned = jsonText
            .replace(/,\s*(\}|])/g, '$1')                 // remove trailing commas
            .replace(/([:{,]\s*)'([^']*)'/g, '$1"$2"');  // single-quoted keys/strings -> double quotes (best-effort)

        try {
            return JSON.parse(cleaned);
        } catch (e2) {
            // give up parsing and return null
            return null;
        }
    }
}



module.exports = { youtubeWatchSuggestions };

/* Usage example:
(async () => {
  const { youtubeWatchSuggestions } = require('./youtubeWatchSuggestions');
  const res = await youtubeWatchSuggestions('dQw4w9WgXcQ', 3);
  console.log(res.results.slice(0, 10));
})();
*/
