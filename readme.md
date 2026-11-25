# mono

Offline voice log for Android powered by Expo and the Cactus 4.1.4 on-device runtime.

## On-device models

The native Android module (`modules/cactus-native`) links `libcactus.a` for `arm64-v8a` and `armeabi-v7a` via JNI and CMake.

- **Whistle** (`whistle.cact`, 16.9 MB) transcribes recorded voice clips locally at 16 kHz mono in up to 30-second windows.
- **Needle 3** (`needle3.cact`, 35 MB) extracts structured note titles, summaries, tags, and action items locally via constrained tool calling.

Models download once from Hugging Face with SHA-256 verification and stay cached inside the app's internal `filesDir/cactus` directory.
If models are not yet cached or the device ABI is unsupported, `mono` falls back to rule-based extraction in `utils/extract.ts`.

## Commands

Install dependencies with Bun:

```bash
bun install
```

Run tests, linting, and type checking:

```bash
bun test
bun run lint
npx tsc --noEmit
```

Build the installable Android APK on EAS:

```bash
bunx eas-cli build --platform android --profile preview
```
