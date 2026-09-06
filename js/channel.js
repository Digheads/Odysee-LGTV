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
    window.channelPageChannelClaim = null;
    window.channelPageIsFollowing = false;

    function updateFollowButton(isFollowing) {
        var btn;
        var iconSvg;

        window.channelPageIsFollowing = isFollowing;
        btn = document.getElementById('btn-channel-follow');
        if (!btn) {
            return;
        }
        iconSvg = window.Icons ? (isFollowing ? Icons.get('following') : Icons.get('follow')) : '';
        if (isFollowing) {
            btn.innerHTML = iconSvg + '<span class="btn-follow-label">Following</span>';
            btn.classList.add('following');
            btn.title = 'Unfollow this channel';
            btn.setAttribute('aria-label', 'Following');
        } else {
            btn.innerHTML = iconSvg + '<span class="btn-follow-label">Follow</span>';
            btn.classList.remove('following');
            btn.title = 'Follow this channel';
            btn.setAttribute('aria-label', 'Follow');
        }
    }

    function toggleFollow() {
        var claim = window.channelPageChannelClaim;
        var btn;
        var claimId;
        var channelName;

        if (!claim || !claim.claim_id) {
            return;
        }
        btn = document.getElementById('btn-channel-follow');
        if (!btn) {
            return;
        }

        // Disable button during API call
        btn.style.opacity = '0.5';
        btn.style.pointerEvents = 'none';

        claimId = claim.claim_id;
        channelName = claim.name || '';

        if (window.channelPageIsFollowing) {
            // Unfollow
            UserData.unfollowChannel(claimId, channelName, function (err) {
                var statsEl;
                var uploadsCount;

                btn.style.opacity = '';
                btn.style.pointerEvents = '';
                if (!err) {
                    updateFollowButton(false);
                    console.log('Channel: Unfollowed ' + channelName);
                    if (typeof window.channelPageFollowerCount === 'number' && window.channelPageFollowerCount > 0) {
                        window.channelPageFollowerCount -= 1;
                        statsEl = document.getElementById('cp-stats');
                        uploadsCount = (window.channelPageChannelClaim && window.channelPageChannelClaim.meta && window.channelPageChannelClaim.meta.claims_in_channel) || 0;
                        if (statsEl) {
                            statsEl.textContent = window.channelPageFollowerCount + ' followers • ' + uploadsCount + ' uploads';
                        }
                    }
                } else {
                    console.error('Channel: Unfollow failed', err);
                }
            });
        } else {
            // Follow
            UserData.followChannel(claimId, channelName, function (err) {
                var statsEl;
                var uploadsCount;

                btn.style.opacity = '';
                btn.style.pointerEvents = '';
                if (!err) {
                    updateFollowButton(true);
                    console.log('Channel: Followed ' + channelName);
                    if (typeof window.channelPageFollowerCount === 'number') {
                        window.channelPageFollowerCount += 1;
                        statsEl = document.getElementById('cp-stats');
                        uploadsCount = (window.channelPageChannelClaim && window.channelPageChannelClaim.meta && window.channelPageChannelClaim.meta.claims_in_channel) || 0;
                        if (statsEl) {
                            statsEl.textContent = window.channelPageFollowerCount + ' followers • ' + uploadsCount + ' uploads';
                        }
                    }
                } else {
                    console.error('Channel: Follow failed', err);
                }
            });
        }
    }

    function close(dontRestoreFocus) {
        var cp;
        var vg;
        var topHeader;
        var followBtn;
        var cpHeader;
        var firstCard;

        window.isChannelPageOpen = false;
        cp = document.getElementById('channel-page');
        if (cp) {
            cp.style.display = 'none';
        }
        vg = document.getElementById('video-grid');
        if (vg) {
            vg.style.display = '';
        }
        topHeader = document.querySelector('.top-header');
        if (topHeader) {
            topHeader.style.display = 'block';
        }

        // Hide follow button & restore header
        followBtn = document.getElementById('btn-channel-follow');
        if (followBtn) {
            followBtn.style.display = 'none';
            followBtn.classList.remove('focused');
        }
        cpHeader = document.getElementById('cp-header');
        if (cpHeader) {
            cpHeader.classList.add('focusable');
            cpHeader.setAttribute('tabindex', '0');
        }

        window.channelPageChannelClaim = null;
        window.channelPageFollowerCount = null;

        if (window.SpatialNavigation) {
            SpatialNavigation.lock();
            SpatialNavigation.refresh();
            if (!dontRestoreFocus) {
                if (window.lastFocusedCard) {
                    SpatialNavigation.focusNode(window.lastFocusedCard);
                } else {
                    firstCard = document.querySelector('.video-card');
                    if (firstCard) {
                        SpatialNavigation.focusNode(firstCard);
                    }
                }
            }
            SpatialNavigation.unlock();
        }
    }

    function open(channelClaim) {
        var vg;
        var topHeader;
        var cp;
        var avatarUrl;
        var avatarEl;
        var processedSrc;
        var isSpaceman;
        var chColor;
        var nameEl;
        var uploadsCount;
        var statsEl;
        var followBtn;
        var cpHeader;
        var hasFollowBtn;
        var loggedIn;
        var ownChannelIds;
        var isOwnChannel;
        var oc;
        var grid;
        var cpLoading;

        if (!channelClaim) {
            return;
        }
        window.isChannelPageOpen = true;
        window.channelPageClaimId = channelClaim.claim_id;
        window.channelPageCurrentPage = 1;
        window.channelPageHasMore = true;
        window.channelPageIsLoading = true;
        window.channelPageChannelClaim = channelClaim;
        history.pushState({ channelPage: true }, '', '');

        vg = document.getElementById('video-grid');
        if (vg) {
            vg.style.display = 'none';
        }
        topHeader = document.querySelector('.top-header');
        if (topHeader) {
            topHeader.style.display = 'none';
        }

        cp = document.getElementById('channel-page');
        if (!cp) {
            return;
        }
        cp.style.display = '';

        avatarUrl = channelClaim.value && channelClaim.value.thumbnail ? channelClaim.value.thumbnail.url : '';
        avatarEl = document.getElementById('cp-avatar');
        if (avatarEl) {
            processedSrc = (window.Utils && Utils.getAvatarSrc) ? Utils.getAvatarSrc(avatarUrl, 120) : (avatarUrl ? Utils.thumbUrl(avatarUrl, 120) : 'icons/spaceman.png');
            isSpaceman = (!processedSrc || processedSrc === 'icons/spaceman.png');
            chColor = (isSpaceman && window.Utils && Utils.getAvatarColor) ? Utils.getAvatarColor(channelClaim.name) : 'transparent';
            avatarEl.src = processedSrc;
            avatarEl.style.backgroundColor = chColor;
        }

        nameEl = document.getElementById('cp-name');
        if (nameEl) {
            nameEl.textContent = channelClaim.value && channelClaim.value.title ? channelClaim.value.title : channelClaim.name;
        }

        uploadsCount = channelClaim.meta && channelClaim.meta.claims_in_channel ? channelClaim.meta.claims_in_channel : 0;
        statsEl = document.getElementById('cp-stats');
        if (statsEl) {
            statsEl.textContent = uploadsCount + ' uploads';
        }

        if (window.OdyseeAPI && typeof OdyseeAPI.getFollowerCount === 'function') {
            OdyseeAPI.getFollowerCount(channelClaim.claim_id, function (err, followCount) {
                if (!err && followCount !== undefined && statsEl) {
                    window.channelPageFollowerCount = followCount;
                    statsEl.textContent = followCount + ' followers • ' + uploadsCount + ' uploads';
                }
            });
        }

        // Follow button logic
        followBtn = document.getElementById('btn-channel-follow');
        cpHeader = document.getElementById('cp-header');
        hasFollowBtn = false;
        if (followBtn) {
            followBtn.style.display = 'none'; // Default hidden
            followBtn.onclick = null;

            loggedIn = window.Auth && typeof Auth.isLoggedIn === 'function' && Auth.isLoggedIn();
            if (loggedIn) {
                // Check if this is the user's own channel
                ownChannelIds = (window.Auth && typeof Auth.getChannelClaimIds === 'function') ? Auth.getChannelClaimIds() : [];
                isOwnChannel = false;
                for (oc = 0; oc < ownChannelIds.length; oc++) {
                    if (ownChannelIds[oc] === channelClaim.claim_id) {
                        isOwnChannel = true;
                        break;
                    }
                }

                if (!isOwnChannel) {
                    hasFollowBtn = true;
                    followBtn.style.display = '';
                    followBtn.innerHTML = '<span class="btn-follow-label">...</span>';
                    followBtn.classList.remove('following');
                    followBtn.setAttribute('data-sn-left', '.nav-item.active');
                    followBtn.onclick = function () {
                        toggleFollow();
                    };

                    // Check current follow status
                    UserData.isFollowingChannel(channelClaim.claim_id, function (isFollowed) {
                        updateFollowButton(isFollowed);
                    });
                }
            }
        }

        if (cpHeader) {
            if (hasFollowBtn) {
                cpHeader.classList.remove('focusable');
                cpHeader.removeAttribute('tabindex');
            } else {
                cpHeader.classList.add('focusable');
                cpHeader.setAttribute('tabindex', '0');
                cpHeader.setAttribute('data-sn-left', '.nav-item.active');
            }
        }

        grid = document.getElementById('cp-video-grid');
        if (grid) {
            grid.innerHTML = '';
        }
        cpLoading = document.getElementById('cp-loading');
        if (cpLoading) {
            cpLoading.style.display = 'block';
        }
        if (window.SpatialNavigation) {
            SpatialNavigation.lock();
            if (typeof SpatialNavigation.clearFocus === 'function') {
                SpatialNavigation.clearFocus();
            }
        }

        OdyseeAPI.searchChannelVideos(channelClaim.claim_id, function (err, res) {
            var targetNode;
            var i;
            var card;
            var header;

            window.channelPageIsLoading = false;
            if (cpLoading) {
                cpLoading.style.display = 'none';
            }
            if (err) {
                if (grid) {
                    grid.innerHTML = '<div style="color:white; font-size:24px; text-align:center; padding: 20px;">Error loading channel videos.</div>';
                }
                if (window.SpatialNavigation) {
                    SpatialNavigation.refresh();
                    targetNode = hasFollowBtn ? followBtn : document.getElementById('cp-header');
                    if (targetNode) {
                        SpatialNavigation.focusNode(targetNode);
                    }
                    SpatialNavigation.unlock();
                }
                return;
            }
            if (res && res.items && res.items.length > 0) {
                for (i = 0; i < res.items.length; i++) {
                    card = Feed.createVideoCard(res.items[i]);
                    if (i === 0 && card) {
                        card.id = 'cp-first-video';
                        header = document.getElementById('cp-header');
                        if (header && !hasFollowBtn) {
                            header.setAttribute('data-sn-down', '#cp-first-video');
                            header.setAttribute('data-sn-left', '.nav-item.active');
                        }
                    }
                    if (card && grid) {
                        grid.appendChild(card);
                    }
                }
                if (window.SpatialNavigation) {
                    SpatialNavigation.refresh();
                    targetNode = hasFollowBtn ? followBtn : document.getElementById('cp-header');
                    if (targetNode) {
                        SpatialNavigation.focusNode(targetNode);
                    }
                    SpatialNavigation.unlock();
                }
            } else {
                window.channelPageHasMore = false;
                if (grid) {
                    grid.innerHTML = '<div style="color:white; font-size:24px; text-align:center; padding: 20px;">No videos found.</div>';
                }
                if (window.SpatialNavigation) {
                    SpatialNavigation.refresh();
                    targetNode = hasFollowBtn ? followBtn : document.getElementById('cp-header');
                    if (targetNode) {
                        SpatialNavigation.focusNode(targetNode);
                    }
                    SpatialNavigation.unlock();
                }
            }
        }, 1);
    }

    function loadMore() {
        var loadingEl;
        var gridEl;

        if (window.channelPageIsLoading || !window.channelPageHasMore || !window.channelPageClaimId) {
            return;
        }

        window.channelPageIsLoading = true;
        window.channelPageCurrentPage += 1;
        loadingEl = document.getElementById('cp-loading');
        if (loadingEl) {
            loadingEl.style.display = 'block';
        }

        gridEl = document.getElementById('cp-video-grid');

        OdyseeAPI.searchChannelVideos(window.channelPageClaimId, function (err, res) {
            var i;
            var card;

            window.channelPageIsLoading = false;
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }

            if (err) {
                console.error('Load more channel videos failed', err);
                return;
            }

            if (res && res.items && res.items.length > 0) {
                if (res.items.length < 20) {
                    window.channelPageHasMore = false;
                }
                for (i = 0; i < res.items.length; i++) {
                    card = Feed.createVideoCard(res.items[i]);
                    if (card && gridEl) {
                        gridEl.appendChild(card);
                    }
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
}());

// Global backwards-compatibility aliases
window.Channel = Channel;
window.openChannelPage = Channel.open;
window.closeChannelPage = Channel.close;
window.loadMoreChannelContent = Channel.loadMore;
