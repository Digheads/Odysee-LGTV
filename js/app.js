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
function thumbUrl(u) {
    if (!u) return "";
    return "https://wsrv.nl/?url=" + encodeURIComponent(u) + "&output=jpg&w=400";
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
    if (window.lastFocusedCard) {
        for (var n = document.querySelectorAll(".focusable"), i = 0, o = 0; o < n.length; o++)
            if (null !== n[o].offsetParent) {
                if (n[o] === window.lastFocusedCard) {
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

function buildNav(sections) {
    navSections = sections || [];
    var ul = document.querySelector(".nav-links");
    if (!ul) return;
    var items = [
        { id: "nav-search", label: "Search" },
        { id: "nav-login", label: "Login" },
        { id: "nav-trending", label: "Trending" }
    ];
    for (var i = 0; i < navSections.length; i++)
        items.push({ id: "cat:" + navSections[i].key, label: navSections[i].label });
    ul.innerHTML = "";
    for (var j = 0; j < items.length; j++) {
        var li = document.createElement("li");
        li.className = "focusable nav-item" + (items[j].id === "nav-trending" ? " active" : "");
        li.setAttribute("data-id", items[j].id);
        li.appendChild(document.createTextNode(items[j].label));
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
        i = document.getElementById("page-title"),
        o = document.getElementById("search-container"),
        a = document.getElementById("search-input");

    currentPage = 1;
    currentCategory = e;
    currentSearchQuery = '';
    hasMore = true;
    isLoading = true;

    if (t.innerHTML = "", n.style.display = "block", "nav-search" === e) {
        isLoading = false;
        return i.innerText = "Search", setDisplayFlex(o), n.style.display = "none", SpatialNavigation.refresh(), void (a && setTimeout((function () {
            a.focus()
        }), 100));
    }

    if ("nav-login" === e) {
        isLoading = false;
        i.innerText = "Login";
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
    i.innerText = sectionLabel(e);
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
    var i = e.signing_channel && e.signing_channel.value ? e.signing_channel.value.title : "Unknown";
    var uploadDate = "";
    if (e.meta && e.meta.creation_timestamp) {
        uploadDate = new Date(e.meta.creation_timestamp * 1000).toLocaleDateString();
    } else if (e.value && e.value.release_time) {
        uploadDate = new Date(e.value.release_time * 1000).toLocaleDateString();
    }

    var o = document.createElement("div");
    o.className = "video-card focusable";
    o.innerHTML = '<div class="thumbnail-wrapper"><img class="thumbnail" src="' + escapeHtml(n) + '" /></div><div class="info"><div class="title">' + escapeHtml(t) + '</div><div class="channel">' + escapeHtml(i) + '</div><div class="card-date">' + escapeHtml(uploadDate) + '</div></div>';

    return o.addEventListener("click", (function () {
        window.lastFocusedCard = o;
        playVideo(e)
    })), o
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
                loadMoreContent();
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
        document.getElementById("player-container").classList.contains("hidden") || closePlayer()
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
            else if (412 === t || 37 === t) n.currentTime = Math.max(0, n.currentTime - 10);
            else if (417 === t || 39 === t) {
                var o = isNaN(n.duration) ? n.currentTime + 10 + 100 : n.duration;
                n.currentTime = Math.min(o, n.currentTime + 10)
            } else if (413 === t) {
                e.preventDefault();
                history.back();
            } else 461 !== t && 8 !== t && 27 !== t && 10009 !== t || e.preventDefault()
        }
    }), true), i.addEventListener("click", (function () {
        n.paused ? (n.play(), i.innerHTML = "&#9632;") : (n.pause(), i.innerHTML = "&#9654;", d())
    })), n.addEventListener("play", (function () {
        i.innerHTML = "&#9632;", d()
    })), n.addEventListener("pause", (function () {
        i.innerHTML = "&#9654;", d();
        if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
    }));
    var c = document.getElementById("player-loading"),
        watchdogTimer = null,
        lastTime = 0,
        stuckCount = 0,
        isBufferingAllowed = true;

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
        // WebOS fires "seeking" when the network stalls. We only want to allow 
        // long buffering (isBufferingAllowed=true) if it's a REAL user seek.
        if (Math.abs(n.currentTime - lastTime) > 1) {
            isBufferingAllowed = true;
        }
    })), n.addEventListener("seeked", (function () {
        c.style.display = "none"
    })), n.addEventListener("playing", (function () {
        c.style.display = "none";
        if (watchdogTimer) clearInterval(watchdogTimer);
        lastTime = n.currentTime;
        stuckCount = 0;
        isBufferingAllowed = false; // The video is now playing, so future stalls are unexpected
        watchdogTimer = setInterval(function() {
            try {
                if (!n.paused && !n.ended) {
                    if (n.seeking) {
                        stuckCount = 0;
                        lastTime = n.currentTime;
                        return;
                    }
                    var current = n.currentTime;
                    if (Math.abs(current - lastTime) < 0.1) {
                        stuckCount++;
                        var limit = isBufferingAllowed ? 60 : 2; // 30s for real seek, 1s for normal playback stall
                        if (stuckCount >= limit) {
                            console.log("Watchdog: video stalled for " + (limit/2) + " seconds, auto-reconnecting!");
                            var raw = n.dataset.rawUrl;
                            var useM = n.dataset.useMagic === "true";
                            if (raw) {
                                var newUrl = buildPlayableUrl(raw, useM);
                                console.log("Watchdog: fresh URL -> " + newUrl);
                                var savedTime = n.currentTime;
                                isBufferingAllowed = true;
                                n.pause();
                                setSources(n, [{ url: newUrl, type: "video/mp4" }]);
                                n.load();
                                var onReady = function() {
                                    try { n.currentTime = savedTime; } catch(e) {}
                                    n.play();
                                    n.removeEventListener("canplay", onReady);
                                };
                                n.addEventListener("canplay", onReady);
                            } else {
                                n.pause();
                                n.play();
                            }
                            stuckCount = 0;
                        }
                    } else {
                        stuckCount = 0;
                        lastTime = current;
                        isBufferingAllowed = false; // it is progressing, so future stalls are unexpected
                    }
                }
            } catch(e) {
                // Ignore DOM Exception 11 if the video object gets into an invalid state temporarily
            }
        }, 500);
    })), n.addEventListener("canplay", (function () {
        c.style.display = "none";
        var errEl = document.getElementById("player-error");
        if (errEl) errEl.style.display = "none";
        // Positive feedback: until now we could only infer from the LACK of an error
        // whether it started. currentSrc shows which <source> won --
        // this decides whether the HLS or the mp4 source was selected.
        clearStall();
        console.log("PLAYABLE. Player selected: " +
            (n.currentSrc || "(unknown)"))
    })), n.addEventListener("error", (function () {
        c.style.display = "none"
    })), n.addEventListener("ended", (function () {
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
                console.log("Watchdog (EOF): fresh URL -> " + newUrl);
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

        if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
        closePlayer()
    })), n.addEventListener("timeupdate", (function () {
        var e = n.currentTime || 0,
            t = n.duration,
            i = parseFloat(n.getAttribute("data-duration")) || 0;
        t && !isNaN(t) && t !== 1 / 0 || (t = i);
        var o = 0;
        t && !isNaN(t) && t > 0 && (o = e / t * 100), a.style.width = o + "%", r.textContent = u(e, t) + " / " + u(t, t)
    }))
}));