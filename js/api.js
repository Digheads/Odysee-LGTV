// js/api.js
var OdyseeAPI = (function () {
    // CONFIGURATION:
    // Set to true for Emulator testing (uses local proxy to bypass SSL issues).
    // Set to false before running 'ares-package' for the physical LG TV!
    var USE_EMULATOR_PROXY = false;

    var BASE_URL = USE_EMULATOR_PROXY
        ? 'http://10.0.2.2:3000'
        : 'https://api.na-backend.odysee.com/api/v1/proxy';

    function request(method, params, callback) {
        console.log('OdyseeAPI: Starting request to ' + BASE_URL);
        var xhr = new XMLHttpRequest();
        xhr.open('POST', BASE_URL, true);
        xhr.setRequestHeader('Content-Type', 'application/json-rpc');

        xhr.timeout = 5000; // 5 seconds timeout
        xhr.ontimeout = function () {
            callback(new Error('Timeout: Nem érem el a ' + BASE_URL + ' címet az emulátorból!'));
        };

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        var response = JSON.parse(xhr.responseText);
                        if (response.error) {
                            callback(response.error);
                        } else {
                            callback(null, response.result);
                        }
                    } catch (e) {
                        callback(e);
                    }
                } else {
                    callback(new Error('Network error: ' + xhr.status));
                }
            }
        };

        xhr.send(JSON.stringify({
            method: method,
            params: params,
            jsonrpc: '2.0',
            id: Math.round(Math.random() * 1000000)
        }));
    }

    return {
        isProxyEnabled: USE_EMULATOR_PROXY,
        getTrending: function (callback) {
            request('claim_search', {
                any_tags: ["trending"],
                fee_amount: "<=0",
                claim_type: ["stream"],
                stream_types: ["video"],
                page_size: 20,
                order_by: ["trending_group", "trending_mixed"]
            }, callback);
        }
    };
})();
