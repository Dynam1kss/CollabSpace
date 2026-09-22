// єдина робота цього воркера — швидше вантажити оболонку застосунку й дати
// браузеру підставу вважати сайт встановлюваним. Офлайн-редагування тут нема
// і не планується: дошка живе на сокеті, а розійдені стани зводити нікому

const SHELL = 'collabspace-shell-v1';

// що взагалі можна класти в кеш. /assets/ від vite має хеш у назві, тому
// вміст під однією адресою ніколи не міняється
const CACHEABLE = [/^\/assets\//, /^\/icons\//, /^\/manifest\.webmanifest$/, /^\/favicon\./];

// сюди не лізти ніколи: свіжість тут важливіша за швидкість
const NEVER = [/^\/api\//, /^\/uploads\//, /^\/ws/];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== SHELL).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.some((re) => re.test(url.pathname))) return;

  // сама сторінка — спершу з мережі: у ній лежать посилання на свіжі бандли,
  // і застаріла оболонка тягла б за собою вже видалені assets
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r ?? Response.error())),
    );
    return;
  }

  if (!CACHEABLE.some((re) => re.test(url.pathname))) return;

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          // у кеш кладемо лише вдалі відповіді — інакше 404 залипне назавжди
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
