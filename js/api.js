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
        var r;

        if (homepageData) {
            return cb(null, homepageData);
        }
        r = new XMLHttpRequest();
        r.open('GET', 'https://odysee.com/$/api/content/v1/get?language=en', true);
        r.timeout = 20000;
        r.onreadystatechange = function () {
            if (r.readyState !== 4) {
                return;
            }
            if (r.status === 200) {
                try {
                    homepageData = JSON.parse(r.responseText).data.en;
                    return cb(null, homepageData);
                } catch (err) {
                    return cb(err);
                }
            }
            cb(new Error('Homepage API failed: ' + r.status));
        };
        r.ontimeout = function () {
            cb(new Error('Homepage API unavailable'));
        };
        r.onerror = function () {
            cb(new Error('Homepage API unavailable'));
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
                'PRIMARY_CONTENT', 'UNIVERSE', 'POP_CULTURE', 'GAMING', 'COMEDY',
                'ART', 'EDUCATION', 'TECHNOLOGY', 'LIFESTYLE', 'SPOOKY', 'MUSIC',
                'SPORTS', 'SPIRITUALITY', 'FINANCE', 'NEWS_AND_POLITICS'
            ];

            fetchHomepage(function (err, data) {
                var sectionMap;
                var k;
                var sec;
                var ids;
                var out;
                var i;
                var extra;

                if (err) {
                    return cb(err);
                }

                // Build a map of all valid sections (with channelIds)
                sectionMap = {};
                for (k in data) {
                    if (data.hasOwnProperty(k)) {
                        sec = data[k];
                        if (sec && typeof sec === 'object' && k !== 'EXPLORABLE_CHANNEL') {
                            ids = sec.channelIds || [];
                            if (ids.length) {
                                sectionMap[k] = {
                                    key: k,
                                    label: sec.label || sec.name || k,
                                    channelLimit: sec.channelLimit || 3
                                };
                            }
                        }
                    }
                }

                // Output in hardcoded odysee.com display order
                out = [];
                for (i = 0; i < DISPLAY_ORDER.length; i++) {
                    if (sectionMap[DISPLAY_ORDER[i]]) {
                        out.push(sectionMap[DISPLAY_ORDER[i]]);
                        delete sectionMap[DISPLAY_ORDER[i]];
                    }
                }
                // Append any new sections not in DISPLAY_ORDER (future-proofing)
                for (extra in sectionMap) {
                    if (sectionMap.hasOwnProperty(extra)) {
                        out.push(sectionMap[extra]);
                    }
                }

                console.log('OdyseeAPI: ' + out.length + ' category(ies)');
                cb(null, out);
            });
        },

        getBaseNotTags: function () {
            var settings;
            var notTags;
            var hasMemberships;

            settings = Auth.getSettings() || {
                hideMature: true,
                hideShorts: true,
                hideYoutube: false
            };

            notTags = ['c:unlisted', 'c:scheduled:show', 'c:scheduled:hide'];

            // Exclude members-only/rentals at API level ONLY if user has no memberships/purchases
            hasMemberships = Auth.hasAnyMembershipsOrPurchases();
            if (!hasMemberships) {
                notTags.push('c:members-only', 'c:rental', 'c:purchase');
            }

            // Mature content tags
            if (settings.hideMature) {
                notTags.push('mature', 'c:mature', 'nsfw', 'c:nsfw', 'porn', 'xxx', 'hentai', 'sex', '18+', 'adult');
            }

            // Synced YouTube content tags
            if (settings.hideYoutube) {
                notTags.push('youtube-sync', 'c:you-tube', 'you-tube', 'c:youtube');
            }

            return notTags;
        },

        getCategory: function (key, cb, page) {
            var self = this;
            fetchHomepage(function (err, data) {
                var sec;

                if (err) {
                    return cb(err);
                }
                sec = data[key];
                if (!sec || !(sec.channelIds || []).length) {
                    return cb(new Error('Unknown category: ' + key));
                }
                LbryRpc.call('claim_search', {
                    channel_ids: (sec.channelIds || []).slice(0, 50),
                    claim_type: ['stream'],
                    stream_types: ['video'],
                    page_size: 20,
                    page: page || 1,
                    has_no_source: false,
                    fee_amount: '<=0',
                    not_tags: self.getBaseNotTags(),
                    limit_claims_per_channel: parseInt(sec.channelLimit || 3, 10),
                    order_by: ['trending_group', 'trending_mixed']
                }, ClaimFilter.filterPlayable(cb));
            });
        },

        getTrending: function (cb, page) {
            LbryRpc.call('claim_search', {
                claim_type: ['stream'],
                stream_types: ['video'],
                page_size: 20,
                page: page || 1,
                has_no_source: false,
                fee_amount: '<=0',
                not_tags: this.getBaseNotTags(),
                order_by: ['trending_group', 'trending_mixed']
            }, ClaimFilter.filterPlayable(cb));
        },

        search: function (query, cb, page) {
            var self = this;
            var p = page || 1;
            var settings;
            var xhr;
            var url;

            console.log('OdyseeAPI: Searching lighthouse for: ' + query);
            settings = Auth.getSettings() || {
                hideMature: true,
                hideShorts: true,
                hideYoutube: false
            };

            xhr = new XMLHttpRequest();
            url = 'https://lighthouse.odysee.tv/search?s=' + encodeURIComponent(query) +
                '&size=20&from=' + ((p - 1) * 20) + '&claimType=file&mediaType=video&free_only=true' +
                (settings.hideMature ? '&nsfw=false' : '');

            xhr.open('GET', url, true);
            xhr.onreadystatechange = function () {
                var list;
                var s;
                var o;

                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        try {
                            list = JSON.parse(xhr.responseText);
                            if (list && list.length > 0) {
                                s = [];
                                for (o = 0; o < list.length; o++) {
                                    s.push(list[o].claimId);
                                }
                                console.log('OdyseeAPI: Found ' + s.length + ' search results. Fetching metadata...');

                                LbryRpc.call('claim_search', {
                                    claim_ids: s,
                                    page_size: 20,
                                    has_no_source: false,
                                    fee_amount: '<=0',
                                    not_tags: self.getBaseNotTags()
                                }, ClaimFilter.filterPlayable(function (e, t) {
                                    var map;
                                    var j;
                                    var sorted;
                                    var i;

                                    if (e) {
                                        return cb(e);
                                    }
                                    if (t && t.items) {
                                        map = {};
                                        for (j = 0; j < t.items.length; j++) {
                                            map[t.items[j].claim_id] = t.items[j];
                                        }
                                        sorted = [];
                                        for (i = 0; i < s.length; i++) {
                                            if (map[s[i]]) {
                                                sorted.push(map[s[i]]);
                                            }
                                        }
                                        t.items = sorted;
                                    }
                                    cb(null, t);
                                }));
                            } else {
                                cb(null, { items: [] });
                            }
                        } catch (e) {
                            cb(e);
                        }
                    } else {
                        cb(new Error('Search failed: ' + xhr.status));
                    }
                }
            };
            xhr.send();
        },

        searchChannelVideos: function (channelClaimId, cb, page) {
            LbryRpc.call('claim_search', {
                channel_ids: [channelClaimId],
                claim_type: ['stream'],
                stream_types: ['video'],
                page_size: 20,
                page: page || 1,
                has_no_source: false,
                fee_amount: '<=0',
                order_by: ['release_time']
            }, ClaimFilter.filterPlayable(cb));
        },

        getFollowerCount: function (channelClaimId, cb) {
            LbryNet.ensureAuthToken(function (token) {
                var data = { claim_id: channelClaimId };

                if (token) {
                    data.auth_token = token;
                }

                LbryIo.call('/subscription/sub_count', { data: data }, function (err, resp) {
                    if (!err && resp && resp.data && resp.data.length > 0) {
                        cb(null, resp.data[0]);
                    } else if (!err) {
                        cb(null, 0);
                    } else {
                        cb(err || new Error('Follower count API failed'));
                    }
                });
            });
        },

        getRelatedVideos: function (claim, cb) {
            var self;
            var currentClaimId;
            var channelClaimId;
            var channelTitle;
            var tags;
            var notTags;
            var channelItems;
            var tagItems;
            var pending;
            var tagParams;

            if (!claim || !claim.claim_id) {
                return cb(null, {
                    channelTitle: '',
                    channelVideos: [],
                    relatedVideos: []
                });
            }
            self = this;
            currentClaimId = claim.claim_id;
            channelClaimId = (claim.signing_channel && claim.signing_channel.claim_id) ? claim.signing_channel.claim_id : null;
            channelTitle = (claim.signing_channel && claim.signing_channel.value && claim.signing_channel.value.title) ?
                claim.signing_channel.value.title : (claim.signing_channel ? claim.signing_channel.name : '');
            tags = (claim.value && claim.value.tags) ? claim.value.tags.slice(0, 5) : [];
            notTags = self.getBaseNotTags();

            channelItems = [];
            tagItems = [];
            pending = 0;

            function finish() {
                var channelMap = {};
                var cleanChannel = [];
                var relatedMap;
                var cleanRelated;
                var i;
                var cItem;
                var j;
                var tItem;

                for (i = 0; i < channelItems.length; i++) {
                    cItem = channelItems[i];
                    if (cItem && cItem.claim_id && cItem.claim_id !== currentClaimId && !channelMap[cItem.claim_id]) {
                        channelMap[cItem.claim_id] = true;
                        cleanChannel.push(cItem);
                    }
                }

                relatedMap = {};
                cleanRelated = [];
                for (j = 0; j < tagItems.length; j++) {
                    tItem = tagItems[j];
                    if (tItem && tItem.claim_id && tItem.claim_id !== currentClaimId && !channelMap[tItem.claim_id] && !relatedMap[tItem.claim_id]) {
                        relatedMap[tItem.claim_id] = true;
                        cleanRelated.push(tItem);
                    }
                }

                if (cleanRelated.length < 6) {
                    LbryRpc.call('claim_search', {
                        claim_type: ['stream'],
                        stream_types: ['video'],
                        page_size: 15,
                        has_no_source: false,
                        fee_amount: '<=0',
                        not_claim_ids: [currentClaimId],
                        not_tags: notTags,
                        order_by: ['trending_group', 'trending_mixed']
                    }, ClaimFilter.filterPlayable(function (errTrending, resTrending) {
                        var k;
                        var trItem;

                        if (!errTrending && resTrending && resTrending.items) {
                            for (k = 0; k < resTrending.items.length; k++) {
                                trItem = resTrending.items[k];
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
                pending += 1;
                LbryRpc.call('claim_search', {
                    channel_ids: [channelClaimId],
                    not_claim_ids: [currentClaimId],
                    claim_type: ['stream'],
                    stream_types: ['video'],
                    page_size: 15,
                    has_no_source: false,
                    fee_amount: '<=0',
                    not_tags: notTags,
                    order_by: ['release_time']
                }, ClaimFilter.filterPlayable(function (errCh, resCh) {
                    if (!errCh && resCh && resCh.items) {
                        channelItems = resCh.items;
                    }
                    pending -= 1;
                    if (pending === 0) {
                        finish();
                    }
                }));
            }

            pending += 1;
            tagParams = {
                claim_type: ['stream'],
                stream_types: ['video'],
                page_size: 15,
                has_no_source: false,
                fee_amount: '<=0',
                not_claim_ids: [currentClaimId],
                not_tags: notTags,
                order_by: ['trending_group', 'trending_mixed']
            };
            if (tags.length > 0) {
                tagParams.any_tags = tags;
            }
            LbryRpc.call('claim_search', tagParams, ClaimFilter.filterPlayable(function (errTag, resTag) {
                if (!errTag && resTag && resTag.items) {
                    tagItems = resTag.items;
                }
                pending -= 1;
                if (pending === 0) {
                    finish();
                }
            }));
        }
    };
}());