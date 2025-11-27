const axios = require('axios');

async function youtube(query, maxPages = 5) {
    let json = { results: [], version: require('./package.json').version };

    let url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    let response = await axios.get(url, {
        headers: {
            "accept-language": "en-US,en;q=0.9",
            "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114 Safari/537.36"
        }
    });

    if (response.status !== 200) throw new Error("Failed initial fetch");

    json["parser"] = "json_format";
    json["key"] = response.data.match(/"innertubeApiKey":"([^"]*)/)[1];

    // Parse initial page
    let re = new RegExp('(?<=ytInitialData = )(.*?)(?=;<\\/script>)');
    let match = response.data.match(re);
    let data = JSON.parse(match[1]);
    let sectionLists =
        data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;

    parseJsonFormat(sectionLists, json);

    // Fetch continuation pages
    let page = 1;
    while (json.nextPageToken && page < maxPages) {
        page++;
        let continuationData = await fetchContinuationPage(json.nextPageToken, json.key);

        if (!continuationData) break;

        let contContents =
            continuationData.onResponseReceivedCommands[0].appendContinuationItemsAction.continuationItems;

        parseJsonFormat(contContents, json);

        if (!json.nextPageToken) break;
    }

    return json;
}

async function fetchContinuationPage(token, apiKey) {
    const url = `https://www.youtube.com/youtubei/v1/search?key=${apiKey}`;

    const body = {
        continuation: token,
        context: {
            client: {
                clientName: "WEB",
                clientVersion: "2.20230622.06.00"
            }
        }
    };

    try {
        const res = await axios.post(url, body, {
            headers: {
                "content-type": "application/json",
                "x-youtube-client-name": "1",
                "x-youtube-client-version": "2.20230622.06.00",
                "user-agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114 Safari/537.36"
            }
        });

        return res.data;
    } catch (err) {
        console.error("Continuation request failed:", err.message);
        return null;
    }
}


/**
 * Parse youtube search results from json sectionList array and add to json result object
 * @param {Array} contents - The array of sectionLists
 * @param {Object} json - The object being returned to caller
 */
function parseJsonFormat(contents, json) {
    contents.forEach(sectionList => {
        try {
            if (sectionList.hasOwnProperty("itemSectionRenderer")) {
                sectionList.itemSectionRenderer.contents.forEach(content => {
                    try {
                        if (content.hasOwnProperty("channelRenderer")) {
                            json.results.push(parseChannelRenderer(content.channelRenderer));
                        }
                        if (content.hasOwnProperty("videoRenderer")) {
                            json.results.push(parseVideoRenderer(content.videoRenderer));
                        }
                        if (content.hasOwnProperty("radioRenderer")) {
                            json.results.push(parseRadioRenderer(content.radioRenderer));
                        }
                        if (content.hasOwnProperty("playlistRenderer")) {
                            json.results.push(parsePlaylistRenderer(content.playlistRenderer));
                        }
                    } catch (ex) {
                        console.error("Failed to parse renderer:", ex);
                    }
                });
            } else if (sectionList.hasOwnProperty("continuationItemRenderer")) {
                json["nextPageToken"] =
                    sectionList.continuationItemRenderer.continuationEndpoint
                        .continuationCommand.token;
            }
        } catch (ex) {
            console.error("Failed to read section:", ex);
        }
    });
}


/**
 * Parse a channelRenderer object from youtube search results
 * @param {object} renderer - The channel renderer
 * @returns object with data to return for this channel
 */
function parseChannelRenderer(renderer) {
    let channel = {
        "id": renderer.channelId,
        "title": renderer.title.simpleText,
        "url": `https://www.youtube.com${renderer.navigationEndpoint.commandMetadata.webCommandMetadata.url}`,
        "snippet": renderer.descriptionSnippet ? renderer.descriptionSnippet.runs.reduce(comb, "") : "",
        "thumbnail_src": renderer.thumbnail.thumbnails[renderer.thumbnail.thumbnails.length - 1].url,
        "video_count": renderer.videoCountText ? renderer.videoCountText.runs.reduce(comb, "") : "",
        "subscriber_count": renderer.subscriberCountText ? renderer.subscriberCountText.simpleText : "0 subscribers",
        "verified": renderer.ownerBadges &&
                    renderer.ownerBadges.some(badge => badge.metadataBadgeRenderer.style.indexOf("VERIFIED") > -1) || 
                    false
    };

    return { channel };
}

/**
 * Parse a playlistRenderer object from youtube search results
 * @param {object} renderer - The playlist renderer
 * @returns object with data to return for this playlist
 */
function parsePlaylistRenderer(renderer) {
    let thumbnails = renderer.thumbnailRenderer.playlistVideoThumbnailRenderer.thumbnail.thumbnails;
    let playlist = {
        "id": renderer.playlistId,
        "title": renderer.title.simpleText,
        "url": `https://www.youtube.com${renderer.navigationEndpoint.commandMetadata.webCommandMetadata.url}`,
        "thumbnail_src": thumbnails[thumbnails.length - 1].url,
        "video_count": renderer.videoCount
    };

    let uploader = {
        "username": renderer.shortBylineText.runs[0].text,
        "url": `https://www.youtube.com${renderer.shortBylineText.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url}`
    };

    return { playlist: playlist, uploader: uploader };
}

/**
 * Parse a radioRenderer object from youtube search results
 * @param {object} renderer - The radio renderer
 * @returns object with data to return for this mix
 */
function parseRadioRenderer(renderer) {
    let radio = {
        "id": renderer.playlistId,
        "title": renderer.title.simpleText,
        "url": `https://www.youtube.com${renderer.navigationEndpoint.commandMetadata.webCommandMetadata.url}`,
        "thumbnail_src": renderer.thumbnail.thumbnails[renderer.thumbnail.thumbnails.length - 1].url,
        "video_count": renderer.videoCountText.runs.reduce(comb, "")
    };

    let uploader = {
        "username": renderer.shortBylineText ? renderer.shortBylineText.simpleText : "YouTube"
    };

    return { radio: radio, uploader: uploader };
}

/**
 * Parse a videoRenderer object from youtube search results
 * @param {object} renderer - The video renderer
 * @returns object with data to return for this video
 */
function parseVideoRenderer(renderer) {
    let video = {
        "id": renderer.videoId,
        "title": renderer.title.runs.reduce(comb, ""),
        "url": `https://www.youtube.com${renderer.navigationEndpoint.commandMetadata.webCommandMetadata.url}`,
        "duration": renderer.lengthText ? renderer.lengthText.simpleText : "Live",
        "snippet": renderer.descriptionSnippet ?
                   renderer.descriptionSnippet.runs.reduce((a, b) => a + (b.bold ? `<b>${b.text}</b>` : b.text), ""):
                   "",
        "upload_date": renderer.publishedTimeText ? renderer.publishedTimeText.simpleText : "Live",
        "thumbnail_src": renderer.thumbnail.thumbnails[renderer.thumbnail.thumbnails.length - 1].url,
        "views": renderer.viewCountText ?
            renderer.viewCountText.simpleText || renderer.viewCountText.runs.reduce(comb, "") :
            (renderer.publishedTimeText ? "0 views" : "0 watching")
    };

    let uploader = {
        "username": renderer.ownerText.runs[0].text,
        "url": `https://www.youtube.com${renderer?.ownerText?.runs[0]?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url}`
    };
    uploader.verified = renderer.ownerBadges &&
        renderer.ownerBadges.some(badge => badge.metadataBadgeRenderer.style.indexOf("VERIFIED") > -1) || 
        false;

    return { video: video, uploader: uploader };
}

/**
 * Combine array containing objects in format { text: "string" } to a single string
 * For use with reduce function
 * @param {string} a - Previous value
 * @param {object} b - Current object
 * @returns Previous value concatenated with new object text
 */
function comb(a, b) {
    return a + b.text;
}

module.exports.youtube = youtube;