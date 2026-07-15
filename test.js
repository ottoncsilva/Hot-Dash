const https = require('https');

https.get('https://api.x.ai/v1/models', { headers: { 'Authorization': 'Bearer 123' } }, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => console.log(`BODY: ${body}`));
}).on('error', (e) => {
  console.error(`ERROR: ${e.message}`);
});
