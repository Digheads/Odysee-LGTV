// js/api.js
var OdyseeAPI = (function() {
    // Use local proxy for Emulator testing to bypass SSL issues.
    // Revert this to 'https://api.na-backend.odysee.com/api/v1/proxy' for production!
    var BASE_URL = 'http://192.168.56.1:3000';

    function request(method, params, callback) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', BASE_URL, true);
        xhr.setRequestHeader('Content-Type', 'application/json-rpc');
        
        xhr.onreadystatechange = function() {
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
        getTrending: function(callback) {
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
