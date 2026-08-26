// Tavoli naplozas a fejlesztoi szervernek (devserver.js).
// Elesitesnel eleg az index.html-bol kivenni a <script src="js/devlog.js"> sort:
// a RemoteLog.push() hivas az app.js-ben ilyenkor no-op lesz.
//
// A cimzett meghatarozasa:
//   1. window.DEVLOG_HOST ("192.168.1.50:3000") -- ha file://-bol indul az app
//   2. kulonben a betoltes helye, ha http(s)
//
// ES5, XHR. A body szandekosan text/plain: az CORS "simple request", tehat nincs
// preflight -- a regi WebKit-en igy megbizhatobb, es feleannyi keres.

var RemoteLog = (function () {
    var queue = [],
        timer = null,
        failures = 0,
        MAX_FAILURES = 5,
        FLUSH_MS = 800,
        MAX_QUEUE = 60,
        endpoint = null,
        resolved = false;

    function resolveEndpoint() {
        if (resolved) return endpoint;
        resolved = true;
        var host = window.DEVLOG_HOST;
        if (host) {
            endpoint = (0 === String(host).indexOf("http") ? host : "http://" + host) + "/log";
        } else if (window.location && 0 === String(window.location.protocol).indexOf("http") && window.location.host) {
            endpoint = window.location.protocol + "//" + window.location.host + "/log";
        }
        return endpoint;
    }

    function flush() {
        timer = null;
        if (!queue.length) return;
        var url = resolveEndpoint();
        if (!url || failures >= MAX_FAILURES) {
            queue.length = 0;
            return;
        }
        var batch = queue.splice(0, MAX_QUEUE),
            xhr = new XMLHttpRequest();
        try {
            xhr.open("POST", url, true);
            // text/plain -> simple request, nincs CORS preflight
            xhr.setRequestHeader("Content-Type", "text/plain");
            xhr.timeout = 8000;
            xhr.onreadystatechange = function () {
                if (4 !== xhr.readyState) return;
                if (xhr.status >= 200 && xhr.status < 400) failures = 0;
                else failures++;
            };
            xhr.ontimeout = xhr.onerror = function () {
                failures++;
            };
            xhr.send(JSON.stringify(batch));
        } catch (e) {
            failures++;
        }
        if (queue.length) schedule();
    }

    function schedule() {
        if (null === timer) timer = setTimeout(flush, FLUSH_MS);
    }

    return {
        push: function (level, msg) {
            if (failures >= MAX_FAILURES) return;
            queue.push({ level: level, msg: String(msg) });
            // Hiba eseten azonnal kuldunk: ha az app menten elszall, ne vesszen el.
            if ("error" === level || queue.length >= MAX_QUEUE) {
                if (null !== timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                flush();
            } else schedule();
        },

        // Kezi hivasra: megmondja, hova megy a log (vagy hogy sehova).
        status: function () {
            var url = resolveEndpoint();
            return url ? ("RemoteLog -> " + url) : "RemoteLog: nincs cimzett (allitsd be a window.DEVLOG_HOST-ot)";
        }
    };
})();
