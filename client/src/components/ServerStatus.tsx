import { useEffect, useState } from 'react';
import type { HealthResponse } from 'shared';

export function ServerStatus() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <p className="server-status">
      {health ? `сервер живий (uptime ${Math.round(health.uptimeSeconds)} с)` : 'сервер недоступний'}
    </p>
  );
}
