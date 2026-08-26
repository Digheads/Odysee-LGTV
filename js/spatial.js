var SpatialNavigation = function () {
    var e = [],
        t = -1;

    function a() {
        var a = document.querySelectorAll(".focusable");
        e = [];
        for (var c = 0; c < a.length; c++) null !== a[c].offsetParent && e.push(a[c]);
        (t >= e.length || t >= 0 && -1 === e.indexOf(e[t])) && e.length > 0 && n(0)
    }

    function n(a) {
        if (t >= 0 && e[t] && e[t].classList.remove("focused"), e[t = a]) {
            e[t].classList.add("focused");
            var n = e[t];
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
                    i < 0 && (i = 0), c.scrollTop = i
                }
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
        if (0 !== e.length) {
            var i = e[t];
            if (i) {
                if (a.keyCode === 39 && i.classList.contains("nav-item")) {
                    for (var k = 0; k < e.length; k++) {
                        if (e[k].classList.contains("video-card") || e[k].id === "search-input" || e[k].id === "btn-search") {
                            a.preventDefault();
                            n(k);
                            return;
                        }
                    }
                }
                for (var o = c(i), s = -1, r = 1 / 0, f = 0; f < e.length; f++)
                    if (f !== t) {
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
                                l.cy < o.cy && Math.abs(h) <= Math.abs(d) && (v = !0);
                                break;
                            case 39:
                                l.cx > o.cx && Math.abs(d) <= Math.abs(h) && (v = !0);
                                break;
                            case 40:
                                l.cy > o.cy && Math.abs(h) <= Math.abs(d) && (v = !0);
                                break;
                            case 13:
                                if ("function" == typeof i.click) i.click();
                                else {
                                    var b = document.createEvent("MouseEvents");
                                    b.initEvent("click", !0, !0), i.dispatchEvent(b)
                                }
                                return
                        }
                        v && u < r && (r = u, s = f)
                    } - 1 !== s ? (a.preventDefault(), n(s)) : a.keyCode >= 37 && a.keyCode <= 40 && a.preventDefault()
            } else n(0)
        }
    }
    return {
        init: function () {
            a(), e.length > 0 && n(0), window.addEventListener("keydown", i), document.addEventListener("mouseover", (function (a) {
                for (var c = a.target; c && c !== document;) {
                    if (c.classList && c.classList.contains("focusable")) {
                        var i = e.indexOf(c); - 1 !== i && i !== t && n(i);
                        break
                    }
                    c = c.parentNode
                }
            }))
        },
        refresh: a,
        focusElement: n,
        focusNode: function(node) {
            var idx = e.indexOf(node);
            if (idx !== -1) n(idx);
        }
    }
}();