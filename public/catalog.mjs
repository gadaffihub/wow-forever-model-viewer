// One set of filtering and ordering rules, shared by the server and browser.
export const categories = new Set(['all', 'creature', 'beast', 'mount', 'companion', 'favorites']);
export const sorts = new Set(['folder', 'name', 'id', 'skins', 'size', 'table']);
const collator = new Intl.Collator('en', {numeric: true, sensitivity: 'base'});
export const modelRoots = ['creature/', 'character/', 'item/', 'models/'];
export const miscRoots = ['character/', 'item/', 'world/', 'spells/', 'environments/', 'particles/', 'interface/', 'cameras/', 'models/', 'sound/', 'textures/', 'tileset/', 'dungeons/', 'dbfilesclient/', 'gametables/', 'fonts/', 'shaders/', 'shadertextures/', 'screeneffects/', 'xtextures/', 'unkmaps/', 'interiors/', 'items/', 'spell/', 'test/', 'qa_toolstest/', 'triallists/', 'users/', 'wtf/'];
export const allRoots = [...new Set([...modelRoots, ...miscRoots])];
export function referenceLabel(folder) {
  return ({creature:'creature',character:'character',item:'item',models:'known',sound:'sound'})[folder.split('/')[0]] || 'known';
}

export function buildFolderTree(models) {
  const roots = allRoots.map(path => ({path, name: path, count: 0, children: new Map()}));
  const index = new Map(roots.map(node => [node.path, node]));
  for (const model of models) {
    const parts = model.path.split('/');parts.pop();
    let node = index.get(parts[0] + '/');
    if (!node) continue;
    node.count++;
    for (const name of parts.slice(1)) {
      const path = node.path + name + '/';
      if (!node.children.has(path)) {const child = {path, name: name + '/', count: 0, children: new Map()};node.children.set(path, child);index.set(path, child);}
      node = node.children.get(path);node.count++;
    }
  }
  return {roots, index};
}

export function selectModels(models, options = {}) {
  const {category = 'all', table = 'all', q = '', sort = 'folder', folder = '', direction = 'asc', favorites = []} = options;
  if (!categories.has(category)) throw new Error(`Unknown category: ${category}`);
  if (!sorts.has(sort)) throw new Error(`Unknown sort: ${sort}`);
  if (!['all', 'yes', 'no'].includes(table)) throw new Error(`Unknown table filter: ${table}`);
  const favoriteIDs = new Set(favorites);
  const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const list = models.filter(model => {
    if (folder && !model.path.startsWith(folder.endsWith('/') ? folder : folder + '/')) return false;
    if (category === 'favorites' && !favoriteIDs.has(model.id)) return false;
    if (category === 'creature' && !/^(?:models\/)?creature\//i.test(model.path)) return false;
    if (['beast', 'mount', 'companion'].includes(category) && !model[category]) return false;
    if (table === 'yes' && !model.inBetaTables) return false;
    if (table === 'no' && model.inBetaTables) return false;
    const search = `${model.name} ${model.path} ${model.id} ${(model.names || []).join(' ')}`.toLowerCase();
    return words.every(word => search.includes(word));
  });
  const key = {id:'id',size:'size',skins:'appearanceCount',table:'inBetaTables'}[sort];
  const value = model => Number(model[key]);
  list.sort((a, b) => {
    const primary = sort === 'folder' ? collator.compare(a.path.slice(0,a.path.lastIndexOf('/')),b.path.slice(0,b.path.lastIndexOf('/'))) : sort === 'name' ? collator.compare(a.name, b.name) : value(a) - value(b);
    return (direction === 'desc' ? -primary : primary) || collator.compare(a.name, b.name) || a.id - b.id;
  });
  return list;
}
