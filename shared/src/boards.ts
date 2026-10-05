import type { BoardObject } from './board-objects';

// порядок важливий: OWNER > ADMIN > EDITOR > VIEWER. Власник ролі не має —
// він визначається полем ownerId дошки, тому в цьому типі його й немає
export type BoardRole = 'ADMIN' | 'EDITOR' | 'VIEWER';

// хто кого може чіпати в керуванні учасниками: власник — будь-кого,
// адміністратор — лише тих, хто нижчий за нього
export function outranks(actor: 'OWNER' | BoardRole, target: 'OWNER' | BoardRole) {
  if (actor === 'OWNER') return target !== 'OWNER';
  if (actor === 'ADMIN') return target === 'EDITOR' || target === 'VIEWER';
  return false;
}

// над адміністратором стоїть не завжди лише власник: того, кого підняв інший
// адміністратор, може зняти будь-який адміністратор. А от підняти адміном
// когось власноруч — це вже рішення власника, і скасовує його теж власник
export function canManageMember(
  actor: 'OWNER' | BoardRole,
  target: { role: 'OWNER' | BoardRole; roleGrantedBy?: string | null },
  boardOwnerId: string,
) {
  if (target.role === 'OWNER') return false;
  if (actor === 'OWNER') return true;
  if (actor !== 'ADMIN') return false;
  if (target.role !== 'ADMIN') return true;
  return target.roleGrantedBy !== boardOwnerId;
}

// PENDING — запросили, але ще не прийняв; доступу поки нема
export type MemberStatus = 'PENDING' | 'ACCEPTED';

export interface BoardMemberInfo {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  // коли людину запросили на дошку. У прийнятого це ж і «відколи він тут»:
  // рядок на місці, міняється в ньому лише статус
  createdAt: string;
  role: BoardRole;
  // хто дав цю роль — від цього залежить, чи зможе цього адміністратора
  // зняти інший адміністратор (див. canManageMember)
  roleGrantedBy: string | null;
  status: MemberStatus;
}

// запрошення очима того, кого кличуть
export interface BoardInvite {
  boardId: string;
  boardTitle: string;
  role: BoardRole;
  // null — той, хто кликав, уже видалив акаунт
  invitedBy: {
    userId: string;
    displayName: string;
    email: string;
    avatarUrl: string | null;
    bio: string | null;
  } | null;
  createdAt: string;
}

export interface InvitesResponse {
  invites: BoardInvite[];
}

export interface BoardSummary {
  id: string;
  title: string;
  ownerId: string;
  isOwner: boolean;
  // моя роль саме на цій дошці — щоб список не показував дій, на які прав
  // немає; isOwner лишаємо, бо на нього вже спирається чимало місць
  myRole: 'OWNER' | BoardRole;
  createdAt: string;
  updatedAt: string;
}

export interface BoardDetail extends BoardSummary {
  members: BoardMemberInfo[];
}

export interface BoardListResponse {
  boards: BoardSummary[];
}

export interface CreateBoardRequest {
  title: string;
}

export interface UpdateBoardRequest {
  title: string;
}

export interface AddBoardMemberRequest {
  email: string;
  role: BoardRole;
}

// коди відмов при керуванні учасниками. Код — машинне, по ньому клієнт вибирає
// текст; на status покладатись не можна, бо на одному 403/404 сидить і «у тебе
// більше нема прав», і «такої пошти нема». Панель учасників розрізняла їх саме
// за status і будь-яку відмову показувала як втрату прав (05.10)
export const MEMBER_ERROR = {
  // пошта не належить жодному зареєстрованому користувачу
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  // запрошують власника дошки — у нього й так повний доступ
  ALREADY_OWNER: 'ALREADY_OWNER',
  // такого учасника на дошці немає (його прибрали, поки панель була відкрита)
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
  // власника дошки чіпати не можна нікому, зокрема й іншому власнику
  OWNER_IMMUTABLE: 'OWNER_IMMUTABLE',
  // ієрархія: цього конкретного учасника я чіпати не можу (адміністратор
  // проти адміністратора, якого підняв власник). Мої права при цьому цілі
  CANNOT_MANAGE_MEMBER: 'CANNOT_MANAGE_MEMBER',
  // ЄДИНИЙ код, що означає «прав на дошці більше нема»: я вже не власник і не
  // адміністратор. Разом із BOARD_NOT_FOUND (дошку видалили або мене прибрали
  // звідти цілком) це те, через що панель має зникнути, а не просто показати
  // помилку
  NOT_BOARD_MANAGER: 'NOT_BOARD_MANAGER',
} as const;

export type MemberErrorCode = (typeof MEMBER_ERROR)[keyof typeof MEMBER_ERROR];

// відмови, після яких керувати учасниками вже нема сенсу — панель ховається
export function isLostBoardRights(code: string) {
  return code === MEMBER_ERROR.NOT_BOARD_MANAGER || code === 'BOARD_NOT_FOUND';
}

// роль міняємо на місці, не видаляючи й не заводячи учасника наново —
// інакше ряд у базі щоразу новий, а з ним і його id
export interface UpdateBoardMemberRequest {
  userId: string;
  role: BoardRole;
}

// примусове вимкнення мікрофона/звуку учаснику. Обидва поля необовʼязкові:
// адміністратор міняє те, що натиснув
export interface ForceVoiceRequest {
  userId: string;
  mute?: boolean;
  deafen?: boolean;
}

export interface RemoveBoardMemberRequest {
  userId: string;
}

// снепшот — увесь вміст дошки одним масивом; тимчасово, до CRDT
export interface SnapshotResponse {
  objects: BoardObject[];
  // null — дошку ще жодного разу не зберігали
  updatedAt: string | null;
}

export interface SaveSnapshotRequest {
  objects: BoardObject[];
  // стратегія 3: клієнт має лише частину дошки, тож пише не всю, а ці клітинки —
  // сервер замінює в базі тільки їх, решту лишає як є. Нема поля — уся дошка
  cells?: string[];
}

// рядок списку версій — без самого стану: список відкривають часто, а
// стан потрібен лише на відкаті, і його сервер бере з бази сам
export interface BoardVersionInfo {
  id: string;
  createdAt: string;
  // null — автозбереження або ручне без підпису
  label: string | null;
  isManual: boolean;
  createdByName: string;
}

export interface VersionsResponse {
  versions: BoardVersionInfo[];
}

export interface SaveVersionRequest {
  label?: string;
}

export interface UploadImageResponse {
  url: string;
}
