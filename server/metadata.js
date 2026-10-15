'use strict';
const {readDB} = require('./db2');
class Metadata {
  constructor(archive, catalog) {this.archive=archive;this.catalog=catalog;this.tables=new Map();}
  table(name) {
    if(!this.tables.has(name))this.tables.set(name,readDB(this.archive,name).then(result=>result.rows));
    return this.tables.get(name);
  }
  async get(id) {
    const entry=this.catalog.models.get(id);
    if(!entry)throw Object.assign(new Error('This file is outside the selected model folders.'),{code:'OUTSIDE_CATALOG'});
    const tables=this.catalog.tables;
    const modelRows=[...tables.CreatureModelData.values()].filter(row=>row.FileDataID===id);
    const modelIDs=new Set(modelRows.map(row=>row.ID));
    const displays=[...tables.CreatureDisplayInfo.values()].filter(row=>modelIDs.has(row.ModelID));
    const displayIDs=new Set(displays.map(row=>row.ID));
    const creatures=[...tables.Creature.values()].filter(row=>row.DisplayID?.some(id=>displayIDs.has(id)));
    const mounts=[...tables.MountXDisplay.values()].filter(row=>displayIDs.has(row.CreatureDisplayInfoID)).map(link=>({link,mount:tables.Mount.get(link.MountID)}));
    const creatureIDs=new Set(creatures.map(row=>row.ID));
    const companions=[...tables.BattlePetSpecies.values()].filter(row=>creatureIDs.has(row.CreatureID));
    const references=this.catalog.referenceIDs.get(id);
    const itemDisplays=[...(references?.item||[])].map(rowID=>tables.ItemDisplayInfo.get(rowID)).filter(Boolean);
    const characterModels=[...(references?.character||[])].map(rowID=>tables.ChrModel.get(rowID)).filter(Boolean);
    const fileMappings=[...tables.ModelFileData.values()].filter(row=>row.FileDataID===id);
    const notes=[],sounds=[],soundRows=[];
    try {
      const soundData=await this.table('CreatureSoundData');
      for(const soundID of new Set(modelRows.map(row=>row.SoundID).filter(Boolean))) {
        const row=soundData.get(soundID);if(row)soundRows.push(row);
      }
      if(soundRows.length) {
        const kits=new Map();
        for(const row of soundRows)for(const [field,value]of Object.entries(row)) {
          if(field==='ID'||field==='CreatureSoundDataIDPet'||!/Sound|Fidget|CustomAttack/.test(field)||/Delay|Type|Scale/.test(field))continue;
          for(const id of Array.isArray(value)?value:[value])if(id>0){if(!kits.has(id))kits.set(id,new Set());kits.get(id).add(field);}
        }
        const entries=await this.table('SoundKitEntry');
        for(const row of entries.values())if(kits.has(row.SoundKitID)&&row.FileDataID) {
          sounds.push({id:row.FileDataID,path:this.archive.names.get(row.FileDataID)||null,installed:!!this.archive.files.get(row.FileDataID)?.local,soundKitID:row.SoundKitID,uses:[...kits.get(row.SoundKitID)]});
        }
      }
    } catch(error) {notes.push('Sound metadata: '+error.message);}
    return {
      entry,generatedPath:/\/unk_|\/encrypted\d/i.test(entry.path),names:entry.names,
      modelIDs:[...modelIDs],displayIDs:[...displayIDs],itemDisplayIDs:itemDisplays.map(row=>row.ID),characterModelIDs:characterModels.map(row=>row.ID),sounds,notes,
      raw:{CreatureModelData:modelRows,CreatureDisplayInfo:displays,Creature:creatures,Mount:mounts,BattlePetSpecies:companions,CreatureSoundData:soundRows,ItemDisplayInfo:itemDisplays,ModelFileData:fileMappings,ChrModel:characterModels}
    };
  }
}
module.exports={Metadata};
