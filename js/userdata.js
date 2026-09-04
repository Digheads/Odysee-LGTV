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
                if (!err && resp && resp.data) {
                    var my = (resp.data.my_reactions) ? resp.data.my_reactions[claimId] : null;
                    callback(null, my);
                } else {
                    callback(err || new Error("Reaction list failed"));
                }
            });
        });
    }

    function react(claimId, type, clearType, callback) {
        LbryNet.ensureAuthToken(function (token) {
            var data = {
                claim_ids: claimId,
                type: type
            };
            if (clearType) data.clear_types = clearType;
            if (token) data.auth_token = token;

            LbryIo.call("/reaction/react", { data: data }, function (err, resp) {
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
    // Watch Later (Local Storage + Search Query)
    // -----------------------------------------------------------------------

    function getWatchLaterIds() {
        try {
            var raw = localStorage.getItem("odysee_watch_later");
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function saveWatchLater(claimId, add) {
        try {
            var list = getWatchLaterIds();
            var idx = list.indexOf(claimId);
            if (add && idx === -1) {
                list.unshift(claimId);
            } else if (!add && idx > -1) {
                list.splice(idx, 1);
            }
            localStorage.setItem("odysee_watch_later", JSON.stringify(list));
        } catch (e) { }
    }

    function isWatchLater(claimId) {
        var list = getWatchLaterIds();
        return list.indexOf(claimId) > -1;
    }

    function getWatchLaterVideos(cb, page) {
        var list = getWatchLaterIds();
        if (!list || !list.length) {
            return cb(null, { items: [], total_pages: 0 });
        }
        var p = page || 1;
        var size = 20;
        var slice = list.slice((p - 1) * size, p * size);
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
