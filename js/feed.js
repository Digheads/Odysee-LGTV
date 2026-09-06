// ---------------------------------------------------------------------------
// Video feed, grid rendering, cards, search & pagination
// (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var Feed = (function () {
    var currentPage = 1;
    var currentCategory = 'nav-trending';
    var currentSearchQuery = '';
    var isLoading = false;
    var hasMore = true;
    var isAppStartup = true;
    var lastOpenedPlaylistId = null;

    // Infinite scrolling never released the cards. DOM nodes cannot be deleted
    // (the .video-card:nth-child(4n) rule would shift, causing scroll jumps),
    // so we just drop the image src when far from the viewport. The .thumbnail-wrapper
    // holds the space with padding-bottom:56.25%, so the layout doesn't collapse.
    var IMG_KEEP_PX = 2500;

    function releaseOffscreenThumbs(scroller) {
        var cards;
        var top;
        var bottom;
        var i;
        var card;
        var img;
        var far;

        if (!scroller) {
            return;
        }
        cards = scroller.querySelectorAll('.video-card');
        top = scroller.scrollTop;
        bottom = top + scroller.clientHeight;
        for (i = 0; i < cards.length; i++) {
            card = cards[i];
            img = card.querySelector('img.thumbnail');
            if (!img) {
                continue;
            }
            far = (card.offsetTop + card.offsetHeight < top - IMG_KEEP_PX) ||
                (card.offsetTop > bottom + IMG_KEEP_PX);
            if (far && img.getAttribute('src')) {
                img.setAttribute('data-src', img.getAttribute('src'));
                img.removeAttribute('src');
            } else if (!far && !img.getAttribute('src') && img.getAttribute('data-src')) {
                img.setAttribute('src', img.getAttribute('data-src'));
            }
        }
    }

    function dispatchLoad(id, page, cb) {
        if (id === 'nav-trending') {
            return OdyseeAPI.getTrending(cb, page);
        }
        if (id === 'nav-following') {
            return UserData.getFollowingVideos(cb, page);
        }
        if (id === 'nav-watch-later') {
            return UserData.getWatchLaterVideos(cb, page);
        }
        if (id === 'nav-search') {
            return OdyseeAPI.search(currentSearchQuery, cb, page);
        }
        if (id.indexOf('cat:') === 0) {
            return OdyseeAPI.getCategory(id.substring(4), cb, page);
        }
        cb(new Error('Unknown view: ' + id));
    }

    function closePlaylistDetail(noRefresh, fromPopstate) {
        if (typeof PlaylistView !== 'undefined') {
            PlaylistView.closePlaylistDetail(noRefresh, fromPopstate);
        }
    }


    function loadPage(navId) {
        var cpEl;
        var vgEl;
        var topHdr;
        var videoGridEl;
        var loadingEl;
        var searchContainerEl;
        var searchInputEl;

        function handleLoaded(err, res) {
            var msg;
            var activeMenu;
            var i;
            var card;
            var firstVideo;

            isLoading = false;
            loadingEl.style.display = 'none';
            if (err) {
                msg = err.message || (typeof err === 'string' ? err : JSON.stringify(err));
                videoGridEl.innerHTML = '<div class="error" style="padding: 20px; color: #ff5555; font-size: 24px;">Failed to load content. ' + msg + '</div>';
                console.error(err);
                SpatialNavigation.refresh();
                activeMenu = document.querySelector('.nav-item.active');
                if (activeMenu) {
                    SpatialNavigation.focusNode(activeMenu);
                }
                SpatialNavigation.unlock();
                return;
            }
            if (res && res.items && res.items.length > 0) {
                if ((res.raw_count !== undefined ? res.raw_count : res.items.length) < 20) {
                    hasMore = false;
                }
                for (i = 0; i < res.items.length; i++) {
                    card = createVideoCard(res.items[i]);
                    if (card) {
                        videoGridEl.appendChild(card);
                    }
                }
            } else {
                hasMore = false;
                if (currentPage === 1 && navId === 'nav-following') {
                    videoGridEl.innerHTML = '<div class="playlists-empty" style="margin-top: 60px;">' +
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="#6B7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 20px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>' +
                        '<h3>No videos from followed channels</h3>' +
                        '<p>Follow channels on Odysee to see their latest uploads here.</p>' +
                        '</div>';
                }
            }
            SpatialNavigation.refresh();
            if (currentPage === 1) {
                firstVideo = videoGridEl.querySelector('.video-card');
                if (firstVideo) {
                    SpatialNavigation.focusNode(firstVideo);
                } else {
                    activeMenu = document.querySelector('.nav-item.active');
                    if (activeMenu) {
                        SpatialNavigation.focusNode(activeMenu);
                    }
                }
                isAppStartup = false;
            }
            SpatialNavigation.unlock();
        }

        Channel.close(true);
        window.isChannelPageOpen = false;

        cpEl = document.getElementById('channel-page');
        if (cpEl) {
            cpEl.style.display = 'none';
        }
        vgEl = document.getElementById('video-grid');
        if (vgEl) {
            vgEl.style.display = '';
        }
        topHdr = document.querySelector('.top-header');
        if (topHdr) {
            topHdr.style.display = 'block';
        }

        try {
            if (history.state && history.state.channelPage) {
                history.replaceState(null, '', '');
            }
        } catch (err) { }

        if (window.isPlaylistDetailOpen) {
            closePlaylistDetail(true, true);
        }
        window.isPlaylistDetailOpen = false;
        try {
            if (history.state && history.state.playlistDetail) {
                history.replaceState(null, '', '');
            }
        } catch (err) { }

        videoGridEl = document.getElementById('video-grid');
        loadingEl = document.getElementById('loading');
        searchContainerEl = document.getElementById('search-container');
        searchInputEl = document.getElementById('search-input');

        currentPage = 1;
        currentCategory = navId;
        currentSearchQuery = '';
        hasMore = true;
        isLoading = true;

        Navigation.setActive(navId);
        SpatialNavigation.lock();

        videoGridEl.innerHTML = '';
        loadingEl.style.display = 'block';

        if (navId === 'nav-search') {
            isLoading = false;
            SpatialNavigation.unlock();
            Utils.setDisplayFlex(searchContainerEl);
            loadingEl.style.display = 'none';
            SpatialNavigation.refresh();
            if (searchInputEl) {
                setTimeout(function () {
                    searchInputEl.focus();
                }, 100);
            }
            return;
        }

        if (navId === 'nav-login') {
            isLoading = false;
            hasMore = false;
            SpatialNavigation.unlock();
            searchContainerEl.style.display = 'none';
            loadingEl.style.display = 'none';
            if (typeof AccountView !== 'undefined') {
                AccountView.renderLogin(videoGridEl, function () {
                    loadPage('nav-profile');
                });
            }
            return;
        }

        if (navId === 'nav-profile') {
            isLoading = false;
            hasMore = false;
            SpatialNavigation.unlock();
            searchContainerEl.style.display = 'none';
            loadingEl.style.display = 'none';
            if (typeof AccountView !== 'undefined') {
                AccountView.renderProfile(videoGridEl, function () {
                    loadPage('nav-trending');
                });
            }
            return;
        }

        if (navId === 'nav-playlists') {
            isLoading = false;
            hasMore = false;
            SpatialNavigation.unlock();
            searchContainerEl.style.display = 'none';
            loadingEl.style.display = 'none';
            if (typeof PlaylistView !== 'undefined') {
                PlaylistView.renderPlaylistsView(videoGridEl);
            }
            return;
        }

        searchContainerEl.style.display = 'none';
        dispatchLoad(navId, currentPage, handleLoaded);
    }

    function doSearch(query) {
        var videoGridEl = document.getElementById('video-grid');
        var loadingEl = document.getElementById('loading');

        if (isLoading && currentSearchQuery === query) {
            return;
        }

        currentPage = 1;
        currentCategory = 'nav-search';
        currentSearchQuery = query;
        hasMore = true;
        isLoading = true;

        videoGridEl.innerHTML = '';
        loadingEl.style.display = 'block';

        OdyseeAPI.search(query, function (err, res) {
            var msg;
            var i;
            var card;
            var first;

            isLoading = false;
            loadingEl.style.display = 'none';
            if (err) {
                msg = err.message || (typeof err === 'string' ? err : JSON.stringify(err));
                videoGridEl.innerHTML = '<div class="error" style="padding: 20px; color: #ff5555; font-size: 24px;">Search failed. ' + msg + '</div>';
                console.error(err);
                SpatialNavigation.refresh();
                return;
            }
            if (res && res.items && res.items.length > 0) {
                if ((res.raw_count !== undefined ? res.raw_count : res.items.length) < 20) {
                    hasMore = false;
                }
                for (i = 0; i < res.items.length; i++) {
                    card = createVideoCard(res.items[i]);
                    if (card) {
                        videoGridEl.appendChild(card);
                    }
                }
            } else {
                hasMore = false;
                videoGridEl.innerHTML = '<div style="color:white;text-align:center;width:100%;font-size:24px;margin-top:50px;">No results found.</div>';
            }
            SpatialNavigation.refresh();
            setTimeout(function () {
                first = videoGridEl.querySelector('.video-card');
                if (first) {
                    first.focus();
                }
            }, 100);
        }, currentPage);
    }

    function loadMoreContent() {
        var loadingEl;
        var videoGridEl;

        if (isLoading || !hasMore || (currentCategory === 'nav-search' && !currentSearchQuery)) {
            return;
        }

        isLoading = true;
        currentPage += 1;
        loadingEl = document.getElementById('loading');
        if (loadingEl) {
            loadingEl.style.display = 'block';
        }

        videoGridEl = document.getElementById('video-grid');

        function appendCards(err, res) {
            var i;
            var card;

            isLoading = false;
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
            if (err) {
                console.error('Load more failed', err);
                return;
            }
            if (res && res.items && res.items.length > 0) {
                if ((res.raw_count !== undefined ? res.raw_count : res.items.length) < 20) {
                    hasMore = false;
                }
                for (i = 0; i < res.items.length; i++) {
                    card = createVideoCard(res.items[i]);
                    if (card) {
                        videoGridEl.appendChild(card);
                    }
                }
                SpatialNavigation.refresh();
            } else {
                hasMore = false;
            }
        }

        dispatchLoad(currentCategory, currentPage, appendCards);
    }

    function createVideoCard(claim) {
        var title;
        var thumb;
        var chName;
        var channelTitle;
        var rawAvatarUrl;
        var avatarUrl;
        var isSpaceman;
        var chColor;
        var ts;
        var uploadDate;
        var duration;
        var durationText;
        var h;
        var m;
        var s;
        var durationHtml;
        var progressHtml;
        var rp;
        var pct;
        var cardEl;
        var avatarHtml;
        var ptrIsDown;
        var ptrTimer;
        var ptrLongPressed;

        function cancelPointer() {
            if (ptrIsDown) {
                ptrIsDown = false;
                if (ptrTimer) {
                    clearTimeout(ptrTimer);
                    ptrTimer = null;
                }
                if (!ptrLongPressed) {
                    window.lastFocusedCard = cardEl;
                    Player.playVideo(claim);
                }
            }
        }

        if (!claim.value) {
            return null;
        }

        title = claim.value.title || 'Untitled';
        thumb = Utils.thumbUrl(claim.value.thumbnail ? claim.value.thumbnail.url : '');
        chName = claim.signing_channel ? (claim.signing_channel.name || '') : '';
        channelTitle = claim.signing_channel && claim.signing_channel.value ? claim.signing_channel.value.title || claim.signing_channel.name : (chName || 'Unknown');
        rawAvatarUrl = claim.signing_channel && claim.signing_channel.value && claim.signing_channel.value.thumbnail ? claim.signing_channel.value.thumbnail.url : '';
        avatarUrl = Utils.getAvatarSrc(rawAvatarUrl, 64);
        isSpaceman = (!avatarUrl || avatarUrl === 'icons/spaceman.png');
        chColor = isSpaceman ? Utils.getAvatarColor(chName) : 'transparent';
        ts = claim.value && claim.value.release_time ? claim.value.release_time : (claim.meta && claim.meta.creation_timestamp ? claim.meta.creation_timestamp : 0);
        uploadDate = Utils.formatRelativeTime(ts);

        duration = claim.value && claim.value.video ? claim.value.video.duration : 0;
        durationText = duration > 0 ? Utils.formatDuration(duration) : '';
        durationHtml = durationText ? '<div class="duration-overlay">' + durationText + '</div>' : '';

        // Resume progress bar
        progressHtml = '';
        if (claim.claim_id) {
            rp = UserData.getResumePoint(claim.claim_id);
            if (rp && rp.time > 0 && rp.duration > 0) {
                pct = Math.min(Math.round((rp.time / rp.duration) * 100), 100);
                if (pct > 0) {
                    progressHtml = '<div class="resume-progress-bar"><div class="resume-progress-fill" style="width:' + pct + '%"></div></div>';
                }
            }
        }

        cardEl = document.createElement('div');
        cardEl.tabIndex = 0;
        cardEl.className = 'video-card focusable';
        if (claim.claim_id) {
            cardEl.setAttribute('data-claim-id', claim.claim_id);
        }

        avatarHtml = '<img class="channel-avatar" src="' + Utils.escapeHtml(avatarUrl) + '" style="background-color:' + chColor + ';" onerror="this.src=\'icons/spaceman.png\'" />';
        cardEl.innerHTML = '<div class="thumbnail-wrapper"><img class="thumbnail" src="' + Utils.escapeHtml(thumb) + '" />' + durationHtml + progressHtml + '</div><div class="info"><div class="title">' + Utils.escapeHtml(title) + '</div><div class="channel-meta">' + avatarHtml + '<div class="channel-text"><div class="channel">' + Utils.escapeHtml(channelTitle) + '</div><div class="card-date">' + Utils.escapeHtml(uploadDate) + '</div></div></div></div>';

        ptrIsDown = false;
        ptrTimer = null;
        ptrLongPressed = false;

        cardEl.addEventListener('mousedown', function () {
            ptrIsDown = true;
            ptrLongPressed = false;
            ptrTimer = setTimeout(function () {
                ptrLongPressed = true;
                if (claim.signing_channel) {
                    window.lastFocusedCard = cardEl;
                    Channel.open(claim.signing_channel);
                }
            }, 1200);
        });

        cardEl.addEventListener('touchstart', function () {
            ptrIsDown = true;
            ptrLongPressed = false;
            ptrTimer = setTimeout(function () {
                ptrLongPressed = true;
                if (claim.signing_channel) {
                    window.lastFocusedCard = cardEl;
                    Channel.open(claim.signing_channel);
                }
            }, 1200);
        });

        cardEl.addEventListener('mouseup', cancelPointer);
        cardEl.addEventListener('touchend', cancelPointer);

        cardEl.addEventListener('mouseleave', function () {
            ptrIsDown = false;
            if (ptrTimer) {
                clearTimeout(ptrTimer);
                ptrTimer = null;
            }
        });

        cardEl.addEventListener('touchcancel', function () {
            ptrIsDown = false;
            if (ptrTimer) {
                clearTimeout(ptrTimer);
                ptrTimer = null;
            }
        });

        cardEl.addEventListener('longpress', function () {
            if (claim.signing_channel) {
                window.lastFocusedCard = cardEl;
                Channel.open(claim.signing_channel);
            }
        });

        cardEl.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();

            if (ptrIsDown || ptrLongPressed || (SpatialNavigation.isLongPressed && SpatialNavigation.isLongPressed())) {
                return;
            }
            if (ev.screenX > 0 || ev.screenY > 0) {
                return;
            }

            if (typeof Channel !== 'undefined' && Channel.isOpen()) {
                if (Channel.setLastFocusedCard) {
                    Channel.setLastFocusedCard(cardEl);
                } else {
                    window.lastFocusedChannelCard = cardEl;
                }
            } else {
                window.lastFocusedCard = cardEl;
            }
            Player.playVideo(claim);
        });

        return cardEl;
    }

    function updateCardProgress(claimId) {
        var cards;
        var rp;
        var pct;
        var i;
        var card;
        var wrapper;
        var bar;
        var fill;

        if (!claimId) {
            return;
        }
        cards = document.querySelectorAll('.video-card[data-claim-id="' + claimId + '"]');
        rp = UserData.getResumePoint(claimId);
        pct = (rp && rp.time > 0 && rp.duration > 0) ? Math.min(Math.round((rp.time / rp.duration) * 100), 100) : 0;

        for (i = 0; i < cards.length; i++) {
            card = cards[i];
            wrapper = card.querySelector('.thumbnail-wrapper');
            if (!wrapper) {
                continue;
            }
            bar = wrapper.querySelector('.resume-progress-bar');
            if (pct > 0) {
                if (!bar) {
                    bar = document.createElement('div');
                    bar.className = 'resume-progress-bar';
                    bar.innerHTML = '<div class="resume-progress-fill"></div>';
                    wrapper.appendChild(bar);
                }
                fill = bar.querySelector('.resume-progress-fill');
                if (fill) {
                    fill.style.width = pct + '%';
                }
            } else if (bar) {
                wrapper.removeChild(bar);
            }
        }
    }

    function initSearch() {
        var searchBtn = document.getElementById('btn-search');
        var searchInput = document.getElementById('search-input');

        function triggerSearch() {
            var val;
            var btn;

            if (!searchInput) {
                return;
            }
            val = searchInput.value.trim();
            if (val.length > 0) {
                searchInput.blur();
                btn = document.getElementById('btn-search');
                if (btn) {
                    SpatialNavigation.focusNode(btn);
                }
                doSearch(val);
            }
        }

        if (searchBtn && searchInput) {
            searchBtn.addEventListener('click', triggerSearch);
            searchInput.addEventListener('keydown', function (e) {
                if (e.keyCode === 13) {
                    e.preventDefault();
                    triggerSearch();
                }
            });
            searchInput.addEventListener('focus', function () {
                SpatialNavigation.focusNode(searchInput);
            });
        }
    }

    return {
        loadPage: loadPage,
        doSearch: doSearch,
        loadMoreContent: loadMoreContent,
        createVideoCard: createVideoCard,
        updateCardProgress: updateCardProgress,
        releaseOffscreenThumbs: releaseOffscreenThumbs,
        initSearch: initSearch,
        renderPlaylistsView: function (containerEl) {
            if (typeof PlaylistView !== 'undefined') {
                PlaylistView.renderPlaylistsView(containerEl);
            }
        },
        closePlaylistDetail: closePlaylistDetail,
        getCurrentCategory: function () {
            return currentCategory;
        }
    };
}());

