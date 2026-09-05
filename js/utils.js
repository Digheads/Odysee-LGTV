// ---------------------------------------------------------------------------
// General utility & formatting helpers (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var Utils = (function () {
    // WebKit 538.2 (webOS 2.0) only supports -webkit-flex; the unprefixed
    // "flex" value is invalid and the assignment is silently ignored. We set the
    // prefixed version first, then the unprefixed one -- on modern engines the latter wins,
    // but on older ones it is invalid, so it falls back to -webkit-flex.
    function setDisplayFlex(el) {
        if (!el) return;
        el.style.display = "-webkit-flex";
        el.style.display = "flex";
    }

    function escapeHtml(s) {
        return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // The webOS 2.0 web engine is WebKit 538.2 -- it cannot decode WebP. Furthermore,
    // most raw thumbnails are 1920x1080: 20 cards would be ~101 MB decoded bitmap,
    // resized to 400x225 it's ~7 MB. The proxy thus fixes format AND size,
    // which is why we need it for every image. The source format cannot be determined
    // from the URL anyway: thumbnails.lbry.com serves both JPEG and WebP
    // from the same host without extension or Content-Type.
    function thumbUrl(u, size) {
        if (!u) return "";
        var w = size || 400;
        return "https://wsrv.nl/?url=" + encodeURIComponent(u) + "&output=jpg&w=" + w;
    }

    // Odysee 4-color deterministic avatar background mapping:
    // 0: #748ffc (Soft Blue), 1: #ffa855 (Yellow/Orange), 2: #339af0 (Sky Blue), 3: #ec8383 (Pink/Red)
    function getAvatarColor(channelName) {
        if (!channelName) return "#cccccc";
        var clean = channelName.replace(/^@/, "").trim();
        if (!clean.length) return "#cccccc";
        var code = clean.charCodeAt(0) - 65;
        var idx = Math.abs(code % 4);
        var colors = ["#748ffc", "#ffa855", "#339af0", "#ec8383"];
        return colors[idx] || "#cccccc";
    }

    // Returns local transparent spaceman.png for default avatars (zero network / zero wsrv.nl proxying)
    function getAvatarSrc(rawUrl, size) {
        if (!rawUrl || rawUrl === "icons/icon.png" || rawUrl.indexOf("spaceman") !== -1) {
            return "icons/spaceman.png";
        }
        return thumbUrl(rawUrl, size || 160);
    }

    // player.odycdn.com by default marks ALL requests as "flagged" and
    // returns 401, unless an authorized Referer/Origin/User-Agent header arrives.
    // A <video> tag cannot send headers -- however, the
    // ?magic=<unix_ts> query parameter completely disables this check for 5 minutes,
    // and it's part of the URL, so the <video> can use it.
    function buildPlayableUrl(rawUrl, useMagic) {
        var u = rawUrl.replace(/^https:/i, "http:");
        u = u.replace(/([?&])magic=\d+(&|$)/, function (m, p1, p2) {
            return p2 === "&" ? p1 : "";
        }).replace(/[?&]$/, "");
        if (!useMagic) return u;
        var now = (window.OdyseeAPI && typeof OdyseeAPI.getServerNowSec === "function") ?
            OdyseeAPI.getServerNowSec() : Math.floor(Date.now() / 1000);
        return u + (-1 === u.indexOf("?") ? "?" : "&") + "magic=" + now;
    }

    // Duration formatting helper (MM:SS or HH:MM:SS)
    function formatDuration(sec, total) {
        if (isNaN(sec)) return "00:00";
        var t = Math.floor(sec / 3600),
            n = Math.floor(sec % 3600 / 60),
            i = Math.floor(sec % 60),
            th = total ? Math.floor(total / 3600) : t;
        if (th > 0) {
            return (t < 10 ? "0" + t : t) + ":" + (n < 10 ? "0" + n : n) + ":" + (i < 10 ? "0" + i : i);
        } else {
            return (n < 10 ? "0" + n : n) + ":" + (i < 10 ? "0" + i : i);
        }
    }

    // Relative date formatting helper ("X days ago", etc.)
    function formatRelativeTime(timestamp) {
        if (!timestamp || timestamp <= 0) return "";
        var seconds = Math.floor((Date.now() / 1000) - timestamp);
        var interval = seconds / 31536000;
        if (interval >= 1) return Math.floor(interval) + (Math.floor(interval) === 1 ? " year ago" : " years ago");
        interval = seconds / 2592000;
        if (interval >= 1) return Math.floor(interval) + (Math.floor(interval) === 1 ? " month ago" : " months ago");
        interval = seconds / 86400;
        if (interval >= 1) return Math.floor(interval) + (Math.floor(interval) === 1 ? " day ago" : " days ago");
        interval = seconds / 3600;
        if (interval >= 1) return Math.floor(interval) + (Math.floor(interval) === 1 ? " hour ago" : " hours ago");
        interval = seconds / 60;
        if (interval >= 1) return Math.floor(interval) + (Math.floor(interval) === 1 ? " minute ago" : " minutes ago");
        return Math.max(0, Math.floor(seconds)) + " seconds ago";
    }

    return {
        setDisplayFlex: setDisplayFlex,
        escapeHtml: escapeHtml,
        thumbUrl: thumbUrl,
        buildPlayableUrl: buildPlayableUrl,
        formatDuration: formatDuration,
        formatRelativeTime: formatRelativeTime,
        getAvatarColor: getAvatarColor,
        getAvatarSrc: getAvatarSrc
    };
})();

// Global backwards-compatibility aliases
var setDisplayFlex = Utils.setDisplayFlex;
var escapeHtml = Utils.escapeHtml;
var thumbUrl = Utils.thumbUrl;
var buildPlayableUrl = Utils.buildPlayableUrl;

if (typeof module !== "undefined" && module.exports) {
    module.exports = Utils;
}
