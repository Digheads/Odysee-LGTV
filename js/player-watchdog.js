// ---------------------------------------------------------------------------
// Player Stream Watchdog, Stall Detection & Auto-Reconnection
// (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var PlayerWatchdog = (function () {
    var stallTimer = null;
    var reconnectStallTimer = null;
    var lastTime = 0;
    var stuckCount = 0;
    var isReconnecting = false;

    function clearStall() {
        if (stallTimer) {
            clearTimeout(stallTimer);
            stallTimer = null;
        }
    }

    function clearReconnectStall() {
        if (reconnectStallTimer) {
            clearTimeout(reconnectStallTimer);
            reconnectStallTimer = null;
        }
    }

    function armStall(url, onStallCallback) {
        clearStall();
        stallTimer = setTimeout(function () {
            var videoEl = document.getElementById('video-player');
            var rs;

            stallTimer = null;
            if (!videoEl || videoEl.readyState >= 3) {
                return;
            }
            rs = videoEl.readyState;
            console.error('Watchdog: playback did not start within 20s (readyState=' + rs + ')');
            if (typeof onStallCallback === 'function') {
                onStallCallback(rs, url);
            }
        }, 20000);
    }

    function stop() {
        if (window._watchdogDelayTimer) {
            clearTimeout(window._watchdogDelayTimer);
            window._watchdogDelayTimer = null;
        }
        if (window._watchdogInterval) {
            clearInterval(window._watchdogInterval);
            window._watchdogInterval = null;
        }
        if (window._proactiveSwapTimer) {
            clearTimeout(window._proactiveSwapTimer);
            window._proactiveSwapTimer = null;
        }
        clearStall();
        clearReconnectStall();
        stuckCount = 0;
        isReconnecting = false;
    }

    // A source swap leaves videoEl.currentTime at 0 until the new stream is ready,
    // and startDelayed() can anchor lastTime on that 0 too. Reconnecting on such a
    // value restarts the video from the beginning, so fall back to the last position
    // the player actually saw (the same figure that later feeds the resume point and
    // the progress bar under the grid thumbnails).
    function safePosition(candidate) {
        var lastGood = (typeof Player !== 'undefined' && Player.getLastGoodTime) ? Player.getLastGoodTime() : 0;
        var targetResume = (typeof Player !== 'undefined' && Player.getTargetResumeTime) ? Player.getTargetResumeTime() : 0;
        var resumeDone = (typeof Player !== 'undefined' && Player.isResumeSeekDone) ? Player.isResumeSeekDone() : true;
        var floor = lastGood;

        if (candidate && candidate > 0.5) {
            return candidate;
        }
        if (!resumeDone && targetResume > floor) {
            floor = targetResume;
        }
        return floor > 0.5 ? floor : 0;
    }

    function reconnect(savedTime) {
        var videoEl = document.getElementById('video-player');
        var loadingEl = document.getElementById('player-loading');
        var playerError = document.getElementById('player-error');
        var raw;
        var useM;
        var cachedM;
        var newUrl;
        var wasMuted;
        var needsSeek;
        var isRestored;
        var readyPoll;
        var giveUpTimer;
        var seekIssued;
        var seekIssuedAt;
        var warmXhr;

        if (!videoEl) {
            return;
        }

        if (isReconnecting) {
            console.log('Watchdog: reconnect already in progress, ignoring duplicate trigger');
            return;
        }
        isReconnecting = true;

        stop();

        raw = videoEl.dataset.rawUrl;
        useM = videoEl.dataset.useMagic === 'true';
        if (!raw) {
            console.warn('Watchdog: no rawUrl stored on player dataset');
            isReconnecting = false;
            return;
        }

        cachedM = (useM && window._activeClaim) ?
            StreamResolver.getCachedMagicUrl(window._activeClaim.claim_id) : null;
        if (cachedM && window._activeClaim) {
            StreamResolver.clearCachedMagicUrl(window._activeClaim.claim_id);
        }
        newUrl = cachedM || Utils.buildPlayableUrl(raw, useM);
        savedTime = safePosition(savedTime);
        console.log('Watchdog: reconnecting to ' + newUrl + (cachedM ? ' [pre-warmed cache]' : '') + ' at time ' + savedTime.toFixed(2));

        if (loadingEl) {
            loadingEl.style.display = 'block';
        }
        if (playerError) {
            playerError.style.display = 'none';
        }
        videoEl.style.opacity = '1';

        wasMuted = videoEl.muted;
        needsSeek = (savedTime && savedTime > 0.5);
        if (needsSeek) {
            videoEl.muted = true;
        }

        isRestored = false;
        readyPoll = null;
        giveUpTimer = null;
        seekIssued = false;
        seekIssuedAt = 0;

        function clearGiveUp() {
            if (giveUpTimer) {
                clearTimeout(giveUpTimer);
                giveUpTimer = null;
            }
        }

        function cleanupListeners() {
            clearReconnectStall();
            if (readyPoll) {
                clearInterval(readyPoll);
                readyPoll = null;
            }
            videoEl.removeEventListener('loadedmetadata', onMeta);
            videoEl.removeEventListener('canplay', onCanPlay);
            videoEl.removeEventListener('seeked', onSeeked);
        }

        function restorePlayback() {
            var p;

            if (isRestored) {
                return;
            }
            isRestored = true;
            isReconnecting = false;
            clearGiveUp();
            cleanupListeners();
            // The spinner stays up until playback genuinely resumes -- the
            // 'playing'/'canplay' handlers in player.js take it down. Hiding it
            // here showed a frozen-looking still frame while nothing played.
            videoEl.style.opacity = '1';
            videoEl.muted = wasMuted;

            window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
            window._magicPrefetchDone = false;

            p = videoEl.play();
            if (p && typeof p.catch === 'function') {
                p.catch(function (err) {
                    console.error('Watchdog play error:', err);
                });
            }
        }

        function giveUp(why) {
            if (isRestored) {
                return;
            }
            isRestored = true;
            isReconnecting = false;
            clearGiveUp();
            cleanupListeners();
            console.error('Watchdog: giving up on reconnect (' + why + ')');
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
            videoEl.muted = wasMuted;
            if (playerError) {
                playerError.textContent = 'Lost the connection to the stream and could not restore it. Please try again.';
                playerError.style.display = 'block';
            }
        }

        function onSeeked() {
            console.log('Watchdog: seeked to ' + videoEl.currentTime.toFixed(2));
            restorePlayback();
        }

        function onMeta() {
            console.log('Watchdog: loadedmetadata fired, duration=' + videoEl.duration);
        }

        function onCanPlay() {
            whenReady('canplay event');
        }

        // A reconnect gets no patience: the moment the element can play, it plays.
        // This TV frequently never fires canplay/seeked after a mid-stream load(),
        // so readyState is polled as the primary signal and the event is a bonus.
        function whenReady(reason) {
            if (isRestored || seekIssued) {
                return;
            }
            console.log('Watchdog: ready via ' + reason + ', readyState=' + videoEl.readyState + ' currentTime=' + videoEl.currentTime.toFixed(2));
            if (!needsSeek || Math.abs(videoEl.currentTime - savedTime) <= 0.5) {
                restorePlayback();
                return;
            }
            console.log('Watchdog: seeking to ' + savedTime.toFixed(2));
            seekIssued = true;
            seekIssuedAt = Date.now();
            videoEl.addEventListener('seeked', onSeeked);
            try {
                videoEl.currentTime = savedTime;
            } catch (e) {
                console.error('Watchdog: error seeking to savedTime', e);
                restorePlayback();
            }
        }

        function applySource(urlToUse) {
            var finalUrl = urlToUse;
            var clean;
            var claim;
            var knownSource;
            var useHls;
            var hlsUrl;
            var s;

            claim = window._activeClaim;
            knownSource = (typeof Player !== 'undefined' && Player.hasActiveSource) ? Player.hasActiveSource() : false;
            useHls = knownSource && Player.isActiveSourceHls();

            console.log('Watchdog: applying source. readyState=' + videoEl.readyState + ' networkState=' + videoEl.networkState);
            window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
            window._magicPrefetchDone = false;

            videoEl.addEventListener('loadedmetadata', onMeta);
            videoEl.addEventListener('canplay', onCanPlay);

            videoEl.removeAttribute('src');
            videoEl.innerHTML = '';

            if (useHls) {
                // HLS won at startup, so re-link that and nothing else. The magic
                // token belongs to the mp4 endpoint; the playlist hands out its own
                // segment URLs, so the playlist is simply reloaded as-is.
                hlsUrl = (claim && typeof StreamResolver !== 'undefined' && StreamResolver.buildHlsUrl) ?
                    StreamResolver.buildHlsUrl(claim) : null;
                if (hlsUrl) {
                    s = document.createElement('source');
                    s.src = hlsUrl;
                    s.type = 'application/vnd.apple.mpegurl';
                    videoEl.appendChild(s);
                }
            }

            if (!useHls || !hlsUrl) {
                // mp4 path. Only offer HLS alongside it while nothing has played
                // yet and we genuinely do not know which source works -- re-adding
                // an unvalidated HLS source to an mp4-only stream used to make the
                // element chew on an unplayable playlist for the whole timeout.
                if (needsSeek) {
                    clean = urlToUse.split('#')[0];
                    finalUrl = clean + '#t=' + savedTime.toFixed(2);
                }
                if (!knownSource) {
                    hlsUrl = (claim && typeof StreamResolver !== 'undefined' && StreamResolver.buildHlsUrl) ?
                        StreamResolver.buildHlsUrl(claim) : null;
                    if (hlsUrl) {
                        s = document.createElement('source');
                        s.src = hlsUrl;
                        s.type = 'application/vnd.apple.mpegurl';
                        videoEl.appendChild(s);
                    }
                }
                s = document.createElement('source');
                s.src = finalUrl;
                s.type = 'video/mp4';
                videoEl.appendChild(s);
            }

            videoEl.load();

            if (readyPoll) {
                clearInterval(readyPoll);
            }
            readyPoll = setInterval(function () {
                if (isRestored) {
                    clearInterval(readyPoll);
                    readyPoll = null;
                    return;
                }
                if (seekIssued) {
                    // Phase 2: the seek is in flight. 'seeked' usually never
                    // arrives here, so the landing is detected by position, with
                    // a short cap after which we simply play from wherever we are.
                    if (Math.abs(videoEl.currentTime - savedTime) <= 1.5 || Date.now() - seekIssuedAt > 2000) {
                        restorePlayback();
                    }
                    return;
                }
                // Phase 1: wait for the element to become playable.
                if (videoEl.readyState >= 3) {
                    whenReady('readyState poll');
                }
            }, 250);
        }

        function finishWarmup(url) {
            applySource(url);
        }

        warmXhr = new XMLHttpRequest();
        warmXhr.open('HEAD', newUrl, true);
        warmXhr.timeout = 5000;
        warmXhr.onreadystatechange = function () {
            var s;

            if (warmXhr.readyState === 4) {
                s = warmXhr.status;
                console.log('Watchdog: pre-connect HEAD status=' + s);
                if (s === 429) {
                    console.error('Watchdog: 429 on reconnect, falling back to direct apply');
                }
                if (s === 401 && !useM) {
                    console.log('Watchdog: 401 on reconnect without magic -> switching to magic');
                    useM = true;
                    videoEl.dataset.useMagic = 'true';
                    newUrl = Utils.buildPlayableUrl(raw, true);
                }
                if (s === 403 || s === 401) {
                    console.log('Watchdog: ' + s + ' on reconnect -> syncing server time and retrying magic');
                    LbryNet.syncServerTime(function () {
                        newUrl = Utils.buildPlayableUrl(raw, true);
                        finishWarmup(newUrl);
                    });
                    return;
                }
                finishWarmup(newUrl);
            }
        };
        warmXhr.ontimeout = function () {
            console.warn('Watchdog: warmup HEAD timed out/failed, applying directly');
            finishWarmup(newUrl);
        };
        warmXhr.onerror = function () {
            console.warn('Watchdog: warmup HEAD timed out/failed, applying directly');
            finishWarmup(newUrl);
        };
        warmXhr.send();

        // Anti-hang ceiling for the whole reconnect, not a grace period: the fast
        // path is the readyState poll. reconnect() refuses to run again while
        // isReconnecting is set, so an attempt that never resolves would wedge the
        // watchdog for good. Armed once, so the 15s source-flavour retry gets the
        // remaining ~10s rather than a fresh full-length window.
        giveUpTimer = setTimeout(function () {
            giveUp('no playable data after 25s');
        }, 25000);

        reconnectStallTimer = setTimeout(function () {
            var currentUseMagic;
            var nextUseMagic;
            var fallbackUrl;

            if (isRestored) {
                return;
            }
            console.warn('Watchdog: reconnection stalled 15s (readyState=' + videoEl.readyState + ' networkState=' + videoEl.networkState + '). Attempting pipeline recovery...');
            cleanupListeners();
            isReconnecting = false;
            currentUseMagic = videoEl.dataset.useMagic === 'true';
            nextUseMagic = !currentUseMagic;
            videoEl.dataset.useMagic = nextUseMagic ? 'true' : 'false';
            fallbackUrl = Utils.buildPlayableUrl(raw, nextUseMagic);
            console.log('Watchdog: retrying with ' + (nextUseMagic ? 'magic' : 'cacheable (no magic)') + ' -> ' + fallbackUrl);

            applySource(fallbackUrl);
        }, 15000);
    }

    function startDelayed() {
        var videoEl = document.getElementById('video-player');

        if (!videoEl || videoEl.paused || videoEl.ended) {
            return;
        }
        if (window._watchdogInterval) {
            return;
        }
        if (window._watchdogDelayTimer) {
            return;
        }
        window._watchdogDelayTimer = setTimeout(function () {
            var playerEl = document.getElementById('video-player');

            window._watchdogDelayTimer = null;
            if (!playerEl || playerEl.paused || playerEl.ended) {
                return;
            }
            console.log('Watchdog: armed after 30s of stable playback');
            lastTime = playerEl.currentTime;
            stuckCount = 0;
            window._watchdogInterval = setInterval(function () {
                var activeSrc;
                var mMatch;
                var activeMagicTs;
                var nowSec;
                var elapsed;
                var claimId;
                var cachedUrl;
                var rawU;
                var nextMagicUrl;
                var preXhr;
                var current;
                var savedTime;

                try {
                    if (videoEl.paused || videoEl.ended || videoEl.seeking) {
                        return;
                    }

                    activeSrc = videoEl.currentSrc || videoEl.src || '';
                    mMatch = activeSrc.match(/[?&]magic=(\d+)/);
                    activeMagicTs = mMatch ? parseInt(mMatch[1], 10) : (window._magicUrlStartedAt || 0);
                    if (activeMagicTs && !window._magicPrefetchInFlight) {
                        nowSec = LbryNet.getServerNowSec();
                        elapsed = nowSec - activeMagicTs;

                        claimId = window._activeClaim ? window._activeClaim.claim_id : null;
                        cachedUrl = claimId ? StreamResolver.getCachedMagicUrl(claimId) : null;

                        if (elapsed >= 300 && !cachedUrl) {
                            window._magicPrefetchInFlight = true;
                            rawU = videoEl.dataset.rawUrl;
                            if (rawU && claimId) {
                                nextMagicUrl = Utils.buildPlayableUrl(rawU, true);
                                console.log('Watchdog: proactive pre-warm of next magic link at ' + Math.round(elapsed) + 's (token age) -> ' + nextMagicUrl);
                                preXhr = new XMLHttpRequest();
                                preXhr.open('HEAD', nextMagicUrl, true);
                                preXhr.timeout = 5000;
                                preXhr.onreadystatechange = function () {
                                    if (preXhr.readyState === 4) {
                                        window._magicPrefetchInFlight = false;
                                        console.log('Watchdog: proactive pre-warm status=' + preXhr.status);
                                        if (preXhr.status === 200 || preXhr.status === 308 || (preXhr.status >= 200 && preXhr.status < 400)) {
                                            console.log('Watchdog: proactive magic link pre-warmed successfully (' + preXhr.status + ')');
                                            StreamResolver.setCachedMagicUrl(claimId, nextMagicUrl);
                                            // Schedule proactive source swap 30s after pre-warm to avoid stall
                                            if (window._proactiveSwapTimer) {
                                                clearTimeout(window._proactiveSwapTimer);
                                            }
                                            window._proactiveSwapTimer = setTimeout(function () {
                                                var swapUrl;
                                                var swapTime;
                                                var swapVideo;
                                                var swapClaimId;

                                                window._proactiveSwapTimer = null;
                                                swapVideo = document.getElementById('video-player');
                                                swapClaimId = window._activeClaim ? window._activeClaim.claim_id : null;
                                                if (!swapVideo || swapVideo.paused || swapVideo.ended || !swapClaimId) {
                                                    return;
                                                }
                                                swapUrl = StreamResolver.getCachedMagicUrl(swapClaimId);
                                                if (!swapUrl) {
                                                    return;
                                                }
                                                swapTime = swapVideo.currentTime || 0;
                                                console.log('Watchdog: proactive source swap at ' + swapTime.toFixed(2) + 's -> ' + swapUrl);
                                                StreamResolver.clearCachedMagicUrl(swapClaimId);
                                                reconnect(swapTime);
                                            }, 30000);
                                        } else {
                                            console.warn('Watchdog: proactive pre-warm returned status ' + preXhr.status + ', will retry');
                                        }
                                    }
                                };
                                preXhr.send();
                            }
                        }
                    }

                    // A seek parks currentTime while it lands, which looks exactly
                    // like a stall from here. The player records who asked for it;
                    // the flag is self-expiring, so this cannot wedge the detector.
                    if (typeof Player !== 'undefined' && Player.isSeekPending && Player.isSeekPending()) {
                        stuckCount = 0;
                        lastTime = videoEl.currentTime;
                        return;
                    }

                    current = videoEl.currentTime;
                    if (Math.abs(current - lastTime) < 0.1) {
                        stuckCount += 1;
                        if (stuckCount >= 2) {
                            console.log('Watchdog: mid-stream stall, reconnecting!');
                            savedTime = safePosition(videoEl.currentTime || lastTime || 0);
                            reconnect(savedTime);
                        }
                    } else {
                        stuckCount = 0;
                        lastTime = current;
                    }
                } catch (e) { }
            }, 500);
        }, 30000);
    }

    return {
        clearStall: clearStall,
        armStall: armStall,
        clearReconnectStall: clearReconnectStall,
        stop: stop,
        reconnect: reconnect,
        startDelayed: startDelayed,
        isReconnecting: function () {
            return isReconnecting;
        }
    };
}());
