var OdyseeAPI = function () {
    // A homepage valasza (szekciok + csatornalistak) lapozasonkent nem valtozik,
    // ezert egyszer kerjuk le es cache-eljuk.
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
            cb(new Error("Homepage API nem elerheto"))
        };
        r.send()
    }

    // MERES (2026-08-26): a v4 vegpontra a warmup HEAD 200-at adott, a <video>
    // megis MEDIA_ERR_SRC_NOT_SUPPORTED-tel bukott ugyanazon az URL-en. A v4 alak
    // vegen nincs kiterjesztes (.../{claim_id}/{sd6}), es a webOS 2.0 media
    // pipeline-ja ezt nem eszi meg, hiaba video/mp4 a Content-Type.
    //
    // Ezert az elsodleges alak a /v6/ .mp4 -- es NEM vesztunk vele semmit:
    // a fitForTranscoder a v6-on is lefut HEAD-re, tehat a warmup ugyanugy
    // megkapja a 308-at, ha van kesz HLS transcode.
    //
    // true-ra allitva visszaall a v4-es alak (kiterjesztes nelkul).
    var USE_V4_HLS = false;

    // A `magic` parameter csak akkor ervenyes, ha a szerver szerint 5 percnel
    // fiatalabb (time.Since(ts) < 5*time.Minute). A timestampet a TV oraja adja,
    // es egy TV orja simán elcsuszhat -- akkor 401-et kapunk. Az
    // api.odysee.com/user/new valasza tartalmaz szerveroldali idobelyeget
    // (created_at), ebbol kiszamoljuk az eltolast. A Date fejlec nem jarhato ut:
    // nincs a CORS safelisten es az expose-headers sem tartalmazza.
    var serverTimeOffsetMs = 0,
        serverTimeSynced = false;

    // A regi WebKit ISO-8601 parseolasa megbizhatatlan -> kezzel bontjuk.
    // A player-server VerifyAccess()-e ezekre a tagekre 401-et ad
    // (ErrEdgeCredentialsMissing), mert Authorization: Token <edgeToken> fejlecet
    // var -- az viszont szerveroldali titok, kliens soha nem tudja megadni.
    // Ezekre tehat NEM erdemes probalkozni: nem a magic/hotlink a baj.
    function protectedReason(claim) {
        var tags = (claim.value && claim.value.tags) ? claim.value.tags : [],
            fixed = {
                "c:members-only": "Tagsagi (members-only) tartalom.",
                "c:rental": "Berelheto tartalom.",
                "c:purchase": "Megvasarolhato tartalom.",
                "c:unlisted": "Nem listazott tartalom."
            },
            releaseTime = (claim.value && claim.value.release_time) ? +claim.value.release_time : 0,
            nowSec = Math.floor((new Date().getTime() + serverTimeOffsetMs) / 1000);
        for (var i = 0; i < tags.length; i++) {
            var t = tags[i];
            if (fixed[t]) return fixed[t];
            if (0 === t.indexOf("purchase:")) return "Megvasarolhato tartalom.";
            if (0 === t.indexOf("rental:")) return "Berelheto tartalom.";
            if (("c:scheduled:show" === t || "c:scheduled:hide" === t) && releaseTime > nowSec)
                return "Utemezett tartalom, meg nem jelent meg.";
        }
        return null;
    }

    // A VerifyAccess altal vedett claimek kliensbol SOHA nem jatszhatok le
    // (401 + "edge credentials missing"), ezert ki sem tesszuk oket a racsra.
    // A raw_count-ot megorizzuk, kulonben a lapozas koran leallna: az app a
    // visszakapott elemszambol kovetkeztet arra, van-e meg tovabbi oldal.
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
                console.log("Kiszurve " + (before - out.length) + "/" + before + " vedett claim");
            return cb(err, res)
        }
    }

    function parseIsoUtc(str) {
        var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(str || "");
        if (!m) return NaN;
        return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }

    // A claim_search valaszideje eresen ingadozik (mertem 1 mp-et es 18 mp folotti
    // timeoutot is ugyanarra a lekerdezesre), ezert halozati hiba/timeout eseten
    // ujraprobalunk. API-hibara (JSON-RPC error) NEM, az determinisztikus.
    function rpc(e, t, r, attempt) {
        attempt = attempt || 0;
        var maxAttempts = 3;

        function retryOrFail(err) {
            if (attempt + 1 < maxAttempts) {
                var wait = 2000 * (attempt + 1);
                console.log("API ujraprobalkozas " + (attempt + 1) + "/" + (maxAttempts - 1) +
                    " (" + wait / 1000 + " mp mulva): " + e);
                return void setTimeout(function () {
                    rpc(e, t, r, attempt + 1)
                }, wait)
            }
            r(err)
        }
        var n = "https://api.na-backend.odysee.com/api/v1/proxy";
        "get" === e && (n += "?m=get"), console.log("OdyseeAPI: Starting request to " + n);
        var s = new XMLHttpRequest;
        s.open("POST", n, !0), s.setRequestHeader("Content-Type", "application/json-rpc"), s.timeout = 2e4, s.ontimeout = function () {
            retryOrFail(new Error("Timeout: nem erem el a " + n + " cimet"))
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
        // Egyszer fut le inditaskor. Mellekhatasként az auth tokent is eltarolja,
        // igy a getViewCount nem fog ujabb user/new hivast inditani.
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
                            console.log("Ora-szinkron: eltolas " +
                                Math.round(serverTimeOffsetMs / 1000) + " mp (TV ora " +
                                (serverTimeOffsetMs > 0 ? "kesik" : "siet") + ")");
                        }
                        if (d.auth_token) window.odyseeAuthToken = d.auth_token;
                    } catch (err) {
                        console.error("Ora-szinkron parse hiba: " + err.message)
                    }
                } else console.error("Ora-szinkron sikertelen: " + xhr.status);
                cb && cb()
            };
            xhr.ontimeout = xhr.onerror = function () {
                console.error("Ora-szinkron nem elerheto, a TV orajat hasznaljuk");
                cb && cb()
            };
            xhr.send()
        },

        // A transcodolt HLS master playlist URL-je, a claim adataibol felepitve.
        // Igy nem kell kovetni a 308-as atiranyitast, amit egy 2015-os media
        // pipeline lehet hogy nem kezel (a 308 ujabb, mint a 301/302/303/307).
        // A formatumot a player-server getPlaylistURL() v4-es aga adja:
        //   /api/v4/streams/tc/{claim_name}/{claim_id}/{TELJES_sd_hash}/master.m3u8
        // Figyelem: itt a teljes 96 karakteres sd_hash kell, nem a 6 karakteres prefix.
        buildHlsUrl: function (claim) {
            var c = claim.reposted_claim || claim,
                sd = c.value && c.value.source ? c.value.source.sd_hash : "";
            if (!(c.name && c.claim_id && sd)) return null;
            return "http://player.odycdn.com/api/v4/streams/tc/" +
                encodeURIComponent(c.name) + "/" + c.claim_id + "/" + sd + "/master.m3u8";
        },

        // A legkompatibilisebb mp4 alak: /v6/ vegpont, .mp4 kiterjesztessel.
        // Ez sosem iranyit at HLS-re (a fitForTranscoder a v6-on csak HEAD-re fut),
        // es a kiterjesztes miatt a regi media pipeline is felismeri a tipust.
        buildMp4Url: function (claim) {
            var c = claim.reposted_claim || claim,
                sd = c.value && c.value.source ? c.value.source.sd_hash : "";
            if (!(c.claim_id && sd)) return null;
            return "http://player.odycdn.com/v6/streams/" + c.claim_id + "/" + sd.substring(0, 6) + ".mp4";
        },

        // Szerverhez igazitott UNIX masodperc a `magic` parameterhez.
        getServerNowSec: function () {
            return Math.floor((new Date().getTime() + serverTimeOffsetMs) / 1000)
        },

        // A homepage szekcioi (Featured, Gaming, Tech, Comedy, ...). Ugyanabbol a
        // valaszbol jonnek, amit a kategoria-lekerdezes is hasznal -> nincs plusz keres.
        getSections: function (cb) {
            fetchHomepage(function (err, data) {
                if (err) return cb(err);
                var out = [];
                for (var k in data) {
                    if (!data.hasOwnProperty(k)) continue;
                    var sec = data[k];
                    if (!sec || "object" != typeof sec) continue;
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
                console.log("OdyseeAPI: " + out.length + " kategoria");
                cb(null, out)
            })
        },

        getCategory: function (key, t, page) {
            fetchHomepage(function (err, data) {
                if (err) return t(err);
                var sec = data[key];
                if (!sec || !(sec.channelIds || []).length) return t(new Error("Ismeretlen kategoria: " + key));
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
            // Repost eseten a tenyleges stream a reposted_claim-ben van.
            var claim = t.reposted_claim || t,
                name = claim.name,
                cid = claim.claim_id,
                sd = claim.value && claim.value.source ? claim.value.source.sd_hash : "";

            var blocked = protectedReason(claim);
            if (blocked) return r(new Error(blocked + " Ezt a lejatszo nem tudja feloldani."));

            // A /api/v4/ vegpont maga donti el, mit szolgal ki: ha van kesz HLS
            // transcode, 308-cal atiranyit a master.m3u8-ra (libx264 + AAC + .ts
            // szegmensek = HLS v3, amit a webOS 2.0 nativan visz), ha nincs, az
            // eredeti mp4-et adja. A `fitForTranscoder` az /api/v4/ prefixre
            // mindig lefut, nem csak HEAD-re -- ezert eleg egyetlen URL.
            // Bonusz: a `get` RPC korutat is megsporoljuk.
            if (name && cid && sd) {
                var u = USE_V4_HLS ?
                    "http://player.odycdn.com/api/v4/streams/free/" +
                    encodeURIComponent(name) + "/" + cid + "/" + sd.substring(0, 6) :
                    "http://player.odycdn.com/v6/streams/" + cid + "/" + sd.substring(0, 6) + ".mp4";
                console.log("OdyseeAPI: stream URL (" + (USE_V4_HLS ? "v4" : "v6") + "): " + u);
                return r(null, u)
            }

            // Nincs sd_hash (pl. livestream, vagy hianyos claim) -> `get` RPC.
            // A permanent_url a legmegbizhatobb; a short_url meresem szerint
            // ~8%-ban "couldn't find claim"-et ad.
            console.log("OdyseeAPI: nincs sd_hash, fallback a get RPC-re");
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