const http = require('http');

class OllamaClient {
  constructor(host = 'localhost', port = '11434', model = 'llama3.2:3b') {
    this.host = host;
    this.port = port;
    this.model = model;
    this.available = false;
  }

  _request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.host,
        port: this.port,
        path,
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        timeout: 8000 // 8s socket timeout
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); }
            catch { resolve(data); }
          } else {
            resolve(null);
          }
        });
        // Also timeout waiting for response body
        let bodyTimeout = setTimeout(() => {
          req.destroy();
          resolve(null);
        }, 15000);
        res.on('end', () => clearTimeout(bodyTimeout));
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async init() {
    const result = await this._request('GET', '/api/tags');
    if (result && result.models) {
      this.available = result.models.some(m => m.name.startsWith(this.model));
      if (!this.available) {
        console.log(`[Ollama] Model ${this.model} not found, will try anyway`);
        this.available = true; // Try anyway
      }
    }
    return this.available;
  }

  async isAvailable() {
    const result = await this._request('GET', '/api/tags');
    return result && result.models;
  }

  async chat(message, systemPrompt = '') {
    const body = {
      model: this.model,
      prompt: message,
      system: systemPrompt,
      stream: false,
      options: { num_predict: 150, temperature: 0.7 }
    };

    const result = await this._request('POST', '/api/generate', body);
    if (result && result.response) {
      return result.response.trim();
    }
    return null;
  }
}

module.exports = OllamaClient;
