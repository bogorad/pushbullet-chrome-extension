const fs = require('fs');

const pkgPath = 'package.json';
const manPath = 'manifest.json';
const optionsPath = 'options.html';

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const newVersion = `${major}.${minor}.${patch + 1}`;

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
man.version = newVersion;
fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n');

const options = fs.readFileSync(optionsPath, 'utf8');
const updatedOptions = options.replace(
  /(<span id="version">)[^<]+(<\/span>)/,
  `$1${newVersion}$2`,
);
fs.writeFileSync(optionsPath, updatedOptions);

console.log(`Bumped version to ${newVersion}`);
