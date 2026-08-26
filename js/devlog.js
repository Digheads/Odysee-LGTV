// Remote logging to the development server (devserver.js).
// For production, just remove the <script src="js/devlog.js"> line from index.html:
// the RemoteLog.push() calls in app.js will become no-ops.
//
// Determining the target:
//   1. window.DEVLOG_HOST ("192.168.1.50:3000") -- if the app is launched from file://
//   2. otherwise, the load origin, if http(s)
//
// ES5, XHR. The body is intentionally text/plain: it's a CORS "simple request", so there is no
// preflight -- it's more reliable on old WebKit, and half as many requests.

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
            // text/plain -> simple request, no CORS preflight
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
            // Send immediately on error: if the app crashes instantly, we don't want to lose it.
            if ("error" === level || queue.length >= MAX_QUEUE) {
                if (null !== timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                flush();
            } else schedule();
        },

        // For manual inspection: returns where the log goes (or if it doesn't).
        status: function () {
            var url = resolveEndpoint();
            return url ? ("RemoteLog -> " + url) : "RemoteLog: no target (set window.DEVLOG_HOST)";
        }
    };
})();
