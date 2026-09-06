// ---------------------------------------------------------------------------
// Claim Content & Rights Protection Filter (ES5 compatible for webOS 2.0+)
// Filters mature, scheduled, members-only, shorts, and YouTube synced claims
// according to user settings and active permissions.
// ---------------------------------------------------------------------------

var ClaimFilter = (function () {

    function hasAccessToClaim(claimId, channelId) {
        var myChannels;

        if (!window.Auth) {
            return false;
        }
        if (typeof Auth.hasPurchased === 'function' && Auth.hasPurchased(claimId)) {
            return true;
        }
        if (channelId) {
            if (typeof Auth.isMemberOf === 'function' && Auth.isMemberOf(channelId)) {
                return true;
            }
            if (typeof Auth.getChannelClaimIds === 'function') {
                myChannels = Auth.getChannelClaimIds();
                if (myChannels && myChannels.indexOf(channelId) > -1) {
                    return true;
                }
            }
        }
        return false;
    }

    function protectedReason(claim) {
        var tags;
        var channelTags;
        var releaseTime;
        var nowSec;
        var claimId;
        var channelId;
        var settings;
        var video;
        var dur;
        var isVertical;
        var allTags;
        var userHasAccess;
        var m;
        var tLow;
        var s;
        var tagLow;
        var y;
        var yTag;
        var i;
        var t;

        if (!claim) {
            return null;
        }
        tags = (claim.value && claim.value.tags) ? claim.value.tags : [];
        channelTags = (claim.signing_channel && claim.signing_channel.value && claim.signing_channel.value.tags) ?
            claim.signing_channel.value.tags : [];
        releaseTime = (claim.value && claim.value.release_time) ? +claim.value.release_time : 0;
        nowSec = (window.LbryNet && typeof LbryNet.getServerNowSec === 'function') ?
            LbryNet.getServerNowSec() : Math.floor(new Date().getTime() / 1000);
        claimId = claim.claim_id || '';
        channelId = claim.signing_channel ? claim.signing_channel.claim_id : (claim.channel_id || '');

        settings = (window.Auth && typeof Auth.getSettings === 'function') ?
            Auth.getSettings() : {
                hideMature: true,
                hideShorts: true,
                hideYoutube: false
            };

        // 1. Mature content check
        if (settings.hideMature) {
            if (claim.is_mature === true || (claim.value && claim.value.is_mature === true)) {
                return 'Mature content.';
            }
            for (m = 0; m < tags.length; m++) {
                tLow = (tags[m] || '').toLowerCase();
                if (tLow === 'mature' || tLow === 'c:mature' || tLow === 'nsfw' || tLow === 'c:nsfw' ||
                    tLow === 'porn' || tLow === 'xxx' || tLow === 'hentai' || tLow === 'sex' ||
                    tLow === '18+' || tLow === 'adult') {
                    return 'Mature content.';
                }
            }
        }

        // 2. Short vertical content filter ("You will not see vertical videos less than 3 minutes.")
        if (settings.hideShorts) {
            video = claim.value && claim.value.video;
            if (video) {
                dur = video.duration || 0;
                if (dur > 0 && dur < 180) {
                    isVertical = (video.height && video.width && video.height > video.width);
                    if (isVertical) {
                        return 'Short vertical content (< 3 mins).';
                    }
                    for (s = 0; s < tags.length; s++) {
                        tagLow = (tags[s] || '').toLowerCase();
                        if (tagLow === 'shorts' || tagLow === 'short' || tagLow === 'c:short' || tagLow === 'vertical') {
                            return 'Short vertical content (< 3 mins).';
                        }
                    }
                }
            }
        }

        // 3. Synced YouTube filter
        if (settings.hideYoutube) {
            allTags = tags.concat(channelTags);
            for (y = 0; y < allTags.length; y++) {
                yTag = (allTags[y] || '').toLowerCase();
                if (yTag === 'youtube-sync' || yTag === 'c:you-tube' || yTag === 'you-tube' ||
                    yTag === 'c:youtube' || yTag === 'youtube' || yTag === 'yt:sync' || yTag === 'c:yt-sync') {
                    return 'Synced YouTube content.';
                }
            }
        }

        // 4. Access check for members-only and purchased/rented content
        userHasAccess = hasAccessToClaim(claimId, channelId);

        for (i = 0; i < tags.length; i++) {
            t = tags[i];

            // Scheduled content check
            if ((t === 'c:scheduled:show' || t === 'c:scheduled:hide') && releaseTime > nowSec) {
                return 'Scheduled content, not yet released.';
            }

            if (t === 'c:unlisted') {
                return 'Unlisted content.';
            }

            // Members-only check: always active by default, allowed only if user is member, purchased, or owner
            if (t === 'c:members-only') {
                if (userHasAccess) {
                    continue;
                }
                return 'Members-only content.';
            }

            // Purchase / rental check: allowed only if user purchased or is member/owner
            if (t === 'c:purchase' || t === 'c:rental' || t.indexOf('purchase:') === 0 || t.indexOf('rental:') === 0) {
                if (userHasAccess) {
                    continue;
                }
                return 'Purchasable content.';
            }
        }

        // Also check if claim has a paid fee
        if (claim.value && claim.value.fee && +claim.value.fee.amount > 0) {
            if (!userHasAccess) {
                return 'Paid content.';
            }
        }

        return null;
    }

    // Claims protected by VerifyAccess can NEVER be played from an unauthenticated client
    // (401 + "edge credentials missing"), so we don't even put them on the grid.
    // We preserve raw_count, otherwise pagination would stop early: the app infers
    // whether there is another page from the number of returned items.
    function filterPlayable(cb) {
        return function (err, res) {
            var before;
            var out;
            var i;
            var it;

            if (err || !res || !res.items) {
                return cb(err, res);
            }
            before = res.items.length;
            out = [];
            for (i = 0; i < before; i++) {
                it = res.items[i];
                if (!protectedReason(it.reposted_claim || it)) {
                    out.push(it);
                }
            }
            res.raw_count = before;
            res.items = out;
            if (before !== out.length) {
                console.log('Filtered out ' + (before - out.length) + '/' + before + ' protected claim(s)');
            }
            return cb(err, res);
        };
    }

    return {
        hasAccessToClaim: hasAccessToClaim,
        protectedReason: protectedReason,
        filterPlayable: filterPlayable
    };
}());
