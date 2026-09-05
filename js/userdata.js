// ---------------------------------------------------------------------------
// User Data, Social & State Manager for Odysee LGTV (ES5 compatible for webOS 2.0+)
// Manages reactions, view counts, resume points, watch later, and following feeds.
// ---------------------------------------------------------------------------

var UserData = (function () {

    // -----------------------------------------------------------------------
    // Reactions (Like / Dislike)
    // -----------------------------------------------------------------------

    function getReactions(claimId, callback) {
        LbryNet.ensureAuthToken(function (token) {
            var data = { claim_ids: claimId };
            if (token) data.auth_token = token;

            LbryIo.call("/reaction/list", { data: data }, function (err, resp) {
                if (!err && resp && resp.data && resp.data.others_reactions && resp.data.others_reactions[claimId]) {
                    callback(null, resp.data.others_reactions[claimId]);
                } else if (!err) {
                    callback(null, { like: 0, dislike: 0 });
                } else {
                    callback(err || new Error("Reaction API failed"));
                }
            });
        });
    }

    function getMyReaction(claimId, callback) {
        LbryNet.ensureAuthToken(function (token) {
            var data = { claim_ids: claimId };
            if (token) data.auth_token = token;

            LbryIo.call("/reaction/list", { data: data }, function (err, resp) {
                if (!err && resp && resp.data && resp.data.my_reactions) {
                    var my = resp.data.my_reactions[claimId];
                    if (my) {
                        if (my.like > 0) return callback(null, "like");
                        if (my.dislike > 0) return callback(null, "dislike");
                    }
                    callback(null, null);
                } else {
                    callback(err || new Error("Reaction list failed"));
                }
            });
        });
    }

    function react(claimId, type, remove, callback) {
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
    // Watch Later (Remote Collection Claim + Local Storage Cache)
    // -----------------------------------------------------------------------

    var cachedRemoteWatchLaterIds = null;

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

    function isWatchLaterCollection(c) {
        if (!c) return false;
        var name = (c.name || "").toLowerCase();
        var title = (c.value && c.value.title ? c.value.title : "").toLowerCase();
        if (name === "watchlater" || name === "watch-later" || name === "watch_later") return true;
        if (title === "watch later" || title === "watchlater") return true;
        if (/watch\s*later/i.test(title)) return true;
        var tags = (c.value && c.value.tags) || [];
        for (var i = 0; i < tags.length; i++) {
            var t = String(tags[i]).toLowerCase();
            if (t === "watchlater" || t === "watch-later" || t === "watch_later") return true;
        }
        return false;
    }

    function fetchRemoteWatchLater(callback) {
        if (!window.Auth || !Auth.isLoggedIn()) {
            return callback(null, getWatchLaterIds());
        }

        var channelIds = [];
        if (typeof Auth.getChannelClaimIds === "function") {
            channelIds = Auth.getChannelClaimIds();
        }
        var user = Auth.getUser();
        if (user && user.channelClaimId && channelIds.indexOf(user.channelClaimId) === -1) {
            channelIds.push(user.channelClaimId);
        }

        function handleCollectionList(items) {
            if (!items || !items.length) return null;
            for (var i = 0; i < items.length; i++) {
                var col = items[i];
                console.log("UserData: Collection #" + i + " name=" + col.name + " title=" + (col.value && col.value.title));
                if (isWatchLaterCollection(col)) {
                    return col;
                }
            }
            if (items.length === 1) {
                return items[0];
            }
            return null;
        }

        function queryCollections(cids) {
            var searchParams = {
                claim_type: ["collection"],
                page_size: 50
            };
            if (cids && cids.length > 0) {
                searchParams.channel_ids = cids;
            }

            console.log("UserData: Searching for collection claims. Channel IDs:", JSON.stringify(cids));
            LbryRpc.call("claim_search", searchParams, function (err, res) {
                var foundCol = null;
                if (!err && res && res.items && res.items.length > 0) {
                    console.log("UserData: Found " + res.items.length + " collection claims.");
                    foundCol = handleCollectionList(res.items);
                }

                if (foundCol) {
                    var ids = extractClaimIdsFromCollection(foundCol);
                    console.log("UserData: Watch Later collection resolved. Found " + ids.length + " video claim IDs.");
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

                // Fallback 1: collection_list RPC
                LbryRpc.call("collection_list", { page_size: 50 }, function (colListErr, colListRes) {
                    var listItems = (!colListErr && colListRes && (colListRes.items || colListRes)) || [];
                    if (Array.isArray(listItems) && listItems.length > 0) {
                        var cMatch = handleCollectionList(listItems);
                        if (cMatch) {
                            var cIds = extractClaimIdsFromCollection(cMatch);
                            if (cIds.length > 0) {
                                cachedRemoteWatchLaterIds = cIds;
                                try {
                                    localStorage.setItem("odysee_watch_later", JSON.stringify(cIds));
                                } catch (e) { }
                                return callback(null, cIds);
                            }
                        }
                    }

                    // Fallback 2: search by name="watchlater" without channel_ids
                    LbryRpc.call("claim_search", { claim_type: ["collection"], name: "watchlater", page_size: 20 }, function (wlErr, wlRes) {
                        if (!wlErr && wlRes && wlRes.items && wlRes.items.length > 0) {
                            var wlCol = handleCollectionList(wlRes.items);
                            if (wlCol) {
                                var wlIds = extractClaimIdsFromCollection(wlCol);
                                if (wlIds.length > 0) {
                                    cachedRemoteWatchLaterIds = wlIds;
                                    try {
                                        localStorage.setItem("odysee_watch_later", JSON.stringify(wlIds));
                                    } catch (e) { }
                                    return callback(null, wlIds);
                                }
                            }
                        }
                        callback(null, getWatchLaterIds());
                    });
                });
            });
        }

        if (channelIds && channelIds.length > 0) {
            queryCollections(channelIds);
        } else {
            LbryRpc.call("channel_list", { page_size: 20 }, function (err, result) {
                var cids = [];
                if (!err && result && result.items) {
                    for (var i = 0; i < result.items.length; i++) {
                        if (result.items[i].claim_id) cids.push(result.items[i].claim_id);
                    }
                }
                queryCollections(cids);
            });
        }
    }

    function getWatchLaterVideos(cb, page) {
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
                has_no_source: false,
                order_by: ["release_time"] // Newest first
            }, ClaimFilter.filterPlayable(cb));
        }

        if (p === 1 || !cachedRemoteWatchLaterIds) {
            fetchRemoteWatchLater(function (err, ids) {
                loadSlice(ids);
            });
        } else {
            loadSlice(cachedRemoteWatchLaterIds);
        }
    }

    if (window.Auth && typeof Auth.onAuthStateChanged === "function") {
        Auth.onAuthStateChanged(function (isLoggedIn) {
            if (!isLoggedIn) {
                cachedRemoteWatchLaterIds = null;
            }
        });
    }

    // -----------------------------------------------------------------------
    // Subscriptions & Following Feed
    // -----------------------------------------------------------------------

    function getSubscribedChannels(callback) {
        LbryNet.ensureAuthToken(function () {
            LbryIo.call("/subscription/list", { method: "GET" }, function (err, resp) {
                if (!err && resp) {
                    var items = resp.data || [];
                    callback(null, items);
                } else {
                    callback(err || new Error("Subscription list failed"));
                }
            });
        });
    }

    function getFollowingVideos(cb, page) {
        getSubscribedChannels(function (err, channels) {
            if (err) return cb(err);
            if (!channels || !channels.length) {
                return cb(null, { items: [], total_pages: 0 });
            }
            var cids = [];
            for (var i = 0; i < channels.length && cids.length < 50; i++) {
                if (channels[i].claim_id) cids.push(channels[i].claim_id);
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

    return {
        getReactions: getReactions,
        getMyReaction: getMyReaction,
        react: react,
        getViewCount: getViewCount,
        saveViewProgress: saveViewProgress,
        getResumePoint: getResumePoint,
        saveResumePoint: saveResumePoint,
        getWatchLaterIds: getWatchLaterIds,
        saveWatchLater: saveWatchLater,
        isWatchLater: isWatchLater,
        getWatchLaterVideos: getWatchLaterVideos,
        getSubscribedChannels: getSubscribedChannels,
        getFollowingVideos: getFollowingVideos
    };
})();
