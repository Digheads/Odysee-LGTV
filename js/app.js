document.addEventListener('DOMContentLoaded', function() {
    loadTrending();
    SpatialNavigation.init();

    var navItems = document.querySelectorAll('.nav-item');
    for (var i = 0; i < navItems.length; i++) {
        navItems[i].addEventListener('click', function() {
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
    videoPlayer.src = '';
    playerContainer.classList.add('hidden');
    SpatialNavigation.refresh();
}

function loadTrending() {
    var grid = document.getElementById('video-grid');
    var loading = document.getElementById('loading');
    
    grid.innerHTML = '';
    loading.style.display = 'block';

    OdyseeAPI.getTrending(function(err, result) {
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
    if (OdyseeAPI.isProxyEnabled && originalThumbnail) {
        // Added cb (cache buster) to force emulator to re-download if it cached the broken images
        thumbnail = 'http://10.0.2.2:3000/image?url=' + encodeURIComponent(originalThumbnail) + '&cb=' + Date.now();
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
    
    card.addEventListener('click', function() {
        playVideo(item);
    });

    return card;
}

function playVideo(item) {
    // Push state to browser history BEFORE setting video src so the TV's Back button doesn't close the app
    // Doing this right before video.play() cancels the autoplay in old WebKit
    history.pushState({playerOpen: true}, "player");

    var name = item.name;
    var claimId = item.claim_id;
    var apiDuration = item.value && item.value.video ? item.value.video.duration : 0;
    // Odysee direct streaming URL format
    var streamUrl = 'https://odysee.com/$/download/' + name + '/' + claimId;

    if (OdyseeAPI && OdyseeAPI.isProxyEnabled) {
        streamUrl = 'http://10.0.2.2:3000/video?url=' + encodeURIComponent(streamUrl);
    }

    var playerContainer = document.getElementById('player-container');
    var videoPlayer = document.getElementById('video-player');
    
    // Store API duration in the DOM so timeupdate can use it if the browser fails to calculate it
    videoPlayer.setAttribute('data-duration', apiDuration);
    
    videoPlayer.src = streamUrl;
    playerContainer.classList.remove('hidden');
    
    videoPlayer.load();
    
    // Robust autoplay for older WebKit: wait for canplay event
    var attemptPlay = function() {
        var playPromise = videoPlayer.play();
        if (playPromise !== undefined) {
            playPromise.catch(function(error) {
                console.log("Autoplay prevented:", error);
            });
        }
        videoPlayer.removeEventListener('canplay', attemptPlay);
    };
    videoPlayer.addEventListener('canplay', attemptPlay);
    
    // Also try playing immediately just in case it's already cached or canplay doesn't fire
    var initialPlayPromise = videoPlayer.play();
    if (initialPlayPromise !== undefined) {
        initialPlayPromise.catch(function(e) {});
    }
    
    // When player opens, focus the play/pause button
    setTimeout(function() {
        SpatialNavigation.refresh();
        // Find the play/pause button index
        var elements = document.querySelectorAll('.focusable');
        for (var i = 0; i < elements.length; i++) {
            if (elements[i].id === 'btn-play-pause') {
                SpatialNavigation.focusElement(i);
                break;
            }
        }
    }, 100);
}

// Video Player UI Logic
document.addEventListener('DOMContentLoaded', function() {
    var videoPlayer = document.getElementById('video-player');
    var btnPlayPause = document.getElementById('btn-play-pause');
    var progressFill = document.getElementById('progress-fill');
    var timeDisplay = document.getElementById('time-display');
    var customControls = document.getElementById('custom-controls');
    
    // Listen to popstate for the Back button (WebOS standard way to prevent app exit)
    window.addEventListener('popstate', function(e) {
        if (!document.getElementById('player-container').classList.contains('hidden')) {
            // Close player instead of exiting app
            closePlayer();
        }
    });
    
    var controlsTimeout;
    
    function showControls() {
        customControls.classList.remove('fade-out');
        clearTimeout(controlsTimeout);
        controlsTimeout = setTimeout(function() {
            if (!videoPlayer.paused) {
                customControls.classList.add('fade-out');
            }
        }, 4000);
    }
    
    // Show controls on remote interaction
    window.addEventListener('keydown', function(e) {
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
    
    btnPlayPause.addEventListener('click', function() {
        if (videoPlayer.paused) {
            videoPlayer.play();
            btnPlayPause.innerHTML = '&#9632;'; // Stop / Square
        } else {
            videoPlayer.pause();
            btnPlayPause.innerHTML = '&#9654;'; // Play / Triangle
            showControls(); // Keep controls visible when paused
        }
    });
    
    videoPlayer.addEventListener('play', function() {
        btnPlayPause.innerHTML = '&#9632;'; // Stop / Square
        showControls();
    });
    
    videoPlayer.addEventListener('pause', function() {
        btnPlayPause.innerHTML = '&#9654;'; // Play / Triangle
        showControls();
    });
    
    videoPlayer.addEventListener('timeupdate', function() {
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
