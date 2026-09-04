var OdyseeAPI = function () {
    // The homepage response (sections + channel lists) doesn't change per page,
    // so we request it once and cache it.
    var homepageData = null;

    function fetchHomepage(cb) {
        if (homepageData) return cb(null, homepageData);
        var r = new XMLHttpRequest();
        r.open("GET", "https://odysee.com/$/api/content/v1/get?language=en", true);
        r.timeout = 20000;
        r.onreadystatechange = function () {
            if (4 !== r.readyState) return;
            if (200 === r.status) {
                try {
                    homepageData = JSON.parse(r.responseText).data.en;
                    return cb(null, homepageData)
                } catch (err) {
                    return cb(err)
                }
            }
            cb(new Error("Homepage API failed: " + r.status))
        };
        r.ontimeout = r.onerror = function () {
            cb(new Error("Homepage API unavailable"))
        };
        r.send()
    }

    // MEASUREMENT (2026-08-26): the warmup HEAD returned 200 for the v4 endpoint, but the <video>
    // still failed with MEDIA_ERR_SRC_NOT_SUPPORTED on the same URL. The v4 format
    // has no extension at the end (.../{claim_id}/{sd6}), and the webOS 2.0 media
    // pipeline doesn't accept it, even if the Content-Type is video/mp4.
    //
    // Therefore the primary format is /v6/ .mp4 -- and we don't lose anything by it:
    // the fitForTranscoder runs on v6 for HEAD as well, so the warmup still
    // gets the 308 if there is a ready HLS transcode.
    //
    // Setting this to true reverts to the v4 format (without extension).
    var USE_V4_HLS = false;

    // The `magic` parameter is only valid if it is less than 5 minutes old according to the server
    // (time.Since(ts) < 5*time.Minute). The timestamp is provided by the TV's clock,
    // and a TV clock can easily drift -- then we get a 401. The response of
    // api.odysee.com/user/new contains a server-side timestamp (created_at),
    // from which we calculate the offset. The Date header is not a viable path:
    // it's not on the CORS safelist and expose-headers doesn't include it either.
    var serverTimeOffsetMs = 0,
        serverTimeSynced = false;

    // ISO-8601 parsing on old WebKit is unreliable -> we parse it manually.
    // The player-server's VerifyAccess() gives a 401 for these tags
    // (ErrEdgeCredentialsMissing), because it expects an Authorization: Token <edgeToken> header
    // -- but that is a server-side secret, a client can never provide it.
    // Therefore it's NOT worth trying for these: the problem is not magic/hotlink.
    function protectedReason(claim) {
        var tags = (claim.value && claim.value.tags) ? claim.value.tags : [],
            fixed = {
                "c:members-only": "Members-only content.",
                "c:rental": "Rental content.",
                "c:purchase": "Purchasable content.",
                "c:unlisted": "Unlisted content."
            },
            releaseTime = (claim.value && claim.value.release_time) ? +claim.value.release_time : 0,
            nowSec = Math.floor((new Date().getTime() + serverTimeOffsetMs) / 1000);
        for (var i = 0; i < tags.length; i++) {
            var t = tags[i];
            if (fixed[t]) return fixed[t];
            if (0 === t.indexOf("purchase:")) return "Purchasable content.";
            if (0 === t.indexOf("rental:")) return "Rental content.";
            if (("c:scheduled:show" === t || "c:scheduled:hide" === t) && releaseTime > nowSec)
                return "Scheduled content, not yet released.";
        }
        return null;
    }

    // Claims protected by VerifyAccess can NEVER be played from a client
    // (401 + "edge credentials missing"), so we don't even put them on the grid.
    // We preserve raw_count, otherwise pagination would stop early: the app infers
    // whether there is another page from the number of returned items.
    function filterPlayable(cb) {
        return function (err, res) {
            if (err || !res || !res.items) return cb(err, res);
            var before = res.items.length,
                out = [];
            for (var i = 0; i < before; i++) {
                var it = res.items[i];
                if (!protectedReason(it.reposted_claim || it)) out.push(it)
            }
            res.raw_count = before;
            res.items = out;
            if (before !== out.length)
                console.log("Filtered out " + (before - out.length) + "/" + before + " protected claim(s)");
            return cb(err, res)
        }
    }

    function parseIsoUtc(str) {
        var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(str || "");
        if (!m) return NaN;
        return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }

    // The response time of claim_search fluctuates strongly (I measured 1s and over 18s
    // timeout for the exact same query), so in case of network error/timeout we
    // retry. We do NOT retry on API errors (JSON-RPC error), those are deterministic.
    function rpc(e, t, r, attempt) {
        attempt = attempt || 0;
        var maxAttempts = 3;

        function retryOrFail(err) {
            if (attempt + 1 < maxAttempts) {
                var wait = 2000 * (attempt + 1);
                console.log("API retry " + (attempt + 1) + "/" + (maxAttempts - 1) +
                    " (in " + wait / 1000 + "s): " + e);
                return void setTimeout(function () {
                    rpc(e, t, r, attempt + 1)
                }, wait)
            }
            r(err)
        }
        var n = "https://api.na-backend.odysee.com/api/v1/proxy";
        "get" === e && (n += "?m=get");
        console.log("OdyseeAPI: [" + e + "] Request. Params: " + JSON.stringify(t));
        var s = new XMLHttpRequest;
        s.open("POST", n, !0), s.setRequestHeader("Content-Type", "application/json-rpc"), s.timeout = 2e4, s.ontimeout = function () {
            retryOrFail(new Error("Timeout: cannot reach " + n))
        }, s.onreadystatechange = function () {
            if (4 === s.readyState)
                if (200 === s.status) try {
                    var e = JSON.parse(s.responseText);
                    e.error ? r(new Error(e.error.message || "API Error")) : r(null, e.result)
                } catch (e) {
                    console.error("OdyseeAPI: JSON parse error. Proxy returned HTML instead of JSON? Response:", s.responseText.substring(0, 100)), r(new Error("Invalid JSON from proxy"))
                } else retryOrFail(new Error("Network error: " + s.status))
        }, s.send(JSON.stringify({
            method: e,
            params: t,
            jsonrpc: "2.0",
            id: Math.round(1e6 * Math.random())
        }))
    }
    var e = rpc;

    return {
        // Runs once at startup. As a side effect it also stores the auth token,
        // so getViewCount won't initiate another user/new call.
        syncServerTime: function (cb) {
            if (serverTimeSynced) return cb && cb();
            var xhr = new XMLHttpRequest();
            xhr.open("POST", "https://api.odysee.com/user/new", true);
            xhr.timeout = 15000;
            xhr.onreadystatechange = function () {
                if (4 !== xhr.readyState) return;
                if (200 === xhr.status) {
                    try {
                        var d = JSON.parse(xhr.responseText).data || {},
                            srv = parseIsoUtc(d.created_at);
                        if (!isNaN(srv)) {
                            serverTimeOffsetMs = srv - new Date().getTime();
                            serverTimeSynced = true;
                            console.log("Time sync: offset " +
                                Math.round(serverTimeOffsetMs / 1000) + "s (TV clock " +
                                (serverTimeOffsetMs > 0 ? "slow" : "fast") + ")");
                        }
                        if (d.auth_token) window.odyseeAuthToken = d.auth_token;
                    } catch (err) {
                        console.error("Time sync parse error: " + err.message)
                    }
                } else console.error("Time sync failed: " + xhr.status);
                cb && cb()
            };
            xhr.ontimeout = xhr.onerror = function () {
                console.error("Time sync unavailable, using TV clock");
                cb && cb()
            };
            xhr.send()
        },

        // The URL of the transcoded HLS master playlist, built from the claim data.
        // This way we don't have to follow the 308 redirect, which a 2015 media
        // pipeline might not handle (308 is newer than 301/302/303/307).
        // The format is provided by the v4 branch of player-server's getPlaylistURL():
        //   /api/v4/streams/tc/{claim_name}/{claim_id}/{FULL_sd_hash}/master.m3u8
        // Note: the full 96-character sd_hash is required here, not the 6-character prefix.
        buildHlsUrl: function (claim) {
            var c = claim.reposted_claim || claim,
                sd = c.value && c.value.source ? c.value.source.sd_hash : "";
            if (!(c.name && c.claim_id && sd)) return null;
            return "http://player.odycdn.com/api/v4/streams/tc/" +
                encodeURIComponent(c.name) + "/" + c.claim_id + "/" + sd + "/master.m3u8";
        },

        // The most compatible mp4 format: /v6/ endpoint, with .mp4 extension.
        // This never redirects to HLS (fitForTranscoder only runs for HEAD on v6),
        // and because of the extension, the old media pipeline recognizes the type.
        buildMp4Url: function (claim) {
            var c = claim.reposted_claim || claim,
                sd = c.value && c.value.source ? c.value.source.sd_hash : "";
            if (!(c.claim_id && sd)) return null;
            return "http://player.odycdn.com/v6/streams/" + c.claim_id + "/" + sd.substring(0, 6) + ".mp4";
        },

        // UNIX seconds adjusted to the server for the `magic` parameter.
        getServerNowSec: function () {
            return Math.floor((new Date().getTime() + serverTimeOffsetMs) / 1000)
        },

        // Homepage sections (Featured, Gaming, Tech, Comedy, ...). They come from the same
        // response that the category request uses -> no extra request needed.
        getSections: function (cb) {
            fetchHomepage(function (err, data) {
                if (err) return cb(err);
                var out = [];
                for (var k in data) {
                    if (!data.hasOwnProperty(k)) continue;
                    var sec = data[k];
                    if (!sec || "object" != typeof sec) continue;
                    if (k === "EXPLORABLE_CHANNEL" || k === "PRIMARY_CONTENT") continue;
                    var ids = sec.channelIds || [];
                    if (!ids.length) continue;
                    out.push({
                        key: k,
                        label: sec.label || sec.name || k,
                        channelLimit: sec.channelLimit || 3,
                        sortOrder: "number" == typeof sec.sortOrder ? sec.sortOrder : 999
                    })
                }
                out.sort(function (x, y) {
                    return x.sortOrder - y.sortOrder
                });
                console.log("OdyseeAPI: " + out.length + " category(ies)");
                cb(null, out)
            })
        },

        getCategory: function (key, t, page) {
            fetchHomepage(function (err, data) {
                if (err) return t(err);
                var sec = data[key];
                if (!sec || !(sec.channelIds || []).length) return t(new Error("Unknown category: " + key));
                e("claim_search", {
                    channel_ids: (sec.channelIds || []).slice(0, 50),
                    claim_type: ["stream"],
                    stream_types: ["video"],
                    page_size: 20,
                    page: page || 1,
                    has_no_source: false,
                    fee_amount: "<=0",
                    duration: ">=60",
                    not_tags: ["c:members-only", "c:unlisted", "c:rental", "c:purchase", "c:scheduled:show", "c:scheduled:hide"],
                    limit_claims_per_channel: parseInt(sec.channelLimit || 3, 10),
                    order_by: ["trending_group", "trending_mixed"]
                }, filterPlayable(t))
            })
        },

        getTrending: function (t, page) {
            e("claim_search", {
                claim_type: ["stream"],
                stream_types: ["video"],
                page_size: 20,
                page: page || 1,
                has_no_source: false,
                fee_amount: "<=0",
                duration: ">=60",
                not_tags: ["c:members-only", "c:unlisted", "c:rental", "c:purchase", "c:scheduled:show", "c:scheduled:hide"],
                order_by: ["trending_group", "trending_mixed"]
            }, filterPlayable(t))
        },
        search: function (t, r, page) {
            var p = page || 1;
            console.log("OdyseeAPI: Searching lighthouse for: " + t);
            var n = new XMLHttpRequest,
                s = "https://lighthouse.odysee.tv/search?s=" + encodeURIComponent(t) + "&size=20&from=" + ((p - 1) * 20) + "&claimType=file&mediaType=video&free_only=true";
            n.open("GET", s, !0), n.onreadystatechange = function () {
                if (4 === n.readyState)
                    if (200 === n.status) try {
                        var t = JSON.parse(n.responseText);
                        if (t && t.length > 0) {
                            for (var s = [], o = 0; o < t.length; o++) s.push(t[o].claimId);
                            console.log("OdyseeAPI: Found " + s.length + " search results. Fetching metadata..."), e("claim_search", {
                                claim_ids: s,
                                page_size: 20,
                                has_no_source: false,
                                fee_amount: "<=0",
                                duration: ">=60",
                                not_tags: ["c:members-only", "c:unlisted", "c:rental", "c:purchase", "c:scheduled:show", "c:scheduled:hide"]
                            }, filterPlayable(function (e, t) {
                                if (e) return r(e);
                                if (t && t.items) {
                                    for (var n = {}, o = 0; o < t.items.length; o++) n[t.items[o].claim_id] = t.items[o];
                                    for (var a = [], i = 0; i < s.length; i++) n[s[i]] && a.push(n[s[i]]);
                                    t.items = a
                                }
                                r(null, t)
                            }))
                        } else r(null, {
                            items: []
                        })
                    } catch (e) {
                        r(e)
                    } else r(new Error("Search failed: " + n.status))
            }, n.send()
        },
        getStreamingSourceUrl: function (t, r) {
            // For reposts, the actual stream is in reposted_claim.
            var claim = t.reposted_claim || t,
                name = claim.name,
                cid = claim.claim_id,
                sd = claim.value && claim.value.source ? claim.value.source.sd_hash : "";

            var blocked = protectedReason(claim);
            if (blocked) return r(new Error(blocked + " The player cannot decode this."));

            // The /api/v4/ endpoint decides itself what to serve: if there is a ready HLS
            // transcode, it redirects with 308 to master.m3u8 (libx264 + AAC + .ts
            // segments = HLS v3, which webOS 2.0 handles natively); if not, it
            // returns the original mp4. The `fitForTranscoder` runs for the /api/v4/ prefix
            // always, not just for HEAD -- so a single URL is enough.
            // Bonus: we save the roundtrip of the `get` RPC.
            if (name && cid && sd) {
                var u = USE_V4_HLS ?
                    "http://player.odycdn.com/api/v4/streams/free/" +
                    encodeURIComponent(name) + "/" + cid + "/" + sd.substring(0, 6) :
                    "http://player.odycdn.com/v6/streams/" + cid + "/" + sd.substring(0, 6) + ".mp4";
                console.log("OdyseeAPI: stream URL (" + (USE_V4_HLS ? "v4" : "v6") + "): " + u);
                return r(null, u)
            }

            // No sd_hash (e.g., livestream, or incomplete claim) -> fallback to `get` RPC.
            // permanent_url is the most reliable; my measurements show that short_url
            // gives "couldn't find claim" in ~8% of cases.
            console.log("OdyseeAPI: no sd_hash, fallback to get RPC");
            var uris = [];
            if (claim.permanent_url) uris.push(claim.permanent_url);
            if (claim.canonical_url && -1 === uris.indexOf(claim.canonical_url)) uris.push(claim.canonical_url);
            if (claim.short_url && -1 === uris.indexOf(claim.short_url)) uris.push(claim.short_url);
            if (!uris.length) return r(new Error("No resolvable URI on claim"));

            var idx = 0;

            function attempt() {
                e("get", {
                    uri: uris[idx]
                }, (function (err, res) {
                    if (!err && res && res.streaming_url) {
                        var n = res.streaming_url.replace(/^https:/i, "http:");
                        console.log("OdyseeAPI: Stream URL resolved: " + n);
                        return r(null, n)
                    }
                    idx++;
                    if (idx < uris.length) {
                        console.log("OdyseeAPI: get failed, next URI form -> " + uris[idx]);
                        return attempt()
                    }
                    r(err || new Error("No streaming_url returned"))
                }))
            }
            attempt()
        },
        ensureAuthToken: function(cb) {
            if (window.odyseeAuthToken) {
                cb(window.odyseeAuthToken);
            } else {
                var xhr = new XMLHttpRequest();
                xhr.open("POST", "https://api.odysee.com/user/new", true);
                xhr.onreadystatechange = function () {
                    if (xhr.readyState === 4) {
                        if (xhr.status === 200) {
                            try {
                                var resp = JSON.parse(xhr.responseText);
                                if (resp && resp.data && resp.data.auth_token) {
                                    window.odyseeAuthToken = resp.data.auth_token;
                                    cb(window.odyseeAuthToken);
                                } else { cb(null); }
                            } catch (e) { cb(null); }
                        } else { cb(null); }
                    }
                };
                xhr.send();
            }
        },
        getReactions: function (claimId, callback) {
            var xhr = new XMLHttpRequest();
            xhr.open("POST", "https://api.odysee.com/reaction/list", true);
            xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        try {
                            var resp = JSON.parse(xhr.responseText);
                            if (resp && resp.data && resp.data.others_reactions && resp.data.others_reactions[claimId]) {
                                callback(null, resp.data.others_reactions[claimId]);
                            } else {
                                callback(null, { like: 0, dislike: 0 });
                            }
                        } catch (e) {
                            callback(e);
                        }
                    } else {
                        callback(new Error("Reaction API failed"));
                    }
                }
            };
            this.ensureAuthToken(function(token) {
                if (token) {
                    xhr.send("auth_token=" + token + "&claim_ids=" + claimId);
                } else {
                    xhr.send("claim_ids=" + claimId);
                }
            });
        },
        getViewCount: function (claimId, callback) {
            this.ensureAuthToken(function(token) {
                if (!token) return callback(new Error("No auth token"));
                var xhr = new XMLHttpRequest();
                xhr.open("POST", "https://api.odysee.com/file/view_count", true);
                xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
                xhr.onreadystatechange = function () {
                    if (xhr.readyState === 4) {
                        if (xhr.status === 200) {
                            try {
                                var resp = JSON.parse(xhr.responseText);
                                if (resp && resp.data && resp.data.length > 0) {
                                    callback(null, resp.data[0]);
                                } else {
                                    callback(null, 0);
                                }
                            } catch (e) { callback(e); }
                        } else { callback(new Error("View count API failed")); }
                    }
                };
                xhr.send("auth_token=" + token + "&claim_id=" + claimId);
            });
        },
        saveViewProgress: function (claimId, uri, time) {
            this.ensureAuthToken(function(token) {
                if (!token) return; // Only log for logged in users
                var xhr = new XMLHttpRequest();
                xhr.open("POST", "https://api.odysee.com/file/view", true);
                xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
                xhr.send("auth_token=" + token + "&claim_id=" + encodeURIComponent(claimId) + "&uri=" + encodeURIComponent(uri) + "&last_timestamp=" + Math.floor(time));
            });
        },
        reportWatchmanPlayback: function(url, duration, position, rel_position, rebuf_count, rebuf_duration) {
            var payload = {
                url: url,
                device: "stb",
                duration: Math.floor(duration || 0),
                protocol: url.indexOf(".m3u8") > -1 ? "hls" : "mp4",
                player: "lgtv",
                user_id: "",
                position: Math.floor(position || 0),
                rel_position: Math.floor(rel_position || 0),
                rebuf_count: rebuf_count || 0,
                rebuf_duration: rebuf_duration || 0
            };
            this.ensureAuthToken(function(token) {
                var xhr = new XMLHttpRequest();
                xhr.open("POST", "https://watchman.na-backend.odysee.com/reports/playback", true);
                xhr.setRequestHeader("Content-Type", "application/json");
                xhr.send(JSON.stringify(payload));
            });
        },
        searchChannelVideos: function (channelClaimId, cb, page) {
            if (!page) page = 1;
            var params = {
                channel_ids: [channelClaimId],
                claim_type: ["stream"],
                stream_types: ["video"],
                page_size: 20,
                page: page,
                has_no_source: false,
                fee_amount: "<=0",
                order_by: ["release_time"]
            };
            e("claim_search", params, filterPlayable(cb));
        },
        getSubscriberCount: function (channelClaimId, cb) {
            this.ensureAuthToken(function(token) {
                var xhr = new XMLHttpRequest();
                xhr.open("POST", "https://api.odysee.com/subscription/sub_count", true);
                xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
                xhr.onreadystatechange = function () {
                    if (xhr.readyState === 4) {
                        if (xhr.status === 200) {
                            try {
                                var resp = JSON.parse(xhr.responseText);
                                if (resp && resp.data && resp.data.length > 0) {
                                    cb(null, resp.data[0]);
                                } else {
                                    cb(null, 0);
                                }
                            } catch (e) { cb(e); }
                        } else { cb(new Error("Subscriber count API failed")); }
                    }
                };
                if (token) {
                    xhr.send("auth_token=" + token + "&claim_id=" + channelClaimId);
                } else {
                    xhr.send("claim_id=" + channelClaimId);
                }
            });
        }
    }
}();