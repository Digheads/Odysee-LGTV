// ---------------------------------------------------------------------------
// Player Related & Channel Shelves (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var PlayerShelf = (function () {
    var SHELF_STATE = {
        HIDDEN: 0,
        PEEK: 1,
        ACTIVE: 2
    };
    var currentShelfState = SHELF_STATE.HIDDEN;
    var isRelatedShelfOpen = false;
    var activeShelfRow = 0;
    var shelfIndices = [0, 0];
    var cachedShelfCards = [[], []];

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
            avUrl = Utils.getAvatarSrc(rawAvatar, 64);
            isSpaceman = (!avUrl || avUrl === 'icons/spaceman.png');
            chColor = isSpaceman ? Utils.getAvatarColor(ch.name) : 'transparent';
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

    function resetAndLoad(claim) {
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

        if (claim) {
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

    function hide() {
        var shelf = document.getElementById('player-related-shelf');
        var scrollEl = document.getElementById('player-shelves-scroll');

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

    return {
        SHELF_STATE: SHELF_STATE,
        updateHeader: updatePlayerChannelHeader,
        load: resetAndLoad,
        hide: hide,
        scrollVertical: scrollShelvesVertical,
        scrollCardIntoView: scrollRelatedCardIntoView,
        getCard: getCardAtShelf,
        getState: function () { return currentShelfState; },
        setState: function (st) { currentShelfState = st; },
        isOpen: function () { return isRelatedShelfOpen; },
        setOpen: function (val) { isRelatedShelfOpen = val; },
        getActiveRow: function () { return activeShelfRow; },
        setActiveRow: function (r) { activeShelfRow = r; },
        getIndex: function (r) { return shelfIndices[r] || 0; },
        setIndex: function (r, idx) { shelfIndices[r] = idx; },
        getCards: function () { return cachedShelfCards; }
    };
}());
