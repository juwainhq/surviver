# surviver

A time-travel action roguelike that ships as a single `index.html`.

The render + combat engine has been rebuilt on [pixelfx](https://github.com/patch-gg/pixelfx)
on the `arena/3ddae62f-surviver` test branch: every entity, projectile, particle
and battlefield UI element is a pixelfx module baked into an offscreen cache and
blitted with `drawImage`, with no primitive canvas drawing anywhere in the
battlefield render path.

* **Architecture:** [`docs/PIXELFX-ARCHITECTURE.md`](docs/PIXELFX-ARCHITECTURE.md)
* **Verification harness:** [`tools/pfx-harness/`](tools/pfx-harness/README.md)
* **Vendored library:** `vendor/pixelfx/` (upstream `src/`, LICENSE, NOTICE)

The page loads pixelfx from jsDelivr and falls back to the vendored mirror, so it
must be served over http(s) — ES module imports are blocked on `file://`:

```bash
python3 -m http.server 8080   # then open http://localhost:8080/index.html
```

Query flags: `?pfxaudit=1` turns on the primitive audit, `?pfxlow=1` forces the
low-memory bake profile (it is applied automatically on low-end devices).
