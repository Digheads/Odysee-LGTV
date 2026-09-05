var SpatialNavigation = function () {
    var e = [],
        t = -1,
        lastFocusedEl = null,
        isLocked = false;

    function a() {
        var a = document.querySelectorAll(".focusable");
        e = [];
        for (var c = 0; c < a.length; c++) null !== a[c].offsetParent && e.push(a[c]);
        if (!isLocked) {
            (t >= e.length || (t >= 0 && -1 === e.indexOf(lastFocusedEl))) && e.length > 0 && n(0);
        } else {
            if (lastFocusedEl && -1 === e.indexOf(lastFocusedEl)) {
                if (lastFocusedEl.classList) lastFocusedEl.classList.remove("focused");
                lastFocusedEl = null;
                t = -1;
            }
        }
    }

    function clearFocus() {
        if (lastFocusedEl && lastFocusedEl.classList) {
            lastFocusedEl.classList.remove("focused");
        }
        lastFocusedEl = null;
        var allFocused = document.querySelectorAll(".focused");
        for (var f = 0; f < allFocused.length; f++) {
            allFocused[f].classList.remove("focused");
        }
        t = -1;
    }

    function n(a) {
        if (lastFocusedEl && lastFocusedEl.classList.remove("focused"), e[t = a]) {
            e[t].classList.add("focused");
            var n = e[t];
            lastFocusedEl = n;
            if (document.activeElement && document.activeElement.tagName === "INPUT" && document.activeElement !== n) {
                document.activeElement.blur();
            }
            if (n.classList.contains("nav-item")) {
                var p = n.parentNode;
                if (p && p.scrollHeight > p.clientHeight) {
                    var q = n.offsetTop - p.clientHeight / 2;
                    q < 0 && (q = 0), p.scrollTop = q
                }
            }
            if (n.classList.contains("video-card")) {
                var c = document.getElementById("main-content");
                if (c) {
                    var i = n.offsetTop - 150;
                    if (i < 0) i = 0;
                    if (Math.abs(c.scrollTop - i) > 20) {
                        c.scrollTop = i;
                    }
                }
            }
            if (n.classList.contains("channel-header") || n.id === "btn-channel-follow" || n.classList.contains("btn-channel-follow")) {
                var c = document.getElementById("main-content");
                if (c) c.scrollTop = 0;
            }
        }
    }

    function c(e) {
        var t = e.getBoundingClientRect();
        return {
            top: t.top,
            left: t.left,
            right: t.right,
            bottom: t.bottom,
            width: t.width,
            height: t.height,
            cx: t.left + t.width / 2,
            cy: t.top + t.height / 2
        }
    }

    function i(a) {
        if (isLocked) {
            if ((a.keyCode >= 37 && a.keyCode <= 40) || a.keyCode === 13) {
                a.preventDefault();
                return;
            }
        }
        if (0 !== e.length) {
            var i = e[t];
            if (i) {
                if (a.keyCode >= 37 && a.keyCode <= 40) {
                    var override = null;
                    if (a.keyCode === 37) override = i.getAttribute("data-sn-left");
                    else if (a.keyCode === 38) override = i.getAttribute("data-sn-up");
                    else if (a.keyCode === 39) override = i.getAttribute("data-sn-right");
                    else if (a.keyCode === 40) override = i.getAttribute("data-sn-down");

                    if (override) {
                        var target = document.querySelector(override);
                        if (target) {
                            var targetIdx = e.indexOf(target);
                            if (targetIdx !== -1) {
                                a.preventDefault();
                                n(targetIdx);
                                return;
                            }
                        }
                    }
                }

                if (a.keyCode === 39 && i.classList.contains("nav-item")) {
                    if (window.isChannelPageOpen) {
                        var followBtn = document.getElementById("btn-channel-follow");
                        if (followBtn && followBtn.style.display !== "none" && followBtn.classList.contains("focusable")) {
                            var followIdx = e.indexOf(followBtn);
                            if (followIdx !== -1) {
                                a.preventDefault();
                                n(followIdx);
                                return;
                            }
                        }
                        var cpHeader = document.getElementById("cp-header");
                        if (cpHeader && cpHeader.classList.contains("focusable")) {
                            var cpIdx = e.indexOf(cpHeader);
                            if (cpIdx !== -1) {
                                a.preventDefault();
                                n(cpIdx);
                                return;
                            }
                        }
                    }
                    for (var k = 0; k < e.length; k++) {
                        if (e[k].classList.contains("video-card") || e[k].classList.contains("playlist-card") || e[k].id === "search-input" || e[k].id === "btn-search" || (e[k].id === "cp-header" && e[k].classList.contains("focusable")) || (e[k].id === "btn-channel-follow" && e[k].style.display !== "none")) {
                            a.preventDefault();
                            n(k);
                            return;
                        }
                    }
                }
                var isVideoCard = i.classList.contains("video-card") || i.classList.contains("playlist-card");
                var isChannelHeader = i.id === "cp-header" || i.classList.contains("channel-header") || i.id === "btn-channel-follow" || i.classList.contains("btn-channel-follow");
                for (var o = c(i), s = -1, r = 1 / 0, f = 0; f < e.length; f++)
                    if (f !== t) {
                        if (isVideoCard && (a.keyCode === 37 || a.keyCode === 39) && (e[f].id === "search-input" || e[f].id === "btn-search")) continue;
                        if (isVideoCard && a.keyCode !== 37 && e[f].classList.contains("nav-item")) continue;
                        if (isChannelHeader && a.keyCode === 37 && (e[f].classList.contains("video-card") || e[f].classList.contains("playlist-card"))) continue;
                        
                        var l = c(e[f]),
                            h = l.cx - o.cx,
                            d = l.cy - o.cy,
                            u = Math.sqrt(h * h + d * d),
                            v = !1;
                        switch (a.keyCode) {
                            case 37:
                                l.cx < o.cx && Math.abs(d) <= Math.abs(h) && (v = !0);
                                break;
                            case 38:
                                if (l.cy < o.cy) {
                                    if (e[f].id === "search-input" || e[f].id === "btn-search" || e[f].id === "cp-header" || e[f].id === "btn-channel-follow") {
                                        v = !0; // Relax horizontal constraint for wide search header / channel header / follow button
                                    } else if (Math.abs(h) <= Math.abs(d)) {
                                        v = !0;
                                    }
                                }
                                break;
                            case 39:
                                l.cx > o.cx && Math.abs(d) <= Math.abs(h) && (v = !0);
                                break;
                            case 40:
                                if (l.cy > o.cy) {
                                    if (o.id === "btn-channel-follow" || o.id === "cp-header") {
                                        v = !0; // Relax horizontal constraint when moving down from header / follow button
                                    } else if (Math.abs(h) <= Math.abs(d)) {
                                        v = !0;
                                    }
                                }
                                break;
                            case 13:
                                a.preventDefault();
                                if (!window._spatialOkIsDown) {
                                    window._spatialOkIsDown = true;
                                    window._spatialOkLongPressed = false;
                                    window._spatialOkTimer = setTimeout(function() {
                                        window._spatialOkLongPressed = true;
                                        var b = document.createEvent("CustomEvent");
                                        b.initCustomEvent("longpress", true, true, null);
                                        i.dispatchEvent(b);
                                    }, 1200);
                                }
                                return;
                        }
                        v && u < r && (r = u, s = f)
                    } 
                    if (s !== -1 && e[s].classList.contains("nav-item") && !i.classList.contains("nav-item")) {
                        for (var k = 0; k < e.length; k++) {
                            if (e[k].classList.contains("nav-item") && e[k].classList.contains("active")) {
                                s = k;
                                break;
                            }
                        }
                    }
                    - 1 !== s ? (a.preventDefault(), n(s)) : a.keyCode >= 37 && a.keyCode <= 40 && a.preventDefault()
            } else n(0)
        }
    }
    return {
        init: function () {
            a(), e.length > 0 && n(0), window.addEventListener("keydown", i);
            window.addEventListener("keypress", function(ev) {
                if (isLocked) {
                    ev.preventDefault();
                    return;
                }
                if (ev.keyCode === 13) ev.preventDefault();
            });
            window.addEventListener("keyup", function(ev) {
                if (isLocked) {
                    ev.preventDefault();
                    return;
                }
                if (ev.keyCode === 13) {
                    ev.preventDefault();
                    if (window._spatialOkIsDown) {
                        window._spatialOkIsDown = false;
                        if (window._spatialOkTimer) {
                            clearTimeout(window._spatialOkTimer);
                            window._spatialOkTimer = null;
                        }
                        if (!window._spatialOkLongPressed) {
                            var el = document.querySelector(".focusable.focused");
                            if (el) {
                                if (el.tagName === "INPUT") {
                                    el.focus();
                                    return;
                                }
                                if ("function" == typeof el.click) el.click();
                                else {
                                    var b = document.createEvent("MouseEvents");
                                    b.initEvent("click", !0, !0);
                                    el.dispatchEvent(b);
                                }
                            }
                        }
                    }
                }
            });
            document.addEventListener("mouseover", (function (a) {
                if (isLocked) return;
                for (var c = a.target; c && c !== document;) {
                    if (c.classList && c.classList.contains("focusable")) {
                        var i = e.indexOf(c); - 1 !== i && i !== t && n(i);
                        break;
                    }
                    c = c.parentNode;
                }
            }));
        },
        refresh: a,
        focusElement: n,
        focusNode: function(node) {
            var idx = e.indexOf(node);
            if (idx !== -1) n(idx);
        },
        lock: function() {
            isLocked = true;
        },
        unlock: function() {
            isLocked = false;
        },
        isLocked: function() {
            return isLocked;
        },
        clearFocus: clearFocus
    }
}();