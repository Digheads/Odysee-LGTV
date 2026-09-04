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
        var settings = (window.Auth && Auth.getSettings) ? Auth.getSettings() : { hideMature: true, hideMembersOnly: false, hideYoutube: false };

        var rawAvatar = (window.Auth && Auth.getAvatarUrl) ? Auth.getAvatarUrl() : (user.avatarUrl || "icons/icon.png");
        var avatarSrc = (window.Utils && Utils.thumbUrl) ? Utils.thumbUrl(rawAvatar, 160) : rawAvatar;

        var displayName = user.channelName || (user.email ? user.email.split("@")[0] : "Odysee User");
        if (0 !== displayName.indexOf("@") && user.channelName) displayName = "@" + displayName;
        var emailDisplay = user.email || "";
        var followersText = (user.followers || 0) + " followers";

        var html = '<div class="profile-view">' +
            '<div class="profile-header-card">' +
            '<div class="profile-avatar-wrap">' +
            '<img src="' + avatarSrc + '" class="profile-avatar-img" alt="Avatar">' +
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
            '<div class="setting-desc">Hide adult (18+) content from results</div>' +
            '</div>' +
            '<button class="focusable btn-setting-toggle ' + (settings.hideMature ? 'toggle-active' : '') + '" id="toggle-mature">' +
            (settings.hideMature ? 'ON' : 'OFF') +
            '</button>' +
            '</div>' +

            '<div class="setting-row">' +
            '<div class="setting-info">' +
            '<div class="setting-name">Hide members-only content</div>' +
            '<div class="setting-desc">Hide channel members-only content</div>' +
            '</div>' +
            '<button class="focusable btn-setting-toggle ' + (settings.hideMembersOnly ? 'toggle-active' : '') + '" id="toggle-members">' +
            (settings.hideMembersOnly ? 'ON' : 'OFF') +
            '</button>' +
            '</div>' +

            '<div class="setting-row">' +
            '<div class="setting-info">' +
            '<div class="setting-name">Hide synced YouTube videos</div>' +
            '<div class="setting-desc">Hide videos synced from YouTube</div>' +
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
        setupToggle("toggle-members", "hideMembersOnly");
        setupToggle("toggle-youtube", "hideYoutube");

        setTimeout(function () {
            if (logoutBtn) logoutBtn.focus();
        }, 100);
    }

    function loadPage(e) {
        if (window.isChannelPageOpen && window.Channel && typeof Channel.close === "function") {
            Channel.close(true);
            try { history.replaceState(null, "", ""); } catch (err) { }
        }

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

        function r(err, res) {
            isLoading = false;
            n.style.display = "none";
            if (window.SpatialNavigation && typeof SpatialNavigation.unlock === "function") {
                SpatialNavigation.unlock();
            }
            if (err) {
                var msg = err.message || ("string" == typeof err ? err : JSON.stringify(err));
                t.innerHTML = '<div class="error" style="padding: 20px; color: #ff5555; font-size: 24px;">Failed to load content. ' + msg + "</div>";
                console.error(err);
                SpatialNavigation.refresh();
                return;
            }
            if (res && res.items) {
                if ((res.raw_count !== undefined ? res.raw_count : res.items.length) < 20) hasMore = false;
                for (var i = 0; i < res.items.length; i++) {
                    var card = createVideoCard(res.items[i]);
                    if (card) t.appendChild(card);
                }
            } else {
                hasMore = false;
            }
            SpatialNavigation.refresh();
            if (currentPage === 1) {
                setTimeout(function () {
                    var firstVideo = t.querySelector(".video-card");
                    if (firstVideo) {
                        SpatialNavigation.focusNode(firstVideo);
                    } else {
                        var activeMenu = document.querySelector(".nav-item.active");
                        if (activeMenu) SpatialNavigation.focusNode(activeMenu);
                    }
                    isAppStartup = false;
                }, 100);
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
        var i = e.signing_channel && e.signing_channel.value ? e.signing_channel.value.title || e.signing_channel.name : "Unknown";
        var rawAvatarUrl = e.signing_channel && e.signing_channel.value && e.signing_channel.value.thumbnail ? e.signing_channel.value.thumbnail.url : "";
        var avatarUrl = rawAvatarUrl ? Utils.thumbUrl(rawAvatarUrl, 64) : "icons/icon.png";
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

        var o = document.createElement("div");
        o.tabIndex = 0;
        o.className = "video-card focusable";

        var avatarHtml = '<img class="channel-avatar" src="' + Utils.escapeHtml(avatarUrl) + '" onerror="this.src=\'icons/icon.png\'" />';
        o.innerHTML = '<div class="thumbnail-wrapper"><img class="thumbnail" src="' + Utils.escapeHtml(n) + '" />' + durationHtml + '</div><div class="info"><div class="title">' + Utils.escapeHtml(t) + '</div><div class="channel-meta">' + avatarHtml + '<div class="channel-text"><div class="channel">' + Utils.escapeHtml(i) + '</div><div class="card-date">' + Utils.escapeHtml(uploadDate) + '</div></div></div></div>';

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
