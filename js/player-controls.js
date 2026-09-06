// ---------------------------------------------------------------------------
// Player Controls, OSD Overlay & Key Navigation
// (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var PlayerControls = (function () {
    var hideTimer = null;
    var currentPlayerFocused = null;

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

    function getPlayerFocusedButton() {
        var playPauseBtn = document.getElementById('btn-play-pause');
        var el;

        if (currentPlayerFocused && document.contains(currentPlayerFocused)) {
            return currentPlayerFocused;
        }
        el = document.querySelector('.btn-player-reaction.focused, .btn-player-comments.focused, .btn-play-pause.focused, .related-card.focused');
        currentPlayerFocused = el || playPauseBtn;
        return currentPlayerFocused;
    }

    function hideControls() {
        var videoEl = document.getElementById('video-player');
        var customControlsEl = document.getElementById('custom-controls');
        var headerEl = document.getElementById('player-header');
        var playerTitleEl = document.getElementById('player-title');
        var shelfEl = document.getElementById('player-related-shelf');
        var playPauseBtn = document.getElementById('btn-play-pause');

        if (videoEl && !videoEl.paused) {
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
            if (typeof PlayerShelf !== 'undefined') {
                PlayerShelf.scrollVertical(0);
                PlayerShelf.setState(PlayerShelf.SHELF_STATE.HIDDEN);
                PlayerShelf.setOpen(false);
            }
            if (playPauseBtn) {
                setPlayerFocus(playPauseBtn);
            }
        }
    }

    function scheduleHide(delay) {
        var videoEl = document.getElementById('video-player');
        var timeout;
        var shelfState;

        clearTimeout(hideTimer);
        if (videoEl && !videoEl.paused) {
            shelfState = (typeof PlayerShelf !== 'undefined') ? PlayerShelf.getState() : 0;
            timeout = (typeof delay === 'number') ? delay : ((shelfState === 2) ? 25000 : 4000);
            hideTimer = setTimeout(hideControls, timeout);
        }
    }

    function showControls(delay) {
        var playerContainerEl = document.getElementById('player-container');
        var customControlsEl = document.getElementById('custom-controls');
        var headerEl = document.getElementById('player-header');
        var playerTitleEl = document.getElementById('player-title');
        var shelfEl = document.getElementById('player-related-shelf');
        var shelfState;

        if (playerContainerEl && !playerContainerEl.classList.contains('hidden')) {
            if (customControlsEl) {
                customControlsEl.classList.remove('fade-out');
            }
            if (headerEl) {
                headerEl.classList.remove('fade-out');
            } else if (playerTitleEl) {
                playerTitleEl.classList.remove('fade-out');
            }
            if (shelfEl && typeof PlayerShelf !== 'undefined') {
                shelfEl.classList.remove('fade-out');
                shelfState = PlayerShelf.getState();
                if (shelfState === PlayerShelf.SHELF_STATE.ACTIVE) {
                    shelfEl.classList.remove('peek');
                    shelfEl.classList.add('visible');
                } else {
                    shelfEl.classList.remove('visible');
                    shelfEl.classList.add('peek');
                    PlayerShelf.setState(PlayerShelf.SHELF_STATE.PEEK);
                }
            }
            scheduleHide(delay);
        }
    }

    function doSeek(direction) {
        var videoEl = document.getElementById('video-player');
        var progressFillEl = document.getElementById('progress-fill');
        var timeDisplayEl = document.getElementById('time-display');
        var dur = Player.getVideoDuration ? Player.getVideoDuration() : 0;
        var maxDur;
        var target;

        if (!videoEl) {
            return;
        }

        try {
            maxDur = dur > 0 ? dur : (videoEl.currentTime + direction + 100);
            target = Math.max(0, Math.min(maxDur, videoEl.currentTime + direction));

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

    function bindReactionButtons(claim) {
        var btnLike = document.getElementById('btn-like');
        var btnDislike = document.getElementById('btn-dislike');
        var countLike = document.getElementById('like-count');
        var countDislike = document.getElementById('dislike-count');
        var claimId = claim ? claim.claim_id : null;

        if (!claimId) {
            return;
        }

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
                        claim._cached_reactions = { like: 0, dislike: 0 };
                    }
                    claim._cached_reactions.like = newL;
                    claim._cached_reactions.myReaction = null;
                    UserData.react(claimId, 'like', true);
                } else {
                    btnLike.classList.add('active-like');
                    newL = curL + 1;
                    if (countLike) {
                        countLike.textContent = newL;
                    }
                    if (!claim._cached_reactions) {
                        claim._cached_reactions = { like: 0, dislike: 0 };
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
                    UserData.react(claimId, 'like', false);
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
                        claim._cached_reactions = { like: 0, dislike: 0 };
                    }
                    claim._cached_reactions.dislike = newD;
                    claim._cached_reactions.myReaction = null;
                    UserData.react(claimId, 'dislike', true);
                } else {
                    btnDislike.classList.add('active-dislike');
                    newD = curD + 1;
                    if (countDislike) {
                        countDislike.textContent = newD;
                    }
                    if (!claim._cached_reactions) {
                        claim._cached_reactions = { like: 0, dislike: 0 };
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
                    UserData.react(claimId, 'dislike', false);
                }
            };
        }
    }

    function renderReactions(claim, likes, dislikes, myRx) {
        var metaReactionsEl = document.getElementById('meta-reactions');
        var isAuth = Auth.isAuthenticated();
        var likeSvg = Icons.get('thumbs-up');
        var dislikeSvg = Icons.get('thumbs-down');
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
            bindReactionButtons(claim);

            if (myRx === undefined && claim && claim.claim_id) {
                UserData.getMyReaction(claim.claim_id, function (err, rx) {
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

    function init() {
        var playerContainerEl = document.getElementById('player-container');
        var videoEl = document.getElementById('video-player');
        var playPauseBtn = document.getElementById('btn-play-pause');
        var btnCommentsEl = document.getElementById('btn-comments');

        if (!playerContainerEl || !videoEl) {
            return;
        }

        if (btnCommentsEl) {
            btnCommentsEl.onclick = function (evt) {
                var c = window._activeClaim;

                if (evt) {
                    evt.stopPropagation();
                }
                if (c && c.claim_id && typeof PlayerComments !== 'undefined') {
                    PlayerComments.open(c.claim_id);
                }
            };
        }

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
            var targetCard;
            var prevCard;
            var nextCard;
            var shelfState;
            var cards;

            if (!playerContainerEl.classList.contains('hidden')) {
                e.stopPropagation();
                keyCode = e.keyCode;

                // --- Modal Navigation for Comments Sidebar ---
                if (typeof PlayerComments !== 'undefined' && PlayerComments.isOpen()) {
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
                        Player.close();
                        return;
                    }
                    if (keyCode === 461 || keyCode === 8 || keyCode === 27 || keyCode === 10009) {
                        e.preventDefault();
                        e.stopPropagation();
                        history.back();
                        return;
                    }
                    if (keyCode === 38) {
                        e.preventDefault();
                        listEl = document.getElementById('comments-list');
                        if (listEl) {
                            listEl.scrollTop = Math.max(0, listEl.scrollTop - 160);
                        }
                        return;
                    }
                    if (keyCode === 40) {
                        e.preventDefault();
                        listEl = document.getElementById('comments-list');
                        if (listEl) {
                            listEl.scrollTop = listEl.scrollTop + 160;
                        }
                        return;
                    }
                    return;
                }

                // Dedicated Hardware Media Keys
                if (keyCode === 415 || keyCode === 19 || keyCode === 179) {
                    e.preventDefault();
                    if (playPauseBtn) {
                        playPauseBtn.click();
                    }
                    return;
                }
                if (keyCode === 412) {
                    e.preventDefault();
                    showControls(4000);
                    doSeek(-10);
                    return;
                }
                if (keyCode === 417) {
                    e.preventDefault();
                    showControls(4000);
                    doSeek(10);
                    return;
                }
                if (keyCode === 413) {
                    e.preventDefault();
                    Player.close();
                    return;
                }

                wasHidden = document.getElementById('custom-controls') &&
                    document.getElementById('custom-controls').classList.contains('fade-out');

                if (keyCode === 13) {
                    e.preventDefault();
                    if (wasHidden) {
                        showControls();
                        return;
                    }
                    scheduleHide();
                    focusedBtn = getPlayerFocusedButton();
                    if (focusedBtn) {
                        focusedBtn.click();
                    }
                    return;
                }

                btnLike = document.getElementById('btn-like');
                btnDislike = document.getElementById('btn-dislike');
                btnComments = document.getElementById('btn-comments');

                if (keyCode === 403 && btnLike) {
                    e.preventDefault();
                    btnLike.click();
                    showControls();
                    return;
                }
                if (keyCode === 406 && btnComments) {
                    e.preventDefault();
                    btnComments.click();
                    showControls();
                    return;
                }

                if (keyCode === 37) {
                    e.preventDefault();
                    if (wasHidden) {
                        showControls(4000);
                        doSeek(-10);
                        return;
                    }
                    scheduleHide();
                    focusedBtn = getPlayerFocusedButton();
                    isRelatedCardFocused = focusedBtn && focusedBtn.classList.contains('related-card');
                    if (isRelatedCardFocused && typeof PlayerShelf !== 'undefined') {
                        curShelf = parseInt(focusedBtn.getAttribute('data-shelf'), 10) || 0;
                        curCol = parseInt(focusedBtn.getAttribute('data-index'), 10) || 0;
                        if (curCol > 0) {
                            prevCard = PlayerShelf.getCard(curShelf, curCol - 1);
                            if (prevCard) {
                                PlayerShelf.setIndex(curShelf, curCol - 1);
                                setPlayerFocus(prevCard);
                                PlayerShelf.scrollCardIntoView(prevCard, curCol - 1);
                            }
                        }
                    } else if (focusedBtn === btnComments) {
                        if (btnDislike) {
                            setPlayerFocus(btnDislike);
                        } else if (btnLike) {
                            setPlayerFocus(btnLike);
                        } else {
                            setPlayerFocus(playPauseBtn);
                        }
                    } else if (focusedBtn === btnDislike) {
                        if (btnLike) {
                            setPlayerFocus(btnLike);
                        } else {
                            setPlayerFocus(playPauseBtn);
                        }
                    } else if (focusedBtn === btnLike) {
                        setPlayerFocus(playPauseBtn);
                    } else if (focusedBtn === playPauseBtn) {
                        doSeek(-10);
                    }
                    return;
                }

                if (keyCode === 39) {
                    e.preventDefault();
                    if (wasHidden) {
                        showControls(4000);
                        doSeek(10);
                        return;
                    }
                    scheduleHide();
                    focusedBtn = getPlayerFocusedButton();
                    isRelatedCardFocused = focusedBtn && focusedBtn.classList.contains('related-card');
                    if (isRelatedCardFocused && typeof PlayerShelf !== 'undefined') {
                        curShelf = parseInt(focusedBtn.getAttribute('data-shelf'), 10) || 0;
                        curCol = parseInt(focusedBtn.getAttribute('data-index'), 10) || 0;
                        cards = PlayerShelf.getCards();
                        if (cards[curShelf] && curCol < cards[curShelf].length - 1) {
                            nextCard = PlayerShelf.getCard(curShelf, curCol + 1);
                            if (nextCard) {
                                PlayerShelf.setIndex(curShelf, curCol + 1);
                                setPlayerFocus(nextCard);
                                PlayerShelf.scrollCardIntoView(nextCard, curCol + 1);
                            }
                        }
                    } else if (focusedBtn === playPauseBtn) {
                        if (btnLike) {
                            setPlayerFocus(btnLike);
                        } else if (btnDislike) {
                            setPlayerFocus(btnDislike);
                        } else if (btnComments) {
                            setPlayerFocus(btnComments);
                        } else {
                            doSeek(10);
                        }
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
                        doSeek(10);
                    }
                    return;
                }

                if (keyCode === 38) {
                    e.preventDefault();
                    if (wasHidden) {
                        showControls();
                        return;
                    }
                    scheduleHide();
                    focusedBtn = getPlayerFocusedButton();
                    isRelatedCardFocused = focusedBtn && focusedBtn.classList.contains('related-card');
                    if (isRelatedCardFocused && typeof PlayerShelf !== 'undefined') {
                        curShelf = parseInt(focusedBtn.getAttribute('data-shelf'), 10) || 0;
                        curCol = parseInt(focusedBtn.getAttribute('data-index'), 10) || 0;
                        cards = PlayerShelf.getCards();
                        if (curShelf === 1 && cards[0] && cards[0].length > 0) {
                            PlayerShelf.setActiveRow(0);
                            PlayerShelf.scrollVertical(0);
                            upCard = PlayerShelf.getCard(0, Math.min(curCol, cards[0].length - 1));
                            if (upCard) {
                                setPlayerFocus(upCard);
                                PlayerShelf.scrollCardIntoView(upCard, Math.min(curCol, cards[0].length - 1));
                            }
                        } else {
                            setPlayerFocus(playPauseBtn);
                            scheduleHide(4000);
                        }
                    } else {
                        showControls(4000);
                    }
                    return;
                }

                if (keyCode === 40) {
                    e.preventDefault();
                    if (wasHidden) {
                        showControls();
                        return;
                    }
                    scheduleHide();
                    focusedBtn = getPlayerFocusedButton();
                    isRelatedCardFocused = focusedBtn && focusedBtn.classList.contains('related-card');
                    if (typeof PlayerShelf !== 'undefined') {
                        shelfState = PlayerShelf.getState();
                        cards = PlayerShelf.getCards();
                        if (!isRelatedCardFocused) {
                            if (shelfState === PlayerShelf.SHELF_STATE.PEEK || shelfState === PlayerShelf.SHELF_STATE.ACTIVE) {
                                PlayerShelf.setState(PlayerShelf.SHELF_STATE.ACTIVE);
                                PlayerShelf.setOpen(true);
                                targetCard = PlayerShelf.getCard(PlayerShelf.getActiveRow(), PlayerShelf.getIndex(PlayerShelf.getActiveRow()));
                                if (targetCard) {
                                    setPlayerFocus(targetCard);
                                    PlayerShelf.scrollCardIntoView(targetCard, PlayerShelf.getIndex(PlayerShelf.getActiveRow()));
                                    scheduleHide(25000);
                                    return;
                                }
                            }
                        } else {
                            curShelf = parseInt(focusedBtn.getAttribute('data-shelf'), 10) || 0;
                            curCol = parseInt(focusedBtn.getAttribute('data-index'), 10) || 0;
                            if (curShelf === 0 && cards[1] && cards[1].length > 0) {
                                PlayerShelf.setActiveRow(1);
                                PlayerShelf.scrollVertical(1);
                                downCard = PlayerShelf.getCard(1, Math.min(curCol, cards[1].length - 1));
                                if (downCard) {
                                    setPlayerFocus(downCard);
                                    PlayerShelf.scrollCardIntoView(downCard, Math.min(curCol, cards[1].length - 1));
                                }
                                scheduleHide(25000);
                                return;
                            }
                        }
                    }
                    return;
                }

                if (keyCode === 461 || keyCode === 8 || keyCode === 27 || keyCode === 10009) {
                    e.preventDefault();
                    if (typeof PlayerShelf !== 'undefined' && PlayerShelf.getState() === PlayerShelf.SHELF_STATE.ACTIVE) {
                        PlayerShelf.setState(PlayerShelf.SHELF_STATE.PEEK);
                        PlayerShelf.setOpen(false);
                        PlayerShelf.scrollVertical(0);
                        setPlayerFocus(playPauseBtn);
                        scheduleHide(4000);
                        return;
                    }
                    history.back();
                }
            }
        }, true);
    }

    return {
        init: init,
        show: showControls,
        hide: hideControls,
        scheduleHide: scheduleHide,
        doSeek: doSeek,
        bindReactions: bindReactionButtons,
        renderReactions: renderReactions,
        setFocus: setPlayerFocus,
        getFocusedButton: getPlayerFocusedButton
    };
}());
