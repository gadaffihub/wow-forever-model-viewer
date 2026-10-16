import {allRoots} from './catalog.mjs';

export const defaultSettings = Object.freeze({
  autoplayAnimations: false,
  autoplaySounds: true,
  cycleSkins: false,
  skinInterval: 5,
  startupFolder: 'last'
});

function validFolder(folder) {
  if (folder === '') return true; // Archive root: all models and sounds.
  return typeof folder === 'string' && allRoots.some(root => folder.startsWith(root))
    && folder.endsWith('/') && !folder.split('/').slice(0, -1).some(part => !part || part === '.' || part === '..');
}

export function normalizeSettings(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const result = {...defaultSettings};
  for (const key of ['autoplayAnimations', 'autoplaySounds', 'cycleSkins']) if (typeof raw[key] === 'boolean') result[key] = raw[key];
  if (Number.isFinite(raw.skinInterval)) result.skinInterval = Math.max(1, Math.min(60, Math.round(raw.skinInterval)));
  if (raw.startupFolder === 'last' || validFolder(raw.startupFolder)) result.startupFolder = raw.startupFolder;
  return result;
}

export function startupFolder(settings, previousFolder) {
  return settings.startupFolder === 'last' ? (validFolder(previousFolder) ? previousFolder : 'creature/') : settings.startupFolder;
}
