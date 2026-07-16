const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const pkg = require('../package.json')
const manifest = require('../companion/manifest.json')

if (pkg.version !== manifest.version) {
  throw new Error(`Version mismatch: package.json is ${pkg.version}, companion/manifest.json is ${manifest.version}`)
}

const stage = path.resolve('release/package')
fs.rmSync(path.resolve('release'), { recursive: true, force: true })
fs.mkdirSync(path.join(stage, 'dist'), { recursive: true })
fs.mkdirSync(path.join(stage, 'companion'), { recursive: true })
fs.copyFileSync('LICENSE', path.join(stage, 'LICENSE'))
fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  main: pkg.main,
  license: pkg.license,
}, null, 2)}\n`)
for (const file of ['manifest.json', 'HELP.md']) fs.copyFileSync(path.join('companion', file), path.join(stage, 'companion', file))
fs.copyFileSync(path.join('dist', 'index.js'), path.join(stage, 'dist', 'index.js'))
const output = path.resolve(`release/fora-cc-${pkg.version}.tgz`)
execFileSync('tar', ['-czf', output, '-C', path.resolve('release'), 'package'], {
  env: { ...process.env, COPYFILE_DISABLE: '1' },
})
console.log(output)
