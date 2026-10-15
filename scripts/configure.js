'use strict';
const fs = require('node:fs/promises');
const {parseArgs} = require('node:util');
const {SETTINGS_PATH, discoverInstallations, saveInstallation} = require('../server/installation');

(async () => {
  const {values, positionals} = parseArgs({options: {auto: {type: 'boolean'}, list: {type: 'boolean'}, help: {type: 'boolean'}}, allowPositionals: true});
  if (values.help) {console.log('npm run configure -- "/path/to/World of Warcraft"\nnpm run configure -- --list\nnpm run configure -- --auto');return;}
  if (positionals.length > 1 || (positionals.length && (values.auto || values.list))) throw new Error('Provide one installation path, --list, or --auto.');
  if (positionals.length) {const install = await saveInstallation(positionals[0]);console.log(`Saved beta ${install.version}: ${install.path}\nRestart the viewer to apply it.`);return;}
  if (values.auto) await fs.rm(SETTINGS_PATH, {force: true});
  const found = await discoverInstallations();
  for (const install of found) console.log(`${install.version}  ${install.path}`);
  if (values.list) {if (!found.length) console.log('No beta found in the standard locations. Pass its installation path manually.');return;}
  if (found.length !== 1) throw new Error(found.length ? 'Multiple installations found. Pass the desired path explicitly.' : 'No beta found. Run npm run configure -- "/path/to/World of Warcraft".');
  if (!values.auto) await saveInstallation(found[0].path);
  console.log(values.auto ? 'Automatic detection enabled. Restart the viewer to apply it.' : 'Installation saved. Restart the viewer to apply it.');
})().catch(error => {console.error(error.message);process.exitCode = 1;});
