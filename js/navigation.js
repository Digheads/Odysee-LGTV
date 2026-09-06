// ---------------------------------------------------------------------------
// Sidebar navigation & category menu (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var Navigation = (function () {
    var navSections = [];

    function getNavIcon(id) {
        return (typeof Icons !== 'undefined' && Icons.get) ? Icons.get(id) : '';
    }

    function sectionLabel(id) {
        var key;
        var i;

        if (id === 'nav-trending') {
            return 'Trending';
        }
        if (id === 'nav-search') {
            return 'Search';
        }
        if (id === 'nav-login') {
            return 'Login';
        }
        if (id === 'nav-profile') {
            return 'Profile';
        }
        if (id === 'nav-following') {
            return 'Following';
        }
        if (id === 'nav-watch-later') {
            return 'Watch Later';
        }
        if (id === 'nav-playlists') {
            return 'Playlists';
        }
        key = id.indexOf('cat:') === 0 ? id.substring(4) : '';
        for (i = 0; i < navSections.length; i++) {
            if (navSections[i].key === key) {
                return navSections[i].label;
            }
        }
        return 'Odysee';
    }

    function updateLogoAvatar() {
        var img = document.getElementById('logo-img');
        var rawAvatar;
        var processed;
        var isSpaceman;
        var user;
        var chName;
        var avatarColor;

        if (!img) {
            return;
        }
        if (window.Auth && Auth.isLoggedIn()) {
            rawAvatar = Auth.getAvatarUrl();
            processed = (window.Utils && Utils.getAvatarSrc) ? Utils.getAvatarSrc(rawAvatar, 160) : rawAvatar;
            isSpaceman = (!processed || processed === 'icons/spaceman.png');
            user = Auth.getUser ? Auth.getUser() : {};
            chName = user ? (user.channelName || '') : '';
            avatarColor = (isSpaceman && window.Utils && Utils.getAvatarColor) ? Utils.getAvatarColor(chName) : 'transparent';
            img.src = processed || 'icons/spaceman.png';
            img.style.backgroundColor = avatarColor;
            img.className = 'logo-img user-avatar';
        } else {
            img.src = 'icons/icon.png';
            img.style.backgroundColor = '';
            img.className = 'logo-img';
        }
    }

    function bindNav() {
        var items = document.querySelectorAll('.nav-item');
        var i;

        for (i = 0; i < items.length; i++) {
            items[i].addEventListener('click', function () {
                var all = document.querySelectorAll('.nav-item');
                var j;
                var navId;

                for (j = 0; j < all.length; j++) {
                    all[j].classList.remove('active');
                }
                this.classList.add('active');
                navId = this.getAttribute('data-id');
                if (window.Feed && typeof Feed.loadPage === 'function') {
                    Feed.loadPage(navId);
                } else if (typeof loadPage === 'function') {
                    loadPage(navId);
                }
            });
        }
    }

    function setActive(id) {
        var all = document.querySelectorAll('.nav-item');
        var j;

        for (j = 0; j < all.length; j++) {
            if (all[j].getAttribute('data-id') === id) {
                all[j].classList.add('active');
            } else {
                all[j].classList.remove('active');
            }
        }
    }

    function buildNav(sections) {
        var ul;
        var currentActiveEl;
        var activeId;
        var items;
        var i;
        var j;
        var li;
        var escLabel;

        if (sections) {
            navSections = sections;
        }
        ul = document.querySelector('.nav-links');
        if (!ul) {
            return;
        }

        currentActiveEl = document.querySelector('.nav-item.active');
        activeId = currentActiveEl ? currentActiveEl.getAttribute('data-id') : (window.Feed && typeof Feed.getCurrentCategory === 'function' ? Feed.getCurrentCategory() : 'nav-trending');
        if (!activeId) {
            activeId = 'nav-trending';
        }

        items = [];
        if (window.Auth && Auth.isLoggedIn()) {
            items.push({ id: 'nav-profile', label: 'Profile' });
            items.push({ id: 'nav-following', label: 'Following' });
            items.push({ id: 'nav-watch-later', label: 'Watch Later' });
            items.push({ id: 'nav-playlists', label: 'Playlists' });
        } else {
            items.push({ id: 'nav-login', label: 'Login' });
        }

        items.push({ id: 'nav-search', label: 'Search' });
        items.push({ id: 'nav-trending', label: 'Trending' });

        for (i = 0; i < navSections.length; i++) {
            items.push({
                id: 'cat:' + navSections[i].key,
                label: navSections[i].label
            });
        }

        ul.innerHTML = '';
        for (j = 0; j < items.length; j++) {
            li = document.createElement('li');
            li.className = 'focusable nav-item' + (items[j].id === activeId ? ' active' : '');
            li.setAttribute('data-id', items[j].id);
            escLabel = (window.Utils && Utils.escapeHtml) ? Utils.escapeHtml(items[j].label) : items[j].label;
            li.innerHTML = getNavIcon(items[j].id) + '<span>' + escLabel + '</span>';
            ul.appendChild(li);
        }

        bindNav();
        updateLogoAvatar();
        if (window.SpatialNavigation && typeof SpatialNavigation.refresh === 'function') {
            SpatialNavigation.refresh();
        }
    }

    // Listen for auth state changes
    if (window.Auth && typeof Auth.onAuthStateChanged === 'function') {
        Auth.onAuthStateChanged(function () {
            buildNav();
            updateLogoAvatar();
        });
    }

    return {
        getNavIcon: getNavIcon,
        sectionLabel: sectionLabel,
        bindNav: bindNav,
        buildNav: buildNav,
        setActive: setActive,
        updateLogoAvatar: updateLogoAvatar
    };
}());

// Global backwards-compatibility aliases
var buildNav = Navigation.buildNav;
var bindNav = Navigation.bindNav;
var sectionLabel = Navigation.sectionLabel;
