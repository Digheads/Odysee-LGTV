// ---------------------------------------------------------------------------
// Odysee Comments / Commentron API Client
// (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var Comments = (function () {
    var COMMENTRON_URL = "https://comments.odysee.tv/api/v2";

    function list(claimId, page, callback) {
        if (!claimId) {
            if (callback) callback(new Error("No claimId provided"));
            return;
        }

        var payload = JSON.stringify({
            jsonrpc: "2.0",
            id: Math.floor(Math.random() * 1000000),
            method: "comment.List",
            params: {
                claim_id: claimId,
                page: page || 1,
                page_size: 25
            }
        });

        var xhr = new XMLHttpRequest();
        xhr.open("POST", COMMENTRON_URL, true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.timeout = 15000;

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        var res = JSON.parse(xhr.responseText);
                        if (res.error) {
                            if (callback) callback(new Error(res.error.message || "Commentron error"));
                        } else {
                            var result = res.result || {};
                            if (callback) callback(null, {
                                total_items: result.total_items || 0,
                                total_pages: result.total_pages || 0,
                                page: result.page || 1,
                                items: result.items || []
                            });
                        }
                    } catch (e) {
                        if (callback) callback(new Error("Failed to parse Commentron JSON"));
                    }
                } else {
                    if (callback) callback(new Error("Commentron HTTP error: " + xhr.status));
                }
            }
        };

        xhr.ontimeout = function () {
            if (callback) callback(new Error("Commentron timeout"));
        };
        xhr.onerror = function () {
            if (callback) callback(new Error("Commentron network error"));
        };

        xhr.send(payload);
    }

    return {
        list: list
    };
})();
