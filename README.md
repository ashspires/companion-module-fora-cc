# companion-module-fora-cc

Bitfocus Companion module for controlling FOR-A 1010 colour correctors over HTTP.

## Features

- Five-channel control with Companion channels 1–5 mapped to FOR-A `fs=0–4`
- Set, increment and decrement actions for all supported processing parameters
- Fine, medium and coarse sensitivity modes with configurable step sizes
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

## Publishing to GitHub

Before publishing, replace `YOUR-USERNAME` in `package.json` and `companion/manifest.json` with your GitHub username.

```bash
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/companion-module-fora-cc.git
git push -u origin main
```

## Disclaimer

This is an independently developed module based on observed HTTP behavior. It is not an official FOR-A product.

## License

MIT
