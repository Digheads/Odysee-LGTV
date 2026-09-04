// ---------------------------------------------------------------------------
// Sidebar navigation & category menu (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var Navigation = (function () {
    var navSections = [];

    function getNavIcon(id) {
        return (typeof Icons !== 'undefined' && Icons.get) ? Icons.get(id) : '';
    }

    function sectionLabel(id) {
        if ("nav-trending" === id) return "Trending";
        if ("nav-search" === id) return "Search";
        if ("nav-login" === id) return "Login";
        if ("nav-profile" === id) return "Profile";
        if ("nav-following" === id) return "Following";
        if ("nav-watch-later" === id) return "Watch Later";
        var key = 0 === id.indexOf("cat:") ? id.substring(4) : "";
        for (var i = 0; i < navSections.length; i++)
            if (navSections[i].key === key) return navSections[i].label;
        return "Odysee";
    }

    function updateLogoAvatar() {
        var img = document.getElementById("logo-img");
        if (!img) return;
        if (window.Auth && Auth.isLoggedIn()) {
            var rawAvatar = Auth.getAvatarUrl();
            var processed = (window.Utils && Utils.thumbUrl) ? Utils.thumbUrl(rawAvatar, 160) : rawAvatar;
            img.src = processed;
            img.className = "logo-img user-avatar";
        } else {
            img.src = "icons/icon.png";
            img.className = "logo-img";
        }
    }

    function bindNav() {
        var items = document.querySelectorAll(".nav-item");
        for (var i = 0; i < items.length; i++) {
            items[i].addEventListener("click", function () {
                var all = document.querySelectorAll(".nav-item");
                for (var j = 0; j < all.length; j++) all[j].classList.remove("active");
                this.classList.add("active");
                var navId = this.getAttribute("data-id");
                if (window.Feed && typeof Feed.loadPage === "function") {
                    Feed.loadPage(navId);
                } else if (typeof loadPage === "function") {
                    loadPage(navId);
                }
            });
        }
    }

    function setActive(id) {
        var all = document.querySelectorAll(".nav-item");
        for (var j = 0; j < all.length; j++) {
            if (all[j].getAttribute("data-id") === id) {
                all[j].classList.add("active");
            } else {
                all[j].classList.remove("active");
            }
        }
    }

    function buildNav(sections) {
        if (sections) navSections = sections;
        var ul = document.querySelector(".nav-links");
        if (!ul) return;

        var currentActiveEl = document.querySelector(".nav-item.active");
        var activeId = currentActiveEl ? currentActiveEl.getAttribute("data-id") : (window.Feed && typeof Feed.getCurrentCategory === "function" ? Feed.getCurrentCategory() : "nav-trending");
        if (!activeId) activeId = "nav-trending";

        var items = [];
        if (window.Auth && Auth.isLoggedIn()) {
            items.push({ id: "nav-profile", label: "Profile" });
            items.push({ id: "nav-following", label: "Following" });
            items.push({ id: "nav-watch-later", label: "Watch Later" });
        } else {
            items.push({ id: "nav-login", label: "Login" });
        }

        items.push({ id: "nav-search", label: "Search" });
        items.push({ id: "nav-trending", label: "Trending" });

        for (var i = 0; i < navSections.length; i++)
            items.push({ id: "cat:" + navSections[i].key, label: navSections[i].label });

        ul.innerHTML = "";
        for (var j = 0; j < items.length; j++) {
            var li = document.createElement("li");
            li.className = "focusable nav-item" + (items[j].id === activeId ? " active" : "");
            li.setAttribute("data-id", items[j].id);
            var escLabel = (window.Utils && Utils.escapeHtml) ? Utils.escapeHtml(items[j].label) : items[j].label;
            li.innerHTML = getNavIcon(items[j].id) + '<span>' + escLabel + '</span>';
            ul.appendChild(li);
        }

        bindNav();
        updateLogoAvatar();
        if (window.SpatialNavigation && typeof SpatialNavigation.refresh === "function") {
            SpatialNavigation.refresh();
        }
    }

    // Listen for auth state changes
    if (window.Auth && typeof Auth.onAuthStateChanged === "function") {
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
})();

// Global backwards-compatibility aliases
var buildNav = Navigation.buildNav;
var bindNav = Navigation.bindNav;
var sectionLabel = Navigation.sectionLabel;
