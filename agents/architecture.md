# Architecture

A static page. No framework, no bundler, no runtime dependencies. ES modules loaded directly by the browser; Node is only
used for tests and the preset build.

## Files

| path | |
|---|---|
| `index.html`, `style.css` | the page |
| `src/codec.js` | RACE framing, Q1.31 coefficient encoding, blob parse/build, `REF_GAIN` |
| `src/dsp.js` | RBJ biquads, `design()` bands → four rate tables, `solo()`, `response()`, `toBands()` (tables → bands) |
| `src/apo.js` | Equalizer APO text in/out, preset metadata, share-link encoding |
| `src/race.js` | `Session`: Web Bluetooth connection, command/response matching, relay, NVKEY, live, save |
| `src/editor.js` | the plot, band dragging, solo handle, band popup, keyboard |
| `src/app.js` | state, A/B, undo, presets, connection flow, live sending, share/import |
| `presets/` | preset files, see `presets/README.md` |
| `scripts/build.mjs` | validates presets, writes `presets.json`; `--site` also assembles `_site/` |
| `tests/` | `node --test`; fixture is the Default preset blob read from the buds |
| `.github/workflows/pages.yml` | tests, build, deploy to GitHub Pages on push to `main` |
| `.github/workflows/ci.yml` | tests and preset validation on pull requests |
| `.github/ISSUE_TEMPLATE/preset.yml` | the form "Submit as preset" opens, prefilled |

## Model

A band is `{ on, type, f, gain, q }` with `type` one of `peak`, `lowshelf`, `highshelf`, `hpf`, `lpf`. An EQ is
`{ pre, bands }`, `pre` in dB relative to `REF_GAIN`.

- `design()` always emits four tables of exactly 10 sections, unused ones flat. Anything sent to the buds must come from
  `design()` or `solo()`, never hand-built; `Session.live()` rejects anything else.
- The plot draws `response()` of the quantised 48 kHz table, i.e. what the buds will actually play.
- `toBands()` inverts a stored table by fitting each section against every type (Nelder–Mead on the normalised
  coefficients). It recovers the built-in presets to ~1e-14. A low shelf of +g and a high shelf of −g are identical up
  to a constant gain; the fit picks by frequency.

## Behaviour worth keeping

- **Live sending is a throttle, not a debounce.** The next update goes out as soon as the previous one is acknowledged,
  always with the latest state. A debounce makes drags silent until the pointer stops.
- **Solo**: while the headphone handle is held, the buds get `solo()`: two band-pass sections at the band's frequency,
  0 dB peak at `REF_GAIN`, nothing else. Releasing restores the EQ (or the stored EQ with live preview off).
- **Live preview off** means the buds play what is stored; toggling it sends that.
- **A/B**: two independent EQs with separate undo stacks, kept in `localStorage` (`fb2eq`). On a first visit both start
  as the Default preset; on the first connect they are replaced by what is stored on the buds unless the user already
  edited something.
- **Presets** outside the reference group are loudness-matched on load: power average of the response over
  100 Hz–8 kHz equal to the reference preset (Fairbuds app Default), lowered if the peak would exceed +12 dB.
  Imports and share links keep their own preamp.
- On connect, the Fairbuds app presets are re-read from the buds (`0xE410`–`0xE414`) and replace the bundled copies.
- **Save** writes only `0xE42C`, never the app's slider keys.

## Development

```sh
node scripts/build.mjs                 # presets.json, needed by the page
python3 -m http.server 8000            # Web Bluetooth needs a secure context; localhost counts
npm test
```

Testing against real buds:

- Chrome on Android: `adb reverse tcp:8000 tcp:8000`, open `http://localhost:8000`. Remote DevTools with
  `adb forward tcp:9223 localabstract:chrome_devtools_remote`.
- Desktop Chromium with `--remote-debugging-port`: the chooser can be answered over CDP with
  `DeviceAccess.enable` / `DeviceAccess.selectPrompt`, and clicks need `Runtime.evaluate` with `userGesture: true`.
- Brave needs `brave://flags/#brave-web-bluetooth-api`.
- Anything audible needs a person listening. Keep test EQs moderate and restore the user's EQ afterwards.

## Deployment

GitHub Pages with source "GitHub Actions" (Settings → Pages). The workflow publishes `_site/` from `scripts/build.mjs
--site`. The issue form applies the label `preset`, which has to exist in the repository.

The page finds its repository from `*.github.io` URLs. For a custom domain, set `<meta name="repository"
content="owner/repo">` in `index.html`; without it the "Submit as preset" button and the source link are hidden.
