# Embedding the create flow (`?embed=1`)

`site/create/index.html` supports an embed mode for hosts that want to wrap the
generator in their own UI (e.g. the private `openvgal-site` `/create` route).
When `?embed=1` is present:

- Page chrome (nav, header, deployment info-box, mode switch link, JSON-only
  download) is hidden.
- The step-3 export summary is hidden too: the "Your gallery is ready"
  title/badge, the Rooms/Artworks stats block, and the "Show JSON preview"
  disclosure. The host owns the export summary and shows its own (count, size,
  etc.), so the step-3 card hugs its action row.
- The export trigger is relabelled from "Download ZIP" to **"Export gallery"**
  (same `#downloadZipBtn` element and handler — label only), because in embed
  mode it does not download. Instead, the ZIP blob is posted to
  `window.parent` via `postMessage`; the host provides the real download.
- The page does not open the `ready.html` confirmation tab.

Combine with `?cdn=1` (`?embed=1&cdn=1`) to produce the thin-client CDN ZIP
instead of the self-contained bundle.

## URL

```
https://demo.openvgal.com/create/index.html?embed=1
https://demo.openvgal.com/create/index.html?embed=1&cdn=1
```

Self-hosters use the same page without `?embed=1` and see today's behaviour
unchanged.

## Lifecycle

1. **Parent loads iframe.**
2. **Child posts `openvgal:ready`** once the embed wiring is set up. Hosts
   should wait for this before sending `openvgal:configure` — the style picker
   fetches its catalog asynchronously and configure requests that arrive
   earlier may need to wait for the catalog. The child buffers and retries for
   ~3 s, so a configure sent immediately after `openvgal:ready` is safe.
3. **(Optional) Parent posts `openvgal:configure`** to preselect a style.
4. **User builds the gallery and clicks "Export gallery"** (the relabelled
   `#downloadZipBtn`).
5. **Child posts `openvgal:zip-ready`** with the blob and metadata.

## Messages

### Child → parent

#### `openvgal:ready`

```js
{ type: 'openvgal:ready' }
```

Sent once, on iframe load, after `body.embed-mode` is applied and the
configure listener is wired.

#### `openvgal:zip-ready`

```js
{
  type: 'openvgal:zip-ready',
  zip: Blob,           // application/zip
  meta: {
    count: number,     // number of artwork images in the gallery
    totalBytes: number, // blob.size
    style: string | null // style key (e.g. 'classic'), or null if unset
  }
}
```

Sent each time the user clicks "Export gallery". One blob per click. The blob is
transferred by structured clone — no transferable list needed.

### Parent → child

#### `openvgal:configure`

```js
{
  type: 'openvgal:configure',
  style: string  // style key, e.g. 'classic', 'industrial', etc.
}
```

Currently only `style` is honoured. Unknown styles are silently ignored. Other
fields may be added later.

## Origin handling

- The **child** posts with target origin `'*'`. It does not gate inbound
  messages by origin.
- The **parent** must pin the iframe's origin when validating
  `event.origin` on received messages (e.g.
  `event.origin === 'https://demo.openvgal.com'`). Skipping this lets any
  cross-origin frame on the page inject `openvgal:zip-ready`.

## Local testing

`docs/embed-test.html` is a minimal harness. From the repo root:

```
python -m http.server 8080
# then open http://localhost:8080/docs/embed-test.html
```

It iframes `site/create/index.html?embed=1` and logs the `openvgal:ready` and
`openvgal:zip-ready` messages plus the blob size. Add `&cdn=1` to the iframe
src to test the CDN-output variant.

## Stability

This contract is the API that `openvgal-site` depends on. Changes here are
breaking changes — bump a version field on the messages or coordinate the
update with the consuming site rather than silently altering the shape.
