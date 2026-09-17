// жива синхронізація дошки поверх ws /ws/boards/:id — бінарні кадри,
// перший байт — тип, далі байти Yjs як є (сервер їх не розбирає):
//   UPDATE        [0][yjs update]           редактор → усім іншим у кімнаті
//   SYNC_REQUEST  [1][state vector]         новий клієнт → сервер додає 4 байти
//                 свого id і шле найстаршому редактору: [1][id][state vector]
//   SYNC_REPLY    [2][id][yjs update]       редактор → сервер знімає id і
//                 віддає [2][yjs update] тому, хто питав
// без запиту/відповіді новий клієнт не зміг би застосувати наступні
// оновлення інших: yjs вимагає всю попередню історію їхніх правок
export const SYNC_MSG = {
  UPDATE: 0,
  SYNC_REQUEST: 1,
  SYNC_REPLY: 2,
} as const;

export const SYNC_REQUESTER_ID_BYTES = 4;
