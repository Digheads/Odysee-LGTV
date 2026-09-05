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
    var DEFAULT_AVATAR = "https://thumbnails.odycdn.com/optimize/s:160:160/quality:85/plain/https://spee.ch/spaceman-png:2.png";

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
            if (u) {
                state.user = JSON.parse(u);
            }

            var internalTok = localStorage.getItem("odysee_internal_auth_token");
            if (internalTok) {
                state.user.authToken = internalTok;
                window.odyseeAuthToken = internalTok;
            } else if (state.user && state.user.authToken) {
                window.odyseeAuthToken = state.user.authToken;
            }

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

            if (state.user && state.user.authToken) {
                localStorage.setItem("odysee_internal_auth_token", state.user.authToken);
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
            localStorage.removeItem("odysee_internal_auth_token");
            window.odyseeAuthToken = null;
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
                        if (data.picture) state.user.avatarUrl = data.picture;
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
        LbryIo.call("/user/me", { method: "POST" }, function (err, res) {
            if (!err && res && res.data) {
                var d = res.data;
                if (d.primary_email && !state.user.email) state.user.email = d.primary_email;
                if (d.auth_token) {
                    state.user.authToken = d.auth_token;
                    window.odyseeAuthToken = d.auth_token;
                    savePersistedSession();
                }

                // Query channels & memberships
                fetchUserChannel(function () {
                    fetchMembershipsAndPurchases();
                    if (cb) cb();
                });
                return;
            }
            if (cb) cb();
        });
    }

    function fetchUserChannel(cb) {
        LbryRpc.call("channel_list", { page_size: 20 }, function (err, result) {
            if (!err && result && result.items && result.items.length > 0) {
                state.user.channelClaimIds = [];
                for (var ci = 0; ci < result.items.length; ci++) {
                    if (result.items[ci].claim_id) {
                        state.user.channelClaimIds.push(result.items[ci].claim_id);
                    }
                }
                var ch = result.items[0];
                state.user.channelName = ch.name || state.user.channelName;
                state.user.channelClaimId = ch.claim_id || "";
                if (ch.value && ch.value.thumbnail && ch.value.thumbnail.url) {
                    state.user.avatarUrl = ch.value.thumbnail.url;
                } else if (!state.user.avatarUrl) {
                    state.user.avatarUrl = DEFAULT_AVATAR;
                }

                // Fetch subscriber count via LbryIo without circular OdyseeAPI dependency
                if (state.user.channelClaimId) {
                    LbryIo.call("/subscription/sub_count", { data: { claim_id: state.user.channelClaimId } }, function (subErr, subRes) {
                        if (!subErr && subRes && subRes.data && subRes.data.length > 0 && typeof subRes.data[0] === "number") {
                            state.user.followers = subRes.data[0];
                            savePersistedSession();
                            notifyListeners();
                        }
                    });
                }
            }
            savePersistedSession();
            if (cb) cb();
        });
    }

    function fetchMembershipsAndPurchases() {
        if (!state.accessToken) return;

        LbryIo.call("/membership_v2/list", { method: "GET" }, function (err, res) {
            if (!err && res && res.data) {
                var items = res.data || [];
                state.memberships = [];
                for (var i = 0; i < items.length; i++) {
                    if (items[i].channel_id) state.memberships.push(items[i].channel_id);
                }
                savePersistedSession();
            }
        });

        LbryIo.call("/purchase/list", { method: "GET" }, function (err, res) {
            if (!err && res && res.data) {
                var items = res.data || [];
                state.purchases = [];
                for (var i = 0; i < items.length; i++) {
                    if (items[i].claim_id) state.purchases.push(items[i].claim_id);
                }
                savePersistedSession();
            }
        });
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

        getInternalAuthToken: function () {
            return (state.user && state.user.authToken) || window.odyseeAuthToken || null;
        },

        getUser: function () {
            return state.user;
        },

        getAvatarUrl: function () {
            if (state.user && state.user.avatarUrl) {
                return state.user.avatarUrl;
            }
            return DEFAULT_AVATAR;
        },

        getChannelClaimIds: function () {
            if (state.user && state.user.channelClaimIds && state.user.channelClaimIds.length > 0) {
                return state.user.channelClaimIds;
            }
            if (state.user && state.user.channelClaimId) {
                return [state.user.channelClaimId];
            }
            return [];
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
