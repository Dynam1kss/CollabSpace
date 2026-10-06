import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma';
import { addMember, registerUser } from './helpers';

afterEach(async () => {
  await prisma.user.deleteMany();
});

const sticky = {
  id: 'obj1',
  type: 'sticky',
  x: 10,
  y: 20,
  width: 160,
  height: 120,
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-09-17T00:00:00.000Z',
  text: 'привіт',
  fillColor: '#fef08a',
  textColor: '#1f2937',
};

const connector = {
  id: 'obj2',
  type: 'connector',
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  rotation: 0,
  zIndex: 1,
  createdBy: 'u1',
  createdAt: '2026-09-17T00:00:00.000Z',
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 50 },
  ],
  strokeColor: '#1f2937',
  strokeWidth: 2,
  arrowEnd: true,
};

describe('снепшот дошки', () => {
  it('нова дошка — порожній масив, не 404', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });

    const res = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ objects: [], updatedAt: null });
  });

  it('put зберігає, get віддає те саме; повторний put — upsert', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });

    const put = await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [sticky, connector] });
    expect(put.status).toBe(204);

    const res = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    // стікер без column (як у снепшотах до канбану) проходить і повертається з null
    expect(res.body.objects).toEqual([{ ...sticky, column: null }, connector]);
    expect(typeof res.body.updatedAt).toBe('string');

    const put2 = await agent.put(`/api/boards/${board.body.id}/snapshot`).send({ objects: [sticky] });
    expect(put2.status).toBe(204);
    const res2 = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    expect(res2.body.objects).toEqual([{ ...sticky, column: null }]);
    // повторне збереження оновлює рядок клітинки, а не додає ще один
    expect(await prisma.boardSnapshotCell.count({ where: { boardId: board.body.id } })).toBe(1);
  });

  it('locked доїжджає до бази й вертається назад', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });

    await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [{ ...sticky, locked: true }] })
      .expect(204);
    const res = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    expect(res.body.objects[0].locked).toBe(true);

    // старий знімок поля не має — і не має його отримати з нізвідки
    await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [sticky] })
      .expect(204);
    const plain = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    expect(plain.body.objects[0].locked).toBeUndefined();
  });

  it('віддзеркалення картинки не губиться при збереженні', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });
    const image = {
      id: 'img1',
      type: 'image',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rotation: 0,
      zIndex: 0,
      createdBy: 'u1',
      createdAt: '2026-09-17T00:00:00.000Z',
      url: '/api/images/x.png',
      flipX: true,
      flipY: false,
    };

    await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [image] })
      .expect(204);
    const res = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    expect(res.body.objects[0]).toMatchObject({ flipX: true, flipY: false });
  });

  // поле зʼявилось 06.10; старі стікери його не мають і мусять пережити
  // перезбереження без домальованого числа — інакше дошка «сама змінилась»
  it('розмір тексту стікера їздить у знімок і назад, а без нього поля просто немає', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });

    await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({
        objects: [
          { ...sticky, id: 'з-розміром', fontSize: 28 },
          { ...sticky, id: 'старий' },
        ],
      })
      .expect(204);

    const res = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    const byId = Object.fromEntries(res.body.objects.map((o: { id: string }) => [o.id, o]));
    expect(byId['з-розміром']).toMatchObject({ fontSize: 28 });
    expect(byId['старий']).not.toHaveProperty('fontSize');
  });

  it('вирівнювання тексту переживає знімок, старі обʼєкти лишаються без поля', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });

    await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({
        objects: [
          { ...sticky, id: 'по-центру', align: 'center' },
          { ...sticky, id: 'без-поля' },
        ],
      })
      .expect(204);

    const res = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    const byId = Object.fromEntries(res.body.objects.map((o: { id: string }) => [o.id, o]));
    expect(byId['по-центру']).toMatchObject({ align: 'center' });
    expect(byId['без-поля']).not.toHaveProperty('align');
  });

  it('невідоме вирівнювання — 400', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });

    const res = await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [{ ...sticky, align: 'justify' }] });
    expect(res.status).toBe(400);
  });

  it('пряма переживає знімок разом зі штрихом і вістрями', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });
    const line = {
      id: 'l1',
      type: 'line',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 0,
      zIndex: 0,
      createdBy: 'u1',
      createdAt: '2026-10-06T00:00:00.000Z',
      from: { x: 10, y: 20 },
      to: { x: 110, y: 70 },
      strokeColor: '#1f2937',
      strokeWidth: 3,
      dash: 'dashed',
      arrowStart: true,
      arrowEnd: false,
    };

    await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [line, { ...line, id: 'l2', dash: undefined, arrowStart: undefined }] })
      .expect(204);

    const res = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    const byId = Object.fromEntries(res.body.objects.map((o: { id: string }) => [o.id, o]));
    expect(byId['l1']).toMatchObject({
      type: 'line',
      from: { x: 10, y: 20 },
      to: { x: 110, y: 70 },
      dash: 'dashed',
      arrowStart: true,
      arrowEnd: false,
    });
    // проста пряма — без зайвих полів
    expect(byId['l2']).not.toHaveProperty('dash');
    expect(byId['l2']).not.toHaveProperty('arrowStart');
  });

  it('пряма без кінців чи з невідомим штрихом — 400', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });
    const base = {
      id: 'l1',
      type: 'line',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      zIndex: 0,
      createdBy: 'u1',
      createdAt: '2026-10-06T00:00:00.000Z',
      from: { x: 0, y: 0 },
      to: { x: 10, y: 10 },
      strokeColor: '#000',
      strokeWidth: 2,
    };

    const noEnds = { ...base, to: undefined };
    expect(
      (await agent.put(`/api/boards/${board.body.id}/snapshot`).send({ objects: [noEnds] })).status,
    ).toBe(400);
    expect(
      (
        await agent
          .put(`/api/boards/${board.body.id}/snapshot`)
          .send({ objects: [{ ...base, dash: 'wavy' }] })
      ).status,
    ).toBe(400);
  });

  it('картка-посилання переживає знімок; підпис і відео необовʼязкові', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });
    const link = {
      id: 'k1',
      type: 'link',
      x: 10,
      y: 20,
      width: 260,
      height: 96,
      rotation: 0,
      zIndex: 0,
      createdBy: 'u1',
      createdAt: '2026-10-06T00:00:00.000Z',
      url: 'https://example.com/a?b=1',
      title: 'Приклад',
      kind: 'web',
    };
    const video = {
      ...link,
      id: 'k2',
      url: 'https://youtu.be/dQw4w9WgXcQ',
      kind: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      title: undefined,
    };

    await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [link, video] })
      .expect(204);

    const res = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    const byId = Object.fromEntries(res.body.objects.map((o: { id: string }) => [o.id, o]));
    expect(byId['k1']).toMatchObject({
      type: 'link',
      url: 'https://example.com/a?b=1',
      title: 'Приклад',
      kind: 'web',
    });
    expect(byId['k2']).toMatchObject({ url: 'https://youtu.be/dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ' });
    // без підпису поля просто немає, як і в решти необовʼязкових
    expect(byId['k2']).not.toHaveProperty('title');
  });

  it('посилання не з http(s), надто довге чи з підробленим videoId — 400', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });
    const base = {
      id: 'k1',
      type: 'link',
      x: 0,
      y: 0,
      width: 260,
      height: 96,
      rotation: 0,
      zIndex: 0,
      createdBy: 'u1',
      createdAt: '2026-10-06T00:00:00.000Z',
      url: 'https://example.com',
    };
    for (const bad of [
      { url: 'javascript:alert(1)' },
      { url: 'data:text/html,<script>' },
      { url: 'file:///etc/passwd' },
      { url: 'http://' },
      { url: 'https://example.com/' + 'a'.repeat(2048) },
      { videoId: '"><script>' },
      { title: 'т'.repeat(121) },
      { kind: 'vimeo' },
    ]) {
      await agent
        .put(`/api/boards/${board.body.id}/snapshot`)
        .send({ objects: [{ ...base, ...bad }] })
        .expect(400);
    }
  });

  it('невалідний обʼєкт — 400', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });

    const res = await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [{ ...sticky, type: 'unicorn' }] });
    expect(res.status).toBe(400);
    const missing = await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [{ ...sticky, text: 5 }] });
    expect(missing.status).toBe(400);
  });

  it('чужа дошка — 404 і на get, і на put', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });

    expect((await stranger.agent.get(`/api/boards/${board.body.id}/snapshot`)).status).toBe(404);
    expect(
      (await stranger.agent.put(`/api/boards/${board.body.id}/snapshot`).send({ objects: [] })).status,
    ).toBe(404);
  });

  it('EDITOR пише, VIEWER лише читає (403)', async () => {
    const owner = await registerUser();
    const editor = await registerUser();
    const viewer = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    await addMember(owner, board.body.id, editor, 'EDITOR');
    await addMember(owner, board.body.id, viewer, 'VIEWER');

    expect(
      (await editor.agent.put(`/api/boards/${board.body.id}/snapshot`).send({ objects: [sticky] })).status,
    ).toBe(204);

    const viewerGet = await viewer.agent.get(`/api/boards/${board.body.id}/snapshot`);
    expect(viewerGet.status).toBe(200);
    expect(viewerGet.body.objects).toHaveLength(1);
    expect(
      (await viewer.agent.put(`/api/boards/${board.body.id}/snapshot`).send({ objects: [] })).status,
    ).toBe(403);
  });

  it('видалення дошки забирає й снепшот', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });
    await agent.put(`/api/boards/${board.body.id}/snapshot`).send({ objects: [sticky] });
    await agent.delete(`/api/boards/${board.body.id}`);
    expect(await prisma.boardSnapshot.count()).toBe(0);
    expect(await prisma.boardSnapshotCell.count()).toBe(0);
  });
});

describe('снепшот частинами (стратегія 3)', () => {
  const at = (id: string, x: number, y: number) => ({ ...sticky, id, x, y });

  it('put з cells замінює лише ці клітинки, решту дошки не чіпає', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Велика' });
    const id = board.body.id as string;
    // 0:0, 5:0 і 0:5 — три далекі клітинки
    await agent
      .put(`/api/boards/${id}/snapshot`)
      .send({ objects: [at('a', 10, 10), at('b', 10000, 10), at('c', 10, 10000)] });

    // клієнт бачить лише 0:0: пересунув «a» всередині неї й додав «d» там же
    const res = await agent
      .put(`/api/boards/${id}/snapshot`)
      .send({ objects: [at('a', 300, 300), at('d', 900, 900)], cells: ['0:0'] });
    expect(res.status).toBe(204);

    const got = (await agent.get(`/api/boards/${id}/snapshot`)).body.objects as { id: string; x: number }[];
    expect(got.map((o) => o.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(got.find((o) => o.id === 'a')!.x).toBe(300);
  });

  it('картка посилання переїжджає між клітинками: у базі лишається рівно одна', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Велика' });
    const id = board.body.id as string;
    const card = (x: number, y: number) => ({
      id: 'k1',
      type: 'link',
      x,
      y,
      width: 260,
      height: 84,
      rotation: 0,
      zIndex: 0,
      createdBy: 'u1',
      createdAt: '2026-10-06T00:00:00.000Z',
      url: 'https://youtu.be/dQw4w9WgXcQ',
      kind: 'youtube',
      videoId: 'dQw4w9WgXcQ',
    });

    await agent.put(`/api/boards/${id}/snapshot`).send({ objects: [card(10, 10)], cells: ['0:0'] }).expect(204);

    // той самий жест, що й на клієнті: запис у нову клітинку й спорожнення старої
    await agent
      .put(`/api/boards/${id}/snapshot`)
      .send({ objects: [card(2010, 10)], cells: ['0:0', '1:0'] })
      .expect(204);

    const got = (await agent.get(`/api/boards/${id}/snapshot`)).body.objects as { id: string; x: number }[];
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ id: 'k1', x: 2010, url: 'https://youtu.be/dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ' });
  });

  it('видалення в своїй клітинці лягає, чужі клітинки цілі', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Велика' });
    const id = board.body.id as string;
    await agent.put(`/api/boards/${id}/snapshot`).send({ objects: [at('a', 10, 10), at('b', 10000, 10)] });
    await agent.put(`/api/boards/${id}/snapshot`).send({ objects: [], cells: ['0:0'] });
    const got = (await agent.get(`/api/boards/${id}/snapshot`)).body.objects as { id: string }[];
    expect(got.map((o) => o.id)).toEqual(['b']);
  });

  it('чужу клітинку з переліченими не переписати', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Велика' });
    const id = board.body.id as string;
    await agent.put(`/api/boards/${id}/snapshot`).send({ objects: [at('b', 10000, 10)] });
    // клієнт тримає 0:0, але підсунув свою версію «b» із 5:0
    await agent.put(`/api/boards/${id}/snapshot`).send({ objects: [at('b', 10500, 10)], cells: ['0:0'] });
    const got = (await agent.get(`/api/boards/${id}/snapshot`)).body.objects as { id: string; x: number }[];
    expect(got).toHaveLength(1);
    expect(got[0].x).toBe(10000);
  });

  // саме та гонитва, через яку в базі лишалась одна ділянка замість усіх
  // (журнал 29.09): доти збереження читало весь знімок, підмішувало свої
  // клітинки й писало назад. Коли кілька людей із різних ділянок автозберігають
  // разом, усі читають той самий старий стан, і останній запис лишає в базі
  // лише свою клітинку. Беремо саме кілька клієнтів, а не двох: із двома
  // потрібне влучання в вузьке вікно, а з пʼятьма старий код губить чуже майже
  // завжди
  it('кілька клієнтів одночасно зберігають різні клітинки — жоден не стирає чужого', async () => {
    const owner = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Багато ділянок' });
    const id = board.body.id as string;

    // пʼять далеких ділянок, у кожної свій господар
    const spots = [
      { id: 'a', cell: '0:0', x: 10 },
      { id: 'b', cell: '5:0', x: 10000 },
      { id: 'c', cell: '10:0', x: 20000 },
      { id: 'd', cell: '15:0', x: 30000 },
      { id: 'e', cell: '20:0', x: 40000 },
    ];
    const editors: Awaited<ReturnType<typeof registerUser>>[] = [];
    for (const _ of spots) {
      const editor = await registerUser();
      await addMember(owner, id, editor, 'EDITOR');
      editors.push(editor);
    }
    await owner.agent
      .put(`/api/boards/${id}/snapshot`)
      .send({ objects: spots.map((s) => at(s.id, s.x, 10)) });

    // усі пʼять запитів ідуть у роботу разом: обробники встигають прочитати
    // стан до того, як хоч один запише
    const results = await Promise.all(
      spots.map((s, i) =>
        editors[i].agent
          .put(`/api/boards/${id}/snapshot`)
          .send({ objects: [at(s.id, s.x + 500, 10)], cells: [s.cell] }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([204, 204, 204, 204, 204]);

    const got = (await owner.agent.get(`/api/boards/${id}/snapshot`)).body.objects as {
      id: string;
      x: number;
    }[];
    expect(got.map((o) => o.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    // у кожного своя правка дожила, а не лише в того, хто записав останнім
    for (const s of spots) expect(got.find((o) => o.id === s.id)!.x).toBe(s.x + 500);
  });

  it('стару дошку одним знімком розкладає по клітинках перший же запис', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Стара' });
    const id = board.body.id as string;
    // як воно лежало до переходу на клітинки — цілим json на дошку
    await prisma.boardSnapshotCell.deleteMany({ where: { boardId: id } });
    await prisma.boardSnapshot.create({
      data: {
        boardId: id,
        state: Buffer.from(JSON.stringify([at('a', 10, 10), at('b', 10000, 10)]), 'utf8'),
      },
    });

    await agent.put(`/api/boards/${id}/snapshot`).send({ objects: [at('a', 700, 700)], cells: ['0:0'] });

    const got = (await agent.get(`/api/boards/${id}/snapshot`)).body.objects as {
      id: string;
      x: number;
    }[];
    // чужа клітинка 5:0 пережила запис у 0:0, старий рядок прибрано
    expect(got.map((o) => o.id).sort()).toEqual(['a', 'b']);
    expect(got.find((o) => o.id === 'a')!.x).toBe(700);
    expect(await prisma.boardSnapshot.count({ where: { boardId: id } })).toBe(0);
  });

  it('зіпсований ключ клітинки — 400', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Велика' });
    const res = await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [], cells: ['0;0'] });
    expect(res.status).toBe(400);
  });
});
