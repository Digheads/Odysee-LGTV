// ---------------------------------------------------------------------------
// Video player, streaming engine, controls and watchdog
// (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var Player = (function () {
    var PREFER_HLS = true;
    var MIME_HLS = "application/vnd.apple.mpegurl";
    var MIME_MP4 = "video/mp4";

    var stallTimer = null;
    var rebuf_count = 0;
    var rebuf_start = 0;
    var rebuf_duration = 0;
    var last_progress_report = 0;
    var isPlayerActive = false;
    var isCommentsOpen = false;

    function clearStall() {
        if (stallTimer) {
            clearTimeout(stallTimer);
            stallTimer = null;
        }
    }

    function openCommentsSidebar(claimId) {
        var sidebar = document.getElementById("player-comments-sidebar");
        var listEl = document.getElementById("comments-list");
        var titleEl = document.getElementById("comments-sidebar-title");
        if (!sidebar || !listEl) return;

        isCommentsOpen = true;
        history.pushState({ playerOpen: true, commentsOpen: true }, "comments");
        sidebar.classList.remove("hidden");
        listEl.innerHTML = '<div class="comments-loading">Loading comments...</div>';

        if (window.Comments && typeof Comments.list === "function" && claimId) {
            Comments.list(claimId, 1, function (err, res) {
                if (err || !res || !res.items) {
                    listEl.innerHTML = '<div class="comments-empty">Failed to load comments.</div>';
                    return;
                }

                var total = res.total_items || 0;
                if (titleEl) {
                    titleEl.textContent = total + (total === 1 ? " Comment" : " Comments");
                }

                if (res.items.length === 0) {
                    listEl.innerHTML = '<div class="comments-empty">No comments yet.</div>';
                    return;
                }

                var html = "";
                for (var idx = 0; idx < res.items.length; idx++) {
                    var item = res.items[idx];
                    var author = item.channel_name || "Anonymous";
                    var timeAgo = (window.Utils && typeof Utils.formatRelativeTime === "function" && item.timestamp) ?
                        Utils.formatRelativeTime(item.timestamp) : "";
                    var bodyText = (window.Utils && typeof Utils.escapeHtml === "function") ?
                        Utils.escapeHtml(item.comment || "") : (item.comment || "");

                    html += '<div class="comment-card">';
                    html += '  <div class="comment-card-header">';
                    html += '    <span class="comment-author">' + author + '</span>';
                    if (item.is_creator) {
                        html += '    <span class="comment-badge-creator">Creator</span>';
                    }
                    if (item.is_pinned) {
                        html += '    <span class="comment-badge-pinned">Pinned</span>';
                    }
                    if (timeAgo) {
                        html += '    <span class="comment-time">' + timeAgo + '</span>';
                    }
                    html += '  </div>';
                    html += '  <div class="comment-body">' + bodyText + '</div>';
                    html += '</div>';
                }
                listEl.innerHTML = html;
            });
        }
    }

    function closeCommentsSidebar() {
        var sidebar = document.getElementById("player-comments-sidebar");
        if (sidebar) {
            sidebar.classList.add("hidden");
        }
        isCommentsOpen = false;
    }

    function setSources(video, list) {
        video.removeAttribute("src");
        video.innerHTML = "";
        for (var k = 0; k < list.length; k++) {
            if (!list[k] || !list[k].url) continue;
            var s = document.createElement("source");
            s.setAttribute("src", list[k].url);
            if (list[k].type) s.setAttribute("type", list[k].type);
            s.onerror = function () {
                if (!isPlayerActive) return;
                console.error("Source tag error on: " + this.src);
            };
            video.appendChild(s);
            console.log("  source " + (k + 1) + ": " + (list[k].type || "no MIME type") + " -> " + list[k].url);
        }
    }

    function closePlayer() {
        isPlayerActive = false;
        closeCommentsSidebar();
        var aEl = document.getElementById("progress-fill");
        if (aEl) {
            aEl.classList.remove("seeking");
            aEl.style.backgroundImage = "";
        }
        if (window._seekStyleTimer) clearTimeout(window._seekStyleTimer);
        clearStall();
        stopWatchdog();
        clearReconnectStall();
        var e = document.getElementById("player-container"),
            t = document.getElementById("video-player");

        if (!t) return;
        t.style.opacity = "1";

        // Send watchman report on close if we have played something
        if (!t.paused || t.currentTime > 0) {
            var dur = t.duration || parseFloat(t.getAttribute("data-duration")) || 0;
            var rel = dur > 0 ? (t.currentTime / dur * 100) : 0;
            if (window.OdyseeAPI && typeof OdyseeAPI.reportWatchmanPlayback === "function") {
                OdyseeAPI.reportWatchmanPlayback(t.currentSrc || "", dur, t.currentTime, rel, rebuf_count, rebuf_duration);
            }
        }
        rebuf_count = 0;
        rebuf_start = 0;
        rebuf_duration = 0;

        var cClaim = window._activeClaim;
        if (cClaim && cClaim.claim_id && t) {
            var curClose = t.currentTime || 0,
                durClose = t.duration || 0;
            if (window.OdyseeAPI && typeof OdyseeAPI.saveResumePoint === "function") {
                OdyseeAPI.saveResumePoint(cClaim.claim_id, curClose, durClose);
            }
        }

        t.pause();
        t.onerror = null;
        t.innerHTML = "";
        t.src = "";
        if (e) e.classList.add("hidden");
        SpatialNavigation.refresh();

        var targetCard = window.isChannelPageOpen ? window.lastFocusedChannelCard : window.lastFocusedCard;
        if (targetCard) {
            for (var n = document.querySelectorAll(".focusable"), i = 0, o = 0; o < n.length; o++) {
                if (null !== n[o].offsetParent) {
                    if (n[o] === targetCard) {
                        SpatialNavigation.focusElement(i);
                        break;
                    }
                    i++;
                }
            }
        }
    }

    function playVideo(e) {
        var t = e.value && e.value.video ? e.value.video.duration : 0,
            n = document.getElementById("player-container"),
            i = document.getElementById("video-player"),
            o = document.getElementById("player-loading"),
            a = document.getElementById("player-title"),
            playerError = document.getElementById("player-error");

        var currentClaim = e,
            hadHls = false,
            triedMp4 = false,
            stalledAtZero = false,
            playReason = "";

        var resumePoint = (window.OdyseeAPI && typeof OdyseeAPI.getResumePoint === "function") ?
            OdyseeAPI.getResumePoint(e.claim_id) : null;
        var initialResumeTime = (resumePoint && resumePoint.time > 10 && (!resumePoint.duration || resumePoint.time < resumePoint.duration - 15)) ?
            resumePoint.time : 0;

        function showResumeNotice(sec) {
            var notice = document.getElementById("resume-notice");
            if (!notice) {
                notice = document.createElement("div");
                notice.id = "resume-notice";
                notice.className = "resume-notice";
                var cc = document.getElementById("custom-controls");
                if (cc) cc.appendChild(notice);
            }
            if (notice) {
                notice.textContent = "▶ Resume: " + Utils.formatDuration(sec, 0);
                notice.style.display = "block";
                setTimeout(function () {
                    notice.style.display = "none";
                }, 3500);
            }
        }

        function handleMediaError(code, url) {
            if (!isPlayerActive || (n && n.classList.contains("hidden"))) {
                return;
            }
            clearStall();
            var cur = i ? (i.currentTime || 0) : 0;
            if (cur > 5 && !i.seeking && window._pendingSeekTime === undefined) {
                console.log("Watchdog: mid-stream media error (" + code + ") at " + cur.toFixed(2) + "s -> instant reconnect!");
                reconnectStream(cur);
                return;
            }
            var magicOn = -1 !== url.indexOf("magic=");
            var msg = {
                1: "Aborted (MEDIA_ERR_ABORTED).",
                2: "Network error (MEDIA_ERR_NETWORK).",
                3: "Decode error (MEDIA_ERR_DECODE) - unsupported codec.",
                4: "Unsupported source (MEDIA_ERR_SRC_NOT_SUPPORTED)."
            }[code] || ("Unknown media error (" + code + ").");
            console.error("Video error " + code + ": " + msg);
            if (o) o.style.display = "none";

            if (3 === code || 4 === code) {
                if (!triedMp4 && -1 === url.indexOf("/v6/streams/")) {
                    var mp4 = OdyseeAPI.buildMp4Url(currentClaim);
                    if (mp4) {
                        triedMp4 = true;
                        playReason = "raw mp4 fallback (previous source error code: " + code + ")";
                        console.log("FALLBACK REASON: " + (hadHls ? "HLS" : "v4") +
                            " source failed with error " + code + " -> raw mp4: " + mp4);
                        if (playerError) {
                            playerError.textContent = (hadHls ? "HLS is not playable" : "This source is not playable") +
                                ", trying raw mp4...";
                            playerError.style.display = "block";
                        }
                        if (o) o.style.display = "block";
                        return void r(Utils.buildPlayableUrl(mp4, magicOn));
                    }
                }

                if (hadHls) {
                    if (playerError) {
                        playerError.textContent = "Cannot start the video this time, please try again later.";
                        playerError.style.display = "block";
                    }
                } else {
                    if (playerError) {
                        playerError.textContent = "Cannot start the video this time, please try again later. Transcoding requested.";
                        playerError.style.display = "block";
                    }
                    var q = new XMLHttpRequest();
                    q.open("HEAD", Utils.buildPlayableUrl(url, true), true);
                    q.onreadystatechange = function () {
                        if (4 === q.readyState) console.log("Transcode queued: " + q.status);
                    };
                    q.send();
                }
            } else {
                if (playerError) {
                    playerError.textContent = "Cannot start the video this time, please try again later.";
                    playerError.style.display = "block";
                }
            }
        }

        function armStall(url) {
            clearStall();
            stallTimer = setTimeout(function () {
                stallTimer = null;
                if (i.readyState >= 3) return;
                var rs = i.readyState;
                console.error("Did not start within 20s (readyState=" + rs + ")");
                stalledAtZero = (0 === rs);
                handleMediaError(4, url);
            }, 20000);
        }

        function r(url, extra) {
            isPlayerActive = true;
            console.log("PLAYBACK STARTING [" + (playReason || "primary") + "]");
            armStall(url);
            i.onerror = null;
            setSources(i, (extra ? [extra] : []).concat([{
                url: url,
                type: -1 !== url.indexOf(".m3u8") ? MIME_HLS : MIME_MP4
            }]));
            i.volume = 1;
            i.muted = false;
            i.onerror = function () {
                if (!isPlayerActive) return;
                handleMediaError(i.error ? i.error.code : 0, url);
            };

            if (initialResumeTime > 0) {
                var targetResume = initialResumeTime;
                initialResumeTime = 0;
                var onCanPlayResume = function () {
                    i.removeEventListener("canplay", onCanPlayResume);
                    try {
                        i.currentTime = targetResume;
                        console.log("Resuming playback from " + targetResume + "s");
                        showResumeNotice(targetResume);
                    } catch (err) {
                        console.error("Resume seek error:", err);
                    }
                };
                i.addEventListener("canplay", onCanPlayResume);
            }

            i.load();
            var p = i.play();
            if (p && "function" == typeof p.catch) {
                p.catch(function (err) {
                    console.error("Play error:", err);
                });
            }
        }

        // Meta info display (date, views, reactions)
        var uploadDate = "";
        if (e.meta && e.meta.creation_timestamp) {
            uploadDate = new Date(e.meta.creation_timestamp * 1000).toLocaleDateString();
        } else if (e.value && e.value.release_time) {
            uploadDate = new Date(e.value.release_time * 1000).toLocaleDateString();
        }

        var clockSvg = (typeof Icons !== 'undefined') ? Icons.get('clock') : '';
        var metaDateEl = document.getElementById("meta-date");
        if (metaDateEl) metaDateEl.innerHTML = uploadDate ? clockSvg + uploadDate : "";

        var metaViewsEl = document.getElementById("meta-views");
        if (metaViewsEl) metaViewsEl.innerHTML = "";

        var metaReactionsEl = document.getElementById("meta-reactions");
        if (metaReactionsEl) metaReactionsEl.innerHTML = "";

        var timeDisplayEl = document.getElementById("time-display");
        if (timeDisplayEl) timeDisplayEl.textContent = "00:00 / 00:00";

        var progressFillEl = document.getElementById("progress-fill");
        if (progressFillEl) progressFillEl.style.width = "0%";

        var eyeSvg = (typeof Icons !== 'undefined') ? Icons.get('eye') : '';
        if (e._cached_views !== undefined && metaViewsEl) {
            metaViewsEl.innerHTML = eyeSvg + e._cached_views;
        } else if (e.claim_id) {
            OdyseeAPI.getViewCount(e.claim_id, function (err, views) {
                if (!err && metaViewsEl) {
                    e._cached_views = views;
                    metaViewsEl.innerHTML = eyeSvg + views;
                }
            });
        }

        // Comment count on player
        var btnComments = document.getElementById("btn-comments");
        var countComments = document.getElementById("comments-count");
        var iconComments = document.getElementById("comments-icon");
        if (iconComments && typeof Icons !== 'undefined') {
            iconComments.innerHTML = Icons.get('comment');
        }
        if (countComments) countComments.textContent = "0";
        if (window.Comments && typeof Comments.list === "function" && e.claim_id) {
            Comments.list(e.claim_id, 1, function (err, res) {
                if (!err && res && countComments) {
                    countComments.textContent = res.total_items || 0;
                }
            });
        }

        var isAuth = window.Auth && Auth.isLoggedIn && Auth.isLoggedIn();
        var likeSvg = (typeof Icons !== 'undefined') ? Icons.get('fire') : '';
        var dislikeSvg = (typeof Icons !== 'undefined') ? Icons.get('slime') : '';

        function bindReactionButtons(claimId) {
            var btnLike = document.getElementById("btn-like");
            var btnDislike = document.getElementById("btn-dislike");
            var countLike = document.getElementById("like-count");
            var countDislike = document.getElementById("dislike-count");

            if (btnLike) {
                btnLike.onclick = function (evt) {
                    evt.stopPropagation();
                    var wasLiked = btnLike.classList.contains("active-like");
                    var wasDisliked = btnDislike ? btnDislike.classList.contains("active-dislike") : false;
                    var curL = parseInt(countLike ? countLike.textContent : "0", 10) || 0;
                    var curD = parseInt(countDislike ? countDislike.textContent : "0", 10) || 0;

                    if (wasLiked) {
                        btnLike.classList.remove("active-like");
                        var newL = Math.max(0, curL - 1);
                        if (countLike) countLike.textContent = newL;
                        if (!e._cached_reactions) e._cached_reactions = { like: 0, dislike: 0 };
                        e._cached_reactions.like = newL;
                        e._cached_reactions.myReaction = null;
                        OdyseeAPI.react(claimId, "like", true);
                    } else {
                        btnLike.classList.add("active-like");
                        var newL = curL + 1;
                        if (countLike) countLike.textContent = newL;
                        if (!e._cached_reactions) e._cached_reactions = { like: 0, dislike: 0 };
                        e._cached_reactions.like = newL;
                        e._cached_reactions.myReaction = "like";
                        if (wasDisliked && btnDislike) {
                            btnDislike.classList.remove("active-dislike");
                            var newD = Math.max(0, curD - 1);
                            if (countDislike) countDislike.textContent = newD;
                            e._cached_reactions.dislike = newD;
                        }
                        OdyseeAPI.react(claimId, "like", false);
                    }
                };
            }

            if (btnDislike) {
                btnDislike.onclick = function (evt) {
                    evt.stopPropagation();
                    var wasDisliked = btnDislike.classList.contains("active-dislike");
                    var wasLiked = btnLike ? btnLike.classList.contains("active-like") : false;
                    var curL = parseInt(countLike ? countLike.textContent : "0", 10) || 0;
                    var curD = parseInt(countDislike ? countDislike.textContent : "0", 10) || 0;

                    if (wasDisliked) {
                        btnDislike.classList.remove("active-dislike");
                        var newD = Math.max(0, curD - 1);
                        if (countDislike) countDislike.textContent = newD;
                        if (!e._cached_reactions) e._cached_reactions = { like: 0, dislike: 0 };
                        e._cached_reactions.dislike = newD;
                        e._cached_reactions.myReaction = null;
                        OdyseeAPI.react(claimId, "dislike", true);
                    } else {
                        btnDislike.classList.add("active-dislike");
                        var newD = curD + 1;
                        if (countDislike) countDislike.textContent = newD;
                        if (!e._cached_reactions) e._cached_reactions = { like: 0, dislike: 0 };
                        e._cached_reactions.dislike = newD;
                        e._cached_reactions.myReaction = "dislike";
                        if (wasLiked && btnLike) {
                            btnLike.classList.remove("active-like");
                            var newL = Math.max(0, curL - 1);
                            if (countLike) countLike.textContent = newL;
                            e._cached_reactions.like = newL;
                        }
                        OdyseeAPI.react(claimId, "dislike", false);
                    }
                };
            }
        }

        function renderReactions(likes, dislikes, myRx) {
            if (!metaReactionsEl) return;
            if (isAuth) {
                var existingLike = document.getElementById("btn-like");
                var existingDislike = document.getElementById("btn-dislike");
                if (existingLike && existingDislike) {
                    var countLikeEl = document.getElementById("like-count");
                    var countDislikeEl = document.getElementById("dislike-count");
                    if (countLikeEl) countLikeEl.textContent = likes || 0;
                    if (countDislikeEl) countDislikeEl.textContent = dislikes || 0;
                    if (myRx !== undefined) {
                        existingLike.classList.remove("active-like");
                        existingDislike.classList.remove("active-dislike");
                        if (myRx === "like") existingLike.classList.add("active-like");
                        else if (myRx === "dislike") existingDislike.classList.add("active-dislike");
                    }
                    return;
                }

                metaReactionsEl.innerHTML =
                    '<button class="focusable btn-player-reaction' + (myRx === 'like' ? ' active-like' : '') + '" id="btn-like" title="Like">' +
                    likeSvg + '<span id="like-count">' + (likes || 0) + '</span>' +
                    '</button>' +
                    '<button class="focusable btn-player-reaction' + (myRx === 'dislike' ? ' active-dislike' : '') + '" id="btn-dislike" title="Dislike">' +
                    dislikeSvg + '<span id="dislike-count">' + (dislikes || 0) + '</span>' +
                    '</button>';
                bindReactionButtons(e.claim_id);

                if (myRx === undefined && window.OdyseeAPI && typeof OdyseeAPI.getMyReaction === "function") {
                    OdyseeAPI.getMyReaction(e.claim_id, function (err, rx) {
                        var bLike = document.getElementById("btn-like");
                        var bDislike = document.getElementById("btn-dislike");
                        if (!bLike || !bDislike) return;
                        bLike.classList.remove("active-like");
                        bDislike.classList.remove("active-dislike");
                        if (rx === "like") {
                            bLike.classList.add("active-like");
                        } else if (rx === "dislike") {
                            bDislike.classList.add("active-dislike");
                        }
                    });
                }
                setTimeout(function () {
                    SpatialNavigation.refresh();
                }, 100);
            } else {
                metaReactionsEl.innerHTML = likeSvg + (likes || 0) + dislikeSvg + (dislikes || 0);
            }
        }

        var cachedRx = (window.OdyseeAPI && typeof OdyseeAPI.getCachedReactions === "function") ?
            OdyseeAPI.getCachedReactions(e.claim_id) : (e._cached_reactions || null);

        // Render reaction buttons immediately so they are available right away
        renderReactions(
            cachedRx ? cachedRx.like : 0,
            cachedRx ? cachedRx.dislike : 0,
            cachedRx ? cachedRx.myReaction : undefined
        );

        if (e.claim_id) {
            OdyseeAPI.getReactions(e.claim_id, function (err, reactions) {
                if (!err && reactions) {
                    e._cached_reactions = reactions;
                    renderReactions(reactions.like, reactions.dislike, reactions.myReaction);
                }
            });
        }

        isPlayerActive = false;
        window._magicPrefetchDone = false;
        if (playerError) playerError.style.display = "none";
        i.setAttribute("data-duration", t);
        i.innerHTML = "";
        i.removeAttribute("src");
        i.src = "";
        if (a) a.textContent = e.value.title || "Unknown Title";
        if (n) n.classList.remove("hidden");
        if (o) o.style.display = "block";

        function startVideoWithWarmup(rawUrl) {
            var retries = 0,
                maxRetries = 6,
                useMagic = false;

            var cachedMagicUrl = (window.StreamResolver && typeof StreamResolver.getCachedMagicUrl === "function") ?
                StreamResolver.getCachedMagicUrl(currentClaim.claim_id) : null;
            if (cachedMagicUrl) {
                console.log("StreamResolver: starting immediately with cached magic URL: " + cachedMagicUrl);
                i.dataset.rawUrl = rawUrl;
                i.dataset.useMagic = "true";
                window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
                window._magicPrefetchDone = false;
                var cachedHls = PREFER_HLS ? OdyseeAPI.buildHlsUrl(currentClaim) : null;
                if (cachedHls) {
                    hadHls = true;
                    playReason = "cached magic (HLS + mp4 fallback)";
                    return void r(cachedMagicUrl, {
                        url: cachedHls,
                        type: MIME_HLS
                    });
                }
                playReason = "cached magic (mp4)";
                return void r(cachedMagicUrl);
            }

            function fail(msg) {
                console.error(msg);
                if (o) o.style.display = "none";
                if (playerError) {
                    playerError.textContent = "Cannot start the video this time, please try again later.";
                    playerError.style.display = "block";
                }
                if (a) a.textContent = e.value.title || "Unknown Title";
            }

            function warm() {
                var url = Utils.buildPlayableUrl(rawUrl, useMagic),
                    xhr = new XMLHttpRequest();
                xhr.open("HEAD", url, true);
                xhr.timeout = 15000;
                xhr.onreadystatechange = function () {
                    if (4 !== xhr.readyState) return;
                    var s = xhr.status,
                        cache = "";
                    try {
                        cache = xhr.getResponseHeader("X-77-Cache") || "";
                    } catch (err) { }
                    console.log("Warmup " + s + (cache ? " cache=" + cache : "") +
                        (useMagic ? " [magic]" : " [query nelkul]") + " r=" + retries);

                    if (429 === s) return void fail("429: rate limit. Request bypassing CDN cache hit origin. Wait a few minutes.");

                    if (401 === s && !useMagic) {
                        console.log("401 without query -> trying with magic (warning: cache MISS)");
                        useMagic = true;
                        return void warm();
                    }
                    if (401 === s) return void fail("401: hotlink protection blocked access even with magic.");
                    if (404 === s) return void fail("404: stream not found.");

                    if ((200 === s || 308 === s) && useMagic && window.StreamResolver && typeof StreamResolver.setCachedMagicUrl === "function") {
                        StreamResolver.setCachedMagicUrl(currentClaim.claim_id, url);
                        window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
                        window._magicPrefetchDone = false;
                    }

                    if (308 === s && PREFER_HLS) {
                        var hls = OdyseeAPI.buildHlsUrl(currentClaim);
                        if (hls) {
                            hadHls = true;
                            playReason = "HLS + mp4 fallback, explicit type";
                            i.dataset.rawUrl = rawUrl;
                            i.dataset.useMagic = useMagic ? "true" : "false";
                            if (useMagic) {
                                window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
                                window._magicPrefetchDone = false;
                            }
                            return void r(url, {
                                url: hls,
                                type: MIME_HLS
                            });
                        }
                    }
                    if ((503 === s || 0 === s || s >= 500) && retries < maxRetries) {
                        retries++;
                        return void setTimeout(warm, 3000);
                    }
                    playReason = useMagic ? "original mp4, with magic" : "original mp4, without query (cacheable)";
                    i.dataset.rawUrl = rawUrl;
                    i.dataset.useMagic = useMagic ? "true" : "false";
                    if (useMagic) {
                        window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
                        window._magicPrefetchDone = false;
                    }
                    r(url);
                };
                xhr.ontimeout = xhr.onerror = function () {
                    if (retries < maxRetries) {
                        retries++;
                        setTimeout(warm, 3000);
                    } else {
                        i.dataset.rawUrl = rawUrl;
                        i.dataset.useMagic = useMagic ? "true" : "false";
                        if (useMagic) {
                            window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
                            window._magicPrefetchDone = false;
                        }
                        r(url);
                    }
                };
                xhr.send();
            }
            warm();
        }

        OdyseeAPI.getStreamingSourceUrl(e, function (t, url) {
            if (!t && url) {
                startVideoWithWarmup(url);
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
                } else if (o) o.style.display = "none";
            }
        });

        history.pushState({ playerOpen: true }, "player");
        setTimeout(function () {
            SpatialNavigation.refresh();
            for (var e = document.querySelectorAll(".focusable"), t = 0; t < e.length; t++) {
                if ("btn-play-pause" === e[t].id) {
                    SpatialNavigation.focusElement(t);
                    break;
                }
            }
        }, 100);
    }

    // --- Watchdog: stall detection & reconnection ---
    var lastTime = 0,
        stuckCount = 0,
        isBufferingAllowed = true,
        reconnectStallTimer = null;

    function clearReconnectStall() {
        if (reconnectStallTimer) {
            clearTimeout(reconnectStallTimer);
            reconnectStallTimer = null;
        }
    }

    function stopWatchdog() {
        if (window._watchdogDelayTimer) { clearTimeout(window._watchdogDelayTimer); window._watchdogDelayTimer = null; }
        if (window._watchdogInterval) { clearInterval(window._watchdogInterval); window._watchdogInterval = null; }
        stuckCount = 0;
    }

    function reconnectStream(savedTime) {
        var n = document.getElementById("video-player"),
            c = document.getElementById("player-loading"),
            playerError = document.getElementById("player-error");
        if (!n) return;

        stopWatchdog();
        clearReconnectStall();

        var raw = n.dataset.rawUrl;
        var useM = n.dataset.useMagic === "true";
        if (!raw) {
            console.warn("Watchdog: no rawUrl stored on player dataset");
            return;
        }

        var cachedM = (useM && window.StreamResolver && typeof StreamResolver.getCachedMagicUrl === "function" && window._activeClaim) ?
            StreamResolver.getCachedMagicUrl(window._activeClaim.claim_id) : null;
        var newUrl = cachedM || Utils.buildPlayableUrl(raw, useM);
        console.log("Watchdog: reconnecting to " + newUrl + (cachedM ? " [pre-warmed cache]" : "") + " at time " + (savedTime ? savedTime.toFixed(2) : 0));

        if (c) c.style.display = "block";
        if (playerError) playerError.style.display = "none";
        n.style.opacity = "1";

        var wasMuted = n.muted;
        var needsSeek = (savedTime && savedTime > 0.5);
        if (needsSeek) {
            n.muted = true;
        }

        var isRestored = false;

        function cleanupListeners() {
            clearReconnectStall();
            n.removeEventListener("loadedmetadata", onMeta);
            n.removeEventListener("canplay", onCanPlay);
            n.removeEventListener("seeked", onSeeked);
        }

        function restorePlayback() {
            if (isRestored) return;
            isRestored = true;
            cleanupListeners();
            if (c) c.style.display = "none";
            n.style.opacity = "1";
            n.muted = wasMuted;

            var p = n.play();
            if (p && typeof p.catch === "function") {
                p.catch(function (err) {
                    console.error("Watchdog play error:", err);
                });
            }
        }

        function onSeeked() {
            console.log("Watchdog: seeked to " + n.currentTime.toFixed(2));
            restorePlayback();
        }

        function onMeta() {
            console.log("Watchdog: loadedmetadata fired, duration=" + n.duration);
            if (needsSeek && Math.abs(n.currentTime - savedTime) > 0.5) {
                console.log("Watchdog: seeking to " + savedTime.toFixed(2));
                n.addEventListener("seeked", onSeeked);
                setTimeout(function () {
                    if (!isRestored) restorePlayback();
                }, 2000);
                try {
                    n.currentTime = savedTime;
                } catch (e) {
                    console.error("Watchdog: error seeking to savedTime", e);
                    restorePlayback();
                }
            } else {
                restorePlayback();
            }
        }

        function onCanPlay() {
            console.log("Watchdog: canplay fired");
            if (!needsSeek) {
                restorePlayback();
            }
        }

        // Apply new source directly to video element (avoiding WebKit <source> replacement quirks)
        function applySource(urlToUse) {
            console.log("Watchdog: applying direct src. readyState=" + n.readyState + " networkState=" + n.networkState);
            n.pause();
            n.innerHTML = "";
            n.removeAttribute("src");
            n.addEventListener("loadedmetadata", onMeta);
            n.addEventListener("canplay", onCanPlay);
            n.src = urlToUse;
            n.load();
        }

        // Perform warmup HEAD with status check & 429 fallback
        var warmXhr = new XMLHttpRequest();
        warmXhr.open("HEAD", newUrl, true);
        warmXhr.timeout = 3000;
        var handled = false;

        function finishWarmup(url) {
            if (handled) return;
            handled = true;
            applySource(url);
        }

        warmXhr.onreadystatechange = function () {
            if (4 !== warmXhr.readyState) return;
            console.log("Watchdog: warmup HEAD status=" + warmXhr.status);
            if (429 === warmXhr.status) {
                console.warn("Watchdog: 429 rate limit hit on CDN! Retrying with cacheable URL (without query)...");
                var cacheable = Utils.buildPlayableUrl(raw, false);
                n.dataset.useMagic = "false";
                finishWarmup(cacheable);
                return;
            }
            if (401 === warmXhr.status) {
                console.warn("Watchdog: 401 received on warmup. Re-syncing clock...");
                if (window.OdyseeAPI && typeof OdyseeAPI.syncServerTime === "function") {
                    OdyseeAPI.syncServerTime(function () {
                        var resyncedUrl = Utils.buildPlayableUrl(raw, true);
                        finishWarmup(resyncedUrl);
                    });
                    return;
                }
            }
            finishWarmup(newUrl);
        };

        warmXhr.ontimeout = warmXhr.onerror = function () {
            console.warn("Watchdog: warmup HEAD timed out/failed, applying directly");
            finishWarmup(newUrl);
        };
        warmXhr.send();

        // Safety fallback timeout: if neither fires within 8 seconds, retry with alternate mode
        reconnectStallTimer = setTimeout(function () {
            if (isRestored) return;
            console.warn("Watchdog: reconnection stalled 15s (readyState=" + n.readyState + " networkState=" + n.networkState + "). Attempting pipeline recovery...");
            cleanupListeners();
            var currentUseMagic = n.dataset.useMagic === "true";
            var nextUseMagic = !currentUseMagic;
            n.dataset.useMagic = nextUseMagic ? "true" : "false";
            var fallbackUrl = Utils.buildPlayableUrl(raw, nextUseMagic);
            console.log("Watchdog: retrying with " + (nextUseMagic ? "magic" : "cacheable (no magic)") + " -> " + fallbackUrl);

            n.pause();
            n.innerHTML = "";
            n.removeAttribute("src");
            n.addEventListener("loadedmetadata", onMeta);
            n.addEventListener("canplay", onCanPlay);
            n.src = fallbackUrl;
            n.load();
        }, 15000);
    }

    function startWatchdogDelayed() {
        var n = document.getElementById("video-player");
        if (!n) return;
        if (window._watchdogInterval) return;
        stopWatchdog();
        window._watchdogDelayTimer = setTimeout(function () {
            console.log("Watchdog: armed after 30s of stable playback");
            lastTime = n.currentTime;
            stuckCount = 0;
            window._watchdogInterval = setInterval(function () {
                try {
                    if (n.paused || n.ended || n.seeking) return;

                    // Proactive magic link pre-refresh around 280-285 seconds (before 300s expiry)
                    if (window._magicUrlStartedAt && !window._magicPrefetchDone) {
                        var elapsed = (Date.now() / 1000) - window._magicUrlStartedAt;
                        if (elapsed >= 280 && elapsed < 298) {
                            window._magicPrefetchDone = true;
                            var rawU = n.dataset.rawUrl;
                            if (rawU && window._activeClaim && window._activeClaim.claim_id) {
                                var nextMagicUrl = Utils.buildPlayableUrl(rawU, true);
                                console.log("Watchdog: proactive pre-warm of next magic link at " + Math.round(elapsed) + "s -> " + nextMagicUrl);
                                var preXhr = new XMLHttpRequest();
                                preXhr.open("HEAD", nextMagicUrl, true);
                                preXhr.timeout = 5000;
                                preXhr.onreadystatechange = function () {
                                    if (preXhr.readyState === 4) {
                                        console.log("Watchdog: proactive pre-warm status=" + preXhr.status);
                                        if (preXhr.status === 200 || preXhr.status === 308 || (preXhr.status >= 200 && preXhr.status < 400)) {
                                            console.log("Watchdog: proactive magic link pre-warmed successfully (" + preXhr.status + ")");
                                            if (window.StreamResolver && typeof StreamResolver.setCachedMagicUrl === "function") {
                                                StreamResolver.setCachedMagicUrl(window._activeClaim.claim_id, nextMagicUrl);
                                            }
                                            window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
                                            window._magicPrefetchDone = false;
                                        } else {
                                            console.warn("Watchdog: proactive pre-warm returned status " + preXhr.status + ", will retry");
                                            window._magicPrefetchDone = false;
                                        }
                                    }
                                };
                                preXhr.send();
                            }
                        }
                    }

                    var current = n.currentTime;
                    if (Math.abs(current - lastTime) < 0.1) {
                        stuckCount++;
                        if (stuckCount >= 2) {
                            console.log("Watchdog: mid-stream stall, reconnecting!");
                            var savedTime = n.currentTime || lastTime || 0;
                            reconnectStream(savedTime);
                        }
                    } else {
                        stuckCount = 0;
                        lastTime = current;
                    }
                } catch (e) { }
            }, 500);
        }, 30000);
    }

    function initPlayerUI() {
        var hideTimer,
            t = document.getElementById("player-container"),
            n = document.getElementById("video-player"),
            i = document.getElementById("btn-play-pause"),
            o = document.getElementById("player-title"),
            a = document.getElementById("progress-fill"),
            r = document.getElementById("time-display"),
            l = document.getElementById("custom-controls"),
            c = document.getElementById("player-loading");

        if (!t || !n) return;

        function showControls() {
            if (!t.classList.contains("hidden")) {
                if (l) l.classList.remove("fade-out");
                if (o) o.classList.remove("fade-out");
                clearTimeout(hideTimer);
                hideTimer = setTimeout(hideControls, 4000);
            }
        }

        function hideControls() {
            if (!n.paused) {
                if (l) l.classList.add("fade-out");
                if (o) o.classList.add("fade-out");
                setPlayerFocus(i);
            }
        }

        function getPlayerFocusedButton() {
            var el = document.querySelector(".btn-player-reaction.focused, .btn-player-comments.focused, .btn-play-pause.focused");
            return el || i;
        }

        function setPlayerFocus(targetEl) {
            if (!targetEl) return;
            var prevFocused = document.querySelectorAll("#player-container .focused");
            for (var pf = 0; pf < prevFocused.length; pf++) {
                prevFocused[pf].classList.remove("focused");
            }
            targetEl.classList.add("focused");
            if (window.SpatialNavigation && typeof SpatialNavigation.focusNode === "function") {
                SpatialNavigation.focusNode(targetEl);
            }
        }

        var btnCommentsEl = document.getElementById("btn-comments");
        if (btnCommentsEl) {
            btnCommentsEl.onclick = function (evt) {
                if (evt) evt.stopPropagation();
                var c = window._activeClaim;
                if (c && c.claim_id) {
                    openCommentsSidebar(c.claim_id);
                }
            };
        }

        function doSeek(direction) {
            try {
                var dur = n.duration;
                var dFallback = parseFloat(n.getAttribute("data-duration")) || 0;
                if (!dur || isNaN(dur) || dur === Infinity) dur = dFallback;

                var maxDur = dur > 0 ? dur : (n.currentTime + direction + 100);
                var target = Math.max(0, Math.min(maxDur, n.currentTime + direction));

                // Directly assign to the video element's currentTime property
                n.currentTime = target;

                if (a) {
                    a.classList.add("seeking");
                    a.style.backgroundImage = "none";
                    if (dur > 0) a.style.width = (target / dur * 100) + "%";
                }
                if (r && dur > 0) {
                    r.textContent = Utils.formatDuration(target, dur) + " / " + Utils.formatDuration(dur, dur);
                }

                if (window._seekStyleTimer) clearTimeout(window._seekStyleTimer);
                window._seekStyleTimer = setTimeout(function () {
                    if (a) {
                        a.classList.remove("seeking");
                        a.style.backgroundImage = "";
                    }
                }, 500);
            } catch (err) {
                console.error("Direct seek failed: " + err);
                if (a) {
                    a.classList.remove("seeking");
                    a.style.backgroundImage = "";
                }
            }
        }

        window.addEventListener("keydown", function (e) {
            if (!t.classList.contains("hidden")) {
                e.stopPropagation();
                var keyCode = e.keyCode;

                // --- Modal Navigation for Comments Sidebar ---
                if (isCommentsOpen) {
                    // Dedicated Hardware Media Keys continue to control video playback
                    if (415 === keyCode || 19 === keyCode || 179 === keyCode) {
                        e.preventDefault();
                        if (i) i.click();
                        return;
                    }
                    if (412 === keyCode || 417 === keyCode) {
                        e.preventDefault();
                        doSeek(412 === keyCode ? -10 : 10);
                        return;
                    }
                    if (413 === keyCode) {
                        e.preventDefault();
                        closePlayer();
                        return;
                    }

                    // Back button closes ONLY the comments sidebar via history.back()
                    if (461 === keyCode || 8 === keyCode || 27 === keyCode || 10009 === keyCode) {
                        e.preventDefault();
                        e.stopPropagation();
                        history.back();
                        return;
                    }

                    // D-pad UP / DOWN scrolls the comments list
                    if (38 === keyCode) {
                        e.preventDefault();
                        var listEl = document.getElementById("comments-list");
                        if (listEl) listEl.scrollTop -= 120;
                        return;
                    }
                    if (40 === keyCode) {
                        e.preventDefault();
                        var listEl = document.getElementById("comments-list");
                        if (listEl) listEl.scrollTop += 120;
                        return;
                    }

                    // D-pad LEFT, RIGHT, OK and other keys are absorbed in comments sidebar (video won't seek or pause)
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }

                // --- Normal Player Controls Navigation ---
                var wasHidden = l && l.classList.contains("fade-out");
                showControls();

                if (wasHidden) {
                    e.preventDefault();
                    setPlayerFocus(i);
                    return;
                }

                var btnLike = document.getElementById("btn-like");
                var btnDislike = document.getElementById("btn-dislike");
                var btnComments = document.getElementById("btn-comments");
                var focusedBtn = getPlayerFocusedButton();

                // 1. Dedicated Media Play / Pause keys
                if (415 === keyCode || 19 === keyCode || 179 === keyCode) {
                    e.preventDefault();
                    if (i) i.click();
                    return;
                }

                // 2. Dedicated Media Rewind / Fast Forward keys
                if (412 === keyCode || 417 === keyCode) {
                    e.preventDefault();
                    doSeek(412 === keyCode ? -10 : 10);
                    return;
                }

                // 3. OK / Enter key (13)
                if (13 === keyCode) {
                    e.preventDefault();
                    if (focusedBtn === btnComments || (focusedBtn && focusedBtn.id === "btn-comments")) {
                        var cClaim = window._activeClaim;
                        if (cClaim && cClaim.claim_id) openCommentsSidebar(cClaim.claim_id);
                    } else if (focusedBtn) {
                        focusedBtn.click();
                    } else if (i) {
                        i.click();
                    }
                    return;
                }

                // 4. UP Arrow (38)
                if (38 === keyCode) {
                    e.preventDefault();
                    if (focusedBtn === i) {
                        // From play/pause (bottom), move UP to comments first
                        if (btnComments) {
                            setPlayerFocus(btnComments);
                        } else if (btnLike) {
                            setPlayerFocus(btnLike);
                        }
                    } else if (focusedBtn === btnComments) {
                        // From comments, move UP to reactions row
                        if (btnDislike) {
                            setPlayerFocus(btnDislike);
                        } else if (btnLike) {
                            setPlayerFocus(btnLike);
                        }
                    }
                    return;
                }

                // 5. DOWN Arrow (40)
                if (40 === keyCode) {
                    e.preventDefault();
                    if (focusedBtn === btnLike || focusedBtn === btnDislike) {
                        // From reactions, move DOWN to comments row before play/pause
                        if (btnComments) {
                            setPlayerFocus(btnComments);
                        } else {
                            setPlayerFocus(i);
                        }
                    } else if (focusedBtn === btnComments) {
                        // From comments, move DOWN to play/pause
                        setPlayerFocus(i);
                    }
                    return;
                }

                // 6. LEFT Arrow (37)
                if (37 === keyCode) {
                    e.preventDefault();
                    if (focusedBtn === btnComments) {
                        if (btnDislike) {
                            setPlayerFocus(btnDislike);
                        } else if (btnLike) {
                            setPlayerFocus(btnLike);
                        } else {
                            setPlayerFocus(i);
                        }
                    } else if (focusedBtn === btnDislike && btnLike) {
                        setPlayerFocus(btnLike);
                    } else if (focusedBtn === btnLike) {
                        // Leftmost button on top bar, stay on it
                    } else {
                        // On play-pause or default: seek backward 10s
                        doSeek(-10);
                    }
                    return;
                }

                // 7. RIGHT Arrow (39)
                if (39 === keyCode) {
                    e.preventDefault();
                    if (focusedBtn === btnLike) {
                        if (btnDislike) {
                            setPlayerFocus(btnDislike);
                        } else if (btnComments) {
                            setPlayerFocus(btnComments);
                        }
                    } else if (focusedBtn === btnDislike) {
                        if (btnComments) {
                            setPlayerFocus(btnComments);
                        }
                    } else if (focusedBtn === btnComments) {
                        // Rightmost button on top bar, stay on it
                    } else {
                        // On play-pause or default: seek forward 10s
                        doSeek(10);
                    }
                    return;
                }

                // 8. Stop / Back keys
                if (413 === keyCode) {
                    e.preventDefault();
                    history.back();
                } else if (461 !== keyCode && 8 !== keyCode && 27 !== keyCode && 10009 !== keyCode) {
                    // other keys
                } else {
                    e.preventDefault();
                    history.back();
                }
            }
        }, true);

        if (i) {
            i.addEventListener("click", function () {
                window._userAction = true;
                if (n.paused) {
                    n.play();
                    i.innerHTML = "\u275A\u275A";
                } else {
                    n.pause();
                    i.innerHTML = "\u25B6";
                    showControls();
                }
            });
        }

        n.addEventListener("play", function () {
            if (i) i.innerHTML = "\u275A\u275A";
            showControls();
            if (window._userAction) {
                stopWatchdog();
                window._userAction = false;
            }
        });

        n.addEventListener("pause", function () {
            if (i) i.innerHTML = "\u25B6";
            showControls();
            if (window._userAction) {
                stopWatchdog();
                window._userAction = false;
            }
        });

        n.addEventListener("waiting", function () {
            if (c) c.style.display = "block";
            rebuf_start = Date.now();
            rebuf_count++;
        });

        n.addEventListener("seeking", function () {
            if (c) c.style.display = "block";
            stopWatchdog();
        });

        n.addEventListener("seeked", function () {
            if (c) c.style.display = "none";
        });

        n.addEventListener("playing", function () {
            if (c) c.style.display = "none";
            startWatchdogDelayed();
            if (rebuf_start > 0) {
                rebuf_duration += Date.now() - rebuf_start;
                rebuf_start = 0;
            }
        });

        n.addEventListener("canplay", function () {
            if (c) c.style.display = "none";
            var errEl = document.getElementById("player-error");
            if (errEl) errEl.style.display = "none";
            clearStall();
            console.log("Can play. Player selected: " + (n.currentSrc || "(unknown)"));
        });

        n.addEventListener("error", function () {
            if (!isPlayerActive || (t && t.classList.contains("hidden"))) {
                return;
            }
            var cur = n.currentTime || 0;
            var errCode = n.error ? n.error.code : "unknown";
            console.error("Video error event: code=" + errCode + " on " + (n.currentSrc || ""));
            if (cur > 5 && !n.seeking && window._pendingSeekTime === undefined) {
                console.log("Watchdog: mid-stream error event at " + cur.toFixed(2) + "s -> instant reconnect!");
                reconnectStream(cur);
            } else {
                if (c) c.style.display = "none";
            }
        });

        n.addEventListener("ended", function () {
            stopWatchdog();
            var cur = n.currentTime || 0,
                dur = n.duration,
                dFallback = parseFloat(n.getAttribute("data-duration")) || 0;
            if (!dur || isNaN(dur) || dur === Infinity) dur = dFallback;

            if (dur > 0 && (dur - cur) > 5) {
                console.log("Premature end detected (" + cur + " / " + dur + "). Auto-reconnecting...");
                reconnectStream(cur);
                return;
            }
            var rel = dur > 0 ? (cur / dur * 100) : 0;
            if (window.OdyseeAPI && typeof OdyseeAPI.reportWatchmanPlayback === "function") {
                OdyseeAPI.reportWatchmanPlayback(n.currentSrc || "", dur, cur, rel, rebuf_count, rebuf_duration);
            }

            var cClaim = window._activeClaim;
            if (cClaim && cClaim.claim_id && window.OdyseeAPI && typeof OdyseeAPI.saveResumePoint === "function") {
                OdyseeAPI.saveResumePoint(cClaim.claim_id, 0, dur);
            }

            closePlayer();
        });

        n.addEventListener("timeupdate", function () {
            try {
                if (a && a.classList.contains("seeking")) return;
                var cur = n.currentTime || 0,
                    dur = n.duration,
                    dFallback = parseFloat(n.getAttribute("data-duration")) || 0;
                if (!dur || isNaN(dur) || dur === Infinity) dur = dFallback;
                var pct = 0;
                if (dur && !isNaN(dur) && dur > 0) pct = (cur / dur * 100);
                if (a) a.style.width = pct + "%";
                if (r) r.textContent = Utils.formatDuration(cur, dur) + " / " + Utils.formatDuration(dur, dur);

                var now = Date.now();
                if (now - last_progress_report >= 10000) {
                    last_progress_report = now;
                    var cClaim = window._activeClaim;
                    if (cClaim && cClaim.claim_id) {
                        if (window.OdyseeAPI && typeof OdyseeAPI.saveViewProgress === "function") {
                            var uri = cClaim.canonical_url || cClaim.permanent_url || cClaim.short_url || "";
                            OdyseeAPI.saveViewProgress(cClaim.claim_id, uri, cur);
                        }
                        if (window.OdyseeAPI && typeof OdyseeAPI.saveResumePoint === "function") {
                            OdyseeAPI.saveResumePoint(cClaim.claim_id, cur, dur);
                        }
                    }
                }
            } catch (err) { }
        });
    }

    return {
        playVideo: function (claim) {
            window._activeClaim = claim;
            playVideo(claim);
        },
        close: closePlayer,
        stopWatchdog: stopWatchdog,
        initUI: initPlayerUI,
        isCommentsOpen: function () {
            return isCommentsOpen;
        },
        closeComments: function () {
            closeCommentsSidebar();
            var btnCommentsReFocus = document.getElementById("btn-comments");
            if (btnCommentsReFocus) {
                var pf = document.querySelectorAll("#player-container .focused");
                for (var p = 0; p < pf.length; p++) pf[p].classList.remove("focused");
                btnCommentsReFocus.classList.add("focused");
                if (window.SpatialNavigation && typeof SpatialNavigation.focusNode === "function") {
                    SpatialNavigation.focusNode(btnCommentsReFocus);
                }
            }
        }
    };
})();

// Global backwards-compatibility aliases
var playVideo = Player.playVideo;
var closePlayer = Player.close;
window.stopWatchdog = Player.stopWatchdog;
