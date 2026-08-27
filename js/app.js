// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

// WebKit 538.2 (webOS 2.0) only supports -webkit-flex; the unprefixed
// "flex" value is invalid and the assignment is silently ignored. We set the
// prefixed version first, then the unprefixed one -- on modern engines the latter wins,
// but on older ones it is invalid, so it falls back to -webkit-flex.
function setDisplayFlex(el) {
    el.style.display = "-webkit-flex";
    el.style.display = "flex";
}

// ---------------------------------------------------------------------------
// Diagnostics: what is actually arriving?
// The <video> element only gives an error code, nothing about what the server sent.
// This probe fetches the first 1 KB and tells if it is media at all.
// ---------------------------------------------------------------------------

function sniffFormat(t) {
    if (!t || !t.length) return "URES valasz (0 byte)";
    if (0 === t.indexOf("#EXTM3U")) return "HLS playlist (m3u8)";
    if (t.length > 8 && "ftyp" === t.substring(4, 8)) return "MP4 (ftyp box) - ervenyes media";
    if (71 === (255 & t.charCodeAt(0))) return "MPEG-TS (0x47 sync) - ervenyes media";
    if (0 === t.indexOf("<")) return "HTML/XML -> NEM media, valoszinuleg hibaoldal";
    var printable = 0,
        n = Math.min(t.length, 200);
    for (var i = 0; i < n; i++) {
        var b = 255 & t.charCodeAt(i);
        if (b >= 32 && b < 127) printable++
    }
    if (printable > .9 * n) return 'SZOVEG -> NEM media: "' + t.substring(0, 90) + '"';
    return "ismeretlen binaris tartalom";
}

// MP4 codec identifiers (fourcc) are in the moov box. webOS 2.0 support:
// H.264 HP@L4.2 and H.265 Main/Main10@L4.1 yes; AV1 none; VP9 only on UHD
// models; audio AAC/MP3/Dolby/DTS yes, Opus and FLAC no.
var MP4_CODECS = [
    ["avc1", "H.264/AVC - tamogatott"],
    ["avc3", "H.264/AVC - tamogatott"],
    ["hev1", "H.265/HEVC - tamogatott (Main/Main10 L4.1-ig)"],
    ["hvc1", "H.265/HEVC - tamogatott (Main/Main10 L4.1-ig)"],
    ["av01", "AV1 -> a webOS 2.0 NEM TUDJA"],
    ["vp09", "VP9 -> csak UHD modellen"],
    ["vp08", "VP8 -> csak .mkv-ben"],
    ["mp4a", "AAC - tamogatott"],
    ["Opus", "Opus -> a webOS 2.0 NEM TUDJA"],
    ["ac-3", "Dolby Digital - tamogatott"],
    ["ec-3", "Dolby Digital Plus - tamogatott"],
    ["fLaC", "FLAC -> nem tamogatott"],
    [".mp3", "MP3 - tamogatott"],
    ["sowt", "PCM - tamogatott"],
    ["twos", "PCM - tamogatott"],
    ["alac", "ALAC -> nem tamogatott"],
    ["ac-4", "Dolby AC-4 -> nem tamogatott"],
    ["dtsc", "DTS - tamogatott"]
];

// H.264 profile and level codes from the avcC box (AVCDecoderConfigurationRecord).
// webOS 2.0 maximum: High Profile @ L4.2 (FHD). Anything above this fails,
// even if the codec itself is "supported".
var H264_PROFILES = {
    66: "Baseline", 77: "Main", 88: "Extended", 100: "High",
    110: "High 10 (10 bit) -> NEM TAMOGATOTT", 122: "High 4:2:2 -> NEM TAMOGATOTT",
    244: "High 4:4:4 -> NEM TAMOGATOTT", 44: "CAVLC 4:4:4 -> NEM TAMOGATOTT"
};

function u16(t, i) {
    return ((255 & t.charCodeAt(i)) << 8) | (255 & t.charCodeAt(i + 1));
}

// avcC: [size:4]["avcC":4][version:1][profile:1][compat:1][level:1]
function parseAvc(t) {
    var out = [],
        p = t.indexOf("avcC");
    if (p > 0 && t.length > p + 8) {
        var profile = 255 & t.charCodeAt(p + 5),
            level = 255 & t.charCodeAt(p + 7),
            pname = H264_PROFILES[profile] || ("ismeretlen (" + profile + ")"),
            lname = (level / 10).toFixed(1),
            warn = "";
        if (level > 42) warn = " -> L4.2 FOLOTT, FHD keszuleken NEM TAMOGATOTT";
        out.push("profil: " + pname + ", szint: L" + lname + warn);
    }
    var v = t.indexOf("avc1");
    if (v > 0 && t.length > v + 32)
        out.push("felbontas: " + u16(t, v + 28) + "x" + u16(t, v + 30));
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
        x.overrideMimeType("text/plain; charset=x-user-defined")
    } catch (err) { }
    x.setRequestHeader("Range", range);
    x.timeout = 20000;
    x.onreadystatechange = function () {
        if (4 === x.readyState) cb(x.responseText || "", x.status)
    };
    x.ontimeout = x.onerror = function () {
        cb("", 0)
    };
    x.send()
}

// The moov box (containing the codec descriptor) can be at the beginning of the file (faststart) or at the end.
// We check the beginning first; if not found, we request a chunk from the end.
// ---------------------------------------------------------------------------
// HLS v6 -> v3 translation
// Odysee playlists declare #EXT-X-VERSION:6 because ffmpeg
// hls_flags=independent_segments adds the #EXT-X-INDEPENDENT-SEGMENTS tag.
// However, webOS 2.0 only supports HLS v3, and according to the standard, a client MUST NOT
// play a higher version. The content itself is v3-capable: only EXTINF,
// TARGETDURATION, MEDIA-SEQUENCE, PLAYLIST-TYPE, ENDLIST and .ts segments
// are present -- no EXT-X-MAP, no BYTERANGE. Therefore, we download the playlist,
// rewrite it to v3, make segment URLs absolute, and pass it to the <video>
// as a blob/data URL.
// ---------------------------------------------------------------------------

// HLS cannot be used on this device without a proxy:
//   - Odysee playlists declare #EXT-X-VERSION:6 (due to ffmpeg
//     hls_flags=independent_segments), and webOS 2.0 only supports HLS v3;
//   - the v3-rewritten playlist starts on a blob:file:/// URL (the player
//     accepts it, no Error 4), but does not download segments because the media
//     pipeline is a separate process and cannot resolve the blob: scheme;
//   - server-side there is no way to request a v3 playlist, transcoder output is fixed.
// Therefore we skip the 308 discovery by default, and always use the original mp4.
// This makes behavior deterministic and saves an unnecessary roundtrip.
var PREFER_HLS = true;

// Module-level so closePlayer can clear it: otherwise it would fire
// after the player is closed, modifying an already hidden UI.
var stallTimer = null;

function clearStall() {
    if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null
    }
}

// The <video src="..."> provides no type hint to the player: it must guess
// from the URL extension. The Roku app, in contrast, explicitly communicates this
// (streamFormat = "hls" / "mp4"). Its web equivalent is <source type="...">.
// If we provide multiple sources, the player chooses the first one it understands --
// so we don't have to handle the HLS/mp4 fallback ourselves.
function setSources(video, list) {
    video.removeAttribute("src");
    video.innerHTML = "";
    for (var k = 0; k < list.length; k++) {
        if (!list[k] || !list[k].url) continue;
        var s = document.createElement("source");
        s.setAttribute("src", list[k].url);
        if (list[k].type) s.setAttribute("type", list[k].type);
        video.appendChild(s);
        console.log("  forras " + (k + 1) + ": " + (list[k].type || "tipus nelkul") +
            " -> " + list[k].url);
    }
}

var MIME_HLS = "application/vnd.apple.mpegurl",
    MIME_MP4 = "video/mp4";

function dirOf(u) {
    var q = u.indexOf("?");
    if (q > 0) u = u.substring(0, q);
    return u.substring(0, u.lastIndexOf("/"));
}

function makeObjectUrl(text) {
    // Prefer Blob URL; if not available, fallback to data: URI.
    try {
        var U = window.URL || window.webkitURL;
        if (U && U.createObjectURL && "undefined" != typeof Blob) {
            var b = new Blob([text], { type: "application/x-mpegurl" });
            return { url: U.createObjectURL(b), kind: "blob" }
        }
    } catch (e) { }
    try {
        return { url: "data:application/x-mpegurl;charset=utf-8," + encodeURIComponent(text), kind: "data" }
    } catch (e2) { }
    return null;
}

// Selects the best variant from the master playlist that the device can handle.
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
        if (!master.length) return cb(null, "a master playlist nem toltodott le (HTTP " + st + ")");
        var v = pickVariant(master, 1080);
        if (!v) return cb(null, "nem talaltam hasznalhato varianst a masterben");
        console.log("[" + label + "] valasztott varians: " + v.uri + " (" + v.h + "p, " + Math.round(v.b / 1000) + " kbps)");
        var vurl = 0 === v.uri.indexOf("http") ? v.uri : base + "/" + v.uri;
        fetchRange(vurl, "bytes=0-1048575", function (pl, st2) {
            if (!pl.length || 0 !== pl.indexOf("#EXTM3U")) return cb(null, "a varians playlist nem jott meg (HTTP " + st2 + ")");
            var vbase = dirOf(vurl),
                src = pl.split(/\r?\n/),
                out = [],
                seg = 0;
            for (var i = 0; i < src.length; i++) {
                var ln = src[i];
                if (0 === ln.indexOf("#EXT-X-VERSION")) { out.push("#EXT-X-VERSION:3"); continue }
                if (0 === ln.indexOf("#EXT-X-INDEPENDENT-SEGMENTS")) continue;   // v6-only
                if (ln && 0 !== ln.indexOf("#")) {
                    seg++;
                    out.push(0 === ln.indexOf("http") ? ln : vbase + "/" + ln);
                    continue
                }
                out.push(ln)
            }
            var text = out.join("\n"),
                o = makeObjectUrl(text);
            if (!o) return cb(null, "sem Blob, sem data: URL nem keszitheto");
            console.log("[" + label + "] v3 playlist kesz: " + seg + " szegmens, " +
                text.length + " byte, " + o.kind + " URL");
            cb(o.url, null)
        })
    })
}

function u32(t, i) {
    return ((255 & t.charCodeAt(i)) * 16777216) + ((255 & t.charCodeAt(i + 1)) << 16) +
        ((255 & t.charCodeAt(i + 2)) << 8) + (255 & t.charCodeAt(i + 3));
}

function u16(t, i) {
    return ((255 & t.charCodeAt(i)) << 8) | (255 & t.charCodeAt(i + 1));
}

// Iterates over the top-level boxes to find moov. A proper traversal is
// required because the raw mdat can ACCIDENTALLY contain "avc1"
// or "moov" byte sequences -- a simple indexOf gives false positives.
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

// Inside moov: track types, codec fourccs, H.264 profile/level, resolution.
function parseMoov(t, base, label) {
    var names = {
        66: "Baseline", 77: "Main", 88: "Extended", 100: "High",
        110: "High 10 (10 bit)", 122: "High 4:2:2", 244: "High 4:4:4"
    },
        codecNames = {
            avc1: "H.264/AVC", avc3: "H.264/AVC", hev1: "H.265/HEVC", hvc1: "H.265/HEVC",
            av01: "AV1 -> a webOS 2.0 NEM TUDJA", vp09: "VP9 -> csak UHD modellen",
            mp4a: "AAC", Opus: "Opus -> a webOS 2.0 NEM TUDJA", "ac-3": "Dolby Digital",
            "ec-3": "Dolby Digital Plus", fLaC: "FLAC -> nem tamogatott"
        },
        i = base,
        found = 0,
        width = 0;

    while (-1 !== (i = t.indexOf("stsd", i))) {
        var fc = t.substring(i + 16, i + 20);
        found++;
        console.log("[" + label + "] sav " + found + ": " + fc + " = " + (codecNames[fc] || "ismeretlen"));
        if ("hvc1" === fc || "hev1" === fc) {
            console.log("[" + label + "]   felbontas: " + u16(t, i + 44) + "x" + u16(t, i + 46));
            // hvcC: [size:4]["hvcC":4][ver:1][profile_space<<6|tier<<5|profile_idc:1]
            //       [compat:4][constraints:6][level_idc:1]
            var hp = t.indexOf("hvcC", i);
            if (hp > 0 && hp < i + 400) {
                var pidc = 31 & t.charCodeAt(hp + 5),
                    lidc = 255 & t.charCodeAt(hp + 16),
                    pn = { 1: "Main", 2: "Main 10", 3: "Main Still Picture" }[pidc] || ("profil " + pidc);
                console.log("[" + label + "]   profil: " + pn + ", szint: L" + (lidc / 30).toFixed(1));
            }
            console.log("[" + label + "]   FIGYELEM: a HEVC a webOS 2.0 media-lejatszo specjeben szerepel, " +
                "de a WebKit 538.2 <video> eleme a merések szerint nem jatssza le. Transcode kell.");
        }
        if ("avc1" === fc || "avc3" === fc) {
            width = u16(t, i + 44);
            console.log("[" + label + "]   felbontas: " + width + "x" + u16(t, i + 46));
            var p = t.indexOf("avcC", i);
            if (p > 0 && p < i + 400) {
                var prof = 255 & t.charCodeAt(p + 5),
                    lev = 255 & t.charCodeAt(p + 7),
                    warn = "";
                // webOS 2.0: High @ L4.2 is the maximum on FHD, L5.1 only on UHD models.
                if (lev > 42 && width <= 1920) warn = "  <== Above L4.2 (borderline on FHD)";
                if (prof > 100) warn += "  <== profiles above High are not supported";
                console.log("[" + label + "]   profil: " + (names[prof] || prof) +
                    ", szint: L" + (lev / 10).toFixed(1) + warn);
            }
        }
        i += 4;
    }
    if (!found) console.log("[" + label + "] a moov-ban nem talaltam stsd-t");
}

// The moov can be at the beginning of the file (faststart) or at the end. We check the beginning first
// with a proper box traversal; if only ftyp+mdat are there, we request a chunk from the end.
// The container layout is revealed from 64 bytes: the box type following the ftyp box size
// tells us if moov is at the front. If not (so mdat follows), then
// the metadata is at the end of the file, which the media pipeline chokes on for large files --
// it stalls at readyState=0 because it doesn't send a range request to the end.
function checkFaststart(url, label) {
    fetchRange(url, "bytes=0-255", function (t, st) {
        if (t.length < 16) return;
        if ("ftyp" !== t.substring(4, 8)) {
            console.log("[" + label + "] a fajl nem ftyp-pal kezdodik (" + t.substring(4, 8) + ")");
            return
        }
        // There can be padding (free/skip/wide) after ftyp -- we skip those,
// otherwise we would mistakenly classify an ftyp/free/moov file as "not faststart".
        var off = u32(t, 0),
            hop = 0;
        while (off + 8 <= t.length && hop < 8) {
            var typ = t.substring(off + 4, off + 8),
                sz = u32(t, off);
            if ("moov" === typ) {
                console.log("[" + label + "] kontener: faststart (moov elol) - ez rendben van");
                return
            }
            if ("mdat" === typ) {
                console.error("[" + label + "] kontener: NEM faststart - az mdat jon elore, " +
                    "a moov a fajl vegen van. Nagy fajlnal ez a legvaloszinubb oka annak, " +
                    "ha a lejatszo readyState=0-nal megall (nem kuld range-kerest a vegere).");
                return
            }
            if (sz < 8) return;
            off += sz;
            hop++
        }
        console.log("[" + label + "] a kontener elrendezese az elso 256 bajtbol nem dolt el")
    })
}

function probeCodec(url, label) {
    fetchRange(url, "bytes=0-65535", function (head, st) {
        var m = findMoov(head);
        if (m >= 0) {
            console.log("[" + label + "] moov a fajl elejen (HTTP " + st + ")");
            return parseMoov(head, m, label)
        }
        console.log("[" + label + "] a moov NINCS a fajl elejen (nem faststart) -> a vegerol kerem");
        console.log("[" + label + "] FIGYELEM: ha a lejatszo readyState=0-nal allt meg, akkor",
            "valoszinuleg EZ az ok -- a metaadat a fajl vegen van, es a pipeline",
            "nem kuld range-kerest oda. Ilyenkor a kodek/szint masodlagos.");
        fetchRange(url, "bytes=-524288", function (tail, st2) {
            if (!tail.length) return void console.log("[" + label + "] a fajlveg nem elerheto (HTTP " + st2 + ")");
            var p = tail.lastIndexOf("moov");
            if (p < 4) return void console.log("[" + label + "] a moov a letoltott vegben sincs meg");
            parseMoov(tail, p, label)
        })
    })
}

function probeUrl(url, label) {
    var x = new XMLHttpRequest();
    x.open("GET", url, true);
    // On older WebKit this is the reliable way to read raw bytes
// (responseType="arraybuffer" doesn't work everywhere).
    try {
        x.overrideMimeType("text/plain; charset=x-user-defined")
    } catch (err) { }
    x.setRequestHeader("Range", "bytes=0-1023");
    x.timeout = 15000;
    x.onreadystatechange = function () {
        if (4 !== x.readyState) return;
        var ct = "",
            cl = "";
        try {
            ct = x.getResponseHeader("Content-Type") || "";
            cl = x.getResponseHeader("Content-Length") || ""
        } catch (err) { }
        var t = x.responseText || "",
            hex = "",
            n = Math.min(t.length, 16);
        for (var i = 0; i < n; i++) {
            var b = 255 & t.charCodeAt(i);
            hex += (b < 16 ? "0" : "") + b.toString(16) + " "
        }
        console.log("[" + label + "] HTTP " + x.status + "  ct=" + (ct || "?") + "  len=" + (cl || t.length));
        console.log("[" + label + "] byte: " + (hex || "(nincs)"));
        var verdict = sniffFormat(t);
        console.log("[" + label + "] >>> " + verdict);
        // If the transport was okay and media actually arrived, the problem is in
// the content -> let's see what codec it is.
        if (0 === verdict.indexOf("MP4")) probeCodec(url, label);
        // For m3u8, the start of the playlist is revealing by itself (e.g. EXT-X-VERSION)
        if (0 === t.indexOf("#EXTM3U"))
            console.log("[" + label + "] playlist: " + t.substring(0, 220).replace(/\n/g, " | "))
    };
    x.ontimeout = x.onerror = function () {
        console.error("[" + label + "] a proba nem valaszolt (CORS-blokk vagy halozati hiba)")
    };
    x.send()
}

function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// player.odycdn.com by default marks ALL requests as "flagged" and
// returns 401, unless an authorized Referer/Origin/User-Agent header arrives.
// A <video> tag cannot send headers -- however, the
// ?magic=<unix_ts> query parameter completely disables this check for 5 minutes,
// and it's part of the URL, so the <video> can use it.
function buildPlayableUrl(rawUrl, useMagic) {
    var u = rawUrl.replace(/^https:/i, "http:");
    u = u.replace(/([?&])magic=\d+/, "$1").replace(/[?&]$/, "");
    if (!useMagic) return u;
    return u + (-1 === u.indexOf("?") ? "?" : "&") + "magic=" + OdyseeAPI.getServerNowSec();
}

// The webOS 2.0 web engine is WebKit 538.2 -- it cannot decode WebP. Furthermore,
// most raw thumbnails are 1920x1080: 20 cards would be ~101 MB decoded bitmap,
// resized to 400x225 it's ~7 MB. The proxy thus fixes format AND size,
// which is why we need it for every image. The source format cannot be determined
// from the URL anyway: thumbnails.lbry.com serves both JPEG and WebP
// from the same host without extension or Content-Type.
function thumbUrl(u, size) {
    if (!u) return "";
    var w = size || 400;
    return "https://wsrv.nl/?url=" + encodeURIComponent(u) + "&output=jpg&w=" + w;
}

// Infinite scrolling never released the cards. DOM nodes cannot be deleted
// (the .video-card:nth-child(4n) rule would shift, causing scroll jumps),
// so we just drop the image src when far from the viewport. The .thumbnail-wrapper
// holds the space with padding-bottom:56.25%, so the layout doesn't collapse.
var IMG_KEEP_PX = 2500;

function releaseOffscreenThumbs(scroller) {
    if (!scroller) return;
    var cards = scroller.querySelectorAll(".video-card"),
        top = scroller.scrollTop,
        bottom = top + scroller.clientHeight;
    for (var i = 0; i < cards.length; i++) {
        var card = cards[i],
            img = card.querySelector("img.thumbnail");
        if (!img) continue;
        var far = (card.offsetTop + card.offsetHeight < top - IMG_KEEP_PX) ||
            (card.offsetTop > bottom + IMG_KEEP_PX);
        if (far && img.getAttribute("src")) {
            img.setAttribute("data-src", img.getAttribute("src"));
            img.removeAttribute("src")
        } else if (!far && !img.getAttribute("src") && img.getAttribute("data-src")) {
            img.setAttribute("src", img.getAttribute("data-src"))
        }
    }
}

function closePlayer() {
    clearStall();
    var e = document.getElementById("player-container"),
        t = document.getElementById("video-player");
    t.pause(), t.onerror = null, t.innerHTML = "", t.src = "", e.classList.add("hidden"), SpatialNavigation.refresh();
    var targetCard = window.isChannelPageOpen ? window.lastFocusedChannelCard : window.lastFocusedCard;
    if (targetCard) {
        for (var n = document.querySelectorAll(".focusable"), i = 0, o = 0; o < n.length; o++)
            if (null !== n[o].offsetParent) {
                if (n[o] === targetCard) {
                    SpatialNavigation.focusElement(i);
                    break
                }
                i++
            }
    }
}

// The menu is built dynamically from homepage API sections (Featured, Gaming, Tech...).
var navSections = [];

function sectionLabel(id) {
    if ("nav-trending" === id) return "Trending";
    if ("nav-search" === id) return "Search";
    if ("nav-login" === id) return "Login";
    var key = 0 === id.indexOf("cat:") ? id.substring(4) : "";
    for (var i = 0; i < navSections.length; i++)
        if (navSections[i].key === key) return navSections[i].label;
    return "Odysee";
}

function dispatchLoad(id, page, cb) {
    if ("nav-trending" === id) return OdyseeAPI.getTrending(cb, page);
    if ("nav-search" === id) return OdyseeAPI.search(currentSearchQuery, cb, page);
    if (0 === id.indexOf("cat:")) return OdyseeAPI.getCategory(id.substring(4), cb, page);
    cb(new Error("Unknown view: " + id))
}

function bindNav() {
    var items = document.querySelectorAll(".nav-item");
    for (var i = 0; i < items.length; i++) items[i].addEventListener("click", (function () {
        var all = document.querySelectorAll(".nav-item");
        for (var j = 0; j < all.length; j++) all[j].classList.remove("active");
        this.classList.add("active"), loadPage(this.getAttribute("data-id"))
    }))
}

var iconPaths = {
    'nav-login': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>',
    'nav-search': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    'nav-trending': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M11 3L13.2627 8.73726L19 11L13.2627 13.2627L11 19L8.73726 13.2627L3 11L8.73726 8.73726L11 3Z"></path></svg>',
    'cat:MUSIC': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 19 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M6.5 14.5V5.26667L17.5 2V12.5M7 16C7 17.6569 5.65685 19 4 19C2.34315 19 1 17.6569 1 16C1 14.3431 2.34315 13 4 13C5.65685 13 7 14.3431 7 16ZM18 14C18 15.6569 16.6569 17 15 17C13.3431 17 12 15.6569 12 14C12 12.3431 13.3431 11 15 11C16.6569 11 18 12.3431 18 14Z"></path></svg>',
    'cat:GAMING': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M18 5.49925L10.1096 10L18 14.5007C16.4248 17.1904 13.4811 19 10.1096 19C5.07849 19 1 14.9706 1 10C1 5.02944 5.07849 1 10.1096 1C13.4811 1 16.4248 2.80956 18 5.49925Z"></path></svg>',
    'cat:POP_CULTURE': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 20 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M4.26667 8.61538C3.34211 5.52692 2 1 2 1L6.53333 1C6.53333 2.65 7.66667 4.3 9.36667 4.3L9.36667 2.65L9.93333 3.2L11.0667 3.2L11.6333 2.65L11.6333 4.3C13.9 4.3 15.0333 1.55 15.0333 1L19 1C18.5526 2.65 17.6579 7.21923 17.3 8.61538C15.6 8.61538 11.6333 8.7 10.5 12C9.36667 8.7 5.96667 8.61538 4.26667 8.61538Z"></path></svg>',
    'cat:SCIENCE': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 25 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M21.2,5a3.034,3.034,0,0,0-3.067-3,3.077,3.077,0,0,0-1.847.62,5.392,5.392,0,0,0-8.572,0A3.077,3.077,0,0,0,5.867,2,3.034,3.034,0,0,0,2.8,5" fill="none"></path><path d="M2.8,5a2.251,2.251,0,1,0,0,4.5H5.5" fill="none"></path><path d="M21.2,5a2.251,2.251,0,1,1,0,4.5H18.5" fill="none"></path><path d="M8.5,7.5V9.366A3.134,3.134,0,0,1,5.366,12.5" fill="none"></path><path d="M15.5,7.5V9.366A3.134,3.134,0,0,0,18.634,12.5" fill="none"></path><path d="M10.5 8.5L10.5 10.5" fill="none"></path><path d="M13.5 8.5L13.5 10.5" fill="none"></path><path d="M8.5,15.75a.25.25,0,1,1-.25.25.25.25,0,0,1,.25-.25" fill="none"></path><path d="M15.5,15.75a.25.25,0,1,1-.25.25.25.25,0,0,1,.25-.25" fill="none"></path><path d="M12,17.5A1.5,1.5,0,0,0,10.5,19v1a1.5,1.5,0,0,0,3,0V19A1.5,1.5,0,0,0,12,17.5Z" fill="none"></path><path d="M18.634,12.5S18,13.5,12,13.5s-6.634-1-6.634-1a7.5,7.5,0,1,0,13.268,0Z" fill="none"></path></svg>',
    'cat:TECHNOLOGY': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 21 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M6 2V0M15 2V0M10.5 2V0M6 20V18M15 20V18M10.5 20V18M0.555542 5H2.55554M0.555542 14H2.55554M0.555542 9.5H2.55554M18.5555 5H20.5M18.5555 14H20.5M18.5555 9.5H20.5M7 15H14C15.1046 15 16 14.1046 16 13V7C16 5.89543 15.1046 5 14 5H7C5.89543 5 5 5.89543 5 7V13C5 14.1046 5.89543 15 7 15Z"></path></svg>',
    'cat:NEWS_AND_POLITICS': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 21 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M17.7553 6.50001L19.7553 6.00001M17.7553 11L19.7553 11.5M16.2553 2.00001L17.3262 1M3.17018 8.10369L2.98445 8.23209C2.85036 8.32478 2.70264 8.3958 2.56048 8.47556C1.88883 8.85235 1.38281 9.7222 1.52367 10.5694C1.6624 11.4038 2.3113 12.0619 3.14392 12.2112L4.75526 12.5L4.75528 14.5L5.30241 16.292C5.43083 16.7126 5.81901 17 6.25882 17H8.69504M3.17018 8.10369L12.2582 2.84235M3.17018 8.10369L4.00718 12.1694L14.0948 12.5372M8.69504 17H9M8.69504 17L7.75527 14.5L7.75529 12.5M12.2553 2.00001L13.2553 7.50001L14.2553 13.5M14.1875 8.6648C14.8624 8.53243 15.3022 7.87802 15.1698 7.20313C15.0375 6.52824 14.383 6.08843 13.7082 6.22079"></path></svg>',
    'cat:EDUCATION': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 20 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M3 5.99999L3 12M3 12L4 14H2L3 12ZM16 6.99999V10.85L10.5 14L5 10.85V6.99999M10.4583 1.00317L2.68056 5.77776L10.4583 9.9658L18.2361 5.77776L10.4583 1.00317Z"></path></svg>',
    'cat:SPORTS': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 21 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M3.21009 5.08508C6.58582 7.0833 10.5321 12.6392 8.49668 18.4082M17.7408 14.398C13.2297 12.6201 10.8457 6.80095 13.2476 1.69871M19.5 10C19.5 14.9706 15.4706 19 10.5 19C5.52944 19 1.5 14.9706 1.5 10C1.5 5.02944 5.52944 1 10.5 1C15.4706 1 19.5 5.02944 19.5 10Z"></path></svg>',
    'cat:COMEDY': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 19 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M6.00003 12.5C7.54095 14.8536 10.6667 15.7483 13.5 12.5M8.50003 8C7.50003 7 6.00003 7 5.00003 7.99998M14.5 7.99999C13.25 6.99997 12 7.00001 11 8M1 2C5.92105 3.78947 13.0789 3.34211 18 2V4.80013C18 9.80277 16.5622 15.1759 12.4134 17.9713C10.3659 19.3508 8.5887 19.4007 6.26359 17.7683C2.35369 15.0233 1 9.95156 1 5.17427V2Z"></path></svg>',
    'cat:FINANCE': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M12.5 7.5C12 7 11.3 6.5 10.5 6.5M10.5 6.5C8.50001 6.5 7.62294 8.18441 8.5 9.5C9.5 11 12.5 10 12.5 12C12.5 14.0615 10 14.5 8 13M10.5 6.5L10.5 5M10.5 14V15.5M19.5 10C19.5 14.9706 15.4706 19 10.5 19C5.52944 19 1.5 14.9706 1.5 10C1.5 5.02944 5.52944 1 10.5 1C15.4706 1 19.5 5.02944 19.5 10Z"></path></svg>',
    'cat:UNIVERSE': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 21 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><circle cx="9.5" cy="9" r="6"></circle><path d="M4.5 11.5C1.99463 14.4395 1.38564 15.8881 1.99998 16.5C2.80192 17.2988 7.02663 14.7033 11.0697 10.6443C15.1127 6.58533 17.7401 2.64733 16.9382 1.84853C16.3751 1.28769 15 1.5 12.5 3.5"></path></svg>',
    'cat:WILD_WEST': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M12.546,23.25H11.454A10.7,10.7,0,0,1,2.161,7.235L3.75,4.453V2.25A1.5,1.5,0,0,1,5.25.75h3a1.5,1.5,0,0,1,1.5,1.5v3a2.988,2.988,0,0,1-.4,1.488L7.37,10.211a4.7,4.7,0,0,0,4.084,7.039h1.092a4.7,4.7,0,0,0,4.084-7.039L14.646,6.738a2.988,2.988,0,0,1-.4-1.488v-3a1.5,1.5,0,0,1,1.5-1.5h3a1.5,1.5,0,0,1,1.5,1.5v2.2l1.589,2.782A10.7,10.7,0,0,1,12.546,23.25Z"></path><path d="M12,19.875a.375.375,0,0,1,.375.375"></path><path d="M11.625,20.25A.375.375,0,0,1,12,19.875"></path><path d="M12,20.625a.375.375,0,0,1-.375-.375"></path><path d="M12.375,20.25a.375.375,0,0,1-.375.375"></path><path d="M17.813,17.313a.375.375,0,0,1,.529-.024"></path><path d="M17.836,17.843a.376.376,0,0,1-.023-.53"></path><path d="M18.366,17.819a.375.375,0,0,1-.53.024"></path><path d="M18.342,17.289a.375.375,0,0,1,.024.53"></path><path d="M19.843,11.294a.376.376,0,0,1,.34-.407"></path><path d="M20.25,11.634a.375.375,0,0,1-.407-.34"></path><path d="M20.59,11.227a.374.374,0,0,1-.34.407"></path><path d="M20.183,10.887a.375.375,0,0,1,.407.34"></path><path d="M6.187,17.313a.375.375,0,0,0-.529-.024"></path><path d="M6.164,17.843a.376.376,0,0,0,.023-.53"></path><path d="M5.634,17.819a.375.375,0,0,0,.53.024"></path><path d="M5.658,17.289a.375.375,0,0,0-.024.53"></path><path d="M4.157,11.294a.376.376,0,0,0-.34-.407"></path><path d="M3.75,11.634a.375.375,0,0,0,.407-.34"></path><path d="M3.41,11.227a.374.374,0,0,0,.34.407"></path><path d="M3.817,10.887a.375.375,0,0,0-.407.34"></path><path d="M20.25 4.5L18 4.5"></path><path d="M6 4.5L3.75 4.5"></path></svg>',
    'cat:ART': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 20 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M10.8216 10.8774C11.4066 10.2924 12.0646 9.99995 12.7958 9.99995C13.6001 9.99995 14.4775 10.3655 15.355 11.0967C16.1593 11.901 16.4517 13.2172 16.598 14.387C16.6711 15.5569 17.841 16.5806 17.841 16.5806C17.841 16.5806 16.8173 16.7999 15.5743 16.7999C14.1119 16.7999 12.284 16.5806 11.1872 15.4838C9.57861 13.9483 9.65173 12.0473 10.8216 10.8774Z"></path><path d="M9.51658 9.42572C8.74672 10.1914 7.49569 10.1914 6.82207 9.42572L1.43305 3.68294C0.855651 3.10866 0.855651 2.15153 1.43305 1.48154C2.01044 0.907264 2.97277 0.811551 3.55016 1.38583L9.32411 6.74576C10.1902 7.51146 10.1902 8.75573 9.51658 9.42572Z"></path></svg>',
    'cat:LIFESTYLE': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 19 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M1 6L3.31818 4.63636M18 6L9.5507 1.02982C9.51941 1.01142 9.48059 1.01142 9.4493 1.02982L5.47368 3.36842M1.98421 16H6.26842C6.32365 16 6.36842 15.9552 6.36842 15.9V9.73636C6.36842 9.68114 6.41319 9.63636 6.46842 9.63636H12.5316C12.5868 9.63636 12.6316 9.68114 12.6316 9.73636V15.9C12.6316 15.9552 12.6764 16 12.7316 16H17.4632M6.36842 12.8182H1.98421M17.4632 12.8182H12.6316M17.4632 9.18182H1.98421M13.5263 6H5.02632M3.31818 4.63636V1.55455C3.31818 1.49932 3.36295 1.45455 3.41818 1.45455H5.37368C5.42891 1.45455 5.47368 1.49932 5.47368 1.55455V3.36842M3.31818 4.63636L5.47368 3.36842M9.94737 3.72727H9.05263"></path></svg>',
    'cat:SPOOKY': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 20 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M15.3317 17.2515C17.5565 15.6129 19 12.975 19 10C19 5.02944 16.5 1 10 1C3.5 1 1 5.02944 1 10C1 12.975 2.44351 15.6129 4.66833 17.2515C4.2654 17.5204 4 17.9792 4 18.5C4 19.3284 4.67157 20 5.5 20H6.7C6.86569 20 7 19.8657 7 19.7V18.3C7 18.1343 7.13431 18 7.3 18H8.7C8.86569 18 9 18.1343 9 18.3V19.7C9 19.8657 9.13431 20 9.3 20H10.7C10.8657 20 11 19.8657 11 19.7V18.3C11 18.1343 11.1343 18 11.3 18H12.7C12.8657 18 13 18.1343 13 18.3V19.7C13 19.8657 13.1343 20 13.3 20H14.5C15.3284 20 16 19.3284 16 18.5C16 17.9792 15.7346 17.5204 15.3317 17.2515Z"></path><path d="M8 8C8 9.10457 7.10457 10 6 10C4.89543 10 4 9.10457 4 8C4 6.89543 4.89543 6 6 6C7.10457 6 8 6.89543 8 8Z"></path><path d="M16 8C16 9.10457 15.1046 10 14 10C12.8954 10 12 9.10457 12 8C12 6.89543 12.8954 6 14 6C15.1046 6 16 6.89543 16 8Z"></path><path d="M9.06674 12.4247C9.3956 11.5703 10.6044 11.5703 10.9333 12.4247L11.2089 13.1408C11.461 13.7958 10.9775 14.5 10.2756 14.5H9.72437C9.02248 14.5 8.53899 13.7958 8.79111 13.1408L9.06674 12.4247Z"></path></svg>',
    'cat:SPIRITUALITY': '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 18 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><path d="M9.534 1.01686C5.82724 3.21661 4.60556 8.00479 6.80531 11.7116C9.00506 15.4183 13.7932 16.64 17.5 14.4402"></path><path d="M17.2232 15.0203C17.2232 10.7099 13.729 7.21571 9.41869 7.21571C5.10835 7.21571 1.61414 10.7099 1.61414 15.0203"></path><path d="M1.49996 14.6408C5.26677 16.7361 10.0189 15.381 12.1142 11.6142C14.2095 7.84744 12.8544 3.09528 9.08765 1"></path></svg>',
    'default': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 15px; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/></svg>'
};

function getNavIcon(id) {
    return iconPaths[id] || iconPaths['default'];
}

function buildNav(sections) {
    navSections = sections || [];
    var ul = document.querySelector(".nav-links");
    if (!ul) return;
    var items = [
        { id: "nav-login", label: "Login" },
        { id: "nav-search", label: "Search" },
        { id: "nav-trending", label: "Trending" }
    ];
    for (var i = 0; i < navSections.length; i++)
        items.push({ id: "cat:" + navSections[i].key, label: navSections[i].label });
    ul.innerHTML = "";
    for (var j = 0; j < items.length; j++) {
        var li = document.createElement("li");
        li.className = "focusable nav-item" + (items[j].id === "nav-trending" ? " active" : "");
        li.setAttribute("data-id", items[j].id);
        li.innerHTML = getNavIcon(items[j].id) + '<span>' + escapeHtml(items[j].label) + '</span>';
        ul.appendChild(li)
    }
    bindNav()
}

var currentPage = 1;
var currentCategory = 'nav-home';
var currentSearchQuery = '';
var isLoading = false;
var hasMore = true;
var isAppStartup = true;

function loadPage(e) {
    var t = document.getElementById("video-grid"),
        n = document.getElementById("loading"),
        o = document.getElementById("search-container"),
        a = document.getElementById("search-input");

    currentPage = 1;
    currentCategory = e;
    currentSearchQuery = '';
    hasMore = true;
    isLoading = true;

    if (t.innerHTML = "", n.style.display = "block", "nav-search" === e) {
        isLoading = false;
        return setDisplayFlex(o), n.style.display = "none", SpatialNavigation.refresh(), void (a && setTimeout((function () {
            a.focus()
        }), 100));
    }

    if ("nav-login" === e) {
        isLoading = false;
        o.style.display = "none";
        n.style.display = "none";
        t.innerHTML = '<div style="color:white;text-align:center;width:100%;font-size:32px;margin-top:100px;font-weight:600;">Log In to Odysee (Coming Soon)</div>';
        SpatialNavigation.refresh();
        return;
    }

    function r(e, i) {
        isLoading = false;
        if (n.style.display = "none", e) {
            var o = e.message || ("string" == typeof e ? e : JSON.stringify(e));
            return t.innerHTML = '<div class="error" style="padding: 20px; color: #ff5555; font-size: 24px;">Failed to load content. Error: ' + o + "</div>", console.error(e), void SpatialNavigation.refresh()
        }
        if (i && i.items) {
            if ((i.raw_count !== undefined ? i.raw_count : i.items.length) < 20) hasMore = false;
            for (var a = 0; a < i.items.length; a++) {
                var r = createVideoCard(i.items[a]);
                r && t.appendChild(r)
            }
        } else {
            hasMore = false;
        }
        SpatialNavigation.refresh();
        if (currentPage === 1) {
            setTimeout((function () {
                if (typeof isAppStartup !== "undefined" && isAppStartup) {
                    isAppStartup = false;
                    var activeMenu = document.querySelector(".nav-item.active");
                    if (activeMenu) SpatialNavigation.focusNode(activeMenu);
                } else {
                    var firstVideo = t.querySelector(".video-card");
                    if (firstVideo) SpatialNavigation.focusNode(firstVideo);
                }
            }), 100);
        }
    }
    o.style.display = "none";
    dispatchLoad(e, currentPage, r)
}

function doSearch(e) {
    var t = document.getElementById("video-grid"),
        n = document.getElementById("loading");

    if (isLoading && currentSearchQuery === e) return;

    currentPage = 1;
    currentCategory = 'nav-search';
    currentSearchQuery = e;
    hasMore = true;
    isLoading = true;

    t.innerHTML = "", n.style.display = "block", OdyseeAPI.search(e, (function (e, i) {
        isLoading = false;
        if (n.style.display = "none", e) {
            var o = e.message || ("string" == typeof e ? e : JSON.stringify(e));
            return t.innerHTML = '<div class="error" style="padding: 20px; color: #ff5555; font-size: 24px;">Search failed. Error: ' + o + "</div>", console.error(e), void SpatialNavigation.refresh()
        }
        if (i && i.items && i.items.length > 0) {
            if ((i.raw_count !== undefined ? i.raw_count : i.items.length) < 20) hasMore = false;
            for (var a = 0; a < i.items.length; a++) {
                var r = createVideoCard(i.items[a]);
                r && t.appendChild(r)
            }
        } else {
            hasMore = false;
            t.innerHTML = '<div style="color:white;text-align:center;width:100%;font-size:24px;margin-top:50px;">No results found.</div>';
        }
        SpatialNavigation.refresh(), setTimeout((function () {
            var e = t.querySelector(".video-card");
            e && e.focus()
        }), 100)
    }), currentPage)
}

function loadMoreContent() {
    if (isLoading || !hasMore || currentCategory === 'nav-search' && !currentSearchQuery) return;

    isLoading = true;
    currentPage++;
    var n = document.getElementById("loading");
    n.style.display = "block";

    var t = document.getElementById("video-grid");

    function appendCards(e, i) {
        isLoading = false;
        n.style.display = "none";
        if (e) { console.error("Load more failed", e); return; }
        if (i && i.items && i.items.length > 0) {
            if ((i.raw_count !== undefined ? i.raw_count : i.items.length) < 20) hasMore = false;
            for (var a = 0; a < i.items.length; a++) {
                var r = createVideoCard(i.items[a]);
                r && t.appendChild(r)
            }
            SpatialNavigation.refresh();
        } else {
            hasMore = false;
        }
    }

    dispatchLoad(currentCategory, currentPage, appendCards);
}

function createVideoCard(e) {
    if (!e.value) return null;
    var t = e.value.title || "Untitled",
        n = thumbUrl(e.value.thumbnail ? e.value.thumbnail.url : "");
    var i = e.signing_channel && e.signing_channel.value ? e.signing_channel.value.title || e.signing_channel.name : "Unknown";
    var rawAvatarUrl = e.signing_channel && e.signing_channel.value && e.signing_channel.value.thumbnail ? e.signing_channel.value.thumbnail.url : "";
    var avatarUrl = rawAvatarUrl ? thumbUrl(rawAvatarUrl, 64) : "icons/icon.png";
    var uploadDate = "";
    var ts = e.value && e.value.release_time ? e.value.release_time : (e.meta && e.meta.creation_timestamp ? e.meta.creation_timestamp : 0);
    if (ts > 0) {
        var seconds = Math.floor((Date.now() / 1000) - ts);
        var interval = seconds / 31536000;
        if (interval >= 1) uploadDate = Math.floor(interval) + (Math.floor(interval) === 1 ? " year ago" : " years ago");
        else {
            interval = seconds / 2592000;
            if (interval >= 1) uploadDate = Math.floor(interval) + (Math.floor(interval) === 1 ? " month ago" : " months ago");
            else {
                interval = seconds / 86400;
                if (interval >= 1) uploadDate = Math.floor(interval) + (Math.floor(interval) === 1 ? " day ago" : " days ago");
                else {
                    interval = seconds / 3600;
                    if (interval >= 1) uploadDate = Math.floor(interval) + (Math.floor(interval) === 1 ? " hour ago" : " hours ago");
                    else {
                        interval = seconds / 60;
                        if (interval >= 1) uploadDate = Math.floor(interval) + (Math.floor(interval) === 1 ? " minute ago" : " minutes ago");
                        else uploadDate = Math.max(0, Math.floor(seconds)) + " seconds ago";
                    }
                }
            }
        }
    }

    var duration = e.value && e.value.video ? e.value.video.duration : 0;
    var durationText = "";
    if (duration > 0) {
        var h = Math.floor(duration / 3600);
        var m = Math.floor((duration % 3600) / 60);
        var s = duration % 60;
        if (h > 0) {
            durationText = h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
        } else {
            durationText = m + ":" + (s < 10 ? "0" : "") + s;
        }
    }
    var durationHtml = durationText ? '<div class="duration-overlay">' + durationText + '</div>' : '';

    var o = document.createElement("div");
    o.tabIndex = 0;
    o.className = "video-card focusable";
    
    var avatarHtml = '<img class="channel-avatar" src="' + escapeHtml(avatarUrl) + '" onerror="this.src=\'icons/icon.png\'" />';
    o.innerHTML = '<div class="thumbnail-wrapper"><img class="thumbnail" src="' + escapeHtml(n) + '" />' + durationHtml + '</div><div class="info"><div class="title">' + escapeHtml(t) + '</div><div class="channel-meta">' + avatarHtml + '<div class="channel-text"><div class="channel">' + escapeHtml(i) + '</div><div class="card-date">' + escapeHtml(uploadDate) + '</div></div></div></div>';

    var ptrIsDown = false;
    var ptrTimer = null;
    var ptrLongPressed = false;

    o.addEventListener("mousedown", function(ev) {
        ptrIsDown = true;
        ptrLongPressed = false;
        ptrTimer = setTimeout(function() {
            ptrLongPressed = true;
            if (e.signing_channel) {
                window.lastFocusedCard = o;
                window.openChannelPage(e.signing_channel);
            }
        }, 1200);
    });
    
    o.addEventListener("touchstart", function(ev) {
        ptrIsDown = true;
        ptrLongPressed = false;
        ptrTimer = setTimeout(function() {
            ptrLongPressed = true;
            if (e.signing_channel) {
                window.lastFocusedCard = o;
                window.openChannelPage(e.signing_channel);
            }
        }, 1200);
    });

    function cancelPointer(ev) {
        if (ptrIsDown) {
            ptrIsDown = false;
            if (ptrTimer) {
                clearTimeout(ptrTimer);
                ptrTimer = null;
            }
            if (!ptrLongPressed) {
                window.lastFocusedCard = o;
                playVideo(e);
            }
        }
    }

    o.addEventListener("mouseup", cancelPointer);
    o.addEventListener("touchend", cancelPointer);
    
    o.addEventListener("mouseleave", function() {
        ptrIsDown = false;
        if (ptrTimer) {
            clearTimeout(ptrTimer);
            ptrTimer = null;
        }
    });
    
    o.addEventListener("touchcancel", function() {
        ptrIsDown = false;
        if (ptrTimer) {
            clearTimeout(ptrTimer);
            ptrTimer = null;
        }
    });

    o.addEventListener("longpress", function() {
        if (e.signing_channel) {
            window.lastFocusedCard = o;
            window.openChannelPage(e.signing_channel);
        }
    });

    o.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        
        // If ptrIsDown is true, block the premature click
        if (ptrIsDown || ptrLongPressed || window._spatialOkLongPressed) return;
        
        // Block native pointer clicks (they are handled by mouseup).
        // Synthetic clicks (from spatial.js) don't have isTrusted or have it as false.
        // Some older browsers might have isTrusted as undefined.
        // We can just rely on the fact that native pointer clicks ALWAYS have a corresponding mousedown!
        // But since we just checked ptrIsDown, it's false. So this click came after mouseup.
        // Or it's a synthetic click from keyboard.
        // We will just let ALL clicks play the video EXCEPT if they are from pointer!
        // How to know if it's from pointer?
        // Pointer clicks have screenX > 0 and screenY > 0! Synthetic clicks usually have 0!
        if (ev.screenX > 0 || ev.screenY > 0) return; // Ignore native pointer click, mouseup handled it
        
        if (!window.isChannelPageOpen) {
            window.lastFocusedCard = o;
        } else {
            window.lastFocusedChannelCard = o;
        }
        playVideo(e);
    });
    
    return o;
}

function playVideo(e) {
    e.name, e.claim_id;
    var t = e.value && e.value.video ? e.value.video.duration : 0,
        n = document.getElementById("player-container"),
        i = document.getElementById("video-player"),
        o = document.getElementById("player-loading"),
        a = document.getElementById("player-title"),
        playerError = document.getElementById("player-error");

    function handleMediaError(code, url) {
        clearStall();
        // We inherit the magic state from the URL: if the previous source used magic,
// the fallback must use it too, otherwise hotlink protection gives 401.
        var magicOn = -1 !== url.indexOf("magic=");
        var msg = {
            1: "Aborted (MEDIA_ERR_ABORTED).",
            2: "Network error (MEDIA_ERR_NETWORK).",
            3: "Decode error (MEDIA_ERR_DECODE) - unsupported codec.",
            4: "Unsupported source (MEDIA_ERR_SRC_NOT_SUPPORTED)."
        }[code] || ("Unknown media error (" + code + ").");
        console.error("Video error " + code + ": " + msg);
        o.style.display = "none";

        // Error code 3/4 is typically a format problem. We have two sources, and if
// one doesn't work, we can try the other:
//   HLS  -> declares EXT-X-VERSION:6, but webOS 2.0 only supports HLS v3
//   mp4  -> the raw upload; the TV supports H.264 HP@L4.2 and H.265
//           Main/Main10@L4.1, but not AV1, and VP9 only on UHD
// Therefore, on failure, we switch to the other source before giving up.
        if (3 === code || 4 === code) {
            if (!triedMp4 && -1 === url.indexOf("/v6/streams/")) {
                var mp4 = OdyseeAPI.buildMp4Url(currentClaim);
                if (mp4) {
                    triedMp4 = true;
                    playReason = "raw mp4 fallback (previous source error code: " + code + ")";
                    console.log("FALLBACK REASON: " + (hadHls ? "HLS" : "v4") +
                        " source failed with error " + code + " -> raw mp4: " + mp4);
                    probeUrl(buildPlayableUrl(mp4, magicOn), "mp4-proba");
                    playerError.textContent = (hadHls ? "HLS is not playable" : "This source is not playable") +
                        ", trying raw mp4...";
                    playerError.style.display = "block";
                    o.style.display = "block";
                    return void r(buildPlayableUrl(mp4, magicOn))
                }
            }

            // Reaching this point, both sources failed.
            probeUrl(url, "vegso-proba");
            if (hadHls) {
                // There is a ready transcode, but it's unplayable (almost certainly because of
// the playlist's EXT-X-VERSION:6) -- requesting a new transcode won't help.
                playerError.textContent = "Cannot start the video this time, please try again later.";
                playerError.style.display = "block";
            } else {
                // No transcode: request one. The HEAD request queues the stream into the
// transcoder (fitForTranscoder -> pool.Admit). The `common` queue
// has a MinHits threshold, so one request might not be enough.
                playerError.textContent = "Cannot start the video this time, please try again later. Transcoding requested.";
                playerError.style.display = "block";
                var q = new XMLHttpRequest();
                q.open("HEAD", buildPlayableUrl(url, true), true);
                q.onreadystatechange = function () {
                    if (4 === q.readyState) console.log("Transcode queued: " + q.status)
                };
                q.send()
            }
        } else {
            playerError.textContent = "Cannot start the video this time, please try again later.";
            playerError.style.display = "block";
        }
    }

    // The <video> doesn't signal if it simply doesn't start -- in this case the player
// would wait infinitely. After 20 seconds, we route it to the same fallback chain
// as a real error.
    function armStall(url) {
        clearStall();
        stallTimer = setTimeout(function () {
            stallTimer = null;
            if (i.readyState >= 3) return;   // HAVE_FUTURE_DATA -> it started after all
            var rs = i.readyState;
            console.error("Did not start within 20s (readyState=" + rs + ")");
            // readyState 0 = HAVE_NOTHING: the player hasn't even reached metadata.
// This is NOT a codec rejection -- it would read moov first and only
// fail afterwards. The typical reason: moov is at the end of the file (not faststart),
// and the pipeline doesn't send a range request to the end.
            stalledAtZero = (0 === rs);
            handleMediaError(4, url)
        }, 20000)
    }

    function r(e, extra) {
        console.log("PLAYBACK STARTING [" + (playReason || "primary") + "]");
        armStall(e);
        // Non-blocking: runs in parallel with playback, so the error reason is
// visible in the log DURING the 20-second wait.
        if (-1 === e.indexOf(".m3u8")) checkFaststart(e, "konténer");
        i.onerror = null;
        // If we have HLS too, we put it first: the player chooses the first
// understood source, and if it cannot do HLS, it automatically skips to mp4.
        setSources(i, (extra ? [extra] : []).concat([{
            url: e,
            type: -1 !== e.indexOf(".m3u8") ? MIME_HLS : MIME_MP4
        }]));
        i.volume = 1, i.muted = !1, i.onerror = function () {
            handleMediaError(i.error ? i.error.code : 0, e)
        }, i.load();
        var t = i.play();
        t && "function" == typeof t.catch && t.catch((function (e) {
            console.error("Play error:", e)
        }))
    }

    var uploadDate = "";
    if (e.meta && e.meta.creation_timestamp) {
        uploadDate = new Date(e.meta.creation_timestamp * 1000).toLocaleDateString();
    } else if (e.value && e.value.release_time) {
        uploadDate = new Date(e.value.release_time * 1000).toLocaleDateString();
    }

    var clockSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle; margin-right: 4px;"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>';
    document.getElementById("meta-date").innerHTML = uploadDate ? clockSvg + uploadDate : "";
    document.getElementById("meta-views").innerHTML = "";
    document.getElementById("meta-reactions").innerHTML = "";
    document.getElementById("time-display").textContent = "00:00 / 00:00";
    document.getElementById("progress-fill").style.width = "0%";

    var eyeSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle; margin-right: 4px;"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';
    if (e._cached_views !== undefined) {
        document.getElementById("meta-views").innerHTML = eyeSvg + e._cached_views;
    } else if (e.claim_id) {
        OdyseeAPI.getViewCount(e.claim_id, function (err, views) {
            if (!err) {
                e._cached_views = views;
                document.getElementById("meta-views").innerHTML = eyeSvg + views;
            }
        });
    }
    var likeSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle; margin-right: 4px;"><path d="M2 20h2c.55 0 1-.45 1-1v-9c0-.55-.45-1-1-1H2v11zm19.83-7.12c.11-.25.17-.52.17-.8V11c0-1.1-.9-2-2-2h-5.98l1.24-5.22.04-.32c0-.41-.17-.79-.44-1.06L14.28 1 8.14 7.55C7.81 7.89 7.6 8.35 7.6 8.85V19c0 1.1.9 2 2 2h7.97c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-.12z"/></svg>';
    var dislikeSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle; margin-left: 12px; margin-right: 4px;"><path d="M22 4h-2c-.55 0-1 .45-1 1v9c0 .55.45 1 1 1h2V4zM2.17 11.12c-.11.25-.17.52-.17.8V13c0 1.1.9 2 2 2h5.98l-1.24 5.22-.04.32c0 .41.17.79.44 1.06L9.72 23l6.14-6.55c.33-.34.54-.8.54-1.3V5c0-1.1-.9-2-2-2H6.43c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v.12z"/></svg>';
    if (e._cached_reactions) {
        document.getElementById("meta-reactions").innerHTML = likeSvg + (e._cached_reactions.like || 0) + dislikeSvg + (e._cached_reactions.dislike || 0);
    } else if (e.claim_id) {
        OdyseeAPI.getReactions(e.claim_id, function (err, reactions) {
            if (!err && reactions) {
                e._cached_reactions = reactions;
                document.getElementById("meta-reactions").innerHTML = likeSvg + (reactions.like || 0) + dislikeSvg + (reactions.dislike || 0);
            }
        });
    }

    var currentClaim = e,
        hadHls = false,      // was there a ready HLS transcode (308 received)
        triedMp4 = false,    // have we already tried the raw mp4
        stalledAtZero = false, // the player hasn't even reached metadata
        playReason = "";     // why are we playing exactly this URL
    playerError.style.display = "none";
    i.setAttribute("data-duration", t), i.innerHTML = "", i.src = "", a.textContent = e.value.title || "Unknown Title", n.classList.remove("hidden"), o.style.display = "block";

    function startVideoWithWarmup(rawUrl) {
        var retries = 0,
            maxRetries = 6,
            useMagic = false;   // first WITHOUT query -> cacheable

        function fail(msg) {
            console.error(msg);
            o.style.display = "none";
            playerError.textContent = "Cannot start the video this time, please try again later.";
            playerError.style.display = "block";
            a.textContent = e.value.title || "Unknown Title";
        }

        function warm() {
            var url = buildPlayableUrl(rawUrl, useMagic),
                xhr = new XMLHttpRequest();
            xhr.open("HEAD", url, true);
            xhr.timeout = 15000;
            xhr.onreadystatechange = function () {
                if (4 !== xhr.readyState) return;
                var s = xhr.status,
                    cache = "";
                try {
                    cache = xhr.getResponseHeader("X-77-Cache") || ""
                } catch (err) { }
                console.log("Warmup " + s + (cache ? " cache=" + cache : "") +
                    (useMagic ? " [magic]" : " [query nelkul]") + " r=" + retries);

                if (429 === s) return void fail("429: rate limit. Request bypassing CDN cache hit origin. Wait a few minutes.");

                // Magic ALWAYS causes a cache MISS (the CDN does not cache requests with query
                // strings on this endpoint), so we only use it as a last resort:
                // if we hit hotlink protection without a query.
                if (401 === s && !useMagic) {
                    console.log("401 without query -> trying with magic (warning: cache MISS)");
                    useMagic = true;
                    return void warm()
                }
                if (401 === s) return void fail("401: hotlink protection blocked access even with magic.");
                if (404 === s) return void fail("404: stream not found.");

                if (308 === s && PREFER_HLS) {
                    // The tc/ endpoint has NO hotlink check (measured: master,
// variant and .ts all 200 without magic), so we request without query.
// With a query, the .m3u8 extension would end with a "?",
// which this media pipeline doesn't recognize -- this is exactly what broke
// the v4 format as well.
                    var hls = OdyseeAPI.buildHlsUrl(currentClaim);
                    if (hls) {
                        hadHls = true;
                        playReason = "HLS + mp4 fallback, explicit type";
                        i.dataset.rawUrl = rawUrl;
                        i.dataset.useMagic = useMagic ? "true" : "false";
                        return void r(buildPlayableUrl(rawUrl, useMagic), {
                            url: hls,
                            type: MIME_HLS
                        })
                    }
                }
                if ((503 === s || 0 === s || s >= 500) && retries < maxRetries) {
                    retries++;
                    return void setTimeout(warm, 3000);
                }
                playReason = useMagic ? "original mp4, with magic" : "original mp4, without query (cacheable)";
                i.dataset.rawUrl = rawUrl;
                i.dataset.useMagic = useMagic ? "true" : "false";
                r(buildPlayableUrl(rawUrl, useMagic))
            };
            xhr.ontimeout = xhr.onerror = function () {
                if (retries < maxRetries) {
                    retries++;
                    setTimeout(warm, 3000)
                } else {
                    i.dataset.rawUrl = rawUrl;
                    i.dataset.useMagic = useMagic ? "true" : "false";
                    r(buildPlayableUrl(rawUrl, useMagic))
                }
            };
            xhr.send()
        }
        warm()
    }

    OdyseeAPI.getStreamingSourceUrl(e, (function (t, n) {
        if (!t && n) {
            startVideoWithWarmup(n);
        } else {
            console.error("Failed to get stream URL via get method.", t);
            var src = e.reposted_claim || e;
            var sd = src.value && src.value.source ? src.value.source.sd_hash : "";
            var cid = src.claim_id;
            if (sd && cid && src.name) {
                var l = "http://player.odycdn.com/api/v4/streams/free/" +
                    encodeURIComponent(src.name) + "/" + cid + "/" + sd.substring(0, 6);
                console.log("Using assembled v4 fallback: " + l);
                startVideoWithWarmup(l);
            } else o.style.display = "none";
        }
    }));
    history.pushState({
        playerOpen: !0
    }, "player"), setTimeout((function () {
        SpatialNavigation.refresh();
        for (var e = document.querySelectorAll(".focusable"), t = 0; t < e.length; t++)
            if ("btn-play-pause" === e[t].id) {
                SpatialNavigation.focusElement(t);
                break
            }
    }), 100)
} ! function () {
    var e = console.log,
        t = console.error;

    function n(e, t) {
        var n = Array.prototype.slice.call(t).map((function (e) {
            return "object" == typeof e ? JSON.stringify(e) : e
        })).join(" ");
        // The same text goes to the dev server too, if devlog.js is connected.
// The try/catch ensures that logging never crashes the app.
        try {
            if ("undefined" != typeof RemoteLog) RemoteLog.push(e, n)
        } catch (err) { }
    }
    console.log = function () {
        n("log", arguments), e.apply(console, arguments)
    }, console.error = function () {
        n("error", arguments), t.apply(console, arguments)
    }, window.onerror = function (e, t, n, i, o) {
        console.error("Global Error: " + e + " at " + t + ":" + n)
    }
}(), document.addEventListener("DOMContentLoaded", (function () {
    // Clock sync first, load only afterwards: otherwise the `magic` parameter
// would be invalid with a drifted TV clock and we'd get 401.
    OdyseeAPI.syncServerTime(function () {
        OdyseeAPI.getSections(function (err, sections) {
            if (err) console.error("Failed to load categories: " + err.message);
            buildNav(sections || []);
            SpatialNavigation.refresh();
            loadPage("nav-trending")
        })
    });
    SpatialNavigation.init();
    bindNav();
    var n = document.getElementById("btn-search"),
        i = document.getElementById("search-input");
    
    function triggerSearch() {
        if (!i) return;
        var e = i.value.trim();
        if (e.length > 0) {
            i.blur(); // Hide virtual keyboard
            var btn = document.getElementById("btn-search");
            if (btn) SpatialNavigation.focusNode(btn); // Prevent auto-refocus on input
            doSearch(e);
        }
    }

    if (n && i) {
        n.addEventListener("click", triggerSearch);
        
        i.addEventListener("keydown", function(e) {
            if (e.keyCode === 13) {
                e.preventDefault();
                triggerSearch();
            }
        });

        // When the magic remote clicks the input, or virtual keyboard opens,
        // force Spatial Navigation to keep focus on the input instead of falling back to sidebar.
        i.addEventListener("focus", function() {
            SpatialNavigation.focusNode(i);
        });
    }

    var mainContent = document.getElementById("main-content");
    if (mainContent) {
        var releaseTimer = null;
        mainContent.addEventListener("scroll", function () {
            if (mainContent.scrollTop + mainContent.clientHeight >= mainContent.scrollHeight - 500) {
                if (window.isChannelPageOpen) {
                    if (typeof window.loadMoreChannelContent === "function") window.loadMoreChannelContent();
                } else {
                    loadMoreContent();
                }
            }
            // Throttle: don't run on every event while scrolling.
            if (releaseTimer) clearTimeout(releaseTimer);
            releaseTimer = setTimeout(function () {
                releaseOffscreenThumbs(mainContent)
            }, 300);
        });
    }
})), document.addEventListener("DOMContentLoaded", (function () {
    var e, t = document.getElementById("player-container"),
        n = document.getElementById("video-player"),
        i = document.getElementById("btn-play-pause"),
        o = document.getElementById("player-title"),
        a = document.getElementById("progress-fill"),
        r = document.getElementById("time-display"),
        l = document.getElementById("custom-controls");

    function d() {
        t.classList.contains("hidden") || (l.classList.remove("fade-out"), o.classList.remove("fade-out"), clearTimeout(e), e = setTimeout(s, 4e3))
    }

    function s() {
        n.paused || (l.classList.add("fade-out"), o.classList.add("fade-out"))
    }
    window.addEventListener("popstate", (function (e) {
        if (!document.getElementById("player-container").classList.contains("hidden")) {
            closePlayer();
        } else if (window.isChannelPageOpen) {
            closeChannelPage();
        }
    })), window.addEventListener("keydown", (function (e) {
        if (!document.getElementById("player-container").classList.contains("hidden")) {
            e.stopPropagation();
            var wasHidden = l.classList.contains("fade-out");
            d();
            var t = e.keyCode;

            if (t === 13 && wasHidden) {
                e.stopPropagation();
                e.preventDefault();
                return;
            }

            if (415 === t || 19 === t || 179 === t || 13 === t) (13 === t && "BUTTON" !== document.activeElement.tagName || 13 !== t) && i.click();
            else if (412 === t || 37 === t || 417 === t || 39 === t) {
                try {
                    var currentTarget = (window._pendingSeekTime !== undefined) ? window._pendingSeekTime : n.currentTime;
                    var direction = (412 === t || 37 === t) ? -10 : 10;
                    var maxDuration = isNaN(n.duration) ? currentTarget + 10 + 100 : n.duration;
                    var newTime = currentTarget + direction;
                    newTime = Math.max(0, Math.min(maxDuration, newTime));
                    
                    // Pause video on first seek press so it doesn't keep playing
                    if (window._pendingSeekTime === undefined) {
                        window._userAction = true;
                        window._wasPlayingBeforeSeek = !n.paused;
                        if (!n.paused) n.pause();
                    }
                    
                    window._pendingSeekTime = newTime;
                    
                    // Update progress bar immediately for visual feedback
                    var dur = n.duration;
                    var dFallback = parseFloat(n.getAttribute("data-duration")) || 0;
                    if (!dur || isNaN(dur) || dur === Infinity) dur = dFallback;
                    if (dur > 0) {
                        a.style.width = (newTime / dur * 100) + "%";
                        r.textContent = u(newTime, dur) + " / " + u(dur, dur);
                    }
                    
                    if (window._seekDebounceTimer) clearTimeout(window._seekDebounceTimer);
                    window._seekDebounceTimer = setTimeout(function() {
                        try {
                            c.style.display = "block"; // Show loading spinner
                            var seekTarget = window._pendingSeekTime;
                            window._pendingSeekTime = undefined;
                            
                            if (window._wasPlayingBeforeSeek) {
                                var onSeeked = function() {
                                    n.removeEventListener("seeked", onSeeked);
                                    window._userAction = true;
                                    n.play();
                                    window._wasPlayingBeforeSeek = false;
                                };
                                n.addEventListener("seeked", onSeeked);
                            }
                            n.currentTime = seekTarget;
                        } catch (err) {
                            console.error("Delayed seek failed: " + err);
                        }
                    }, 400);
                } catch(err) {
                    console.error("Seek calculation failed: " + err);
                }
            } else if (413 === t) {
                e.preventDefault();
                history.back();
            } else 461 !== t && 8 !== t && 27 !== t && 10009 !== t || e.preventDefault()
        } else if (window.isChannelPageOpen) {
            var t = e.keyCode;
            if (413 === t || 461 === t || 8 === t || 27 === t || 10009 === t) {
                e.preventDefault();
                history.back();
            }
        }
    }), true), i.addEventListener("click", (function () {
        window._userAction = true;
        n.paused ? (n.play(), i.innerHTML = "\u275A\u275A") : (n.pause(), i.innerHTML = "\u25B6", d())
    })), n.addEventListener("play", (function () {
        i.innerHTML = "\u275A\u275A", d();
        if (window._userAction) {
            stopWatchdog();
            window._userAction = false;
        }
    })), n.addEventListener("pause", (function () {
        i.innerHTML = "\u25B6", d();
        if (window._userAction) {
            stopWatchdog();
            window._userAction = false;
        }
    }));
    var c = document.getElementById("player-loading"),
        lastTime = 0,
        stuckCount = 0,
        isBufferingAllowed = true;

    // --- Watchdog: only runs after 30s of stable playback ---
    function stopWatchdog() {
        if (window._watchdogDelayTimer) { clearTimeout(window._watchdogDelayTimer); window._watchdogDelayTimer = null; }
        if (window._watchdogInterval) { clearInterval(window._watchdogInterval); window._watchdogInterval = null; }
        stuckCount = 0;
    }
    window.stopWatchdog = stopWatchdog;

    function startWatchdogDelayed() {
        // If watchdog is already armed and monitoring, don't restart it
        if (window._watchdogInterval) return;
        stopWatchdog();
        window._watchdogDelayTimer = setTimeout(function() {
            console.log("Watchdog: armed after 30s of stable playback");
            lastTime = n.currentTime;
            stuckCount = 0;
            window._watchdogInterval = setInterval(function() {
                try {
                    if (n.paused || n.ended || n.seeking) return;
                    var current = n.currentTime;
                    if (Math.abs(current - lastTime) < 0.1) {
                        stuckCount++;
                        if (stuckCount >= 1) { // 500ms stalled -> instant reconnect
                            console.log("Watchdog: mid-stream stall, reconnecting!");
                            stopWatchdog();
                            var raw = n.dataset.rawUrl;
                            var useM = n.dataset.useMagic === "true";
                            if (raw) {
                                var newUrl = buildPlayableUrl(raw, useM);
                                var savedTime = n.currentTime;
                                n.pause();
                                n.removeAttribute("src");
                                n.load();
                                setTimeout(function() {
                                    setSources(n, [{ url: newUrl, type: "video/mp4" }]);
                                    n.load();
                                    var onMeta = function() {
                                        n.removeEventListener("loadedmetadata", onMeta);
                                        try { n.currentTime = savedTime; } catch(e) {}
                                        var p = n.play();
                                        if (p && typeof p.catch === "function") {
                                            p.catch(function(err) { console.error("Watchdog play error:", err); });
                                        }
                                    };
                                    n.addEventListener("loadedmetadata", onMeta);
                                }, 150);
                            } else {
                                n.pause();
                                n.play();
                            }
                        }
                    } else {
                        stuckCount = 0;
                        lastTime = current;
                    }
                } catch(e) {}
            }, 500);
        }, 30000);
    }

    function u(e, total) {
        if (isNaN(e)) return "00:00";
        var t = Math.floor(e / 3600),
            n = Math.floor(e % 3600 / 60),
            i = Math.floor(e % 60),
            th = total ? Math.floor(total / 3600) : t;
        if (th > 0) {
            return (t < 10 ? "0" + t : t) + ":" + (n < 10 ? "0" + n : n) + ":" + (i < 10 ? "0" + i : i)
        } else {
            return (n < 10 ? "0" + n : n) + ":" + (i < 10 ? "0" + i : i)
        }
    }
    n.addEventListener("waiting", (function () {
        c.style.display = "block"
    })), n.addEventListener("seeking", (function () {
        c.style.display = "block";
        stopWatchdog();
    })), n.addEventListener("seeked", (function () {
        c.style.display = "none"
    })), n.addEventListener("playing", (function () {
        c.style.display = "none";
        startWatchdogDelayed(); // stop any existing, wait 30s, then arm
    })), n.addEventListener("canplay", (function () {
        c.style.display = "none";
        var errEl = document.getElementById("player-error");
        if (errEl) errEl.style.display = "none";
        clearStall();
        console.log("PLAYABLE. Player selected: " +
            (n.currentSrc || "(unknown)"))
    })), n.addEventListener("error", (function () {
        c.style.display = "none"
    })), n.addEventListener("ended", (function () {
        stopWatchdog();
        var e = n.currentTime || 0,
            t = n.duration,
            i = parseFloat(n.getAttribute("data-duration")) || 0;
        t && !isNaN(t) && t !== 1 / 0 || (t = i);

        if (t > 0 && (t - e) > 5) {
            console.log("Premature end detected (" + e + " / " + t + "). Auto-reconnecting...");
            var raw = n.dataset.rawUrl;
            var useM = n.dataset.useMagic === "true";
            if (raw) {
                var newUrl = buildPlayableUrl(raw, useM);
                var savedTime = n.currentTime;
                isBufferingAllowed = true;
                n.pause();
                setSources(n, [{ url: newUrl, type: "video/mp4" }]);
                n.load();
                var onReady = function() {
                    try { n.currentTime = savedTime; } catch(err) {}
                    n.play();
                    n.removeEventListener("canplay", onReady);
                };
                n.addEventListener("canplay", onReady);
            }
            return;
        }

        closePlayer()
    })), n.addEventListener("timeupdate", (function () {
        try {
            if (window._pendingSeekTime !== undefined) return; // Don't overwrite during seek
            var e = n.currentTime || 0,
                t = n.duration,
                i = parseFloat(n.getAttribute("data-duration")) || 0;
            t && !isNaN(t) && t !== 1 / 0 || (t = i);
            var o = 0;
            t && !isNaN(t) && t > 0 && (o = e / t * 100), a.style.width = o + "%", r.textContent = u(e, t) + " / " + u(t, t)
        } catch(err) {}
    }))

    window.isChannelPageOpen = false;

    window.closeChannelPage = function() {
        if (!window.isChannelPageOpen) return;
        window.isChannelPageOpen = false;
        document.getElementById("channel-page").style.display = "none";
        document.getElementById("video-grid").style.display = "";
        var topHeader = document.querySelector(".top-header");
        if (topHeader) topHeader.style.display = "block";
        
        SpatialNavigation.refresh();
        if (window.lastFocusedCard) {
            SpatialNavigation.focusNode(window.lastFocusedCard);
        } else {
            SpatialNavigation.focusNode(document.querySelector(".video-card"));
        }
    };

    window.openChannelPage = function(channelClaim) {
        if (!channelClaim) return;
        window.isChannelPageOpen = true;
        window.channelPageClaimId = channelClaim.claim_id;
        window.channelPageCurrentPage = 1;
        window.channelPageHasMore = true;
        window.channelPageIsLoading = true;
        history.pushState({ channelPage: true }, "", "");

        document.getElementById("video-grid").style.display = "none";
        var topHeader = document.querySelector(".top-header");
        if (topHeader) topHeader.style.display = "none";
        
        var cp = document.getElementById("channel-page");
        if (!cp) return;
        cp.style.display = "";

        var avatarUrl = channelClaim.value && channelClaim.value.thumbnail ? channelClaim.value.thumbnail.url : "";
        document.getElementById("cp-avatar").src = avatarUrl ? thumbUrl(avatarUrl, 120) : "icons/icon.png";
        document.getElementById("cp-name").textContent = channelClaim.value && channelClaim.value.title ? channelClaim.value.title : channelClaim.name;
        
        var uploadsCount = channelClaim.meta && channelClaim.meta.claims_in_channel ? channelClaim.meta.claims_in_channel : 0;
        var statsEl = document.getElementById("cp-stats");
        statsEl.textContent = uploadsCount + " uploads";

        if (window.OdyseeAPI && window.OdyseeAPI.getSubscriberCount) {
            OdyseeAPI.getSubscriberCount(channelClaim.claim_id, function(err, subCount) {
                if (!err && subCount !== undefined) {
                    statsEl.textContent = subCount + " followers • " + uploadsCount + " uploads";
                }
            });
        }

        var grid = document.getElementById("cp-video-grid");
        grid.innerHTML = "";
        document.getElementById("cp-loading").style.display = "block";
        SpatialNavigation.focusNode(document.getElementById("channel-page"));

        OdyseeAPI.searchChannelVideos(channelClaim.claim_id, function(err, res) {
            window.channelPageIsLoading = false;
            document.getElementById("cp-loading").style.display = "none";
            if (err) {
                grid.innerHTML = '<div style="color:white; font-size:24px; text-align:center; padding: 20px;">Error loading channel videos.</div>';
                return;
            }
            if (res && res.items && res.items.length > 0) {
                for (var i = 0; i < res.items.length; i++) {
                    var card = createVideoCard(res.items[i]);
                    if (i === 0 && card) {
                        card.id = "cp-first-video";
                        var header = document.getElementById("cp-header");
                        if (header) header.setAttribute("data-sn-down", "#cp-first-video");
                    }
                    if (card) grid.appendChild(card);
                }
                SpatialNavigation.refresh();
                setTimeout(function() {
                    var header = document.getElementById("cp-header");
                    if (header) SpatialNavigation.focusNode(header);
                }, 100);
            } else {
                window.channelPageHasMore = false;
                grid.innerHTML = '<div style="color:white; font-size:24px; text-align:center; padding: 20px;">No videos found.</div>';
            }
        }, 1);
    };

    window.loadMoreChannelContent = function() {
        if (window.channelPageIsLoading || !window.channelPageHasMore || !window.channelPageClaimId) return;

        window.channelPageIsLoading = true;
        window.channelPageCurrentPage++;
        var n = document.getElementById("cp-loading");
        if (n) n.style.display = "block";

        var t = document.getElementById("cp-video-grid");

        OdyseeAPI.searchChannelVideos(window.channelPageClaimId, function(err, res) {
            window.channelPageIsLoading = false;
            if (n) n.style.display = "none";
            
            if (err) {
                console.error("Load more channel videos failed", err);
                return;
            }
            
            if (res && res.items && res.items.length > 0) {
                if (res.items.length < 20) window.channelPageHasMore = false;
                for (var i = 0; i < res.items.length; i++) {
                    var card = createVideoCard(res.items[i]);
                    if (card) t.appendChild(card);
                }
                SpatialNavigation.refresh();
            } else {
                window.channelPageHasMore = false;
            }
        }, window.channelPageCurrentPage);
    };
}));