import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma';
import {
  AUTO_VERSION_INTERVAL_MS,
  VERSION_CAP,
  pickEvictions,
  shouldCreateAutoVersion,
} from '../src/boards/versions.service';
import { registerUser } from './helpers';

afterEach(async () => {
  await prisma.user.deleteMany();
});

const sticky = (id: string, text: string) => ({
  id,
  type: 'sticky',
  x: 0,
  y: 0,
  width: 160,
  height: 120,
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-09-26T00:00:00.000Z',
  text,
  fillColor: '#fef08a',
  textColor: '#1f2937',
  column: null,
});

const minutes = (n: number) => n * 60_000;

describe('коли робити автоверсію', () => {
  const now = new Date('2026-09-26T12:00:00Z');

  it('першу — одразу', () => {
    expect(shouldCreateAutoVersion(null, now)).toBe(true);
  });

  it('не раніше, ніж мине інтервал', () => {
    expect(shouldCreateAutoVersion(new Date(now.getTime() - AUTO_VERSION_INTERVAL_MS + 1000), now)).toBe(
      false,
    );
    expect(shouldCreateAutoVersion(new Date(now.getTime() - AUTO_VERSION_INTERVAL_MS), now)).toBe(true);
  });
});

describe('кого викидати за межею', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 8, 26, 0, m));
  const row = (id: string, m: number, isManual: boolean) => ({ id, createdAt: at(m), isManual });

  it('у межах — нікого', () => {
    const rows = Array.from({ length: VERSION_CAP }, (_, i) => row(`v${i}`, i, false));
    expect(pickEvictions(rows)).toEqual([]);
  });

  it('понад межу — найстаріші автоматичні, навіть якщо ручна ще старша', () => {
    const rows = [
      row('manual-oldest', 0, true),
      row('auto-1', 1, false),
      row('auto-2', 2, false),
      ...Array.from({ length: VERSION_CAP - 1 }, (_, i) => row(`fresh${i}`, 10 + i, i % 2 === 0)),
    ];
    expect(rows.length).toBe(VERSION_CAP + 2);
    expect(pickEvictions(rows)).toEqual(['auto-1', 'auto-2']);
  });

  it('усі ручні — не видаляємо жодної, хай історія вилізе за межу', () => {
    const rows = Array.from({ length: VERSION_CAP + 3 }, (_, i) => row(`m${i}`, i, true));
    expect(pickEvictions(rows)).toEqual([]);
  });

  it('автоматичних менше, ніж треба прибрати, — прибираємо всі, ручні лишаються', () => {
    const rows = [
      ...Array.from({ length: VERSION_CAP }, (_, i) => row(`m${i}`, i, true)),
      row('a', 50, false),
      row('b', 51, false),
    ];
    expect(pickEvictions(rows)).toEqual(['a', 'b']);
  });
});

async function boardWith() {
  const owner = await registerUser();
  const admin = await registerUser();
  const editor = await registerUser();
  const viewer = await registerUser();
  const stranger = await registerUser();
  const board = await owner.agent.post('/api/boards').send({ title: 'Історія' });
  const id = board.body.id as string;
  await owner.agent.post(`/api/boards/${id}/members`).send({ email: admin.payload.email, role: 'ADMIN' });
  await owner.agent.post(`/api/boards/${id}/members`).send({ email: editor.payload.email, role: 'EDITOR' });
  await owner.agent.post(`/api/boards/${id}/members`).send({ email: viewer.payload.email, role: 'VIEWER' });
  return { id, owner, admin, editor, viewer, stranger };
}

const stateOf = (buf: Buffer) => JSON.parse(buf.toString('utf8')) as { text: string }[];

describe('версії дошки', () => {
  it('перше збереження дає автоверсію, наступне одразу — ні, після інтервалу — знову', async () => {
    const { id, editor } = await boardWith();
    await editor.agent
      .put(`/api/boards/${id}/snapshot`)
      .send({ objects: [sticky('s', 'один')] })
      .expect(204);
    await editor.agent
      .put(`/api/boards/${id}/snapshot`)
      .send({ objects: [sticky('s', 'два')] })
      .expect(204);
    let rows = await prisma.boardVersion.findMany({ where: { boardId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].isManual).toBe(false);
    expect(stateOf(rows[0].state)[0].text).toBe('один');

    // час не чекаємо — зсуваємо останню автоверсію в минуле
    await prisma.boardVersion.update({
      where: { id: rows[0].id },
      data: { createdAt: new Date(Date.now() - AUTO_VERSION_INTERVAL_MS - minutes(1)) },
    });
    await editor.agent
      .put(`/api/boards/${id}/snapshot`)
      .send({ objects: [sticky('s', 'три')] })
      .expect(204);
    rows = await prisma.boardVersion.findMany({ where: { boardId: id }, orderBy: { createdAt: 'desc' } });
    expect(rows).toHaveLength(2);
    expect(stateOf(rows[0].state)[0].text).toBe('три');
  });

  it('ручна версія з підписом — одразу в списку, вміст із бази, а не з запиту', async () => {
    const { id, owner, admin } = await boardWith();
    await owner.agent.put(`/api/boards/${id}/snapshot`).send({ objects: [sticky('s', 'як у базі')] });

    const saved = await admin.agent
      .post(`/api/boards/${id}/versions`)
      // спроба підсунути свій вміст ігнорується: схема такого поля не знає
      .send({ label: '  Перед презентацією  ', objects: [sticky('x', 'підсунуте')] });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({
      label: 'Перед презентацією',
      isManual: true,
      createdByName: admin.payload.displayName,
    });

    const list = await owner.agent.get(`/api/boards/${id}/versions`);
    expect(list.body.versions[0]).toMatchObject({
      id: saved.body.id,
      label: 'Перед презентацією',
      isManual: true,
    });
    expect(list.body.versions[0].state).toBeUndefined();
    const row = await prisma.boardVersion.findUniqueOrThrow({ where: { id: saved.body.id } });
    expect(stateOf(row.state)[0].text).toBe('як у базі');

    // без підпису теж можна — тоді label null, але версія ручна
    const bare = await owner.agent.post(`/api/boards/${id}/versions`).send({ label: '   ' });
    expect(bare.body).toMatchObject({ label: null, isManual: true });
    expect(
      (await owner.agent.post(`/api/boards/${id}/versions`).send({ label: 'x'.repeat(81) })).status,
    ).toBe(400);
  });

  it('редактору й глядачу сервер не дає ні списку, ні збереження, ні відкату; чужому — 404', async () => {
    const { id, owner, admin, editor, viewer, stranger } = await boardWith();
    const v = await owner.agent.post(`/api/boards/${id}/versions`).send({ label: 'точка' });
    expect((await admin.agent.get(`/api/boards/${id}/versions`)).status).toBe(200);
    for (const who of [editor, viewer]) {
      expect((await who.agent.get(`/api/boards/${id}/versions`)).status).toBe(403);
      expect((await who.agent.post(`/api/boards/${id}/versions`).send({ label: 'моя' })).status).toBe(403);
      expect((await who.agent.post(`/api/boards/${id}/versions/${v.body.id}/restore`)).status).toBe(403);
    }
    expect((await stranger.agent.get(`/api/boards/${id}/versions`)).status).toBe(404);
    expect((await stranger.agent.post(`/api/boards/${id}/versions/${v.body.id}/restore`)).status).toBe(404);
    expect(await prisma.boardVersion.count({ where: { boardId: id } })).toBe(1);
  });

  it('відкат переписує снепшот і спершу кладе поточний стан окремою версією', async () => {
    const { id, owner, editor } = await boardWith();
    await editor.agent.put(`/api/boards/${id}/snapshot`).send({ objects: [sticky('a', 'стара')] });
    const v = await owner.agent.post(`/api/boards/${id}/versions`).send({ label: 'стара' });
    await editor.agent
      .put(`/api/boards/${id}/snapshot`)
      .send({ objects: [sticky('a', 'нова'), sticky('b', 'ще')] });

    expect((await owner.agent.post(`/api/boards/${id}/versions/${v.body.id}/restore`)).status).toBe(204);
    const snap = await owner.agent.get(`/api/boards/${id}/snapshot`);
    expect(snap.body.objects.map((o: { text: string }) => o.text)).toEqual(['стара']);

    const newest = await prisma.boardVersion.findFirstOrThrow({
      where: { boardId: id },
      orderBy: { createdAt: 'desc' },
    });
    expect(newest.isManual).toBe(false);
    expect(stateOf(newest.state).map((o) => o.text)).toEqual(['нова', 'ще']);
  });

  it('версія іншої дошки — 404, снепшот не чіпається', async () => {
    const { id, owner } = await boardWith();
    const other = await owner.agent.post('/api/boards').send({ title: 'Інша' });
    const foreign = await owner.agent.post(`/api/boards/${other.body.id}/versions`).send({ label: 'чужа' });
    await owner.agent.put(`/api/boards/${id}/snapshot`).send({ objects: [sticky('a', 'моя')] });
    expect((await owner.agent.post(`/api/boards/${id}/versions/${foreign.body.id}/restore`)).status).toBe(
      404,
    );
    const snap = await owner.agent.get(`/api/boards/${id}/snapshot`);
    expect(snap.body.objects[0].text).toBe('моя');
  });

  it('20 змішаних версій: нова витискає найстарішу автоматичну, ручні лишаються', async () => {
    const { id, owner } = await boardWith();
    const base = Date.now() - minutes(1000);
    // найстаріша — ручна: навіть вона має пережити витіснення
    const rows = Array.from({ length: VERSION_CAP }, (_, i) => ({
      boardId: id,
      state: Buffer.from('[]'),
      createdBy: 'u',
      createdAt: new Date(base + minutes(i)),
      isManual: i === 0 || i % 3 === 0,
      label: i === 0 || i % 3 === 0 ? `ручна ${i}` : null,
    }));
    await prisma.boardVersion.createMany({ data: rows });
    const manualBefore = rows.filter((r) => r.isManual).length;
    const oldestAuto = rows.find((r) => !r.isManual)!;

    await owner.agent.post(`/api/boards/${id}/versions`).send({ label: 'двадцять перша' }).expect(201);
    const after = await prisma.boardVersion.findMany({ where: { boardId: id } });
    expect(after).toHaveLength(VERSION_CAP);
    expect(after.filter((r) => r.isManual)).toHaveLength(manualBefore + 1);
    expect(after.some((r) => r.createdAt.getTime() === oldestAuto.createdAt.getTime())).toBe(false);
    expect(after.some((r) => r.label === 'ручна 0')).toBe(true);
  });

  it('видалення дошки забирає й версії', async () => {
    const { id, owner } = await boardWith();
    await owner.agent.post(`/api/boards/${id}/versions`).send({ label: 'x' });
    await owner.agent.delete(`/api/boards/${id}`).expect(204);
    expect(await prisma.boardVersion.count({ where: { boardId: id } })).toBe(0);
  });
});
