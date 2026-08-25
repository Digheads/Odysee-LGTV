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
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(PORT, () => {
    console.log(`LG TV Emulator Proxy is running on http://localhost:${PORT}`);
    console.log(`In the emulator, requests to http://10.0.2.2:${PORT} will be forwarded to Odysee.`);
});
