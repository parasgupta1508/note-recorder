const esbuild = require('esbuild'), fs = require('fs'), path = require('path');
esbuild.buildSync({ entryPoints: [path.join(__dirname, 'bp-entry.js')], bundle: true, minify: true, format: 'iife', target: 'es2019', outfile: path.join(__dirname, '..', 'vendor', 'basic-pitch.js'), legalComments: 'none', alias: { '@tensorflow/tfjs': path.join(__dirname, 'node_modules', '@tensorflow', 'tfjs') }, define: { 'process.env.NODE_ENV': '"production"' } });
const src = path.join(__dirname, 'node_modules', '@spotify', 'basic-pitch', 'model'), dst = path.join(__dirname, '..', 'vendor', 'model');
fs.mkdirSync(dst, { recursive: true }); for (const f of ['model.json', 'group1-shard1of1.bin']) fs.copyFileSync(path.join(src, f), path.join(dst, f));
fs.copyFileSync(path.join(__dirname, 'node_modules', '@spotify', 'basic-pitch', 'LICENSE'), path.join(__dirname, '..', 'vendor', 'LICENSE-basic-pitch.txt'));
console.log('built', (fs.statSync(path.join(__dirname, '..', 'vendor', 'basic-pitch.js')).size / 1e6).toFixed(2), 'MB');
