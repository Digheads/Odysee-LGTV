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
    var queue = [];
    var timer = null;
    var failures = 0;
    var MAX_FAILURES = 5;
    var FLUSH_MS = 800;
    var MAX_QUEUE = 60;
    var endpoint = null;
    var resolved = false;

    function resolveEndpoint() {
        var host;

        if (resolved) {
            return endpoint;
        }
        resolved = true;
        host = window.DEVLOG_HOST;
        if (host) {
            endpoint = (String(host).indexOf('http') === 0 ? host : 'http://' + host) + '/log';
        } else if (window.location && String(window.location.protocol).indexOf('http') === 0 && window.location.host) {
            endpoint = window.location.protocol + '//' + window.location.host + '/log';
        }
        return endpoint;
    }

    function flush() {
        var url;
        var batch;
        var xhr;

        timer = null;
        if (!queue.length) {
            return;
        }
        url = resolveEndpoint();
        if (!url) {
            queue.length = 0;
            return;
        }
        if (failures >= MAX_FAILURES) {
            if (queue.length > MAX_QUEUE) {
                queue.splice(0, queue.length - MAX_QUEUE);
            }
            if (!timer) {
                timer = setTimeout(function () {
                    failures = 0;
                    flush();
                }, 2000);
            }
            return;
        }
        batch = queue.splice(0, MAX_QUEUE);
        xhr = new XMLHttpRequest();
        try {
            xhr.open('POST', url, true);
            // text/plain -> simple request, no CORS preflight
            xhr.setRequestHeader('Content-Type', 'text/plain');
            xhr.timeout = 8000;
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) {
                    return;
                }
                if (xhr.status >= 200 && xhr.status < 400) {
                    failures = 0;
                } else {
                    failures += 1;
                }
            };
            xhr.ontimeout = function () {
                failures += 1;
            };
            xhr.onerror = function () {
                failures += 1;
            };
            xhr.send(JSON.stringify(batch));
        } catch (e) {
            failures += 1;
        }
        if (queue.length) {
            schedule();
        }
    }

    function schedule() {
        if (timer === null) {
            timer = setTimeout(flush, FLUSH_MS);
        }
    }

    return {
        push: function (level, msg) {
            queue.push({
                level: level || 'log',
                msg: String(msg)
            });
            // Send immediately on error: if the app crashes instantly, we don't want to lose it.
            if (level === 'error' || queue.length >= MAX_QUEUE) {
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
                flush();
            } else {
                schedule();
            }
        },

        // For manual inspection: returns where the log goes (or if it doesn't).
        status: function () {
            var url = resolveEndpoint();
            return url ? ('RemoteLog -> ' + url) : 'RemoteLog: no target (set window.DEVLOG_HOST)';
        }
    };
}());
