// ---------------------------------------------------------------------------
// Odysee Content Catalog & Unified API Facade (ES5 compatible for webOS 2.0+)
// Manages homepage sections, trending, categories, Lighthouse search, and
// delegates media, rights, and user state to dedicated submodules.
// ---------------------------------------------------------------------------

var OdyseeAPI = (function () {
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
                    return cb(null, homepageData);
                } catch (err) {
                    return cb(err);
                }
            }
            cb(new Error("Homepage API failed: " + r.status));
        };
        r.ontimeout = r.onerror = function () {
            cb(new Error("Homepage API unavailable"));
        };
        r.send();
    }

    return {
        // -------------------------------------------------------------------
        // Public Catalog & Discovery
        // -------------------------------------------------------------------

        getSections: function (cb) {
            // Display order matching odysee.com sidebar
            var DISPLAY_ORDER = [
                "PRIMARY_CONTENT", "UNIVERSE", "POP_CULTURE", "GAMING", "COMEDY",
                "ART", "EDUCATION", "TECHNOLOGY", "LIFESTYLE", "SPOOKY", "MUSIC",
                "SPORTS", "SPIRITUALITY", "FINANCE", "NEWS_AND_POLITICS"
            ];

            fetchHomepage(function (err, data) {
                if (err) return cb(err);

                // Build a map of all valid sections (with channelIds)
                var sectionMap = {};
                for (var k in data) {
                    if (!data.hasOwnProperty(k)) continue;
                    var sec = data[k];
                    if (!sec || "object" != typeof sec) continue;
                    if (k === "EXPLORABLE_CHANNEL") continue;
                    var ids = sec.channelIds || [];
                    if (!ids.length) continue;
                    sectionMap[k] = {
                        key: k,
                        label: sec.label || sec.name || k,
                        channelLimit: sec.channelLimit || 3
                    };
                }

                // Output in hardcoded odysee.com display order
                var out = [];
                for (var i = 0; i < DISPLAY_ORDER.length; i++) {
                    if (sectionMap[DISPLAY_ORDER[i]]) {
                        out.push(sectionMap[DISPLAY_ORDER[i]]);
                        delete sectionMap[DISPLAY_ORDER[i]];
                    }
                }
                // Append any new sections not in DISPLAY_ORDER (future-proofing)
                for (var extra in sectionMap) {
                    if (sectionMap.hasOwnProperty(extra)) {
                        out.push(sectionMap[extra]);
                    }
                }

                console.log("OdyseeAPI: " + out.length + " category(ies)");
                cb(null, out);
            });
        },

        getBaseNotTags: function () {
            var settings = (window.Auth && typeof Auth.getSettings === "function") ?
                Auth.getSettings() : { hideMature: true, hideShorts: true, hideYoutube: false };

            var notTags = ["c:unlisted", "c:scheduled:show", "c:scheduled:hide"];

            // Exclude members-only/rentals at API level ONLY if user has no memberships/purchases
            var hasMemberships = window.Auth && typeof Auth.hasAnyMembershipsOrPurchases === "function" && Auth.hasAnyMembershipsOrPurchases();
            if (!hasMemberships) {
                notTags.push("c:members-only", "c:rental", "c:purchase");
            }

            // Mature content tags
            if (settings.hideMature) {
                notTags.push("mature", "c:mature", "nsfw", "c:nsfw", "porn", "xxx", "hentai", "sex", "18+", "adult");
            }

            // Synced YouTube content tags
            if (settings.hideYoutube) {
                notTags.push("youtube-sync", "c:you-tube", "you-tube", "c:youtube");
            }

            return notTags;
        },

        getCategory: function (key, t, page) {
            var self = this;
            fetchHomepage(function (err, data) {
                if (err) return t(err);
                var sec = data[key];
                if (!sec || !(sec.channelIds || []).length) return t(new Error("Unknown category: " + key));
                LbryRpc.call("claim_search", {
                    channel_ids: (sec.channelIds || []).slice(0, 50),
                    claim_type: ["stream"],
                    stream_types: ["video"],
                    page_size: 20,
                    page: page || 1,
                    has_no_source: false,
                    fee_amount: "<=0",
                    not_tags: self.getBaseNotTags(),
                    limit_claims_per_channel: parseInt(sec.channelLimit || 3, 10),
                    order_by: ["trending_group", "trending_mixed"]
                }, ClaimFilter.filterPlayable(t));
            });
        },

        getTrending: function (t, page) {
            LbryRpc.call("claim_search", {
                claim_type: ["stream"],
                stream_types: ["video"],
                page_size: 20,
                page: page || 1,
                has_no_source: false,
                fee_amount: "<=0",
                not_tags: this.getBaseNotTags(),
                order_by: ["trending_group", "trending_mixed"]
            }, ClaimFilter.filterPlayable(t));
        },

        search: function (t, r, page) {
            var self = this;
            var p = page || 1;
            console.log("OdyseeAPI: Searching lighthouse for: " + t);
            var settings = (window.Auth && typeof Auth.getSettings === "function") ?
                Auth.getSettings() : { hideMature: true, hideShorts: true, hideYoutube: false };

            var xhr = new XMLHttpRequest();
            var url = "https://lighthouse.odysee.tv/search?s=" + encodeURIComponent(t) +
                "&size=20&from=" + ((p - 1) * 20) + "&claimType=file&mediaType=video&free_only=true" +
                (settings.hideMature ? "&nsfw=false" : "");

            xhr.open("GET", url, true);
            xhr.onreadystatechange = function () {
                if (4 === xhr.readyState) {
                    if (200 === xhr.status) {
                        try {
                            var list = JSON.parse(xhr.responseText);
                            if (list && list.length > 0) {
                                var s = [];
                                for (var o = 0; o < list.length; o++) s.push(list[o].claimId);
                                console.log("OdyseeAPI: Found " + s.length + " search results. Fetching metadata...");

                                LbryRpc.call("claim_search", {
                                    claim_ids: s,
                                    page_size: 20,
                                    has_no_source: false,
                                    fee_amount: "<=0",
                                    not_tags: self.getBaseNotTags()
                                }, ClaimFilter.filterPlayable(function (e, t) {
                                    if (e) return r(e);
                                    if (t && t.items) {
                                        var map = {};
                                        for (var j = 0; j < t.items.length; j++) map[t.items[j].claim_id] = t.items[j];
                                        var sorted = [];
                                        for (var i = 0; i < s.length; i++) {
                                            if (map[s[i]]) sorted.push(map[s[i]]);
                                        }
                                        t.items = sorted;
                                    }
                                    r(null, t);
                                }));
                            } else {
                                r(null, { items: [] });
                            }
                        } catch (e) {
                            r(e);
                        }
                    } else {
                        r(new Error("Search failed: " + xhr.status));
                    }
                }
            };
            xhr.send();
        },

        searchChannelVideos: function (channelClaimId, cb, page) {
            LbryRpc.call("claim_search", {
                channel_ids: [channelClaimId],
                claim_type: ["stream"],
                stream_types: ["video"],
                page_size: 20,
                page: page || 1,
                has_no_source: false,
                fee_amount: "<=0",
                order_by: ["release_time"]
            }, ClaimFilter.filterPlayable(cb));
        },

        getFollowerCount: function (channelClaimId, cb) {
            LbryNet.ensureAuthToken(function (token) {
                var data = { claim_id: channelClaimId };
                if (token) data.auth_token = token;

                LbryIo.call("/subscription/sub_count", { data: data }, function (err, resp) {
                    if (!err && resp && resp.data && resp.data.length > 0) {
                        cb(null, resp.data[0]);
                    } else if (!err) {
                        cb(null, 0);
                    } else {
                        cb(err || new Error("Follower count API failed"));
                    }
                });
            });
        },

        getRelatedVideos: function (claim, cb) {
            if (!claim || !claim.claim_id) return cb(null, { channelTitle: "", channelVideos: [], relatedVideos: [] });
            var self = this;
            var currentClaimId = claim.claim_id;
            var channelClaimId = (claim.signing_channel && claim.signing_channel.claim_id) ? claim.signing_channel.claim_id : null;
            var channelTitle = (claim.signing_channel && claim.signing_channel.value && claim.signing_channel.value.title) ?
                claim.signing_channel.value.title : (claim.signing_channel ? claim.signing_channel.name : "");
            var tags = (claim.value && claim.value.tags) ? claim.value.tags.slice(0, 5) : [];
            var notTags = self.getBaseNotTags();

            var channelItems = [];
            var tagItems = [];
            var pending = 0;

            function finish() {
                var channelMap = {};
                var cleanChannel = [];
                for (var i = 0; i < channelItems.length; i++) {
                    var cItem = channelItems[i];
                    if (cItem && cItem.claim_id && cItem.claim_id !== currentClaimId && !channelMap[cItem.claim_id]) {
                        channelMap[cItem.claim_id] = true;
                        cleanChannel.push(cItem);
                    }
                }

                var relatedMap = {};
                var cleanRelated = [];
                for (var j = 0; j < tagItems.length; j++) {
                    var tItem = tagItems[j];
                    if (tItem && tItem.claim_id && tItem.claim_id !== currentClaimId && !channelMap[tItem.claim_id] && !relatedMap[tItem.claim_id]) {
                        relatedMap[tItem.claim_id] = true;
                        cleanRelated.push(tItem);
                    }
                }

                if (cleanRelated.length < 6) {
                    LbryRpc.call("claim_search", {
                        claim_type: ["stream"],
                        stream_types: ["video"],
                        page_size: 15,
                        has_no_source: false,
                        fee_amount: "<=0",
                        not_claim_ids: [currentClaimId],
                        not_tags: notTags,
                        order_by: ["trending_group", "trending_mixed"]
                    }, ClaimFilter.filterPlayable(function (errTrending, resTrending) {
                        if (!errTrending && resTrending && resTrending.items) {
                            for (var k = 0; k < resTrending.items.length; k++) {
                                var trItem = resTrending.items[k];
                                if (trItem && trItem.claim_id && trItem.claim_id !== currentClaimId && !channelMap[trItem.claim_id] && !relatedMap[trItem.claim_id]) {
                                    relatedMap[trItem.claim_id] = true;
                                    cleanRelated.push(trItem);
                                }
                            }
                        }
                        cb(null, {
                            channelTitle: channelTitle,
                            channelVideos: cleanChannel,
                            relatedVideos: cleanRelated
                        });
                    }));
                } else {
                    cb(null, {
                        channelTitle: channelTitle,
                        channelVideos: cleanChannel,
                        relatedVideos: cleanRelated
                    });
                }
            }

            if (channelClaimId) {
                pending++;
                LbryRpc.call("claim_search", {
                    channel_ids: [channelClaimId],
                    not_claim_ids: [currentClaimId],
                    claim_type: ["stream"],
                    stream_types: ["video"],
                    page_size: 15,
                    has_no_source: false,
                    fee_amount: "<=0",
                    not_tags: notTags,
                    order_by: ["release_time"]
                }, ClaimFilter.filterPlayable(function (errCh, resCh) {
                    if (!errCh && resCh && resCh.items) {
                        channelItems = resCh.items;
                    }
                    pending--;
                    if (pending === 0) finish();
                }));
            }

            pending++;
            var tagParams = {
                claim_type: ["stream"],
                stream_types: ["video"],
                page_size: 15,
                has_no_source: false,
                fee_amount: "<=0",
                not_claim_ids: [currentClaimId],
                not_tags: notTags,
                order_by: ["trending_group", "trending_mixed"]
            };
            if (tags.length > 0) {
                tagParams.any_tags = tags;
            }
            LbryRpc.call("claim_search", tagParams, ClaimFilter.filterPlayable(function (errTag, resTag) {
                if (!errTag && resTag && resTag.items) {
                    tagItems = resTag.items;
                }
                pending--;
                if (pending === 0) finish();
            }));
        },

        // -------------------------------------------------------------------
        // Backward-Compatibility Facade (delegates to focused modules)
        // -------------------------------------------------------------------

        syncServerTime: function (cb) {
            return LbryNet.syncServerTime(cb);
        },
        getServerNowSec: function () {
            return LbryNet.getServerNowSec();
        },
        ensureAuthToken: function (cb) {
            return LbryNet.ensureAuthToken(cb);
        },

        buildHlsUrl: function (claim) {
            return StreamResolver.buildHlsUrl(claim);
        },
        buildMp4Url: function (claim) {
            return StreamResolver.buildMp4Url(claim);
        },
        getStreamingSourceUrl: function (claim, cb) {
            return StreamResolver.getStreamingSourceUrl(claim, cb);
        },
        getCachedMagicUrl: function (claimId) {
            return StreamResolver.getCachedMagicUrl(claimId);
        },
        setCachedMagicUrl: function (claimId, url, createdAtSec) {
            return StreamResolver.setCachedMagicUrl(claimId, url, createdAtSec);
        },
        reportWatchmanPlayback: function (url, duration, pos, relPos, rebufCount, rebufDur) {
            return StreamResolver.reportWatchmanPlayback(url, duration, pos, relPos, rebufCount, rebufDur);
        },

        protectedReason: function (claim) {
            return ClaimFilter.protectedReason(claim);
        },
        filterPlayable: function (cb) {
            return ClaimFilter.filterPlayable(cb);
        },

        getReactions: function (claimId, cb) {
            return UserData.getReactions(claimId, cb);
        },
        getMyReaction: function (claimId, cb) {
            return UserData.getMyReaction(claimId, cb);
        },
        getCachedReactions: function (claimId) {
            return UserData.getCachedReactions ? UserData.getCachedReactions(claimId) : null;
        },
        react: function (claimId, type, remove, cb) {
            return UserData.react(claimId, type, remove, cb);
        },
        getViewCount: function (claimId, cb) {
            return UserData.getViewCount(claimId, cb);
        },
        saveViewProgress: function (claimId, uri, time) {
            return UserData.saveViewProgress(claimId, uri, time);
        },
        getResumePoint: function (claimId) {
            return UserData.getResumePoint(claimId);
        },
        saveResumePoint: function (claimId, time, duration) {
            return UserData.saveResumePoint(claimId, time, duration);
        },
        getWatchLaterIds: function () {
            return UserData.getWatchLaterIds();
        },
        saveWatchLater: function (claimId, add) {
            return UserData.saveWatchLater(claimId, add);
        },
        isWatchLater: function (claimId) {
            return UserData.isWatchLater(claimId);
        },
        getWatchLaterVideos: function (cb, page) {
            return UserData.getWatchLaterVideos(cb, page);
        },
        getPlaylists: function (cb) {
            return UserData.getUserPlaylists(cb);
        },
        getPlaylistVideos: function (playlist, cb, page) {
            return UserData.getPlaylistVideos(playlist, cb, page);
        },
        getFollowedChannels: function (cb) {
            return UserData.getFollowedChannels(cb);
        },
        getFollowingVideos: function (cb, page) {
            return UserData.getFollowingVideos(cb, page);
        }
    };
})();