#!/usr/bin/env python3
"""Expose original per-sampler animation time ranges without rewriting any samples."""
import pathlib,json,sys
p=pathlib.Path(sys.argv[1]);models={}
for name in ['a380_exterior','a380_cockpit']:
 g=json.loads((p/f'{name}.native.gltf').read_text());clips=[]
 for a in g['animations']:
  samplers=[{'min':g['accessors'][s['input']]['min'][0],'max':g['accessors'][s['input']]['max'][0],'interpolation':s.get('interpolation','LINEAR')} for s in a['samplers']]
  clips.append({'name':a.get('name'),'minTime':min(s['min'] for s in samplers),'maxTime':max(s['max'] for s in samplers),'samplers':samplers,'targets':[{'node':c['target']['node'],'name':g['nodes'][c['target']['node']].get('name'),'path':c['target']['path'],'sampler':c['sampler']} for c in a['channels']]})
 models[name]=clips
(p/'animation-contract.json').write_text(json.dumps({'models':models,'warning':'Source MSFS clips have different time ranges; some include negative times. No samples were shifted/clamped. Do not assume a uniform 0..1 domain or start every clip. Use each clip/sampler domain and desired aircraft state.'},indent=2))
print('Original animation domains documented:',sum(len(x) for x in models.values()))
