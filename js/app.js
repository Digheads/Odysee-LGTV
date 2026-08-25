// DEBUG CONSOLE OVERRIDE
(function () {
    var oldLog = console.log;
    var oldError = console.error;

    function appendToDOM(type, args) {
        var msg = Array.prototype.slice.call(args).map(function (a) {
            return typeof a === 'object' ? JSON.stringify(a) : a;
        }).join(' ');

        var consoleDiv = document.getElementById('debug-console');
        if (consoleDiv) {
            var line = document.createElement('div');
            line.style.color = type === 'error' ? '#f00' : '#0f0';
            line.style.marginBottom = '4px';
            line.style.borderBottom = '1px solid #333';
            line.style.wordWrap = 'break-word';
            var d = new Date();
            var timeStr = d.getHours() + ':' + d.getMinutes() + ':' + d.getSeconds() + '.' + d.getMilliseconds();
            line.textContent = '[' + timeStr + '] ' + type.toUpperCase() + ': ' + msg;
            consoleDiv.appendChild(line);
            consoleDiv.scrollTop = consoleDiv.scrollHeight;
        }
    }

    console.log = function () {
        appendToDOM('log', arguments);
        oldLog.apply(console, arguments);
    };

    console.error = function () {
        appendToDOM('error', arguments);
        oldError.apply(console, arguments);
    };

    window.onerror = function (message, source, lineno, colno, error) {
        console.error("Global Error: " + message + " at " + source + ":" + lineno);
    };
})();

document.addEventListener('DOMContentLoaded', function () {
    loadTrending();
    SpatialNavigation.init();

    var navItems = document.querySelectorAll('.nav-item');
    for (var i = 0; i < navItems.length; i++) {
        navItems[i].addEventListener('click', function () {
            for (var j = 0; j < navItems.length; j++) {
                navItems[j].classList.remove('active');
            }
            this.classList.add('active');

            var id = this.getAttribute('data-id');
            var pageTitle = document.getElementById('page-title');

            if (id === 'nav-home' || id === 'nav-trending') {
                pageTitle.innerText = id === 'nav-home' ? 'Home' : 'Trending';
                loadTrending();
            } else {
                pageTitle.innerText = 'Search';
                document.getElementById('video-grid').innerHTML = '<div style="color:white;text-align:center;width:100%;font-size:24px;margin-top:50px;">Search is not implemented yet.</div>';
                SpatialNavigation.refresh();
            }
        });
    }

});

function closePlayer() {
    var playerContainer = document.getElementById('player-container');
    var videoPlayer = document.getElementById('video-player');

    videoPlayer.pause();
    videoPlayer.innerHTML = '';
    videoPlayer.src = '';
    playerContainer.classList.add('hidden');
    SpatialNavigation.refresh();
}

function loadTrending() {
    var grid = document.getElementById('video-grid');
    var loading = document.getElementById('loading');

    grid.innerHTML = '';
    loading.style.display = 'block';

    OdyseeAPI.getTrending(function (err, result) {
        loading.style.display = 'none';

        if (err) {
            var errorMsg = err.message || (typeof err === 'string' ? err : JSON.stringify(err));
            grid.innerHTML = '<div class="error" style="padding: 20px; color: #ff5555; font-size: 24px;">Failed to load content. Error: ' + errorMsg + '</div>';
            console.error(err);
            SpatialNavigation.refresh();
            return;
        }

        if (result && result.items) {
            for (var i = 0; i < result.items.length; i++) {
                grid.appendChild(createVideoCard(result.items[i]));
            }
        }

        // Refresh navigation after adding elements
        SpatialNavigation.refresh();
    });
}

function createVideoCard(item) {
    if (!item.value) return null;

    var title = item.value.title || 'Untitled';
    var originalThumbnail = item.value.thumbnail ? item.value.thumbnail.url : '';

    // Automatically switch between Proxy and Direct based on the toggle in api.js
    var thumbnail = originalThumbnail;
    if (originalThumbnail) {
        if (OdyseeAPI.isProxyEnabled) {
            // Added cb (cache buster) to force emulator to re-download if it cached the broken images
            thumbnail = 'http://10.0.2.2:3000/image?url=' + encodeURIComponent(originalThumbnail) + '&cb=' + Date.now();
        } else {
            // WebOS 2.0 has limited WebP support. Use wsrv.nl to force JPEG format for better compatibility.
            thumbnail = 'https://wsrv.nl/?url=' + encodeURIComponent(originalThumbnail) + '&output=jpg&w=400';
        }
    }

    var channelName = item.signing_channel && item.signing_channel.value ? item.signing_channel.value.title : 'Unknown';

    var card = document.createElement('div');
    card.className = 'video-card focusable';
    card.innerHTML =
        '<div class="thumbnail-wrapper">' +
        '<div class="thumbnail" style="background-image: url(\'' + thumbnail + '\')"></div>' +
        '</div>' +
        '<div class="info">' +
        '<div class="title">' + title + '</div>' +
        '<div class="channel">' + channelName + '</div>' +
        '</div>';

    card.addEventListener('click', function () {
        playVideo(item);
    });

    return card;
}

function playVideo(item) {
    var name = item.name;
    var claimId = item.claim_id;
    var sdHash = item.value && item.value.source ? item.value.source.sd_hash : '';
    var apiDuration = item.value && item.value.video ? item.value.video.duration : 0;

    var playerContainer = document.getElementById('player-container');
    var videoPlayer = document.getElementById('video-player');

    videoPlayer.setAttribute('data-duration', apiDuration);
    videoPlayer.innerHTML = '';
    videoPlayer.src = '';

    // HLS is required for audio (Odysee transcodes audio to AAC in HLS).
    // Native player rejects original Odysee URL and blob: URLs.
    // hls.js crashes the hardware decoder ("media source closed").
    // We will attempt to fetch the m3u8 via AJAX, clean it up (downgrade to Version 3, absolute URLs),
    // and feed it to the native player using a data: URI.
    
    var baseUrl = 'http://player.odycdn.com/v6/streams/' + claimId + '/' + (sdHash ? sdHash.substring(0, 6) : '');
    var m3u8Url = baseUrl + '/v1.m3u8'; // Target 720p to be safe
    
    if (!sdHash) {
        console.error("No sd_hash, cannot construct HLS URL!");
        return;
    }
    
    console.log("Fetching M3U8 for data URI rewrite: " + m3u8Url);
    
    var xhr = new XMLHttpRequest();
    xhr.open('GET', m3u8Url, true);
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                var lines = xhr.responseText.split('\n');
                var newLines = [];
                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i].trim();
                    if (!line) continue;
                    
                    // Downgrade version and remove unsupported tags
                    if (line.indexOf('#EXT-X-VERSION:') === 0) {
                        newLines.push('#EXT-X-VERSION:3');
                    }
                    else if (line.indexOf('#EXT-X-INDEPENDENT-SEGMENTS') === 0) {
                        // Skip this tag
                    }
                    else if (line.indexOf('.ts') !== -1 && line.indexOf('http') !== 0) {
                        // Rewrite relative TS chunks to absolute HTTP URLs
                        newLines.push(baseUrl + '/' + line);
                    }
                    else {
                        newLines.push(line);
                    }
                }
                
                var cleanM3u8 = newLines.join('\n');
                console.log("Clean M3U8 created, length: " + cleanM3u8.length);
                
                // Base64 encode the playlist for data URI
                var base64M3u8 = btoa(unescape(encodeURIComponent(cleanM3u8)));
                var dataUri = 'data:application/vnd.apple.mpegurl;base64,' + base64M3u8;
                
                videoPlayer.innerHTML = '';
                videoPlayer.src = dataUri;
                playerContainer.classList.remove('hidden');
                videoPlayer.volume = 1.0;
                videoPlayer.muted = false;
                
                videoPlayer.onerror = function() {
                    console.error("Native Video Error Code with Data URI:", videoPlayer.error ? videoPlayer.error.code : "unknown");
                };
                
                videoPlayer.load();
                var p = videoPlayer.play();
                if (p && typeof p.catch === 'function') {
                    p.catch(function(e) { console.error("Play error:", e); });
                }
            } else {
                console.error("Failed to fetch M3U8. Status: " + xhr.status);
            }
        }
    };
    xhr.send();

    // Push state AFTER play to avoid dropping the user gesture token in old WebKit
    history.pushState({ playerOpen: true }, "player");

    // When player opens, focus the play/pause button
    setTimeout(function () {
        SpatialNavigation.refresh();
        var elements = document.querySelectorAll('.focusable');
        for (var i = 0; i < elements.length; i++) {
            if (elements[i].id === 'btn-play-pause') {
                SpatialNavigation.focusElement(i);
                break;
            }
        }
    }, 100);
}
document.addEventListener('DOMContentLoaded', function () {
    var videoPlayer = document.getElementById('video-player');
    var btnPlayPause = document.getElementById('btn-play-pause');
    var progressFill = document.getElementById('progress-fill');
    var timeDisplay = document.getElementById('time-display');
    var customControls = document.getElementById('custom-controls');

    // Listen to popstate for the Back button (WebOS standard way to prevent app exit)
    window.addEventListener('popstate', function (e) {
        if (!document.getElementById('player-container').classList.contains('hidden')) {
            // Close player instead of exiting app
            closePlayer();
        }
    });

    var controlsTimeout;

    function showControls() {
        customControls.classList.remove('fade-out');
        clearTimeout(controlsTimeout);
        controlsTimeout = setTimeout(function () {
            if (!videoPlayer.paused) {
                customControls.classList.add('fade-out');
            }
        }, 4000);
    }

    // Show controls on remote interaction
    window.addEventListener('keydown', function (e) {
        // If player is hidden, ignore media keys
        if (document.getElementById('player-container').classList.contains('hidden')) return;

        showControls();

        var keyCode = e.keyCode;
        var SEEK_AMOUNT = 10;

        // Media Play (415) / Pause (19) / PlayPause (179)
        if (keyCode === 415 || keyCode === 19 || keyCode === 179 || keyCode === 13) {
            // Allow OK button (13) to play/pause IF we don't have focus on a specific button
            if (keyCode === 13 && document.activeElement.tagName !== 'BUTTON') {
                btnPlayPause.click();
            } else if (keyCode !== 13) {
                btnPlayPause.click();
            }
        }
        // Rewind (412) or Left Arrow (37)
        else if (keyCode === 412 || keyCode === 37) {
            videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - SEEK_AMOUNT);
        }
        // FastForward (417) or Right Arrow (39)
        else if (keyCode === 417 || keyCode === 39) {
            // If duration is unknown (NaN), just seek forward anyway
            var maxTime = isNaN(videoPlayer.duration) ? videoPlayer.currentTime + SEEK_AMOUNT + 100 : videoPlayer.duration;
            videoPlayer.currentTime = Math.min(maxTime, videoPlayer.currentTime + SEEK_AMOUNT);
        }
        // Back Button (461 for WebOS, 8 for Backspace, 27 for Esc, 10009 for Return)
        else if (keyCode === 461 || keyCode === 8 || keyCode === 27 || keyCode === 10009) {
            // The popstate event handles the actual closing, but we still prevent default here just in case
            e.preventDefault();
        }
    });

    btnPlayPause.addEventListener('click', function () {
        if (videoPlayer.paused) {
            videoPlayer.play();
            btnPlayPause.innerHTML = '&#9632;'; // Stop / Square
        } else {
            videoPlayer.pause();
            btnPlayPause.innerHTML = '&#9654;'; // Play / Triangle
            showControls(); // Keep controls visible when paused
        }
    });

    videoPlayer.addEventListener('play', function () {
        btnPlayPause.innerHTML = '&#9632;'; // Stop / Square
        showControls();
    });

    videoPlayer.addEventListener('pause', function () {
        btnPlayPause.innerHTML = '&#9654;'; // Play / Triangle
        showControls();
    });

    videoPlayer.addEventListener('timeupdate', function () {
        var currentTime = videoPlayer.currentTime || 0;
        var duration = videoPlayer.duration;
        var apiDuration = parseFloat(videoPlayer.getAttribute('data-duration')) || 0;

        // If TV fails to calculate duration on proxied streams (NaN or Infinity), use Odysee API duration
        if (!duration || isNaN(duration) || duration === Infinity) {
            duration = apiDuration;
        }

        var percentage = 0;
        if (duration && !isNaN(duration) && duration > 0) {
            percentage = (currentTime / duration) * 100;
        }

        progressFill.style.width = percentage + '%';
        timeDisplay.textContent = formatTime(currentTime) + ' / ' + formatTime(duration);
    });

    function formatTime(seconds) {
        if (isNaN(seconds)) return "00:00";
        var m = Math.floor(seconds / 60);
        var s = Math.floor(seconds % 60);
        return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
    }
});
