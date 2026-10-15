'use strict';
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.js')).map(name => path.join(root, 'tests', name));
const child = spawn(process.execPath, ['--test', ...files], {cwd: root, stdio: 'inherit', env: {...process.env, WOW_INTEGRATION: '1'}});
child.on('error', error => {console.error(error.message);process.exitCode = 1;});
child.on('exit', code => {process.exitCode = code ?? 1;});
