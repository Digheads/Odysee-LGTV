// js/app.js
document.addEventListener('DOMContentLoaded', function() {
    loadTrending();

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
                document.getElementById('video-grid').innerHTML = '<div style="padding: 20px; font-size: 24px;">Search coming soon...</div>';
                SpatialNavigation.refresh();
            }
        });
    }

    document.querySelector('.btn-close-player').addEventListener('click', function() {
        var playerContainer = document.getElementById('player-container');
        var videoPlayer = document.getElementById('video-player');
        videoPlayer.pause();
        videoPlayer.src = '';
        playerContainer.classList.add('hidden');
        SpatialNavigation.refresh();
    });
});

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
            SpatialNavigation.init();
            return;
        }

        var items = result.items || [];
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var card = createVideoCard(item);
            if (card) {
                grid.appendChild(card);
            }
        }
        
        // Initialize or refresh navigation after adding elements
        SpatialNavigation.init();
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
    var name = item.name;
    var claimId = item.claim_id;
    // Odysee direct streaming URL format
    var streamUrl = 'https://odysee.com/$/download/' + name + '/' + claimId;

    if (OdyseeAPI && OdyseeAPI.isProxyEnabled) {
        streamUrl = 'http://10.0.2.2:3000/video?url=' + encodeURIComponent(streamUrl);
    }

    var playerContainer = document.getElementById('player-container');
    var videoPlayer = document.getElementById('video-player');
    
    videoPlayer.src = streamUrl;
    playerContainer.classList.remove('hidden');
    
    // Autoplay fix for older WebKit
    videoPlayer.load();
    var playPromise = videoPlayer.play();
    if (playPromise !== undefined) {
        playPromise.catch(function(error) {
            console.log("Autoplay prevented:", error);
            // Sometimes it requires user interaction first
        });
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
        // Back Button (461)
        else if (keyCode === 461) {
            e.preventDefault();
            document.getElementById('btn-close-player').click();
        }
    });
    
    btnPlayPause.addEventListener('click', function() {
        if (videoPlayer.paused) {
            videoPlayer.play();
            btnPlayPause.innerHTML = '&#9209;'; // Stop / Square
        } else {
            videoPlayer.pause();
            btnPlayPause.innerHTML = '&#9654;'; // Play / Triangle
            showControls(); // Keep controls visible when paused
        }
    });
    
    videoPlayer.addEventListener('play', function() {
        btnPlayPause.innerHTML = '&#9209;'; // Stop / Square
        showControls();
    });
    
    videoPlayer.addEventListener('pause', function() {
        btnPlayPause.innerHTML = '&#9654;'; // Play / Triangle
        showControls();
    });
    
    videoPlayer.addEventListener('timeupdate', function() {
        if (!videoPlayer.duration) return;
        
        var percentage = (videoPlayer.currentTime / videoPlayer.duration) * 100;
        progressFill.style.width = percentage + '%';
        
        timeDisplay.textContent = formatTime(videoPlayer.currentTime) + ' / ' + formatTime(videoPlayer.duration);
    });
    
    function formatTime(seconds) {
        if (isNaN(seconds)) return "00:00";
        var m = Math.floor(seconds / 60);
        var s = Math.floor(seconds % 60);
        return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
    }
});
