// ---------------------------------------------------------------------------
// Playlist views: Playlists grid & Playlist detail video list
// (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var PlaylistView = (function () {
    var isDetailOpen = false;
    var currentPlaylist = null;
    var lastOpenedPlaylistId = null;

    function renderPlaylistsView(containerEl) {
        var loadingEl;

        isDetailOpen = false;
        currentPlaylist = null;
        window.isPlaylistDetailOpen = false;
        window.currentOpenPlaylist = null;

        if (!containerEl) {
            return;
        }

        loadingEl = document.getElementById('loading');
        if (loadingEl) {
            loadingEl.style.display = 'block';
        }
        containerEl.innerHTML = '';

        SpatialNavigation.refresh();

        UserData.getUserPlaylists(function (err, playlists) {
            var html;
            var grid;
            var i;

            if (loadingEl) {
                loadingEl.style.display = 'none';
            }

            if (err) {
                containerEl.innerHTML = '<div class="playlists-empty">' +
                    '<h3>Failed to load playlists</h3>' +
                    '<p>' + (err.message || 'An error occurred.') + '</p>' +
                    '</div>';
                SpatialNavigation.refresh();
                return;
            }

            if (!playlists || !playlists.length) {
                containerEl.innerHTML = '<div class="playlists-empty">' +
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="#6B7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 20px;"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>' +
                    '<h3>No playlists found</h3>' +
                    '<p>Playlists and Watch Later from your Odysee account will appear here.</p>' +
                    '</div>';
                SpatialNavigation.refresh();
                return;
            }

            html = '<div class="playlists-container">' +
                '<div class="playlists-grid" id="playlists-grid"></div>' +
                '</div>';
            containerEl.innerHTML = html;

            grid = document.getElementById('playlists-grid');
            for (i = 0; i < playlists.length; i++) {
                (function (pl) {
                    var card = document.createElement('div');
                    var hasVideo = pl.itemCount > 0 && pl.items && pl.items.length > 0;
                    var thumbSrc = (hasVideo && pl.thumbnailUrl) ? (Utils.thumbUrl(pl.thumbnailUrl, 400)) : 'icons/missing-thumb.png';
                    var countText = pl.itemCount + (pl.itemCount === 1 ? ' video' : ' videos');
                    var badgeText = pl.badge || 'Playlist';

                    card.className = 'playlist-card focusable';
                    card.tabIndex = 0;
                    card.setAttribute('data-id', pl.id);

                    card.innerHTML = '<div class="playlist-thumb-wrap">' +
                        '<img class="playlist-thumb" src="' + Utils.escapeHtml(thumbSrc) + '" onerror="this.src=\'icons/missing-thumb.png\'" />' +
                        '<div class="playlist-count-badge">' +
                        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 5px;"><line x1="8" y1="6" x2="21" y2="6" stroke="currentColor" stroke-width="2"></line><line x1="8" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="2"></line><line x1="8" y1="18" x2="21" y2="18" stroke="currentColor" stroke-width="2"></line><polygon points="3 6 3 18 6 12"></polygon></svg>' +
                        countText +
                        '</div>' +
                        '<div class="playlist-type-pill">' + Utils.escapeHtml(badgeText) + '</div>' +
                        '</div>' +
                        '<div class="playlist-info">' +
                        '<div class="playlist-title">' + Utils.escapeHtml(pl.name) + '</div>' +
                        '<div class="playlist-subtitle">' + countText + '</div>' +
                        '</div>';

                    card.addEventListener('click', function () {
                        openPlaylistDetail(pl, containerEl);
                    });

                    grid.appendChild(card);
                }(playlists[i]));
            }

            SpatialNavigation.refresh();
            setTimeout(function () {
                var target;
                var firstCard;
                var activeMenu;

                if (lastOpenedPlaylistId && grid) {
                    target = grid.querySelector('.playlist-card[data-id="' + lastOpenedPlaylistId + '"]');
                    if (target) {
                        SpatialNavigation.focusNode(target);
                        lastOpenedPlaylistId = null;
                        return;
                    }
                }
                firstCard = grid ? grid.querySelector('.playlist-card') : null;
                if (firstCard) {
                    SpatialNavigation.focusNode(firstCard);
                } else {
                    activeMenu = document.querySelector('.nav-item.active');
                    if (activeMenu) {
                        SpatialNavigation.focusNode(activeMenu);
                    }
                }
            }, 100);
        });
    }

    function openPlaylistDetail(playlist, containerEl) {
        isDetailOpen = true;
        currentPlaylist = playlist;
        lastOpenedPlaylistId = playlist.id;
        window.isPlaylistDetailOpen = true;
        window.currentOpenPlaylist = playlist;

        try {
            history.pushState({ playlistDetail: true }, '', '');
        } catch (e) { }

        if (!containerEl) {
            containerEl = document.getElementById('video-grid');
        }
        if (!containerEl) {
            return;
        }

        containerEl.innerHTML = '<div class="playlist-detail-container">' +
            '<div id="playlist-detail-loading" class="loading-spinner" style="display: block;">Loading...</div>' +
            '<div class="playlist-detail-grid" id="playlist-detail-grid"></div>' +
            '</div>';

        SpatialNavigation.refresh();

        UserData.getPlaylistVideos(playlist, function (err, res) {
            var loadingEl = document.getElementById('playlist-detail-loading');
            var grid;
            var activeMenu;
            var i;
            var card;

            if (loadingEl) {
                loadingEl.style.display = 'none';
            }

            grid = document.getElementById('playlist-detail-grid');
            if (!grid) {
                return;
            }

            if (err || !res || !res.items || !res.items.length) {
                grid.innerHTML = '<div class="playlists-empty">' +
                    '<h3>No videos in this playlist</h3>' +
                    '<p>Videos in this playlist will appear here.</p>' +
                    '</div>';
                SpatialNavigation.refresh();
                activeMenu = document.querySelector('.nav-item.active');
                if (activeMenu) {
                    SpatialNavigation.focusNode(activeMenu);
                }
                return;
            }

            grid.innerHTML = '';
            for (i = 0; i < res.items.length; i++) {
                card = Feed.createVideoCard(res.items[i]);
                if (card) {
                    grid.appendChild(card);
                }
            }

            SpatialNavigation.refresh();
            setTimeout(function () {
                var firstCard = grid.querySelector('.video-card');
                var menuEl;

                if (firstCard) {
                    SpatialNavigation.focusNode(firstCard);
                } else {
                    menuEl = document.querySelector('.nav-item.active');
                    if (menuEl) {
                        SpatialNavigation.focusNode(menuEl);
                    }
                }
            }, 100);
        }, 1);
    }

    function closePlaylistDetail(noRefresh, fromPopstate) {
        var videoGridEl;

        if (!isDetailOpen && !window.isPlaylistDetailOpen) {
            return;
        }
        isDetailOpen = false;
        currentPlaylist = null;
        window.isPlaylistDetailOpen = false;
        window.currentOpenPlaylist = null;

        if (!fromPopstate && window.history && history.state && history.state.playlistDetail) {
            try {
                history.back();
            } catch (e) { }
        }

        if (!noRefresh) {
            videoGridEl = document.getElementById('video-grid');
            if (videoGridEl) {
                renderPlaylistsView(videoGridEl);
            }
        }
    }

    return {
        renderPlaylistsView: renderPlaylistsView,
        openPlaylistDetail: openPlaylistDetail,
        closePlaylistDetail: closePlaylistDetail,
        isOpen: function () {
            return isDetailOpen || !!window.isPlaylistDetailOpen;
        },
        getCurrentPlaylist: function () {
            return currentPlaylist;
        }
    };
}());
