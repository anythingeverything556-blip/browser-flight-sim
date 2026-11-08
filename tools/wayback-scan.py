#!/usr/bin/env python3
"""Scan major airports for an archived Esri World Imagery Wayback release sharper than today's imagery.

Usage: python3 tools/wayback-scan.py [--workdir /tmp/wb] [--out public/data/wayback.json] [--max-airports 400] [--only ICAO,ICAO] [--no-shots]
Needs Pillow (pip install pillow) for the tile sharpness gate, tile verification and side-by-side shots.
A release is accepted only if its metadata says >=15 % finer at every sampled point AND its z19 tile has >=1.15x the edge energy of today's Esri tile (the nominal capture resolution alone is misleading: legacy 0.31 m "Metro" tiles are softer than today's "Vivid Advanced" 0.5 m).
Per-airport results are cached in <workdir>/cache and raw tilemap/identify answers in <workdir>/http so an interrupted run resumes; delete both to rescan from scratch.
"""
import argparse, hashlib, io, json, math, os, re, sys, threading, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

CONFIG_URL = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json'
TILEMAP = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap/{r}/{z}/{y}/{x}/1/1'
TEMPLATES = [
    'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{release}/{z}/{y}/{x}',
    'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{release}/{z}/{y}/{x}',
]
CURRENT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
ORIGIN = 'https://sr71-blackbird.pages.dev'
UA = {'User-Agent': 'Mozilla/5.0 (blackbird-wayback-scan)'}
Z = 19
MIN_GAIN = 0.15
MIN_YEAR = 2018
PAD_M = 2000
HTTP_SLOTS = threading.BoundedSemaphore(6)

BUSY_IATA = set('''ATL DFW DEN ORD LAX JFK LAS MCO MIA CLT SEA PHX EWR SFO IAH BOS FLL MSP LGA DTW PHL SLC BWI DCA SAN IAD TPA BNA AUS MDW HNL DAL PDX STL RDU SMF SJC OAK MSY MCI SAT SNA CLE PIT IND CMH CVG MKE BDL ABQ ANC
YYZ YVR YUL YYC YEG YOW YWG YHZ MEX CUN GDL MTY TIJ SJO PTY BOG MDE LIM SCL EZE GRU GIG CGH BSB CNF REC SSA FOR POA CWB VCP UIO GYE CCS MVD ASU LPB HAV SJU NAS PUJ SDQ KIN MBJ
LHR LGW MAN STN LTN EDI GLA BHX BRS NCL LPL DUB ORK CDG ORY NCE LYS MRS TLS BOD NTE AMS BRU FRA MUC DUS HAM BER STR CGN HAJ NUE LEJ ZRH GVA BSL VIE MAD BCN AGP PMI ALC VLC SVQ LIS OPO FAO
FCO MXP LIN VCE NAP CTA PMO BLQ FLR PSA TRN ATH SKG IST SAW AYT ESB ADB CPH ARN GOT OSL BGO HEL KEF WAW KRK PRG BUD OTP SOF BEG ZAG LJU SKP TIA RIX VNO TLL KBP SVO DME VKO LED SVX OVB KJA AER KRR TBS EVN GYD TAS ALA NQZ
TLV AMM BEY CAI HRG SSH CMN RAK ALG TUN LOS ABV ACC DKR ABJ ADD NBO MBA DAR EBB KGL JNB CPT DUR LAD MPM WDH GBE LUN HRE DXB AUH DWC SHJ DOH BAH KWI MCT RUH JED DMM MED THR IKA MHD SHI
KHI LHE ISB DEL BOM BLR MAA HYD CCU COK AMD GOI PNQ JAI LKO GAU TRV CMB MLE DAC KTM BKK DMK HKT CNX SIN KUL PEN CGK DPS SUB MNL CEB SGN HAN DAD HKG MFM TPE KHH PEK PKX PVG SHA CAN SZX CTU CKG KMG XIY WUH CSX
HGH NKG TAO TSN CGO SHE DLC HRB URC LHW ICN GMP PUS CJU NRT HND KIX ITM NGO FUK CTS OKA SYD MEL BNE PER ADL CBR OOL AKL WLG CHC NAN'''.split())


def http(url, headers=None, timeout=40, tries=4, want_headers=False):
    last = None
    for i in range(tries):
        try:
            with HTTP_SLOTS:
                req = urllib.request.Request(url, headers={**UA, **(headers or {})})
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    body = r.read()
                    return (r.status, dict(r.headers), body, r.geturl()) if want_headers else body
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (400, 403, 404):
                if want_headers:
                    return e.code, dict(e.headers), b'', url
                raise
        except Exception as e:
            last = e
        time.sleep(1.5 * 2 ** i)
    if want_headers:
        return 0, {}, b'', url
    raise last


HTTP_CACHE_DIR = None


def http_cached(url):
    if HTTP_CACHE_DIR is None:
        return http(url)
    path = os.path.join(HTTP_CACHE_DIR, hashlib.md5(url.encode()).hexdigest())
    if os.path.exists(path):
        return open(path, 'rb').read()
    body = http(url)
    with open(path + '.tmp', 'wb') as f:
        f.write(body)
    os.replace(path + '.tmp', path)
    return body


def tile_xy(lon, lat, z=Z):
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def haversine(a, b, c, d):
    p = math.radians
    h = math.sin(p(c - a) / 2) ** 2 + math.cos(p(a)) * math.cos(p(c)) * math.sin(p(d - b) / 2) ** 2
    return 12742000 * math.asin(math.sqrt(h))


class Wayback:
    def __init__(self, workdir):
        path = os.path.join(workdir, 'waybackconfig.json')
        if not os.path.exists(path):
            open(path, 'wb').write(http(CONFIG_URL))
        self.cfg = json.load(open(path))
        rel = []
        for k, v in self.cfg.items():
            m = re.search(r'\((?:Wayback )?(\d{4}-\d\d-\d\d)', v['itemTitle'])
            if m:
                rel.append((m.group(1), int(k)))
        self.rel = sorted(rel)
        self.rel_date = {r: d for d, r in self.rel}
        self.index = {r: i for i, (d, r) in enumerate(self.rel)}
        self.newest = self.rel[-1][1]
        self.tm_cache = {}

    def tilemap(self, r, z, y, x):
        key = (r, z, y, x)
        if key not in self.tm_cache:
            d = json.loads(http_cached(TILEMAP.format(r=r, z=z, y=y, x=x)))
            self.tm_cache[key] = (d['data'][0], (d.get('select') or [None])[0])
        return self.tm_cache[key]

    def versions(self, lon, lat, z=Z):
        x, y = tile_xy(lon, lat, z)
        out, i = [], len(self.rel) - 1
        while i >= 0:
            has, sel = self.tilemap(self.rel[i][1], z, y, x)
            if not has:
                break
            sel = int(sel) if sel is not None else self.rel[i][1]
            if sel not in self.index:
                break
            si = self.index[sel]
            out.append((self.rel[si][0], sel))
            i = si - 1
        return out

    def current(self, lon, lat):
        x, y = tile_xy(lon, lat)
        has, sel = self.tilemap(self.newest, Z, y, x)
        return self.meta(int(sel) if sel is not None else self.newest, lon, lat) if has else None

    def meta(self, r, lon, lat):
        base = self.cfg[str(r)]['metadataLayerUrl']
        ext = f'{lon - 0.001},{lat - 0.001},{lon + 0.001},{lat + 0.001}'
        u = (f'{base}/identify?geometry={lon},{lat}&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=0'
             f'&mapExtent={ext}&imageDisplay=1000,1000,96&returnGeometry=false&f=json')
        try:
            res = [x['attributes'] for x in json.loads(http_cached(u))['results']]
        except Exception:
            return None
        good = [a for a in res if parse_res(a) is not None and parse_res(a) < 10 and covers_zoom(a)]
        if not good:
            return None
        a = min(good, key=parse_res)
        return dict(res=parse_res(a), date=parse_date(a), src=a.get('NICE_DESC'), sensor=a.get('SRC_DESC'),
                    maxz=a.get('MaxMapLevel'), name=a.get('NICE_NAME'))


def covers_zoom(a):
    try:
        return int(a.get('MinMapLevel')) <= Z <= int(a.get('MaxMapLevel'))
    except (TypeError, ValueError):
        return False


def parse_res(a):
    try:
        v = float(a.get('SRC_RES'))
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def parse_date(a):
    s = a.get('SRC_DATE2')
    if isinstance(s, str):
        for fmt in ('%m/%d/%Y', '%Y-%m-%d', '%Y/%m/%d'):
            try:
                return datetime.strptime(s.strip(), fmt).strftime('%Y-%m-%d')
            except ValueError:
                pass
    ms = a.get('SRC_DATE')
    if isinstance(ms, (int, float)) and ms > 0:
        return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime('%Y-%m-%d')
    return None


def usable_candidate(m):
    if not m or not m.get('date') or int(m['date'][:4]) < MIN_YEAR:
        return False
    text = f"{m.get('sensor') or ''} {m.get('src') or ''} {m.get('name') or ''}".lower()
    if 'landsat' in text or m['res'] >= 10:
        return False
    try:
        if m.get('maxz') not in (None, '') and int(m['maxz']) < Z:
            return False
    except ValueError:
        pass
    return True


def pick_airports(path, limit):
    data = json.load(open(path))
    rows = []
    for a in data:
        if a[5] != 0 or not a[9]:
            continue
        runs = []
        for r in a[9]:
            runs.append((haversine(r[2], r[3], r[4], r[5]), r))
        length, longest = max(runs, key=lambda t: t[0])
        rows.append(dict(id=a[0], iata=a[1], name=a[2], lat=a[6], lon=a[7], length=length, runway=longest,
                         runways=len(a[9]), busy=a[1] in BUSY_IATA))
    big = [r for r in rows if r['length'] >= 2800 or r['busy']]
    for r in big:
        r['score'] = (100 if r['busy'] else 0) + r['length'] / 1000 + 0.4 * r['runways'] + (2 if 'International' in r['name'] else 0)
    big.sort(key=lambda r: (-r['score'], r['id']))
    return big[:limit], len(rows), len(big)


def sample_points(a):
    r = a['runway']
    pts = [(a['lon'], a['lat'])]
    if a['length'] > 300:
        pts += [(r[3], r[2]), (r[5], r[4])]
    else:
        pts += [(a['lon'], a['lat'])] * 2
    return pts


def short_name(n):
    n = re.sub(r'\s+(International\s+)?(Airport|Airfield|Air Base)$', '', n.strip())
    return n or 'Airport'


def bbox(points):
    lats = [p[1] for p in points]
    lons = [p[0] for p in points]
    mid = (min(lats) + max(lats)) / 2
    dlat = PAD_M / 111320
    dlon = PAD_M / (111320 * max(math.cos(math.radians(mid)), 0.05))
    return [round(min(lons) - dlon, 4), round(min(lats) - dlat, 4), round(max(lons) + dlon, 4), round(max(lats) + dlat, 4)]


MIN_SHARP_RATIO = 1.15
MIN_POINT_SHARP_RATIO = 0.9


def edge_energy(body):
    from PIL import Image, ImageChops, ImageFilter, ImageStat
    img = Image.open(io.BytesIO(body)).convert('L')
    lap = img.filter(ImageFilter.Kernel((3, 3), [-1, -1, -1, -1, 8, -1, -1, -1, -1], 1, 128))
    return ImageStat.Stat(ImageChops.difference(lap, Image.new('L', lap.size, 128))).mean[0]


def sharpness(rid, pts):
    out = []
    for p in pts:
        x, y = tile_xy(*p)
        try:
            cand = edge_energy(http(TEMPLATES[0].format(release=rid, z=Z, y=y, x=x)))
            live = edge_energy(http(CURRENT_URL.format(z=Z, y=y, x=x)))
        except Exception:
            out.append(None)
            continue
        out.append(dict(cand=round(cand, 2), live=round(live, 2)))
    known = [q for q in out if q and q['live'] > 1 and q['cand'] > 1]
    ok = (len(known) >= 2 and sum(q['cand'] for q in known) >= MIN_SHARP_RATIO * sum(q['live'] for q in known)
          and all(q['cand'] >= MIN_POINT_SHARP_RATIO * q['live'] for q in known))
    return ok, out


def scan_airport(wb, a):
    pts = sample_points(a)
    log = dict(id=a['id'], iata=a['iata'], name=a['name'], length=round(a['length']), points=[list(p) for p in pts])
    ref = pts[0]
    vs = wb.versions(*ref)
    metas = list(ThreadPoolExecutor(6).map(lambda v: wb.meta(v[1], *ref), vs))
    log['versions'] = [dict(rel=v[0], id=v[1], **(m or {})) for v, m in zip(vs, metas)]
    cur_ref = metas[0] if metas else None
    log['cur_ref'] = cur_ref
    if not cur_ref:
        return dict(log, ok=False, reason='no current metadata')
    cands = [(m, v) for v, m in zip(vs, metas) if usable_candidate(m) and m['res'] <= cur_ref['res'] * (1 - MIN_GAIN) + 1e-9]
    cands.sort(key=lambda t: (t[0]['res'], tuple(-int(c) for c in t[0]['date'].replace('-', ''))))
    if not cands:
        return dict(log, ok=False, reason='no release >=15% finer at reference point')
    tried = []
    for m, v in cands[:4]:
        rid = v[1]
        per_point = [dict(res=m['res'], cur=cur_ref['res'])]
        for p in pts[1:]:
            cm, cu = wb.meta(rid, *p), wb.current(*p)
            per_point.append(dict(res=cm and cm['res'], cur=cu and cu['res'], date=cm and cm['date'], usable=bool(usable_candidate(cm))))
        known = [q for q in per_point if q['res'] is not None and q['cur'] is not None]
        ok = len(known) >= 2 and all(q['res'] <= q['cur'] * (1 - MIN_GAIN) + 1e-9 and q.get('usable', True) for q in known)
        sharp_ok, sharp = sharpness(rid, pts) if ok else (False, None)
        tried.append(dict(release=rid, rel=v[0], per_point=per_point, ok=ok, sharp_ok=sharp_ok, sharp=sharp))
        if ok and sharp_ok:
            log['tried'] = tried
            return dict(log, ok=True, release=rid, release_date=v[0], res=max(q['res'] for q in known), cur=min(q['cur'] for q in known),
                        date=m['date'], sensor=m.get('sensor'), src=m.get('src'), bbox=bbox(pts))
    return dict(log, ok=False, reason='no candidate passed the metadata and tile sharpness checks', tried=tried)


def blank(img):
    small = img.convert('RGB').resize((64, 64))
    return len(small.getcolors(4096)) < 60


def verify(res, shots_dir, use_shots=True):
    from PIL import Image
    rid = res['release']
    x, y = tile_xy(*res['points'][0])
    for ti, tpl in enumerate(TEMPLATES):
        url = tpl.format(release=rid, z=Z, y=y, x=x)
        st, hd, body, final = http(url, headers={'Origin': ORIGIN}, want_headers=True)
        h = {k.lower(): v for k, v in hd.items()}
        info = dict(template=tpl, url=url, status=st, acao=h.get('access-control-allow-origin'),
                    ctype=h.get('content-type'), final=final, bytes=len(body))
        if st != 200:
            info['fail'] = f'HTTP {st}'
        elif info['acao'] not in ('*', ORIGIN):
            info['fail'] = f"ACAO {info['acao']}"
        elif not (info['ctype'] or '').startswith('image/'):
            info['fail'] = f"content-type {info['ctype']}"
        else:
            try:
                img = Image.open(io.BytesIO(body))
                img.load()
                if blank(img):
                    info['fail'] = 'blank or no-data tile'
                else:
                    info['ok'] = True
                    if use_shots:
                        cur = Image.open(io.BytesIO(http(CURRENT_URL.format(z=Z, y=y, x=x)))).convert('RGB')
                        w = img.convert('RGB')
                        sheet = Image.new('RGB', (w.width + cur.width, max(w.height, cur.height)))
                        sheet.paste(w, (0, 0))
                        sheet.paste(cur, (w.width, 0))
                        sheet.save(os.path.join(shots_dir, res['id'] + '.jpg'), quality=90)
                    return info
            except Exception as e:
                info['fail'] = f'decode {e}'
        info['template_index'] = ti
        res.setdefault('verify_failures', []).append(info)
    return None


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument('--workdir', default='/tmp/wb')
    ap.add_argument('--airports', default=os.path.join(here, '..', 'public', 'data', 'airports.json'))
    ap.add_argument('--out', default=os.path.join(here, '..', 'public', 'data', 'wayback.json'))
    ap.add_argument('--max-airports', type=int, default=400)
    ap.add_argument('--only', default='')
    ap.add_argument('--no-shots', action='store_true')
    ap.add_argument('--workers', type=int, default=6)
    args = ap.parse_args()
    shots = os.path.join(args.workdir, 'shots')
    cache = os.path.join(args.workdir, 'cache')
    os.makedirs(shots, exist_ok=True)
    os.makedirs(cache, exist_ok=True)
    global HTTP_CACHE_DIR
    HTTP_CACHE_DIR = os.path.join(args.workdir, 'http')
    os.makedirs(HTTP_CACHE_DIR, exist_ok=True)
    wb = Wayback(args.workdir)
    chosen, n_large, n_big = pick_airports(args.airports, args.max_airports)
    if args.only:
        want = set(args.only.split(','))
        chosen = [a for a in chosen if a['id'] in want]
    print(f'{len(chosen)} airports chosen ({n_big} large airports with a >=2800 m runway or busy; {n_large} type-0 total); newest release {wb.newest}', flush=True)
    t0, done = time.time(), [0]

    def work(a):
        path = os.path.join(cache, a['id'] + '.json')
        if os.path.exists(path):
            res = json.load(open(path))
        else:
            try:
                res = scan_airport(wb, a)
            except Exception as e:
                res = dict(id=a['id'], ok=False, reason=f'error {e!r}', error=True)
            if not res.get('error'):
                json.dump(res, open(path, 'w'))
        done[0] += 1
        if done[0] % 10 == 0 or res.get('ok'):
            print(f"[{done[0]}/{len(chosen)} {time.time() - t0:.0f}s] {a['id']} {'ACCEPT ' + str(res.get('release')) + ' ' + str(res.get('cur')) + '->' + str(res.get('res')) if res.get('ok') else res.get('reason')}", flush=True)
        return a, res

    with ThreadPoolExecutor(args.workers) as ex:
        results = list(ex.map(work, chosen))

    accepted = [(a, r) for a, r in results if r.get('ok')]

    def check(item):
        a, r = item
        v = verify(r, shots, not args.no_shots)
        r['verified'] = v
        return item

    with ThreadPoolExecutor(args.workers) as ex:
        list(ex.map(check, accepted))
    areas, template = [], None
    for a, r in accepted:
        v = r.get('verified')
        if not v:
            continue
        template = template or v['template']
        areas.append(dict(id=a['id'], name=short_name(a['name']), bbox=r['bbox'], release=r['release'],
                          res=round(r['res'], 2), cur=round(r['cur'], 2), date=r['date']))
    areas.sort(key=lambda d: d['id'])
    template = template or TEMPLATES[0]
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w') as f:
        f.write('{"generated": %s, "source": %s, "template": %s,\n "areas": [\n' % (
            json.dumps(datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')),
            json.dumps('Esri World Imagery Wayback (waybackconfig.json)'), json.dumps(template)))
        f.write(',\n'.join('  ' + json.dumps(d, separators=(', ', ': ')) for d in areas))
        f.write('\n]}\n')
    json.dump([r for a, r in results], open(os.path.join(args.workdir, 'scan-log.json'), 'w'), indent=1)
    failed = [(a['id'], r.get('verify_failures')) for a, r in accepted if not r.get('verified')]
    print(f'scanned {len(results)}, accepted {len(accepted)}, verified {len(areas)}, verification failed {len(failed)}, errors {sum(1 for a, r in results if r.get("error"))}, {time.time() - t0:.0f}s', flush=True)


if __name__ == '__main__':
    main()
