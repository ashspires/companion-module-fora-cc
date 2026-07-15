const esbuild = require('esbuild')

esbuild.build({
  entryPoints: ['src/index.js'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  minify: false,
  legalComments: 'none',
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
