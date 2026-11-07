# fairbuds2-eq

<img width="1199" height="817" alt="image" src="https://github.com/user-attachments/assets/65f8da00-9b37-402f-80e7-f86e92f3492b" />


Like with the original Fairbuds, the Fairbuds app only exposes limited EQ functionality for the Fairbuds 2.  
This web app provides the full parametric EQ available on the Fairbuds 2.
The interface is inspired by Fabfilter Pro-Q.
All changes can be heard live and only persist after clicking save.

> [!NOTE]
> You can use the Fairbuds app as usual, but any EQ changes made there will overwrite the EQ set by this web app.

Unofficial and not affiliated with Fairphone.

## Usage

Open the page in a browser with [Web Bluetooth](https://caniuse.com/web-bluetooth):

- **Android:** Chrome. Confirm the pairing prompt the first time you connect.
- **Windows:** Chrome, Edge or Brave. In Brave, enable `brave://flags/#brave-web-bluetooth-api` first. Before the first
  connect, pair the buds once more in Settings → Bluetooth → Add device → Bluetooth and
  pick "Fairbuds 2". This adds the connection the page uses; the audio pairing does not cover it. The page waits and
  connects by itself once you have done this.
- **macOS, ChromeOS:** Chrome should work but is untested. **Linux:** Chrome with
  `chrome://flags/#enable-experimental-web-platform-features`, untested.
- Firefox and Safari have no Web Bluetooth, and neither has any browser on iOS.

Then:

1. **Connect** and pick your Fairbuds 2.
2. Start from a preset, from what is stored on the buds, or from scratch. Drag the points, scroll to change Q, and hold
   the headphone icon under a point to hear only that band.
3. Use **A** and **B** to compare two settings.
4. **Save to buds** when you are happy. Until then, nothing is stored and the buds go back to their saved EQ after a
   restart.

EQs from Equalizer APO, AutoEq or REW can be pasted under **Share, import and export**. The buds take at most 10
filters.

## Presets

Presets are plain text files in `presets/`. To add one, open a pull request with a new file in `presets/community/`
(format in `presets/README.md`), or use **Submit as preset** in the page, which opens a prefilled issue.

## Development

```sh
node scripts/build.mjs        # writes presets.json
python3 -m http.server 8000   # then open http://localhost:8000
npm test
```

No dependencies and no build step for the page itself. `agents/` documents the code and the Bluetooth protocol.

## Credits

Inspired by [jurf/fairbuds](https://github.com/jurf/fairbuds)
