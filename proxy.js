const http = require('http');
const https = require('https');

const PORT = 3000;
const TARGET_URL = 'https://api.na-backend.odysee.com/api/v1/proxy';

const server = http.createServer((req, res) => {
    console.log(`[${new Date().toLocaleTimeString()}] Incoming ${req.method} request to proxy...`);
    
    // Enable CORS for the emulator
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method === 'GET' && req.url.startsWith('/video?url=')) {
        const targetUrl = decodeURIComponent(req.url.replace('/video?url=', ''));
        console.log(`[➔] Fetching Video: ${targetUrl}`);
        
        function fetchVideoWithRedirect(fetchUrl, redirectCount = 0) {
            if (redirectCount > 3) {
                res.writeHead(500);
                res.end('Too many redirects');
                return;
            }

            const protocol = fetchUrl.startsWith('https') ? https : http;
            
            // Forward the Range header to support seeking!
            const options = { headers: {} };
            if (req.headers['range']) {
                options.headers['Range'] = req.headers['range'];
                console.log(`[➔] Forwarding Range: ${req.headers['range']}`);
            }
            
            protocol.get(fetchUrl, options, (vidRes) => {
                if (vidRes.statusCode >= 300 && vidRes.statusCode < 400 && vidRes.headers.location) {
                    console.log(`[➔] Redirecting Video to: ${vidRes.headers.location}`);
                    const newUrl = vidRes.headers.location.startsWith('http') 
                        ? vidRes.headers.location 
                        : new URL(vidRes.headers.location, fetchUrl).href;
                    fetchVideoWithRedirect(newUrl, redirectCount + 1);
                    return;
                }

                const headers = {
                    'Access-Control-Allow-Origin': '*'
                };
                
                // Copy all important response headers back to the TV
                ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(h => {
                    if (vidRes.headers[h]) headers[h] = vidRes.headers[h];
                });

                res.writeHead(vidRes.statusCode, headers);
                vidRes.pipe(res);
            }).on('error', (e) => {
                console.error(`[✘] Video Proxy error: ${e.message}`);
                res.writeHead(500);
                res.end();
            });
        }

        fetchVideoWithRedirect(targetUrl);
        return;
    }

    if (req.method === 'GET' && req.url.startsWith('/image?url=')) {
        // Strip out the cache buster (&cb=...) if present before decoding
        const urlParam = req.url.replace('/image?url=', '').split('&cb=')[0];
        const originalUrl = decodeURIComponent(urlParam);
        // Force conversion to JPEG using wsrv.nl to bypass WebOS 2.0 WebP decoding bugs
        const targetUrl = `https://wsrv.nl/?url=${encodeURIComponent(originalUrl)}&output=jpg`;
        console.log(`[➔] Fetching Image via wsrv.nl: ${originalUrl}`);
        
        function fetchImageWithRedirect(fetchUrl, redirectCount = 0) {
            if (redirectCount > 3) {
                console.error(`[✘] Image Proxy error: Too many redirects`);
                res.writeHead(500);
                res.end();
                return;
            }

            const protocol = fetchUrl.startsWith('https') ? https : http;
            
            protocol.get(fetchUrl, (imgRes) => {
                if (imgRes.statusCode >= 300 && imgRes.statusCode < 400 && imgRes.headers.location) {
                    console.log(`[➔] Redirecting to: ${imgRes.headers.location}`);
                    // Handle relative redirects
                    const newUrl = imgRes.headers.location.startsWith('http') 
                        ? imgRes.headers.location 
                        : new URL(imgRes.headers.location, fetchUrl).href;
                    fetchImageWithRedirect(newUrl, redirectCount + 1);
                    return;
                }

                imgRes.once('data', (chunk) => {
                    let contentType = 'image/jpeg'; // Default fallback
                    if (chunk.length >= 4) {
                        const hex = chunk.slice(0, 4).toString('hex');
                        if (hex === '52494646') contentType = 'image/webp'; // RIFF (WebP)
                        else if (hex === '89504e47') contentType = 'image/png';
                        else if (hex.startsWith('ffd8')) contentType = 'image/jpeg';
                    }

                    const headers = {
                        'Content-Type': imgRes.headers['content-type'] || contentType,
                        'Access-Control-Allow-Origin': '*'
                    };
                    if (imgRes.headers['content-length']) {
                        headers['Content-Length'] = imgRes.headers['content-length'];
                    }
                    
                    res.writeHead(imgRes.statusCode, headers);
                    res.write(chunk);
                    imgRes.pipe(res);
                });
            }).on('error', (e) => {
                console.error(`[✘] Image Proxy error: ${e.message}`);
                res.writeHead(500);
                res.end();
            });
        }

        fetchImageWithRedirect(targetUrl);
        return;
    }

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const jsonBody = JSON.parse(body);
                console.log(`[➔] Odysee Method: ${jsonBody.method}`);
            } catch (e) {
                console.log(`[➔] Body length: ${body.length} bytes`);
            }

            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json-rpc',
                    'Content-Length': Buffer.byteLength(body)
                }
            };

            const proxyReq = https.request(TARGET_URL, options, (proxyRes) => {
                console.log(`[✔] Response from Odysee: ${proxyRes.statusCode}`);
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(res, { end: true });
            });

            proxyReq.on('error', (e) => {
                console.error(`[✘] Proxy error: ${e.message}`);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Proxy error' }));
            });

            proxyReq.write(body);
            proxyReq.end();
        });
    } else if (req.method !== 'GET') {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(PORT, () => {
    console.log(`LG TV Emulator Proxy is running on http://localhost:${PORT}`);
    console.log(`In the emulator, requests to http://10.0.2.2:${PORT} will be forwarded to Odysee.`);
});
