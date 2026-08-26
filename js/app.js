// ---------------------------------------------------------------------------
// Segedfuggvenyek
// ---------------------------------------------------------------------------

// A WebKit 538.2 (webOS 2.0) csak a -webkit-flex alakot ismeri; az unprefixed
// "flex" ertek ott ervenytelen, es a hozzarendeles csendben elveszik. Eloszor a
// prefixeltet allitjuk, majd az unprefixedet -- modern motoron az utobbi nyer,
// regin viszont ervenytelen, ezert marad a -webkit-flex.
function setDisplayFlex(el) {
    el.style.display = "-webkit-flex";
    el.style.display = "flex";
}

// ---------------------------------------------------------------------------
// Diagnosztika: mi erkezik valojaban?
// A <video> csak egy hibakodot ad, arrol semmit, hogy a szerver mit kuldott.
// Ez a proba lekeri az elso 1 KB-ot es megmondja, media-e egyaltalan.
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

function probeUrl(url, label) {
    var x = new XMLHttpRequest();
    x.open("GET", url, true);
    // A regi WebKit-en ez a megbizhato mod nyers byte-ok olvasasara
    // (a responseType="arraybuffer" nem mindenhol mukodik).
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
        console.log("[" + label + "] >>> " + sniffFormat(t));
        // m3u8-nal a playlist eleje onmagaban is arulkodo (pl. EXT-X-VERSION)
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

// A player.odycdn.com alapertelmezesben MINDEN kerest "flagged"-nek jelol es
// 401-et ad, hacsak nem erkezik engedelyezett Referer/Origin/User-Agent
// fejleccel. Egy <video> tag nem tud fejlecet kuldeni -- viszont a
// ?magic=<unix_ts> query parameter 5 percig teljesen kikapcsolja ezt az
// ellenorzest, es az URL resze, tehat a <video> is hasznalhatja.
function buildPlayableUrl(rawUrl, useMagic) {
    var u = rawUrl.replace(/^https:/i, "http:");
    u = u.replace(/([?&])magic=\d+/, "$1").replace(/[?&]$/, "");
    if (!useMagic) return u;
    return u + (-1 === u.indexOf("?") ? "?" : "&") + "magic=" + OdyseeAPI.getServerNowSec();
}

// A webOS 2.0 web engine WebKit 538.2 -- nem tud WebP-t dekodolni. Ezen felul a
// nyers thumbnailek nagy resze 1920x1080: 20 kartya ~101 MB dekodolt bitmap,
// 400x225-re meretezve ~7 MB. A proxy tehat formatumot ES meretet is rendez,
// ezert kell minden kepre. A forras formatuma amugy sem allapithato meg az
// URL-bol: a thumbnails.lbry.com kiterjesztes es Content-Type nelkul ad
// JPEG-et es WebP-et is ugyanarrol a hostrol.
function thumbUrl(u) {
    if (!u) return "";
    return "https://wsrv.nl/?url=" + encodeURIComponent(u) + "&output=jpg&w=400";
}

// A vegtelen gorgetes soha nem engedte el a kartyakat. DOM-node-ot torolni nem
// lehet (a .video-card:nth-child(4n) szabaly elcsuszna, es ugrana a gorgetes),
// ezert csak a kepek src-jet dobjuk el a viewporttol tavol. A .thumbnail-wrapper
// padding-bottom:56.25%-kal tartja a helyet, tehat a layout nem esik ossze.
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

// A menu dinamikusan epul a homepage API szekcioibol (Featured, Gaming, Tech...).
var navSections = [];

function sectionLabel(id) {
    if ("nav-trending" === id) return "Trending";
    if ("nav-search" === id) return "Search";
    var key = 0 === id.indexOf("cat:") ? id.substring(4) : "";
    for (var i = 0; i < navSections.length; i++)
        if (navSections[i].key === key) return navSections[i].label;
    return "Odysee";
}

function dispatchLoad(id, page, cb) {
    if ("nav-trending" === id) return OdyseeAPI.getTrending(cb, page);
    if ("nav-search" === id) return OdyseeAPI.search(currentSearchQuery, cb, page);
    if (0 === id.indexOf("cat:")) return OdyseeAPI.getCategory(id.substring(4), cb, page);
    cb(new Error("Ismeretlen nezet: " + id))
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
    var items = [{ id: "nav-trending", label: "Trending" }];
    for (var i = 0; i < navSections.length; i++)
        items.push({ id: "cat:" + navSections[i].key, label: navSections[i].label });
    items.push({ id: "nav-search", label: "Search" });
    ul.innerHTML = "";
    for (var j = 0; j < items.length; j++) {
        var li = document.createElement("li");
        li.className = "focusable nav-item" + (0 === j ? " active" : "");
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
        SpatialNavigation.refresh()
    }
    o.style.display = "none";
    i.innerText = sectionLabel(e);
    dispatchLoad(e, currentPage, r)
}

function doSearch(e) {
    var t = document.getElementById("video-grid"),
        n = document.getElementById("loading");

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
        a = document.getElementById("player-title");

    function handleMediaError(code, url) {
        // A magic-allapotot atvesszuk az URL-bol: ha az elozo forras magic-kel ment,
        // a fallback is azzal kell menjen, kulonben a hotlink-vedelem 401-et ad.
        var magicOn = -1 !== url.indexOf("magic=");
        var msg = {
            1: "Megszakitva (MEDIA_ERR_ABORTED).",
            2: "Halozati hiba (MEDIA_ERR_NETWORK).",
            3: "Dekodolasi hiba (MEDIA_ERR_DECODE) - a TV nem birja a kodeket.",
            4: "Nem tamogatott forras (MEDIA_ERR_SRC_NOT_SUPPORTED)."
        }[code] || ("Ismeretlen mediahiba (" + code + ").");
        console.error("Video hiba " + code + ": " + msg);
        o.style.display = "none";

        // A 3-as/4-es kod jellemzoen formatum-problema. Ket forrasunk van, es ha az
        // egyik nem megy, meg megprobalhatjuk a masikat:
        //   HLS  -> EXT-X-VERSION:6-ot deklaral, a webOS 2.0 viszont HLS v3-at tud
        //   mp4  -> a nyers feltoltes; a TV viszi a H.264 HP@L4.2-t es a H.265
        //           Main/Main10@L4.1-et, de az AV1-et nem, a VP9-et csak UHD-n
        // Ezert bukas eseten atvaltunk a masik forrasra, mielott feladnank.
        if (3 === code || 4 === code) {
            if (!triedMp4 && -1 === url.indexOf("/v6/streams/")) {
                var mp4 = OdyseeAPI.buildMp4Url(currentClaim);
                if (mp4) {
                    triedMp4 = true;
                    playReason = "nyers mp4 fallback (elozo forras hibakod: " + code + ")";
                    console.log("VISSZAESES OKA: a(z) " + (hadHls ? "HLS" : "v4") +
                        " forras " + code + "-as hibaval bukott -> nyers mp4: " + mp4);
                    probeUrl(buildPlayableUrl(mp4, magicOn), "mp4-proba");
                    a.textContent = (hadHls ? "A HLS nem jatszhato" : "Ez a forras nem jatszhato") +
                        ", nyers mp4-gyel probalom...";
                    o.style.display = "block";
                    return void r(buildPlayableUrl(mp4, magicOn))
                }
            }

            // Idaig jutva mindket forras elbukott.
            probeUrl(url, "vegso-proba");
            if (hadHls) {
                // Van kesz transcode, csak nem jatszhato (szinte biztosan a
                // playlist EXT-X-VERSION:6-ja) -- uj transcode kerese nem segit.
                a.textContent = "Sem a HLS, sem a nyers mp4 nem jatszhato le ezen a TV-n."
            } else {
                // Nincs transcode: keressuk egyet. A HEAD felveszi a streamet a
                // transcoder soraba (fitForTranscoder -> pool.Admit). A `common`
                // queue MinHits-kuszobos, tehat egy keres lehet hogy keves.
                a.textContent = msg + " Transzkodolas kerve, probald par perc mulva.";
                var q = new XMLHttpRequest();
                q.open("HEAD", buildPlayableUrl(url, true), true);
                q.onreadystatechange = function () {
                    if (4 === q.readyState) console.log("Transcode-sorbaallitas: " + q.status)
                };
                q.send()
            }
        } else a.textContent = msg
    }

    function r(e) {
        console.log("LEJATSZAS INDUL [" + (playReason || "elsodleges") + "]: " + e), i.onerror = null, i.innerHTML = "", i.src = e, i.volume = 1, i.muted = !1, i.onerror = function () {
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
        hadHls = false,      // volt-e kesz HLS transcode (308 erkezett)
        triedMp4 = false,    // megprobaltuk-e mar a nyers mp4-et
        playReason = "";     // miert epp ezt az URL-t jatsszuk
    i.setAttribute("data-duration", t), i.innerHTML = "", i.src = "", a.textContent = e.value.title || "Unknown Title", n.classList.remove("hidden"), o.style.display = "block";

    function startVideoWithWarmup(rawUrl) {
        var retries = 0,
            maxRetries = 6,
            useMagic = false;   // eloszor query NELKUL -> cache-elheto

        function fail(msg) {
            console.error(msg);
            o.style.display = "none";
            a.textContent = msg;
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

                if (429 === s) return void fail("429: rate limit. A CDN cache-t megkerulo keres az originre ment. Varj par percet.");

                // A magic MINDIG cache MISS-t okoz (a CDN nem cache-eli a query
                // stringes kereseket ezen a vegponton), ezert csak vegso esetben
                // nyulunk hozza: ha query nelkul hotlink-vedelembe futottunk.
                if (401 === s && !useMagic) {
                    console.log("401 query nelkul -> egy proba magic-kel (figyelem: cache MISS lesz)");
                    useMagic = true;
                    return void warm()
                }
                if (401 === s) return void fail("401: a hotlink-vedelem magic-kel sem engedett at.");
                if (404 === s) return void fail("404: a stream nem talalhato.");

                if (308 === s) {
                    var hls = OdyseeAPI.buildHlsUrl(currentClaim);
                    if (hls) {
                        hadHls = true;
                        playReason = "HLS (308, van kesz transcode)";
                        probeUrl(buildPlayableUrl(hls, useMagic), "HLS-proba");
                        return void r(buildPlayableUrl(hls, useMagic))
                    }
                }
                if ((503 === s || 0 === s || s >= 500) && retries < maxRetries) {
                    retries++;
                    return void setTimeout(warm, 3000);
                }
                playReason = useMagic ? "v4/mp4 magic-kel" : "v4/mp4 query nelkul (cache-elheto)";
                r(buildPlayableUrl(rawUrl, useMagic))
            };
            xhr.ontimeout = xhr.onerror = function () {
                if (retries < maxRetries) {
                    retries++;
                    setTimeout(warm, 3000)
                } else r(buildPlayableUrl(rawUrl, useMagic))
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
        })).join(" "),
            i = document.getElementById("debug-console");
        // Ugyanaz a szoveg megy a dev szerverre is, ha be van kotve a devlog.js.
        // A try/catch azert kell, hogy a naplozas soha ne dontse el az appot.
        try {
            if ("undefined" != typeof RemoteLog) RemoteLog.push(e, n)
        } catch (err) { }
        if (i) {
            var o = document.createElement("div");
            o.style.color = "error" === e ? "#f00" : "#0f0", o.style.marginBottom = "4px", o.style.borderBottom = "1px solid #333", o.style.wordWrap = "break-word";
            var a = new Date,
                r = a.getHours() + ":" + a.getMinutes() + ":" + a.getSeconds() + "." + a.getMilliseconds();
            o.textContent = "[" + r + "] " + e.toUpperCase() + ": " + n, i.appendChild(o), i.scrollTop = i.scrollHeight
        }
    }
    console.log = function () {
        n("log", arguments), e.apply(console, arguments)
    }, console.error = function () {
        n("error", arguments), t.apply(console, arguments)
    }, window.onerror = function (e, t, n, i, o) {
        console.error("Global Error: " + e + " at " + t + ":" + n)
    }
}(), document.addEventListener("DOMContentLoaded", (function () {
    // Eloszor oraszinkron, csak utana toltunk: a `magic` parameter kulonben
    // elcsuszott TV-oraval ervenytelen lenne es 401-et kapnank.
    OdyseeAPI.syncServerTime(function () {
        OdyseeAPI.getSections(function (err, sections) {
            if (err) console.error("Kategoriak betoltese sikertelen: " + err.message);
            buildNav(sections || []);
            SpatialNavigation.refresh();
            loadPage("nav-trending")
        })
    });
    SpatialNavigation.init();
    bindNav();
    var n = document.getElementById("btn-search"),
        i = document.getElementById("search-input");
    n && i && (n.addEventListener("click", (function () {
        var e = i.value.trim();
        e.length > 0 && doSearch(e)
    })), i.addEventListener("keydown", (function (e) {
        13 === e.keyCode && (e.preventDefault(), n.click())
    })))

    var mainContent = document.getElementById("main-content");
    if (mainContent) {
        var releaseTimer = null;
        mainContent.addEventListener("scroll", function () {
            if (mainContent.scrollTop + mainContent.clientHeight >= mainContent.scrollHeight - 500) {
                loadMoreContent();
            }
            // Throttle: gorgetes kozben ne fusson minden eventre.
            if (releaseTimer) clearTimeout(releaseTimer);
            releaseTimer = setTimeout(function () {
                releaseOffscreenThumbs(mainContent)
            }, 300);
        });
    }

    // RED gomb: debug konzol ki/be. Eddig allandoan takarta a kepernyo jobb oldalat.
    window.addEventListener("keydown", function (ev) {
        if (403 === ev.keyCode) {
            var dc = document.getElementById("debug-console");
            if (dc) dc.style.display = ("none" === dc.style.display ? "block" : "none")
        }
    });
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
            d();
            var t = e.keyCode;
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
    })), i.addEventListener("click", (function () {
        n.paused ? (n.play(), i.innerHTML = "&#9632;") : (n.pause(), i.innerHTML = "&#9654;", d())
    })), n.addEventListener("play", (function () {
        i.innerHTML = "&#9632;", d()
    })), n.addEventListener("pause", (function () {
        i.innerHTML = "&#9654;", d()
    }));
    var c = document.getElementById("player-loading");

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
    })), n.addEventListener("playing", (function () {
        c.style.display = "none"
    })), n.addEventListener("canplay", (function () {
        c.style.display = "none"
    })), n.addEventListener("error", (function () {
        c.style.display = "none"
    })), n.addEventListener("timeupdate", (function () {
        var e = n.currentTime || 0,
            t = n.duration,
            i = parseFloat(n.getAttribute("data-duration")) || 0;
        t && !isNaN(t) && t !== 1 / 0 || (t = i);
        var o = 0;
        t && !isNaN(t) && t > 0 && (o = e / t * 100), a.style.width = o + "%", r.textContent = u(e, t) + " / " + u(t, t)
    }))
}));