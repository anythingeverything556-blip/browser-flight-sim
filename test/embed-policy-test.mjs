import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allowedOrigins, embedResponse, SECURITY_HEADERS } from '../functions/_lib/embed-policy.js';
for (const input of [undefined, '', 'null', '{}', '[]', '["*"]', '["https://foo;bar"]', '["https://foo,bar"]', '["https://foo\'bar"]', '["https://*.example.com"]', '["http://example.com"]', '["https://example.com/"]', '["https://user@example.com"]', '["https://example.com/path"]', '["https://good.example", "*"]']) assert.deepEqual(allowedOrigins(input), []);
assert.deepEqual(allowedOrigins('["https://fixture.example:8443"]'), ['https://fixture.example:8443']);
const file = fs.readFileSync('public/_headers','utf8');
for (const [k,v] of Object.entries(SECURITY_HEADERS)) assert.ok(file.includes(`  ${k}: ${v}`), k);
let reads=0;
const env={ASSETS:{fetch:async()=>{reads++;return new Response('<h1>Fixture</h1>')}}};
for(const path of ['/embed/', '/embed/unknown']) {const res=await embedResponse({request:new Request('https://local.example'+path+'?origin=https://evil.example'),env});assert.equal(res.status,403);assert.equal(res.headers.get('X-Frame-Options'),'DENY');}
assert.equal(reads,0);
const response=await embedResponse({request:new Request('https://local.example/embed/?aircraft=c172'),env:{...env,EARTHWING_EMBED_ORIGINS:'["https://fixture.example"]'}});
assert.equal(response.status,200);assert.equal(response.headers.get('X-Frame-Options'),null);assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors https:\/\/fixture.example$/);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
console.log('PASS exact origin policy, fail-closed requests, static security parity and opt-in embed response');
