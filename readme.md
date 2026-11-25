<table width="100%">
  <tr>
    <td width="104" align="center" valign="middle">
      <img src="assets/icon.png" width="84" alt="mono app logo" />
    </td>
    <td valign="middle">
      <h1>mono</h1>
      <p>
        Offline voice log for Android built with Expo SDK 52 and the Cactus 4.1.4 native runtime.
        <br />
        Hold to record a thought, then extract a title, summary, tags, and checkable tasks right on your phone.
      </p>
      <p>
        <code>v1.0.1</code> &middot;
        <code>Expo SDK 52</code> &middot;
        <code>Cactus 4.1.4</code> &middot;
        <code>arm64-v8a / armeabi-v7a</code>
      </p>
    </td>
  </tr>
</table>

## What ships inside

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <h3>Hold-to-record capture</h3>
      <p>
        A bottom thumb bar lets you press and hold the mic button to record up to 2 minutes.
        <br />
        Swipe up to lock hands-free recording, slide left to discard, or type a quick note in the same bar.
      </p>
    </td>
    <td width="50%" valign="top">
      <h3>On-device speech (Whistle)</h3>
      <p>
        A Kotlin <code>MediaCodec</code> decoder resamples recorded audio to 16 kHz mono PCM using Hann-windowed sinc interpolation.
        <br />
        <code>whistle.cact</code> (16.9 MB) transcribes 30-second windows with 1.5-second overlap and 6-word boundary deduplication.
      </p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Local extraction (Needle 3)</h3>
      <p>
        <code>needle3.cact</code> (35 MB) runs constrained <code>save_note</code> JSON tool calling via C++ JNI.
        <br />
        It pulls out a short title, summary, allowed tags (<code>#bug</code>, <code>#ship</code>, <code>#idea</code>, <code>#people</code>, <code>#todo</code>, <code>#study</code>, <code>#log</code>), and action items.
      </p>
    </td>
    <td width="50%" valign="top">
      <h3>Private SQLite vault</h3>
      <p>
        Notes and audio clips stay on your phone inside <code>expo-sqlite</code> and local app storage.
        <br />
        Search by keyword or tag, track a 14-day cadence grid, and export all data as JSON through Android Storage Access Framework.
      </p>
    </td>
  </tr>
</table>

## How audio becomes a structured note

```text
Hold mic / swipe up to lock
  -> MediaRecorder (.m4a clip in local storage)
  -> AudioDecoder.kt (MediaExtractor + MediaCodec + sinc resample to 16 kHz mono PCM)
  -> Whistle (whistle.cact via libcactus.a JNI -> chunked transcript)
  -> Needle 3 (needle3.cact save_note JSON tool call, or regex fallback)
  -> expo-sqlite (searchable note card + playable clip + checkable tasks)
```

## Runtime support and honest limits

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <h3>ARM Android APK</h3>
      <ul>
        <li>Runs full local Whistle speech transcription and Needle 3 extraction via <code>libcactus.a</code>.</li>
        <li>Downloads models once from Hugging Face with SHA-256 verification into internal <code>filesDir/cactus</code>.</li>
        <li>Supports clearing cached weights or triggering Storage Access Framework JSON export from Vault.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>Fallbacks and constraints</h3>
      <ul>
        <li>Expo Go, x86 emulators, and web browsers use rule-based extraction in <code>utils/extract.ts</code> instead of Cactus.</li>
        <li>First-time on-device model setup requires downloading roughly 52 MB total over the network before offline use.</li>
        <li>Voice recordings cap at 120 seconds per clip and save locally when stopped.</li>
      </ul>
    </td>
  </tr>
</table>

## Repo layout

| Path | Purpose |
|---|---|
| `app/(tabs)/index.tsx` | Capture screen with latest note card, error deep links, and bottom composer |
| `app/(tabs)/notes.tsx` | Debounced search, `#tag` and `#open` filters, inline note editor |
| `app/(tabs)/vault.tsx` | 14-day cadence grid, model cache controls, JSON export, support, and wipe |
| `components/capture-composer.tsx` | WhatsApp-style hold-to-record, swipe-up-to-lock, and slide-left-to-cancel bar |
| `modules/cactus-native/` | C++ JNI wrapper, `AudioDecoder.kt`, model downloader, and prebuilt `libcactus.a` |
| `plugins/with-expo-audio-fix.js` | Expo config plugin patching `expo-audio` Android recording and `file://` playback |
| `utils/` | SQLite schema, `expo-audio` playback/export helpers, and regex fallback extractor |

## Commands

Install dependencies with Bun:

```bash
bun install
```

Run all 34 unit and extraction eval tests, lint, and type checks:

```bash
bun test
bun run lint
npx tsc --noEmit
```

Build the ARM Android APK on EAS:

```bash
bunx eas-cli build --platform android --profile preview
```
