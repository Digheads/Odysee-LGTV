// ---------------------------------------------------------------------------
// Network & Transport Layer for Odysee LGTV (ES5 compatible for webOS 2.0+)
// Manages JSON-RPC proxy, Internal APIs (api.odysee.com), and Time Sync.
// ---------------------------------------------------------------------------

var LbryNet = (function () {
    var serverTimeOffsetMs = 0;
    var serverTimeSynced = false;

    function parseIsoUtc(str) {
        var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(str || '');
        if (!m) {
            return NaN;
        }
        return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }

    return {
        // Synchronizes TV clock drift with Odysee backend.
        // Also stores initial anonymous auth_token for lightweight API calls.
        syncServerTime: function (cb) {
            var xhr;

            if (serverTimeSynced) {
                if (cb) {
                    cb();
                }
                return;
            }
            xhr = new XMLHttpRequest();
            xhr.open('POST', 'https://api.odysee.com/user/new', true);
            xhr.timeout = 15000;
            xhr.onreadystatechange = function () {
                var d;
                var srv;

                if (xhr.readyState !== 4) {
                    return;
                }
                if (xhr.status === 200) {
                    try {
                        d = JSON.parse(xhr.responseText).data || {};
                        srv = parseIsoUtc(d.created_at);
                        if (!isNaN(srv)) {
                            serverTimeOffsetMs = srv - new Date().getTime();
                            serverTimeSynced = true;
                            console.log('Time sync: offset ' +
                                Math.round(serverTimeOffsetMs / 1000) + 's (TV clock ' +
                                (serverTimeOffsetMs > 0 ? 'slow' : 'fast') + ')');
                        }
                        if (d.auth_token && !window.odyseeAuthToken) {
                            window.odyseeAuthToken = d.auth_token;
                        }
                    } catch (err) {
                        console.error('Time sync parse error: ' + err.message);
                    }
                } else {
                    console.error('Time sync failed: ' + xhr.status);
                }
                if (cb) {
                    cb();
                }
            };
            xhr.ontimeout = function () {
                console.error('Time sync unavailable, using TV clock');
                if (cb) {
                    cb();
                }
            };
            xhr.onerror = function () {
                console.error('Time sync unavailable, using TV clock');
                if (cb) {
                    cb();
                }
            };
            xhr.send();
        },

        getServerNowSec: function () {
            return Math.floor((new Date().getTime() + serverTimeOffsetMs) / 1000);
        },

        // Resolves user internal auth_token if logged in, or anonymous auth_token.
        ensureAuthToken: function (cb) {
            var xhr;

            if (Auth.getInternalAuthToken()) {
                return cb(Auth.getInternalAuthToken());
            }
            if (window.odyseeAuthToken) {
                return cb(window.odyseeAuthToken);
            }
            xhr = new XMLHttpRequest();
            xhr.open('POST', 'https://api.odysee.com/user/new', true);
            xhr.timeout = 15000;
            xhr.onreadystatechange = function () {
                var resp;

                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        try {
                            resp = JSON.parse(xhr.responseText);
                            if (resp && resp.data && resp.data.auth_token) {
                                window.odyseeAuthToken = resp.data.auth_token;
                                return cb(window.odyseeAuthToken);
                            }
                        } catch (e) { }
                    }
                    cb(null);
                }
            };
            xhr.ontimeout = function () {
                cb(null);
            };
            xhr.onerror = function () {
                cb(null);
            };
            xhr.send();
        }
    };
}());

// Central JSON-RPC 2.0 Client for LBRY / Hub SDK proxy
var LbryRpc = (function () {
    var PROXY_URL = 'https://api.na-backend.odysee.com/api/v1/proxy';
    var MAX_ATTEMPTS = 3;

    function call(method, params, callback, attempt) {
        var url;
        var xhr;
        var internalToken;
        var payload;

        attempt = attempt || 0;

        function retryOrFail(err) {
            var wait;

            if (attempt + 1 < MAX_ATTEMPTS) {
                wait = 2000 * (attempt + 1);
                console.log('API retry ' + (attempt + 1) + '/' + (MAX_ATTEMPTS - 1) +
                    ' (in ' + (wait / 1000) + 's): ' + method);
                setTimeout(function () {
                    call(method, params, callback, attempt + 1);
                }, wait);
                return;
            }
            callback(err);
        }

        url = PROXY_URL;
        if (method === 'get' || method === 'preference_get' || method === 'preference_set') {
            url += '?m=' + method;
        }

        console.log('LbryRpc: [' + method + '] Request. Params: ' + JSON.stringify(params));
        xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json-rpc');

        if (Auth.getAccessToken()) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + Auth.getAccessToken());
        }

        internalToken = Auth.getInternalAuthToken() || window.odyseeAuthToken;
        if (internalToken) {
            xhr.setRequestHeader('X-Lbry-Auth-Token', internalToken);
        }

        xhr.timeout = 20000;
        xhr.ontimeout = function () {
            retryOrFail(new Error('Timeout: cannot reach ' + url));
        };
        xhr.onerror = function () {
            retryOrFail(new Error('Network error reaching ' + url));
        };

        xhr.onreadystatechange = function () {
            var res;

            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        res = JSON.parse(xhr.responseText);
                        if (res.error) {
                            callback(new Error(res.error.message || 'API Error'));
                        } else {
                            callback(null, res.result);
                        }
                    } catch (e) {
                        console.error('LbryRpc: JSON parse error. Proxy returned HTML? Response:', xhr.responseText.substring(0, 100));
                        callback(new Error('Invalid JSON from proxy'));
                    }
                } else {
                    retryOrFail(new Error('Network error: ' + xhr.status));
                }
            }
        };

        payload = {
            method: method,
            params: params,
            jsonrpc: '2.0',
            id: Math.round(1e6 * Math.random())
        };

        xhr.send(JSON.stringify(payload));
    }

    return {
        call: call
    };
}());

// Helper client for internal Odysee REST / form APIs (api.odysee.com)
var LbryIo = (function () {
    var BASE_URL = 'https://api.odysee.com';

    function call(path, options, callback) {
        var method;
        var url;
        var token;
        var isJson;
        var body;
        var parts;
        var key;
        var serialized;
        var xhr;

        options = options || {};
        method = (options.method || 'POST').toUpperCase();
        url = (path.indexOf('http') === 0 ? path : BASE_URL + (path.charAt(0) === '/' ? path : '/' + path));

        // Auto-attach auth_token if available and not already provided
        token = Auth.getInternalAuthToken() || window.odyseeAuthToken;
        if (token && options.data && typeof options.data === 'object' && !options.data.auth_token) {
            options.data.auth_token = token;
        }

        isJson = options.json === true;
        body = null;

        if (options.data) {
            if (isJson) {
                body = JSON.stringify(options.data);
            } else if (typeof options.data === 'string') {
                if (method === 'GET') {
                    url += (url.indexOf('?') === -1 ? '?' : '&') + options.data;
                } else {
                    body = options.data;
                }
            } else {
                parts = [];
                for (key in options.data) {
                    if (options.data.hasOwnProperty(key) && options.data[key] !== undefined && options.data[key] !== null) {
                        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(options.data[key]));
                    }
                }
                serialized = parts.join('&');
                if (method === 'GET') {
                    if (serialized) {
                        url += (url.indexOf('?') === -1 ? '?' : '&') + serialized;
                    }
                } else {
                    body = serialized;
                }
            }
        }

        xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        xhr.timeout = options.timeout || 15000;

        // Only attach Bearer token for /user/me or if explicitly requested,
        // because sending expired Bearer tokens breaks api.odysee.com OIDC middleware.
        if ((path === '/user/me' || options.useBearer === true) && Auth.getAccessToken()) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + Auth.getAccessToken());
        }

        if (isJson) {
            xhr.setRequestHeader('Content-Type', 'application/json');
        } else if (method === 'POST') {
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        }

        xhr.onreadystatechange = function () {
            var res;
            var errRes;

            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        res = JSON.parse(xhr.responseText);
                        callback(null, res);
                    } catch (e) {
                        callback(new Error('Failed to parse JSON response from ' + path));
                    }
                } else {
                    try {
                        errRes = JSON.parse(xhr.responseText);
                        callback(new Error((errRes && errRes.error) || ('Request failed with status: ' + xhr.status)), errRes);
                    } catch (e) {
                        callback(new Error('Request failed with status: ' + xhr.status));
                    }
                }
            }
        };

        xhr.ontimeout = function () {
            callback(new Error('Request timeout for ' + path));
        };
        xhr.onerror = function () {
            callback(new Error('Network error for ' + path));
        };

        xhr.send(method === 'GET' ? null : body);
    }

    return {
        call: call
    };
}());
