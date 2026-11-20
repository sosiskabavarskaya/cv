# Локальный запуск CV через Docker Compose

Compose поднимает персональный Registry API, браузерную панель, CV-сайт,
PostgreSQL, MinIO, NATS JetStream, Chromium и PDF worker. Миграции, бакеты,
поток событий и PDF consumer создаются автоматически. Данные сохраняются в
именованных Docker volumes.

Это окружение разработки на localhost. Панель работает через Vite, CV-сайт —
через Next.js dev server. Для серверной части достаточно Docker с Compose v2
или новее; устанавливать Node.js, Bun, Nix, Nomad, Vault и Infisical на хост не
нужно. На первую сборку нужны интернет и место для образа с Chromium и
зависимостями workspace. MinIO собирается из закреплённого официального
коммита релиза RELEASE.2025-09-07T16-13-09Z с проверкой SHA-256 архива:
предсобранные community-образы этого релиза больше не скачиваются публично.
Первая сборка MinIO дополнительно загружает Go-модули; последующие используют
BuildKit cache.

## Быстрый запуск

Из корня репозитория:

```bash
cp .env.compose.example .env
docker compose up --build -d
docker compose ps -a
```

При повторном запуске используйте `docker compose up -d`. После изменения
исходников пересоберите образ через `docker compose up --build -d`.

`bootstrap` и `migrate` должны завершиться с кодом 0: это одноразовые задачи.
Сервисы API, панели, CV и Chromium имеют проверки готовности. PDF worker
подключается к готовому consumer и пишет сообщение о запуске в журнал.

| Адрес по умолчанию | Назначение |
| --- | --- |
| http://localhost:4300 | Панель управления Registry |
| http://localhost:3001/api/registry/health | API, требует bearer-токен |
| http://localhost:4381/c/_internal/health | Проверка CV-сайта |
| http://localhost:9001 | Консоль MinIO |

На первом экране панели укажите origin `http://localhost:3001` и значение
`REGISTRY_API_TOKEN` из `.env`. По умолчанию это `cv-local-registry-token`.
Native desktop требует `REGISTRY_API_URL` и `REGISTRY_API_TOKEN` вместе.
Bun автоматически читает `.env`, поэтому наличие одного токена без URL приводит
к `The Registry environment configuration is invalid`. В примере заданы оба
значения; для старого `.env` добавьте `REGISTRY_API_URL=http://localhost:3001`.
Если меняете `REGISTRY_API_PORT`, обновите и этот URL.

Для MinIO используются `MINIO_ACCESS_KEY_ID` и `MINIO_SECRET_ACCESS_KEY` из
этого же файла. Учётные данные из примера предназначены для локального стенда.

Порты можно изменить в `.env`: `REGISTRY_PORT`, `REGISTRY_API_PORT`, `CV_PORT`
и `MINIO_CONSOLE_PORT`. Открывайте интерфейс через `localhost`, чтобы origin
CV совпадал с настройкой превью. Compose публикует порты только на 127.0.0.1;
PostgreSQL, S3 API, NATS и CDP Chromium остаются внутри Docker.

## Проверка запуска

```bash
docker compose logs --tail=100 bootstrap migrate api pdf-worker
curl --fail -H 'Authorization: Bearer cv-local-registry-token' \
  http://localhost:3001/api/registry/health
curl --fail http://localhost:4381/c/_internal/health
```

Если токен или порты изменены, подставьте свои значения. Health API проверяет
доступ с токеном; успешный импорт фактов дополнительно проверяет MinIO.

Сквозная проверка локальных сервисов, включая реальную печать тестового CV в
PDF через Chromium, описана в `smoke.mjs` и запускается так:

```bash
docker compose run --rm smoke
```

## Данные кандидата

Первый запуск создаёт пустую базу вакансий и пустые бакеты. Генерация требует
активного каталога Reviewed facts: сведений о вашем опыте, навыках, проектах,
образовании и контактах. Исходники этих данных находятся в отдельном
репозитории `cv-content`, а не в коде приложения. Языки также берутся из
опубликованного каталога.

Если у вас есть совместимый пакет `facts.bundle.json`, положите его в
игнорируемую Git папку и импортируйте через API:

```bash
mkdir -p .cv-work/imports
cp /путь/к/facts.bundle.json .cv-work/imports/facts.bundle.json
docker compose run --rm facts
```

Для другого каталога используйте абсолютный путь:

```bash
FACTS_IMPORT_DIR=/полный/путь/к/каталогу docker compose run --rm facts
```

Контейнер читает `/imports/facts.bundle.json`. Токен `FACTS_PUBLISH_TOKEN`
берётся из `.env`; прямые MinIO-ключи для публикации не нужны. Команда
проверяет пакет, регистрирует неизменяемые объекты и активирует релиз.
После импорта откройте Reviewed facts и проверьте, что сведения принадлежат вам.

При наличии исходников `cv-content` можно собрать пакет без Node.js и Bun
на хосте. Папка должна быть читаемой, а для build — также доступной на запись
пользователю контейнера (UID 1000):

```bash
mkdir -p .cv-work/imports
docker compose run --rm --no-deps \
  -v /полный/путь/к/cv-content:/content \
  facts check --content-root /content

docker compose run --rm --no-deps \
  -v /полный/путь/к/cv-content:/content \
  facts build --content-root /content \
  --source-commit ПОЛНЫЙ_SHA_КОММИТА_CV_CONTENT \
  --output /content/facts.bundle.json
```

`--source-commit` принимает полный Git SHA в нижнем регистре. Подготовленный
пакет публикуется предыдущей командой, например с
`FACTS_IMPORT_DIR=/полный/путь/к/cv-content`. Не добавляйте свои персональные
данные или bundle в этот репозиторий.

## Генерация через ИИ

Браузерная панель позволяет вести вакансии и вручную редактировать документы,
но ИИ-команды в ней отключены. Генерация работает в нативном Electron-клиенте
через локальную установку Codex. Docker не получает авторизацию Codex и не
запускает Electron.

Для desktop нужны Node.js из `.node-version` и Bun 1.3.13 на компьютере.
Из корня проекта, в графической сессии:

```bash
bun install --frozen-lockfile
codex login status
# Если вход ещё не выполнен:
codex login

CV_LOCAL_DEVELOPMENT=1 \
VITE_CV_WEB_ORIGIN=http://localhost:4381 \
REGISTRY_API_URL=http://localhost:3001 \
REGISTRY_API_TOKEN=cv-local-registry-token \
  bunx nx run application-registry-desktop:start
```

Подставьте порты и токен из `.env`. `CV_LOCAL_DEVELOPMENT=1` разрешает
loopback HTTP origin для всей локальной цепочки: предварительной web-сборки
и desktop renderer. Без флага сборки сохраняют требование HTTPS. Флаг и origins
учитываются в Nx cache; при смене окружения запустите сборку заново.

На WSL предусмотрена нативная Windows-сборка:

```bash
CV_LOCAL_DEVELOPMENT=1 \
VITE_CV_WEB_ORIGIN=http://localhost:4381 \
  bunx nx run application-registry-desktop:start:windows:wsl
```

В этом случае войдите в Codex в Windows и укажите API origin и токен в форме
Electron. Приложение использует Windows-профиль Codex. См. также
[README desktop-клиента](../../apps/application-registry-desktop/README.md).

Порядок работы:

1. Проверить свои сведения в Reviewed facts и рекомендации в CV guidance.
2. Открыть AI workflows, создать процесс и вставить URL вакансии.
3. Выбрать опубликованный язык и при необходимости сопроводительное письмо.
4. Дождаться подготовки, проверить документ, внести правки и утвердить его.
5. Опубликовать CV и дождаться готовности PDF.
6. Вести дальнейшие статусы, заметки и историю в Applications.

Можно обрабатывать до 25 уникальных URL за один запуск. Переключение экранов
не останавливает процесс. Перезагрузка окна и закрытие приложения теряют
активные workflows; сохранённые версии документов остаются на сервере.

## Страницы CV и PDF

Стабильная локальная ссылка имеет вид `http://localhost:4381/c/<token>`.
API использует `CV_LOCAL_PUBLIC_BASE_URL`, а Chromium и PDF worker разделяют
сетевое пространство контейнера `cv`. Поэтому Chromium открывает тот же
буквальный URL с localhost, что и браузер на компьютере; он же попадает в QR.
CDP слушает только внутренний loopback и не публикуется на хост.

Для просмотра встроенного примера без импорта фактов:

```bash
CV_FIXTURE_MODE=1 docker compose up -d cv chromium pdf-worker
```

Откройте http://localhost:4381/c/fixture. Это тестовое резюме для проверки
рендера, оно не добавляет факты кандидата и вакансии. Вернуться к обычному
режиму можно командой `docker compose up -d cv chromium pdf-worker` при
`CV_FIXTURE_MODE=0` в `.env`.

Ссылки этого стенда доступны только на вашем компьютере. Для отправки
работодателю нужно отдельное развёртывание с доступным HTTPS-адресом.
Cloudflare-аналитика, очистка edge-кеша и периодическая проверка вакансий
в этот локальный Compose не включены.

## Остановка и диагностика

```bash
docker compose logs -f api registry cv pdf-worker
docker compose stop
docker compose up -d
```

`docker compose down` удаляет контейнеры и сеть, сохраняя данные.
`docker compose down -v` дополнительно удаляет базу, файлы и очередь — это
команда полного сброса стенда.

Если порт занят, измените соответствующее значение в `.env` и повторите
`docker compose up -d`. Если вы изменили пароль PostgreSQL после создания
volume, база сохраняет прежний пароль: верните прежнюю настройку либо
измените пароль пользователя внутри PostgreSQL. MinIO и NATS также должны
использовать согласованные значения в своих контейнерах и клиентах.

При ошибках init смотрите `docker compose logs bootstrap migrate`. Инициализация
повторяема: существующие бакеты, поток и consumer сохраняются, применённые
миграции проверяются по журналу и контрольным суммам.
