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
        return i.innerText = "Search", o.style.display = "flex", n.style.display = "none", SpatialNavigation.refresh(), void (a && setTimeout((function () {
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
            if (i.items.length < 20) hasMore = false;
            for (var a = 0; a < i.items.length; a++) {
                var r = createVideoCard(i.items[a]);
                r && t.appendChild(r)
            }
        } else {
            hasMore = false;
        }
        SpatialNavigation.refresh()
    }
    o.style.display = "none", "nav-home" === e ? (i.innerText = "Home", OdyseeAPI.getHome(r, currentPage)) : (i.innerText = "Trending", OdyseeAPI.getTrending(r, currentPage))
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
            if (i.items.length < 20) hasMore = false;
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
            if (i.items.length < 20) hasMore = false;
            for (var a = 0; a < i.items.length; a++) {
                var r = createVideoCard(i.items[a]);
                r && t.appendChild(r)
            }
            SpatialNavigation.refresh();
        } else {
            hasMore = false;
        }
    }

    if (currentCategory === 'nav-home') OdyseeAPI.getHome(appendCards, currentPage);
    else if (currentCategory === 'nav-trending') OdyseeAPI.getTrending(appendCards, currentPage);
    else if (currentCategory === 'nav-search') OdyseeAPI.search(currentSearchQuery, appendCards, currentPage);
}

function createVideoCard(e) {
    if (!e.value) return null;
    var t = e.value.title || "Untitled",
        n = e.value.thumbnail ? e.value.thumbnail.url : "";
    n && (n = "https://wsrv.nl/?url=" + encodeURIComponent(n) + "&output=jpg&w=400");
    var i = e.signing_channel && e.signing_channel.value ? e.signing_channel.value.title : "Unknown";
    var uploadDate = "";
    if (e.meta && e.meta.creation_timestamp) {
        uploadDate = new Date(e.meta.creation_timestamp * 1000).toLocaleDateString();
    } else if (e.value && e.value.release_time) {
        uploadDate = new Date(e.value.release_time * 1000).toLocaleDateString();
    }
    
    var o = document.createElement("div");
    o.className = "video-card focusable";
    o.innerHTML = '<div class="thumbnail-wrapper"><img class="thumbnail" src="' + n + '" /></div><div class="info"><div class="title">' + t + '</div><div class="channel">' + i + '</div><div class="card-date">' + uploadDate + '</div></div>';
    
    var debugConsole = document.getElementById("debug-console");
    if (debugConsole) {
        var log = document.createElement("div");
        log.innerText = "DOM: " + o.innerHTML;
        debugConsole.appendChild(log);
    }
    
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

    function r(e) {
        console.log("Playing URL: " + e), i.onerror = null, i.innerHTML = "", i.src = e, i.volume = 1, i.muted = !1, i.onerror = function () {
            console.error("Native Video Error Code:", i.error ? i.error.code : "unknown")
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

    if (e.claim_id) {
        OdyseeAPI.getViewCount(e.claim_id, function (err, views) {
            if (!err) {
                var eyeSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle; margin-right: 4px;"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';
                document.getElementById("meta-views").innerHTML = eyeSvg + views;
            }
        });
        OdyseeAPI.getReactions(e.claim_id, function (err, reactions) {
            if (!err && reactions) {
                var likeSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle; margin-right: 4px;"><path d="M2 20h2c.55 0 1-.45 1-1v-9c0-.55-.45-1-1-1H2v11zm19.83-7.12c.11-.25.17-.52.17-.8V11c0-1.1-.9-2-2-2h-5.98l1.24-5.22.04-.32c0-.41-.17-.79-.44-1.06L14.28 1 8.14 7.55C7.81 7.89 7.6 8.35 7.6 8.85V19c0 1.1.9 2 2 2h7.97c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-.12z"/></svg>';
                var dislikeSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle; margin-left: 12px; margin-right: 4px;"><path d="M22 4h-2c-.55 0-1 .45-1 1v9c0 .55.45 1 1 1h2V4zM2.17 11.12c-.11.25-.17.52-.17.8V13c0 1.1.9 2 2 2h5.98l-1.24 5.22-.04.32c0 .41.17.79.44 1.06L9.72 23l6.14-6.55c.33-.34.54-.8.54-1.3V5c0-1.1-.9-2-2-2H6.43c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v.12z"/></svg>';
                document.getElementById("meta-reactions").innerHTML = likeSvg + (reactions.like || 0) + dislikeSvg + (reactions.dislike || 0);
            }
        });
    }

    i.setAttribute("data-duration", t), i.innerHTML = "", i.src = "", a.textContent = e.value.title || "Unknown Title", n.classList.remove("hidden"), o.style.display = "block", OdyseeAPI.getStreamingSourceUrl(e, (function (t, n) {
        if (!t && n) r(n);
        else {
            console.error("Failed to get stream URL via get method.", t);
            var i = e.value && e.value.source ? e.value.source.sd_hash : "",
                a = e.claim_id;
            if (i && a) {
                var l = "http://player.odycdn.com/v6/streams/" + a + "/" + i.substring(0, 6) + ".mp4";
                console.log("Using assembled MP4 fallback: " + l), r(l)
            } else o.style.display = "none"
        }
    })), history.pushState({
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
    loadPage("nav-home"), SpatialNavigation.init();
    for (var e = document.querySelectorAll(".nav-item"), t = 0; t < e.length; t++) e[t].addEventListener("click", (function () {
        for (var t = 0; t < e.length; t++) e[t].classList.remove("active");
        this.classList.add("active"), loadPage(this.getAttribute("data-id"))
    }));
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
        mainContent.addEventListener("scroll", function () {
            if (mainContent.scrollTop + mainContent.clientHeight >= mainContent.scrollHeight - 500) {
                loadMoreContent();
            }
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
            d();
            var t = e.keyCode;
            if (415 === t || 19 === t || 179 === t || 13 === t) (13 === t && "BUTTON" !== document.activeElement.tagName || 13 !== t) && i.click();
            else if (412 === t || 37 === t) n.currentTime = Math.max(0, n.currentTime - 10);
            else if (417 === t || 39 === t) {
                var o = isNaN(n.duration) ? n.currentTime + 10 + 100 : n.duration;
                n.currentTime = Math.min(o, n.currentTime + 10)
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