// ---------------------------------------------------------------------------
// Video player, streaming engine, controls and watchdog
// (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var Player = (function () {
    var PREFER_HLS = true;
    var MIME_HLS = 'application/vnd.apple.mpegurl';
    var MIME_MP4 = 'video/mp4';

    var stallTimer = null;
    var rebufCount = 0;
    var rebufStart = 0;
    var rebufDuration = 0;
    var lastProgressReport = 0;
    var isPlayerActive = false;
    var isCommentsOpen = false;
    var isRelatedShelfOpen = false;
    var activeShelfRow = 0;
    var shelfIndices = [0, 0];
    var SHELF_STATE = {
        HIDDEN: 0,
        PEEK: 1,
        ACTIVE: 2
    };
    var currentShelfState = SHELF_STATE.HIDDEN;
    var cachedShelfCards = [[], []];
    var currentPlayerFocused = null;

    function clearStall() {
        if (stallTimer) {
            clearTimeout(stallTimer);
            stallTimer = null;
        }
    }

    function openCommentsSidebar(claimId) {
        var sidebar = document.getElementById('player-comments-sidebar');
        var listEl = document.getElementById('comments-list');
        var titleEl = document.getElementById('comments-sidebar-title');

        if (!sidebar || !listEl) {
            return;
        }

        isCommentsOpen = true;
        history.pushState({
            playerOpen: true,
            commentsOpen: true
        }, 'comments');
        sidebar.classList.remove('hidden');
        listEl.innerHTML = '<div class="comments-loading">Loading comments...</div>';

        if (window.Comments && typeof Comments.list === 'function' && claimId) {
            Comments.list(claimId, 1, function (err, res) {
                var total;
                var html;
                var idx;
                var item;
                var author;
                var timeAgo;
                var bodyText;

                if (err || !res || !res.items) {
                    listEl.innerHTML = '<div class="comments-empty">Failed to load comments.</div>';
                    return;
                }

                total = res.total_items || 0;
                if (titleEl) {
                    titleEl.textContent = total + (total === 1 ? ' Comment' : ' Comments');
                }

                if (res.items.length === 0) {
                    listEl.innerHTML = '<div class="comments-empty">No comments yet.</div>';
                    return;
                }

                html = '';
                for (idx = 0; idx < res.items.length; idx++) {
                    item = res.items[idx];
                    author = item.channel_name || 'Anonymous';
                    timeAgo = (window.Utils && typeof Utils.formatRelativeTime === 'function' && item.timestamp) ?
                        Utils.formatRelativeTime(item.timestamp) : '';
                    bodyText = (window.Utils && typeof Utils.escapeHtml === 'function') ?
                        Utils.escapeHtml(item.comment || '') : (item.comment || '');

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
        var sidebar = document.getElementById('player-comments-sidebar');

        if (sidebar) {
            sidebar.classList.add('hidden');
        }
        isCommentsOpen = false;
    }

    function updatePlayerChannelHeader(claim) {
        var channelInfo = document.getElementById('player-channel-info');
        var channelAvatar = document.getElementById('player-channel-avatar');
        var channelName = document.getElementById('player-channel-name');
        var ch;
        var chTitle;
        var rawAvatar;
        var avUrl;
        var isSpaceman;
        var chColor;

        if (!channelInfo) {
            return;
        }

        ch = claim ? claim.signing_channel : null;
        if (ch) {
            chTitle = (ch.value && ch.value.title) ? ch.value.title : (ch.name || '');
            rawAvatar = (ch.value && ch.value.thumbnail) ? ch.value.thumbnail.url : '';
            avUrl = (window.Utils && Utils.getAvatarSrc) ? Utils.getAvatarSrc(rawAvatar, 64) : (rawAvatar ? Utils.thumbUrl(rawAvatar, 64) : 'icons/spaceman.png');
            isSpaceman = (!avUrl || avUrl === 'icons/spaceman.png');
            chColor = (isSpaceman && window.Utils && Utils.getAvatarColor) ? Utils.getAvatarColor(ch.name) : 'transparent';
            if (channelName) {
                channelName.textContent = chTitle;
            }
            if (channelAvatar) {
                channelAvatar.src = avUrl;
                channelAvatar.style.backgroundColor = chColor;
            }
            channelInfo.style.display = '-webkit-flex';
        } else {
            channelInfo.style.display = 'none';
        }
    }

    function createRelatedCardElement(claim, shelfRow, index) {
        var card;
        var title;
        var thumbUrl;
        var ch;
        var chName;
        var duration;
        var durHtml;
        var html;

        if (!claim || !claim.value) {
            return null;
        }
        card = document.createElement('div');
        card.className = 'related-card focusable';
        card.tabIndex = 0;
        card.setAttribute('data-shelf', shelfRow);
        card.setAttribute('data-index', index);
        card.claimData = claim;

        title = claim.value.title || 'Untitled';
        thumbUrl = Utils.thumbUrl(claim.value.thumbnail ? claim.value.thumbnail.url : '', 320, 180);
        ch = claim.signing_channel;
        chName = ch ? ((ch.value && ch.value.title) ? ch.value.title : (ch.name || '')) : '';

        duration = (claim.value && claim.value.video) ? claim.value.video.duration : 0;
        durHtml = '';
        if (duration > 0) {
            durHtml = '<div class="related-duration">' + Utils.formatDuration(duration, duration) + '</div>';
        }

        html = '<div class="related-thumb-wrap">' +
            '<img class="related-thumb" src="' + Utils.escapeHtml(thumbUrl) + '" onerror="this.src=\'icons/icon.png\'" />' +
            durHtml +
            '</div>' +
            '<div class="related-info">' +
            '<div class="related-title">' + Utils.escapeHtml(title) + '</div>' +
            (chName ? ('<div class="related-channel">' + Utils.escapeHtml(chName) + '</div>') : '') +
            '</div>';

        card.innerHTML = html;
        card.onclick = function (evt) {
            if (evt) {
                evt.stopPropagation();
            }
            Player.playVideo(claim);
        };
        return card;
    }

    function resetAndLoadRelatedShelf(claim) {
        var shelf = document.getElementById('player-related-shelf');
        var scrollEl = document.getElementById('player-shelves-scroll');
        var chSec = document.getElementById('shelf-channel-section');
        var chTitle = document.getElementById('shelf-channel-title');
        var chRow = document.getElementById('shelf-channel-row');
        var relSec = document.getElementById('shelf-related-section');
        var relRow = document.getElementById('shelf-related-row');

        if (shelf) {
            shelf.classList.remove('visible');
            shelf.classList.remove('hidden');
            shelf.classList.remove('fade-out');
            shelf.classList.add('peek');
        }
        if (scrollEl) {
            scrollEl.style.webkitTransform = 'translate3d(0, 0, 0)';
            scrollEl.style.transform = 'translate3d(0, 0, 0)';
        }
        currentShelfState = SHELF_STATE.PEEK;
        isRelatedShelfOpen = false;
        activeShelfRow = 0;
        shelfIndices = [0, 0];
        cachedShelfCards = [[], []];

        if (chRow) {
            chRow.innerHTML = '<div style="color:#9B9FA8; font-size:16px; padding:12px 0;">Loading channel uploads...</div>';
        }
        if (relRow) {
            relRow.innerHTML = '<div style="color:#9B9FA8; font-size:16px; padding:12px 0;">Loading related videos...</div>';
        }

        if (window.OdyseeAPI && typeof OdyseeAPI.getRelatedVideos === 'function' && claim) {
            OdyseeAPI.getRelatedVideos(claim, function (err, res) {
                var chVids;
                var relVids;
                var i;
                var card0;
                var j;
                var card1;

                if (err || !res) {
                    if (chRow) {
                        chRow.innerHTML = '<div style="color:#9B9FA8; font-size:16px; padding:12px 0;">No channel videos found.</div>';
                    }
                    if (relRow) {
                        relRow.innerHTML = '<div style="color:#9B9FA8; font-size:16px; padding:12px 0;">No related videos found.</div>';
                    }
                    return;
                }

                chVids = res.channelVideos || [];
                relVids = res.relatedVideos || [];
                cachedShelfCards = [[], []];

                // Shelf 0: More from Channel
                if (chVids.length > 0 && chRow && chSec) {
                    chSec.style.display = 'block';
                    if (chTitle) {
                        chTitle.textContent = 'More from ' + (res.channelTitle || 'Channel');
                    }
                    chRow.innerHTML = '';
                    for (i = 0; i < chVids.length; i++) {
                        card0 = createRelatedCardElement(chVids[i], 0, i);
                        if (card0) {
                            chRow.appendChild(card0);
                            cachedShelfCards[0].push(card0);
                        }
                    }
                } else if (chSec) {
                    chSec.style.display = 'none';
                    activeShelfRow = 1;
                }

                // Shelf 1: Related Videos
                if (relRow && relSec) {
                    relSec.style.display = 'block';
                    relRow.innerHTML = '';
                    if (relVids.length > 0) {
                        for (j = 0; j < relVids.length; j++) {
                            card1 = createRelatedCardElement(relVids[j], 1, j);
                            if (card1) {
                                relRow.appendChild(card1);
                                cachedShelfCards[1].push(card1);
                            }
                        }
                    } else {
                        relRow.innerHTML = '<div style="color:#9B9FA8; font-size:16px; padding:12px 0;">No related videos found.</div>';
                    }
                }
            });
        }
    }

    function setSources(video, list) {
        var k;
        var s;

        video.removeAttribute('src');
        video.innerHTML = '';
        for (k = 0; k < list.length; k++) {
            if (!list[k] || !list[k].url) {
                continue;
            }
            s = document.createElement('source');
            s.setAttribute('src', list[k].url);
            if (list[k].type) {
                s.setAttribute('type', list[k].type);
            }
            s.onerror = function () {
                if (!isPlayerActive) {
                    return;
                }
                console.error('Source tag error on: ' + this.src);
            };
            video.appendChild(s);
            console.log('  source ' + (k + 1) + ': ' + (list[k].type || 'no MIME type') + ' -> ' + list[k].url);
        }
    }

    function closePlayer() {
        var shelf;
        var scrollEl;
        var aEl;
        var containerEl;
        var videoEl;
        var dur;
        var rel;
        var cClaim;
        var curClose;
        var durClose;
        var targetCard;
        var focusableEls;
        var activeIdx;
        var o;

        isPlayerActive = false;
        closeCommentsSidebar();
        if (window.SpatialNavigation && typeof SpatialNavigation.unlock === 'function') {
            SpatialNavigation.unlock();
        }
        shelf = document.getElementById('player-related-shelf');
        scrollEl = document.getElementById('player-shelves-scroll');
        if (shelf) {
            shelf.classList.remove('visible');
            shelf.classList.remove('peek');
            shelf.classList.add('hidden');
        }
        if (scrollEl) {
            scrollEl.style.webkitTransform = 'translate3d(0, 0, 0)';
            scrollEl.style.transform = 'translate3d(0, 0, 0)';
        }
        currentShelfState = SHELF_STATE.HIDDEN;
        isRelatedShelfOpen = false;
        activeShelfRow = 0;
        shelfIndices = [0, 0];
        cachedShelfCards = [[], []];
        currentPlayerFocused = null;
        aEl = document.getElementById('progress-fill');
        if (aEl) {
            aEl.classList.remove('seeking');
            aEl.style.backgroundImage = '';
        }
        if (window._seekStyleTimer) {
            clearTimeout(window._seekStyleTimer);
        }
        clearStall();
        stopWatchdog();
        clearReconnectStall();
        isReconnecting = false;
        containerEl = document.getElementById('player-container');
        videoEl = document.getElementById('video-player');

        if (!videoEl) {
            return;
        }
        videoEl.style.opacity = '1';

        // Send watchman report on close if we have played something
        if (!videoEl.paused || videoEl.currentTime > 0) {
            dur = videoEl.duration || parseFloat(videoEl.getAttribute('data-duration')) || 0;
            rel = dur > 0 ? (videoEl.currentTime / dur * 100) : 0;
            if (window.OdyseeAPI && typeof OdyseeAPI.reportWatchmanPlayback === 'function') {
                OdyseeAPI.reportWatchmanPlayback(videoEl.currentSrc || '', dur, videoEl.currentTime, rel, rebufCount, rebufDuration);
            }
        }
        rebufCount = 0;
        rebufStart = 0;
        rebufDuration = 0;

        cClaim = window._activeClaim;
        if (cClaim && cClaim.claim_id && videoEl) {
            curClose = videoEl.currentTime || 0;
            durClose = videoEl.duration || 0;
            if (window.OdyseeAPI && typeof OdyseeAPI.saveResumePoint === 'function') {
                OdyseeAPI.saveResumePoint(cClaim.claim_id, curClose, durClose);
            }
        }

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
        var durationSec = claim.value && claim.value.video ? claim.value.video.duration : 0;
        var playerContainerEl = document.getElementById('player-container');
        var videoEl = document.getElementById('video-player');
        var loadingEl = document.getElementById('player-loading');
        var titleEl = document.getElementById('player-title');
        var playerError = document.getElementById('player-error');

        var currentClaim = claim;
        var hadHls = false;
        var triedMp4 = false;
        var stalledAtZero = false;
        var playReason = '';

        var resumePoint = (window.OdyseeAPI && typeof OdyseeAPI.getResumePoint === 'function') ?
            OdyseeAPI.getResumePoint(claim.claim_id) : null;
        var initialResumeTime = (resumePoint && resumePoint.time > 10 && (!resumePoint.duration || resumePoint.time < resumePoint.duration - 15)) ?
            resumePoint.time : 0;

        var uploadDate = '';
        var clockSvg;
        var metaDateEl;
        var metaViewsEl;
        var metaReactionsEl;
        var timeDisplayEl;
        var progressFillEl;
        var eyeSvg;
        var countComments;
        var iconComments;
        var isAuth;
        var likeSvg;
        var dislikeSvg;
        var cachedRx;

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
                notice.textContent = '▶ Resume: ' + Utils.formatDuration(sec, 0);
                notice.style.display = 'block';
                setTimeout(function () {
                    notice.style.display = 'none';
                }, 3500);
            }
        }

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
            clearStall();
            cur = videoEl ? (videoEl.currentTime || 0) : 0;
            if (cur > 5 && !videoEl.seeking && window._pendingSeekTime === undefined) {
                console.log('Watchdog: mid-stream media error (' + code + ') at ' + cur.toFixed(2) + 's -> instant reconnect!');
                reconnectStream(cur);
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
                    mp4 = OdyseeAPI.buildMp4Url(currentClaim);
                    if (mp4) {
                        triedMp4 = true;
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
                    q.open('HEAD', Utils.buildPlayableUrl(url, true), true);
                    q.onreadystatechange = function () {
                        if (q.readyState === 4) {
                            console.log('Transcode queued: ' + q.status);
                        }
                    };
                    q.send();
                }
            } else if (playerError) {
                playerError.textContent = 'Cannot start the video this time, please try again later.';
                playerError.style.display = 'block';
            }
        }

        function armStall(url) {
            clearStall();
            stallTimer = setTimeout(function () {
                var rs;

                stallTimer = null;
                if (videoEl.readyState >= 3) {
                    return;
                }
                rs = videoEl.readyState;
                console.error('Did not start within 20s (readyState=' + rs + ')');
                stalledAtZero = (rs === 0);
                handleMediaError(4, url);
            }, 20000);
        }

        function r(url, extra) {
            var targetResume;
            var onCanPlayResume;
            var p;

            isPlayerActive = true;
            console.log('PLAYBACK STARTING [' + (playReason || 'primary') + ']');
            armStall(url);
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

            if (initialResumeTime > 0) {
                targetResume = initialResumeTime;
                initialResumeTime = 0;
                onCanPlayResume = function () {
                    videoEl.removeEventListener('canplay', onCanPlayResume);
                    try {
                        videoEl.currentTime = targetResume;
                        console.log('Resuming playback from ' + targetResume + 's');
                        showResumeNotice(targetResume);
                    } catch (err) {
                        console.error('Resume seek error:', err);
                    }
                };
                videoEl.addEventListener('canplay', onCanPlayResume);
            }

            videoEl.load();
            p = videoEl.play();
            if (p && typeof p.catch === 'function') {
                p.catch(function (err) {
                    console.error('Play error:', err);
                });
            }
        }

        function bindReactionButtons(claimId) {
            var btnLike = document.getElementById('btn-like');
            var btnDislike = document.getElementById('btn-dislike');
            var countLike = document.getElementById('like-count');
            var countDislike = document.getElementById('dislike-count');

            if (btnLike) {
                btnLike.onclick = function (evt) {
                    var wasLiked;
                    var wasDisliked;
                    var curL;
                    var curD;
                    var newL;
                    var newD;

                    evt.stopPropagation();
                    wasLiked = btnLike.classList.contains('active-like');
                    wasDisliked = btnDislike ? btnDislike.classList.contains('active-dislike') : false;
                    curL = parseInt(countLike ? countLike.textContent : '0', 10) || 0;
                    curD = parseInt(countDislike ? countDislike.textContent : '0', 10) || 0;

                    if (wasLiked) {
                        btnLike.classList.remove('active-like');
                        newL = Math.max(0, curL - 1);
                        if (countLike) {
                            countLike.textContent = newL;
                        }
                        if (!claim._cached_reactions) {
                            claim._cached_reactions = {
                                like: 0,
                                dislike: 0
                            };
                        }
                        claim._cached_reactions.like = newL;
                        claim._cached_reactions.myReaction = null;
                        OdyseeAPI.react(claimId, 'like', true);
                    } else {
                        btnLike.classList.add('active-like');
                        newL = curL + 1;
                        if (countLike) {
                            countLike.textContent = newL;
                        }
                        if (!claim._cached_reactions) {
                            claim._cached_reactions = {
                                like: 0,
                                dislike: 0
                            };
                        }
                        claim._cached_reactions.like = newL;
                        claim._cached_reactions.myReaction = 'like';
                        if (wasDisliked && btnDislike) {
                            btnDislike.classList.remove('active-dislike');
                            newD = Math.max(0, curD - 1);
                            if (countDislike) {
                                countDislike.textContent = newD;
                            }
                            claim._cached_reactions.dislike = newD;
                        }
                        OdyseeAPI.react(claimId, 'like', false);
                    }
                };
            }

            if (btnDislike) {
                btnDislike.onclick = function (evt) {
                    var wasDisliked;
                    var wasLiked;
                    var curL;
                    var curD;
                    var newD;
                    var newL;

                    evt.stopPropagation();
                    wasDisliked = btnDislike.classList.contains('active-dislike');
                    wasLiked = btnLike ? btnLike.classList.contains('active-like') : false;
                    curL = parseInt(countLike ? countLike.textContent : '0', 10) || 0;
                    curD = parseInt(countDislike ? countDislike.textContent : '0', 10) || 0;

                    if (wasDisliked) {
                        btnDislike.classList.remove('active-dislike');
                        newD = Math.max(0, curD - 1);
                        if (countDislike) {
                            countDislike.textContent = newD;
                        }
                        if (!claim._cached_reactions) {
                            claim._cached_reactions = {
                                like: 0,
                                dislike: 0
                            };
                        }
                        claim._cached_reactions.dislike = newD;
                        claim._cached_reactions.myReaction = null;
                        OdyseeAPI.react(claimId, 'dislike', true);
                    } else {
                        btnDislike.classList.add('active-dislike');
                        newD = curD + 1;
                        if (countDislike) {
                            countDislike.textContent = newD;
                        }
                        if (!claim._cached_reactions) {
                            claim._cached_reactions = {
                                like: 0,
                                dislike: 0
                            };
                        }
                        claim._cached_reactions.dislike = newD;
                        claim._cached_reactions.myReaction = 'dislike';
                        if (wasLiked && btnLike) {
                            btnLike.classList.remove('active-like');
                            newL = Math.max(0, curL - 1);
                            if (countLike) {
                                countLike.textContent = newL;
                            }
                            claim._cached_reactions.like = newL;
                        }
                        OdyseeAPI.react(claimId, 'dislike', false);
                    }
                };
            }
        }

        function renderReactions(likes, dislikes, myRx) {
            var existingLike;
            var existingDislike;
            var countLikeEl;
            var countDislikeEl;

            if (!metaReactionsEl) {
                return;
            }
            if (isAuth) {
                existingLike = document.getElementById('btn-like');
                existingDislike = document.getElementById('btn-dislike');
                if (existingLike && existingDislike) {
                    countLikeEl = document.getElementById('like-count');
                    countDislikeEl = document.getElementById('dislike-count');
                    if (countLikeEl) {
                        countLikeEl.textContent = likes || 0;
                    }
                    if (countDislikeEl) {
                        countDislikeEl.textContent = dislikes || 0;
                    }
                    if (myRx !== undefined) {
                        existingLike.classList.remove('active-like');
                        existingDislike.classList.remove('active-dislike');
                        if (myRx === 'like') {
                            existingLike.classList.add('active-like');
                        } else if (myRx === 'dislike') {
                            existingDislike.classList.add('active-dislike');
                        }
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
                bindReactionButtons(claim.claim_id);

                if (myRx === undefined && window.OdyseeAPI && typeof OdyseeAPI.getMyReaction === 'function') {
                    OdyseeAPI.getMyReaction(claim.claim_id, function (err, rx) {
                        var bLike = document.getElementById('btn-like');
                        var bDislike = document.getElementById('btn-dislike');

                        if (!bLike || !bDislike) {
                            return;
                        }
                        bLike.classList.remove('active-like');
                        bDislike.classList.remove('active-dislike');
                        if (rx === 'like') {
                            bLike.classList.add('active-like');
                        } else if (rx === 'dislike') {
                            bDislike.classList.add('active-dislike');
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

        function startVideoWithWarmup(rawUrl) {
            var retries = 0;
            var maxRetries = 6;
            var useMagic = false;
            var cachedMagicUrl;
            var cachedHls;

            cachedMagicUrl = (window.StreamResolver && typeof StreamResolver.getCachedMagicUrl === 'function') ?
                StreamResolver.getCachedMagicUrl(currentClaim.claim_id) : null;
            if (cachedMagicUrl) {
                console.log('StreamResolver: starting immediately with cached magic URL: ' + cachedMagicUrl);
                videoEl.dataset.rawUrl = rawUrl;
                videoEl.dataset.useMagic = 'true';
                window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
                window._magicPrefetchDone = false;
                cachedHls = PREFER_HLS ? OdyseeAPI.buildHlsUrl(currentClaim) : null;
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

                    if ((s === 200 || s === 308) && useMagic && window.StreamResolver && typeof StreamResolver.setCachedMagicUrl === 'function') {
                        StreamResolver.setCachedMagicUrl(currentClaim.claim_id, url);
                        window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
                        window._magicPrefetchDone = false;
                    }

                    if (s === 308 && PREFER_HLS) {
                        hls = OdyseeAPI.buildHlsUrl(currentClaim);
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

        clockSvg = (typeof Icons !== 'undefined') ? Icons.get('clock') : '';
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

        progressFillEl = document.getElementById('progress-fill');
        if (progressFillEl) {
            progressFillEl.style.width = '0%';
        }

        eyeSvg = (typeof Icons !== 'undefined') ? Icons.get('eye') : '';
        if (claim._cached_views !== undefined && metaViewsEl) {
            metaViewsEl.innerHTML = eyeSvg + claim._cached_views;
        } else if (claim.claim_id) {
            OdyseeAPI.getViewCount(claim.claim_id, function (err, views) {
                if (!err && metaViewsEl) {
                    claim._cached_views = views;
                    metaViewsEl.innerHTML = eyeSvg + views;
                }
            });
        }

        // Comment count on player
        countComments = document.getElementById('comments-count');
        iconComments = document.getElementById('comments-icon');
        if (iconComments && typeof Icons !== 'undefined') {
            iconComments.innerHTML = Icons.get('comment');
        }
        if (countComments) {
            countComments.textContent = '0';
        }
        if (window.Comments && typeof Comments.list === 'function' && claim.claim_id) {
            Comments.list(claim.claim_id, 1, function (err, res) {
                if (!err && res && countComments) {
                    countComments.textContent = res.total_items || 0;
                }
            });
        }

        isAuth = window.Auth && Auth.isLoggedIn && Auth.isLoggedIn();
        likeSvg = (typeof Icons !== 'undefined') ? Icons.get('fire') : '';
        dislikeSvg = (typeof Icons !== 'undefined') ? Icons.get('slime') : '';

        cachedRx = (window.OdyseeAPI && typeof OdyseeAPI.getCachedReactions === 'function') ?
            OdyseeAPI.getCachedReactions(claim.claim_id) : (claim._cached_reactions || null);

        // Render reaction buttons immediately so they are available right away
        renderReactions(
            cachedRx ? cachedRx.like : 0,
            cachedRx ? cachedRx.dislike : 0,
            cachedRx ? cachedRx.myReaction : undefined
        );

        if (claim.claim_id) {
            OdyseeAPI.getReactions(claim.claim_id, function (err, reactions) {
                if (!err && reactions) {
                    claim._cached_reactions = reactions;
                    renderReactions(reactions.like, reactions.dislike, reactions.myReaction);
                }
            });
        }

        isPlayerActive = false;
        window._magicPrefetchDone = false;
        if (playerError) {
            playerError.style.display = 'none';
        }
        videoEl.setAttribute('data-duration', durationSec);
        videoEl.innerHTML = '';
        videoEl.removeAttribute('src');
        videoEl.src = '';
        if (titleEl) {
            titleEl.textContent = claim.value.title || 'Unknown Title';
        }
        updatePlayerChannelHeader(claim);
        resetAndLoadRelatedShelf(claim);
        if (window.SpatialNavigation && typeof SpatialNavigation.lock === 'function') {
            SpatialNavigation.lock();
        }
        if (playerContainerEl) {
            playerContainerEl.classList.remove('hidden');
        }
        if (loadingEl) {
            loadingEl.style.display = 'block';
        }

        OdyseeAPI.getStreamingSourceUrl(claim, function (tErr, url) {
            var src;
            var sd;
            var cid;
            var l;

            if (!tErr && url) {
                startVideoWithWarmup(url);
            } else {
                console.error('Failed to get stream URL via get method.', tErr);
                src = claim.reposted_claim || claim;
                sd = src.value && src.value.source ? src.value.source.sd_hash : '';
                cid = src.claim_id;
                if (sd && cid && src.name) {
                    l = 'http://player.odycdn.com/api/v4/streams/free/' +
                        encodeURIComponent(src.name) + '/' + cid + '/' + sd.substring(0, 6);
                    console.log('Using assembled v4 fallback: ' + l);
                    startVideoWithWarmup(l);
                } else if (loadingEl) {
                    loadingEl.style.display = 'none';
                }
            }
        });

        history.pushState({ playerOpen: true }, 'player');
        setTimeout(function () {
            var els;
            var idx;

            SpatialNavigation.refresh();
            els = document.querySelectorAll('.focusable');
            for (idx = 0; idx < els.length; idx++) {
                if (els[idx].id === 'btn-play-pause') {
                    SpatialNavigation.focusElement(idx);
                    break;
                }
            }
        }, 100);
    }

    // --- Watchdog: stall detection & reconnection ---
    var lastTime = 0;
    var stuckCount = 0;
    var reconnectStallTimer = null;
    var isReconnecting = false;

    function clearReconnectStall() {
        if (reconnectStallTimer) {
            clearTimeout(reconnectStallTimer);
            reconnectStallTimer = null;
        }
    }

    function stopWatchdog() {
        if (window._watchdogDelayTimer) {
            clearTimeout(window._watchdogDelayTimer);
            window._watchdogDelayTimer = null;
        }
        if (window._watchdogInterval) {
            clearInterval(window._watchdogInterval);
            window._watchdogInterval = null;
        }
        stuckCount = 0;
    }

    function reconnectStream(savedTime) {
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
        var handled;

        if (!videoEl) {
            return;
        }

        if (isReconnecting) {
            console.log('Watchdog: reconnect already in progress, ignoring duplicate trigger');
            return;
        }
        isReconnecting = true;

        stopWatchdog();
        clearReconnectStall();

        raw = videoEl.dataset.rawUrl;
        useM = videoEl.dataset.useMagic === 'true';
        if (!raw) {
            console.warn('Watchdog: no rawUrl stored on player dataset');
            isReconnecting = false;
            return;
        }

        cachedM = (useM && window.StreamResolver && typeof StreamResolver.getCachedMagicUrl === 'function' && window._activeClaim) ?
            StreamResolver.getCachedMagicUrl(window._activeClaim.claim_id) : null;
        if (cachedM && window.StreamResolver && typeof StreamResolver.clearCachedMagicUrl === 'function' && window._activeClaim) {
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

            // Reset proactive pre-warm timer on reconnection
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

            // If already aligned with savedTime (e.g. via #t= media fragment), restore immediately
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

        // Apply new source directly to video element (avoiding WebKit <source> replacement quirks)
        function applySource(urlToUse) {
            var finalUrl = urlToUse;
            var clean;

            if (needsSeek) {
                clean = urlToUse.split('#')[0];
                finalUrl = clean + '#t=' + savedTime.toFixed(2);
            }
            console.log('Watchdog: applying direct src. readyState=' + videoEl.readyState + ' networkState=' + videoEl.networkState);
            window._magicUrlStartedAt = Math.floor(Date.now() / 1000);
            window._magicPrefetchDone = false;
            videoEl.pause();
            videoEl.innerHTML = '';
            videoEl.removeAttribute('src');
            videoEl.addEventListener('loadedmetadata', onMeta);
            videoEl.addEventListener('canplay', onCanPlay);
            videoEl.src = finalUrl;
            videoEl.load();

            if (needsSeek) {
                seekTimeout = setTimeout(function () {
                    if (!isRestored) {
                        console.warn('Watchdog: seek/canplay safety timeout fired after 10s');
                        restorePlayback();
                    }
                }, 10000);
            }
        }

        // Perform warmup HEAD with status check & 429 fallback
        warmXhr = new XMLHttpRequest();
        warmXhr.open('HEAD', newUrl, true);
        warmXhr.timeout = 3000;
        handled = false;

        function finishWarmup(url) {
            if (handled) {
                return;
            }
            handled = true;
            applySource(url);
        }

        warmXhr.onreadystatechange = function () {
            var cacheable;

            if (warmXhr.readyState !== 4) {
                return;
            }
            console.log('Watchdog: warmup HEAD status=' + warmXhr.status);
            if (warmXhr.status === 429) {
                console.warn('Watchdog: 429 rate limit hit on CDN! Retrying with cacheable URL (without query)...');
                cacheable = Utils.buildPlayableUrl(raw, false);
                videoEl.dataset.useMagic = 'false';
                finishWarmup(cacheable);
                return;
            }
            if (warmXhr.status === 401) {
                console.warn('Watchdog: 401 received on warmup. Re-syncing clock...');
                if (window.OdyseeAPI && typeof OdyseeAPI.syncServerTime === 'function') {
                    OdyseeAPI.syncServerTime(function () {
                        var resyncedUrl = Utils.buildPlayableUrl(raw, true);
                        finishWarmup(resyncedUrl);
                    });
                    return;
                }
            }
            finishWarmup(newUrl);
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

        // Safety fallback timeout: if neither fires within 15 seconds, retry with alternate mode
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

    function startWatchdogDelayed() {
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

                    // Proactive magic link pre-warm when active stream token reaches 300s
                    activeSrc = videoEl.currentSrc || videoEl.src || '';
                    mMatch = activeSrc.match(/[?&]magic=(\d+)/);
                    activeMagicTs = mMatch ? parseInt(mMatch[1], 10) : (window._magicUrlStartedAt || 0);
                    if (activeMagicTs && !window._magicPrefetchInFlight) {
                        nowSec = (window.OdyseeAPI && typeof OdyseeAPI.getServerNowSec === 'function') ?
                            OdyseeAPI.getServerNowSec() : Math.floor(Date.now() / 1000);
                        elapsed = nowSec - activeMagicTs;

                        claimId = window._activeClaim ? window._activeClaim.claim_id : null;
                        cachedUrl = (claimId && window.StreamResolver && typeof StreamResolver.getCachedMagicUrl === 'function') ?
                            StreamResolver.getCachedMagicUrl(claimId) : null;

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
                                            if (window.StreamResolver && typeof StreamResolver.setCachedMagicUrl === 'function') {
                                                StreamResolver.setCachedMagicUrl(claimId, nextMagicUrl);
                                            }
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
        var hideTimer;
        var playerContainerEl = document.getElementById('player-container');
        var videoEl = document.getElementById('video-player');
        var playPauseBtn = document.getElementById('btn-play-pause');
        var headerEl = document.getElementById('player-header');
        var shelfEl = document.getElementById('player-related-shelf');
        var playerTitleEl = document.getElementById('player-title');
        var progressFillEl = document.getElementById('progress-fill');
        var timeDisplayEl = document.getElementById('time-display');
        var customControlsEl = document.getElementById('custom-controls');
        var loadingEl = document.getElementById('player-loading');
        var btnCommentsEl;

        if (!playerContainerEl || !videoEl) {
            return;
        }

        function scrollShelvesVertical(targetShelfRow) {
            var scrollEl = document.getElementById('player-shelves-scroll');

            if (!scrollEl) {
                return;
            }
            if (targetShelfRow === 1) {
                scrollEl.style.webkitTransform = 'translate3d(0, -275px, 0)';
                scrollEl.style.transform = 'translate3d(0, -275px, 0)';
            } else {
                scrollEl.style.webkitTransform = 'translate3d(0, 0, 0)';
                scrollEl.style.transform = 'translate3d(0, 0, 0)';
            }
        }

        function scrollRelatedCardIntoView(card, colIndex) {
            var row;
            var col;
            var targetScroll;

            if (!card) {
                return;
            }
            row = card.parentElement;
            if (!row) {
                return;
            }
            col = (typeof colIndex === 'number') ? colIndex : (parseInt(card.getAttribute('data-index'), 10) || 0);
            targetScroll = col > 0 ? (col * 270 - 40) : 0;
            if (Math.abs(row.scrollLeft - targetScroll) > 10) {
                row.scrollLeft = targetScroll;
            }
        }

        function getCardAtShelf(shelfRow, colIndex) {
            var row;
            var domCards;
            var idx;

            if (!cachedShelfCards[shelfRow] || !cachedShelfCards[shelfRow].length) {
                row = document.querySelector('.related-videos-row[data-shelf="' + shelfRow + '"]');
                if (!row) {
                    return null;
                }
                domCards = row.querySelectorAll('.related-card');
                if (!domCards || !domCards.length) {
                    return null;
                }
                idx = Math.max(0, Math.min(domCards.length - 1, colIndex));
                return domCards[idx];
            }
            idx = Math.max(0, Math.min(cachedShelfCards[shelfRow].length - 1, colIndex));
            return cachedShelfCards[shelfRow][idx] || null;
        }

        function setPlayerFocus(targetEl) {
            var prevFocused;
            var pf;

            if (!targetEl) {
                return;
            }
            if (currentPlayerFocused && currentPlayerFocused !== targetEl) {
                currentPlayerFocused.classList.remove('focused');
            } else if (!currentPlayerFocused) {
                prevFocused = document.querySelectorAll('#player-container .focused');
                for (pf = 0; pf < prevFocused.length; pf++) {
                    prevFocused[pf].classList.remove('focused');
                }
            }
            targetEl.classList.add('focused');
            currentPlayerFocused = targetEl;
        }

        function hideControls() {
            if (!videoEl.paused) {
                if (customControlsEl) {
                    customControlsEl.classList.add('fade-out');
                }
                if (headerEl) {
                    headerEl.classList.add('fade-out');
                } else if (playerTitleEl) {
                    playerTitleEl.classList.add('fade-out');
                }
                if (shelfEl) {
                    shelfEl.classList.remove('visible');
                    shelfEl.classList.remove('peek');
                    shelfEl.classList.add('fade-out');
                }
                scrollShelvesVertical(0);
                currentShelfState = SHELF_STATE.HIDDEN;
                isRelatedShelfOpen = false;
                setPlayerFocus(playPauseBtn);
            }
        }

        function scheduleHide(delay) {
            var timeout;

            clearTimeout(hideTimer);
            if (!videoEl.paused) {
                timeout = (typeof delay === 'number') ? delay : ((currentShelfState === SHELF_STATE.ACTIVE) ? 25000 : 4000);
                hideTimer = setTimeout(hideControls, timeout);
            }
        }

        function showControls(delay) {
            if (!playerContainerEl.classList.contains('hidden')) {
                if (customControlsEl) {
                    customControlsEl.classList.remove('fade-out');
                }
                if (headerEl) {
                    headerEl.classList.remove('fade-out');
                } else if (playerTitleEl) {
                    playerTitleEl.classList.remove('fade-out');
                }
                if (shelfEl) {
                    shelfEl.classList.remove('fade-out');
                    if (currentShelfState === SHELF_STATE.ACTIVE) {
                        shelfEl.classList.remove('peek');
                        shelfEl.classList.add('visible');
                    } else {
                        shelfEl.classList.remove('visible');
                        shelfEl.classList.add('peek');
                        currentShelfState = SHELF_STATE.PEEK;
                    }
                }
                scheduleHide(delay);
            }
        }

        function getPlayerFocusedButton() {
            var el;

            if (currentPlayerFocused && document.contains(currentPlayerFocused)) {
                return currentPlayerFocused;
            }
            el = document.querySelector('.btn-player-reaction.focused, .btn-player-comments.focused, .btn-play-pause.focused, .related-card.focused');
            currentPlayerFocused = el || playPauseBtn;
            return currentPlayerFocused;
        }

        btnCommentsEl = document.getElementById('btn-comments');
        if (btnCommentsEl) {
            btnCommentsEl.onclick = function (evt) {
                var c = window._activeClaim;

                if (evt) {
                    evt.stopPropagation();
                }
                if (c && c.claim_id) {
                    openCommentsSidebar(c.claim_id);
                }
            };
        }

        function doSeek(direction) {
            var dur;
            var dFallback;
            var maxDur;
            var target;

            try {
                dur = videoEl.duration;
                dFallback = parseFloat(videoEl.getAttribute('data-duration')) || 0;
                if (!dur || isNaN(dur) || dur === Infinity) {
                    dur = dFallback;
                }

                maxDur = dur > 0 ? dur : (videoEl.currentTime + direction + 100);
                target = Math.max(0, Math.min(maxDur, videoEl.currentTime + direction));

                // Directly assign to the video element's currentTime property
                videoEl.currentTime = target;

                if (progressFillEl) {
                    progressFillEl.classList.add('seeking');
                    progressFillEl.style.backgroundImage = 'none';
                    if (dur > 0) {
                        progressFillEl.style.width = (target / dur * 100) + '%';
                    }
                }
                if (timeDisplayEl && dur > 0) {
                    timeDisplayEl.textContent = Utils.formatDuration(target, dur) + ' / ' + Utils.formatDuration(dur, dur);
                }

                if (window._seekStyleTimer) {
                    clearTimeout(window._seekStyleTimer);
                }
                window._seekStyleTimer = setTimeout(function () {
                    if (progressFillEl) {
                        progressFillEl.classList.remove('seeking');
                        progressFillEl.style.backgroundImage = '';
                    }
                }, 500);
            } catch (err) {
                console.error('Direct seek failed: ' + err);
                if (progressFillEl) {
                    progressFillEl.classList.remove('seeking');
                    progressFillEl.style.backgroundImage = '';
                }
            }
        }

        window.addEventListener('keydown', function (e) {
            var keyCode;
            var listEl;
            var wasHidden;
            var btnLike;
            var btnDislike;
            var btnComments;
            var focusedBtn;
            var isRelatedCardFocused;
            var curShelf;
            var curCol;
            var cClaim;
            var hasShelf0;
            var upCard;
            var hasShelf1;
            var downCard;
            var hasShelf0Check;
            var targetCard;
            var prevCard;
            var numCards;
            var nextCard;

            if (!playerContainerEl.classList.contains('hidden')) {
                e.stopPropagation();
                keyCode = e.keyCode;

                // --- Modal Navigation for Comments Sidebar ---
                if (isCommentsOpen) {
                    // Dedicated Hardware Media Keys continue to control video playback
                    if (keyCode === 415 || keyCode === 19 || keyCode === 179) {
                        e.preventDefault();
                        if (playPauseBtn) {
                            playPauseBtn.click();
                        }
                        return;
                    }
                    if (keyCode === 412 || keyCode === 417) {
                        e.preventDefault();
                        doSeek(keyCode === 412 ? -10 : 10);
                        return;
                    }
                    if (keyCode === 413) {
                        e.preventDefault();
                        closePlayer();
                        return;
                    }

                    // Back button closes ONLY the comments sidebar via history.back()
                    if (keyCode === 461 || keyCode === 8 || keyCode === 27 || keyCode === 10009) {
                        e.preventDefault();
                        e.stopPropagation();
                        history.back();
                        return;
                    }

                    // D-pad UP / DOWN scrolls the comments list
                    if (keyCode === 38) {
                        e.preventDefault();
                        listEl = document.getElementById('comments-list');
                        if (listEl) {
                            listEl.scrollTop -= 120;
                        }
                        return;
                    }
                    if (keyCode === 40) {
                        e.preventDefault();
                        listEl = document.getElementById('comments-list');
                        if (listEl) {
                            listEl.scrollTop += 120;
                        }
                        return;
                    }

                    // D-pad LEFT, RIGHT, OK and other keys are absorbed in comments sidebar (video won't seek or pause)
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }

                // --- Normal Player Controls Navigation ---
                wasHidden = customControlsEl && customControlsEl.classList.contains('fade-out');
                showControls();

                if (wasHidden) {
                    e.preventDefault();
                    setPlayerFocus(playPauseBtn);
                    return;
                }

                btnLike = document.getElementById('btn-like');
                btnDislike = document.getElementById('btn-dislike');
                btnComments = document.getElementById('btn-comments');
                focusedBtn = getPlayerFocusedButton();
                isRelatedCardFocused = focusedBtn && focusedBtn.classList.contains('related-card');
                curShelf = isRelatedCardFocused ? (parseInt(focusedBtn.getAttribute('data-shelf'), 10) || 0) : 0;
                curCol = isRelatedCardFocused ? (parseInt(focusedBtn.getAttribute('data-index'), 10) || 0) : 0;

                // 1. Dedicated Media Play / Pause keys
                if (keyCode === 415 || keyCode === 19 || keyCode === 179) {
                    e.preventDefault();
                    if (playPauseBtn) {
                        playPauseBtn.click();
                    }
                    return;
                }

                // 2. Dedicated Media Rewind / Fast Forward keys
                if (keyCode === 412 || keyCode === 417) {
                    e.preventDefault();
                    doSeek(keyCode === 412 ? -10 : 10);
                    return;
                }

                // 3. OK / Enter key (13)
                if (keyCode === 13) {
                    e.preventDefault();
                    if (isRelatedCardFocused) {
                        if (focusedBtn.claimData) {
                            Player.playVideo(focusedBtn.claimData);
                        } else {
                            focusedBtn.click();
                        }
                    } else if (focusedBtn === btnComments || (focusedBtn && focusedBtn.id === 'btn-comments')) {
                        cClaim = window._activeClaim;
                        if (cClaim && cClaim.claim_id) {
                            openCommentsSidebar(cClaim.claim_id);
                        }
                    } else if (focusedBtn) {
                        focusedBtn.click();
                    } else if (playPauseBtn) {
                        playPauseBtn.click();
                    }
                    return;
                }

                // 4. UP Arrow (38)
                if (keyCode === 38) {
                    e.preventDefault();
                    if (isRelatedCardFocused) {
                        if (curShelf === 1) {
                            // On Shelf 1 (Related): check if Shelf 0 (Channel) exists and has cards
                            hasShelf0 = cachedShelfCards[0] && cachedShelfCards[0].length > 0;
                            if (hasShelf0) {
                                activeShelfRow = 0;
                                upCard = getCardAtShelf(0, shelfIndices[0]);
                                if (upCard) {
                                    setPlayerFocus(upCard);
                                    scrollRelatedCardIntoView(upCard, shelfIndices[0]);
                                    scrollShelvesVertical(0);
                                    scheduleHide(25000);
                                    return;
                                }
                            }
                        }
                        // From Shelf 0 (or Shelf 1 if Shelf 0 not present): float back down to Peeking state & Play/Pause
                        if (shelfEl) {
                            shelfEl.classList.remove('visible');
                            shelfEl.classList.add('peek');
                        }
                        currentShelfState = SHELF_STATE.PEEK;
                        isRelatedShelfOpen = false;
                        scrollShelvesVertical(0);
                        setPlayerFocus(playPauseBtn);
                        scheduleHide(4000);
                    } else if (focusedBtn === playPauseBtn) {
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
                if (keyCode === 40) {
                    e.preventDefault();
                    if (isRelatedCardFocused) {
                        if (curShelf === 0) {
                            // On Shelf 0: move DOWN to Shelf 1
                            hasShelf1 = cachedShelfCards[1] && cachedShelfCards[1].length > 0;
                            if (hasShelf1) {
                                activeShelfRow = 1;
                                downCard = getCardAtShelf(1, shelfIndices[1]);
                                if (downCard) {
                                    setPlayerFocus(downCard);
                                    scrollRelatedCardIntoView(downCard, shelfIndices[1]);
                                    scrollShelvesVertical(1);
                                    scheduleHide(25000);
                                    return;
                                }
                            }
                        }
                        // On Shelf 1 (bottom-most): absorb DOWN and keep 25s timer
                        scheduleHide(25000);
                    } else if (focusedBtn === btnLike || focusedBtn === btnDislike) {
                        // From reactions, move DOWN to comments row before play/pause
                        if (btnComments) {
                            setPlayerFocus(btnComments);
                        } else {
                            setPlayerFocus(playPauseBtn);
                        }
                    } else if (focusedBtn === btnComments) {
                        // From comments, move DOWN to play/pause
                        setPlayerFocus(playPauseBtn);
                    } else if (focusedBtn === playPauseBtn) {
                        // From play/pause, expand shelves from PEEK to ACTIVE!
                        if (shelfEl) {
                            shelfEl.classList.remove('hidden');
                            shelfEl.classList.remove('fade-out');
                            shelfEl.classList.remove('peek');
                            shelfEl.classList.add('visible');
                        }
                        currentShelfState = SHELF_STATE.ACTIVE;
                        isRelatedShelfOpen = true;
                        hasShelf0Check = cachedShelfCards[0] && cachedShelfCards[0].length > 0;
                        if (!hasShelf0Check && activeShelfRow === 0) {
                            activeShelfRow = 1;
                        }
                        targetCard = getCardAtShelf(activeShelfRow, shelfIndices[activeShelfRow]);
                        if (!targetCard && activeShelfRow === 0) {
                            activeShelfRow = 1;
                            targetCard = getCardAtShelf(1, shelfIndices[1]);
                        }
                        if (targetCard) {
                            setPlayerFocus(targetCard);
                            scrollRelatedCardIntoView(targetCard, shelfIndices[activeShelfRow]);
                            scrollShelvesVertical(activeShelfRow);
                        }
                        scheduleHide(25000);
                    }
                    return;
                }

                // 6. LEFT Arrow (37)
                if (keyCode === 37) {
                    e.preventDefault();
                    if (isRelatedCardFocused) {
                        if (curCol > 0) {
                            shelfIndices[curShelf] = curCol - 1;
                            prevCard = getCardAtShelf(curShelf, shelfIndices[curShelf]);
                            if (prevCard) {
                                setPlayerFocus(prevCard);
                                scrollRelatedCardIntoView(prevCard, shelfIndices[curShelf]);
                            }
                        }
                        scheduleHide(25000);
                    } else if (focusedBtn === btnComments) {
                        if (btnDislike) {
                            setPlayerFocus(btnDislike);
                        } else if (btnLike) {
                            setPlayerFocus(btnLike);
                        } else {
                            setPlayerFocus(playPauseBtn);
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
                if (keyCode === 39) {
                    e.preventDefault();
                    if (isRelatedCardFocused) {
                        numCards = cachedShelfCards[curShelf] ? cachedShelfCards[curShelf].length : 0;
                        if (curCol < numCards - 1) {
                            shelfIndices[curShelf] = curCol + 1;
                            nextCard = getCardAtShelf(curShelf, shelfIndices[curShelf]);
                            if (nextCard) {
                                setPlayerFocus(nextCard);
                                scrollRelatedCardIntoView(nextCard, shelfIndices[curShelf]);
                            }
                        }
                        scheduleHide(25000);
                    } else if (focusedBtn === btnLike) {
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
                if (keyCode === 413) {
                    e.preventDefault();
                    history.back();
                } else if (keyCode !== 461 && keyCode !== 8 && keyCode !== 27 && keyCode !== 10009) {
                    // other keys
                } else {
                    e.preventDefault();
                    if (currentShelfState === SHELF_STATE.ACTIVE || isRelatedShelfOpen || isRelatedCardFocused) {
                        if (shelfEl) {
                            shelfEl.classList.remove('visible');
                            shelfEl.classList.add('peek');
                        }
                        currentShelfState = SHELF_STATE.PEEK;
                        isRelatedShelfOpen = false;
                        scrollShelvesVertical(0);
                        setPlayerFocus(playPauseBtn);
                        scheduleHide(4000);
                        return;
                    }
                    history.back();
                }
            }
        }, true);

        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', function () {
                window._userAction = true;
                if (videoEl.paused) {
                    videoEl.play();
                    playPauseBtn.innerHTML = '\u275A\u275A';
                } else {
                    videoEl.pause();
                    playPauseBtn.innerHTML = '\u25B6';
                    showControls();
                }
            });
        }

        videoEl.addEventListener('play', function () {
            if (playPauseBtn) {
                playPauseBtn.innerHTML = '\u275A\u275A';
            }
            showControls();
            if (window._userAction) {
                stopWatchdog();
                window._userAction = false;
            }
        });

        videoEl.addEventListener('pause', function () {
            if (playPauseBtn) {
                playPauseBtn.innerHTML = '\u25B6';
            }
            showControls();
            if (window._userAction) {
                stopWatchdog();
                window._userAction = false;
            }
        });

        videoEl.addEventListener('waiting', function () {
            if (loadingEl) {
                loadingEl.style.display = 'block';
            }
            rebufStart = Date.now();
            rebufCount += 1;
        });

        videoEl.addEventListener('seeking', function () {
            if (loadingEl) {
                loadingEl.style.display = 'block';
            }
            stopWatchdog();
        });

        videoEl.addEventListener('seeked', function () {
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
            if (!videoEl.paused) {
                startWatchdogDelayed();
            }
        });

        videoEl.addEventListener('playing', function () {
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
            startWatchdogDelayed();
            if (rebufStart > 0) {
                rebufDuration += Date.now() - rebufStart;
                rebufStart = 0;
            }
        });

        videoEl.addEventListener('canplay', function () {
            var errEl;

            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
            errEl = document.getElementById('player-error');
            if (errEl) {
                errEl.style.display = 'none';
            }
            clearStall();
            console.log('Can play. Player selected: ' + (videoEl.currentSrc || '(unknown)'));
        });

        videoEl.addEventListener('error', function () {
            var cur;
            var errCode;

            if (!isPlayerActive || (playerContainerEl && playerContainerEl.classList.contains('hidden'))) {
                return;
            }
            cur = videoEl.currentTime || 0;
            errCode = videoEl.error ? videoEl.error.code : 'unknown';
            console.error('Video error event: code=' + errCode + ' on ' + (videoEl.currentSrc || ''));
            if (cur > 5 && !videoEl.seeking && window._pendingSeekTime === undefined) {
                if (!isReconnecting) {
                    console.log('Watchdog: mid-stream error event at ' + cur.toFixed(2) + 's -> instant reconnect!');
                    reconnectStream(cur);
                } else {
                    console.log('Watchdog: mid-stream error ignored (reconnect already in flight)');
                }
            } else if (loadingEl) {
                loadingEl.style.display = 'none';
            }
        });

        videoEl.addEventListener('ended', function () {
            var cur;
            var dur;
            var dFallback;
            var rel;
            var cClaim;

            stopWatchdog();
            cur = videoEl.currentTime || 0;
            dur = videoEl.duration;
            dFallback = parseFloat(videoEl.getAttribute('data-duration')) || 0;
            if (!dur || isNaN(dur) || dur === Infinity) {
                dur = dFallback;
            }

            if (dur > 0 && (dur - cur) > 5) {
                console.log('Premature end detected (' + cur + ' / ' + dur + '). Auto-reconnecting...');
                reconnectStream(cur);
                return;
            }
            rel = dur > 0 ? (cur / dur * 100) : 0;
            if (window.OdyseeAPI && typeof OdyseeAPI.reportWatchmanPlayback === 'function') {
                OdyseeAPI.reportWatchmanPlayback(videoEl.currentSrc || '', dur, cur, rel, rebufCount, rebufDuration);
            }

            cClaim = window._activeClaim;
            if (cClaim && cClaim.claim_id && window.OdyseeAPI && typeof OdyseeAPI.saveResumePoint === 'function') {
                OdyseeAPI.saveResumePoint(cClaim.claim_id, 0, dur);
            }

            closePlayer();
        });

        videoEl.addEventListener('timeupdate', function () {
            var cur;
            var dur;
            var dFallback;
            var pct;
            var now;
            var cClaim;
            var uri;

            try {
                if (progressFillEl && progressFillEl.classList.contains('seeking')) {
                    return;
                }
                cur = videoEl.currentTime || 0;
                dur = videoEl.duration;
                dFallback = parseFloat(videoEl.getAttribute('data-duration')) || 0;
                if (!dur || isNaN(dur) || dur === Infinity) {
                    dur = dFallback;
                }
                pct = 0;
                if (dur && !isNaN(dur) && dur > 0) {
                    pct = (cur / dur * 100);
                }
                if (progressFillEl) {
                    progressFillEl.style.width = pct + '%';
                }
                if (timeDisplayEl) {
                    timeDisplayEl.textContent = Utils.formatDuration(cur, dur) + ' / ' + Utils.formatDuration(dur, dur);
                }

                now = Date.now();
                if (now - lastProgressReport >= 10000) {
                    lastProgressReport = now;
                    cClaim = window._activeClaim;
                    if (cClaim && cClaim.claim_id) {
                        if (window.OdyseeAPI && typeof OdyseeAPI.saveViewProgress === 'function') {
                            uri = cClaim.canonical_url || cClaim.permanent_url || cClaim.short_url || '';
                            OdyseeAPI.saveViewProgress(cClaim.claim_id, uri, cur);
                        }
                        if (window.OdyseeAPI && typeof OdyseeAPI.saveResumePoint === 'function') {
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
            var btnCommentsReFocus;
            var pf;
            var p;

            closeCommentsSidebar();
            btnCommentsReFocus = document.getElementById('btn-comments');
            if (btnCommentsReFocus) {
                pf = document.querySelectorAll('#player-container .focused');
                for (p = 0; p < pf.length; p++) {
                    pf[p].classList.remove('focused');
                }
                btnCommentsReFocus.classList.add('focused');
                if (window.SpatialNavigation && typeof SpatialNavigation.focusNode === 'function') {
                    SpatialNavigation.focusNode(btnCommentsReFocus);
                }
            }
        }
    };
}());

// Global backwards-compatibility aliases
var playVideo = Player.playVideo;
var closePlayer = Player.close;
window.stopWatchdog = Player.stopWatchdog;
