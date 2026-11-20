# Работа агента в CV workspace

Эти инструкции действуют для всего репозитория. Учитывай более узкие
`AGENTS.md`, если они появятся в подкаталогах, и явно заданные требования задачи.

## С чего начать

1. Прочитай [Architecture.md](Architecture.md) и README изменяемого компонента.
2. Проверь `git status --short`, текущую ветку и `git remote -v`. Сохрани чужие
   правки; перед push проверь, что целевой remote принадлежит нужному форку.
3. Найди реализацию, публичный контракт и соседние тесты через `rg`.
4. Посмотри `project.json` компонента и корневой `nx.json`: имя Nx-проекта может
   отличаться от имени каталога. Выбирай проверки по затронутой границе.
5. Изменяй источник, а не `dist`, `.next`, `.nx` или сгенерированные артефакты.

Источник актуального поведения — код, схемы, `project.json` и тесты. Некоторые
README отражают предыдущие итерации. Например, текущие workflow-маршруты
начинаются с `/ai-workflows`, а сериализация запросов таблиц использует
экспортируемые API codecs; не восстанавливай старый протокол из текста README.
Исправляй найденные расхождения в документации в пределах своей задачи.

## Назначение проекта

Это персональный реестр вакансий и откликов с подготовкой CV и сопроводительных
писем под вакансии. Основные входы — URL вакансии и опубликованные Reviewed
facts кандидата. Основной результат — проверенная человеком версия документа,
страница CV и PDF.

- Браузерный Registry и Electron используют общий React-код.
- Генерация ИИ доступна в desktop через локальный Codex; в web она отключена.
- API, PostgreSQL, MinIO, NATS, CV renderer и PDF worker — отдельные границы.
- Факты кандидата находятся в отдельном `cv-content`; этот checkout не содержит
  готовый личный профиль и не реализует многопользовательский SaaS.

## Окружение и запуск

Версию Node.js бери из `.node-version`, Bun — из `packageManager` корневого
`package.json` (сейчас Node.js 24.18.0 и Bun 1.3.13). Устанавливай зависимости из
корня через `bun install --frozen-lockfile`; при намеренном обновлении зависимостей
используй `bun install` и коммить согласованный `bun.lock`.

Для серверной части на localhost достаточно Docker с Compose:

```bash
cp .env.compose.example .env  # Только при первом создании локальной конфигурации.
docker compose up --build -d
docker compose ps -a
```

Пошаговый запуск, импорт фактов и desktop-настройки находятся в
[docker/local/README.ru.md](docker/local/README.ru.md). По умолчанию Registry
слушает localhost:4300, API — localhost:3001, CV — localhost:4381.

`bootstrap` и `migrate` — одноразовые задачи; нормальный итог для них — exit 0.
Остальные сервисы должны работать. Локальный образ содержит runtime и workspace;
устанавливать Node/Bun на хост для Compose не требуется. Исходники копируются в
образ: после изменений серверного кода нужен `docker compose up --build -d`.

Нативный desktop требует Node/Bun и графическую сессию. Локальное HTTP-превью
разрешается явным `CV_LOCAL_DEVELOPMENT=1` для web/desktop цепочки сборки; задай
`VITE_CV_WEB_ORIGIN` с портом CV. Используй команды из локальной инструкции и
[desktop README](apps/application-registry-desktop/README.md).

Nix/direnv — дополнительный авторский путь, а не обязательное условие Docker.
`.env.local.example` относится к Infisical, `.env.compose.example` — к Compose.
Обычная активация direnv не загружает удалённые секреты. Для локальных изменений
не требуется доступ к production Vault, Infisical, Nomad или Cloudflare.

## Карта мест для изменений

| Задача | Основной источник |
| --- | --- |
| Таблица, ограничение БД, модель, query definition | `libs/application-registry/entity` |
| SQL, транзакция, persistence outcome | `libs/application-registry/crud` |
| Бизнес-операция, версии, идемпотентность | `libs/application-registry/service` |
| HTTP endpoint, request/response schema | `libs/application-registry/api-contract` |
| Генерируемый HTTP-клиент | `libs/application-registry/api-client` |
| HTTP handler, auth, CORS, runtime wiring | `apps/application-registry-api` |
| Поток подготовки, prompts, evidence, review | `libs/application-registry/preparation-workflow` |
| Registry I/O и React atoms подготовки | `apps/application-registry/src/preparation/data` |
| Editor draft, history, validation, assistant patches | `apps/application-registry/src/preparation/document-state` |
| Редактор и preview UI | `apps/application-registry/src/preparation/document-workspace` |
| UI публикации и PDF readiness | `apps/application-registry/src/preparation/publication` |
| IPC, credentials, вызовы Codex SDK | `apps/application-registry-desktop` и `libs/application-registry/desktop-contract` |
| Контракты CV, фактов, guidance и доставки | `libs/cv-contracts` |
| Авторинг, компиляция и чтение фактов | `libs/facts-authoring`, `libs/facts-release`, `libs/facts-reader`, `tools/facts-release` |
| HTML, web preview и A4 rendering | `apps/cv` |
| PDF-инварианты и orchestration | `libs/application-registry/pdf-processing` |
| NATS/Chromium/S3 адаптеры PDF | `apps/application-registry-pdf-worker` |
| Контракты событий и NATS transport | `libs/application-registry/events`, `libs/application-registry/events-nats` |
| Локальный стек | `compose.yaml`, `docker/local` |
| Deployment/topology/edge policy | `nomad/packs`, `terraform`, `.github/workflows` |

## Границы, которые нужно сохранять

### Backend и контракты

- Физическая схема и история PostgreSQL принадлежат `entity`. Генерируй codecs
  и query capabilities из существующих определений; не создавай параллельную
  модель колонок, фильтров или сортировки в UI и HTTP handlers.
- CRUD отвечает за SQL и транзакции, service — за бизнес-операции. HTTP handlers
  декодируют запрос, вызывают service и отображают результат в HTTP.
- Используй общий `HttpApi` и производные клиенты. Канонический management prefix
  — `/api/registry`; отдельного BFF или альтернативного API здесь нет.
- Документы в registry content services остаются opaque bytes плюс метаданные:
  hash, media type, contract/version, locale, source pins. Валидация полей CV
  принадлежит подготовке и renderer. Backend может использовать delivery
  contracts; не переноси в service разбор `@cv/contracts/document` или `/facts`.
- Импортируй публичные package entrypoints; конкретные backend Layers обычно
  доступны через `/live`. У `@cv/contracts` нет корневого экспорта: выбирай
  `/document`, `/facts` или `/delivery` по ответственности.

### Версии и повторные операции

- Сохраняй `expectedVersion` и обработку optimistic conflicts. Перед повтором
  перечитывай состояние; не превращай конфликт в безусловную перезапись.
- Idempotency key передаётся в HTTP header. Сохраняй один operation ID при
  повторе той же операции и обнаруживай повтор с другим payload.
- Изменения aggregate, backend activity, монотонной revision и receipt должны
  сохранять существующие транзакционные гарантии CRUD.
- Activities — история, создаваемая backend. Не добавляй клиентский путь
  произвольной записи activities вместо бизнес-команд.
- Применённые SQL-миграции неизменяемы: добавляй следующую миграцию и сохраняй
  checksum journal. Не подменяй checked-in history на `drizzle push`.

### Facts, ИИ и review

- Сохраняй версионирование immutable facts releases, проверку SHA-256/размеров/
  media types и compare-and-set активацию `current.json`.
- ID контрактов неизменяемы. Новая несовместимая версия требует нового контракта
  и сохранения версий, на которые ещё ссылаются публикации или facts releases.
- Генерация использует проверенные facts/evidence IDs и точные source pins.
  Сохраняй provenance checks, ограничения assistant patches и human-review gate.
- Privacy-проекция определена в `generation/evidence.ts` и её тестах. Не добавляй
  в prompts сырой каталог и не обещай фильтрацию всех работодателей: текущая
  проекция сохраняет experience. Меняй политику явно и проверяй её тестами.
- Codex остаётся в Electron main process за узким preload bridge. Credentials и
  model configuration принадлежат нативной установке; не дублируй их в React и
  не добавляй ChatGPT proxy в web как побочный эффект другой задачи.
- Schema-valid output не доказывает достоверность текста. Утверждение документа
  должно оставаться явным действием человека.

### Состояние UI

Сначала прочитай
[preparation README](apps/application-registry/src/preparation/README.md).
Сохраняй семь владельцев состояния: `data`, workflow package, `workflow`,
`publication`, `document-state`, `document-workspace`, `guidance`.

Remote state хранится в typed queries/mutations, progress — в workflow runtime,
редактируемый draft — в editor session. React routes подписываются на проекции
и вызывают команды. Не копируй remote heads и workflow candidates в `useState`,
`useEffect` или query parameters для синхронизации второго источника истины.

Memory engine не обеспечивает восстановление после reload. Не объявляй процесс
возобновляемым, пока не реализованы durable engine и восстановление review handles.

### Публикация и PDF

- Проверяй точную связку application, entry, approved revision, publication
  version и public URL. Старый успешный PDF не делает новую публикацию готовой.
- Сохраняй capability protection preview/render routes и правила CSP/cache.
- NATS работает с доставкой at least once. Consumers должны быть идемпотентными;
  ack следует после успешных эффектов или записи окончательной ошибки.
- Publication notifications — best effort после изменения БД; явный PDF request
  требует публикации события. Между PostgreSQL и NATS нет общей транзакции.
- Runtime publishers/consumers не создают топологию: production задаёт Terraform,
  локальную — `docker/local/bootstrap.mjs`, тестовую — test infrastructure.
- Chromium — авторитетная проверка A4 layout. Сохраняй render-version marker,
  измерения, проверку числа страниц и обработку сменившейся публикации.

## Стиль реализации

TypeScript strict и ESM. Следуй соседним модулям и существующим Effect Services,
Layers, tagged errors и Schema codecs. Ошибки внешних систем преобразуй на
границе адаптера; Promise-based SDK допустимы внутри соответствующих адаптеров.
Не скрывай ошибки широким catch и не ослабляй типы через `any` ради сборки.

Переиспользуй `internal-ui`, общие формы и metadata-driven filters. Бизнес-таблицы
и orchestration остаются в приложениях; универсальные компоненты — в библиотеках.
Для UI состояний используй существующие colocated Storybook stories.

Форматирование и imports проверяет Biome: 2 пробела, одинарные кавычки JS/TS,
без обязательных semicolons. Проверяй `biome.json`, не добавляй второй formatter.

Effect использует закреплённую v4 beta, state-tree — snapshot из GitHub Releases.
При обновлении state-tree меняй согласованно catalog, overrides и lockfile.
Не подключай соседний checkout или другой package manager ради обхода ошибки.

## Проверки по типу изменения

Имена для Nx проверяй в `project.json`. В частности:

| Каталог | Имя Nx-проекта |
| --- | --- |
| `apps/application-registry` | `application-registry-management` |
| `libs/application-registry/preparation-workflow` | `application-preparation-workflow` |
| `libs/cv-contracts` | `cv-contracts` |
| `tools/facts-release` | `facts-toolchain` |

Базовые команды из корня:

```bash
bunx nx show projects
bunx nx show project application-registry-management
bunx nx run application-registry-api:typecheck
bunx nx run application-registry-api:test:unit
bunx nx run application-registry-management:typecheck
bunx nx run application-registry-management:test:unit
bunx nx run application-preparation-workflow:test:unit
```

Выбирай проверки, которые покрывают изменение:

| Изменение | Проверки |
| --- | --- |
| Только документация | Ссылки, пути, команды, согласованность с кодом; `git diff --check` |
| TS/API/бизнес-логика | Biome, typecheck и unit tests затронутых проектов |
| SQL, concurrency, транзакции | CRUD/service/API integration suites по затронутой границе |
| HTTP-контракт | API и клиентов: typecheck, contract tests, нужные integration tests |
| Prompts, provenance, review | `application-preparation-workflow` unit tests и связанные management tests |
| CV HTML, CSS, A4, PDF | Renderer/PDF unit tests и `cv:test:e2e` |
| Compose/bootstrap/CDP | `docker compose config --quiet`, build и `docker compose run --rm smoke` |
| Схема БД | Generate/inspect migration и `application-registry-entity:migrations:check` |

При изменении схемы БД:

```bash
bunx nx run application-registry-entity:migrations:generate
bunx nx run application-registry-entity:migrations:check
```

Для широких изменений `bun run quality` запускает Biome, typechecks и unit tests.
Integration и browser suites запускаются отдельно:

```bash
bunx nx run application-registry-crud:test:integration
bunx nx run application-registry-service:test:integration
bunx nx run application-registry-api:test:integration
bunx nx run application-registry-events-nats:test:integration
bunx nx run cv:test:e2e
```

Integration suites требуют Docker; Playwright e2e — Chromium и его OS dependencies.
Testcontainers используют собственные закреплённые образы: сборка MinIO для
Compose не заменяет образ внутри этих suites. При pull error различай сбой
доставки зависимости и падение тестируемого поведения; не отключай проверки.

Compose smoke проверяет API/auth, БД, очередь, fixture rendering и S3 round trip.
Он не подтверждает генерацию через Codex, полный review/publication workflow
или доставку PDF-события через worker; эти границы требуют отдельных проверок.

Не пересобирай весь стек и не запускай полный набор tests для текстовой правки.
После исправления проверяй новую ошибку целевым тестом и сообщай реальные
результаты, включая пропущенные или заблокированные проверки.

## Данные и завершение задачи

Секреты, личный `cv-content`, bundle и экспортированные CV/PDF держи вне Git.
Локальные рабочие артефакты можно складывать в игнорируемую `.cv-work`.
Сохраняй разделение Registry bearer token, facts publication token, MinIO keys
и нативной авторизации Codex; не встраивай их в frontend build.

`docker compose stop` и `down` сохраняют volumes. `down -v` удаляет данные:
используй его только для явно временного тестового проекта или запрошенного
сброса, не как средство исправления неизвестной ошибки. Локальная задача не
требует изменения чужих production ресурсов или доступа к их секретам.

В итоговом сообщении укажи изменение, проверки и существенные ограничения.
Обновляй [Architecture.md](Architecture.md) при изменении границ/потоков, а
локальную инструкцию — при изменении запуска или конфигурации. Коммить только
относящиеся к задаче файлы; создавая ветку, используй префикс `codex/`.
