const { parentPort, workerData } = require('worker_threads');
const https = require('https');
const http = require('http');

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });

const { sab } = workerData;
const int32 = new Int32Array(sab);

parentPort.on('message', ({ url, options = {} }) => {
  try {
    const target = new URL(url);
    const isHttps = target.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;
    const method = (options.method || 'GET').toUpperCase();
    const headers = options.headers || {};

    const req = client.request(url, {
      method,
      headers,
      agent,
      timeout: 15000
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const maxLen = sab.byteLength - 16;
        const copyLen = Math.min(body.length, maxLen);
        body.copy(Buffer.from(sab), 16, 0, copyLen);
        int32[1] = copyLen;
        int32[2] = res.statusCode;
        Atomics.store(int32, 0, 1);
        Atomics.notify(int32, 0, 1);
      });
    });

    req.on('error', err => {
      const msg = Buffer.from(err.message || 'Network error');
      msg.copy(Buffer.from(sab), 16);
      int32[1] = msg.length;
      int32[2] = 502;
      Atomics.store(int32, 0, 1);
      Atomics.notify(int32, 0, 1);
    });

    req.on('timeout', () => {
      req.destroy();
      int32[1] = 0;
      int32[2] = 504;
      Atomics.store(int32, 0, 1);
      Atomics.notify(int32, 0, 1);
    });

    if (options.payload) {
      req.write(typeof options.payload === 'string' ? options.payload : JSON.stringify(options.payload));
    }
    req.end();
  } catch (err) {
    int32[1] = 0;
    int32[2] = 500;
    Atomics.store(int32, 0, 1);
    Atomics.notify(int32, 0, 1);
  }
});
