import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPlaylist, NotFound } from '../src/api.js';
import { productionId, rememberWin, resumePosition, seriesPosition } from '../src/series.js';
import { levelId } from '../../solver/src/production/store.js';
import { PRACTICE_LEVELS } from '../src/level.js';

test('verified gardens match producer ids, advance past packs, resume, and survive list-server outages', async () => {
  const originalFetch = globalThis.fetch;
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map<string,string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k:string) => storage.get(k) ?? null, setItem: (k:string,v:string) => storage.set(k,v) } });
  try {
    for (const n of [1,50,100,101,150,1000]) assert.equal(await productionId(n), levelId('match3',n,1));
    await assert.rejects(productionId(1001));
    await assert.rejects(productionId(NaN));
    assert.equal(resumePosition(), 1);
    rememberWin(50); assert.equal(resumePosition(), 51);
    rememberWin(1); assert.equal(resumePosition(), 51, 'replaying older levels does not lose progress');
    const id = await productionId(51);
    const raw = { level_id: id, game_id: 'match3', status: 'accepted', level: { ...PRACTICE_LEVELS[0]!, name: 'Garden 0051' } };
    const requests: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input); requests.push(url);
      return url.startsWith('https://') ? Response.json(raw) : new Response('',{status:530});
    };
    const result = await loadPlaylist(new URLSearchParams());
    assert.equal(result.levels[0]!.level_id, id);
    assert.equal(result.continuation, 52);
    assert.equal(result.levels[0]!.measured_win_rate, null, 'missing metadata is not invented');
    assert.ok(requests.some(r => r.startsWith('https://')));
    for (const status of [400,404,500]) {
      globalThis.fetch = async input => String(input).startsWith('https://') ? Response.json(raw) : new Response('',{status});
      assert.equal((await loadPlaylist(new URLSearchParams('series=51'))).levels[0]!.level_id,id);
    }
    assert.equal(await seriesPosition({ ...raw, level_id: 'not-the-real-id' }), 0);
    const last = { ...raw, level_id: await productionId(100), level: { ...raw.level, name: 'Garden 0100' } };
    globalThis.fetch = async () => Response.json({name:'First 100',levels:[last]});
    const pack = await loadPlaylist(new URLSearchParams('pack=known'));
    assert.equal(pack.continuation,101,'a fixed pack continues into the ahead buffer');
    globalThis.fetch = async () => Response.json({...raw,game_id:'watersort'});
    await assert.rejects(loadPlaylist(new URLSearchParams(`level=${id}`)), NotFound);
    globalThis.fetch = async (input) => String(input).startsWith('https://') ? Response.json({...raw,status:'draft'}) : new Response('',{status:530});
    await assert.rejects(loadPlaylist(new URLSearchParams('series=51')), NotFound);
    globalThis.fetch = async () => new Response('',{status:404});
    await assert.rejects(loadPlaylist(new URLSearchParams('series=51')), NotFound);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldStorage) Object.defineProperty(globalThis,'localStorage',oldStorage);
    else Reflect.deleteProperty(globalThis,'localStorage');
  }
});
