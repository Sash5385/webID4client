# CLAUDE.md — webID4client (Client PWA, еталон)

## Workflow

Нові функції та виправлення спочатку тут, потім портуються в `webOlhaDriveClient`.
GitHub акаунт: `sash5385`

## Стек

- React + Vite + JSX
- Firebase Realtime Database
- Firebase Hosting (проєкт: `id4drive-booking-44182`)
- PWA (Service Worker, useAppUpdate hook)

## Хост

id4drive-booking-44182.web.app

## Деплой

SA ключ: `/home/user/id4drive-sa.json` (завантажується з Firebase Console на початку сесії)

```bash
cd /home/user/webID4client
GOOGLE_APPLICATION_CREDENTIALS=/home/user/id4drive-sa.json npm run build
GOOGLE_APPLICATION_CREDENTIALS=/home/user/id4drive-sa.json firebase deploy --only hosting
```

## Правила

- Мінімальні зміни — не переписувати робочий код без причини
- Не змінювати UI без прямого запиту (кольори, відступи, структура)
- Не виконувати без підтвердження: `rm -rf`, `git reset --hard`, `git push --force`

## Стиль відповідей

- Мінімум тексту: що зроблено + файл/рядок, без пояснень якщо не питали
- Після кожного повідомлення виводити **Повідомлення #N**
- Після 30 повідомлень — запропонувати новий чат з підсумками
