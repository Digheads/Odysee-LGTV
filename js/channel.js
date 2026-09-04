// ---------------------------------------------------------------------------
// Channel profile page and channel video listings (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var Channel = (function () {
    window.isChannelPageOpen = false;
    window.channelPageClaimId = null;
    window.channelPageCurrentPage = 1;
    window.channelPageHasMore = true;
    window.channelPageIsLoading = false;
    window.lastFocusedCard = null;
    window.lastFocusedChannelCard = null;

    function close() {
        if (!window.isChannelPageOpen) return;
        window.isChannelPageOpen = false;
        var cp = document.getElementById("channel-page");
        if (cp) cp.style.display = "none";
        var vg = document.getElementById("video-grid");
        if (vg) vg.style.display = "";
        var topHeader = document.querySelector(".top-header");
        if (topHeader) topHeader.style.display = "block";

        SpatialNavigation.refresh();
        if (window.lastFocusedCard) {
            SpatialNavigation.focusNode(window.lastFocusedCard);
        } else {
            SpatialNavigation.focusNode(document.querySelector(".video-card"));
        }
    }

    function open(channelClaim) {
        if (!channelClaim) return;
        window.isChannelPageOpen = true;
        window.channelPageClaimId = channelClaim.claim_id;
        window.channelPageCurrentPage = 1;
        window.channelPageHasMore = true;
        window.channelPageIsLoading = true;
        history.pushState({ channelPage: true }, "", "");

        var vg = document.getElementById("video-grid");
        if (vg) vg.style.display = "none";
        var topHeader = document.querySelector(".top-header");
        if (topHeader) topHeader.style.display = "none";

        var cp = document.getElementById("channel-page");
        if (!cp) return;
        cp.style.display = "";

        var avatarUrl = channelClaim.value && channelClaim.value.thumbnail ? channelClaim.value.thumbnail.url : "";
        var avatarEl = document.getElementById("cp-avatar");
        if (avatarEl) {
            avatarEl.src = avatarUrl ? Utils.thumbUrl(avatarUrl, 120) : "icons/icon.png";
        }

        var nameEl = document.getElementById("cp-name");
        if (nameEl) {
            nameEl.textContent = channelClaim.value && channelClaim.value.title ? channelClaim.value.title : channelClaim.name;
        }

        var uploadsCount = channelClaim.meta && channelClaim.meta.claims_in_channel ? channelClaim.meta.claims_in_channel : 0;
        var statsEl = document.getElementById("cp-stats");
        if (statsEl) statsEl.textContent = uploadsCount + " uploads";

        if (window.OdyseeAPI && typeof OdyseeAPI.getSubscriberCount === "function") {
            OdyseeAPI.getSubscriberCount(channelClaim.claim_id, function (err, subCount) {
                if (!err && subCount !== undefined && statsEl) {
                    statsEl.textContent = subCount + " followers • " + uploadsCount + " uploads";
                }
            });
        }

        var grid = document.getElementById("cp-video-grid");
        if (grid) grid.innerHTML = "";
        var cpLoading = document.getElementById("cp-loading");
        if (cpLoading) cpLoading.style.display = "block";
        SpatialNavigation.focusNode(document.getElementById("channel-page"));

        OdyseeAPI.searchChannelVideos(channelClaim.claim_id, function (err, res) {
            window.channelPageIsLoading = false;
            if (cpLoading) cpLoading.style.display = "none";
            if (err) {
                if (grid) grid.innerHTML = '<div style="color:white; font-size:24px; text-align:center; padding: 20px;">Error loading channel videos.</div>';
                return;
            }
            if (res && res.items && res.items.length > 0) {
                for (var i = 0; i < res.items.length; i++) {
                    var card = Feed.createVideoCard(res.items[i]);
                    if (i === 0 && card) {
                        card.id = "cp-first-video";
                        var header = document.getElementById("cp-header");
                        if (header) header.setAttribute("data-sn-down", "#cp-first-video");
                    }
                    if (card && grid) grid.appendChild(card);
                }
                SpatialNavigation.refresh();
                setTimeout(function () {
                    var header = document.getElementById("cp-header");
                    if (header) SpatialNavigation.focusNode(header);
                }, 100);
            } else {
                window.channelPageHasMore = false;
                if (grid) grid.innerHTML = '<div style="color:white; font-size:24px; text-align:center; padding: 20px;">No videos found.</div>';
            }
        }, 1);
    }

    function loadMore() {
        if (window.channelPageIsLoading || !window.channelPageHasMore || !window.channelPageClaimId) return;

        window.channelPageIsLoading = true;
        window.channelPageCurrentPage++;
        var n = document.getElementById("cp-loading");
        if (n) n.style.display = "block";

        var t = document.getElementById("cp-video-grid");

        OdyseeAPI.searchChannelVideos(window.channelPageClaimId, function (err, res) {
            window.channelPageIsLoading = false;
            if (n) n.style.display = "none";

            if (err) {
                console.error("Load more channel videos failed", err);
                return;
            }

            if (res && res.items && res.items.length > 0) {
                if (res.items.length < 20) window.channelPageHasMore = false;
                for (var i = 0; i < res.items.length; i++) {
                    var card = Feed.createVideoCard(res.items[i]);
                    if (card && t) t.appendChild(card);
                }
                SpatialNavigation.refresh();
            } else {
                window.channelPageHasMore = false;
            }
        }, window.channelPageCurrentPage);
    }

    return {
        open: open,
        close: close,
        loadMore: loadMore
    };
})();

// Global backwards-compatibility aliases
window.openChannelPage = Channel.open;
window.closeChannelPage = Channel.close;
window.loadMoreChannelContent = Channel.loadMore;
