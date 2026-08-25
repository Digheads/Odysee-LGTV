// js/spatial.js
var SpatialNavigation = (function() {
    var focusableElements = [];
    var currentFocusedIndex = -1;

    function init() {
        refresh();
        if (focusableElements.length > 0) {
            focusElement(0);
        }

        window.addEventListener('keydown', handleKeyDown);
    }

    function refresh() {
        var elements = document.querySelectorAll('.focusable');
        focusableElements = [];
        for (var i = 0; i < elements.length; i++) {
            if (elements[i].offsetParent !== null) { // only if visible
                focusableElements.push(elements[i]);
            }
        }
        
        // If current element disappeared, fallback to index 0
        if (currentFocusedIndex >= focusableElements.length || 
            (currentFocusedIndex >= 0 && focusableElements.indexOf(focusableElements[currentFocusedIndex]) === -1)) {
            if (focusableElements.length > 0) {
                focusElement(0);
            }
        }
    }

    function focusElement(index) {
        if (currentFocusedIndex >= 0 && focusableElements[currentFocusedIndex]) {
            focusableElements[currentFocusedIndex].classList.remove('focused');
        }
        currentFocusedIndex = index;
        if (focusableElements[currentFocusedIndex]) {
            focusableElements[currentFocusedIndex].classList.add('focused');
            
            // Handle scrolling nicely
            var el = focusableElements[currentFocusedIndex];
            if (el.classList.contains('video-card')) {
                var container = document.getElementById('main-content');
                if (container) {
                    var targetScroll = el.offsetTop - 150;
                    if (targetScroll < 0) targetScroll = 0;
                    container.scrollTop = targetScroll;
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
        if (focusableElements.length === 0) return;
        var current = focusableElements[currentFocusedIndex];
        if (!current) {
            focusElement(0);
            return;
        }

        var currentRect = getRect(current);
        var bestIndex = -1;
        var minDistance = Infinity;

        for (var i = 0; i < focusableElements.length; i++) {
            if (i === currentFocusedIndex) continue;
            var target = focusableElements[i];
            var targetRect = getRect(target);
            var dx = targetRect.cx - currentRect.cx;
            var dy = targetRect.cy - currentRect.cy;
            var distance = Math.sqrt(dx * dx + dy * dy);
            
            var isValidDirection = false;
            switch(e.keyCode) {
                case 37: // Left
                    if (targetRect.cx < currentRect.cx && Math.abs(dy) <= Math.abs(dx)) isValidDirection = true;
                    break;
                case 38: // Up
                    if (targetRect.cy < currentRect.cy && Math.abs(dx) <= Math.abs(dy)) isValidDirection = true;
                    break;
                case 39: // Right
                    if (targetRect.cx > currentRect.cx && Math.abs(dy) <= Math.abs(dx)) isValidDirection = true;
                    break;
                case 40: // Down
                    if (targetRect.cy > currentRect.cy && Math.abs(dx) <= Math.abs(dy)) isValidDirection = true;
                    break;
                case 13: // Enter
                    if (typeof current.click === 'function') {
                        current.click();
                    } else {
                        var ev = document.createEvent('MouseEvents');
                        ev.initEvent('click', true, true);
                        current.dispatchEvent(ev);
                    }
                    return;
            }

            if (isValidDirection && distance < minDistance) {
                minDistance = distance;
                bestIndex = i;
            }
        }

        if (bestIndex !== -1) {
            e.preventDefault();
            focusElement(bestIndex);
        } else if (e.keyCode >= 37 && e.keyCode <= 40) {
            // Prevent scrolling on edge
            e.preventDefault();
        }
    }

    return {
        init: init,
        refresh: refresh,
        focusElement: focusElement
    };
})();
