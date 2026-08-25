// js/api.js
var OdyseeAPI = (function() {
    var BASE_URL = 'https://api.na-backend.odysee.com/api/v1/proxy';

    function request(method, params) {
        return new Promise(function(resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', BASE_URL, true);
            xhr.setRequestHeader('Content-Type', 'application/json-rpc');
            
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        try {
                            var response = JSON.parse(xhr.responseText);
                            if (response.error) {
                                reject(response.error);
                            } else {
                                resolve(response.result);
                            }
                        } catch (e) {
                            reject(e);
                        }
                    } else {
                        reject(new Error('Network error: ' + xhr.status));
                    }
                }
            };
            
            xhr.send(JSON.stringify({
                method: method,
                params: params,
                jsonrpc: '2.0',
                id: Math.round(Math.random() * 1000000)
            }));
        });
    }

    return {
        getTrending: function() {
            return request('claim_search', {
                any_tags: ["trending"],
                fee_amount: "<=0",
                claim_type: ["stream"],
                stream_types: ["video"],
                page_size: 20,
                order_by: ["trending_group", "trending_mixed"]
            });
        }
    };
})();
