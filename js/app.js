// ---------------------------------------------------------------------------
// Odysee TV - Application Bootstrap & Main Orchestrator
// (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

// 1. Developer logging & Global error interception
(function () {
    var origLog = console.log,
        origWarn = console.warn,
        origError = console.error;

    function forwardLog(level, args) {
        var text = Array.prototype.slice.call(args).map(function (item) {
            return "object" == typeof item ? JSON.stringify(item) : item;
        }).join(" ");

        try {
            if ("undefined" != typeof RemoteLog) RemoteLog.push(level, text);
        } catch (err) { }
    }

    console.log = function () {
        forwardLog("log", arguments);
        origLog.apply(console, arguments);
    };

    console.warn = function () {
        forwardLog("warn", arguments);
        if (origWarn) origWarn.apply(console, arguments);
        else origLog.apply(console, arguments);
    };

    console.error = function () {
        forwardLog("error", arguments);
        origError.apply(console, arguments);
    };

    window.onerror = function (msg, url, line, col, error) {
        console.error("Global Error: " + msg + " at " + url + ":" + line);
    };
})();

// 2. Application initialization on DOMContentLoaded
document.addEventListener("DOMContentLoaded", function () {
    // Clock sync first, load only afterwards: otherwise the `magic` parameter
    // would be invalid with a drifted TV clock and we'd get 401.
    if (window.OdyseeAPI && typeof OdyseeAPI.syncServerTime === "function") {
        OdyseeAPI.syncServerTime(function () {
            function proceed() {
                OdyseeAPI.getSections(function (err, sections) {
                    if (err) console.error("Failed to load categories: " + err.message);
                    Navigation.buildNav(sections || []);
                    SpatialNavigation.refresh();
                    Feed.loadPage("nav-trending");
                });
            }

            if (window.Auth && typeof Auth.init === "function") {
                Auth.init(function (isLoggedIn) {
                    console.log("App bootstrap: Auth initialized, loggedIn=" + isLoggedIn);
                    proceed();
                });
            } else {
                proceed();
            }
        });
    }

    SpatialNavigation.init();
    Navigation.bindNav();
    Feed.initSearch();
    Player.initUI();

    // Infinite scroll & offscreen thumbnail memory management
    var mainContent = document.getElementById("main-content");
    if (mainContent) {
        var releaseTimer = null;
        mainContent.addEventListener("scroll", function () {
            if (mainContent.scrollTop + mainContent.clientHeight >= mainContent.scrollHeight - 500) {
                if (window.isChannelPageOpen) {
                    Channel.loadMore();
                } else {
                    Feed.loadMoreContent();
                }
            }
            if (releaseTimer) clearTimeout(releaseTimer);
            releaseTimer = setTimeout(function () {
                Feed.releaseOffscreenThumbs(mainContent);
            }, 300);
        });
    }

    // Global back navigation (History popstate)
    window.addEventListener("popstate", function (e) {
        var playerEl = document.getElementById("player-container");
        if (playerEl && !playerEl.classList.contains("hidden")) {
            Player.close();
        } else if (window.isChannelPageOpen) {
            Channel.close();
        }
    });

    // Remote Back button interception when views are open
    window.addEventListener("keydown", function (e) {
        var playerEl = document.getElementById("player-container");
        var isPlayerOpen = playerEl && !playerEl.classList.contains("hidden");

        if (!isPlayerOpen && window.isChannelPageOpen) {
            var keyCode = e.keyCode;
            if (413 === keyCode || 461 === keyCode || 8 === keyCode || 27 === keyCode || 10009 === keyCode) {
                e.preventDefault();
                history.back();
            }
        }
    });
});