#!/usr/bin/env node
// Development server for OdyseeLGTV. No dependencies.
//
//   node devserver.js [port]
//
// It does two things:
//   1. Serves the project statically -> the URL on the TV is http://<ip>:<port>/,
//      so there is no need to repackage after every small change.
//   2. Accepts POST /log requests -> the TV's console output flows here, into the terminal
//      and into devlog.txt.

var http = require("http"),
    fs = require("fs"),
    path = require("path"),
    os = require("os");

var PORT = parseInt(process.argv[2], 10) || 3000,
    ROOT = __dirname,
    LOGFILE = path.join(ROOT, "devlog.txt");

var MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml"
};

var E = "[",
    C = {
        reset: E + "0m",
        dim: E + "2m",
        red: E + "31m",
        green: E + "32m",
        yellow: E + "33m",
        cyan: E + "36m",
        grey: E + "90m"
    };

function stamp() {
    var d = new Date();
    function p(n, w) {
        n = String(n);
        while (n.length < (w || 2)) n = "0" + n;
        return n;
    }
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) + "." + p(d.getMilliseconds(), 3);
}

// Highlighting to make the essentials pop out from the noise.
function colorize(level, msg) {
    if (level === "error") return C.red + msg + C.reset;
    if (/\bcache=HIT\b/.test(msg)) return C.green + msg + C.reset;
    if (/\bcache=MISS\b/.test(msg) || /\b(401|403|404|429|503)\b/.test(msg)) return C.yellow + msg + C.reset;
    if (/^\[[^\]]*test\]/.test(msg) || /PLAYBACK STARTED/.test(msg)) return C.cyan + msg + C.reset;
    return msg;
}

function cors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
}

function handleLog(req, res) {
    var body = "";
    req.on("data", function (c) {
        body += c;
        if (body.length > 1e6) req.destroy();
    });
    req.on("end", function () {
        var entries;
        try {
            entries = JSON.parse(body);
        } catch (e) {
            entries = [{ level: "log", msg: body }];
        }
        if (!Array.isArray(entries)) entries = [entries];
        var out = [];
        entries.forEach(function (e) {
            var lvl = e.level === "error" ? "ERR" : "LOG",
                line = "[" + stamp() + "] " + lvl + " " + (e.msg || "");
            process.stdout.write(colorize(e.level, line) + "\n");
            out.push(line);
        });
        fs.appendFile(LOGFILE, out.join("\n") + "\n", function () { });
        cors(res);
        res.writeHead(204);
        res.end();
    });
}

function serveStatic(req, res, urlPath) {
    var rel = decodeURIComponent(urlPath.split("?")[0]);
    if (rel === "/") rel = "/index.html";
    var file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[\/\\])+/, ""));
    if (file.indexOf(ROOT) !== 0) {
        res.writeHead(403);
        return res.end("forbidden");
    }
    fs.readFile(file, function (err, data) {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            return res.end("404 " + rel);
        }
        cors(res);
        res.writeHead(200, {
            "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
            // The TV caches aggressively; this is in the way during development.
            "Cache-Control": "no-store, no-cache, must-revalidate"
        });
        res.end(data);
    });
}

http.createServer(function (req, res) {
    if (req.method === "OPTIONS") {
        cors(res);
        res.writeHead(204);
        return res.end();
    }
    var p = req.url.split("?")[0];
    if (p === "/log" && req.method === "POST") return handleLog(req, res);
    if (p === "/ping") {
        cors(res);
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end("ok");
    }
    serveStatic(req, res, req.url);
}).listen(PORT, "0.0.0.0", function () {
    var ifaces = os.networkInterfaces(),
        addrs = [];
    Object.keys(ifaces).forEach(function (k) {
        ifaces[k].forEach(function (a) {
            if (a.family === "IPv4" && !a.internal) addrs.push(a.address);
        });
    });
    console.log(C.green + "OdyseeLGTV dev server is running on port " + PORT + C.reset);
    console.log(C.dim + "log -> " + LOGFILE + C.reset);
    console.log("");
    if (!addrs.length) console.log(C.yellow + "No LAN address found." + C.reset);
    addrs.forEach(function (a) {
        console.log("  Open on TV:       " + C.cyan + "http://" + a + ":" + PORT + "/" + C.reset);
        console.log("  from file://:     " + C.grey + 'window.DEVLOG_HOST = "' + a + ":" + PORT + '"' + C.reset);
    });
    console.log("");
});
