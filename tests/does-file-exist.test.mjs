// Regression test for doesFileExist() in site/openvgal-viewer.js.
// Run: node --test tests/does-file-exist.test.mjs
// The function lives inside the viewer's closure, so its source is extracted
// and evaluated against a stubbed fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../site/openvgal-viewer.js', import.meta.url), 'utf8');
const match = src.match(/async function doesFileExist\(urlToFile\) \{[\s\S]*?\n\t\}\n/);
assert.ok(match, 'doesFileExist not found in site/openvgal-viewer.js');

function withFetch(fetchImpl) {
	return new Function('fetch', match[0] + '\nreturn doesFileExist;')(fetchImpl);
}

const head = (status, contentType) => async () =>
	new Response(null, { status, headers: contentType ? { 'content-type': contentType } : {} });

test('200 text/html (SPA fallback) -> false', async () => {
	assert.equal(await withFetch(head(200, 'text/html; charset=utf-8'))('x.glb'), false);
});

test('200 model/gltf-binary -> true', async () => {
	assert.equal(await withFetch(head(200, 'model/gltf-binary'))('x.glb'), true);
});

test('200 with no content-type -> true', async () => {
	assert.equal(await withFetch(head(200))('x.glb'), true);
});

test('200 application/octet-stream -> true', async () => {
	assert.equal(await withFetch(head(200, 'application/octet-stream'))('x.glb'), true);
});

test('404 -> false', async () => {
	assert.equal(await withFetch(head(404, 'text/html'))('x.glb'), false);
});

test('fetch throws -> false', async () => {
	assert.equal(await withFetch(async () => { throw new TypeError('blocked'); })('x.glb'), false);
});
