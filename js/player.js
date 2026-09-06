// ---------------------------------------------------------------------------
// Video player core coordinator, playback engine & lifecycle
// (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var Player = (function () {
    var PREFER_HLS = true;
    var MIME_HLS = 'application/vnd.apple.mpegurl';
    var MIME_MP4 = 'video/mp4';

    var rebufCount = 0;
    var rebufStart = 0;
    var rebufDuration = 0;
    var lastProgressReport = 0;
    var isPlayerActive = false;
    var targetResumeTime = 0;
    var resumeSeekDone = false;
    var videoDuration = 0;

    function setSources(video, list) {
        var k;
        var s;

        video.innerHTML = '';
        for (k = 0; k < list.length; k++) {
            s = document.createElement('source');
            s.src = list[k].url;
            s.type = list[k].type;
            video.appendChild(s);
        }
    }

    function showResumeNotice(sec) {
        var notice = document.getElementById('resume-notice');
        var cc;

        if (!notice) {
            notice = document.createElement('div');
            notice.id = 'resume-notice';
            notice.className = 'resume-notice';
            cc = document.getElementById('custom-controls');
            if (cc) {
                cc.appendChild(notice);
            }
        }
        if (notice) {
            notice.textContent = '\u25B6 Resume: ' + Utils.formatDuration(sec, 0);
            notice.style.display = 'block';
            setTimeout(function () {
                notice.style.display = 'none';
            }, 3500);
        }
    }

    function closePlayer() {
        var containerEl;
        var videoEl;
        var rel;
        var cClaim;
        var curClose;
        var targetCard;
        var focusableEls;
        var activeIdx;
        var o;
        var aEl;

        isPlayerActive = false;
        if (typeof PlayerComments !== 'undefined') {
            PlayerComments.close();
        }
        SpatialNavigation.unlock();

        if (typeof PlayerShelf !== 'undefined') {
            PlayerShelf.hide();
        }

        aEl = document.getElementById('progress-fill');
        if (aEl) {
            aEl.classList.remove('seeking');
            aEl.style.backgroundImage = '';
        }
        if (window._seekStyleTimer) {
            clearTimeout(window._seekStyleTimer);
        }

        if (typeof PlayerWatchdog !== 'undefined') {
            PlayerWatchdog.stop();
        }

        containerEl = document.getElementById('player-container');
        videoEl = document.getElementById('video-player');

        if (!videoEl) {
            return;
        }
        videoEl.style.opacity = '1';

        cClaim = window._activeClaim;
        // Send watchman report on close if we have played something
        if (!videoEl.paused || videoEl.currentTime > 0) {
            rel = videoDuration > 0 ? (videoEl.currentTime / videoDuration * 100) : 0;
            StreamResolver.reportWatchmanPlayback(videoEl.currentSrc || '', videoDuration, videoEl.currentTime, rel, rebufCount, rebufDuration);
        }
        rebufCount = 0;
        rebufStart = 0;
        rebufDuration = 0;

        if (cClaim && cClaim.claim_id && videoEl) {
            curClose = videoEl.currentTime || 0;
            if (!videoEl.ended && curClose > 10 && videoDuration > 0 && (videoDuration - curClose > 5) && (resumeSeekDone || targetResumeTime <= 0)) {
                UserData.saveResumePoint(cClaim.claim_id, curClose, videoDuration, false);
            }
            if (typeof Feed !== 'undefined' && Feed.updateCardProgress) {
                Feed.updateCardProgress(cClaim.claim_id);
            }
        }
        videoDuration = 0;

        videoEl.pause();
        videoEl.onerror = null;
        videoEl.innerHTML = '';
        videoEl.src = '';
        if (containerEl) {
            containerEl.classList.add('hidden');
        }
        SpatialNavigation.refresh();

        targetCard = window.isChannelPageOpen ? window.lastFocusedChannelCard : window.lastFocusedCard;
        if (targetCard) {
            focusableEls = document.querySelectorAll('.focusable');
            activeIdx = 0;
            for (o = 0; o < focusableEls.length; o++) {
                if (focusableEls[o].offsetParent !== null) {
                    if (focusableEls[o] === targetCard) {
                        SpatialNavigation.focusElement(activeIdx);
                        break;
                    }
                    activeIdx += 1;
                }
            }
        }
    }

    function playVideo(claim) {
        var playerContainerEl = document.getElementById('player-container');
        var videoEl = document.getElementById('video-player');
        var loadingEl = document.getElementById('player-loading');
        var titleEl = document.getElementById('player-title');
        var playerError = document.getElementById('player-error');
        var currentClaim = claim;
        var hadHls = false;
        var triedMp4 = false;
        var playReason = '';
        var resumePoint;
        var uploadDate = '';
        var clockSvg;
        var metaDateEl;
        var metaViewsEl;
        var metaReactionsEl;
        var timeDisplayEl;

        window._activeClaim = claim;
        videoDuration = (claim.value && claim.value.video ? claim.value.video.duration : 0) || 0;

        resumePoint = UserData.getResumePoint(claim.claim_id);
        targetResumeTime = (resumePoint && !resumePoint.completed && resumePoint.time > 10 && (!resumePoint.duration || resumePoint.time < resumePoint.duration - 15)) ?
            resumePoint.time : 0;
        resumeSeekDone = false;

        function handleMediaError(code, url) {
            var cur;
            var magicOn;
            var msgMap;
            var msg;
            var mp4;
            var q;

            if (!isPlayerActive || (playerContainerEl && playerContainerEl.classList.contains('hidden'))) {
                return;
            }
            if (typeof PlayerWatchdog !== 'undefined') {
                PlayerWatchdog.clearStall();
            }
            cur = videoEl ? (videoEl.currentTime || 0) : 0;
            if (cur > 5 && !videoEl.seeking && window._pendingSeekTime === undefined) {
                console.log('Watchdog: mid-stream media error (' + code + ') at ' + cur.toFixed(2) + 's -> instant reconnect!');
                if (typeof PlayerWatchdog !== 'undefined') {
                    PlayerWatchdog.reconnect(cur);
                }
                return;
            }
            magicOn = url.indexOf('magic=') !== -1;
            msgMap = {
                1: 'Aborted (MEDIA_ERR_ABORTED).',
                2: 'Network error (MEDIA_ERR_NETWORK).',
                3: 'Decode error (MEDIA_ERR_DECODE) - unsupported codec.',
                4: 'Unsupported source (MEDIA_ERR_SRC_NOT_SUPPORTED).'
            };
            msg = msgMap[code] || ('Unknown media error (' + code + ').');
            console.error('Video error ' + code + ': ' + msg);
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }

            if (code === 3 || code === 4) {
                if (!triedMp4 && url.indexOf('/v6/streams/') === -1) {
                    mp4 = StreamResolver.buildMp4Url(currentClaim);
                    if (mp4) {
                        triedMp4 = true;
                        resumeSeekDone = false;
                        playReason = 'raw mp4 fallback (previous source error code: ' + code + ')';
                        console.log('FALLBACK REASON: ' + (hadHls ? 'HLS' : 'v4') +
                            ' source failed with error ' + code + ' -> raw mp4: ' + mp4);
                        if (playerError) {
                            playerError.textContent = (hadHls ? 'HLS is not playable' : 'This source is not playable') +
                                ', trying raw mp4...';
                            playerError.style.display = 'block';
                        }
                        if (loadingEl) {
                            loadingEl.style.display = 'block';
                        }
                        r(Utils.buildPlayableUrl(mp4, magicOn));
                        return;
                    }
                }

                if (hadHls) {
                    if (playerError) {
                        playerError.textContent = 'Cannot start the video this time, please try again later.';
                        playerError.style.display = 'block';
                    }
                } else {
                    if (playerError) {
                        playerError.textContent = 'Cannot start the video this time, please try again later. Transcoding requested.';
                        playerError.style.display = 'block';
                    }
                    q = new XMLHttpRequest();
                    q.open('GET', 'https://transcoder.odysee.com/api/v1/transcode/' + claim.claim_id, true);
                    q.send();
                }
            } else if (playerError) {
                playerError.textContent = 'Cannot start the video this time, please try again later.';
                playerError.style.display = 'block';
            }
        }

        function r(url, extra) {
            var p;

            isPlayerActive = true;
            console.log('PLAYBACK STARTING [' + (playReason || 'primary') + ']');
            if (typeof PlayerWatchdog !== 'undefined') {
                PlayerWatchdog.armStall(url, function (rs, stallUrl) {
                    handleMediaError(4, stallUrl);
                });
            }
            videoEl.onerror = null;
            setSources(videoEl, (extra ? [extra] : []).concat([{
                url: url,
                type: url.indexOf('.m3u8') !== -1 ? MIME_HLS : MIME_MP4
            }]));
            videoEl.volume = 1;
            videoEl.muted = false;
            videoEl.onerror = function () {
                if (!isPlayerActive) {
                    return;
                }
                handleMediaError(videoEl.error ? videoEl.error.code : 0, url);
            };

            if (targetResumeTime > 0 && !resumeSeekDone) {
                var applyResumeSeek = function () {
                    if (resumeSeekDone || targetResumeTime <= 0) {
                        return;
                    }
                    try {
                        videoEl.currentTime = targetResumeTime;
                        console.log('Resuming playback from ' + targetResumeTime + 's');
                        showResumeNotice(targetResumeTime);
                    } catch (err) {
                        console.error('Resume seek error:', err);
                    }
                };
                var onSeekComplete = function () {
                    if (videoEl.currentTime >= targetResumeTime - 2) {
                        resumeSeekDone = true;
                        videoEl.removeEventListener('seeked', onSeekComplete);
                        videoEl.removeEventListener('loadedmetadata', applyResumeSeek);
                        videoEl.removeEventListener('canplay', applyResumeSeek);
                    }
                };
                videoEl.addEventListener('loadedmetadata', applyResumeSeek);
                videoEl.addEventListener('canplay', applyResumeSeek);
                videoEl.addEventListener('seeked', onSeekComplete);
            }

            videoEl.load();
            p = videoEl.play();
            if (p && typeof p.catch === 'function') {
                p.catch(function (err) {
                    console.error('Play error:', err);
                });
            }
        }

        function startVideoWithWarmup(rawUrl) {
            var retries = 0;
            var maxRetries = 6;
            var useMagic = false;
            var cachedMagicUrl;
            var cachedHls;

            cachedMagicUrl = StreamResolver.getCachedMagicUrl(currentClaim.claim_id);
            if (cachedMagicUrl) {
                console.log('StreamResolver: starting immediately with cached magic URL: ' + cachedMagicUrl);
                videoEl.dataset.rawUrl = rawUrl;
                videoEl.dataset.useMagic = 'true';
                window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
                window._magicPrefetchDone = false;
                cachedHls = PREFER_HLS ? StreamResolver.buildHlsUrl(currentClaim) : null;
                if (cachedHls) {
                    hadHls = true;
                    playReason = 'cached magic (HLS + mp4 fallback)';
                    r(cachedMagicUrl, {
                        url: cachedHls,
                        type: MIME_HLS
                    });
                    return;
                }
                playReason = 'cached magic (mp4)';
                r(cachedMagicUrl);
                return;
            }

            function fail(msg) {
                console.error(msg);
                if (loadingEl) {
                    loadingEl.style.display = 'none';
                }
                if (playerError) {
                    playerError.textContent = 'Cannot start the video this time, please try again later.';
                    playerError.style.display = 'block';
                }
                if (titleEl) {
                    titleEl.textContent = claim.value.title || 'Unknown Title';
                }
            }

            function warm() {
                var url = Utils.buildPlayableUrl(rawUrl, useMagic);
                var xhr = new XMLHttpRequest();

                xhr.open('HEAD', url, true);
                xhr.timeout = 15000;
                xhr.onreadystatechange = function () {
                    var s;
                    var cache;
                    var hls;

                    if (xhr.readyState !== 4) {
                        return;
                    }
                    s = xhr.status;
                    cache = '';
                    try {
                        cache = xhr.getResponseHeader('X-77-Cache') || '';
                    } catch (err) { }
                    console.log('Warmup ' + s + (cache ? ' cache=' + cache : '') +
                        (useMagic ? ' [magic]' : ' [query nelkul]') + ' r=' + retries);

                    if (s === 429) {
                        fail('429: rate limit. Request bypassing CDN cache hit origin. Wait a few minutes.');
                        return;
                    }
                    if (s === 401 && !useMagic) {
                        console.log('401 without query -> trying with magic (warning: cache MISS)');
                        useMagic = true;
                        warm();
                        return;
                    }
                    if (s === 401) {
                        fail('401: hotlink protection blocked access even with magic.');
                        return;
                    }
                    if (s === 404) {
                        fail('404: stream not found.');
                        return;
                    }

                    if ((s === 200 || s === 308) && useMagic) {
                        StreamResolver.setCachedMagicUrl(currentClaim.claim_id, url);
                        window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
                        window._magicPrefetchDone = false;
                    }

                    if (s === 308 && PREFER_HLS) {
                        hls = StreamResolver.buildHlsUrl(currentClaim);
                        if (hls) {
                            hadHls = true;
                            playReason = 'HLS + mp4 fallback, explicit type';
                            videoEl.dataset.rawUrl = rawUrl;
                            videoEl.dataset.useMagic = useMagic ? 'true' : 'false';
                            if (useMagic) {
                                window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
                                window._magicPrefetchDone = false;
                            }
                            r(url, {
                                url: hls,
                                type: MIME_HLS
                            });
                            return;
                        }
                    }
                    if ((s === 503 || s === 0 || s >= 500) && retries < maxRetries) {
                        retries += 1;
                        setTimeout(warm, 3000);
                        return;
                    }
                    playReason = useMagic ? 'original mp4, with magic' : 'original mp4, without query (cacheable)';
                    videoEl.dataset.rawUrl = rawUrl;
                    videoEl.dataset.useMagic = useMagic ? 'true' : 'false';
                    if (useMagic) {
                        window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
                        window._magicPrefetchDone = false;
                    }
                    r(url);
                };
                xhr.ontimeout = function () {
                    if (retries < maxRetries) {
                        retries += 1;
                        setTimeout(warm, 3000);
                    } else {
                        videoEl.dataset.rawUrl = rawUrl;
                        videoEl.dataset.useMagic = useMagic ? 'true' : 'false';
                        if (useMagic) {
                            window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
                            window._magicPrefetchDone = false;
                        }
                        r(url);
                    }
                };
                xhr.onerror = function () {
                    if (retries < maxRetries) {
                        retries += 1;
                        setTimeout(warm, 3000);
                    } else {
                        videoEl.dataset.rawUrl = rawUrl;
                        videoEl.dataset.useMagic = useMagic ? 'true' : 'false';
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

        // Meta info display (date, views, reactions)
        if (claim.meta && claim.meta.creation_timestamp) {
            uploadDate = new Date(claim.meta.creation_timestamp * 1000).toLocaleDateString();
        } else if (claim.value && claim.value.release_time) {
            uploadDate = new Date(claim.value.release_time * 1000).toLocaleDateString();
        }

        clockSvg = Icons.get('clock');
        metaDateEl = document.getElementById('meta-date');
        if (metaDateEl) {
            metaDateEl.innerHTML = uploadDate ? clockSvg + uploadDate : '';
        }

        metaViewsEl = document.getElementById('meta-views');
        if (metaViewsEl) {
            metaViewsEl.innerHTML = '';
        }

        metaReactionsEl = document.getElementById('meta-reactions');
        if (metaReactionsEl) {
            metaReactionsEl.innerHTML = '';
        }

        timeDisplayEl = document.getElementById('time-display');
        if (timeDisplayEl) {
            timeDisplayEl.textContent = '00:00 / 00:00';
        }

        if (claim && claim.claim_id) {
            UserData.getViewCount(claim.claim_id, function (err, views) {
                var eyeSvg;

                if (!err && typeof views === 'number' && metaViewsEl) {
                    eyeSvg = Icons.get('eye');
                    metaViewsEl.innerHTML = eyeSvg + Utils.formatViewCount(views);
                }
            });

            Comments.list(claim.claim_id, 1, function (err, res) {
                var btnComments;
                var countComments;
                var iconComments;

                if (!err && res && typeof res.total_items === 'number') {
                    btnComments = document.getElementById('btn-comments');
                    countComments = document.getElementById('comments-count');
                    iconComments = document.getElementById('icon-comments');
                    if (iconComments) {
                        iconComments.innerHTML = Icons.get('comments');
                    }
                    if (countComments) {
                        countComments.textContent = res.total_items;
                    }
                    if (btnComments) {
                        btnComments.style.display = 'inline-flex';
                    }
                }
            });

            if (claim._cached_reactions) {
                if (typeof PlayerControls !== 'undefined') {
                    PlayerControls.renderReactions(claim, claim._cached_reactions.like, claim._cached_reactions.dislike, claim._cached_reactions.myReaction);
                }
            } else {
                UserData.getReactions(claim.claim_id, function (err, reactions) {
                    if (!err && reactions) {
                        claim._cached_reactions = reactions;
                        if (typeof PlayerControls !== 'undefined') {
                            PlayerControls.renderReactions(claim, reactions.like, reactions.dislike, reactions.myReaction);
                        }
                    }
                });
            }
        }

        isPlayerActive = false;
        window._magicPrefetchDone = false;
        if (playerError) {
            playerError.style.display = 'none';
        }
        videoEl.innerHTML = '';
        videoEl.removeAttribute('src');
        videoEl.src = '';
        if (titleEl) {
            titleEl.textContent = claim.value.title || 'Unknown Title';
        }

        if (typeof PlayerShelf !== 'undefined') {
            PlayerShelf.updateHeader(claim);
            PlayerShelf.load(claim);
        }

        SpatialNavigation.lock();
        if (playerContainerEl) {
            playerContainerEl.classList.remove('hidden');
        }
        if (loadingEl) {
            loadingEl.style.display = 'block';
        }
        if (typeof PlayerControls !== 'undefined') {
            PlayerControls.show(4000);
        }

        StreamResolver.getStreamingSourceUrl(claim, function (tErr, url) {
            if (tErr || !url) {
                console.error('Failed to get streaming URL: ' + (tErr ? tErr.message : 'empty url'));
                if (loadingEl) {
                    loadingEl.style.display = 'none';
                }
                if (playerError) {
                    playerError.textContent = 'Cannot load stream source.';
                    playerError.style.display = 'block';
                }
                return;
            }
            startVideoWithWarmup(url);
        });

        setTimeout(function () {
            var playPauseBtn = document.getElementById('btn-play-pause');
            if (playPauseBtn && typeof PlayerControls !== 'undefined') {
                PlayerControls.setFocus(playPauseBtn);
            }
        }, 100);
    }

    function initPlayerUI() {
        var videoEl = document.getElementById('video-player');
        var playPauseBtn = document.getElementById('btn-play-pause');
        var loadingEl = document.getElementById('player-loading');
        var progressFillEl = document.getElementById('progress-fill');
        var timeDisplayEl = document.getElementById('time-display');

        if (!videoEl) {
            return;
        }

        if (typeof PlayerControls !== 'undefined') {
            PlayerControls.init();
        }

        videoEl.addEventListener('play', function () {
            if (playPauseBtn) {
                playPauseBtn.innerHTML = '\u275A\u275A';
            }
            if (typeof PlayerWatchdog !== 'undefined') {
                PlayerWatchdog.startDelayed();
            }
            if (typeof PlayerControls !== 'undefined') {
                PlayerControls.scheduleHide();
            }
        });

        videoEl.addEventListener('pause', function () {
            if (playPauseBtn) {
                playPauseBtn.innerHTML = '\u25B6';
            }
            if (typeof PlayerControls !== 'undefined') {
                PlayerControls.show();
            }
        });

        videoEl.addEventListener('waiting', function () {
            if (loadingEl) {
                loadingEl.style.display = 'block';
            }
            if (!rebufStart) {
                rebufStart = Date.now();
            }
        });

        videoEl.addEventListener('seeking', function () {
            if (loadingEl) {
                loadingEl.style.display = 'block';
            }
        });

        videoEl.addEventListener('seeked', function () {
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
        });

        videoEl.addEventListener('playing', function () {
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
            if (typeof PlayerWatchdog !== 'undefined') {
                PlayerWatchdog.clearStall();
            }
            if (rebufStart) {
                rebufCount += 1;
                rebufDuration += (Date.now() - rebufStart);
                rebufStart = 0;
            }
        });

        videoEl.addEventListener('canplay', function () {
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
            if (typeof PlayerWatchdog !== 'undefined') {
                PlayerWatchdog.clearStall();
            }
        });

        videoEl.addEventListener('loadedmetadata', function () {
            if (videoDuration === 0 && videoEl.duration && !isNaN(videoEl.duration) && videoEl.duration !== Infinity) {
                videoDuration = videoEl.duration;
            }
        });

        videoEl.addEventListener('error', function () {
            var cur = videoEl.currentTime || 0;
            if (cur > 5 && !videoEl.seeking && window._pendingSeekTime === undefined) {
                if (typeof PlayerWatchdog !== 'undefined') {
                    if (!PlayerWatchdog.isReconnecting()) {
                        console.log('Watchdog: mid-stream error event at ' + cur.toFixed(2) + 's -> instant reconnect!');
                        PlayerWatchdog.reconnect(cur);
                    }
                }
            } else if (loadingEl) {
                loadingEl.style.display = 'none';
            }
        });

        videoEl.addEventListener('ended', function () {
            var cur;
            var rel;
            var cClaim;

            if (typeof PlayerWatchdog !== 'undefined') {
                PlayerWatchdog.stop();
            }
            cClaim = window._activeClaim;
            cur = videoEl.currentTime || 0;

            if (videoDuration > 0 && (videoDuration - cur) > 5) {
                console.log('Premature end detected (' + cur + ' / ' + videoDuration + '). Auto-reconnecting...');
                if (typeof PlayerWatchdog !== 'undefined') {
                    PlayerWatchdog.reconnect(cur);
                }
                return;
            }
            rel = videoDuration > 0 ? (cur / videoDuration * 100) : 0;
            StreamResolver.reportWatchmanPlayback(videoEl.currentSrc || '', videoDuration, cur, rel, rebufCount, rebufDuration);

            if (cClaim && cClaim.claim_id) {
                UserData.saveResumePoint(cClaim.claim_id, videoDuration, videoDuration, true);
                if (typeof Feed !== 'undefined' && Feed.updateCardProgress) {
                    Feed.updateCardProgress(cClaim.claim_id);
                }
            }

            closePlayer();
        });

        videoEl.addEventListener('timeupdate', function () {
            var cur;
            var pct;
            var now;
            var cClaim;
            var uri;

            try {
                if (progressFillEl && progressFillEl.classList.contains('seeking')) {
                    return;
                }
                cClaim = window._activeClaim;
                cur = videoEl.currentTime || 0;
                pct = 0;
                if (videoDuration > 0) {
                    pct = (cur / videoDuration * 100);
                }
                if (progressFillEl) {
                    progressFillEl.style.width = pct + '%';
                }
                if (timeDisplayEl) {
                    timeDisplayEl.textContent = Utils.formatDuration(cur, videoDuration) + ' / ' + Utils.formatDuration(videoDuration, videoDuration);
                }

                now = Date.now();
                if (now - lastProgressReport >= 10000) {
                    lastProgressReport = now;
                    if (cClaim && cClaim.claim_id) {
                        uri = cClaim.canonical_url || cClaim.permanent_url || cClaim.short_url || '';
                        UserData.saveViewProgress(cClaim.claim_id, uri, cur);
                        if (cur > 10 && videoDuration > 0 && (videoDuration - cur > 5) && (resumeSeekDone || targetResumeTime <= 0)) {
                            UserData.saveResumePoint(cClaim.claim_id, cur, videoDuration, false);
                            if (typeof Feed !== 'undefined' && Feed.updateCardProgress) {
                                Feed.updateCardProgress(cClaim.claim_id);
                            }
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
        stopWatchdog: function () {
            if (typeof PlayerWatchdog !== 'undefined') {
                PlayerWatchdog.stop();
            }
        },
        initUI: initPlayerUI,
        isCommentsOpen: function () {
            return (typeof PlayerComments !== 'undefined') ? PlayerComments.isOpen() : false;
        },
        closeComments: function () {
            if (typeof PlayerComments !== 'undefined') {
                PlayerComments.close();
            }
        },
        getVideoDuration: function () {
            return videoDuration;
        },
        getTargetResumeTime: function () {
            return targetResumeTime;
        },
        isResumeSeekDone: function () {
            return resumeSeekDone;
        },
        isPlayerActive: function () {
            return isPlayerActive;
        }
    };
}());
