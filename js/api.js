var OdyseeAPI = function () {
    function e(e, t, r) {
        var n = "https://api.na-backend.odysee.com/api/v1/proxy";
        "get" === e && (n += "?m=get"), console.log("OdyseeAPI: Starting request to " + n);
        var s = new XMLHttpRequest;
        s.open("POST", n, !0), s.setRequestHeader("Content-Type", "application/json-rpc"), s.timeout = 5e3, s.ontimeout = function () {
            r(new Error("Timeout: Nem érem el a " + n + " címet az emulátorból!"))
        }, s.onreadystatechange = function () {
            if (4 === s.readyState)
                if (200 === s.status) try {
                    var e = JSON.parse(s.responseText);
                    e.error ? r(new Error(e.error.message || "API Error")) : r(null, e.result)
                } catch (e) {
                    console.error("OdyseeAPI: JSON parse error. Proxy returned HTML instead of JSON? Response:", s.responseText.substring(0, 100)), r(new Error("Invalid JSON from proxy"))
                } else r(new Error("Network error: " + s.status))
        }, s.send(JSON.stringify({
            method: e,
            params: t,
            jsonrpc: "2.0",
            id: Math.round(1e6 * Math.random())
        }))
    }
    return {
        getHome: function (t, page) {
            console.log("OdyseeAPI: Fetching Home categories...");
            var r = new XMLHttpRequest;
            r.open("GET", "https://odysee.com/$/api/content/v1/get?language=en", !0), r.onreadystatechange = function () {
                if (4 === r.readyState)
                    if (200 === r.status) try {
                        var n = JSON.parse(r.responseText).data.en.PRIMARY_CONTENT.channelIds;
                        console.log("OdyseeAPI: Found " + n.length + " Home channels."), e("claim_search", {
                            channel_ids: n,
                            claim_type: ["stream"],
                            stream_types: ["video"],
                            page_size: 20,
                            page: page || 1,
                            order_by: ["trending_group", "trending_mixed"]
                        }, t)
                    } catch (e) {
                        t(e)
                    } else t(new Error("Home API failed: " + r.status))
            }, r.send()
        },
        getTrending: function (t, page) {
            e("claim_search", {
                claim_type: ["stream"],
                stream_types: ["video"],
                page_size: 20,
                page: page || 1,
                order_by: ["trending_group", "trending_mixed"]
            }, t)
        },
        search: function (t, r, page) {
            var p = page || 1;
            console.log("OdyseeAPI: Searching lighthouse for: " + t);
            var n = new XMLHttpRequest,
                s = "https://lighthouse.odysee.tv/search?s=" + encodeURIComponent(t) + "&size=20&from=" + ((p - 1) * 20) + "&claimType=file&mediaType=video";
            n.open("GET", s, !0), n.onreadystatechange = function () {
                if (4 === n.readyState)
                    if (200 === n.status) try {
                        var t = JSON.parse(n.responseText);
                        if (t && t.length > 0) {
                            for (var s = [], o = 0; o < t.length; o++) s.push(t[o].claimId);
                            console.log("OdyseeAPI: Found " + s.length + " search results. Fetching metadata..."), e("claim_search", {
                                claim_ids: s,
                                page_size: 20
                            }, (function (e, t) {
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
            if (-1 !== (t.value && t.value.tags ? t.value.tags : []).indexOf("c:members-only")) return r(new Error("This content is for members only. Please log in with an account that has an active membership."));
            e("get", {
                uri: t.short_url,
                environment: "live"
            }, (function (e, t) {
                if (e) return r(e);
                if (t && t.streaming_url) {
                    var n = t.streaming_url.replace(/^https:/i, "http:");
                    console.log("OdyseeAPI: Stream URL resolved: " + n), r(null, n)
                } else r(new Error("No streaming_url returned"))
            }))
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
            xhr.send("claim_ids=" + claimId);
        },
        getViewCount: function (claimId, callback) {
            function fetchViews(token) {
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
            }

            if (window.odyseeAuthToken) {
                fetchViews(window.odyseeAuthToken);
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
                                    fetchViews(window.odyseeAuthToken);
                                } else { callback(new Error("No auth token in response")); }
                            } catch (e) { callback(e); }
                        } else { callback(new Error("User creation failed")); }
                    }
                };
                xhr.send();
            }
        }
    }
}();