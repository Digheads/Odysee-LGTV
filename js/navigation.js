// ---------------------------------------------------------------------------
// Sidebar navigation & category menu (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var Navigation = (function () {
    var navSections = [];

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
        if (Auth.isLoggedIn()) {
            rawAvatar = Auth.getAvatarUrl();
            processed = Utils.getAvatarSrc(rawAvatar, 160);
            isSpaceman = (!processed || processed === 'icons/spaceman.png');
            user = Auth.getUser();
            chName = user ? (user.channelName || '') : '';
            avatarColor = isSpaceman ? Utils.getAvatarColor(chName) : 'transparent';
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
                Feed.loadPage(navId);
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
        activeId = currentActiveEl ? currentActiveEl.getAttribute('data-id') : Feed.getCurrentCategory();
        if (!activeId) {
            activeId = 'nav-trending';
        }

        items = [];
        if (Auth.isLoggedIn()) {
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
            escLabel = Utils.escapeHtml(items[j].label);
            li.innerHTML = Icons.get(items[j].id) + '<span>' + escLabel + '</span>';
            ul.appendChild(li);
        }

        bindNav();
        updateLogoAvatar();
        SpatialNavigation.refresh();
    }

    // Listen for auth state changes
    Auth.onAuthStateChanged(function () {
        buildNav();
        updateLogoAvatar();
    });

    return {
        sectionLabel: sectionLabel,
        bindNav: bindNav,
        buildNav: buildNav,
        setActive: setActive,
        updateLogoAvatar: updateLogoAvatar
    };
}());
