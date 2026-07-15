const fs = require('node:fs')
for (const path of ['dist', 'release']) fs.rmSync(path, { recursive: true, force: true })
