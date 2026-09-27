import { useEffect, useState } from 'react';
import type { HealthResponse } from 'shared';
import { useTranslation } from 'react-i18next';

export function ServerStatus() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <p className="server-status">
      {health ? t('server.alive', { seconds: Math.round(health.uptimeSeconds) }) : t('server.down')}
    </p>
  );
}
