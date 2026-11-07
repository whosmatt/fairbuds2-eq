# Presets

One preset per file, in Equalizer APO's parametric format with a few `#` header lines:

```
# Name: Warm and relaxed
# Author: your name or handle
# Description: What it sounds like and what it is based on.
# Source: https://… (optional)
Preamp: -3.0 dB
Filter 1: ON LSC Fc 105 Hz Gain 4.0 dB Q 0.700
Filter 2: ON PK Fc 3000 Hz Gain -2.0 dB Q 1.400
```

- Add new presets to `community/`, named `lower-case-with-dashes.txt`.
- Up to 10 active filters. Types: `PK`, `LSC`, `HSC`, `HPQ`, `LPQ` (and their APO aliases).
- The page matches every preset's loudness to the Fairbuds app's Default when it is loaded, so the preamp in the file
  does not need to be tuned for that.
- `node scripts/build.mjs` checks all files; the same check runs on every pull request.

The easiest way to get a file is the page itself: **Share, import and export → Export text**, or **Submit as preset**,
which opens a prefilled issue.

Groups and their order in the menu are listed in `groups.json`. `fairbuds-app` holds the presets built into the buds and
is the loudness reference.

`autoeq-fairbuds1/` holds the AutoEq presets from [jurf/fairbuds](https://github.com/jurf/fairbuds) (MIT). They were
measured on the original Fairbuds, which is different hardware. Two presets were omitted due to sounding horrible.
