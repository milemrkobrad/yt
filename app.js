const express = require('express');
const scraperSearch = require('./scraperSearch');
const scraperWatch = require('./scraperWatch');
const app = express();
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

app.listen(process.env.PORT || 8080, function () {
  console.log('Listening on port 8080');
});