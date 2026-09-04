// ---------------------------------------------------------------------------
// Odysee Authentication & User Session Manager (ES5 compatible for webOS 2.0+)
// Implements OAuth 2.0 Device Code Flow against Keycloak SSO (odysee-roku client)
// ---------------------------------------------------------------------------

var Auth = (function () {
    var SSO_BASE = "https://sso.odysee.com";
    var CLIENT_ID = "odysee-roku";
    var DEVICE_AUTH_URL = SSO_BASE + "/auth/realms/Users/protocol/openid-connect/auth/device";
    var TOKEN_URL = SSO_BASE + "/auth/realms/Users/protocol/openid-connect/token";
    var USERINFO_URL = SSO_BASE + "/auth/realms/Users/protocol/openid-connect/userinfo";
    var REVOKE_URL = SSO_BASE + "/auth/realms/Users/protocol/openid-connect/revoke";
    var ROOT_API = "https://api.odysee.com";

    var state = {
        accessToken: null,
        refreshToken: null,
        expiresAt: 0,
        user: {
            email: "",
            userId: "",
            channelName: "",
            channelClaimId: "",
            avatarUrl: "",
            followers: 0
        },
        settings: {
            hideMature: true,
            hideMembersOnly: false,
            hideYoutube: false
        },
        memberships: [], // Array of channel claim IDs
        purchases: []    // Array of purchased claim IDs
    };

    var pollingTimer = null;
    var listeners = [];

    function notifyListeners() {
        var loggedIn = isLoggedIn();
        for (var i = 0; i < listeners.length; i++) {
            try {
                listeners[i](loggedIn, state.user);
            } catch (e) {
                console.error("Auth listener error:", e);
            }
        }
    }

    function loadPersistedSession() {
        try {
            state.accessToken = localStorage.getItem("odysee_auth_access_token") || null;
            state.refreshToken = localStorage.getItem("odysee_auth_refresh_token") || null;
            state.expiresAt = parseInt(localStorage.getItem("odysee_auth_expires_at") || "0", 10);

            var u = localStorage.getItem("odysee_auth_user");
            if (u) state.user = JSON.parse(u);

            var s = localStorage.getItem("odysee_auth_settings");
            if (s) {
                var parsedS = JSON.parse(s);
                state.settings.hideMature = parsedS.hideMature !== undefined ? parsedS.hideMature : true;
                state.settings.hideMembersOnly = parsedS.hideMembersOnly !== undefined ? parsedS.hideMembersOnly : false;
                state.settings.hideYoutube = parsedS.hideYoutube !== undefined ? parsedS.hideYoutube : false;
            }

            var m = localStorage.getItem("odysee_auth_memberships");
            if (m) state.memberships = JSON.parse(m);

            var p = localStorage.getItem("odysee_auth_purchases");
            if (p) state.purchases = JSON.parse(p);
        } catch (e) {
            console.error("Failed to load auth from localStorage:", e);
        }
    }

    function savePersistedSession() {
        try {
            if (state.accessToken) {
                localStorage.setItem("odysee_auth_access_token", state.accessToken);
            } else {
                localStorage.removeItem("odysee_auth_access_token");
            }

            if (state.refreshToken) {
                localStorage.setItem("odysee_auth_refresh_token", state.refreshToken);
            } else {
                localStorage.removeItem("odysee_auth_refresh_token");
            }

            localStorage.setItem("odysee_auth_expires_at", String(state.expiresAt || 0));
            localStorage.setItem("odysee_auth_user", JSON.stringify(state.user || {}));
            localStorage.setItem("odysee_auth_settings", JSON.stringify(state.settings));
            localStorage.setItem("odysee_auth_memberships", JSON.stringify(state.memberships || []));
            localStorage.setItem("odysee_auth_purchases", JSON.stringify(state.purchases || []));
        } catch (e) {
            console.error("Failed to save auth to localStorage:", e);
        }
    }

    function clearPersistedSession() {
        try {
            localStorage.removeItem("odysee_auth_access_token");
            localStorage.removeItem("odysee_auth_refresh_token");
            localStorage.removeItem("odysee_auth_expires_at");
            localStorage.removeItem("odysee_auth_user");
            localStorage.removeItem("odysee_auth_memberships");
            localStorage.removeItem("odysee_auth_purchases");
        } catch (e) {
            console.error("Failed to clear auth from localStorage:", e);
        }

        state.accessToken = null;
        state.refreshToken = null;
        state.expiresAt = 0;
        state.user = {
            email: "",
            userId: "",
            channelName: "",
            channelClaimId: "",
            avatarUrl: "",
            followers: 0
        };
        state.memberships = [];
        state.purchases = [];
    }

    function isLoggedIn() {
        return !!(state.accessToken && (state.user.email || state.user.userId));
    }

    function refreshToken(cb) {
        if (!state.refreshToken) {
            if (cb) cb(new Error("No refresh token"));
            return;
        }

        console.log("Auth: Refreshing access token...");
        var xhr = new XMLHttpRequest();
        xhr.open("POST", TOKEN_URL, true);
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        xhr.timeout = 15000;

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        var res = JSON.parse(xhr.responseText);
                        state.accessToken = res.access_token;
                        if (res.refresh_token) state.refreshToken = res.refresh_token;
                        state.expiresAt = Date.now() + ((res.expires_in || 300) * 1000);
                        savePersistedSession();
                        console.log("Auth: Token refreshed successfully. Valid until:", new Date(state.expiresAt).toLocaleTimeString());
                        if (cb) cb(null, state.accessToken);
                    } catch (err) {
                        console.error("Auth: Token refresh parse error:", err);
                        if (cb) cb(err);
                    }
                } else {
                    console.warn("Auth: Token refresh rejected (" + xhr.status + "). Session expired.");
                    clearPersistedSession();
                    notifyListeners();
                    if (cb) cb(new Error("Token refresh rejected: " + xhr.status));
                }
            }
        };

        xhr.ontimeout = xhr.onerror = function () {
            console.error("Auth: Token refresh network failure");
            if (cb) cb(new Error("Token refresh network failure"));
        };

        var body = "grant_type=refresh_token" +
            "&refresh_token=" + encodeURIComponent(state.refreshToken) +
            "&client_id=" + encodeURIComponent(CLIENT_ID);
        xhr.send(body);
    }

    function fetchUserInfo(cb) {
        if (!state.accessToken) {
            if (cb) cb(new Error("No access token"));
            return;
        }

        // 1. Query Keycloak userinfo
        var xhr = new XMLHttpRequest();
        xhr.open("GET", USERINFO_URL, true);
        xhr.setRequestHeader("Authorization", "Bearer " + state.accessToken);
        xhr.timeout = 15000;

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        state.user.email = data.email || "";
                        state.user.userId = data.sub || "";
                        if (data.preferred_username && !state.user.channelName) {
                            state.user.channelName = data.preferred_username;
                        }

                        // 2. Query Odysee user/me for primary channel & internal token
                        fetchOdyseeProfile(function () {
                            savePersistedSession();
                            notifyListeners();
                            if (cb) cb(null, state.user);
                        });
                    } catch (e) {
                        console.error("Auth: Failed to parse userinfo:", e);
                        if (cb) cb(e);
                    }
                } else if (xhr.status === 401) {
                    // Try refreshing
                    refreshToken(function (err) {
                        if (!err) fetchUserInfo(cb);
                        else if (cb) cb(err);
                    });
                } else {
                    if (cb) cb(new Error("Userinfo failed: " + xhr.status));
                }
            }
        };

        xhr.ontimeout = xhr.onerror = function () {
            if (cb) cb(new Error("Userinfo network error"));
        };

        xhr.send();
    }

    function fetchOdyseeProfile(cb) {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", ROOT_API + "/user/me", true);
        xhr.setRequestHeader("Authorization", "Bearer " + state.accessToken);
        xhr.timeout = 15000;

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        var res = JSON.parse(xhr.responseText);
                        var d = res.data || {};
                        if (d.primary_email && !state.user.email) state.user.email = d.primary_email;
                        if (d.auth_token) window.odyseeAuthToken = d.auth_token;

                        // Query channels
                        fetchUserChannel(function () {
                            fetchMembershipsAndPurchases();
                            if (cb) cb();
                        });
                        return;
                    } catch (e) {
                        console.error("Auth: user/me parse error", e);
                    }
                }
                if (cb) cb();
            }
        };

        xhr.ontimeout = xhr.onerror = function () {
            if (cb) cb();
        };

        xhr.send();
    }

    function fetchUserChannel(cb) {
        // Query claim_search for channel claims owned by this user
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "https://api.na-backend.odysee.com/api/v1/proxy", true);
        xhr.setRequestHeader("Content-Type", "application/json-rpc");
        xhr.setRequestHeader("Authorization", "Bearer " + state.accessToken);
        xhr.timeout = 15000;

        var payload = {
            jsonrpc: "2.0",
            method: "channel_list",
            params: { page_size: 1 },
            id: 1
        };

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        var res = JSON.parse(xhr.responseText);
                        if (res.result && res.result.items && res.result.items.length > 0) {
                            var ch = res.result.items[0];
                            state.user.channelName = ch.name || state.user.channelName;
                            state.user.channelClaimId = ch.claim_id || "";
                            if (ch.value && ch.value.thumbnail && ch.value.thumbnail.url) {
                                state.user.avatarUrl = ch.value.thumbnail.url;
                            }

                            // Fetch subscriber count
                            if (state.user.channelClaimId && window.OdyseeAPI && OdyseeAPI.getSubscriberCount) {
                                OdyseeAPI.getSubscriberCount(state.user.channelClaimId, function (err, count) {
                                    if (!err && typeof count === "number") {
                                        state.user.followers = count;
                                        savePersistedSession();
                                        notifyListeners();
                                    }
                                });
                            }
                        }
                    } catch (e) {
                        console.error("Auth: channel_list parse error", e);
                    }
                }
                savePersistedSession();
                if (cb) cb();
            }
        };

        xhr.ontimeout = xhr.onerror = function () {
            if (cb) cb();
        };

        xhr.send(JSON.stringify(payload));
    }

    function fetchMembershipsAndPurchases() {
        if (!state.accessToken) return;

        // Fetch memberships
        var xhrM = new XMLHttpRequest();
        xhrM.open("GET", ROOT_API + "/membership_v2/list", true);
        xhrM.setRequestHeader("Authorization", "Bearer " + state.accessToken);
        xhrM.onreadystatechange = function () {
            if (xhrM.readyState === 4 && xhrM.status === 200) {
                try {
                    var res = JSON.parse(xhrM.responseText);
                    var items = res.data || [];
                    state.memberships = [];
                    for (var i = 0; i < items.length; i++) {
                        if (items[i].channel_id) state.memberships.push(items[i].channel_id);
                    }
                    savePersistedSession();
                } catch (e) { }
            }
        };
        xhrM.send();

        // Fetch purchases
        var xhrP = new XMLHttpRequest();
        xhrP.open("GET", ROOT_API + "/purchase/list", true);
        xhrP.setRequestHeader("Authorization", "Bearer " + state.accessToken);
        xhrP.onreadystatechange = function () {
            if (xhrP.readyState === 4 && xhrP.status === 200) {
                try {
                    var res = JSON.parse(xhrP.responseText);
                    var items = res.data || [];
                    state.purchases = [];
                    for (var i = 0; i < items.length; i++) {
                        if (items[i].claim_id) state.purchases.push(items[i].claim_id);
                    }
                    savePersistedSession();
                } catch (e) { }
            }
        };
        xhrP.send();
    }

    return {
        init: function (cb) {
            loadPersistedSession();

            if (state.accessToken) {
                var now = Date.now();
                if (state.expiresAt && state.expiresAt < now + 60000) {
                    // Token expired or about to expire -> silent background refresh
                    refreshToken(function (err) {
                        if (!err) {
                            fetchUserInfo(function () {
                                if (cb) cb(isLoggedIn());
                            });
                        } else {
                            if (cb) cb(false);
                        }
                    });
                } else {
                    // Token is still fresh -> refresh profile in background
                    fetchUserInfo(null);
                    if (cb) cb(isLoggedIn());
                }
            } else {
                if (cb) cb(false);
            }
        },

        isLoggedIn: isLoggedIn,

        getAccessToken: function () {
            return state.accessToken;
        },

        getUser: function () {
            return state.user;
        },

        getSettings: function () {
            return state.settings;
        },

        updateSetting: function (key, val) {
            if (state.settings.hasOwnProperty(key)) {
                state.settings[key] = val;
                savePersistedSession();
                return true;
            }
            return false;
        },

        isMemberOf: function (channelClaimId) {
            if (!channelClaimId || !state.memberships) return false;
            return state.memberships.indexOf(channelClaimId) > -1;
        },

        hasPurchased: function (claimId) {
            if (!claimId || !state.purchases) return false;
            return state.purchases.indexOf(claimId) > -1;
        },

        onAuthStateChanged: function (fn) {
            if (typeof fn === "function") {
                listeners.push(fn);
            }
        },

        // Initiate Device Code Flow
        startDeviceFlow: function (onCodeReady, onAuthenticated, onError) {
            this.cancelDeviceFlow();

            var xhr = new XMLHttpRequest();
            xhr.open("POST", DEVICE_AUTH_URL, true);
            xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
            xhr.timeout = 15000;

            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        try {
                            var data = JSON.parse(xhr.responseText);
                            var deviceCode = data.device_code;
                            var userCode = data.user_code;
                            var verificationUri = data.verification_uri || "https://odysee.com/$/activate";
                            var interval = (data.interval || 5) * 1000;
                            var expiresIn = (data.expires_in || 600) * 1000;

                            if (onCodeReady) {
                                onCodeReady({
                                    userCode: userCode,
                                    verificationUri: verificationUri,
                                    expiresIn: expiresIn
                                });
                            }

                            // Start polling loop
                            var expiresAt = Date.now() + expiresIn;
                            pollingTimer = setInterval(function () {
                                if (Date.now() > expiresAt) {
                                    clearInterval(pollingTimer);
                                    pollingTimer = null;
                                    if (onError) onError(new Error("Activation code expired. Please request a new code."));
                                    return;
                                }

                                var pollXhr = new XMLHttpRequest();
                                pollXhr.open("POST", TOKEN_URL, true);
                                pollXhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
                                pollXhr.timeout = 10000;

                                pollXhr.onreadystatechange = function () {
                                    if (pollXhr.readyState === 4) {
                                        if (pollXhr.status === 200) {
                                            clearInterval(pollingTimer);
                                            pollingTimer = null;
                                            try {
                                                var tokenData = JSON.parse(pollXhr.responseText);
                                                state.accessToken = tokenData.access_token;
                                                state.refreshToken = tokenData.refresh_token;
                                                state.expiresAt = Date.now() + ((tokenData.expires_in || 300) * 1000);
                                                savePersistedSession();

                                                fetchUserInfo(function () {
                                                    if (onAuthenticated) onAuthenticated(state.user);
                                                    notifyListeners();
                                                });
                                            } catch (e) {
                                                if (onError) onError(e);
                                            }
                                        } else if (pollXhr.status === 400) {
                                            // Expected while authorization_pending
                                            try {
                                                var errObj = JSON.parse(pollXhr.responseText);
                                                if (errObj.error === "slow_down") {
                                                    // Slow down polling
                                                } else if (errObj.error !== "authorization_pending") {
                                                    clearInterval(pollingTimer);
                                                    pollingTimer = null;
                                                    if (onError) onError(new Error(errObj.error_description || errObj.error));
                                                }
                                            } catch (e) { }
                                        }
                                    }
                                };
                                var body = "grant_type=urn:ietf:params:oauth:grant-type:device_code" +
                                    "&device_code=" + encodeURIComponent(deviceCode) +
                                    "&client_id=" + encodeURIComponent(CLIENT_ID);
                                pollXhr.send(body);
                            }, Math.max(interval, 4000));

                        } catch (e) {
                            if (onError) onError(e);
                        }
                    } else {
                        if (onError) onError(new Error("Failed to initiate device flow: " + xhr.status));
                    }
                }
            };

            xhr.ontimeout = xhr.onerror = function () {
                if (onError) onError(new Error("Network error connecting to SSO server"));
            };

            xhr.send("client_id=" + encodeURIComponent(CLIENT_ID));
        },

        cancelDeviceFlow: function () {
            if (pollingTimer) {
                clearInterval(pollingTimer);
                pollingTimer = null;
            }
        },

        logout: function (cb) {
            this.cancelDeviceFlow();

            if (state.accessToken) {
                var xhr = new XMLHttpRequest();
                xhr.open("POST", REVOKE_URL, true);
                xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
                xhr.timeout = 5000;
                var body = "token=" + encodeURIComponent(state.accessToken) +
                    "&token_type_hint=access_token" +
                    "&client_id=" + encodeURIComponent(CLIENT_ID);
                xhr.send(body);
            }

            clearPersistedSession();
            notifyListeners();
            if (cb) cb();
        }
    };
})();
