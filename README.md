# companion-module-fora-cc

Bitfocus Companion module for controlling FOR-A 1010 colour correctors over HTTP.

## Features

- Five-channel control with Companion channels 1–5 mapped to FOR-A `fs=0–4`
- Set actions for all supported processing parameters
- One variable-aware adjustment action for increasing or decreasing any attribute by a chosen amount
- Continuous polling of all channels with a configurable interval
- Per-channel variables and currently selected channel variables
- Store and recall presets containing all supported parameters
- Variable-enabled action values, channel numbers and preset numbers

## Development

Requires Node.js 22.

```bash
npm install
npm run build
```

Create an importable Companion package:

```bash
npm run package
```

The package is written to `release/fora-cc-1.5.0.tgz`.

## Creating a release

Keep the version in `package.json` and `companion/manifest.json` in sync, then commit and push the change. Create and publish a GitHub Release using a matching tag such as `v1.5.0`.

```bash
git tag v1.5.0
git push origin v1.5.0
```

When the GitHub Release is published, GitHub Actions builds the module and attaches `fora-cc-1.5.0.tgz` to the release. This is the file to manually install on an offline Companion system; the automatically generated "Source code" archives are not Companion packages.

## Disclaimer

This is an independently developed module based on observed HTTP behavior. It is not an official FOR-A product.

## License

MIT
