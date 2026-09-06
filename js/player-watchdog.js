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
        var seekTimeout;
        var warmXhr;
        var targetResume;
        var resumeDone;

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
        console.log('Watchdog: reconnecting to ' + newUrl + (cachedM ? ' [pre-warmed cache]' : '') + ' at time ' + (savedTime ? savedTime.toFixed(2) : 0));

        if (loadingEl) {
            loadingEl.style.display = 'block';
        }
        if (playerError) {
            playerError.style.display = 'none';
        }
        videoEl.style.opacity = '1';

        targetResume = Player.getTargetResumeTime ? Player.getTargetResumeTime() : 0;
        resumeDone = Player.isResumeSeekDone ? Player.isResumeSeekDone() : true;

        if (!savedTime || savedTime <= 0.5) {
            if (!resumeDone && targetResume > 0.5) {
                savedTime = targetResume;
            }
        }
        wasMuted = videoEl.muted;
        needsSeek = (savedTime && savedTime > 0.5);
        if (needsSeek) {
            videoEl.muted = true;
        }

        isRestored = false;
        seekTimeout = null;

        function cleanupListeners() {
            clearReconnectStall();
            if (seekTimeout) {
                clearTimeout(seekTimeout);
                seekTimeout = null;
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
            cleanupListeners();
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
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

        function onSeeked() {
            console.log('Watchdog: seeked to ' + videoEl.currentTime.toFixed(2));
            restorePlayback();
        }

        function onMeta() {
            console.log('Watchdog: loadedmetadata fired, duration=' + videoEl.duration);
        }

        function onCanPlay() {
            console.log('Watchdog: canplay fired, readyState=' + videoEl.readyState + ' currentTime=' + videoEl.currentTime.toFixed(2));
            if (!needsSeek) {
                restorePlayback();
                return;
            }

            if (Math.abs(videoEl.currentTime - savedTime) <= 0.5) {
                console.log('Watchdog: already aligned at ' + videoEl.currentTime.toFixed(2) + ', restoring');
                restorePlayback();
            } else {
                console.log('Watchdog: seeking to ' + savedTime.toFixed(2));
                videoEl.addEventListener('seeked', onSeeked);
                try {
                    videoEl.currentTime = savedTime;
                } catch (e) {
                    console.error('Watchdog: error seeking to savedTime', e);
                    restorePlayback();
                }
            }
        }

        function applySource(urlToUse) {
            var finalUrl = urlToUse;
            var clean;
            var hlsUrl;
            var claim;
            var s;

            if (needsSeek) {
                clean = urlToUse.split('#')[0];
                finalUrl = clean + '#t=' + savedTime.toFixed(2);
            }
            console.log('Watchdog: applying source. readyState=' + videoEl.readyState + ' networkState=' + videoEl.networkState);
            window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
            window._magicPrefetchDone = false;

            videoEl.addEventListener('loadedmetadata', onMeta);
            videoEl.addEventListener('canplay', onCanPlay);

            // Build dual sources (HLS + MP4) like the original r() does
            claim = window._activeClaim;
            hlsUrl = (claim && typeof StreamResolver !== 'undefined' && StreamResolver.buildHlsUrl) ?
                StreamResolver.buildHlsUrl(claim) : null;

            videoEl.removeAttribute('src');
            videoEl.innerHTML = '';
            if (hlsUrl) {
                s = document.createElement('source');
                s.src = hlsUrl;
                s.type = 'application/vnd.apple.mpegurl';
                videoEl.appendChild(s);
            }
            s = document.createElement('source');
            s.src = finalUrl;
            s.type = 'video/mp4';
            videoEl.appendChild(s);
            videoEl.load();

            seekTimeout = setTimeout(function () {
                if (!isRestored) {
                    console.warn('Watchdog: seeked/canplay did not fire within 10s, forcing playback');
                    restorePlayback();
                }
            }, 10000);
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

                    current = videoEl.currentTime;
                    if (Math.abs(current - lastTime) < 0.1) {
                        stuckCount += 1;
                        if (stuckCount >= 2) {
                            console.log('Watchdog: mid-stream stall, reconnecting!');
                            savedTime = videoEl.currentTime || lastTime || 0;
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
