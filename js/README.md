# PixelFX integration

`pixel-fx-manager.js` uses the locally vendored MIT-licensed PixelFX sources;
no CDN or network connection is required. Serve the game over HTTP (for
example `python3 -m http.server 8000`) so the browser can load ES modules.
If modules or canvas support are unavailable, PixelFX-only combat sprites
are not shown; gameplay and collision handling continue. See `vendor/pixelfx/UPSTREAM.md` for the pinned revision and
upstream filenames for the requested effect aliases.

Frames are baked incrementally during idle callbacks to 96px transparent
canvases. Rendering uses `drawImage` in world space, never `putImageData` on
the game canvas. The cache loads palettes lazily and limits active one-shot
effects. Enemy telegraph timing remains the existing gameplay value (0.8s).

Critical combat sprites get an initial offscreen frame immediately; the rest
of each loop is baked incrementally. Existing first frames are used while the
cache fills, avoiding custom placeholder shapes.
