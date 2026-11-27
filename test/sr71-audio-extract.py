"""Extract original file-backed aft/interior engine components and authored curves.
Uses the already installed maintained wwiser dump + vgmstream r2168 decoder.
No new lossy encoding, resampling, normalization, tone generation or source edits.
"""
from pathlib import Path
import xml.etree.ElementTree as E,json,struct,subprocess,wave,hashlib,math
BASE=Path('/home/sr71-viewer/v2/original-av'); OUT=Path(__file__).resolve().parents[1]/'public/models/sr71/audio'
OUT.mkdir(parents=True,exist_ok=True)
root=E.parse(BASE/'banks.xml').getroot(); O={int(f.get('value')):o for o in root.iter('object') if (f:=o.find("field[@name='ulID']")) is not None}
def val(o,n,default=0):
 f=o.find(".//field[@name='%s']"%n);return float(f.get('value')) if f is not None else default
def curve(o):return [[val(p,'From'),val(p,'To'),int(val(p,'Interp'))] for p in o.findall(".//object[@name='AkRTPCGraphPoint']")]
def data(i):
 o=O[i]; props={}
 for b in o.findall(".//object[@name='NodeInitialParams']//object[@name='AkPropBundle']"):
  if b.find("field[@name='pID']") is not None:props[int(val(b,'pID'))]=val(b,'pValue')
 rtpc=[]
 for r in o.findall(".//object[@name='RTPC']"):
  f=r.find("field[@name='RTPCID']");rtpc.append(dict(id=int(f.get('value')),name=f.get('hashname'),param=int(val(r,'ParamID')),scaling=int(val(r,'eScaling')),accum=int(val(r,'rtpcAccum')),points=curve(r)))
 layers=[]
 for l in o.findall(".//object[@name='CAkLayer']"):
  for a in l.findall(".//object[@name='CAssociatedChildData']"):layers.append(dict(id=int(val(l,'rtpcID')),child=int(val(a,'ulAssociatedChildID')),points=curve(a)))
 return dict(id=i,kind=o.get('name'),parent=int(val(o,'DirectParentID')),props=props,rtpc=rtpc,layers=layers)
nodes={};clips=[];skipped=[]
def ancestors(i):
 path=[]
 while i and i in O:
  nodes[i]=data(i);path.insert(0,i);i=nodes[i]['parent']
 return path
def visit(i,view,event):
 o=O[i]
 if o.get('name')=='CAkSound':
  plugin=int(val(o,'ulPluginID'));mid=int(val(o,'sourceID'))
  if plugin!=0x40001:skipped.append(dict(sound=i,source=mid,plugin=plugin,reason='not original file-backed Vorbis; never synthesize'));return
  path=ancestors(i);clips.append(dict(sound=i,media=mid,view=view,event=event,path=path,file=str(mid)+'.flac'))
 else:
  for f in o.iter('field'):
   if f.get('name') in ('ulActionID','idExt','ulChildID') and int(f.get('value')) in O:visit(int(f.get('value')),view,event)
for event,view in [(523596066,'outside'),(889379278,'inside')]:visit(event,view,event)
b=(BASE/'extracted/Blackbird_SR71.PC_707255981.bnk').read_bytes(); chunks={};pos=0
while pos+8<=len(b):
 tag=b[pos:pos+4].decode();size=struct.unpack_from('<I',b,pos+4)[0];chunks[tag]=(pos+8,size);pos+=8+size
ix,sz=chunks['DIDX'];media={mid:(chunks['DATA'][0]+off,size) for mid,off,size in (struct.unpack_from('<III',b,i) for i in range(ix,ix+sz,12))}
samples=[];work=Path('/home/earthwing-sr71-integration/audio-proof/source-verification');work.mkdir(exist_ok=True)
for mid in sorted({c['media'] for c in clips}):
 off,size=media[mid];wem=work/(str(mid)+'.wem');wav=work/(str(mid)+'.wav');flac=OUT/(str(mid)+'.flac');wem.write_bytes(b[off:off+size])
 p=subprocess.run([str(BASE/'tools/vgmstream/vgmstream-cli'),'-i','-o',str(wav),str(wem)],check=True,capture_output=True,text=True)
 (work/(str(mid)+'.txt')).write_text(p.stdout+p.stderr)
 subprocess.run(['ffmpeg','-v','error','-y','-i',str(wav),'-c:a','flac','-compression_level','8',str(flac)],check=True)
 with wave.open(str(wav)) as w:pcm=w.readframes(w.getnframes());rate=w.getframerate();channels=w.getnchannels();frames=w.getnframes()
 check=subprocess.run(['ffmpeg','-v','error','-i',str(flac),'-f','s16le','-'],check=True,capture_output=True).stdout;assert check==pcm
 s=struct.unpack('<'+'h'*(len(pcm)//2),pcm);rms=math.sqrt(sum(x*x for x in s)/len(s))/32768
 samples.append(dict(media=mid,file=str(mid)+'.flac',bankOffset=off,packageOffset=off+80,sourceBytes=size,wemSha256=hashlib.sha256(wem.read_bytes()).hexdigest(),pcmSha256=hashlib.sha256(pcm).hexdigest(),flacSha256=hashlib.sha256(flac.read_bytes()).hexdigest(),pcmMatches=True,rate=rate,channels=channels,frames=frames,seconds=frames/rate,rms=rms,peak=max(abs(x) for x in s)/32768,bytes=flac.stat().st_size))
manifest=dict(version=1,scope='Original file-backed aft and interior engine components; partial Wwise behavior, NOT complete MSFS/Wwise mix',packageSha256='7bf16fb843873c744610633b4bee1a2307b746836a5d0293de21dd9b98d38f21',bank=707255981,events={'outside':[523596066,3743274617],'inside':[889379278,4275902489]},nodes=list(nodes.values()),clips=clips,samples=samples,skipped=skipped,limitations=['Tone generators excluded','Missing shared init/buses/effects/loudness normalization not reproduced','Unknown RTPC IDs are retained in manifest but not guessed at runtime','N2 uses Earthwing dry spool mapped 55..100, not an original SR71 WASM engine model','External view currently uses original aft graph only, not front/side directivity'])
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(len(clips),'file-backed sound objects;',len(samples),'unique samples;',sum(s['bytes']for s in samples),'FLAC bytes; all PCM equal')
