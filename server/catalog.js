'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {readDB} = require('./db2');
const {chunks} = require('./binary');

function pretty(name) {
  return name.replace(/\.(m2|wmo|blp)$/i, '').replaceAll('_', ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\bhd\b/gi, 'HD').replace(/\b\w/g, c => c.toUpperCase());
}
function creaturePath(name) {
  return /^(?:models\/)?creature\/[^/]+\/.+\.m2$/i.test(name)
    && !/^(?:models\/)?creature\/(?:spells|passivedoodads)\//i.test(name);
}
function modelPath(name) {
  return /^[a-z0-9_]+\/.+\.(?:m2|wmo)$/i.test(name);
}
// Classification is separate from admission. A name or table reference never
// admits a model outside the selectable archive roots or the installed build.
const beastRoots = /^(?:wolf|worg(?!en)|coyote|fox|hound|tiger|panther|lion|saber|sabre|lynx|leopard|jaguar|cheetah|cat(?:$|mount)|bear|boar|raptor|spider|tarantula|widow|scorpid|scorpion|windserpent|serpent|snake|cobra|python|crocolisk|crocodile|alligator|turtle|tortoise|gorilla|crab|carrionbird|vulture|condor|owl|eagle|hawk|falcon|raven|bat(?:$|mount)|hyena|tallstrider|ravager|moth|chimaera|chimera|corehound|devilsaur|rhino|worm|silithid|dragonhawk|stag|deer|elk|moose|shalespider|basilisk|hippo|elekk|mammoth|clefthoof|kodo|ram(?:$|mount)|goat|horse|camel|giraffe|zebra|shark|dolphin|seal|otter|wasp|bee(?:$|mount)|beetle|porcupine|quilen|pterrordax|direhorn|hippogryph|gryphon|wyvern|riding|armoredraptor|armoredboar|baby|giantspider)/i;
function beastPath(name) {
  const [directory, file] = name.split('/').slice(-2);
  return beastRoots.test(directory) || beastRoots.test(file.replace(/\.m2$/i, ''));
}
function mountPath(name) {
  const [directory, file] = name.split('/').slice(-2);
  if (/(?:^|_)(?:anvil|bag|baggage|saddle|armor|banner|seat|chair|weapon|lantern|parachute|fx)(?:_|\.)/i.test(file)) return false;
  return /mount(?!ain)|^riding/i.test(directory) && /mount(?!ain)|^riding/i.test(file);
}

class Catalog {
  constructor(archive) {
    this.archive = archive;
    this.models = new Map();
    this.appearances = new Map();
    this.warnings = [];
  }
  async build() {
    const a = this.archive;
    const {selectModels, allRoots} = await import('../public/catalog.mjs');
    this.selectModels = selectModels;
    this.roots = allRoots;
    const allowedRoots = new Set(allRoots.map(root => root.slice(0, -1)));
    const tables = {};
    for (const name of ['CreatureModelData', 'CreatureDisplayInfo', 'Creature', 'Mount', 'MountXDisplay', 'BattlePetSpecies', 'ModelFileData', 'ItemDisplayInfo', 'ChrModel']) {
      // These relationships define the catalog's promises; a missing table must
      // never silently turn a category into "all files".
      const table = await readDB(a, name);
      tables[name] = table.rows;
      if (table.skipped) this.warnings.push(`${name}: ${table.skipped} encrypted or absent records.`);
    }
    this.tables = tables;
    const modelReferences = new Set([...tables.CreatureModelData.values()].map(row => row.FileDataID));
    const modelForDisplay = id => tables.CreatureModelData.get(tables.CreatureDisplayInfo.get(id)?.ModelID)?.FileDataID;
    this.referenceIDs = new Map();
    const addReference = (fileID, kind, rowID) => {
      if (!fileID) return;
      if (!this.referenceIDs.has(fileID)) this.referenceIDs.set(fileID, {item: new Set(), character: new Set()});
      this.referenceIDs.get(fileID)[kind].add(rowID);
    };
    const filesForResource = new Map();
    for (const row of tables.ModelFileData.values()) {
      if (!row.ModelResourcesID) continue;
      if (!filesForResource.has(row.ModelResourcesID)) filesForResource.set(row.ModelResourcesID, new Set());
      filesForResource.get(row.ModelResourcesID).add(row.FileDataID);
    }
    for (const row of tables.ItemDisplayInfo.values()) {
      for (const resourceID of row.ModelResourcesID || []) {
        for (const fileID of filesForResource.get(resourceID) || []) addReference(fileID, 'item', row.ID);
      }
    }
    for (const row of tables.ChrModel.values()) addReference(modelForDisplay(row.DisplayID), 'character', row.ID);
    for (const [id, filePath] of a.names) {
      const file = a.files.get(id);
      if (!file?.local || !modelPath(filePath) || !allowedRoots.has(filePath.split('/')[0])) continue;
      const root = filePath.split('/')[0], ids = this.referenceIDs.get(id);
      const tableReferences = {creature: modelReferences.has(id), item: !!ids?.item.size, character: !!ids?.character.size};
      const tableReferenceKind = ['creature', 'character', 'item'].includes(root) ? root : 'known';
      this.models.set(id, {
        id, path: filePath, name: pretty(filePath.split('/').pop()), type: filePath.endsWith('.wmo') ? 'wmo' : 'm2', size: file.size,
        contentKey: file.contentKey, tableReferences, tableReferenceKind,
        inBetaTables: tableReferenceKind === 'known' ? Object.values(tableReferences).some(Boolean) : tableReferences[root],
        beast: creaturePath(filePath) && beastPath(filePath), mount: false, companion: false, names: [], appearanceCount: 0,
        source: {buildKey: a.build.key, contentKey: file.contentKey}
      });
    }
    for (const [displayID, row] of tables.CreatureDisplayInfo) {
      const id = modelForDisplay(displayID);
      if (!this.models.has(id)) continue;
      const textures = row.TextureVariationFileDataID || [];
      if (!textures.some(Boolean)) continue;
      const entries = this.appearances.get(id) || [];
      const signature = textures.join(',');
      if (!entries.some(entry => entry.signature === signature)) {
        const label = textures.filter(Boolean).map(id => a.names.get(id)?.split('/').pop()).find(Boolean);
        entries.push({id: displayID, signature, textures, label: label ? pretty(label) : `Skin ${displayID}`, source: 'beta-table'});
        this.appearances.set(id, entries);
      }
    }
    for (const row of tables.Creature.values()) {
      for (const displayID of row.DisplayID || []) {
        const model = this.models.get(modelForDisplay(displayID));
        if (!model) continue;
        if (row.Name_lang) model.names.push(row.Name_lang);
        if (row.CreatureType === 1) model.beast = true;
      }
    }
    for (const row of tables.MountXDisplay.values()) {
      const model = this.models.get(modelForDisplay(row.CreatureDisplayInfoID));
      if (!model) continue;
      model.mount = true;
      model.mountSource = 'beta-table';
      const name = tables.Mount.get(row.MountID)?.Name_lang;
      if (name) model.names.push(name);
    }
    for (const species of tables.BattlePetSpecies.values()) {
      const creature = tables.Creature.get(species.CreatureID);
      for (const displayID of creature?.DisplayID || []) {
        const model = this.models.get(modelForDisplay(displayID));
        if (model) {model.companion = true; model.companionSource = 'beta-table';}
      }
    }
    for (const model of this.models.values()) {
      if (!model.mount && creaturePath(model.path) && mountPath(model.path)) {model.mount = true; model.mountSource = 'filename';}
      model.names = [...new Set(model.names)];
      model.appearanceCount = this.appearances.get(model.id)?.length || 0;
    }
    await this.auditGeometry();
    this.items = [...this.models.values()];
    this.revision = crypto.createHash('sha256').update(a.build.key + JSON.stringify(this.items)).digest('hex').slice(0, 20);
    a.status = {phase: 'ready'};
    return this;
  }
  async auditGeometry() {
    const a = this.archive;
    const file = path.join(a.cacheDir, `model-audit-v1-${a.keyFingerprint}.json`);
    let cache = {};
    try {cache = JSON.parse(await fs.readFile(file, 'utf8'));} catch {
      try {cache = JSON.parse(await fs.readFile(path.join(a.cacheDir, `creature-audit-v2-${a.keyFingerprint}.json`), 'utf8'));} catch {}
    }
    let completed = 0;const total = this.models.size;
    for (const model of this.models.values()) {
      a.status = {phase: 'indexing', message: `Checking model files ${++completed}/${total}`};
      let audit = cache[model.contentKey];
      if (!audit) {
        try {
          const raw = await a.getFile(model.id); // Includes manifest content-hash verification.
          if (model.type === 'wmo') {
            const parts = chunks(raw, 0, raw.length, true), header = parts.get('MOHD');
            if (!header) {
              if (!parts.has('MOGP')) throw new Error('Not a WMO model.');
              audit = {readable: true, groupFile: true};
            } else audit = {readable: true, groups: header.readUInt32LE(4)};
          } else {
            const parts = raw.toString('ascii', 0, 4) === 'MD20' ? new Map([['MD21', raw]]) : chunks(raw);
            const header = parts.get('MD21');
            if (!header || header.toString('ascii', 0, 4) !== 'MD20') throw new Error('Not an M2 model.');
            const vertices = header.readUInt32LE(60), vertexOffset = header.readUInt32LE(64);
            if (vertexOffset + vertices * 48 > header.length) throw new Error('Invalid vertex data.');
            audit = {readable: true, vertices, bones: header.readUInt32LE(44)};
          }
        } catch (error) {audit = {readable: false, reason: error.message};}
        cache[model.contentKey] = audit;
      }
      // Exclude files without a visible mesh, regardless of their directory.
      if (audit.readable && (audit.groupFile || (model.type === 'm2' ? !audit.vertices : !audit.groups))) {this.models.delete(model.id);this.appearances.delete(model.id);continue;}
      model.readable = audit.readable;
      if (!audit.readable) model.unavailableReason = audit.reason;
      if (completed % 40 === 0) await new Promise(resolve => setImmediate(resolve));
    }
    await fs.writeFile(file, JSON.stringify(cache));
  }
  query(params) {
    const ids = params.get('ids');
    const items = this.selectModels(this.items, {
      category: ids !== null ? 'favorites' : params.get('category') || 'all',
      table: params.get('table') || 'all', q: params.get('q') || '', folder: params.get('folder') || '',
      sort: params.get('sort') || 'name', direction: params.get('direction') || 'asc',
      favorites: ids?.split(',').map(Number) || []
    });
    // The catalog is small enough to return as one continuous list. No pages.
    return {items, total: items.length, revision: this.revision};
  }
  snapshot() {return {build: this.archive.build, revision: this.revision, items: this.items, warnings: this.warnings};}
  status() {return {phase: 'ready', build: this.archive.build, revision: this.revision, counts: {
    all: this.items.length,
    ...Object.fromEntries(this.roots.map(root => [root.slice(0,-1), this.items.filter(m => m.path.startsWith(root)).length])),
    beast: this.items.filter(m => m.beast).length, mount: this.items.filter(m => m.mount).length,
    companion: this.items.filter(m => m.companion).length
  }, warnings: this.warnings};}
}
module.exports = {Catalog, modelPath, creaturePath, beastPath, mountPath, pretty};
