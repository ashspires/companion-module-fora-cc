# companion-module-fora-cc

Bitfocus Companion module for controlling FOR-A 1010 colour correctors over HTTP.

## Features

- Five-channel control with Companion channels 1–5 mapped to FOR-A `fs=0–4`
- One variable-aware action for setting any supported processing attribute
- One variable-aware adjustment action for increasing or decreasing any attribute by a chosen amount
- Continuous polling of all channels with a configurable interval
- Per-channel variables and currently selected channel variables
- Store and recall presets containing all supported parameters
- Variable-enabled action values, channel numbers and preset numbers

## Building the Companion package

The same commands work on macOS and Windows. Run them from the repository root, where `package.json` is located.

### Prerequisites

- [Node.js 22](https://nodejs.org/) with npm
- Git, if cloning the repository rather than downloading its source
- A `tar` command:
  - macOS includes `tar`.
  - Current versions of Windows 10 and Windows 11 include `tar.exe`. In PowerShell, confirm it is available with `tar --version`.

### macOS

Open Terminal, clone the repository if necessary, and enter its directory:

```bash
git clone https://github.com/ashspires/companion-module-fora-cc.git
cd companion-module-fora-cc
```

Install the exact locked dependencies and build the package:

```bash
npm ci
npm run package
```

The packaging script disables macOS AppleDouble metadata so hidden `._` files are not added to the archive. Those files make Companion reject an otherwise valid package.

Validate the result:

```bash
node --check dist/index.js
tar -tzf release/fora-cc-1.7.0.tgz
```

### Windows

Open PowerShell, clone the repository if necessary, and enter its directory:

```powershell
git clone https://github.com/ashspires/companion-module-fora-cc.git
Set-Location companion-module-fora-cc
```

Install the exact locked dependencies and build the package:

```powershell
npm ci
npm run package
```

Validate the result:

```powershell
node --check dist/index.js
tar -tzf release/fora-cc-1.7.0.tgz
```

If PowerShell reports that script execution is disabled when invoking npm, use `npm.cmd ci` and `npm.cmd run package` instead.

### Output and installation

The package is written to `release/fora-cc-VERSION.tgz`, where `VERSION` comes from `package.json`. For v1.7.0, the filename is `release/fora-cc-1.7.0.tgz`.

The `release` directory is recreated each time `npm run package` runs, so do not keep unrelated files there.

In Companion, open **Modules** and choose **Import module package**. Do not choose **Import offline module bundle**, and do not use GitHub's automatically generated "Source code" archives.

## Creating a release

Keep the version in `package.json` and `companion/manifest.json` in sync, then commit and push the change. Create and publish a GitHub Release using a matching tag such as `v1.7.0`.

```bash
git tag v1.7.0
git push origin v1.7.0
```

When the GitHub Release is published, GitHub Actions builds the module and attaches `fora-cc-1.7.0.tgz` to the release. This is the file to manually install on an offline Companion system; the automatically generated "Source code" archives are not Companion packages.

## Disclaimer

This is an independently developed module based on observed HTTP behavior. It is not an official FOR-A product.

## License

MIT
