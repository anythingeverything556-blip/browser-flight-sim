import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAtis } from '../src/atc.js';
import {
  fetchMetar, interpretMetar, isFreshMetar, liveWeather, METAR_MAX_AGE_MS,
  metarObservationTime, metarVisibility, modelWeather, nearestMetar, parseMetar,
} from '../src/metar.js';

const NOW = Date.parse('2026-11-26T16:30:00Z');
const apt = { ident: 'NFNL', lat: -16.47, lon: 179.34, elev: 1000 };
const report = (overrides = {}) => ({
  icaoId: 'NFNL', obsTime: NOW / 1000 - 1800, lat: apt.lat, lon: apt.lon, elev: 36,
  wdir: 180, wspd: 12, wgst: 20, visib: 0.19, clouds: [{ cover: 'OVX', base: 200 }],
  wxString: 'FG', temp: 2, dewp: 1, altim: 1013,
  rawOb: 'NFNL 261600Z 18012G20KT 0300 FG VV002 02/01 Q1013', ...overrides,
});
const model = (overrides = {}) => ({
  current: { time: '2026-11-26T16:15', temperature_2m: 22.8, dew_point_2m: 20,
    wind_speed_10m: 2, wind_direction_10m: 139, wind_gusts_10m: 5,
    cloud_cover: 45, cloud_cover_low: 45, cloud_cover_mid: 0, cloud_cover_high: 0,
    weather_code: 2, visibility: 40000, pressure_msl: 1015, ...overrides },
});
async function fixture(responder, fn) {
  const oldFetch = globalThis.fetch, oldNow = Date.now;
  const requests = [];
  Date.now = () => NOW;
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const data = await responder(String(url), requests);
    return { ok: true, json: async () => data };
  };
  try { return await fn(requests); }
  finally { globalThis.fetch = oldFetch; Date.now = oldNow; }
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

await test('ENV-01 rejects stale, absent, invalid and excessive future observation timestamps', () => {
  const fresh = report();
  assert.ok(isFreshMetar(fresh, NOW));
  assert.ok(isFreshMetar({ obsTime: NOW - METAR_MAX_AGE_MS }, NOW));
  assert.equal(isFreshMetar({ obsTime: NOW - METAR_MAX_AGE_MS - 1 }, NOW), false);
  assert.equal(isFreshMetar(report({ obsTime: Date.parse('2026-11-26T04:00:00Z') / 1000 }), NOW), false);
  for (const obsTime of ['garbage', NaN, Infinity, -1, 0, '2026-11-26T16:00:00',
    '2026-02-30T16:00:00Z', '2026-11-26T24:00:00Z', '2026-11-26T17:00:00Z']) {
    assert.equal(isFreshMetar(report({ obsTime }), NOW), false, String(obsTime));
  }
  assert.equal(isFreshMetar({}, NOW), false);
  assert.equal(isFreshMetar({ rawOb: 'NFNL /////Z 00000KT CAVOK' }, NOW), false);
  assert.ok(isFreshMetar({ obsTime: '2026-11-27T05:00:00+13:00' }, NOW));
  assert.ok(isFreshMetar({ obsTime: '2026-11-26T16:34:00Z' }, NOW));
});

await test('ENV-01 raw UTC day fallback handles month/year/leap rollover and fails safe', () => {
  for (const [now, raw, expected] of [
    ['2026-12-01T00:20:00Z', 'NFNL 302350Z 00000KT CAVOK', '2026-11-30T23:50:00Z'],
    ['2027-01-01T00:20:00Z', 'NFNL 312350Z 00000KT CAVOK', '2026-12-31T23:50:00Z'],
    ['2028-03-01T00:20:00Z', 'NFNL 292350Z 00000KT CAVOK', '2028-02-29T23:50:00Z'],
    ['2026-12-01T00:20:00Z', 'NFNL 302350Z=', '2026-11-30T23:50:00Z'],
  ]) {
    const instant = Date.parse(now);
    assert.equal(metarObservationTime({ rawOb: raw }, instant), Date.parse(expected));
    assert.ok(isFreshMetar({ rawOb: raw }, instant));
  }
  assert.equal(isFreshMetar({ rawOb: 'NFNL 312350Z 00000KT CAVOK' }, Date.parse('2026-12-01T00:20:00Z')), false);
  for (const stamp of ['002350', '262460', '269960', '271630']) {
    assert.equal(isFreshMetar({ rawOb: `NFNL ${stamp}Z 00000KT CAVOK` }, NOW), false);
  }
});

await test('ENV-01 NFNL twelve-hour report falls through to newest report of nearest fresh station', async () => {
  const stale = report({ obsTime: Date.parse('2026-11-26T04:00:00Z') / 1000 });
  const nearby = report({ icaoId: 'NFNA', lat: apt.lat + 0.2, obsTime: NOW / 1000 - 600, elev: 36 });
  const older = { ...nearby, obsTime: NOW / 1000 - 3600, wspd: 3 };
  await fixture((url) => url.includes('ids=') ? [stale] : [stale, older, nearby], async (requests) => {
    const { w, source, km } = await liveWeather(apt);
    assert.equal(source, 'nearest METAR NFNA');
    assert.equal(requests.length, 2);
    assert.ok(km > 0 && km < 30);
    assert.equal(w.windKt, 12);
    near(w.baseM, 36 + 200 * 0.3048);
    assert.equal(w.stationElevationM, 36);
    assert.equal(w.observationAgeMinutes, 10);
    assert.equal(w.visibilityMeters, 300);
  });
});

await test('ENV-01 freshest exact record wins, independent of provider order', async () => {
  await fixture(() => [report({ obsTime: NOW / 1000 - 5400, wspd: 3 }), report()], async () => {
    const m = await fetchMetar('NFNL');
    assert.equal(m.wspd, 12);
    const result = await liveWeather(apt);
    assert.equal(result.source, 'METAR NFNL');
    assert.equal(result.w.windKt, 12);
  });
});

await test('ENV-01 nearest chooses fresh nearest, skips invalid coordinates and stale closest', async () => {
  await fixture(() => [report({ obsTime: NOW / 1000 - 50000 }),
    report({ icaoId: 'NFFF', lat: apt.lat + 0.7, obsTime: NOW / 1000 - 60 }),
    report({ icaoId: 'NFNA', lat: apt.lat + 0.2 }),
    report({ icaoId: 'BADX', lat: 'not-a-coordinate' })], async () => {
    assert.equal((await nearestMetar(apt.lat, apt.lon)).m.icaoId, 'NFNA');
  });
});

await test('ENV-01 only stale or untimestamped METARs leads to model, never stale live weather', async () => {
  await fixture((url) => url.includes('open-meteo') ? model() : [report({ obsTime: 1 }), { icaoId: 'NFNA', lat: apt.lat, lon: apt.lon }], async (requests) => {
    const result = await liveWeather(apt);
    assert.match(result.source, /^weather model/);
    assert.equal(requests.length, 3);
    assert.equal(result.w.modeled, true);
  });
});

await test('ENV-01 missing nearby elevation falls back safely, valid zero and below-sea-level elevations survive', async () => {
  for (const [elev, expected] of [[null, apt.elev], [NaN, apt.elev], [99999, apt.elev], [0, 0], [-20, -20]]) {
    await fixture((url) => url.includes('ids=') ? [] : [report({ elev })], async () => {
      const { w } = await liveWeather(apt);
      assert.equal(w.stationElevationM, expected);
      near(w.baseM, expected + 200 * 0.3048);
    });
  }
});

await test('ENV-02 exact raw ESSA 0300 takes precedence over rounded provider visibility', () => {
  const m = report({ icaoId: 'ESSA', rawOb: 'ESSA 261600Z 18012KT 0300 FG VV002 02/01 Q1013', visib: 0.19 });
  const w = interpretMetar(m, 36);
  assert.equal(w.visibilityMeters, 300);
  assert.equal(w.visibilityQualifier, null);
  assert.equal(w.atisObservation.visibilityMeters, 300);
  assert.match(buildAtis({ metar: w.atisObservation }), /Visibility 300 metres/);
  assert.equal(interpretMetar({ ...m, visibilityMeters: 250 }).visibilityMeters, 250);
  assert.equal(w.vis, 0.3); // rendering remains the legacy tuning factor, not metres.
});

await test('ENV-02 visibility qualifiers and fractions survive raw, JSON, weather and ATIS', () => {
  for (const [token, metres, qualifier] of [
    ['9999', 10000, 'at-least'], ['CAVOK', 10000, 'at-least'], ['P6SM', 6 * 1609.344, 'at-least'],
    ['M1/4SM', 1609.344 / 4, 'less-than'], ['1 1/2SM', 1.5 * 1609.344, null],
    ['0000', 50, 'less-than'], ['0300', 300, null],
  ]) {
    const parsed = parseMetar(`KAAA 261600Z 18012KT ${token} SCT002 02/01 Q1013`);
    assert.equal(parsed.visibilityMeters, metres, token);
    assert.equal(parsed.visibilityQualifier, qualifier, token);
    const w = interpretMetar(parsed);
    assert.equal(w.visibilityMeters, metres);
    assert.equal(w.visibilityQualifier, qualifier);
    const atis = buildAtis({ metar: w.atisObservation });
    if (qualifier === 'less-than') assert.match(atis, /Visibility less than/);
    if (qualifier === 'at-least') assert.match(atis, /Visibility .* or greater/);
  }
  for (const [visib, qualifier, metres] of [['6+', 'at-least', 6 * 1609.344], ['M1/4', 'less-than', 1609.344 / 4], ['1/2', null, 1609.344 / 2], [0, null, 0]]) {
    const w = interpretMetar({ visib });
    assert.equal(w.visibilityQualifier, qualifier);
    assert.equal(w.visibilityMeters, metres);
  }
});

await test('ENV-02 unknown/invalid visibility is null and ATIS does not invent ten clear miles', () => {
  for (const m of [{}, { visib: null }, { visib: 'unknown' }, { visibilityMeters: NaN }, { visib: -1 }, { visibilityMeters: -1 }, { visib: '1/0' }, { visibilityMeters: ' ' }, { visibilityMeters: true }, { visib: '9'.repeat(308) },
    parseMetar('KAAA 261600Z 18012KT //// BKN002 02/01 Q1013')]) {
    const w = interpretMetar(m);
    assert.equal(w.visibilityMeters, null);
    assert.equal(w.visibilityQualifier, null);
    assert.ok(Number.isFinite(w.vis));
    assert.match(buildAtis({ metar: w.atisObservation }), /Visibility unavailable/);
  }
  assert.equal(metarVisibility({ visib: 0 }).visibilityMeters, 0);
  assert.match(buildAtis({ metar: { visibilityMeters: 0 } }), /Visibility 0 metres/);
});

await test('ENV-04 preserves low cloud bases, station-relative heights, obscuration and unknown VV', () => {
  const w = interpretMetar(report(), 36);
  near(w.baseM, 96.96);
  near(w.baseAglM, 60.96);
  assert.equal(w.obscured, true);
  assert.equal(w.verticalVisibilityFt, 200);
  assert.equal(w.atisObservation.clouds[0].cover, 'OVX');
  assert.match(buildAtis({ metar: w.atisObservation }), /sky obscured, vertical visibility 200 feet/);
  const unknown = interpretMetar('KAAA 261600Z 00000KT 0050 FG VV/// 02/01 Q1013', -10);
  assert.equal(unknown.baseM, -10);
  assert.equal(unknown.baseAglM, null);
  assert.equal(unknown.verticalVisibilityFt, null);
  assert.equal(unknown.coverage, 1);
  assert.equal(unknown.atisObservation.clouds[0].base, null);
  assert.match(buildAtis({ metar: unknown.atisObservation }), /vertical visibility unknown/);
  const layered = interpretMetar({ clouds: [{ cover: 'BKN', base: 2000 }, { cover: 'OVC', base: 100 }] }, 0);
  near(layered.baseM, 30.48);
  assert.equal(layered.obscured, false);
});

await test('ENV-05 raw/JSON precipitation share composite parsing, including -FZRA and mixed tokens', () => {
  for (const [wxString, expected] of [['-FZRA', 0.32], ['-RA', 0.32], ['+TSRA', 1], ['-SHRA', 0.4], ['BLSN', 0], ['VCFG', 0], ['VCTS', 0]]) {
    const raw = parseMetar(`KAAA 261600Z 18012KT 10SM ${wxString} BKN020 02/01 Q1013`);
    const json = interpretMetar({ wxString, visib: 10 });
    near(raw.rainIntensity, expected);
    near(json.rain, expected);
    assert.equal(json.thunder, raw.thunder);
    assert.equal(json.fog, raw.fog);
  }
  const w = interpretMetar({ wxString: 'VCTS -FZRA', rainIntensity: 1, thunder: true, visib: 10 });
  assert.equal(w.rain, 0.32); // derive from tokens, not stale/precomputed fields.
  assert.equal(w.thunder, false);
  assert.equal(w.vicinityThunder, true);
  assert.deepEqual(w.vicinityWeather, ['VCTS']);
  const raw = parseMetar('KAAA 261600Z 18012KT 10SM RMK VCTS +TSRA');
  assert.equal(raw.rainIntensity, 0);
});

await test('ENV-03 model supplies structured, correctly attributed ATIS with true visibility and no runway claim', async () => {
  await fixture(() => model(), async () => {
    const w = await modelWeather(apt.lat, apt.lon, apt.elev);
    assert.equal(w.visibilityMeters, 40000);
    assert.equal(w.visibilityQualifier, null);
    assert.equal(w.atisObservation.modeled, true);
    assert.equal(w.atisObservation.wdir, 139);
    assert.equal(w.atisObservation.wspd, 2);
    assert.equal(w.atisObservation.wgst, 5);
    assert.equal(w.atisObservation.temp, 22.8);
    assert.equal(w.atisObservation.altim, 1015);
    assert.equal(w.atisObservation.clouds[0].cover, 'SCT');
    assert.ok(w.atisObservation.clouds[0].base > 0);
    const atis = buildAtis({ metar: w.atisObservation, runways: ['14', '32'], runway: '14' });
    assert.match(atis, /^Modeled weather/);
    assert.match(atis, /wind 139 degrees at 2 gusting 5 knots/);
    assert.match(atis, /Visibility 40 kilometres/);
    assert.match(atis, /estimated scattered/);
    assert.match(atis, /temperature 22.8, dew point 20/);
    assert.match(atis, /QNH 1015/);
    assert.doesNotMatch(atis, /runway 14 in use/);
    assert.match(atis, /runway in use not available/);
  });
});

await test('ENV-02/03 missing model visibility stays unknown; low modeled visibility is not clamped to 0.2 miles', async () => {
  for (const value of [null, -1, NaN, 100]) {
    await fixture(() => model({ visibility: value }), async () => {
      const w = await modelWeather(apt.lat, apt.lon);
      assert.equal(w.visibilityMeters, value === 100 ? 100 : null);
      assert.equal(w.atisObservation.visibilityMeters, w.visibilityMeters);
      assert.match(buildAtis({ metar: w.atisObservation }), value === 100 ? /Visibility 100 metres/ : /Visibility unavailable/);
    });
  }
});


await test('B10 model rejects empty/malformed payloads and incomplete core measurements', async () => {
  for (const data of [null, {}, { current: null }, { current: {} }, { current: [] }]) {
    await fixture(() => data, async () => {
      await assert.rejects(modelWeather(apt.lat, apt.lon), /weather model/);
    });
  }
  for (const field of ['wind_speed_10m', 'wind_direction_10m', 'cloud_cover', 'weather_code']) {
    for (const value of [undefined, null, '', ' ', true, NaN, Infinity, 'unknown', -1]) {
      await fixture(() => model({ [field]: value }), async () => {
        await assert.rejects(modelWeather(apt.lat, apt.lon), /core measurements/, `${field}: ${String(value)}`);
      });
    }
  }
  for (const invalid of [{ wind_direction_10m: 361 }, { cloud_cover: 101 }, { weather_code: 4 }, { weather_code: 2.5 }]) {
    await fixture(() => model(invalid), async () => {
      await assert.rejects(modelWeather(apt.lat, apt.lon), /core measurements/);
    });
  }
});

await test('B10 model timestamp must be usable and fresh under the existing two-hour policy', async () => {
  for (const time of [undefined, null, '', true, 123, 'garbage', '2026-02-30T16:15',
    '2026-11-26T24:00', '2026-11-26T16:60', '2026-11-26', '2026-11-26T14:29:59', '2026-11-26T16:36']) {
    await fixture(() => model({ time }), async () => {
      await assert.rejects(modelWeather(apt.lat, apt.lon), /timestamp/, String(time));
    });
  }
  for (const time of ['2026-11-26T14:30', '2026-11-26T16:35', '2026-11-26T16:15:00Z']) {
    await fixture(() => model({ time }), async () => {
      assert.equal((await modelWeather(apt.lat, apt.lon)).atisObservation.modelTime, time);
    });
  }
});

await test('B10 genuine calm/clear model data succeeds without inventing optional measurements', async () => {
  await fixture(() => model({ wind_speed_10m: 0, wind_direction_10m: 0, cloud_cover: 0, weather_code: 0,
    temperature_2m: undefined, dew_point_2m: null, pressure_msl: undefined, wind_gusts_10m: null, visibility: null }), async () => {
    const w = await modelWeather(apt.lat, apt.lon);
    assert.equal(w.windKt, 0);
    assert.equal(w.coverage, 0);
    assert.deepEqual(w.clouds, []);
    for (const key of ['temp', 'dewp', 'altim', 'wgst', 'visibilityMeters']) assert.equal(w.atisObservation[key], null, key);
    assert.doesNotMatch(w.raw, /undefined|NaN|null/);
    assert.match(w.raw, /unavailable/);
    assert.equal(w.modeled, true);
  });
  await fixture(() => model({ temperature_2m: null, dew_point_2m: null }), async () => {
    const w = await modelWeather(apt.lat, apt.lon);
    assert.equal(w.atisObservation.clouds[0].base, null, 'missing temperature spread cannot imply a measured low-cloud base');
    assert.ok(Number.isFinite(w.baseM), 'visual rendering retains a safe estimated fallback');
  });
});

await test('B10 invalid model fallback rejects with all source failures, preserving caller weather', async () => {
  await fixture((url) => url.includes('open-meteo') ? { current: {} } : [report({ obsTime: 1 })], async (requests) => {
    const previous = { preset: 'storm', windKt: 25, coverage: 1 };
    let active = previous;
    await assert.rejects(async () => { active = (await liveWeather(apt)).w; }, error => {
      assert.match(error.message, /NFNL:.*nearby:.*model:.*weather model/);
      return true;
    });
    assert.equal(active, previous);
    assert.equal(requests.length, 3);
  });
});
