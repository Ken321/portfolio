# 321ken portfolio

Static portfolio deployed by GitHub Pages from `main` at the repository root.
The deployment setting was checked on 2026-10-30. Pushing changes to `main` can update https://321ken.com/.

## Editing and building

Use Node.js 20.11 or newer.

```sh
npm ci
npm test
npm run build
python3 -m http.server 8000
```

Open http://localhost:8000/ to preview. Use a local HTTP server, not `file://`, because the animations use JavaScript modules and model requests.

- `src/index.template.html`: layout and main copy.
- `src/styles.css`: responsive visual styles.
- `src/works.json`: all eight projects, Japanese/English descriptions, links and image variants.
- `src/app.js`: language switching and the accessible work-detail dialog.
- `src/effects-controller.js`: lazy loading, visibility, scrolling, motion preference, shared timing and resource release.
- `src/effects/`: original real-time effects, separated into hero, ken and avatar bundles.

`npm run build` writes the publishable `index.html` and content-hashed files in `assets/build/`. Commit these outputs together with the source. GitHub Pages does not run npm in the current branch-based publishing setup.

Images are committed as responsive WebP files. To regenerate them from the originals in `img/`, install Pillow in your preferred Python environment and run:

```sh
python3 scripts/prepare-images.py
npm run build
```

Original images and `avatar.glb` are retained. The avatar model is loaded only near the contact section. External font/library CDNs are no longer required at runtime. Typography uses the device's installed sans-serif fonts with the existing blue palette.

## Performance policy

- The three opening effects share a scheduler and run together, at 30fps on mobile and 60fps on desktop.
- Mobile drawing ratio is capped at 1; desktop at 1.5. CSS text and project image resolution are independent of this cap.
- Project cards use ordinary responsive images. Large detail images remain inside inert templates until opened.
- Effects initialize within 180px of the viewport, stop outside it, and release their resources after 30 seconds outside it.
- On mobile, scrolling pauses animation until 160ms after the latest scroll/touchmove event.
- Hidden tabs and open work dialogs pause animation. Reduced-motion preferences use static fallbacks.
- Each effect has a virtual clock; paused wall time is not simulated when it resumes.
- `?perf` exposes `window.__portfolioPerformance()` for local visibility/frame checks. It does not collect or transmit analytics.

## Scope

The avatar retains its original model and adds optional OpenAI voice chat with subtitles and listening/speaking head gestures. Setup and deployment requirements are in `server/README.md`. A separate voice server and private API key are required; the static site alone cannot provide AI conversations.

Before publishing, review the local preview and check iPhone Safari and Android Chrome on actual devices. Desktop browser emulation is not proof of phone GPU performance or Core Web Vitals in production.
