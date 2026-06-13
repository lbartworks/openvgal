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
- The builder's own export triggers (the `#downloadZipBtn` "Download ZIP"
  button and the "JSON only" button) are **hidden**, so the step-3 card shows
  only **Preview** and **Customize**. Export is **parent-driven**: the host
  owns the save actions and asks for the ZIP by posting
  `openvgal:export-request`; the child builds it and posts the blob back via
  `openvgal:zip-ready`. The host provides the real download.
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
2. **Child posts `openvgal:ready`** once the embed wiring is set up, followed by
   an initial `openvgal:resize`. Hosts should wait for `ready` before sending
   `openvgal:configure` — the style picker fetches its catalog asynchronously
   and configure requests that arrive earlier may need to wait for the catalog.
   The child buffers and retries for ~3 s, so a configure sent immediately after
   `openvgal:ready` is safe.
3. **(Optional) Parent posts `openvgal:configure`** to preselect a style.
4. **Child posts `openvgal:resize`** as its content grows (step transitions,
   customize open/close). The parent sizes the iframe to this height so there is
   no empty band beneath the builder.
5. **User builds the gallery.** On reaching step 3, the child posts
   `openvgal:gallery-ready` — a gallery now exists to export. The parent enables
   its save group.
6. **User clicks a Save action.** The parent posts `openvgal:export-request` to
   the child.
7. **Child builds the ZIP and posts `openvgal:zip-ready`** with the blob and
   metadata. The parent uploads it (draft) or downloads it (local copy). One
   `zip-ready` per `export-request`.

## Messages

### Child → parent

#### `openvgal:ready`

```js
{ type: 'openvgal:ready' }
```

Sent once, on iframe load, after `body.embed-mode` is applied and the
configure listener is wired. Followed immediately by an initial
`openvgal:resize`.

#### `openvgal:resize`

```js
{
  type: 'openvgal:resize',
  height: number  // document.documentElement.scrollHeight, in CSS pixels
}
```

Posted whenever the builder's content height changes — driven by a
`ResizeObserver` on the document element, plus one post right after
`openvgal:ready`. The parent applies this height to the iframe so the frame
hugs the builder's content (no `100dvh` band, no empty panel).

#### `openvgal:gallery-ready`

```js
{
  type: 'openvgal:gallery-ready',
  count: number,        // number of artwork images in the gallery
  style: string | null  // selected style key (e.g. 'classic'), or null
}
```

Sent when the builder reaches step 3 — a gallery now exists to export. This,
not `zip-ready`, is the signal that the parent should reveal/enable its save
group. Re-sent if the user rebuilds.

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

Sent in response to each `openvgal:export-request` — one blob per request
(the export button is hidden in embed mode). The blob is transferred by
structured clone — no transferable list needed. It reflects the current state
of the gallery, including any Customize edits made before the request.

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

#### `openvgal:export-request`

```js
{ type: 'openvgal:export-request' }
```

Asks the child to build the ZIP. Sent when the user clicks a parent-owned Save
action (e.g. "Save as draft" or "Save local copy"). The child runs the same
build path the hidden Export button used and replies with `openvgal:zip-ready`.
Only meaningful after `openvgal:gallery-ready`; if no gallery has been built
yet the request is a no-op. Combine with `?cdn=1` to get the thin-client CDN
ZIP as the response.

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

It iframes `site/create/index.html?embed=1` and logs the child→parent messages
(`openvgal:ready`, `openvgal:resize`, `openvgal:gallery-ready`,
`openvgal:zip-ready` plus the blob size). Build a gallery in the iframe; once
`gallery-ready` arrives the harness enables its **Request export** button, which
posts `openvgal:export-request` and prompts the child to reply with
`openvgal:zip-ready` (with a download link to sanity-check the ZIP). Add `&cdn=1`
to the mode selector to test the CDN-output variant.

## Stability

This contract is the API that `openvgal-site` depends on. Changes here are
breaking changes — bump a version field on the messages or coordinate the
update with the consuming site rather than silently altering the shape.
