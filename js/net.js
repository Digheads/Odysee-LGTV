// ---------------------------------------------------------------------------
// Network & Transport Layer for Odysee LGTV (ES5 compatible for webOS 2.0+)
// Manages JSON-RPC proxy, Internal APIs (api.odysee.com), and Time Sync.
// ---------------------------------------------------------------------------

var LbryNet = (function () {
    var serverTimeOffsetMs = 0;
    var serverTimeSynced = false;

    function parseIsoUtc(str) {
        var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(str || "");
        if (!m) return NaN;
        return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }

    return {
        // Synchronizes TV clock drift with Odysee backend.
        // Also stores initial anonymous auth_token for lightweight API calls.
        syncServerTime: function (cb) {
            if (serverTimeSynced) return cb && cb();
            var xhr = new XMLHttpRequest();
            xhr.open("POST", "https://api.odysee.com/user/new", true);
            xhr.timeout = 15000;
            xhr.onreadystatechange = function () {
                if (4 !== xhr.readyState) return;
                if (200 === xhr.status) {
                    try {
                        var d = JSON.parse(xhr.responseText).data || {};
                        var srv = parseIsoUtc(d.created_at);
                        if (!isNaN(srv)) {
                            serverTimeOffsetMs = srv - new Date().getTime();
                            serverTimeSynced = true;
                            console.log("Time sync: offset " +
                                Math.round(serverTimeOffsetMs / 1000) + "s (TV clock " +
                                (serverTimeOffsetMs > 0 ? "slow" : "fast") + ")");
                        }
                        if (d.auth_token && !window.odyseeAuthToken) {
                            window.odyseeAuthToken = d.auth_token;
                        }
                    } catch (err) {
                        console.error("Time sync parse error: " + err.message);
                    }
                } else {
                    console.error("Time sync failed: " + xhr.status);
                }
                cb && cb();
            };
            xhr.ontimeout = xhr.onerror = function () {
                console.error("Time sync unavailable, using TV clock");
                cb && cb();
            };
            xhr.send();
        },

        getServerNowSec: function () {
            return Math.floor((new Date().getTime() + serverTimeOffsetMs) / 1000);
        },

        // Resolves user internal auth_token if logged in, or anonymous auth_token.
        ensureAuthToken: function (cb) {
            if (window.Auth && typeof Auth.getInternalAuthToken === "function" && Auth.getInternalAuthToken()) {
                return cb(Auth.getInternalAuthToken());
            }
            if (window.odyseeAuthToken) {
                return cb(window.odyseeAuthToken);
            }
            var xhr = new XMLHttpRequest();
            xhr.open("POST", "https://api.odysee.com/user/new", true);
            xhr.timeout = 15000;
            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        try {
                            var resp = JSON.parse(xhr.responseText);
                            if (resp && resp.data && resp.data.auth_token) {
                                window.odyseeAuthToken = resp.data.auth_token;
                                return cb(window.odyseeAuthToken);
                            }
                        } catch (e) { }
                    }
                    cb(null);
                }
            };
            xhr.ontimeout = xhr.onerror = function () {
                cb(null);
            };
            xhr.send();
        }
    };
})();

// Central JSON-RPC 2.0 Client for LBRY / Hub SDK proxy
var LbryRpc = (function () {
    var PROXY_URL = "https://api.na-backend.odysee.com/api/v1/proxy";
    var MAX_ATTEMPTS = 3;

    function call(method, params, callback, attempt) {
        attempt = attempt || 0;

        function retryOrFail(err) {
            if (attempt + 1 < MAX_ATTEMPTS) {
                var wait = 2000 * (attempt + 1);
                console.log("API retry " + (attempt + 1) + "/" + (MAX_ATTEMPTS - 1) +
                    " (in " + (wait / 1000) + "s): " + method);
                return void setTimeout(function () {
                    call(method, params, callback, attempt + 1);
                }, wait);
            }
            callback(err);
        }

        var url = PROXY_URL;
        if ("get" === method || "preference_get" === method || "preference_set" === method) {
            url += "?m=" + method;
        }

        console.log("LbryRpc: [" + method + "] Request. Params: " + JSON.stringify(params));
        var xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        xhr.setRequestHeader("Content-Type", "application/json-rpc");

        if (window.Auth && typeof Auth.getAccessToken === "function" && Auth.getAccessToken()) {
            xhr.setRequestHeader("Authorization", "Bearer " + Auth.getAccessToken());
        }

        var internalToken = (window.Auth && typeof Auth.getInternalAuthToken === "function" && Auth.getInternalAuthToken()) || window.odyseeAuthToken;
        if (internalToken) {
            xhr.setRequestHeader("X-Lbry-Auth-Token", internalToken);
        }

        xhr.timeout = 20000;
        xhr.ontimeout = function () {
            retryOrFail(new Error("Timeout: cannot reach " + url));
        };
        xhr.onerror = function () {
            retryOrFail(new Error("Network error reaching " + url));
        };

        xhr.onreadystatechange = function () {
            if (4 === xhr.readyState) {
                if (200 === xhr.status) {
                    try {
                        var res = JSON.parse(xhr.responseText);
                        if (res.error) {
                            callback(new Error(res.error.message || "API Error"));
                        } else {
                            callback(null, res.result);
                        }
                    } catch (e) {
                        console.error("LbryRpc: JSON parse error. Proxy returned HTML? Response:", xhr.responseText.substring(0, 100));
                        callback(new Error("Invalid JSON from proxy"));
                    }
                } else {
                    retryOrFail(new Error("Network error: " + xhr.status));
                }
            }
        };

        var payload = {
            method: method,
            params: params,
            jsonrpc: "2.0",
            id: Math.round(1e6 * Math.random())
        };

        xhr.send(JSON.stringify(payload));
    }

    return {
        call: call
    };
})();

// Helper client for internal Odysee REST / form APIs (api.odysee.com)
var LbryIo = (function () {
    var BASE_URL = "https://api.odysee.com";

    function call(path, options, callback) {
        options = options || {};
        var method = (options.method || "POST").toUpperCase();
        var url = (0 === path.indexOf("http") ? path : BASE_URL + (path.charAt(0) === "/" ? path : "/" + path));

        // Auto-attach auth_token if available and not already provided
        var token = (window.Auth && typeof Auth.getInternalAuthToken === "function" && Auth.getInternalAuthToken()) || window.odyseeAuthToken;
        if (token && options.data && typeof options.data === "object" && !options.data.auth_token) {
            options.data.auth_token = token;
        }

        var isJson = options.json === true;
        var body = null;

        if (options.data) {
            if (isJson) {
                body = JSON.stringify(options.data);
            } else if ("string" === typeof options.data) {
                if (method === "GET") {
                    url += (url.indexOf("?") === -1 ? "?" : "&") + options.data;
                } else {
                    body = options.data;
                }
            } else {
                var parts = [];
                for (var key in options.data) {
                    if (options.data.hasOwnProperty(key) && options.data[key] !== undefined && options.data[key] !== null) {
                        parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(options.data[key]));
                    }
                }
                var serialized = parts.join("&");
                if (method === "GET") {
                    if (serialized) {
                        url += (url.indexOf("?") === -1 ? "?" : "&") + serialized;
                    }
                } else {
                    body = serialized;
                }
            }
        }

        var xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        xhr.timeout = options.timeout || 15000;

        // Only attach Bearer token for /user/me or if explicitly requested,
        // because sending expired Bearer tokens breaks api.odysee.com OIDC middleware.
        if ((path === "/user/me" || options.useBearer === true) && window.Auth && typeof Auth.getAccessToken === "function" && Auth.getAccessToken()) {
            xhr.setRequestHeader("Authorization", "Bearer " + Auth.getAccessToken());
        }

        if (isJson) {
            xhr.setRequestHeader("Content-Type", "application/json");
        } else if (method === "POST") {
            xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        }

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        var res = JSON.parse(xhr.responseText);
                        callback(null, res);
                    } catch (e) {
                        callback(new Error("Failed to parse JSON response from " + path));
                    }
                } else {
                    try {
                        var errRes = JSON.parse(xhr.responseText);
                        callback(new Error((errRes && errRes.error) || ("Request failed with status: " + xhr.status)), errRes);
                    } catch (e) {
                        callback(new Error("Request failed with status: " + xhr.status));
                    }
                }
            }
        };

        xhr.ontimeout = function () {
            callback(new Error("Request timeout for " + path));
        };
        xhr.onerror = function () {
            callback(new Error("Network error for " + path));
        };

        xhr.send(method === "GET" ? null : body);
    }

    return {
        call: call
    };
})();
