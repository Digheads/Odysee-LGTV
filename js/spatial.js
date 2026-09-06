var SpatialNavigation = (function () {
    var focusableElements = [];
    var focusedIndex = -1;
    var lastFocusedEl = null;
    var isLocked = false;
    var okIsDown = false;
    var okLongPressed = false;
    var okTimer = null;

    function refresh() {
        var elements = document.querySelectorAll('.focusable');
        var c;

        focusableElements = [];
        for (c = 0; c < elements.length; c++) {
            if (elements[c].offsetParent !== null) {
                focusableElements.push(elements[c]);
            }
        }
        if (!isLocked) {
            if ((focusedIndex >= focusableElements.length || (focusedIndex >= 0 && focusableElements.indexOf(lastFocusedEl) === -1)) && focusableElements.length > 0) {
                focusElement(0);
            }
        } else if (lastFocusedEl && focusableElements.indexOf(lastFocusedEl) === -1) {
            if (lastFocusedEl.classList) {
                lastFocusedEl.classList.remove('focused');
            }
            lastFocusedEl = null;
            focusedIndex = -1;
        }
    }

    function clearFocus() {
        var allFocused;
        var f;

        if (lastFocusedEl && lastFocusedEl.classList) {
            lastFocusedEl.classList.remove('focused');
        }
        lastFocusedEl = null;
        allFocused = document.querySelectorAll('.focused');
        for (f = 0; f < allFocused.length; f++) {
            allFocused[f].classList.remove('focused');
        }
        focusedIndex = -1;
    }

    function focusElement(index) {
        var targetEl;
        var navParent;
        var scrollOffset;
        var mainContent;
        var targetScroll;

        if (lastFocusedEl && lastFocusedEl.classList) {
            lastFocusedEl.classList.remove('focused');
        }
        focusedIndex = index;
        targetEl = focusableElements[focusedIndex];
        if (targetEl) {
            targetEl.classList.add('focused');
            lastFocusedEl = targetEl;
            if (document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement !== targetEl) {
                document.activeElement.blur();
            }
            if (targetEl.classList.contains('nav-item')) {
                navParent = targetEl.parentNode;
                if (navParent && navParent.scrollHeight > navParent.clientHeight) {
                    scrollOffset = targetEl.offsetTop - navParent.clientHeight / 2;
                    if (scrollOffset < 0) {
                        scrollOffset = 0;
                    }
                    navParent.scrollTop = scrollOffset;
                }
            }
            if (targetEl.classList.contains('video-card')) {
                mainContent = document.getElementById('main-content');
                if (mainContent) {
                    targetScroll = targetEl.offsetTop - 150;
                    if (targetScroll < 0) {
                        targetScroll = 0;
                    }
                    if (Math.abs(mainContent.scrollTop - targetScroll) > 20) {
                        mainContent.scrollTop = targetScroll;
                    }
                }
            }
            if (targetEl.classList.contains('channel-header') || targetEl.id === 'btn-channel-follow' || targetEl.classList.contains('btn-channel-follow')) {
                mainContent = document.getElementById('main-content');
                if (mainContent) {
                    mainContent.scrollTop = 0;
                }
            }
        }
    }

    function getRect(el) {
        var rect = el.getBoundingClientRect();
        return {
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            cx: rect.left + rect.width / 2,
            cy: rect.top + rect.height / 2
        };
    }

    function handleKeyDown(e) {
        var currentEl;
        var override;
        var target;
        var targetIdx;
        var followBtn;
        var followIdx;
        var cpHeader;
        var cpIdx;
        var k;
        var isVideoCard;
        var isChannelHeader;
        var originRect;
        var bestIndex;
        var minDistance;
        var f;
        var candidateEl;
        var candidateRect;
        var dx;
        var dy;
        var dist;
        var isValid;

        if (isLocked) {
            if ((e.keyCode >= 37 && e.keyCode <= 40) || e.keyCode === 13) {
                e.preventDefault();
                return;
            }
        }
        if (focusableElements.length === 0) {
            return;
        }

        currentEl = focusableElements[focusedIndex];
        if (!currentEl) {
            focusElement(0);
            return;
        }

        if (e.keyCode >= 37 && e.keyCode <= 40) {
            override = null;
            if (e.keyCode === 37) {
                override = currentEl.getAttribute('data-sn-left');
            } else if (e.keyCode === 38) {
                override = currentEl.getAttribute('data-sn-up');
            } else if (e.keyCode === 39) {
                override = currentEl.getAttribute('data-sn-right');
            } else if (e.keyCode === 40) {
                override = currentEl.getAttribute('data-sn-down');
            }

            if (override) {
                target = document.querySelector(override);
                if (target) {
                    targetIdx = focusableElements.indexOf(target);
                    if (targetIdx !== -1) {
                        e.preventDefault();
                        focusElement(targetIdx);
                        return;
                    }
                }
            }
        }

        if (e.keyCode === 39 && currentEl.classList.contains('nav-item')) {
            if (window.isChannelPageOpen) {
                followBtn = document.getElementById('btn-channel-follow');
                if (followBtn && followBtn.style.display !== 'none' && followBtn.classList.contains('focusable')) {
                    followIdx = focusableElements.indexOf(followBtn);
                    if (followIdx !== -1) {
                        e.preventDefault();
                        focusElement(followIdx);
                        return;
                    }
                }
                cpHeader = document.getElementById('cp-header');
                if (cpHeader && cpHeader.classList.contains('focusable')) {
                    cpIdx = focusableElements.indexOf(cpHeader);
                    if (cpIdx !== -1) {
                        e.preventDefault();
                        focusElement(cpIdx);
                        return;
                    }
                }
            }
            for (k = 0; k < focusableElements.length; k++) {
                if (focusableElements[k].classList.contains('video-card') ||
                    focusableElements[k].classList.contains('playlist-card') ||
                    focusableElements[k].id === 'search-input' ||
                    focusableElements[k].id === 'btn-search' ||
                    (focusableElements[k].id === 'cp-header' && focusableElements[k].classList.contains('focusable')) ||
                    (focusableElements[k].id === 'btn-channel-follow' && focusableElements[k].style.display !== 'none')) {
                    e.preventDefault();
                    focusElement(k);
                    return;
                }
            }
        }

        isVideoCard = currentEl.classList.contains('video-card') || currentEl.classList.contains('playlist-card');
        isChannelHeader = currentEl.id === 'cp-header' || currentEl.classList.contains('channel-header') || currentEl.id === 'btn-channel-follow' || currentEl.classList.contains('btn-channel-follow');
        originRect = getRect(currentEl);
        bestIndex = -1;
        minDistance = Infinity;

        for (f = 0; f < focusableElements.length; f++) {
            if (f !== focusedIndex) {
                candidateEl = focusableElements[f];
                if (isVideoCard && (e.keyCode === 37 || e.keyCode === 39) && (candidateEl.id === 'search-input' || candidateEl.id === 'btn-search')) {
                    continue;
                }
                if (isVideoCard && e.keyCode !== 37 && candidateEl.classList.contains('nav-item')) {
                    continue;
                }
                if (isChannelHeader && e.keyCode === 37 && (candidateEl.classList.contains('video-card') || candidateEl.classList.contains('playlist-card'))) {
                    continue;
                }

                candidateRect = getRect(candidateEl);
                dx = candidateRect.cx - originRect.cx;
                dy = candidateRect.cy - originRect.cy;
                dist = Math.sqrt(dx * dx + dy * dy);
                isValid = false;

                switch (e.keyCode) {
                    case 37:
                        if (candidateRect.cx < originRect.cx && Math.abs(dy) <= Math.abs(dx)) {
                            isValid = true;
                        }
                        break;
                    case 38:
                        if (candidateRect.cy < originRect.cy) {
                            if (candidateEl.id === 'search-input' || candidateEl.id === 'btn-search' || candidateEl.id === 'cp-header' || candidateEl.id === 'btn-channel-follow') {
                                isValid = true;
                            } else if (Math.abs(dx) <= Math.abs(dy)) {
                                isValid = true;
                            }
                        }
                        break;
                    case 39:
                        if (candidateRect.cx > originRect.cx && Math.abs(dy) <= Math.abs(dx)) {
                            isValid = true;
                        }
                        break;
                    case 40:
                        if (candidateRect.cy > originRect.cy) {
                            if (currentEl.id === 'btn-channel-follow' || currentEl.id === 'cp-header') {
                                isValid = true;
                            } else if (Math.abs(dx) <= Math.abs(dy)) {
                                isValid = true;
                            }
                        }
                        break;
                    case 13:
                        e.preventDefault();
                        if (!okIsDown) {
                            okIsDown = true;
                            okLongPressed = false;
                            okTimer = setTimeout(function () {
                                var b;
                                okLongPressed = true;
                                b = document.createEvent('CustomEvent');
                                b.initCustomEvent('longpress', true, true, null);
                                currentEl.dispatchEvent(b);
                            }, 1200);
                        }
                        return;
                    default:
                        break;
                }
                if (isValid && dist < minDistance) {
                    minDistance = dist;
                    bestIndex = f;
                }
            }
        }

        if (bestIndex !== -1 && focusableElements[bestIndex].classList.contains('nav-item') && !currentEl.classList.contains('nav-item')) {
            for (k = 0; k < focusableElements.length; k++) {
                if (focusableElements[k].classList.contains('nav-item') && focusableElements[k].classList.contains('active')) {
                    bestIndex = k;
                    break;
                }
            }
        }

        if (bestIndex !== -1) {
            e.preventDefault();
            focusElement(bestIndex);
        } else if (e.keyCode >= 37 && e.keyCode <= 40) {
            e.preventDefault();
        }
    }

    return {
        init: function () {
            refresh();
            if (focusableElements.length > 0) {
                focusElement(0);
            }
            window.addEventListener('keydown', handleKeyDown);
            window.addEventListener('keypress', function (ev) {
                if (isLocked) {
                    ev.preventDefault();
                    return;
                }
                if (ev.keyCode === 13) {
                    ev.preventDefault();
                }
            });
            window.addEventListener('keyup', function (ev) {
                var el;
                var b;

                if (isLocked) {
                    ev.preventDefault();
                    return;
                }
                if (ev.keyCode === 13) {
                    ev.preventDefault();
                    if (okIsDown) {
                        okIsDown = false;
                        if (okTimer) {
                            clearTimeout(okTimer);
                            okTimer = null;
                        }
                        if (!okLongPressed) {
                            el = document.querySelector('.focusable.focused');
                            if (el) {
                                if (el.tagName === 'INPUT') {
                                    el.focus();
                                    return;
                                }
                                if (typeof el.click === 'function') {
                                    el.click();
                                } else {
                                    b = document.createEvent('MouseEvents');
                                    b.initEvent('click', true, true);
                                    el.dispatchEvent(b);
                                }
                            }
                        }
                    }
                }
            });
            document.addEventListener('mouseover', function (ev) {
                var target;
                var idx;

                if (isLocked) {
                    return;
                }
                for (target = ev.target; target && target !== document; target = target.parentNode) {
                    if (target.classList && target.classList.contains('focusable')) {
                        idx = focusableElements.indexOf(target);
                        if (idx !== -1 && idx !== focusedIndex) {
                            focusElement(idx);
                        }
                        break;
                    }
                }
            });
        },
        refresh: refresh,
        focusElement: focusElement,
        focusNode: function (node) {
            var idx = focusableElements.indexOf(node);
            if (idx !== -1) {
                focusElement(idx);
            }
        },
        lock: function () {
            isLocked = true;
        },
        unlock: function () {
            isLocked = false;
        },
        isLocked: function () {
            return isLocked;
        },
        isLongPressed: function () {
            return okLongPressed;
        },
        clearFocus: clearFocus
    };
}());