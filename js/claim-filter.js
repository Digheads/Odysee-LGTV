// ---------------------------------------------------------------------------
// Claim Content & Rights Protection Filter (ES5 compatible for webOS 2.0+)
// Filters mature, scheduled, members-only, and purchased claims according to
// user settings and active permissions.
// ---------------------------------------------------------------------------

var ClaimFilter = (function () {

    function protectedReason(claim) {
        if (!claim) return null;
        var tags = (claim.value && claim.value.tags) ? claim.value.tags : [];
        var releaseTime = (claim.value && claim.value.release_time) ? +claim.value.release_time : 0;
        var nowSec = (window.LbryNet && typeof LbryNet.getServerNowSec === "function") ?
            LbryNet.getServerNowSec() : Math.floor(new Date().getTime() / 1000);
        var claimId = claim.claim_id || "";
        var channelId = claim.signing_channel ? claim.signing_channel.claim_id : (claim.channel_id || "");

        var settings = (window.Auth && typeof Auth.getSettings === "function") ?
            Auth.getSettings() : { hideMature: true, hideMembersOnly: false, hideYoutube: false };

        for (var i = 0; i < tags.length; i++) {
            var t = tags[i];

            // Scheduled content check
            if (("c:scheduled:show" === t || "c:scheduled:hide" === t) && releaseTime > nowSec) {
                return "Scheduled content, not yet released.";
            }

            // Mature content filter
            if (settings.hideMature && (t === "mature" || t === "nsfw" || t === "c:nsfw" || t === "c:mature")) {
                return "Mature content.";
            }

            // Synced YouTube filter
            if (settings.hideYoutube && (t === "c:you-tube" || t === "you-tube" || t === "c:youtube" || t === "youtube")) {
                return "Synced YouTube content.";
            }

            // Members-only check: if user is member of this channel, allow!
            if (t === "c:members-only") {
                if (window.Auth && typeof Auth.isMemberOf === "function" && Auth.isMemberOf(channelId)) {
                    continue; // User has active membership, unlock!
                }
                return "Members-only content.";
            }

            // Purchase / rental check: if user purchased this claim, allow!
            if (t === "c:purchase" || t === "c:rental" || 0 === t.indexOf("purchase:") || 0 === t.indexOf("rental:")) {
                if (window.Auth && typeof Auth.hasPurchased === "function" && Auth.hasPurchased(claimId)) {
                    continue; // User purchased, unlock!
                }
                return "Purchasable content.";
            }

            if (t === "c:unlisted") {
                return "Unlisted content.";
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
            if (err || !res || !res.items) return cb(err, res);
            var before = res.items.length;
            var out = [];
            for (var i = 0; i < before; i++) {
                var it = res.items[i];
                if (!protectedReason(it.reposted_claim || it)) {
                    out.push(it);
                }
            }
            res.raw_count = before;
            res.items = out;
            if (before !== out.length) {
                console.log("Filtered out " + (before - out.length) + "/" + before + " protected claim(s)");
            }
            return cb(err, res);
        };
    }

    return {
        protectedReason: protectedReason,
        filterPlayable: filterPlayable
    };
})();
