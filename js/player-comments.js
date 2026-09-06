// ---------------------------------------------------------------------------
// Player Comments Sidebar (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var PlayerComments = (function () {
    var isCommentsOpen = false;

    function open(claimId) {
        var sidebar = document.getElementById('player-comments-sidebar');
        var listEl = document.getElementById('comments-list');
        var titleEl = document.getElementById('comments-sidebar-title');

        if (!sidebar || !listEl) {
            return;
        }

        isCommentsOpen = true;
        history.pushState({
            playerOpen: true,
            commentsOpen: true
        }, 'comments');
        sidebar.classList.remove('hidden');
        listEl.innerHTML = '<div class="comments-loading">Loading comments...</div>';

        if (claimId) {
            Comments.list(claimId, 1, function (err, res) {
                var total;
                var html;
                var idx;
                var item;
                var author;
                var timeAgo;
                var bodyText;

                if (err || !res || !res.items) {
                    listEl.innerHTML = '<div class="comments-empty">Failed to load comments.</div>';
                    return;
                }

                total = res.total_items || 0;
                if (titleEl) {
                    titleEl.textContent = total + (total === 1 ? ' Comment' : ' Comments');
                }

                if (res.items.length === 0) {
                    listEl.innerHTML = '<div class="comments-empty">No comments yet.</div>';
                    return;
                }

                html = '';
                for (idx = 0; idx < res.items.length; idx++) {
                    item = res.items[idx];
                    author = item.channel_name || 'Anonymous';
                    timeAgo = item.timestamp ? Utils.formatRelativeTime(item.timestamp) : '';
                    bodyText = Utils.escapeHtml(item.comment || '');

                    html += '<div class="comment-card">';
                    html += '  <div class="comment-card-header">';
                    html += '    <span class="comment-author">' + author + '</span>';
                    if (item.is_creator) {
                        html += '    <span class="comment-badge-creator">Creator</span>';
                    }
                    if (item.is_pinned) {
                        html += '    <span class="comment-badge-pinned">Pinned</span>';
                    }
                    if (timeAgo) {
                        html += '    <span class="comment-time">' + timeAgo + '</span>';
                    }
                    html += '  </div>';
                    html += '  <div class="comment-body">' + bodyText + '</div>';
                    html += '</div>';
                }
                listEl.innerHTML = html;
            });
        }
    }

    function close() {
        var sidebar = document.getElementById('player-comments-sidebar');
        var btnCommentsReFocus;
        var pf;
        var p;

        if (sidebar) {
            sidebar.classList.add('hidden');
        }
        isCommentsOpen = false;

        btnCommentsReFocus = document.getElementById('btn-comments');
        if (btnCommentsReFocus) {
            pf = document.querySelectorAll('#player-container .focused');
            for (p = 0; p < pf.length; p++) {
                pf[p].classList.remove('focused');
            }
            btnCommentsReFocus.classList.add('focused');
            SpatialNavigation.focusNode(btnCommentsReFocus);
        }
    }

    return {
        open: open,
        close: close,
        isOpen: function () {
            return isCommentsOpen;
        }
    };
}());
