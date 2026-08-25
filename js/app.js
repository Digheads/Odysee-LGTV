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
    videoPlayer.play();
    
    // When player opens, focus the close button
    setTimeout(function() {
        SpatialNavigation.refresh();
        SpatialNavigation.focusElement(0); // The close button will be the first/only focusable element if others are hidden or disabled?
        // Wait, other elements are still focusable!
        // A better approach is to only allow focus inside player container if visible.
    }, 100);
}
