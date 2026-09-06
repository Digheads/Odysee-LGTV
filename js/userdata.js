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

            if (token) {
                data.auth_token = token;
            }

            LbryIo.call('/reaction/list', { data: data }, function (err, resp) {
                var others;
                var my;
                var totalLikes;
                var totalDislikes;
                var myRx;
                var entry;
                var defaultEntry;

                if (!err && resp && resp.data) {
                    others = (resp.data.others_reactions && resp.data.others_reactions[claimId]) || { like: 0, dislike: 0 };
                    my = (resp.data.my_reactions && resp.data.my_reactions[claimId]) || { like: 0, dislike: 0 };
                    totalLikes = (others.like || 0) + (my.like || 0);
                    totalDislikes = (others.dislike || 0) + (my.dislike || 0);
                    myRx = null;
                    if (my.like > 0) {
                        myRx = 'like';
                    } else if (my.dislike > 0) {
                        myRx = 'dislike';
                    }

                    entry = {
                        like: totalLikes,
                        dislike: totalDislikes,
                        myReaction: myRx
                    };
                    reactionCache[claimId] = entry;
                    callback(null, entry);
                } else if (!err) {
                    defaultEntry = {
                        like: 0,
                        dislike: 0,
                        myReaction: null
                    };
                    reactionCache[claimId] = defaultEntry;
                    callback(null, defaultEntry);
                } else {
                    callback(err || new Error('Reaction API failed'));
                }
            });
        });
    }

    function getMyReaction(claimId, callback) {
        if (reactionCache[claimId] && reactionCache[claimId].myReaction !== undefined) {
            return callback(null, reactionCache[claimId].myReaction);
        }
        getReactions(claimId, function (err, res) {
            if (err) {
                return callback(err);
            }
            callback(null, res ? res.myReaction : null);
        });
    }

    function react(claimId, type, remove, callback) {
        var cached = reactionCache[claimId];

        if (!cached) {
            cached = {
                like: 0,
                dislike: 0,
                myReaction: null
            };
            reactionCache[claimId] = cached;
        }

        if (type === 'like') {
            if (remove) {
                cached.like = Math.max(0, cached.like - 1);
                cached.myReaction = null;
            } else {
                cached.like = cached.like + 1;
                if (cached.myReaction === 'dislike') {
                    cached.dislike = Math.max(0, cached.dislike - 1);
                }
                cached.myReaction = 'like';
            }
        } else if (type === 'dislike') {
            if (remove) {
                cached.dislike = Math.max(0, cached.dislike - 1);
                cached.myReaction = null;
            } else {
                cached.dislike = cached.dislike + 1;
                if (cached.myReaction === 'like') {
                    cached.like = Math.max(0, cached.like - 1);
                }
                cached.myReaction = 'dislike';
            }
        }

        LbryNet.ensureAuthToken(function (token) {
            var data = {
                claim_ids: claimId,
                type: type
            };

            if (remove) {
                data.remove = 'true';
            }
            if (token) {
                data.auth_token = token;
            }

            console.log('UserData.react: claim=' + claimId + ', type=' + type + ', remove=' + (remove ? 'true' : 'false'));
            LbryIo.call('/reaction/react', { data: data }, function (err, resp) {
                if (err) {
                    console.error('UserData.react failed:', err.message || err);
                } else {
                    console.log('UserData.react successful for ' + claimId);
                }
                if (callback) {
                    if (!err && resp) {
                        callback(null, resp);
                    } else {
                        callback(err || new Error('React failed'));
                    }
                }
            });
        });
    }

    // -----------------------------------------------------------------------
    // View Count & Progress Tracking
    // -----------------------------------------------------------------------

    function getViewCount(claimId, callback) {
        LbryNet.ensureAuthToken(function (token) {
            var data;

            if (!token) {
                return callback(new Error('No auth token'));
            }
            data = {
                auth_token: token,
                claim_id: claimId
            };

            LbryIo.call('/file/view_count', { data: data }, function (err, resp) {
                if (!err && resp && resp.data && resp.data.length > 0) {
                    callback(null, resp.data[0]);
                } else if (!err) {
                    callback(null, 0);
                } else {
                    callback(err || new Error('View count API failed'));
                }
            });
        });
    }

    function saveViewProgress(claimId, uri, time) {
        LbryNet.ensureAuthToken(function (token) {
            var data;

            if (!token) {
                return;
            }
            data = {
                auth_token: token,
                claim_id: claimId,
                uri: uri,
                last_timestamp: Math.floor(time)
            };
            LbryIo.call('/file/view', { data: data }, function () { });
        });
    }

    // -----------------------------------------------------------------------
    // Resume Points (Local Storage)
    // -----------------------------------------------------------------------

    function getResumePoint(claimId) {
        var raw;
        var points;

        try {
            raw = localStorage.getItem('odysee_resume_points');
            points = raw ? JSON.parse(raw) : {};
            return points[claimId] || null;
        } catch (e) {
            return null;
        }
    }

    function saveResumePoint(claimId, time, duration, completed) {
        var raw;
        var points;
        var isCompleted;

        try {
            raw = localStorage.getItem('odysee_resume_points');
            points = raw ? JSON.parse(raw) : {};
            if (!claimId) {
                return;
            }

            isCompleted = !!completed || (duration > 0 && (time >= duration - 10 || (time / duration) >= 0.97));

            if (isCompleted && duration > 0) {
                points[claimId] = {
                    time: Math.floor(duration),
                    duration: Math.floor(duration),
                    completed: true,
                    updatedAt: Date.now()
                };
            } else if (time > 10) {
                points[claimId] = {
                    time: Math.floor(time),
                    duration: Math.floor(duration || 0),
                    completed: false,
                    updatedAt: Date.now()
                };
            }
            localStorage.setItem('odysee_resume_points', JSON.stringify(points));
        } catch (e) { }
    }

    // -----------------------------------------------------------------------
    // Watch Later & Playlists (Odysee Cloud Preferences - No localStorage Fallback)
    // -----------------------------------------------------------------------

    var cachedRemoteWatchLaterIds = null;
    var cachedSharedPreferences = null;

    function parseSharedPreference(res) {
        var val = null;

        if (!res) {
            return null;
        }
        if (res.shared && res.shared.value !== undefined) {
            val = res.shared.value;
        } else if (res.shared !== undefined) {
            val = res.shared;
        } else if (res.value !== undefined) {
            val = res.value;
        } else {
            val = res;
        }

        if (typeof val === 'string') {
            try {
                val = JSON.parse(val);
            } catch (e) { }
        }
        if (typeof val === 'string') {
            try {
                val = JSON.parse(val);
            } catch (e) { }
        }
        if (val && typeof val === 'object' && val.value && typeof val.value === 'object') {
            val = val.value;
        }
        return (val && typeof val === 'object') ? val : null;
    }

    function extractClaimIdFromItem(item) {
        var matches;
        var clean;
        var parts;
        var last;

        if (!item) {
            return null;
        }
        if (typeof item === 'object') {
            if (item.claim_id) {
                return item.claim_id;
            }
            if (item.claimId) {
                return item.claimId;
            }
            if (item.channel_id) {
                return item.channel_id;
            }
            if (item.uri) {
                item = item.uri;
            } else {
                return null;
            }
        }
        if (typeof item === 'string') {
            item = item.trim();
            if (/^[0-9a-f]{40}$/i.test(item)) {
                return item.toLowerCase();
            }
            matches = item.match(/[0-9a-f]{40}/gi);
            if (matches && matches.length > 0) {
                return matches[matches.length - 1].toLowerCase();
            }
            clean = item.replace(/#/g, ':');
            parts = clean.split(':');
            last = parts[parts.length - 1];
            if (last && last.length >= 10 && /^[0-9a-f]+$/i.test(last)) {
                return last.toLowerCase();
            }
        }
        return null;
    }



    function extractClaimIdsFromCollection(col) {
        var raw;
        var result;
        var i;
        var cid;

        if (!col) {
            return [];
        }
        raw = [];
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

        result = [];
        for (i = 0; i < raw.length; i++) {
            cid = extractClaimIdFromItem(raw[i]);
            if (cid && result.indexOf(cid) === -1) {
                result.push(cid);
            }
        }
        return result;
    }

    function fetchRemoteWatchLater(callback) {
        if (!Auth.isLoggedIn()) {
            cachedRemoteWatchLaterIds = [];
            return callback(null, []);
        }

        LbryNet.ensureAuthToken(function () {
            LbryRpc.call('preference_get', { key: 'shared' }, function (err, res) {
                var shared = parseSharedPreference(res);
                var builtIn;
                var k;
                var col;
                var colId;
                var colName;
                var ids;

                if (shared) {
                    cachedSharedPreferences = shared;
                    builtIn = shared.builtInCollections || shared.builtinCollections || {};
                    for (k in builtIn) {
                        if (builtIn.hasOwnProperty(k)) {
                            col = builtIn[k];
                            if (col) {
                                colId = String(col.id || k).toLowerCase();
                                colName = (col.name || col.title || '').toLowerCase();
                                if (colId === 'watchlater' || colId === 'watch_later' || colName === 'watch later' || colName.indexOf('watch later') !== -1) {
                                    ids = extractClaimIdsFromCollection(col);
                                    cachedRemoteWatchLaterIds = ids;
                                    console.log('UserData: Found ' + ids.length + ' items in Odysee cloud Watch Later.');
                                    return callback(null, ids);
                                }
                            }
                        }
                    }
                }
                cachedRemoteWatchLaterIds = [];
                console.warn('UserData: preference_get did not find watch later collection.', err || 'none');
                callback(null, []);
            });
        });
    }

    function getWatchLaterVideos(cb, page) {
        var p;
        var size;

        if (typeof cb !== 'function') {
            cb = function () { };
        }
        p = page || 1;
        size = 20;

        function loadSlice(ids) {
            var slice;

            if (!ids || !ids.length) {
                return cb(null, {
                    items: [],
                    total_pages: 0
                });
            }
            slice = ids.slice((p - 1) * size, p * size);
            if (!slice.length) {
                return cb(null, {
                    items: [],
                    total_pages: 0
                });
            }
            LbryRpc.call('claim_search', {
                claim_ids: slice,
                page_size: size,
                has_no_source: false
            }, function (err, res) {
                var resolvedMap;
                var i;
                var orderedItems;
                var j;

                if (err) {
                    return cb(err);
                }
                // Maintain watch later playlist order
                resolvedMap = {};
                if (res && res.items) {
                    for (i = 0; i < res.items.length; i++) {
                        resolvedMap[res.items[i].claim_id] = res.items[i];
                    }
                }
                orderedItems = [];
                for (j = 0; j < slice.length; j++) {
                    if (resolvedMap[slice[j]]) {
                        orderedItems.push(resolvedMap[slice[j]]);
                    }
                }
                ClaimFilter.filterPlayable(cb)(null, {
                    items: orderedItems,
                    total_pages: Math.ceil(ids.length / size),
                    total_items: ids.length
                });
            });
        }

        if (p === 1 || !cachedRemoteWatchLaterIds) {
            fetchRemoteWatchLater(function (err, ids) {
                loadSlice(ids || []);
            });
        } else {
            loadSlice(cachedRemoteWatchLaterIds);
        }
    }

    // -----------------------------------------------------------------------
    // Playlists (Built-in, Private Unlisted, and Public Channel Collections)
    // -----------------------------------------------------------------------

    function getUserPlaylists(callback) {
        if (!Auth.isLoggedIn()) {
            return callback(null, []);
        }

        LbryNet.ensureAuthToken(function () {
            LbryRpc.call('preference_get', { key: 'shared' }, function (err, res) {
                var playlists = [];
                var shared = parseSharedPreference(res) || cachedSharedPreferences;
                var builtIn;
                var foundWatchLater;
                var foundFavorites;
                var bk;
                var bCol;
                var bId;
                var bName;
                var bIds;
                var unpublished;
                var unpId;
                var unp;
                var unpIds;
                var channelIds;
                var u;

                function finishWithThumbnails(list) {
                    var coverIds = [];
                    var p;

                    for (p = 0; p < list.length; p++) {
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
                    LbryRpc.call('claim_search', {
                        claim_ids: coverIds,
                        page_size: coverIds.length
                    }, function (cErr, cRes) {
                        var thumbMap;
                        var ci;
                        var item;
                        var pi;

                        if (!cErr && cRes && cRes.items) {
                            thumbMap = {};
                            for (ci = 0; ci < cRes.items.length; ci++) {
                                item = cRes.items[ci];
                                if (item && item.claim_id && item.value && item.value.thumbnail) {
                                    thumbMap[item.claim_id] = item.value.thumbnail.url;
                                }
                            }
                            for (pi = 0; pi < list.length; pi++) {
                                if (list[pi].coverClaimId && thumbMap[list[pi].coverClaimId]) {
                                    list[pi].thumbnailUrl = thumbMap[list[pi].coverClaimId];
                                }
                            }
                        }
                        callback(null, list);
                    });
                }

                if (shared) {
                    cachedSharedPreferences = shared;
                    builtIn = shared.builtInCollections || shared.builtinCollections || {};
                    foundWatchLater = false;
                    foundFavorites = false;

                    for (bk in builtIn) {
                        if (builtIn.hasOwnProperty(bk)) {
                            bCol = builtIn[bk];
                            if (bCol) {
                                bId = String(bCol.id || bk).toLowerCase();
                                bName = (bCol.name || bCol.title || '').toLowerCase();
                                bIds = extractClaimIdsFromCollection(bCol);

                                if (bId === 'watchlater' || bId === 'watch_later' || bName === 'watch later' || bName.indexOf('watch later') !== -1) {
                                    foundWatchLater = true;
                                    cachedRemoteWatchLaterIds = bIds;
                                    playlists.push({
                                        id: 'watchlater',
                                        name: 'Watch Later',
                                        type: 'builtin',
                                        badge: 'Default Playlist',
                                        itemCount: bIds.length,
                                        items: bIds,
                                        coverClaimId: bIds[0] || null,
                                        updatedAt: bCol.updatedAt || 0
                                    });
                                } else if (bId === 'favorites' || bId === 'favorite' || bName === 'favorites' || bName.indexOf('favorite') !== -1) {
                                    foundFavorites = true;
                                    playlists.push({
                                        id: 'favorites',
                                        name: 'Favorites',
                                        type: 'builtin',
                                        badge: 'Default Playlist',
                                        itemCount: bIds.length,
                                        items: bIds,
                                        coverClaimId: bIds[0] || null,
                                        updatedAt: bCol.updatedAt || 0
                                    });
                                } else {
                                    playlists.push({
                                        id: bCol.id || bk,
                                        name: bCol.name || bCol.title || 'Built-in Playlist',
                                        type: 'builtin',
                                        badge: 'Default Playlist',
                                        itemCount: bIds.length,
                                        items: bIds,
                                        coverClaimId: bIds[0] || null,
                                        updatedAt: bCol.updatedAt || 0
                                    });
                                }
                            }
                        }
                    }

                    if (!foundWatchLater && cachedRemoteWatchLaterIds && cachedRemoteWatchLaterIds.length > 0) {
                        playlists.unshift({
                            id: 'watchlater',
                            name: 'Watch Later',
                            type: 'builtin',
                            badge: 'Default Playlist',
                            itemCount: cachedRemoteWatchLaterIds.length,
                            items: cachedRemoteWatchLaterIds,
                            coverClaimId: cachedRemoteWatchLaterIds[0] || null,
                            updatedAt: 0
                        });
                    }

                    // 3. Unpublished (Private / Unlisted)
                    unpublished = shared.unpublishedCollections || shared.unpublished_collections || {};
                    for (unpId in unpublished) {
                        if (unpublished.hasOwnProperty(unpId)) {
                            unp = unpublished[unpId];
                            if (unp) {
                                unpIds = extractClaimIdsFromCollection(unp);
                                playlists.push({
                                    id: unp.id || unpId,
                                    name: unp.name || unp.title || 'Custom Playlist',
                                    type: 'unpublished',
                                    badge: 'Private',
                                    itemCount: unpIds.length,
                                    items: unpIds,
                                    coverClaimId: unpIds[0] || null,
                                    updatedAt: unp.updatedAt || 0
                                });
                            }
                        }
                    }
                }

                // 4. Also fetch any public channel collections
                channelIds = Auth.getChannelClaimIds() || [];
                u = Auth.getUser();
                if (u && u.channelClaimId && channelIds.indexOf(u.channelClaimId) === -1) {
                    channelIds.push(u.channelClaimId);
                }

                if (channelIds && channelIds.length > 0) {
                    LbryRpc.call('claim_search', {
                        claim_type: ['collection'],
                        channel_ids: channelIds,
                        page_size: 30
                    }, function (pubErr, pubRes) {
                        var pj;
                        var col;
                        var cIds;

                        if (!pubErr && pubRes && pubRes.items && pubRes.items.length > 0) {
                            for (pj = 0; pj < pubRes.items.length; pj++) {
                                col = pubRes.items[pj];
                                cIds = extractClaimIdsFromCollection(col);
                                playlists.push({
                                    id: col.claim_id,
                                    name: (col.value && col.value.title) || col.name || 'Channel Playlist',
                                    type: 'published',
                                    badge: 'Public',
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
        var p;
        var size;
        var ids;
        var slice;

        if (typeof callback !== 'function') {
            callback = function () { };
        }
        p = page || 1;
        size = 20;
        ids = [];
        if (!playlist) {
            return callback(null, {
                items: [],
                total_pages: 0
            });
        }

        if (Array.isArray(playlist.items)) {
            ids = playlist.items;
        } else if (playlist.claim) {
            ids = extractClaimIdsFromCollection(playlist.claim);
        }

        if (!ids.length) {
            return callback(null, {
                items: [],
                total_pages: 0
            });
        }

        slice = ids.slice((p - 1) * size, p * size);
        if (!slice.length) {
            return callback(null, {
                items: [],
                total_pages: 0
            });
        }

        LbryRpc.call('claim_search', {
            claim_ids: slice,
            page_size: size,
            has_no_source: false
        }, function (err, res) {
            var resolvedMap;
            var i;
            var orderedItems;
            var j;

            if (err) {
                return callback(err);
            }
            resolvedMap = {};
            if (res && res.items) {
                for (i = 0; i < res.items.length; i++) {
                    resolvedMap[res.items[i].claim_id] = res.items[i];
                }
            }
            orderedItems = [];
            for (j = 0; j < slice.length; j++) {
                if (resolvedMap[slice[j]]) {
                    orderedItems.push(resolvedMap[slice[j]]);
                }
            }
            ClaimFilter.filterPlayable(callback)(null, {
                items: orderedItems,
                total_pages: Math.ceil(ids.length / size),
                total_items: ids.length
            });
        });
    }

    Auth.onAuthStateChanged(function (isLoggedIn) {
        if (!isLoggedIn) {
            cachedRemoteWatchLaterIds = null;
            cachedSharedPreferences = null;
            cachedFollowedChannels = null;
        } else {
            cachedFollowedChannels = null;
            getFollowedChannels(function () { });
        }
    });

    // -----------------------------------------------------------------------
    // Followed Channels & Following Feed
    // -----------------------------------------------------------------------

    var cachedFollowedChannels = null;

    function getFollowedChannels(callback, forceRefresh) {
        var results;
        var seenIds;
        var cachedList;
        var ci;
        var cEntry;
        var cUri;
        var cId;
        var cNameMatch;
        var cName;

        if (cachedFollowedChannels && !forceRefresh) {
            return callback(null, cachedFollowedChannels);
        }

        results = [];
        seenIds = {};

        function addChannel(claimId, name) {
            if (!claimId || seenIds[claimId]) {
                return;
            }
            seenIds[claimId] = true;
            results.push({
                claim_id: claimId,
                channel_id: claimId,
                channel_name: name || ''
            });
        }

        // Pre-fill from cachedSharedPreferences if available
        if (cachedSharedPreferences) {
            cachedList = [];
            if (Array.isArray(cachedSharedPreferences.following)) {
                cachedList = cachedList.concat(cachedSharedPreferences.following);
            }
            if (Array.isArray(cachedSharedPreferences.subscriptions)) {
                cachedList = cachedList.concat(cachedSharedPreferences.subscriptions);
            }
            for (ci = 0; ci < cachedList.length; ci++) {
                cEntry = cachedList[ci];
                cUri = (typeof cEntry === 'string') ? cEntry : (cEntry && cEntry.uri ? cEntry.uri : '');
                cId = extractClaimIdFromItem(cEntry);
                cNameMatch = /@([^\/#:]+)/.exec(cUri);
                cName = cNameMatch ? ('@' + cNameMatch[1]) : (cEntry && (cEntry.channel_name || cEntry.name));
                if (cId) {
                    addChannel(cId, cName);
                }
            }
        }

        LbryNet.ensureAuthToken(function (token) {
            var doneCount = 0;
            var isFinished = false;
            var data;

            function finish() {
                doneCount += 1;
                if (!isFinished && doneCount >= 2) {
                    isFinished = true;
                    console.log('UserData: getFollowedChannels finished with ' + results.length + ' channel(s).');
                    cachedFollowedChannels = results;
                    callback(null, results);
                }
            }

            // Safety timeout: never hang more than 3.5s
            setTimeout(function () {
                if (!isFinished) {
                    isFinished = true;
                    console.log('UserData: getFollowedChannels safety timeout reached with ' + results.length + ' channel(s).');
                    cachedFollowedChannels = results;
                    callback(null, results);
                }
            }, 3500);

            // A) /subscription/list via internal API
            if (token || Auth.getAccessToken()) {
                data = {};
                if (token) {
                    data.auth_token = token;
                }
                LbryIo.call('/subscription/list', {
                    method: 'POST',
                    data: data,
                    useBearer: true
                }, function (err, resp) {
                    var i;
                    var item;
                    var cid;

                    if (!err && resp && resp.success && Array.isArray(resp.data)) {
                        for (i = 0; i < resp.data.length; i++) {
                            item = resp.data[i];
                            cid = item.claim_id || item.channel_id;
                            if (cid) {
                                addChannel(cid, item.channel_name || item.name);
                            }
                        }
                    }
                    finish();
                });
            } else {
                finish();
            }

            // B) shared preferences (preference_get key="shared")
            LbryRpc.call('preference_get', { key: 'shared' }, function (err, res) {
                var shared = parseSharedPreference(res) || cachedSharedPreferences;
                var list;
                var j;
                var entry;
                var uri;
                var cid;
                var nameMatch;
                var name;

                if (shared) {
                    cachedSharedPreferences = shared;
                    list = [];
                    if (Array.isArray(shared.following)) {
                        list = list.concat(shared.following);
                    }
                    if (Array.isArray(shared.subscriptions)) {
                        list = list.concat(shared.subscriptions);
                    }

                    for (j = 0; j < list.length; j++) {
                        entry = list[j];
                        uri = (typeof entry === 'string') ? entry : (entry && entry.uri ? entry.uri : '');
                        cid = extractClaimIdFromItem(entry);
                        nameMatch = /@([^\/#:]+)/.exec(uri);
                        name = nameMatch ? ('@' + nameMatch[1]) : (entry && (entry.channel_name || entry.name));
                        if (cid) {
                            addChannel(cid, name);
                        }
                    }
                }
                finish();
            });
        });
    }

    function getFollowingVideos(cb, page) {
        getFollowedChannels(function (err, channels) {
            var cids;
            var i;
            var cid;

            if (err) {
                return cb(err);
            }
            if (!channels || !channels.length) {
                return cb(null, {
                    items: [],
                    total_pages: 0
                });
            }
            cids = [];
            for (i = 0; i < channels.length && cids.length < 50; i++) {
                cid = channels[i].claim_id || channels[i].channel_id;
                if (cid && cids.indexOf(cid) === -1) {
                    cids.push(cid);
                }
            }
            if (!cids.length) {
                return cb(null, {
                    items: [],
                    total_pages: 0
                });
            }

            LbryRpc.call('claim_search', {
                channel_ids: cids,
                claim_type: ['stream'],
                stream_types: ['video'],
                page_size: 20,
                page: page || 1,
                has_no_source: false,
                fee_amount: '<=0',
                order_by: ['release_time'] // Newest first
            }, ClaimFilter.filterPlayable(cb));
        });
    }

    function followChannel(claimId, channelName, callback) {
        if (!claimId) {
            if (callback) {
                callback(new Error('claimId required'));
            }
            return;
        }
        if (channelName && channelName.charAt(0) !== '@') {
            channelName = '@' + channelName;
        }
        LbryNet.ensureAuthToken(function (token) {
            var data;

            if (!token && !Auth.getAccessToken()) {
                if (callback) {
                    callback(new Error('No auth token available'));
                }
                return;
            }
            data = {
                claim_id: claimId,
                channel_name: channelName || '',
                notifications_disabled: 'true'
            };
            if (token) {
                data.auth_token = token;
            }

            LbryIo.call('/subscription/new', {
                method: 'POST',
                data: data,
                useBearer: true
            }, function (err, resp) {
                var exists;
                var i;
                var cid;
                var uri;
                var alreadyInShared;
                var fi;
                var fItem;
                var errMsg;

                if (!err && resp && resp.success) {
                    if (cachedFollowedChannels) {
                        exists = false;
                        for (i = 0; i < cachedFollowedChannels.length; i++) {
                            cid = cachedFollowedChannels[i].claim_id || cachedFollowedChannels[i].channel_id;
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
                        uri = 'lbry://' + (channelName || '@channel') + '#' + claimId;
                        alreadyInShared = false;
                        for (fi = 0; fi < cachedSharedPreferences.following.length; fi++) {
                            fItem = cachedSharedPreferences.following[fi];
                            if ((typeof fItem === 'string' && fItem.indexOf(claimId) !== -1) ||
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
                            LbryRpc.call('preference_set', {
                                key: 'shared',
                                value: cachedSharedPreferences
                            }, function () { });
                        }
                    }

                    if (callback) {
                        callback(null, resp.data);
                    }
                } else {
                    errMsg = (resp && resp.error) ? resp.error : 'Follow failed';
                    if (callback) {
                        callback(err || new Error(errMsg));
                    }
                }
            });
        });
    }

    function unfollowChannel(claimId, channelName, callback) {
        if (!claimId) {
            if (callback) {
                callback(new Error('claimId required'));
            }
            return;
        }
        LbryNet.ensureAuthToken(function (token) {
            var data;

            if (!token && !Auth.getAccessToken()) {
                if (callback) {
                    callback(new Error('No auth token available'));
                }
                return;
            }
            data = {
                claim_id: claimId
            };
            if (token) {
                data.auth_token = token;
            }

            LbryIo.call('/subscription/delete', {
                method: 'POST',
                data: data,
                useBearer: true
            }, function (err, resp) {
                var errMsg;

                if (!err && resp && resp.success) {
                    if (cachedFollowedChannels) {
                        cachedFollowedChannels = cachedFollowedChannels.filter(function (ch) {
                            return (ch.claim_id || ch.channel_id) !== claimId;
                        });
                    }

                    // Sync to shared.following preference
                    if (cachedSharedPreferences && Array.isArray(cachedSharedPreferences.following)) {
                        cachedSharedPreferences.following = cachedSharedPreferences.following.filter(function (fItem) {
                            if (typeof fItem === 'string') {
                                return fItem.indexOf(claimId) === -1;
                            }
                            if (fItem && fItem.uri) {
                                return fItem.uri.indexOf(claimId) === -1;
                            }
                            return true;
                        });
                        LbryRpc.call('preference_set', {
                            key: 'shared',
                            value: cachedSharedPreferences
                        }, function () { });
                    }

                    if (callback) {
                        callback(null, resp.data);
                    }
                } else {
                    errMsg = (resp && resp.error) ? resp.error : 'Unfollow failed';
                    if (callback) {
                        callback(err || new Error(errMsg));
                    }
                }
            });
        });
    }

    function isFollowingChannel(claimId, callback) {
        getFollowedChannels(function (err, channels) {
            var i;
            var cid;

            if (err || !channels) {
                return callback(false);
            }
            for (i = 0; i < channels.length; i++) {
                cid = channels[i].claim_id || channels[i].channel_id;
                if (cid === claimId) {
                    return callback(true);
                }
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
        getWatchLaterVideos: getWatchLaterVideos,
        getUserPlaylists: getUserPlaylists,
        getPlaylistVideos: getPlaylistVideos,
        getFollowedChannels: getFollowedChannels,
        getFollowingVideos: getFollowingVideos,
        followChannel: followChannel,
        unfollowChannel: unfollowChannel,
        isFollowingChannel: isFollowingChannel
    };
}());
