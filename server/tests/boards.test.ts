import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma';
import { addMember, registerUser } from './helpers';

afterEach(async () => {
  await prisma.user.deleteMany();
});

describe('дошки — CRUD і права доступу', () => {
  it('власник створює дошку, бачить її у списку своїх', async () => {
    const { agent } = await registerUser();

    const createRes = await agent.post('/api/boards').send({ title: 'Моя дошка' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.isOwner).toBe(true);

    const listRes = await agent.get('/api/boards');
    expect(listRes.status).toBe(200);
    expect(listRes.body.boards).toHaveLength(1);
    expect(listRes.body.boards[0].id).toBe(createRes.body.id);
  });

  it('чужу дошку не видно — 404, а не 403', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();

    const board = await owner.agent.post('/api/boards').send({ title: 'Приватна дошка' });

    const res = await stranger.agent.get(`/api/boards/${board.body.id}`);
    expect(res.status).toBe(404);
  });

  it('чужу дошку не можна перейменувати', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });

    const res = await stranger.agent.patch(`/api/boards/${board.body.id}`).send({ title: 'Хак' });
    expect(res.status).toBe(404);
  });

  it('чужу дошку не можна видалити', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });

    const res = await stranger.agent.delete(`/api/boards/${board.body.id}`);
    expect(res.status).toBe(404);

    const stillThere = await owner.agent.get(`/api/boards/${board.body.id}`);
    expect(stillThere.status).toBe(200);
  });

  it('власник перейменовує і видаляє власну дошку', async () => {
    const owner = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Стара назва' });

    const renamed = await owner.agent.patch(`/api/boards/${board.body.id}`).send({ title: 'Нова назва' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.title).toBe('Нова назва');

    const deleted = await owner.agent.delete(`/api/boards/${board.body.id}`);
    expect(deleted.status).toBe(204);

    const afterDelete = await owner.agent.get(`/api/boards/${board.body.id}`);
    expect(afterDelete.status).toBe(404);
  });

  it('учасник з роллю EDITOR бачить дошку, але не може її перейменувати чи видалити', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Спільна дошка' });

    const addRes = await addMember(owner, board.body.id, member, 'EDITOR');
    expect(addRes.status).toBe(201);

    const readRes = await member.agent.get(`/api/boards/${board.body.id}`);
    expect(readRes.status).toBe(200);

    const renameRes = await member.agent.patch(`/api/boards/${board.body.id}`).send({ title: 'Хак' });
    expect(renameRes.status).toBe(403);

    const deleteRes = await member.agent.delete(`/api/boards/${board.body.id}`);
    expect(deleteRes.status).toBe(403);

    const addMemberRes = await addMember(member, board.body.id, owner, 'VIEWER');
    expect(addMemberRes.status).toBe(403);
  });

  it('зміна ролі на місці: той самий рядок, нові права', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    const boardId = board.body.id as string;

    await addMember(owner, boardId, member, 'EDITOR');
    const before = await prisma.boardMember.findFirst({ where: { boardId, userId: member.user.id } });

    const res = await owner.agent
      .patch(`/api/boards/${boardId}/members`)
      .send({ userId: member.user.id, role: 'VIEWER' });
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0]).toMatchObject({ userId: member.user.id, role: 'VIEWER' });

    // саме зміна рядка, а не видалення з повторним заведенням
    const after = await prisma.boardMember.findFirst({ where: { boardId, userId: member.user.id } });
    expect(after!.id).toBe(before!.id);
    expect(after!.role).toBe('VIEWER');

    // права справді поїхали за роллю: глядачу писати вже не можна
    const save = await member.agent.put(`/api/boards/${boardId}/snapshot`).send({ objects: [] });
    expect(save.status).toBe(403);

    // і назад
    await owner.agent
      .patch(`/api/boards/${boardId}/members`)
      .send({ userId: member.user.id, role: 'EDITOR' });
    expect((await member.agent.put(`/api/boards/${boardId}/snapshot`).send({ objects: [] })).status).toBe(
      204,
    );
  });

  it('роль міняє лише власник, і лише наявному учаснику', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const stranger = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    const boardId = board.body.id as string;
    await addMember(owner, boardId, member, 'EDITOR');

    // учасник-редактор ролями не розпоряджається
    const byMember = await member.agent
      .patch(`/api/boards/${boardId}/members`)
      .send({ userId: member.user.id, role: 'VIEWER' });
    expect(byMember.status).toBe(403);

    // чужому дошки не видно взагалі
    const byStranger = await stranger.agent
      .patch(`/api/boards/${boardId}/members`)
      .send({ userId: member.user.id, role: 'VIEWER' });
    expect(byStranger.status).toBe(404);

    // кого нема в списку — тому й міняти нема чого
    expect(
      (
        await owner.agent
          .patch(`/api/boards/${boardId}/members`)
          .send({ userId: stranger.user.id, role: 'VIEWER' })
      ).status,
    ).toBe(404);
    // а власника не можна чіпати в принципі, і про це кажемо прямо
    expect(
      (
        await owner.agent
          .patch(`/api/boards/${boardId}/members`)
          .send({ userId: owner.user.id, role: 'VIEWER' })
      ).status,
    ).toBe(403);

    // покручене тіло
    expect(
      (
        await owner.agent
          .patch(`/api/boards/${boardId}/members`)
          .send({ userId: member.user.id, role: 'BOSS' })
      ).status,
    ).toBe(400);
    expect((await owner.agent.patch(`/api/boards/${boardId}/members`).send({ role: 'VIEWER' })).status).toBe(
      400,
    );

    // роль учасника після всіх спроб не змінилась
    const row = await prisma.boardMember.findFirst({ where: { boardId, userId: member.user.id } });
    expect(row!.role).toBe('EDITOR');
  });

  it('адміністратор роздає ролі, але власника не чіпає й адміна не знижує', async () => {
    const owner = await registerUser();
    const admin = await registerUser();
    const editor = await registerUser();
    const other = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    const boardId = board.body.id as string;

    for (const [who, role] of [
      [admin, 'ADMIN'],
      [editor, 'EDITOR'],
      [other, 'ADMIN'],
    ] as const) {
      const res = await addMember(owner, boardId, who, role);
      expect(res.status).toBe(201);
    }

    // адмін міняє роль редактору — можна
    expect(
      (
        await admin.agent
          .patch(`/api/boards/${boardId}/members`)
          .send({ userId: editor.user.id, role: 'VIEWER' })
      ).status,
    ).toBe(200);

    // і навіть підняти його до адміністратора
    expect(
      (
        await admin.agent
          .patch(`/api/boards/${boardId}/members`)
          .send({ userId: editor.user.id, role: 'ADMIN' })
      ).status,
    ).toBe(200);

    // а от іншого адміністратора — ні: над адміном стоїть лише власник
    expect(
      (
        await admin.agent
          .patch(`/api/boards/${boardId}/members`)
          .send({ userId: other.user.id, role: 'VIEWER' })
      ).status,
    ).toBe(403);
    expect(
      (await admin.agent.delete(`/api/boards/${boardId}/members`).send({ userId: other.user.id })).status,
    ).toBe(403);

    // власника не чіпає ніхто — ні за роллю, ні виганяючи
    expect(
      (
        await admin.agent
          .patch(`/api/boards/${boardId}/members`)
          .send({ userId: owner.user.id, role: 'VIEWER' })
      ).status,
    ).toBe(403);
    expect(
      (await admin.agent.delete(`/api/boards/${boardId}/members`).send({ userId: owner.user.id })).status,
    ).toBe(403);

    // власник над адміністратором — може все
    expect(
      (
        await owner.agent
          .patch(`/api/boards/${boardId}/members`)
          .send({ userId: other.user.id, role: 'EDITOR' })
      ).status,
    ).toBe(200);
    expect(
      (await owner.agent.delete(`/api/boards/${boardId}/members`).send({ userId: admin.user.id })).status,
    ).toBe(204);
  });

  it('редактор і глядач учасниками не керують', async () => {
    const owner = await registerUser();
    const editor = await registerUser();
    const viewer = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    const boardId = board.body.id as string;
    await addMember(owner, boardId, editor, 'EDITOR');
    await addMember(owner, boardId, viewer, 'VIEWER');

    for (const who of [editor, viewer]) {
      expect(
        (
          await who.agent
            .patch(`/api/boards/${boardId}/members`)
            .send({ userId: viewer.user.id, role: 'ADMIN' })
        ).status,
      ).toBe(403);
      expect(
        (await who.agent.delete(`/api/boards/${boardId}/members`).send({ userId: viewer.user.id })).status,
      ).toBe(403);
      expect((await addMember(who, boardId, owner, 'VIEWER')).status).toBe(403);
    }
  });

  it('адміністратор пише на дошку нарівні з редактором', async () => {
    const owner = await registerUser();
    const admin = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    const boardId = board.body.id as string;
    await addMember(owner, boardId, admin, 'ADMIN');

    expect((await admin.agent.put(`/api/boards/${boardId}/snapshot`).send({ objects: [] })).status).toBe(204);
    // і бачить свою роль у списку дошок
    const list = await admin.agent.get('/api/boards');
    expect(list.body.boards[0]).toMatchObject({ isOwner: false, myRole: 'ADMIN' });
  });

  // саме той сценарій, який ловили руками: у знятого чи зниженого адміністратора
  // лишилась відкрита сторінка зі списком учасників. Кнопки на ній ще ті самі —
  // сервер має відмовити КОЖНІЙ дії, бо роль він читає з бази на кожен запит,
  // а не памʼятає з попереднього
  it('знятому адміністратору наступний же запит відмовляють', async () => {
    const owner = await registerUser();
    const admin = await registerUser();
    const victim = await registerUser();
    const outsider = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    const boardId = board.body.id as string;
    await addMember(owner, boardId, admin, 'ADMIN');
    await addMember(owner, boardId, victim, 'EDITOR');

    expect(
      (await owner.agent.delete(`/api/boards/${boardId}/members`).send({ userId: admin.user.id })).status,
    ).toBe(204);

    // доступу немає взагалі — тому 404, як і в будь-якого чужого
    expect((await addMember(admin, boardId, outsider, 'EDITOR')).status).toBe(404);
    expect(
      (
        await admin.agent
          .patch(`/api/boards/${boardId}/members`)
          .send({ userId: victim.user.id, role: 'VIEWER' })
      ).status,
    ).toBe(404);
    expect(
      (await admin.agent.delete(`/api/boards/${boardId}/members`).send({ userId: victim.user.id })).status,
    ).toBe(404);
    expect(
      (await admin.agent.patch(`/api/boards/${boardId}/voice`).send({ userId: victim.user.id, mute: true }))
        .status,
    ).toBe(404);

    // і нічого з цього не сталось
    const after = await owner.agent.get(`/api/boards/${boardId}`);
    expect(after.body.members).toHaveLength(1);
    expect(after.body.members[0]).toMatchObject({ userId: victim.user.id, role: 'EDITOR' });
  });

  it('зниженому адміністратору наступний же запит відмовляють', async () => {
    const owner = await registerUser();
    const admin = await registerUser();
    const victim = await registerUser();
    const outsider = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    const boardId = board.body.id as string;
    await addMember(owner, boardId, admin, 'ADMIN');
    await addMember(owner, boardId, victim, 'EDITOR');

    expect(
      (
        await owner.agent
          .patch(`/api/boards/${boardId}/members`)
          .send({ userId: admin.user.id, role: 'VIEWER' })
      ).status,
    ).toBe(200);

    // дошку він ще бачить, тому 403, а не 404
    for (const res of [
      await addMember(admin, boardId, outsider, 'EDITOR'),
      await admin.agent
        .patch(`/api/boards/${boardId}/members`)
        .send({ userId: victim.user.id, role: 'VIEWER' }),
      await admin.agent.delete(`/api/boards/${boardId}/members`).send({ userId: victim.user.id }),
      await admin.agent.patch(`/api/boards/${boardId}/voice`).send({ userId: victim.user.id, mute: true }),
    ]) {
      expect(res.status).toBe(403);
    }

    const after = await owner.agent.get(`/api/boards/${boardId}`);
    expect(after.body.members).toHaveLength(2);
    expect(after.body.members.find((m: { userId: string }) => m.userId === victim.user.id).role).toBe(
      'EDITOR',
    );
  });

  // додавання — це upsert, тому для того, хто вже на дошці, воно рівносильне
  // зміні ролі й мусить проходити ту саму перевірку ієрархії
  it('через додавання учасника не можна обійти ієрархію', async () => {
    const owner = await registerUser();
    const admin = await registerUser();
    const other = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    const boardId = board.body.id as string;
    await addMember(owner, boardId, admin, 'ADMIN');
    await addMember(owner, boardId, other, 'ADMIN');

    expect((await addMember(admin, boardId, other, 'VIEWER')).status).toBe(403);
    expect((await addMember(admin, boardId, owner, 'VIEWER')).status).toBe(400);
  });

  // над адміністратором стоїть не завжди лише власник — залежить від того,
  // хто його підняв
  it('адміністратора, якого підняв інший адміністратор, знімає будь-який адміністратор', async () => {
    const owner = await registerUser();
    const adminA = await registerUser();
    const adminB = await registerUser();
    const promoted = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    const boardId = board.body.id as string;

    // цих двох підняв власник — вони недоторканні один для одного
    await addMember(owner, boardId, adminA, 'ADMIN');
    await addMember(owner, boardId, adminB, 'ADMIN');
    // а цього підняв adminA
    await addMember(adminA, boardId, promoted, 'ADMIN');

    const detail = await owner.agent.get(`/api/boards/${boardId}`);
    const infoOf = (userId: string) =>
      detail.body.members.find((m: { userId: string }) => m.userId === userId);
    expect(infoOf(adminA.user.id).roleGrantedBy).toBe(owner.user.id);
    expect(infoOf(promoted.user.id).roleGrantedBy).toBe(adminA.user.id);

    // adminB не той, хто піднімав, — але піднімав теж адміністратор, тож можна
    expect(
      (
        await adminB.agent
          .patch(`/api/boards/${boardId}/members`)
          .send({ userId: promoted.user.id, role: 'EDITOR' })
      ).status,
    ).toBe(200);
    // а один одного ці двоє не чіпають: їх обох підняв власник
    expect(
      (
        await adminB.agent
          .patch(`/api/boards/${boardId}/members`)
          .send({ userId: adminA.user.id, role: 'EDITOR' })
      ).status,
    ).toBe(403);
    expect(
      (await adminA.agent.delete(`/api/boards/${boardId}/members`).send({ userId: adminB.user.id })).status,
    ).toBe(403);
  });

  it('власник знімає будь-якого адміністратора, хоч би хто його підняв', async () => {
    const owner = await registerUser();
    const adminA = await registerUser();
    const promoted = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    const boardId = board.body.id as string;
    await addMember(owner, boardId, adminA, 'ADMIN');
    await addMember(adminA, boardId, promoted, 'ADMIN');

    expect(
      (
        await owner.agent
          .patch(`/api/boards/${boardId}/members`)
          .send({ userId: promoted.user.id, role: 'VIEWER' })
      ).status,
    ).toBe(200);
    expect(
      (await owner.agent.delete(`/api/boards/${boardId}/members`).send({ userId: adminA.user.id })).status,
    ).toBe(204);
  });

  // слід оновлюється на КОЖНУ зміну ролі, а не лише на першу: власник забрав
  // у адмін-ставленика роль і повернув — тепер за ним стоїть уже власник
  it('після втручання власника адміністратор уже не чіпає того ж учасника', async () => {
    const owner = await registerUser();
    const adminA = await registerUser();
    const adminB = await registerUser();
    const promoted = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    const boardId = board.body.id as string;
    await addMember(owner, boardId, adminA, 'ADMIN');
    await addMember(owner, boardId, adminB, 'ADMIN');
    await addMember(adminA, boardId, promoted, 'ADMIN');

    await owner.agent
      .patch(`/api/boards/${boardId}/members`)
      .send({ userId: promoted.user.id, role: 'ADMIN' });

    expect(
      (
        await adminB.agent
          .patch(`/api/boards/${boardId}/members`)
          .send({ userId: promoted.user.id, role: 'EDITOR' })
      ).status,
    ).toBe(403);
  });

  // та сама ієрархія на примусовому вимкненні голосу
  it('примусове вимкнення голосу йде за тією ж ієрархією адміністраторів', async () => {
    const owner = await registerUser();
    const adminA = await registerUser();
    const adminB = await registerUser();
    const promoted = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    const boardId = board.body.id as string;
    await addMember(owner, boardId, adminA, 'ADMIN');
    await addMember(owner, boardId, adminB, 'ADMIN');
    await addMember(adminA, boardId, promoted, 'ADMIN');

    expect(
      (
        await adminB.agent
          .patch(`/api/boards/${boardId}/voice`)
          .send({ userId: promoted.user.id, mute: true })
      ).status,
    ).toBe(204);
    expect(
      (await adminB.agent.patch(`/api/boards/${boardId}/voice`).send({ userId: adminA.user.id, mute: true }))
        .status,
    ).toBe(403);
    expect(
      (await owner.agent.patch(`/api/boards/${boardId}/voice`).send({ userId: adminA.user.id, mute: true }))
        .status,
    ).toBe(204);
  });

  it('видалення учасника забирає йому доступ до дошки', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });

    await addMember(owner, board.body.id, member, 'VIEWER');

    const removeRes = await owner.agent
      .delete(`/api/boards/${board.body.id}/members`)
      .send({ userId: member.user.id });
    expect(removeRes.status).toBe(204);

    const afterRemove = await member.agent.get(`/api/boards/${board.body.id}`);
    expect(afterRemove.status).toBe(404);
  });
});

describe('вихід із дошки', () => {
  it('учасник іде сам — 204, дошки нема ні в списку, ні за адресою, у власника зник зі списку', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Звідки йдуть' });
    const boardId = board.body.id as string;
    await addMember(owner, boardId, member, 'VIEWER');

    const res = await member.agent.post(`/api/boards/${boardId}/leave`);
    expect(res.status).toBe(204);
    expect((await member.agent.get('/api/boards')).body.boards).toHaveLength(0);
    expect((await member.agent.get(`/api/boards/${boardId}`)).status).toBe(404);
    expect((await owner.agent.get(`/api/boards/${boardId}`)).body.members).toHaveLength(0);
  });

  it('адміністратор теж може піти сам', async () => {
    const owner = await registerUser();
    const admin = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    await addMember(owner, board.body.id, admin, 'ADMIN');
    expect((await admin.agent.post(`/api/boards/${board.body.id}/leave`)).status).toBe(204);
  });

  it('власник — 409 OWNER_CANNOT_LEAVE, дошка лишається', async () => {
    const owner = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Моя' });

    const res = await owner.agent.post(`/api/boards/${board.body.id}/leave`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OWNER_CANNOT_LEAVE');
    expect((await owner.agent.get(`/api/boards/${board.body.id}`)).status).toBe(200);
  });

  it('чужий і ще не прийнятий — 404, запрошення не зникає', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const invited = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    const boardId = board.body.id as string;
    await owner.agent
      .post(`/api/boards/${boardId}/members`)
      .send({ email: invited.payload.email, role: 'EDITOR' });

    expect((await stranger.agent.post(`/api/boards/${boardId}/leave`)).status).toBe(404);
    expect((await invited.agent.post(`/api/boards/${boardId}/leave`)).status).toBe(404);
    expect((await invited.agent.get('/api/invites')).body.invites).toHaveLength(1);
  });
});

// 05.10: панель учасників ховалась на будь-якому 403/404, і «немає такої пошти»
// читалось як «ти вже не власник». Тому кожна досяжна відмова цієї ручки має
// свій код, а «прав більше нема» — рівно два з них
describe('додавання учасника: коди відмов', () => {
  async function board() {
    const owner = await registerUser();
    const res = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    return { owner, boardId: res.body.id as string };
  }

  type Caller = Awaited<ReturnType<typeof registerUser>>;
  const add = (who: Caller, boardId: string, email: string, role = 'EDITOR') =>
    who.agent.post(`/api/boards/${boardId}/members`).send({ email, role });

  it('невідома пошта — 404 USER_NOT_FOUND, а не втрата прав', async () => {
    const { owner, boardId } = await board();
    const res = await add(owner, boardId, 'nobody@test.local');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('запрошують власника — 400 ALREADY_OWNER', async () => {
    const { owner, boardId } = await board();
    const res = await add(owner, boardId, owner.payload.email);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ALREADY_OWNER');
  });

  it('порожня пошта — 400 VALIDATION_ERROR', async () => {
    const { owner, boardId } = await board();
    const res = await add(owner, boardId, 'не-пошта');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // це не відмова: ручка — upsert, тож для того, хто вже на дошці, вона
  // рівносильна зміні ролі. Ліміту на кількість учасників у системі немає
  it('той, хто вже на дошці, — не помилка, а зміна ролі', async () => {
    const { owner, boardId } = await board();
    const member = await registerUser();
    expect((await addMember(owner, boardId, member, 'EDITOR')).status).toBe(201);

    const again = await add(owner, boardId, member.payload.email, 'VIEWER');
    expect(again.status).toBe(201);
    const roles = again.body.members.map((m: { email: string; role: string }) => [m.email, m.role]);
    expect(roles).toContainEqual([member.payload.email, 'VIEWER']);
  });

  it('пʼятеро підряд додаються без жодної відмови', async () => {
    const { owner, boardId } = await board();
    for (let i = 0; i < 5; i++) {
      const who = await registerUser();
      const res = await add(owner, boardId, who.payload.email);
      expect(res.status, who.payload.email).toBe(201);
    }
    const detail = await owner.agent.get(`/api/boards/${boardId}`);
    expect(detail.body.members).toHaveLength(5);
  });

  it('адміністратор проти адміністратора від власника — 403 CANNOT_MANAGE_MEMBER, права цілі', async () => {
    const { owner, boardId } = await board();
    const admin = await registerUser();
    const other = await registerUser();
    await addMember(owner, boardId, admin, 'ADMIN');
    await addMember(owner, boardId, other, 'ADMIN');

    const res = await add(admin, boardId, other.payload.email, 'VIEWER');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_MANAGE_MEMBER');
  });

  it('спроба перевести власника в учасники — 403 OWNER_IMMUTABLE', async () => {
    const { owner, boardId } = await board();
    const admin = await registerUser();
    await addMember(owner, boardId, admin, 'ADMIN');

    const res = await admin.agent
      .patch(`/api/boards/${boardId}/members`)
      .send({ userId: 'будь-що', role: 'VIEWER' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MEMBER_NOT_FOUND');

    const ownerRow = await prisma.user.findUnique({ where: { email: owner.payload.email } });
    const onOwner = await admin.agent
      .patch(`/api/boards/${boardId}/members`)
      .send({ userId: ownerRow!.id, role: 'VIEWER' });
    expect(onOwner.status).toBe(403);
    expect(onOwner.body.error.code).toBe('OWNER_IMMUTABLE');
  });

  // справжня втрата прав: адміністратора знизили, поки панель була відкрита
  it('знижений адміністратор — 403 NOT_BOARD_MANAGER', async () => {
    const { owner, boardId } = await board();
    const admin = await registerUser();
    const outsider = await registerUser();
    await addMember(owner, boardId, admin, 'ADMIN');
    expect((await add(admin, boardId, outsider.payload.email)).status).toBe(201);

    const adminRow = await prisma.user.findUnique({ where: { email: admin.payload.email } });
    await owner.agent.patch(`/api/boards/${boardId}/members`).send({ userId: adminRow!.id, role: 'EDITOR' });

    const res = await add(admin, boardId, outsider.payload.email);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_BOARD_MANAGER');
  });

  // власник прав не губить інакше, ніж разом із дошкою: OWNER бере не з рядка
  // учасника, а з board.ownerId, і знизити його нема кому
  it('власник: прав не губить, а на видаленій дошці — BOARD_NOT_FOUND', async () => {
    const { owner, boardId } = await board();
    const outsider = await registerUser();
    await owner.agent.delete(`/api/boards/${boardId}`);

    const res = await add(owner, boardId, outsider.payload.email);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BOARD_NOT_FOUND');
  });
});
