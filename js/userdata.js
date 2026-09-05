// ---------------------------------------------------------------------------
// User Data, Social & State Manager for Odysee LGTV (ES5 compatible for webOS 2.0+)
// Manages reactions, view counts, resume points, watch later, and following feeds.
// ---------------------------------------------------------------------------

var UserData = (function () {

    // -----------------------------------------------------------------------
    // Reactions (Like / Dislike)
    // -----------------------------------------------------------------------

    var reactionCache = {};

    function getCachedReactions(claimId) {
        return reactionCache[claimId] || null;
    }

    function getReactions(claimId, callback) {
        LbryNet.ensureAuthToken(function (token) {
            var data = { claim_ids: claimId };
            if (token) data.auth_token = token;

            LbryIo.call("/reaction/list", { data: data }, function (err, resp) {
                if (!err && resp && resp.data) {
                    var others = (resp.data.others_reactions && resp.data.others_reactions[claimId]) || { like: 0, dislike: 0 };
                    var my = (resp.data.my_reactions && resp.data.my_reactions[claimId]) || { like: 0, dislike: 0 };
                    var totalLikes = (others.like || 0) + (my.like || 0);
                    var totalDislikes = (others.dislike || 0) + (my.dislike || 0);
                    var myRx = null;
                    if (my.like > 0) myRx = "like";
                    else if (my.dislike > 0) myRx = "dislike";

                    var entry = {
                        like: totalLikes,
                        dislike: totalDislikes,
                        myReaction: myRx
                    };
                    reactionCache[claimId] = entry;
                    callback(null, entry);
                } else if (!err) {
                    var defaultEntry = { like: 0, dislike: 0, myReaction: null };
                    reactionCache[claimId] = defaultEntry;
                    callback(null, defaultEntry);
                } else {
                    callback(err || new Error("Reaction API failed"));
                }
            });
        });
    }

    function getMyReaction(claimId, callback) {
        if (reactionCache[claimId] && reactionCache[claimId].myReaction !== undefined) {
            return callback(null, reactionCache[claimId].myReaction);
        }
        getReactions(claimId, function (err, res) {
            if (err) return callback(err);
            callback(null, res ? res.myReaction : null);
        });
    }

    function react(claimId, type, remove, callback) {
        var cached = reactionCache[claimId];
        if (!cached) {
            cached = { like: 0, dislike: 0, myReaction: null };
            reactionCache[claimId] = cached;
        }

        if (type === "like") {
            if (remove) {
                cached.like = Math.max(0, cached.like - 1);
                cached.myReaction = null;
            } else {
                cached.like = cached.like + 1;
                if (cached.myReaction === "dislike") {
                    cached.dislike = Math.max(0, cached.dislike - 1);
                }
                cached.myReaction = "like";
            }
        } else if (type === "dislike") {
            if (remove) {
                cached.dislike = Math.max(0, cached.dislike - 1);
                cached.myReaction = null;
            } else {
                cached.dislike = cached.dislike + 1;
                if (cached.myReaction === "like") {
                    cached.like = Math.max(0, cached.like - 1);
                }
                cached.myReaction = "dislike";
            }
        }

        LbryNet.ensureAuthToken(function (token) {
            var data = {
                claim_ids: claimId,
                type: type
            };
            if (remove) data.remove = "true";
            if (token) data.auth_token = token;

            console.log("UserData.react: claim=" + claimId + ", type=" + type + ", remove=" + (remove ? "true" : "false"));
            LbryIo.call("/reaction/react", { data: data }, function (err, resp) {
                if (err) {
                    console.error("UserData.react failed:", err.message || err);
                } else {
                    console.log("UserData.react successful for " + claimId);
                }
                if (callback) {
                    if (!err && resp) callback(null, resp);
                    else callback(err || new Error("React failed"));
                }
            });
        });
    }

    // -----------------------------------------------------------------------
    // View Count & Progress Tracking
    // -----------------------------------------------------------------------

    function getViewCount(claimId, callback) {
        LbryNet.ensureAuthToken(function (token) {
            if (!token) return callback(new Error("No auth token"));
            var data = {
                auth_token: token,
                claim_id: claimId
            };

            LbryIo.call("/file/view_count", { data: data }, function (err, resp) {
                if (!err && resp && resp.data && resp.data.length > 0) {
                    callback(null, resp.data[0]);
                } else if (!err) {
                    callback(null, 0);
                } else {
                    callback(err || new Error("View count API failed"));
                }
            });
        });
    }

    function saveViewProgress(claimId, uri, time) {
        LbryNet.ensureAuthToken(function (token) {
            if (!token) return;
            var data = {
                auth_token: token,
                claim_id: claimId,
                uri: uri,
                last_timestamp: Math.floor(time)
            };
            LbryIo.call("/file/view", { data: data }, function () { });
        });
    }

    // -----------------------------------------------------------------------
    // Resume Points (Local Storage)
    // -----------------------------------------------------------------------

    function getResumePoint(claimId) {
        try {
            var raw = localStorage.getItem("odysee_resume_points");
            var points = raw ? JSON.parse(raw) : {};
            return points[claimId] || null;
        } catch (e) {
            return null;
        }
    }

    function saveResumePoint(claimId, time, duration) {
        try {
            var raw = localStorage.getItem("odysee_resume_points");
            var points = raw ? JSON.parse(raw) : {};
            if (duration && time / duration > 0.9) {
                delete points[claimId];
            } else if (time > 10) {
                points[claimId] = { time: Math.floor(time), duration: Math.floor(duration || 0), updatedAt: Date.now() };
            }
            localStorage.setItem("odysee_resume_points", JSON.stringify(points));
        } catch (e) { }
    }

    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    // Watch Later & Playlists (Odysee Cloud Preferences + Local Storage Cache)
    // -----------------------------------------------------------------------

    var cachedRemoteWatchLaterIds = null;
    var cachedSharedPreferences = null;

    function getWatchLaterIds() {
        if (cachedRemoteWatchLaterIds && cachedRemoteWatchLaterIds.length > 0) {
            return cachedRemoteWatchLaterIds;
        }
        try {
            var raw = localStorage.getItem("odysee_watch_later");
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function saveWatchLater(claimId, add) {
        try {
            var list = getWatchLaterIds().slice(0);
            var idx = list.indexOf(claimId);
            if (add && idx === -1) {
                list.unshift(claimId);
            } else if (!add && idx > -1) {
                list.splice(idx, 1);
            }
            cachedRemoteWatchLaterIds = list;
            localStorage.setItem("odysee_watch_later", JSON.stringify(list));
        } catch (e) { }

        // Sync to Odysee cloud preferences if logged in
        if (window.Auth && Auth.isLoggedIn()) {
            LbryNet.ensureAuthToken(function (token) {
                if (!token) return;

                function syncToCloud(shared) {
                    if (!shared) return;
                    if (!shared.builtinCollections) shared.builtinCollections = {};
                    if (!shared.builtinCollections.watchlater) {
                        shared.builtinCollections.watchlater = {
                            id: "watchlater",
                            name: "Watch Later",
                            itemCount: 0,
                            items: [],
                            type: "playlist",
                            updatedAt: Math.floor(Date.now() / 1000)
                        };
                    }
                    var wl = shared.builtinCollections.watchlater;
                    var items = (wl.items || []).slice(0);
                    var existingIdx = -1;
                    for (var i = 0; i < items.length; i++) {
                        if (typeof items[i] === "string" && items[i].indexOf(claimId) !== -1) {
                            existingIdx = i;
                            break;
                        }
                    }
                    if (add && existingIdx === -1) {
                        items.unshift("lbry://stream#" + claimId);
                    } else if (!add && existingIdx > -1) {
                        items.splice(existingIdx, 1);
                    }
                    wl.items = items;
                    wl.itemCount = items.length;
                    wl.updatedAt = Math.floor(Date.now() / 1000);
                    cachedSharedPreferences = shared;

                    LbryRpc.call("preference_set", { key: "shared", value: shared }, function (err) {
                        if (err) console.warn("UserData: Failed to sync watch later to preference_set:", err);
                        else console.log("UserData: Successfully synced watch later to Odysee cloud preferences.");
                    });
                }

                if (cachedSharedPreferences) {
                    syncToCloud(cachedSharedPreferences);
                } else {
                    LbryRpc.call("preference_get", { key: "shared" }, function (err, res) {
                        if (!err && res && res.shared && res.shared.value) {
                            syncToCloud(res.shared.value);
                        }
                    });
                }
            });
        }
    }

    function isWatchLater(claimId) {
        var list = getWatchLaterIds();
        return list.indexOf(claimId) > -1;
    }

    function extractClaimIdsFromCollection(col) {
        if (!col) return [];
        var raw = [];
        if (col.value && Array.isArray(col.value.claims)) {
            raw = col.value.claims;
        } else if (col.value && Array.isArray(col.value.claim_ids)) {
            raw = col.value.claim_ids;
        } else if (Array.isArray(col.claims)) {
            raw = col.claims;
        } else if (col.value && Array.isArray(col.value.collection_items)) {
            raw = col.value.collection_items;
        } else if (Array.isArray(col.items)) {
            raw = col.items;
        }

        var result = [];
        for (var i = 0; i < raw.length; i++) {
            var item = raw[i];
            if (typeof item === "string") {
                var m = /[0-9a-f]{40}/i.exec(item);
                if (m) result.push(m[0]);
                else if (item.length > 0) result.push(item);
            } else if (item && typeof item === "object") {
                if (item.claim_id) result.push(item.claim_id);
                else if (item.claimId) result.push(item.claimId);
            }
        }
        return result;
    }

    function fetchRemoteWatchLater(callback) {
        if (!window.Auth || !Auth.isLoggedIn()) {
            return callback(null, getWatchLaterIds());
        }

        LbryNet.ensureAuthToken(function (token) {
            if (!token) {
                return callback(null, getWatchLaterIds());
            }

            LbryRpc.call("preference_get", { key: "shared" }, function (err, res) {
                if (!err && res && res.shared && res.shared.value) {
                    cachedSharedPreferences = res.shared.value;
                    var wl = cachedSharedPreferences.builtinCollections && cachedSharedPreferences.builtinCollections.watchlater;
                    if (wl && Array.isArray(wl.items)) {
                        var ids = [];
                        for (var i = 0; i < wl.items.length; i++) {
                            var item = wl.items[i];
                            if (typeof item === "string") {
                                var m = /[0-9a-f]{40}/i.exec(item);
                                if (m) ids.push(m[0]);
                                else if (item.length > 0) ids.push(item);
                            }
                        }
                        console.log("UserData: Found " + ids.length + " items in Odysee cloud Watch Later.");
                        var local = getWatchLaterIds();
                        for (var l = 0; l < local.length; l++) {
                            if (ids.indexOf(local[l]) === -1) {
                                ids.push(local[l]);
                            }
                        }
                        cachedRemoteWatchLaterIds = ids;
                        try {
                            localStorage.setItem("odysee_watch_later", JSON.stringify(ids));
                        } catch (e) { }
                        return callback(null, ids);
                    }
                }
                console.warn("UserData: preference_get did not return watch later, using local fallback.", err);
                callback(null, getWatchLaterIds());
            });
        });
    }

    function getWatchLaterVideos(cb, page) {
        if (typeof cb !== "function") cb = function () {};
        var p = page || 1;
        var size = 20;

        function loadSlice(ids) {
            if (!ids || !ids.length) {
                return cb(null, { items: [], total_pages: 0 });
            }
            var slice = ids.slice((p - 1) * size, p * size);
            if (!slice.length) {
                return cb(null, { items: [], total_pages: 0 });
            }
            LbryRpc.call("claim_search", {
                claim_ids: slice,
                page_size: size,
                has_no_source: false
            }, function (err, res) {
                if (err) return cb(err);
                // Maintain watch later playlist order
                var resolvedMap = {};
                if (res && res.items) {
                    for (var i = 0; i < res.items.length; i++) {
                        resolvedMap[res.items[i].claim_id] = res.items[i];
                    }
                }
                var orderedItems = [];
                for (var j = 0; j < slice.length; j++) {
                    if (resolvedMap[slice[j]]) {
                        orderedItems.push(resolvedMap[slice[j]]);
                    }
                }
                ClaimFilter.filterPlayable(cb)(null, { items: orderedItems, total_pages: Math.ceil(ids.length / size), total_items: ids.length });
            });
        }

        if (p === 1 || !cachedRemoteWatchLaterIds) {
            fetchRemoteWatchLater(function (err, ids) {
                loadSlice(ids);
            });
        } else {
            loadSlice(cachedRemoteWatchLaterIds);
        }
    }

    // -----------------------------------------------------------------------
    // Playlists (Built-in, Private Unlisted, and Public Channel Collections)
    // -----------------------------------------------------------------------

    function getUserPlaylists(callback) {
        if (!window.Auth || !Auth.isLoggedIn()) {
            return callback(null, []);
        }

        LbryNet.ensureAuthToken(function (token) {
            if (!token) {
                return callback(null, []);
            }

            LbryRpc.call("preference_get", { key: "shared" }, function (err, res) {
                var playlists = [];
                var shared = (!err && res && res.shared && res.shared.value) ? res.shared.value : cachedSharedPreferences;
                if (shared) {
                    cachedSharedPreferences = shared;

                    // 1. Built-in: Watch Later
                    if (shared.builtinCollections && shared.builtinCollections.watchlater) {
                        var wl = shared.builtinCollections.watchlater;
                        var wlIds = [];
                        if (Array.isArray(wl.items)) {
                            for (var wi = 0; wi < wl.items.length; wi++) {
                                var wm = /[0-9a-f]{40}/i.exec(wl.items[wi]);
                                if (wm) wlIds.push(wm[0]);
                            }
                        }
                        var localWl = getWatchLaterIds();
                        for (var l = 0; l < localWl.length; l++) {
                            if (wlIds.indexOf(localWl[l]) === -1) {
                                wlIds.push(localWl[l]);
                            }
                        }
                        playlists.push({
                            id: "watchlater",
                            name: "Watch Later",
                            type: "builtin",
                            badge: "Default Playlist",
                            itemCount: wlIds.length,
                            items: wlIds,
                            coverClaimId: wlIds[0] || null,
                            updatedAt: wl.updatedAt || 0
                        });
                    }

                    // 2. Built-in: Favorites
                    if (shared.builtinCollections && shared.builtinCollections.favorites) {
                        var fav = shared.builtinCollections.favorites;
                        var favIds = [];
                        if (Array.isArray(fav.items)) {
                            for (var fi = 0; fi < fav.items.length; fi++) {
                                var fm = /[0-9a-f]{40}/i.exec(fav.items[fi]);
                                if (fm) favIds.push(fm[0]);
                            }
                        }
                        playlists.push({
                            id: "favorites",
                            name: "Favorites",
                            type: "builtin",
                            badge: "Default Playlist",
                            itemCount: favIds.length,
                            items: favIds,
                            coverClaimId: favIds[0] || null,
                            updatedAt: fav.updatedAt || 0
                        });
                    }

                    // 3. Unpublished (Private / Unlisted)
                    if (shared.unpublishedCollections && typeof shared.unpublishedCollections === "object") {
                        for (var unpId in shared.unpublishedCollections) {
                            if (!shared.unpublishedCollections.hasOwnProperty(unpId)) continue;
                            var unp = shared.unpublishedCollections[unpId];
                            if (!unp) continue;
                            var unpIds = [];
                            if (Array.isArray(unp.items)) {
                                for (var ui = 0; ui < unp.items.length; ui++) {
                                    var um = /[0-9a-f]{40}/i.exec(unp.items[ui]);
                                    if (um) unpIds.push(um[0]);
                                }
                            }
                            playlists.push({
                                id: unp.id || unpId,
                                name: unp.name || unp.title || "Custom Playlist",
                                type: "unpublished",
                                badge: "Private",
                                itemCount: unpIds.length,
                                items: unpIds,
                                coverClaimId: unpIds[0] || null,
                                updatedAt: unp.updatedAt || 0
                            });
                        }
                    }
                }

                // 4. Also fetch any public channel collections
                var channelIds = (typeof Auth.getChannelClaimIds === "function") ? Auth.getChannelClaimIds() : [];
                var u = Auth.getUser ? Auth.getUser() : null;
                if (u && u.channelClaimId && channelIds.indexOf(u.channelClaimId) === -1) {
                    channelIds.push(u.channelClaimId);
                }

                function finishWithThumbnails(list) {
                    var coverIds = [];
                    for (var p = 0; p < list.length; p++) {
                        if (list[p].items && list[p].items.length > 0) {
                            list[p].coverClaimId = list[p].items[0];
                        }
                        if (list[p].coverClaimId && coverIds.indexOf(list[p].coverClaimId) === -1) {
                            coverIds.push(list[p].coverClaimId);
                        }
                    }
                    if (!coverIds.length) {
                        return callback(null, list);
                    }
                    LbryRpc.call("claim_search", { claim_ids: coverIds, page_size: coverIds.length }, function (cErr, cRes) {
                        if (!cErr && cRes && cRes.items) {
                            var thumbMap = {};
                            for (var ci = 0; ci < cRes.items.length; ci++) {
                                var item = cRes.items[ci];
                                if (item && item.claim_id && item.value && item.value.thumbnail) {
                                    thumbMap[item.claim_id] = item.value.thumbnail.url;
                                }
                            }
                            for (var pi = 0; pi < list.length; pi++) {
                                if (list[pi].coverClaimId && thumbMap[list[pi].coverClaimId]) {
                                    list[pi].thumbnailUrl = thumbMap[list[pi].coverClaimId];
                                }
                            }
                        }
                        callback(null, list);
                    });
                }

                if (channelIds && channelIds.length > 0) {
                    LbryRpc.call("claim_search", { claim_type: ["collection"], channel_ids: channelIds, page_size: 30 }, function (pubErr, pubRes) {
                        if (!pubErr && pubRes && pubRes.items && pubRes.items.length > 0) {
                            for (var pj = 0; pj < pubRes.items.length; pj++) {
                                var col = pubRes.items[pj];
                                var cIds = extractClaimIdsFromCollection(col);
                                playlists.push({
                                   id: col.claim_id,
                                   name: (col.value && col.value.title) || col.name || "Channel Playlist",
                                   type: "published",
                                   badge: "Public",
                                   itemCount: cIds.length,
                                   items: cIds,
                                   coverClaimId: cIds[0] || null,
                                   thumbnailUrl: (col.value && col.value.thumbnail && col.value.thumbnail.url) || null,
                                   claim: col,
                                   updatedAt: (col.meta && col.meta.creation_timestamp) || 0
                                });
                            }
                        }
                        finishWithThumbnails(playlists);
                    });
                } else {
                    finishWithThumbnails(playlists);
                }
            });
        });
    }

    function getPlaylistVideos(playlist, callback, page) {
        if (typeof callback !== "function") callback = function () {};
        var p = page || 1;
        var size = 20;
        var ids = [];
        if (!playlist) return callback(null, { items: [], total_pages: 0 });

        if (Array.isArray(playlist.items)) {
            ids = playlist.items;
        } else if (playlist.claim) {
            ids = extractClaimIdsFromCollection(playlist.claim);
        }

        if (!ids.length) {
            return callback(null, { items: [], total_pages: 0 });
        }

        var slice = ids.slice((p - 1) * size, p * size);
        if (!slice.length) {
            return callback(null, { items: [], total_pages: 0 });
        }

        LbryRpc.call("claim_search", {
            claim_ids: slice,
            page_size: size,
            has_no_source: false
        }, function (err, res) {
            if (err) return callback(err);
            var resolvedMap = {};
            if (res && res.items) {
                for (var i = 0; i < res.items.length; i++) {
                    resolvedMap[res.items[i].claim_id] = res.items[i];
                }
            }
            var orderedItems = [];
            for (var j = 0; j < slice.length; j++) {
                if (resolvedMap[slice[j]]) {
                    orderedItems.push(resolvedMap[slice[j]]);
                }
            }
            ClaimFilter.filterPlayable(callback)(null, { items: orderedItems, total_pages: Math.ceil(ids.length / size), total_items: ids.length });
        });
    }

    if (window.Auth && typeof Auth.onAuthStateChanged === "function") {
        Auth.onAuthStateChanged(function (isLoggedIn) {
            if (!isLoggedIn) {
                cachedRemoteWatchLaterIds = null;
                cachedSharedPreferences = null;
                cachedFollowedChannels = null;
            } else {
                cachedFollowedChannels = null;
                getFollowedChannels(function () {});
            }
        });
    }

    // -----------------------------------------------------------------------
    // Followed Channels & Following Feed
    // -----------------------------------------------------------------------

    var cachedFollowedChannels = null;

    function getFollowedChannels(callback, forceRefresh) {
        if (cachedFollowedChannels && !forceRefresh) {
            return callback(null, cachedFollowedChannels);
        }

        var results = [];
        var seenIds = {};

        function addChannel(claimId, name) {
            if (!claimId || seenIds[claimId]) return;
            seenIds[claimId] = true;
            results.push({
                claim_id: claimId,
                channel_id: claimId,
                channel_name: name || ""
            });
        }

        // Pre-fill from cachedSharedPreferences if available
        if (cachedSharedPreferences) {
            var cachedList = [];
            if (Array.isArray(cachedSharedPreferences.following)) cachedList = cachedList.concat(cachedSharedPreferences.following);
            if (Array.isArray(cachedSharedPreferences.subscriptions)) cachedList = cachedList.concat(cachedSharedPreferences.subscriptions);
            for (var ci = 0; ci < cachedList.length; ci++) {
                var cEntry = cachedList[ci];
                var cUri = (typeof cEntry === "string") ? cEntry : (cEntry && cEntry.uri ? cEntry.uri : "");
                var cMatch = /[0-9a-f]{40}/i.exec(cUri);
                var cNameMatch = /@([^\/#:]+)/.exec(cUri);
                var cId = cMatch ? cMatch[0] : (cEntry && (cEntry.claim_id || cEntry.channel_id));
                var cName = cNameMatch ? ("@" + cNameMatch[1]) : (cEntry && (cEntry.channel_name || cEntry.name));
                if (cId) addChannel(cId, cName);
            }
        }

        LbryNet.ensureAuthToken(function (token) {
            var doneCount = 0;
            var isFinished = false;

            function finish() {
                doneCount++;
                if (!isFinished && doneCount >= 2) {
                    isFinished = true;
                    cachedFollowedChannels = results;
                    callback(null, results);
                }
            }

            // Safety timeout: never hang more than 3.5s
            setTimeout(function () {
                if (!isFinished) {
                    isFinished = true;
                    cachedFollowedChannels = results;
                    callback(null, results);
                }
            }, 3500);

            // A) /subscription/list via internal API
            if (token) {
                var data = { auth_token: token };
                LbryIo.call("/subscription/list", { method: "POST", data: data }, function (err, resp) {
                    if (!err && resp && resp.success && Array.isArray(resp.data)) {
                        for (var i = 0; i < resp.data.length; i++) {
                            var item = resp.data[i];
                            var cid = item.claim_id || item.channel_id;
                            if (cid) addChannel(cid, item.channel_name || item.name);
                        }
                    }
                    finish();
                });
            } else {
                finish();
            }

            // B) shared preferences (preference_get key="shared")
            LbryRpc.call("preference_get", { key: "shared" }, function (err, res) {
                var shared = (!err && res && res.shared && res.shared.value) ? res.shared.value : cachedSharedPreferences;
                if (shared) {
                    cachedSharedPreferences = shared;
                    var list = [];
                    if (Array.isArray(shared.following)) list = list.concat(shared.following);
                    if (Array.isArray(shared.subscriptions)) list = list.concat(shared.subscriptions);

                    for (var j = 0; j < list.length; j++) {
                        var entry = list[j];
                        var uri = (typeof entry === "string") ? entry : (entry && entry.uri ? entry.uri : "");
                        var cidMatch = /[0-9a-f]{40}/i.exec(uri);
                        var nameMatch = /@([^\/#:]+)/.exec(uri);
                        var cid = cidMatch ? cidMatch[0] : (entry && (entry.claim_id || entry.channel_id));
                        var name = nameMatch ? ("@" + nameMatch[1]) : (entry && (entry.channel_name || entry.name));
                        if (cid) addChannel(cid, name);
                    }
                }
                finish();
            });
        });
    }

    function getFollowingVideos(cb, page) {
        getFollowedChannels(function (err, channels) {
            if (err) return cb(err);
            if (!channels || !channels.length) {
                return cb(null, { items: [], total_pages: 0 });
            }
            var cids = [];
            for (var i = 0; i < channels.length && cids.length < 50; i++) {
                var cid = channels[i].claim_id || channels[i].channel_id;
                if (cid && cids.indexOf(cid) === -1) cids.push(cid);
            }
            if (!cids.length) return cb(null, { items: [], total_pages: 0 });

            LbryRpc.call("claim_search", {
                channel_ids: cids,
                claim_type: ["stream"],
                stream_types: ["video"],
                page_size: 20,
                page: page || 1,
                has_no_source: false,
                fee_amount: "<=0",
                order_by: ["release_time"] // Newest first
            }, ClaimFilter.filterPlayable(cb));
        });
    }

    function followChannel(claimId, channelName, callback) {
        if (!claimId) return callback && callback(new Error("claimId required"));
        if (channelName && channelName.charAt(0) !== "@") {
            channelName = "@" + channelName;
        }
        LbryNet.ensureAuthToken(function (token) {
            if (!token) {
                return callback && callback(new Error("No auth token available"));
            }
            var data = {
                claim_id: claimId,
                channel_name: channelName || "",
                notifications_disabled: "true",
                auth_token: token
            };
            LbryIo.call("/subscription/new", {
                method: "POST",
                data: data
            }, function (err, resp) {
                if (!err && resp && resp.success) {
                    if (cachedFollowedChannels) {
                        var exists = false;
                        for (var i = 0; i < cachedFollowedChannels.length; i++) {
                            var cid = cachedFollowedChannels[i].claim_id || cachedFollowedChannels[i].channel_id;
                            if (cid === claimId) {
                                exists = true;
                                break;
                            }
                        }
                        if (!exists) {
                            cachedFollowedChannels.push({
                                claim_id: claimId,
                                channel_id: claimId,
                                channel_name: channelName,
                                is_notifications_disabled: true
                            });
                        }
                    }

                    // Sync to shared.following preference
                    if (cachedSharedPreferences) {
                        if (!Array.isArray(cachedSharedPreferences.following)) {
                            cachedSharedPreferences.following = [];
                        }
                        var uri = "lbry://" + (channelName || "@channel") + "#" + claimId;
                        var alreadyInShared = false;
                        for (var fi = 0; fi < cachedSharedPreferences.following.length; fi++) {
                            var fItem = cachedSharedPreferences.following[fi];
                            if ((typeof fItem === "string" && fItem.indexOf(claimId) !== -1) ||
                                (fItem && fItem.uri && fItem.uri.indexOf(claimId) !== -1)) {
                                alreadyInShared = true;
                                break;
                            }
                        }
                        if (!alreadyInShared) {
                            cachedSharedPreferences.following.push({
                                uri: uri,
                                notificationsDisabled: true
                            });
                            LbryRpc.call("preference_set", { key: "shared", value: cachedSharedPreferences }, function () {});
                        }
                    }

                    if (callback) callback(null, resp.data);
                } else {
                    var errMsg = (resp && resp.error) ? resp.error : "Follow failed";
                    if (callback) callback(err || new Error(errMsg));
                }
            });
        });
    }

    function unfollowChannel(claimId, channelName, callback) {
        if (!claimId) return callback && callback(new Error("claimId required"));
        LbryNet.ensureAuthToken(function (token) {
            if (!token) {
                return callback && callback(new Error("No auth token available"));
            }
            var data = {
                claim_id: claimId,
                auth_token: token
            };
            LbryIo.call("/subscription/delete", {
                method: "POST",
                data: data
            }, function (err, resp) {
                if (!err && resp && resp.success) {
                    if (cachedFollowedChannels) {
                        cachedFollowedChannels = cachedFollowedChannels.filter(function (ch) {
                            return (ch.claim_id || ch.channel_id) !== claimId;
                        });
                    }

                    // Sync to shared.following preference
                    if (cachedSharedPreferences && Array.isArray(cachedSharedPreferences.following)) {
                        cachedSharedPreferences.following = cachedSharedPreferences.following.filter(function (fItem) {
                            if (typeof fItem === "string") return fItem.indexOf(claimId) === -1;
                            if (fItem && fItem.uri) return fItem.uri.indexOf(claimId) === -1;
                            return true;
                        });
                        LbryRpc.call("preference_set", { key: "shared", value: cachedSharedPreferences }, function () {});
                    }

                    if (callback) callback(null, resp.data);
                } else {
                    var errMsg = (resp && resp.error) ? resp.error : "Unfollow failed";
                    if (callback) callback(err || new Error(errMsg));
                }
            });
        });
    }

    function isFollowingChannel(claimId, callback) {
        getFollowedChannels(function (err, channels) {
            if (err || !channels) return callback(false);
            for (var i = 0; i < channels.length; i++) {
                var cid = channels[i].claim_id || channels[i].channel_id;
                if (cid === claimId) return callback(true);
            }
            callback(false);
        });
    }
    return {
        getReactions: getReactions,
        getMyReaction: getMyReaction,
        getCachedReactions: getCachedReactions,
        react: react,
        getViewCount: getViewCount,
        saveViewProgress: saveViewProgress,
        getResumePoint: getResumePoint,
        saveResumePoint: saveResumePoint,
        getWatchLaterIds: getWatchLaterIds,
        saveWatchLater: saveWatchLater,
        isWatchLater: isWatchLater,
        getWatchLaterVideos: getWatchLaterVideos,
        getUserPlaylists: getUserPlaylists,
        getPlaylistVideos: getPlaylistVideos,
        getFollowedChannels: getFollowedChannels,
        getFollowingVideos: getFollowingVideos,
        followChannel: followChannel,
        unfollowChannel: unfollowChannel,
        isFollowingChannel: isFollowingChannel
    };
})();
