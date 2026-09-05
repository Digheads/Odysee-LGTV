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

    // Infinite scrolling never released the cards. DOM nodes cannot be deleted
    // (the .video-card:nth-child(4n) rule would shift, causing scroll jumps),
    // so we just drop the image src when far from the viewport. The .thumbnail-wrapper
    // holds the space with padding-bottom:56.25%, so the layout doesn't collapse.
    var IMG_KEEP_PX = 2500;

    function releaseOffscreenThumbs(scroller) {
        if (!scroller) return;
        var cards = scroller.querySelectorAll(".video-card"),
            top = scroller.scrollTop,
            bottom = top + scroller.clientHeight;
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i],
                img = card.querySelector("img.thumbnail");
            if (!img) continue;
            var far = (card.offsetTop + card.offsetHeight < top - IMG_KEEP_PX) ||
                (card.offsetTop > bottom + IMG_KEEP_PX);
            if (far && img.getAttribute("src")) {
                img.setAttribute("data-src", img.getAttribute("src"));
                img.removeAttribute("src");
            } else if (!far && !img.getAttribute("src") && img.getAttribute("data-src")) {
                img.setAttribute("src", img.getAttribute("data-src"));
            }
        }
    }

    function dispatchLoad(id, page, cb) {
        if ("nav-trending" === id) return OdyseeAPI.getTrending(cb, page);
        if ("nav-following" === id) return OdyseeAPI.getFollowingVideos(cb, page);
        if ("nav-watch-later" === id) return OdyseeAPI.getWatchLaterVideos(cb, page);
        if ("nav-search" === id) return OdyseeAPI.search(currentSearchQuery, cb, page);
        if (0 === id.indexOf("cat:")) return OdyseeAPI.getCategory(id.substring(4), cb, page);
        cb(new Error("Unknown view: " + id));
    }

    function renderLoginView(t) {
        t.innerHTML = '<div class="login-card">' +
            '<h2 class="login-title">Log in to your Odysee account</h2>' +
            '<p class="login-step">1. Go to the following address on your phone or computer:</p>' +
            '<div class="login-url">odysee.com/$/activate</div>' +
            '<p class="login-step">2. Enter this activation code:</p>' +
            '<div class="login-code-box" id="login-code-box">....-....</div>' +
            '<div class="login-status" id="login-status-box">' +
            '<span class="login-spinner"></span><span class="login-status-text">Waiting for confirmation on your device...</span>' +
            '</div>' +
            '<button class="focusable btn-login-action" id="btn-login-refresh" style="display:none;">Request a new code</button>' +
            '</div>';

        SpatialNavigation.refresh();

        if (window.Auth && typeof Auth.startDeviceFlow === "function") {
            Auth.startDeviceFlow(
                function (info) {
                    var codeBox = document.getElementById("login-code-box");
                    if (codeBox) codeBox.textContent = info.userCode;
                    var refreshBtn = document.getElementById("btn-login-refresh");
                    if (refreshBtn) refreshBtn.style.display = "none";
                },
                function (user) {
                    var statusBox = document.getElementById("login-status-box");
                    if (statusBox) statusBox.innerHTML = '<span style="color:#4ade80;">✓ Successful login!</span>';
                    setTimeout(function () {
                        loadPage("nav-profile");
                    }, 1200);
                },
                function (err) {
                    var statusBox = document.getElementById("login-status-box");
                    if (statusBox) statusBox.innerHTML = '<span style="color:#f87171;">' + (err.message || "An activation error occurred.") + '</span>';
                    var refreshBtn = document.getElementById("btn-login-refresh");
                    if (refreshBtn) {
                        refreshBtn.style.display = "inline-block";
                        SpatialNavigation.refresh();
                        refreshBtn.onclick = function () {
                            renderLoginView(t);
                        };
                    }
                }
            );
        }
    }

    function renderProfileView(t) {
        var user = (window.Auth && Auth.getUser) ? Auth.getUser() : {};
        var settings = (window.Auth && Auth.getSettings) ? Auth.getSettings() : { hideMature: true, hideShorts: true, hideYoutube: false };

        var rawAvatar = (window.Auth && Auth.getAvatarUrl) ? Auth.getAvatarUrl() : (user.avatarUrl || "icons/spaceman.png");
        var avatarSrc = (window.Utils && Utils.getAvatarSrc) ? Utils.getAvatarSrc(rawAvatar, 160) : rawAvatar;
        var isSpaceman = (!avatarSrc || avatarSrc === "icons/spaceman.png");
        var chName = user ? (user.channelName || "") : "";
        var avatarColor = (isSpaceman && window.Utils && Utils.getAvatarColor) ? Utils.getAvatarColor(chName) : "transparent";

        var displayName = user.channelName || (user.email ? user.email.split("@")[0] : "Odysee User");
        if (0 !== displayName.indexOf("@") && user.channelName) displayName = "@" + displayName;
        var emailDisplay = user.email || "";
        var followersText = (user.followers || 0) + " followers";

        var wrapStyle = isSpaceman ? ' style="background-color: ' + avatarColor + ';"' : '';
        var imgStyle = isSpaceman ? ' style="background-color: ' + avatarColor + ';"' : '';

        var html = '<div class="profile-view">' +
            '<div class="profile-header-card">' +
            '<div class="profile-avatar-wrap"' + wrapStyle + '>' +
            '<img src="' + avatarSrc + '" class="profile-avatar-img"' + imgStyle + ' alt="Avatar" onerror="this.src=\'icons/spaceman.png\'">' +
            '</div>' +
            '<div class="profile-meta-wrap">' +
            '<div class="profile-display-name">' + (window.Utils && Utils.escapeHtml ? Utils.escapeHtml(displayName) : displayName) + '</div>' +
            (emailDisplay ? '<div class="profile-email">' + (window.Utils && Utils.escapeHtml ? Utils.escapeHtml(emailDisplay) : emailDisplay) + '</div>' : '') +
            '<div class="profile-followers-badge">' + followersText + '</div>' +
            '</div>' +
            '<div class="profile-header-actions">' +
            '<button class="focusable btn-profile-logout" id="btn-logout">Log Out</button>' +
            '</div>' +
            '</div>' +

            '<div class="profile-settings-card">' +
            '<h3 class="profile-settings-title">Settings</h3>' +

            '<div class="setting-row">' +
            '<div class="setting-info">' +
            '<div class="setting-name">Hide mature content</div>' +
            '<div class="setting-desc">You will not see adult (18+) content.</div>' +
            '</div>' +
            '<button class="focusable btn-setting-toggle ' + (settings.hideMature ? 'toggle-active' : '') + '" id="toggle-mature">' +
            (settings.hideMature ? 'ON' : 'OFF') +
            '</button>' +
            '</div>' +

            '<div class="setting-row">' +
            '<div class="setting-info">' +
            '<div class="setting-name">Hide short content</div>' +
            '<div class="setting-desc">You will not see vertical videos less than 3 minutes.</div>' +
            '</div>' +
            '<button class="focusable btn-setting-toggle ' + (settings.hideShorts ? 'toggle-active' : '') + '" id="toggle-shorts">' +
            (settings.hideShorts ? 'ON' : 'OFF') +
            '</button>' +
            '</div>' +

            '<div class="setting-row">' +
            '<div class="setting-info">' +
            '<div class="setting-name">Hide synced YouTube videos</div>' +
            '<div class="setting-desc">You will not see videos that are synced from YouTube.</div>' +
            '</div>' +
            '<button class="focusable btn-setting-toggle ' + (settings.hideYoutube ? 'toggle-active' : '') + '" id="toggle-youtube">' +
            (settings.hideYoutube ? 'ON' : 'OFF') +
            '</button>' +
            '</div>' +
            '</div>' +
            '</div>';

        t.innerHTML = html;
        SpatialNavigation.refresh();

        var logoutBtn = document.getElementById("btn-logout");
        if (logoutBtn) {
            logoutBtn.addEventListener("click", function () {
                if (window.Auth && Auth.logout) {
                    Auth.logout(function () {
                        loadPage("nav-trending");
                    });
                }
            });
        }

        function setupToggle(btnId, settingKey) {
            var btn = document.getElementById(btnId);
            if (!btn) return;
            btn.addEventListener("click", function () {
                var currentVal = !!settings[settingKey];
                var nextVal = !currentVal;
                settings[settingKey] = nextVal;
                if (window.Auth && Auth.updateSetting) {
                    Auth.updateSetting(settingKey, nextVal);
                }
                btn.textContent = nextVal ? "ON" : "OFF";
                if (nextVal) {
                    btn.classList.add("toggle-active");
                } else {
                    btn.classList.remove("toggle-active");
                }
            });
        }

        setupToggle("toggle-mature", "hideMature");
        setupToggle("toggle-shorts", "hideShorts");
        setupToggle("toggle-youtube", "hideYoutube");

        setTimeout(function () {
            if (logoutBtn) {
                logoutBtn.focus();
                if (window.SpatialNavigation && typeof SpatialNavigation.focusNode === "function") {
                    SpatialNavigation.refresh();
                    SpatialNavigation.focusNode(logoutBtn);
                }
            }
        }, 100);
    }

    window.isPlaylistDetailOpen = false;
    window.currentOpenPlaylist = null;

    function renderPlaylistsView(t) {
        window.isPlaylistDetailOpen = false;
        window.currentOpenPlaylist = null;

        var loadingEl = document.getElementById("loading");
        if (loadingEl) loadingEl.style.display = "block";
        t.innerHTML = "";

        SpatialNavigation.refresh();

        if (window.OdyseeAPI && typeof OdyseeAPI.getPlaylists === "function") {
            OdyseeAPI.getPlaylists(function (err, playlists) {
                if (loadingEl) loadingEl.style.display = "none";

                if (err) {
                    t.innerHTML = '<div class="playlists-empty">' +
                        '<h3>Failed to load playlists</h3>' +
                        '<p>' + (err.message || "An error occurred.") + '</p>' +
                        '</div>';
                    SpatialNavigation.refresh();
                    return;
                }

                if (!playlists || !playlists.length) {
                    t.innerHTML = '<div class="playlists-empty">' +
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="#6B7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 20px;"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>' +
                        '<h3>No playlists found</h3>' +
                        '<p>Playlists and Watch Later from your Odysee account will appear here.</p>' +
                        '</div>';
                    SpatialNavigation.refresh();
                    return;
                }

                var html = '<div class="playlists-container">' +
                    '<div class="playlists-grid" id="playlists-grid"></div>' +
                    '</div>';
                t.innerHTML = html;

                var grid = document.getElementById("playlists-grid");
                for (var i = 0; i < playlists.length; i++) {
                    (function (pl) {
                        var card = document.createElement("div");
                        card.className = "playlist-card focusable";
                        card.tabIndex = 0;
                        card.setAttribute("data-id", pl.id);

                        var hasVideo = pl.itemCount > 0 && pl.items && pl.items.length > 0;
                        var thumbSrc = (hasVideo && pl.thumbnailUrl) ? (Utils.thumbUrl(pl.thumbnailUrl, 400)) : "icons/missing-thumb.png";
                        var countText = pl.itemCount + (pl.itemCount === 1 ? " video" : " videos");
                        var badgeText = pl.badge || "Playlist";

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

                        card.addEventListener("click", function () {
                            openPlaylistDetail(pl, t);
                        });

                        grid.appendChild(card);
                    })(playlists[i]);
                }

                SpatialNavigation.refresh();
                setTimeout(function () {
                    if (lastOpenedPlaylistId) {
                        var target = grid.querySelector('.playlist-card[data-id="' + lastOpenedPlaylistId + '"]');
                        if (target) {
                            SpatialNavigation.focusNode(target);
                            lastOpenedPlaylistId = null;
                            return;
                        }
                    }
                    var firstCard = grid.querySelector(".playlist-card");
                    if (firstCard) SpatialNavigation.focusNode(firstCard);
                    else {
                        var activeMenu = document.querySelector(".nav-item.active");
                        if (activeMenu) SpatialNavigation.focusNode(activeMenu);
                    }
                }, 100);
            });
        }
    }

    var lastOpenedPlaylistId = null;

    function openPlaylistDetail(playlist, t) {
        window.isPlaylistDetailOpen = true;
        window.currentOpenPlaylist = playlist;
        lastOpenedPlaylistId = playlist.id;

        try {
            history.pushState({ playlistDetail: true }, "", "");
        } catch (e) {}

        t.innerHTML = '<div class="playlist-detail-container">' +
            '<div id="playlist-detail-loading" class="loading-spinner" style="display: block;">Loading...</div>' +
            '<div class="playlist-detail-grid" id="playlist-detail-grid"></div>' +
            '</div>';

        SpatialNavigation.refresh();

        if (window.OdyseeAPI && typeof OdyseeAPI.getPlaylistVideos === "function") {
            OdyseeAPI.getPlaylistVideos(playlist, function (err, res) {
                var loadingEl = document.getElementById("playlist-detail-loading");
                if (loadingEl) loadingEl.style.display = "none";

                var grid = document.getElementById("playlist-detail-grid");
                if (!grid) return;

                if (err || !res || !res.items || !res.items.length) {
                    grid.innerHTML = '<div class="playlists-empty">' +
                        '<h3>No videos in this playlist</h3>' +
                        '<p>Videos in this playlist will appear here.</p>' +
                        '</div>';
                    SpatialNavigation.refresh();
                    var activeMenu = document.querySelector(".nav-item.active");
                    if (activeMenu) SpatialNavigation.focusNode(activeMenu);
                    return;
                }

                grid.innerHTML = "";
                for (var i = 0; i < res.items.length; i++) {
                    var card = createVideoCard(res.items[i]);
                    if (card) grid.appendChild(card);
                }

                SpatialNavigation.refresh();
                setTimeout(function () {
                    var firstCard = grid.querySelector(".video-card");
                    if (firstCard) SpatialNavigation.focusNode(firstCard);
                    else {
                        var activeMenu = document.querySelector(".nav-item.active");
                        if (activeMenu) SpatialNavigation.focusNode(activeMenu);
                    }
                }, 100);
            }, 1);
        }
    }

    function closePlaylistDetail(noRefresh, fromPopstate) {
        if (!window.isPlaylistDetailOpen) return;
        window.isPlaylistDetailOpen = false;
        window.currentOpenPlaylist = null;

        if (!fromPopstate && window.history && history.state && history.state.playlistDetail) {
            try { history.back(); } catch (e) {}
        }

        if (!noRefresh) {
            var t = document.getElementById("video-grid");
            if (t) renderPlaylistsView(t);
        }
    }

    function loadPage(e) {
        if (typeof Channel !== "undefined" && Channel && typeof Channel.close === "function") {
            Channel.close(true);
        } else if (window.Channel && typeof window.Channel.close === "function") {
            window.Channel.close(true);
        } else if (typeof window.closeChannelPage === "function") {
            window.closeChannelPage(true);
        }
        window.isChannelPageOpen = false;

        var cpEl = document.getElementById("channel-page");
        if (cpEl) cpEl.style.display = "none";
        var vgEl = document.getElementById("video-grid");
        if (vgEl) vgEl.style.display = "";
        var topHdr = document.querySelector(".top-header");
        if (topHdr) topHdr.style.display = "block";

        try {
            if (history.state && history.state.channelPage) {
                history.replaceState(null, "", "");
            }
        } catch (err) { }

        if (window.isPlaylistDetailOpen) {
            closePlaylistDetail(true, true);
        }
        window.isPlaylistDetailOpen = false;
        try {
            if (history.state && history.state.playlistDetail) {
                history.replaceState(null, "", "");
            }
        } catch (err) { }

        var t = document.getElementById("video-grid"),
            n = document.getElementById("loading"),
            o = document.getElementById("search-container"),
            a = document.getElementById("search-input");

        currentPage = 1;
        currentCategory = e;
        currentSearchQuery = '';
        hasMore = true;
        isLoading = true;

        if (window.Navigation && typeof Navigation.setActive === "function") {
            Navigation.setActive(e);
        }

        if (window.SpatialNavigation && typeof SpatialNavigation.lock === "function") {
            SpatialNavigation.lock();
        }

        if (t.innerHTML = "", n.style.display = "block", "nav-search" === e) {
            isLoading = false;
            if (window.SpatialNavigation && typeof SpatialNavigation.unlock === "function") SpatialNavigation.unlock();
            Utils.setDisplayFlex(o);
            n.style.display = "none";
            SpatialNavigation.refresh();
            if (a) {
                setTimeout(function () {
                    a.focus();
                }, 100);
            }
            return;
        }

        if ("nav-login" === e) {
            isLoading = false;
            hasMore = false;
            if (window.SpatialNavigation && typeof SpatialNavigation.unlock === "function") SpatialNavigation.unlock();
            o.style.display = "none";
            n.style.display = "none";
            renderLoginView(t);
            return;
        }

        if ("nav-profile" === e) {
            isLoading = false;
            hasMore = false;
            if (window.SpatialNavigation && typeof SpatialNavigation.unlock === "function") SpatialNavigation.unlock();
            o.style.display = "none";
            n.style.display = "none";
            renderProfileView(t);
            return;
        }

        if ("nav-playlists" === e) {
            isLoading = false;
            hasMore = false;
            if (window.SpatialNavigation && typeof SpatialNavigation.unlock === "function") SpatialNavigation.unlock();
            o.style.display = "none";
            renderPlaylistsView(t);
            return;
        }

        function r(err, res) {
            isLoading = false;
            n.style.display = "none";
            if (err) {
                var msg = err.message || ("string" == typeof err ? err : JSON.stringify(err));
                t.innerHTML = '<div class="error" style="padding: 20px; color: #ff5555; font-size: 24px;">Failed to load content. ' + msg + "</div>";
                console.error(err);
                if (window.SpatialNavigation) {
                    SpatialNavigation.refresh();
                    var activeMenu = document.querySelector(".nav-item.active");
                    if (activeMenu) SpatialNavigation.focusNode(activeMenu);
                    SpatialNavigation.unlock();
                }
                return;
            }
            if (res && res.items && res.items.length > 0) {
                if ((res.raw_count !== undefined ? res.raw_count : res.items.length) < 20) hasMore = false;
                for (var i = 0; i < res.items.length; i++) {
                    var card = createVideoCard(res.items[i]);
                    if (card) t.appendChild(card);
                }
            } else {
                hasMore = false;
                if (currentPage === 1 && e === "nav-following") {
                    t.innerHTML = '<div class="playlists-empty" style="margin-top: 60px;">' +
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="#6B7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 20px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>' +
                        '<h3>No videos from followed channels</h3>' +
                        '<p>Follow channels on Odysee to see their latest uploads here.</p>' +
                        '</div>';
                }
            }
            if (window.SpatialNavigation) {
                SpatialNavigation.refresh();
                if (currentPage === 1) {
                    var firstVideo = t.querySelector(".video-card");
                    if (firstVideo) {
                        SpatialNavigation.focusNode(firstVideo);
                    } else {
                        var activeMenu = document.querySelector(".nav-item.active");
                        if (activeMenu) SpatialNavigation.focusNode(activeMenu);
                    }
                    isAppStartup = false;
                }
                SpatialNavigation.unlock();
            }
        }

        o.style.display = "none";
        dispatchLoad(e, currentPage, r);
    }

    function doSearch(query) {
        var t = document.getElementById("video-grid"),
            n = document.getElementById("loading");

        if (isLoading && currentSearchQuery === query) return;

        currentPage = 1;
        currentCategory = 'nav-search';
        currentSearchQuery = query;
        hasMore = true;
        isLoading = true;

        t.innerHTML = "";
        n.style.display = "block";

        OdyseeAPI.search(query, function (err, res) {
            isLoading = false;
            n.style.display = "none";
            if (err) {
                var msg = err.message || ("string" == typeof err ? err : JSON.stringify(err));
                t.innerHTML = '<div class="error" style="padding: 20px; color: #ff5555; font-size: 24px;">Search failed. ' + msg + "</div>";
                console.error(err);
                SpatialNavigation.refresh();
                return;
            }
            if (res && res.items && res.items.length > 0) {
                if ((res.raw_count !== undefined ? res.raw_count : res.items.length) < 20) hasMore = false;
                for (var i = 0; i < res.items.length; i++) {
                    var card = createVideoCard(res.items[i]);
                    if (card) t.appendChild(card);
                }
            } else {
                hasMore = false;
                t.innerHTML = '<div style="color:white;text-align:center;width:100%;font-size:24px;margin-top:50px;">No results found.</div>';
            }
            SpatialNavigation.refresh();
            setTimeout(function () {
                var first = t.querySelector(".video-card");
                if (first) first.focus();
            }, 100);
        }, currentPage);
    }

    function loadMoreContent() {
        if (isLoading || !hasMore || (currentCategory === 'nav-search' && !currentSearchQuery)) return;

        isLoading = true;
        currentPage++;
        var n = document.getElementById("loading");
        if (n) n.style.display = "block";

        var t = document.getElementById("video-grid");

        function appendCards(err, res) {
            isLoading = false;
            if (n) n.style.display = "none";
            if (err) {
                console.error("Load more failed", err);
                return;
            }
            if (res && res.items && res.items.length > 0) {
                if ((res.raw_count !== undefined ? res.raw_count : res.items.length) < 20) hasMore = false;
                for (var i = 0; i < res.items.length; i++) {
                    var card = createVideoCard(res.items[i]);
                    if (card) t.appendChild(card);
                }
                SpatialNavigation.refresh();
            } else {
                hasMore = false;
            }
        }

        dispatchLoad(currentCategory, currentPage, appendCards);
    }

    function triggerPlayVideo(claim) {
        if (window.Player && typeof Player.playVideo === "function") {
            Player.playVideo(claim);
        } else if (typeof playVideo === "function") {
            playVideo(claim);
        }
    }

    function triggerOpenChannel(channel) {
        if (window.Channel && typeof Channel.open === "function") {
            Channel.open(channel);
        } else if (typeof window.openChannelPage === "function") {
            window.openChannelPage(channel);
        }
    }

    function createVideoCard(e) {
        if (!e.value) return null;
        var t = e.value.title || "Untitled",
            n = Utils.thumbUrl(e.value.thumbnail ? e.value.thumbnail.url : "");
        var chName = e.signing_channel ? (e.signing_channel.name || "") : "";
        var i = e.signing_channel && e.signing_channel.value ? e.signing_channel.value.title || e.signing_channel.name : (chName || "Unknown");
        var rawAvatarUrl = e.signing_channel && e.signing_channel.value && e.signing_channel.value.thumbnail ? e.signing_channel.value.thumbnail.url : "";
        var avatarUrl = (window.Utils && Utils.getAvatarSrc) ? Utils.getAvatarSrc(rawAvatarUrl, 64) : "icons/spaceman.png";
        var isSpaceman = (!avatarUrl || avatarUrl === "icons/spaceman.png");
        var chColor = (isSpaceman && window.Utils && Utils.getAvatarColor) ? Utils.getAvatarColor(chName) : "transparent";
        var ts = e.value && e.value.release_time ? e.value.release_time : (e.meta && e.meta.creation_timestamp ? e.meta.creation_timestamp : 0);
        var uploadDate = Utils.formatRelativeTime(ts);

        var duration = e.value && e.value.video ? e.value.video.duration : 0;
        var durationText = "";
        if (duration > 0) {
            var h = Math.floor(duration / 3600);
            var m = Math.floor((duration % 3600) / 60);
            var s = duration % 60;
            if (h > 0) {
                durationText = h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
            } else {
                durationText = m + ":" + (s < 10 ? "0" : "") + s;
            }
        }
        var durationHtml = durationText ? '<div class="duration-overlay">' + durationText + '</div>' : '';

        // Resume progress bar
        var progressHtml = '';
        if (e.claim_id && window.UserData && typeof UserData.getResumePoint === "function") {
            var rp = UserData.getResumePoint(e.claim_id);
            if (rp && rp.time > 0 && rp.duration > 0) {
                var pct = Math.min(Math.round((rp.time / rp.duration) * 100), 100);
                if (pct > 0 && pct < 100) {
                    progressHtml = '<div class="resume-progress-bar"><div class="resume-progress-fill" style="width:' + pct + '%"></div></div>';
                }
            }
        }

        var o = document.createElement("div");
        o.tabIndex = 0;
        o.className = "video-card focusable";

        var avatarHtml = '<img class="channel-avatar" src="' + Utils.escapeHtml(avatarUrl) + '" style="background-color:' + chColor + ';" onerror="this.src=\'icons/spaceman.png\'" />';
        o.innerHTML = '<div class="thumbnail-wrapper"><img class="thumbnail" src="' + Utils.escapeHtml(n) + '" />' + durationHtml + progressHtml + '</div><div class="info"><div class="title">' + Utils.escapeHtml(t) + '</div><div class="channel-meta">' + avatarHtml + '<div class="channel-text"><div class="channel">' + Utils.escapeHtml(i) + '</div><div class="card-date">' + Utils.escapeHtml(uploadDate) + '</div></div></div></div>';

        var ptrIsDown = false;
        var ptrTimer = null;
        var ptrLongPressed = false;

        o.addEventListener("mousedown", function (ev) {
            ptrIsDown = true;
            ptrLongPressed = false;
            ptrTimer = setTimeout(function () {
                ptrLongPressed = true;
                if (e.signing_channel) {
                    window.lastFocusedCard = o;
                    triggerOpenChannel(e.signing_channel);
                }
            }, 1200);
        });

        o.addEventListener("touchstart", function (ev) {
            ptrIsDown = true;
            ptrLongPressed = false;
            ptrTimer = setTimeout(function () {
                ptrLongPressed = true;
                if (e.signing_channel) {
                    window.lastFocusedCard = o;
                    triggerOpenChannel(e.signing_channel);
                }
            }, 1200);
        });

        function cancelPointer(ev) {
            if (ptrIsDown) {
                ptrIsDown = false;
                if (ptrTimer) {
                    clearTimeout(ptrTimer);
                    ptrTimer = null;
                }
                if (!ptrLongPressed) {
                    window.lastFocusedCard = o;
                    triggerPlayVideo(e);
                }
            }
        }

        o.addEventListener("mouseup", cancelPointer);
        o.addEventListener("touchend", cancelPointer);

        o.addEventListener("mouseleave", function () {
            ptrIsDown = false;
            if (ptrTimer) {
                clearTimeout(ptrTimer);
                ptrTimer = null;
            }
        });

        o.addEventListener("touchcancel", function () {
            ptrIsDown = false;
            if (ptrTimer) {
                clearTimeout(ptrTimer);
                ptrTimer = null;
            }
        });

        o.addEventListener("longpress", function () {
            if (e.signing_channel) {
                window.lastFocusedCard = o;
                triggerOpenChannel(e.signing_channel);
            }
        });

        o.addEventListener("click", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();

            if (ptrIsDown || ptrLongPressed || window._spatialOkLongPressed) return;
            if (ev.screenX > 0 || ev.screenY > 0) return;

            if (!window.isChannelPageOpen) {
                window.lastFocusedCard = o;
            } else {
                window.lastFocusedChannelCard = o;
            }
            triggerPlayVideo(e);
        });

        return o;
    }

    function initSearch() {
        var n = document.getElementById("btn-search"),
            i = document.getElementById("search-input");

        function triggerSearch() {
            if (!i) return;
            var e = i.value.trim();
            if (e.length > 0) {
                i.blur();
                var btn = document.getElementById("btn-search");
                if (btn) SpatialNavigation.focusNode(btn);
                doSearch(e);
            }
        }

        if (n && i) {
            n.addEventListener("click", triggerSearch);
            i.addEventListener("keydown", function (e) {
                if (e.keyCode === 13) {
                    e.preventDefault();
                    triggerSearch();
                }
            });
            i.addEventListener("focus", function () {
                SpatialNavigation.focusNode(i);
            });
        }
    }

    return {
        loadPage: loadPage,
        doSearch: doSearch,
        loadMoreContent: loadMoreContent,
        createVideoCard: createVideoCard,
        releaseOffscreenThumbs: releaseOffscreenThumbs,
        initSearch: initSearch,
        renderPlaylistsView: renderPlaylistsView,
        closePlaylistDetail: closePlaylistDetail,
        getCurrentCategory: function () {
            return currentCategory;
        }
    };
})();

// Global backwards-compatibility aliases
var loadPage = Feed.loadPage;
var doSearch = Feed.doSearch;
var loadMoreContent = Feed.loadMoreContent;
var createVideoCard = Feed.createVideoCard;
var releaseOffscreenThumbs = Feed.releaseOffscreenThumbs;
