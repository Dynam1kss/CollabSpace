// межі, які сервер оголошує клієнту. Клієнт не вигадує своїх чисел: показує
// й перевіряє рівно те, що прийшло звідси
export interface ServerLimits {
  fileMaxBytes: number;
  boardFilesMaxBytes: number;
}

export interface HealthResponse {
  status: 'ok';
  uptimeSeconds: number;
  version: string;
  limits: ServerLimits;
}
