import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.js';
import {demoGames} from '../server/demo-games.js';

test('выпуск: незавершённый экспорт не попадает в свежую базу и общий список', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'igrodrom-release-'));
  const root = path.join(dir,'public','games');
  for (const slug of ['ready','unfinished']) {
    fs.mkdirSync(path.join(root,slug),{recursive:true});
    fs.writeFileSync(path.join(root,slug,'meta.json'),JSON.stringify({title:slug,category:'Аркады'}));
    fs.writeFileSync(path.join(root,slug,'index.html'),'<html>test</html>');
  }
  fs.writeFileSync(path.join(root,'releases.json'),JSON.stringify(['ready']));
  assert.deepEqual(demoGames(root).map((g)=>g.slug),['ready']);
  const app=createApp({dataDir:path.join(dir,'data'),publicDir:path.join(dir,'public'),seedDemoGames:true});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});});
  const {games}=await (await fetch(`http://127.0.0.1:${app.address().port}/api/games`)).json();
  assert.deepEqual(games.map(g=>g.title),['ready']);
  fs.writeFileSync(path.join(root,'releases.json'),'{}');
  assert.throws(()=>demoGames(root),/releases.json/);
});
