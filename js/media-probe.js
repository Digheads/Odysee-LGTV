// ---------------------------------------------------------------------------
// Media sniffing, MP4/HLS container parsing and playback diagnostics
// (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var MediaProbe = (function () {
    // MP4 codec identifiers (fourcc) are in the moov box. webOS 2.0 support:
    // H.264 HP@L4.2 and H.265 Main/Main10@L4.1 yes; AV1 none; VP9 only on UHD
    // models; audio AAC/MP3/Dolby/DTS yes, Opus and FLAC no.
    var MP4_CODECS = [
        ["avc1", "H.264/AVC - supported"],
        ["avc3", "H.264/AVC - supported"],
        ["hev1", "H.265/HEVC - supported (till Main/Main10 L4.1)"],
        ["hvc1", "H.265/HEVC - supported (till Main/Main10 L4.1)"],
        ["av01", "AV1 -> not supported by webOS 2.0"],
        ["vp09", "VP9 -> only UHD models"],
        ["vp08", "VP8 -> only via .mkv"],
        ["mp4a", "AAC - supported"],
        ["Opus", "Opus -> not supported by webOS 2.0"],
        ["ac-3", "Dolby Digital - supported"],
        ["ec-3", "Dolby Digital Plus - supported"],
        ["fLaC", "FLAC -> not supported"],
        [".mp3", "MP3 - supported"],
        ["sowt", "PCM - supported"],
        ["twos", "PCM - supported"],
        ["alac", "ALAC -> not supported"],
        ["ac-4", "Dolby AC-4 -> not supported"],
        ["dtsc", "DTS - supported"]
    ];

    // H.264 profile and level codes from the avcC box (AVCDecoderConfigurationRecord).
    // webOS 2.0 maximum: High Profile @ L4.2 (FHD). Anything above this fails,
    // even if the codec itself is "supported".
    var H264_PROFILES = {
        66: "Baseline", 77: "Main", 88: "Extended", 100: "High",
        110: "High 10 (10 bit) -> NOT SUPPORTED", 122: "High 4:2:2 -> NOT SUPPORTED",
        244: "High 4:4:4 -> NOT SUPPORTED", 44: "CAVLC 4:4:4 -> NOT SUPPORTED"
    };

    function u32(t, i) {
        return ((255 & t.charCodeAt(i)) * 16777216) + ((255 & t.charCodeAt(i + 1)) << 16) +
            ((255 & t.charCodeAt(i + 2)) << 8) + (255 & t.charCodeAt(i + 3));
    }

    function u16(t, i) {
        return ((255 & t.charCodeAt(i)) << 8) | (255 & t.charCodeAt(i + 1));
    }

    function sniffFormat(t) {
        if (!t || !t.length) return "Empty response (0 byte)";
        if (0 === t.indexOf("#EXTM3U")) return "HLS playlist (m3u8)";
        if (t.length > 8 && "ftyp" === t.substring(4, 8)) return "MP4 (ftyp box) - valid media";
        if (71 === (255 & t.charCodeAt(0))) return "MPEG-TS (0x47 sync) - valid media";
        if (0 === t.indexOf("<")) return "HTML/XML -> not media, probably an error page";
        var printable = 0,
            n = Math.min(t.length, 200);
        for (var i = 0; i < n; i++) {
            var b = 255 & t.charCodeAt(i);
            if (b >= 32 && b < 127) printable++;
        }
        if (printable > .9 * n) return 'text -> not media: "' + t.substring(0, 90) + '"';
        return "unrecognized binary content";
    }

    function parseAvc(t) {
        var out = [],
            p = t.indexOf("avcC");
        if (p > 0 && t.length > p + 8) {
            var profile = 255 & t.charCodeAt(p + 5),
                level = 255 & t.charCodeAt(p + 7),
                pname = H264_PROFILES[profile] || ("unknown (" + profile + ")"),
                lname = (level / 10).toFixed(1),
                warn = "";
            if (level > 42) warn = " -> over L4.2, not supported by FHD devices";
            out.push("profile: " + pname + ", level: L" + lname + warn);
        }
        var v = t.indexOf("avc1");
        if (v > 0 && t.length > v + 32)
            out.push("resolution: " + u16(t, v + 28) + "x" + u16(t, v + 30));
        return out;
    }

    function scanCodecs(t) {
        var hits = [];
        for (var i = 0; i < MP4_CODECS.length; i++)
            if (-1 !== t.indexOf(MP4_CODECS[i][0]))
                hits.push(MP4_CODECS[i][0] + " = " + MP4_CODECS[i][1]);
        return hits;
    }

    function fetchRange(url, range, cb) {
        var x = new XMLHttpRequest();
        x.open("GET", url, true);
        try {
            x.overrideMimeType("text/plain; charset=x-user-defined");
        } catch (err) { }
        x.setRequestHeader("Range", range);
        x.timeout = 20000;
        x.onreadystatechange = function () {
            if (4 === x.readyState) cb(x.responseText || "", x.status);
        };
        x.ontimeout = x.onerror = function () {
            cb("", 0);
        };
        x.send();
    }

    function dirOf(u) {
        var q = u.indexOf("?");
        if (q > 0) u = u.substring(0, q);
        return u.substring(0, u.lastIndexOf("/"));
    }

    function makeObjectUrl(text) {
        try {
            var U = window.URL || window.webkitURL;
            if (U && U.createObjectURL && "undefined" != typeof Blob) {
                var b = new Blob([text], { type: "application/x-mpegurl" });
                return { url: U.createObjectURL(b), kind: "blob" };
            }
        } catch (e) { }
        try {
            return { url: "data:application/x-mpegurl;charset=utf-8," + encodeURIComponent(text), kind: "data" };
        } catch (e2) { }
        return null;
    }

    function pickVariant(master, maxHeight) {
        var lines = master.split(/\r?\n/),
            best = null;
        for (var i = 0; i < lines.length; i++) {
            if (0 !== lines[i].indexOf("#EXT-X-STREAM-INF")) continue;
            var res = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i]),
                bw = /BANDWIDTH=(\d+)/.exec(lines[i]),
                uri = lines[i + 1];
            if (!uri || 0 === uri.indexOf("#")) continue;
            var h = res ? parseInt(res[2], 10) : 0,
                b = bw ? parseInt(bw[1], 10) : 0;
            if (h > maxHeight) continue;
            if (!best || h > best.h || (h === best.h && b > best.b)) best = { uri: uri, h: h, b: b };
        }
        return best;
    }

    function buildV3Playlist(masterUrl, label, cb) {
        var base = dirOf(masterUrl);
        fetchRange(masterUrl, "bytes=0-65535", function (master, st) {
            if (!master.length) return cb(null, "master playlist not loaded (HTTP " + st + ")");
            var v = pickVariant(master, 1080);
            if (!v) return cb(null, "could not find supported variant in master");
            console.log("[" + label + "] the chosen variant is: " + v.uri + " (" + v.h + "p, " + Math.round(v.b / 1000) + " kbps)");
            var vurl = 0 === v.uri.indexOf("http") ? v.uri : base + "/" + v.uri;
            fetchRange(vurl, "bytes=0-1048575", function (pl, st2) {
                if (!pl.length || 0 !== pl.indexOf("#EXTM3U")) return cb(null, "the playlist variant not loaded (HTTP " + st2 + ")");
                var vbase = dirOf(vurl),
                    src = pl.split(/\r?\n/),
                    out = [],
                    seg = 0;
                for (var i = 0; i < src.length; i++) {
                    var ln = src[i];
                    if (0 === ln.indexOf("#EXT-X-VERSION")) { out.push("#EXT-X-VERSION:3"); continue; }
                    if (0 === ln.indexOf("#EXT-X-INDEPENDENT-SEGMENTS")) continue;   // v6-only
                    if (ln && 0 !== ln.indexOf("#")) {
                        seg++;
                        out.push(0 === ln.indexOf("http") ? ln : vbase + "/" + ln);
                        continue;
                    }
                    out.push(ln);
                }
                var text = out.join("\n"),
                    o = makeObjectUrl(text);
                if (!o) return cb(null, "not a Blob, not data: cannot create a URL");
                console.log("[" + label + "] v3 playlist done: " + seg + " segment, " +
                    text.length + " byte, " + o.kind + " URL");
                cb(o.url, null);
            });
        });
    }

    function findMoov(t) {
        var off = 0;
        while (off + 8 <= t.length) {
            var sz = u32(t, off),
                typ = t.substring(off + 4, off + 8);
            if (1 === sz) {
                if (off + 16 > t.length) return -1;
                sz = u32(t, off + 12);   // the lower half of the 64-bit size is enough
            }
            if (sz < 8) return -1;
            if ("moov" === typ) return off;
            off += sz;
        }
        return -1;
    }

    function parseMoov(t, base, label) {
        var names = {
            66: "Baseline", 77: "Main", 88: "Extended", 100: "High",
            110: "High 10 (10 bit)", 122: "High 4:2:2", 244: "High 4:4:4"
        },
            codecNames = {
                avc1: "H.264/AVC", avc3: "H.264/AVC", hev1: "H.265/HEVC", hvc1: "H.265/HEVC",
                av01: "AV1 -> not supported by webOS 2.0", vp09: "VP9 -> only on UHD models",
                mp4a: "AAC", Opus: "Opus -> not supported by webOS 2.0", "ac-3": "Dolby Digital",
                "ec-3": "Dolby Digital Plus", fLaC: "FLAC -> not supported"
            },
            i = base,
            found = 0,
            width = 0;

        while (-1 !== (i = t.indexOf("stsd", i))) {
            var fc = t.substring(i + 16, i + 20);
            found++;
            console.log("[" + label + "] sav " + found + ": " + fc + " = " + (codecNames[fc] || "unkown"));
            if ("hvc1" === fc || "hev1" === fc) {
                console.log("[" + label + "]   resolution: " + u16(t, i + 44) + "x" + u16(t, i + 46));
                var hp = t.indexOf("hvcC", i);
                if (hp > 0 && hp < i + 400) {
                    var pidc = 31 & t.charCodeAt(hp + 5),
                        lidc = 255 & t.charCodeAt(hp + 16),
                        pn = { 1: "Main", 2: "Main 10", 3: "Main Still Picture" }[pidc] || ("profile " + pidc);
                    console.log("[" + label + "]   profile: " + pn + ", level: L" + (lidc / 30).toFixed(1));
                }
                console.log("[" + label + "]   WARNING: HEVC is included in the webOS 2.0 media player spec, but the WebKit 538.2 <video> element apparently doesn't play it. Transcode is required.");
            }
            if ("avc1" === fc || "avc3" === fc) {
                width = u16(t, i + 44);
                console.log("[" + label + "]   resolution: " + width + "x" + u16(t, i + 46));
                var p = t.indexOf("avcC", i);
                if (p > 0 && p < i + 400) {
                    var prof = 255 & t.charCodeAt(p + 5),
                        lev = 255 & t.charCodeAt(p + 7),
                        warn = "";
                    if (lev > 42 && width <= 1920) warn = "  <== Above L4.2 (borderline on FHD)";
                    if (prof > 100) warn += "  <== profiles above High are not supported";
                    console.log("[" + label + "]   profile: " + (names[prof] || prof) +
                        ", level: L" + (lev / 10).toFixed(1) + warn);
                }
            }
            i += 4;
        }
        if (!found) console.log("[" + label + "] no stsd is found in moov");
    }

    function checkFaststart(url, label) {
        fetchRange(url, "bytes=0-255", function (t, st) {
            if (t.length < 16) return;
            if ("ftyp" !== t.substring(4, 8)) {
                console.log("[" + label + "] the file not starts with ftyp (" + t.substring(4, 8) + ")");
                return;
            }
            var off = u32(t, 0),
                hop = 0;
            while (off + 8 <= t.length && hop < 8) {
                var typ = t.substring(off + 4, off + 8),
                    sz = u32(t, off);
                if ("moov" === typ) {
                    console.log("[" + label + "] container: faststart (moov in the begining) - OK");
                    return;
                }
                if ("mdat" === typ) {
                    console.error("[" + label + "] container: NOT faststart - mdat in the begining,moov is at the end of the file. With a large file, this is the most likely reason why the player stops with readyState=0 (does not send a range seek to the end).");
                    return;
                }
                if (sz < 8) return;
                off += sz;
                hop++;
            }
            console.log("[" + label + "] the container layout was not decided from the first 256 bytes");
        });
    }

    function probeCodec(url, label) {
        fetchRange(url, "bytes=0-65535", function (head, st) {
            var m = findMoov(head);
            if (m >= 0) {
                console.log("[" + label + "] moov at the begining (HTTP " + st + ")");
                return parseMoov(head, m, label);
            }
            console.log("[" + label + "] a moov NOT at the begining (not faststart) -> requesting at the end");
            console.log("[" + label + "] WARNING: if the player stops with readyState=0, this is probably the reason -- the metadata is at the end of the file, and the pipeline does not send a range-seek there. In this case, the codec/level is secondary.");
            fetchRange(url, "bytes=-524288", function (tail, st2) {
                if (!tail.length) return void console.log("[" + label + "] a fajlveg nem elerheto (HTTP " + st2 + ")");
                var p = tail.lastIndexOf("moov");
                if (p < 4) return void console.log("[" + label + "] a moov a letoltott vegben sincs meg");
                parseMoov(tail, p, label);
            });
        });
    }

    function probeUrl(url, label) {
        var x = new XMLHttpRequest();
        x.open("GET", url, true);
        try {
            x.overrideMimeType("text/plain; charset=x-user-defined");
        } catch (err) { }
        x.setRequestHeader("Range", "bytes=0-1023");
        x.timeout = 15000;
        x.onreadystatechange = function () {
            if (4 !== x.readyState) return;
            var ct = "",
                cl = "";
            try {
                ct = x.getResponseHeader("Content-Type") || "";
                cl = x.getResponseHeader("Content-Length") || "";
            } catch (err) { }
            var t = x.responseText || "",
                hex = "",
                n = Math.min(t.length, 16);
            for (var i = 0; i < n; i++) {
                var b = 255 & t.charCodeAt(i);
                hex += (b < 16 ? "0" : "") + b.toString(16) + " ";
            }
            console.log("[" + label + "] HTTP " + x.status + "  ct=" + (ct || "?") + "  len=" + (cl || t.length));
            console.log("[" + label + "] byte: " + (hex || "(empty)"));
            var verdict = sniffFormat(t);
            console.log("[" + label + "] >>> " + verdict);
            if (0 === verdict.indexOf("MP4")) probeCodec(url, label);
            if (0 === t.indexOf("#EXTM3U"))
                console.log("[" + label + "] playlist: " + t.substring(0, 220).replace(/\n/g, " | "));
        };
        x.ontimeout = x.onerror = function () {
            console.error("[" + label + "] the probe did not respond (CORS block or network error)");
        };
        x.send();
    }

    return {
        MP4_CODECS: MP4_CODECS,
        H264_PROFILES: H264_PROFILES,
        sniffFormat: sniffFormat,
        parseAvc: parseAvc,
        scanCodecs: scanCodecs,
        fetchRange: fetchRange,
        dirOf: dirOf,
        makeObjectUrl: makeObjectUrl,
        pickVariant: pickVariant,
        buildV3Playlist: buildV3Playlist,
        findMoov: findMoov,
        parseMoov: parseMoov,
        checkFaststart: checkFaststart,
        probeCodec: probeCodec,
        probeUrl: probeUrl
    };
})();

// Global backwards-compatibility aliases
var sniffFormat = MediaProbe.sniffFormat;
var checkFaststart = MediaProbe.checkFaststart;
var probeCodec = MediaProbe.probeCodec;
var probeUrl = MediaProbe.probeUrl;
var buildV3Playlist = MediaProbe.buildV3Playlist;
