// ---------------------------------------------------------------------------
// Stream & Playback Resolver for Odysee LGTV (ES5 compatible for webOS 2.0+)
// Resolves playable video URLs (v6 mp4 / v4 HLS) and reports Watchman telemetry.
// ---------------------------------------------------------------------------

var StreamResolver = (function () {
    // Setting this to true reverts to the v4 format (without extension).
    // Default is false (/v6/ .mp4) for webOS 2.0 pipeline compatibility.
    var USE_V4_HLS = false;

    // Cache for pre-warmed playable URLs with magic timestamp per claimId
    // magic=<unix_ts> is valid for 300 seconds on player.odycdn.com
    var magicCache = {};

    function getCachedMagicUrl(claimId) {
        var entry;
        var nowSec;

        if (!claimId || !magicCache[claimId]) {
            return null;
        }
        entry = magicCache[claimId];
        nowSec = (window.OdyseeAPI && typeof OdyseeAPI.getServerNowSec === 'function') ?
            OdyseeAPI.getServerNowSec() : Math.floor(new Date().getTime() / 1000);
        if (entry.expiresAt && nowSec < entry.expiresAt - 15) {
            return entry.url;
        }
        delete magicCache[claimId];
        return null;
    }

    function setCachedMagicUrl(claimId, url, createdAtSec) {
        var m;
        var ts;

        if (!claimId || !url) {
            return;
        }
        m = url.match(/[?&]magic=(\d+)/);
        ts = m ? parseInt(m[1], 10) : (createdAtSec || Math.floor(new Date().getTime() / 1000));
        magicCache[claimId] = {
            url: url,
            createdAt: ts,
            expiresAt: ts + 300
        };
    }

    function clearCachedMagicUrl(claimId) {
        if (claimId && magicCache[claimId]) {
            delete magicCache[claimId];
        }
    }

    // The URL of the transcoded HLS master playlist, built from the claim data.
    function buildHlsUrl(claim) {
        var c = (claim && claim.reposted_claim) || claim;
        var sd;

        if (!c) {
            return null;
        }
        sd = c.value && c.value.source ? c.value.source.sd_hash : '';
        if (!(c.name && c.claim_id && sd)) {
            return null;
        }
        return 'http://player.odycdn.com/api/v4/streams/tc/' +
            encodeURIComponent(c.name) + '/' + c.claim_id + '/' + sd + '/master.m3u8';
    }

    // The most compatible mp4 format: /v6/ endpoint, with .mp4 extension.
    function buildMp4Url(claim) {
        var c = (claim && claim.reposted_claim) || claim;
        var sd;

        if (!c) {
            return null;
        }
        sd = c.value && c.value.source ? c.value.source.sd_hash : '';
        if (!(c.claim_id && sd)) {
            return null;
        }
        return 'http://player.odycdn.com/v6/streams/' + c.claim_id + '/' + sd.substring(0, 6) + '.mp4';
    }

    function getStreamingSourceUrl(claimObj, cb) {
        var claim = (claimObj && claimObj.reposted_claim) || claimObj;
        var name;
        var cid;
        var sd;
        var blocked;
        var u;
        var uris;
        var idx;

        function attempt() {
            LbryRpc.call('get', {
                uri: uris[idx]
            }, function (err, res) {
                var n;

                if (!err && res && res.streaming_url) {
                    n = res.streaming_url.replace(/^https:/i, 'http:');
                    console.log('StreamResolver: Stream URL resolved: ' + n);
                    return cb(null, n);
                }
                idx += 1;
                if (idx < uris.length) {
                    console.log('StreamResolver: get failed, next URI form -> ' + uris[idx]);
                    return attempt();
                }
                cb(err || new Error('No streaming_url returned'));
            });
        }

        if (!claim) {
            return cb(new Error('Invalid claim object'));
        }

        name = claim.name;
        cid = claim.claim_id;
        sd = claim.value && claim.value.source ? claim.value.source.sd_hash : '';

        blocked = (window.ClaimFilter && typeof ClaimFilter.protectedReason === 'function') ?
            ClaimFilter.protectedReason(claim) : null;
        if (blocked) {
            return cb(new Error(blocked + ' The player cannot decode this.'));
        }

        if (name && cid && sd) {
            u = USE_V4_HLS ?
                'http://player.odycdn.com/api/v4/streams/free/' +
                encodeURIComponent(name) + '/' + cid + '/' + sd.substring(0, 6) :
                'http://player.odycdn.com/v6/streams/' + cid + '/' + sd.substring(0, 6) + '.mp4';
            console.log('StreamResolver: stream URL (' + (USE_V4_HLS ? 'v4' : 'v6') + '): ' + u);
            return cb(null, u);
        }

        // No sd_hash (e.g. livestream or incomplete claim) -> fallback to `get` RPC.
        console.log('StreamResolver: no sd_hash, fallback to get RPC');
        uris = [];
        if (claim.permanent_url) {
            uris.push(claim.permanent_url);
        }
        if (claim.canonical_url && uris.indexOf(claim.canonical_url) === -1) {
            uris.push(claim.canonical_url);
        }
        if (claim.short_url && uris.indexOf(claim.short_url) === -1) {
            uris.push(claim.short_url);
        }
        if (!uris.length) {
            return cb(new Error('No resolvable URI on claim'));
        }

        idx = 0;
        attempt();
    }

    function reportWatchmanPlayback(url, duration, position, relPosition, rebufCount, rebufDuration) {
        var payload = {
            url: url,
            device: 'stb',
            duration: Math.floor(duration || 0),
            protocol: url.indexOf('.m3u8') > -1 ? 'hls' : 'mp4',
            player: 'lgtv',
            user_id: '',
            position: Math.floor(position || 0),
            rel_position: Math.floor(relPosition || 0),
            rebuf_count: rebufCount || 0,
            rebuf_duration: rebufDuration || 0
        };

        if (window.LbryNet && typeof LbryNet.ensureAuthToken === 'function') {
            LbryNet.ensureAuthToken(function () {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', 'https://watchman.na-backend.odysee.com/reports/playback', true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(JSON.stringify(payload));
            });
        }
    }

    return {
        buildHlsUrl: buildHlsUrl,
        buildMp4Url: buildMp4Url,
        getStreamingSourceUrl: getStreamingSourceUrl,
        reportWatchmanPlayback: reportWatchmanPlayback,
        getCachedMagicUrl: getCachedMagicUrl,
        setCachedMagicUrl: setCachedMagicUrl,
        clearCachedMagicUrl: clearCachedMagicUrl
    };
}());
