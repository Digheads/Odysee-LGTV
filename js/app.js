// ---------------------------------------------------------------------------
// Odysee TV - Application Bootstrap & Main Orchestrator
// (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

// 1. Developer logging & Global error interception
(function () {
    var origLog = console.log;
    var origWarn = console.warn;
    var origError = console.error;

    function forwardLog(level, args) {
        var text = Array.prototype.slice.call(args).map(function (item) {
            return typeof item === 'object' ? JSON.stringify(item) : item;
        }).join(' ');

        try {
            if (typeof RemoteLog !== 'undefined') {
                RemoteLog.push(level, text);
            }
        } catch (err) { }
    }

    console.log = function () {
        forwardLog('log', arguments);
        origLog.apply(console, arguments);
    };

    console.warn = function () {
        forwardLog('warn', arguments);
        if (origWarn) {
            origWarn.apply(console, arguments);
        } else {
            origLog.apply(console, arguments);
        }
    };

    console.error = function () {
        forwardLog('error', arguments);
        origError.apply(console, arguments);
    };

    window.onerror = function (msg, url, line) {
        console.error('Global Error: ' + msg + ' at ' + url + ':' + line);
    };
}());

// 2. Application initialization on DOMContentLoaded
document.addEventListener('DOMContentLoaded', function () {
    var mainContent;
    var releaseTimer;

    SpatialNavigation.init();
    SpatialNavigation.lock();

    SpatialNavigation.clearFocus();

    // Safety fallback: unlock navigation after 15s in case network stalls
    setTimeout(function () {
        var focused;
        var activeMenu;

        if (SpatialNavigation.isLocked()) {
            console.warn('Safety fallback: unlocking SpatialNavigation');
            SpatialNavigation.unlock();
            SpatialNavigation.refresh();
            focused = document.querySelector('.focused');
            if (!focused) {
                activeMenu = document.querySelector('.nav-item.active');
                if (activeMenu) {
                    SpatialNavigation.focusNode(activeMenu);
                }
            }
        }
    }, 15000);

    // Clock sync first, load only afterwards: otherwise the `magic` parameter
    // would be invalid with a drifted TV clock and we'd get 401.
    LbryNet.syncServerTime(function () {
        Auth.init(function (isLoggedIn) {
            console.log('App bootstrap: Auth initialized, loggedIn=' + isLoggedIn);
            OdyseeAPI.getSections(function (err, sections) {
                if (err) {
                    console.error('Failed to load categories: ' + err.message);
                }
                Navigation.buildNav(sections || []);
                SpatialNavigation.refresh();
                Feed.loadPage('nav-trending');
            });
        });
    });

    Navigation.bindNav();
    Feed.initSearch();
    Player.initUI();

    // Infinite scroll & offscreen thumbnail memory management
    mainContent = document.getElementById('main-content');
    if (mainContent) {
        releaseTimer = null;
        mainContent.addEventListener('scroll', function () {
            if (mainContent.scrollTop + mainContent.clientHeight >= mainContent.scrollHeight - 500) {
                if (typeof Channel !== 'undefined' && Channel.isOpen()) {
                    Channel.loadMore();
                } else {
                    Feed.loadMoreContent();
                }
            }
            if (releaseTimer) {
                clearTimeout(releaseTimer);
            }
            releaseTimer = setTimeout(function () {
                Feed.releaseOffscreenThumbs(mainContent);
            }, 300);
        });
    }

    // Global back navigation (History popstate)
    window.addEventListener('popstate', function () {
        var playerEl = document.getElementById('player-container');

        if (playerEl && !playerEl.classList.contains('hidden')) {
            if (Player.isCommentsOpen()) {
                Player.closeComments();
            } else {
                Player.close();
            }
        } else if ((typeof PlaylistView !== 'undefined' && PlaylistView.isOpen()) || window.isPlaylistDetailOpen) {
            if (typeof PlaylistView !== 'undefined') {
                PlaylistView.closePlaylistDetail(false, true);
            } else {
                Feed.closePlaylistDetail(false, true);
            }
        } else if ((typeof Channel !== 'undefined' && Channel.isOpen()) || window.isChannelPageOpen) {
            Channel.close();
        }
    });

    // Remote Back button interception when views are open
    window.addEventListener('keydown', function (e) {
        var playerEl = document.getElementById('player-container');
        var isPlayerOpen = playerEl && !playerEl.classList.contains('hidden');
        var isPlaylistOpen = (typeof PlaylistView !== 'undefined' && PlaylistView.isOpen()) || window.isPlaylistDetailOpen;
        var isChannelOpen = (typeof Channel !== 'undefined' && Channel.isOpen()) || window.isChannelPageOpen;
        var keyCode;

        if (!isPlayerOpen && isPlaylistOpen) {
            keyCode = e.keyCode;
            if (keyCode === 413 || keyCode === 461 || keyCode === 8 || keyCode === 27 || keyCode === 10009) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof PlaylistView !== 'undefined') {
                    PlaylistView.closePlaylistDetail();
                } else {
                    Feed.closePlaylistDetail();
                }
                return;
            }
        }

        if (!isPlayerOpen && isChannelOpen) {
            keyCode = e.keyCode;
            if (keyCode === 413 || keyCode === 461 || keyCode === 8 || keyCode === 27 || keyCode === 10009) {
                e.preventDefault();
                history.back();
            }
        }
    });
});