# RigorRun: промпт для пятичасового MVP

## Как использовать

В новом чате отправь путь к этому файлу и сообщение:

> Прочитай файл. Подтверждаю описанный письменный scope MVP. Проверь текущий код, подготовь короткий точный план и организуй его проверку. Затем реализуй продукт с параллельными субагентами под твоим контролем. Пять часов — общий бюджет работы, включая планирование, интеграцию и проверки; не расширяй scope.

Этот файл — самодостаточная спецификация, предварительная разбивка работ и инструкция исполнителю. Направление одобрено пользователем в разговоре; письменный документ ещё не прошёл review. При его подготовке продукт не изменялся, новые субагенты не запускались. Не считай исторические проверки проверками будущих изменений.

## Роль и результат

Ты — ведущий инженер и координатор RigorRun. Пользователь явно разрешает делегирование и параллельную работу, но требует контроля созданных, изменённых и удалённых файлов. Сам проверяй результаты перед интеграцией. Отвечай пользователю по-русски; продукт, лендинг и quickstart — по-английски.

За пять часов доведи ограниченный MVP **Agent Release Check** до воспроизводимого локального сценария:

**Helpdesk twin → собственный HTTP-агент → явный review правил → проверки → доказательства → повторный запуск и существующий CI gate.**

Это проверка поведения агента до релиза, а не новый автономный агент, runtime firewall или гарантия безопасности. Выдавай PASS только в пределах проверенных сценариев и наблюдаемого состояния. Отсутствие нужных доказательств — unknown/inconclusive, не PASS.

## Продуктовая спецификация

- Общее позиционирование: **“Verify what your AI agents actually do.”** Проверять, выполнил ли агент задачу и соблюдал ли ограничения, по доступным инструментам и состоянию системы. Не сужать компанию до Stripe.
- Первый поддерживаемый workflow MVP — Helpdesk: доступ к обращениям разных клиентов, разрешённые изменения, сообщения и адресаты. Общее ядро остаётся независимым от предметной области; другие системы требуют адаптеров, наблюдаемости и безопасного reset.
- ICP-гипотеза: международные B2B-команды, у которых support/operations AI-агенты выполняют реальные действия. Пользователь — инженер агента; покупатель — engineering/product lead, отвечающий за выпуск и ошибки. Потенциальных пилотов пока нет.
- Польза: воспроизводимо найти запрещённое действие, невыполненную задачу или регрессию до production и показать доказательства команде. Не обещать измеренную экономию или предотвращённые инциденты без данных.
- Бизнес-модель-гипотеза: бесплатный open-source local runner → платный пилот для конкретного workflow → в будущем managed team/cloud за совместную работу, историю, плановые прогоны и сопровождение. Платят за эксплуатацию и внедрение, не просто за доступ к открытому коду. Проверить спрос отдельно; сейчас не строить SaaS/billing.
- Конкуренция: Veris уже предлагает stateful environments и CI; Promptfoo, Giskard, LangSmith и Braintrust имеют агентные проверки/evals. Не утверждать, что конкуренты проверяют только текст или что state assertions уникальны. Наша проверяемая гипотеза — быстрый конкретный путь интеграции и понятные доказательства.
- Сайт уже имеет общее позиционирование. Контакт в публичных материалах: **erbol@rigorrun.xyz**. Статический сайт не является hosted runner; не выдавать локальный MVP за облачный сервис.

Источники для контекста, не повод повторять весь ресерч: [Veris](https://www.veris.ai/veris-benchmark), [Promptfoo BOLA](https://www.promptfoo.dev/docs/red-team/plugins/bola/), [Giskard](https://docs.giskard.ai/oss/checks/use-cases/testing-agents), [LangSmith](https://docs.langchain.com/langsmith/evaluation-types), [Braintrust](https://www.braintrust.dev/learn/ai-agent-evaluation/v0).

## Где работать

Снимок проверен при подготовке файла; перед работой проверь HEAD/status заново.

- `/home/erbol/RigorRun` — старый dirty worktree, ветка `feat/github-auditor`, исходный HEAD `388e482554c54717f692b8eb654750b97254e3de`. Не использовать его как базу MVP, не чистить и не переносить автоматически пользовательские изменения. В текущем запросе здесь добавлен только этот handoff.
- Актуальный интегрированный MVP: **`/home/erbol/.codex/worktrees/66f5/RigorRun`**, ветка `feat/hackathon-general-agent-mvp`, HEAD **`d307735004e47aa1064779b6b8c2c262071025ab`**; на момент проверки clean. Runtime интегрирован ранее в `b2b59924e9629e327d000126ebe5703853433a5c`, последующие изменения — документация.
- Создай отдельную рабочую ветку/worktree от проверенной актуальной базы. Для пишущих субагентов — отдельные worktrees от общей согласованной базы. Не перезаписывай существующие ветки и директории.
- Сохрани чужие worktrees: `/home/erbol/.codex/worktrees/64ed/RigorRun`, `/home/erbol/.codex/worktrees/6654/RigorRun`, `/home/erbol/.codex/worktrees/77c2/RigorRun`, `/home/erbol/RigorRun-dev`, `/home/erbol/RigorRun-phase3`. Старые результаты агентов — не подтверждение нового кода.
- Production `https://rigorrun.xyz` ранее обновлялся как статический сайт/docs. CLI-изменения этого цикла не опубликованы автоматически в npm. Исторический опубликованный CLI `0.6.0` не содержит будущие исправления.

Сначала прочитай актуальные `AGENTS.md`, `docs/context/AGENT_WORKFLOW.md`, `docs/context/POSITIONING.md`, `docs/context/CLAIMS.md`, `docs/context/PROGRESS.md`, `docs/product/MVP_DELIVERY.md`. Старый brief `docs/context/tasks/general-agent-mvp-2026-10-09.md` — контекст, не разрешение на новый scope. Оформи новый brief для этого цикла согласно AGENTS.

Соблюдай действующие skills: проектирование/письменное согласование → точный план → review плана → subagent-driven implementation с TDD → независимый review → свежая verification. Не обходи их ради дедлайна. Пользователь выбрал параллельных субагентов; не спрашивай способ реализации снова. Если новый чат явно утверждает этот документ, не повторяй интервью о позиционировании; уточняй только реальные новые блокеры.

## Переиспользовать, не переписывать

В базе уже есть HTTP/process/driven integration и probe, Helpdesk twin и bundled pack, state/access-log/outbox evidence, review контрактов, provenance suite, project doctor, CLI gate и GitHub Action, история и сравнение запусков, quality refusal для generated suites.

Не начинать заново policy engine, агентный SDK, benchmark generator или baseline comparison. Сначала подтвердить существующий путь публичным CLI и независимым scripted black-box control.

## P0: конкретные задачи

### 1. Явные решения review во всех путях

Проверенный остаточный дефект: `packages/cli/src/setup.ts` при обходе inferred правил делает `else rejected.push(rule.id)`. Непокрытое regex-patterns правило молча отклоняется; пересечение confirm/reject выбирает reject.

- Подтверждать/отклонять только по явному решению. Непокрытые правила оставлять inferred. При pending review остановить setup до generate/assessment/регистрации агента, вернуть понятный non-zero и ID проекта/правил, оставить проект доступным для review.
- Невалидные regex и конфликты review — явная ошибка; валидировать до внешних действий, где возможно. Сохранить намеренное подтверждение через явный pattern `.`. Не выдумывать новые CLI exit semantics без проверки текущего контракта.
- TDD: pending, explicit reject, explicit confirm, overlap, invalid regex; отрицательные тесты проверяют, что downstream generate/run не вызывались. Существующие сценарии setup не ломать.

Второй пробел: `packages/daemon/src/server.ts`, POST `/api/projects/:id/pack-suite` передаёт только `confirmedRuleIds` и молча фильтрует нестроковые элементы.

- Передавать **оба** массива в существующий `Service.installPackSuite`: `confirmedRuleIds`, `rejectedRuleIds`. Строго валидировать форму; не фильтровать некорректный ввод в успешный запрос. Неизвестные ID и конфликты должны отклоняться существующей проверкой service.
- Пустые решения не означают reject/confirm. Не ослаблять provenance/quality gate.

### 2. Read-only readiness API

В `packages/daemon/src/service.ts` уже есть `gateReadiness(projectId)` с `{ ready, reasons, source }`; использовать её без дублирования логики.

- Добавить GET `/api/projects/:id/gate-readiness` с существующей pairing/security middleware.
- Это готовность suite, не здоровье агента и не гарантия безопасности. Не запускать assess, generate, кандидата или запись файлов из GET.
- Проверить missing/stale suite, pending review, refused generated quality и корректный bundled pack. Endpoint должен согласовываться с CLI gate.

### 3. Guided Helpdesk UI

Основные файлы: `apps/app/src/product/api.ts`, `stages.tsx`, `run.tsx` и существующие Projects/Project страницы. Новые узкие компоненты допустимы; полный redesign не нужен.

- Добавить понятный путь: создать проект → выбрать Helpdesk twin → указать локальный URL и safety → показать правила → явные confirm/reject → подключить свой HTTP black-box agent → проверить readiness → run → evidence/report → повторить.
- Переиспользовать `connect`, pack-suite, review, addAgent/probe, run и project API. Добавить только отсутствующие API wrappers для pack-suite/readiness.
- Проверить регистрацию Helpdesk pack именно в реально запускаемом daemon/bootstrap; не считать её наличием на основании unit mock.
- Для installed bundled suite сохранять решения через поддерживаемый pack-suite flow: обычный review не должен незаметно оставить старую suite «актуальной». Подготовленный draft может существовать, но gate обязан отказывать до явного review.
- Не отмечать failed probe как connected. Не показывать чужие/устаревшие evidence после смены проекта, URL или reload; учитывать отмену async запросов.
- Twin и daemon могут запускаться CLI-командами из quickstart; не добавлять shell execution из браузера. Агент должен обращаться к twin, а не production CRM. Не использовать заранее успешную демку вместо собственного агента.

### 4. Доказательства успешных проверок

`packages/report/src/render.ts` сейчас подробно показывает failures, а PASS преимущественно в summary; исходные данные уже есть в run JSON.

- Добавить компактные раскрываемые детали PASS: задача, проверенные assertions, наблюдаемое состояние/действия и источник evidence. Переиспользовать текущие formatter/explain/sanitize/escape.
- Одинаково объяснять task success и policy compliance; не смешивать их в один «всё хорошо». Missing readback — явная ограниченность/unknown, не зелёный результат.
- Для внешнего black-box показывать реальные Helpdesk state/log/outbox. Не выдумывать внутренний reasoning, невидимые tool calls или AI-объяснение причин.
- Не раскрыть токены, секреты и лишние данные через новые PASS details; тесты на escaping и redaction обязательны.

### 5. Один честный quickstart

Подготовить короткий английский runbook: установка **нового локального артефакта**, запуск twin/daemon, настройка собственного HTTP-агента, review, run, HTML, повтор и CLI gate. Команды получить из реального CLI help/scripts, не придумывать. Согласовать их с UI.

Existing GitHub Action/compare переиспользовать. Не называть новую версию доступной через `npx ...@latest`, если она не опубликована. Не менять release pin без отдельного опубликованного релиза. Если требуется изменение лендинга — только фактический CTA/ссылка на реально работающий quickstart, без нового редизайна.

## Делегирование и контроль

Максимум четыре одновременных исполнителя, включая тебя. До запуска зафиксируй API contract и ownership; передай каждому baseline SHA, его worktree, краткий brief, allowlist файлов, acceptance и запреты. Каждый агент сам читает применимые AGENTS/skills.

| Исполнитель | Ответственность | Границы |
|---|---|---|
| Backend | setup review, pack-suite transport, readiness API, targeted tests | CLI setup/helper/tests, daemon server и новые API tests; core gate не ослаблять |
| UI | guided Helpdesk flow, wrappers, UI tests и один пользовательский onboarding E2E | app product/pages и согласованные E2E файлы; API server не менять |
| Evidence | PASS details, safety/redaction, report tests | packages/report; app и daemon не менять |
| Root | contracts, baseline, runbook, integration, свежие CLI/E2E/full checks и итоговый review | Разрешать пересечения заранее; не переписывать чужие задания параллельно |

После завершения реализации используй свободный слот для **read-only** независимого review интегрированного diff. Это не повторная бесконтрольная реализация. Исправления возвращай владельцу задачи или делай сам после явной передачи ownership.

Каждый агент должен вернуть: base SHA/commit, created/modified/deleted/renamed files, краткое объяснение, команды и реальные RED/GREEN результаты, риски, незавершённое. Никаких скрытых удалений, unrelated formatting, release/deploy или edits вне allowlist.

Перед интеграцией проверь `git diff --name-status`, `git diff --stat`, `git diff --check` и содержательный diff, затем применяй только принятые локальные изменения. Не интегрируй чужие dirty edits целиком. Worker «done» означает **готово к review**, а не «проверено». Статусы: assigned → running → review → integrated → verified.

Проверяй прогресс агентов на контрольных точках примерно каждые 15–20 минут; ошибки/блокеры разбирай сразу. Пользователю давай короткие обновления во время работы, не оставляй его без сообщения более 60 секунд. Не ждать одним блокирующим вызовом дольше 60 секунд. По завершении scope останови лишних своих workers, не трогай чужие процессы.

## Таймбокс — включая согласование и тесты

| Время | Выход |
|---|---|
| 00:00–00:20 | Контекст/проверка базы, короткий письменный план и review, baseline run, изоляция работ |
| 00:20–01:10 | Review fixes и readiness API; одновременно старт UI/report после согласования contracts |
| 01:10–02:10 | Собственный HTTP-агент проходит guided путь; targeted tests |
| 02:10–03:00 | PASS/FAIL evidence, интеграция веток, отчёт без утечек |
| 03:00–03:30 | Проверенный local-artifact quickstart и один сквозной путь |
| 03:30–05:00 | Только acceptance, review и исправления; новые фичи не брать |

Это оценка, не гарантия. Если не укладываемся, первым сокращай новый wizard и косметику: оставь рабочий CLI → review → run → evidence → gate. Не ослабляй проверки ради зелёного результата. Если P0 не проходит, честно верни частичный результат и конкретный блокер, а не «всё работает».

## Acceptance: доказать на интегрированном коде

Используй независимые детерминированные scripted HTTP controls, которые не читают hidden assertions/ожидаемый verdict. Реальный LLM-run — только дополнительно, если настроен провайдер; scripted control не называй LLM validation.

1. Разрешённое Helpdesk действие реально выполнено: observable state подтверждает задачу, gate exit `0`.
2. Overbroad/дефектный control нарушает ограничение: реальные evidence, FAIL, gate exit `1`.
3. Агент, который всегда отказывается/ничего не делает, не получает PASS за невыполненную разрешённую задачу.
4. Поддержанные cross-tenant read/write/leak и неправильный адресат сообщения обнаруживаются по нужному state/access-log/outbox; протестировать каждую заявленную возможность, не подразумевать её.
5. Некорректное окружение даёт gate exit `2`. Missing/stale/unreviewed/refused generated suite даёт exit `3` **до обращения к кандидату**; readiness GET не пытается её автоматически оценить/исправить.
6. Непокрытое правило остаётся inferred; explicit reject видим и не превращается в enforced правило; конфликт confirm/reject отклоняется. Проверить CLI setup и pack-suite HTTP route, а не только service unit test.
7. Нет необходимого readback → unknown/inconclusive. Изменение контракта/источника/конфигурации не продвигает прежний PASS в свежий результат.
8. UI путь работает после reload; switching projects/URLs не смешивает ответы и evidence. Failed agent probe не выдаётся за успех.
9. Чистый повтор после restart/reset воспроизводим. Один writer на project; не проверять параллельно в одном home/state directory.
10. HTML содержит реальные PASS и FAIL details, экранирует недоверенный контент, скрывает секреты; JSON/report/UI verdicts согласованы.
11. Весь quickstart исполнен через **новый локально собранный/упакованный CLI**, не старый опубликованный пакет. Существующий CI gate и history/compare не сломаны.

### Команды и ориентиры тестов

Сверь scripts/configs с актуальным checkout. Сначала targeted RED → минимальный GREEN, потом интегрированный прогон. Существующие ориентиры:

```bash
pnpm exec vitest run packages/cli/test/setup.test.ts packages/cli/test/generateReview.test.ts packages/cli/test/gateQuality.test.ts
pnpm exec vitest run packages/report/test/report.test.ts packages/report/test/explain.test.ts packages/report/test/materialized.test.ts
pnpm exec vitest run packages/cli/test/helpdesk.e2e.test.ts packages/cli/test/stripe.e2e.test.ts
pnpm build:cli
pnpm verify
pnpm verify:package
```

Добавь targeted tests новых server endpoints и guided UI. Browser acceptance запускать с соответствующим реальному daemon/app конфигом Playwright; не подменять его чисто landing/demo тестами. Проверить pairing/CSRF вместе с новыми routes. Для CLI tests используй новые временные home/state директории. Фиксируй exit codes, SHA, точные команды и пути к артефактам; прежние успешные тесты не засчитываются.

## Строгие ограничения

- Не делать managed SaaS, auth/SSO, billing/subscription, Slack approvals, runtime action blocking, новый DSL/editor, универсальный MCP gateway, реальные CRM/DB/RLS integrations или automated repair в этом цикле.
- Не менять protected `reports/**`, preregistrations, qualification harnesses и source-of-truth CLAIMS/POSITIONING/PROGRESS вне отдельно разрешённого workflow. Старые qualified результаты не квалифицируют изменённый код.
- Не читать/выводить/копировать значения секретов; использовать только имена переменных. Не печатать содержимое `~/.config/rigorrun/keys.env`. Не коммитить tokens/headers или пользовательские данные.
- Не делать destructive git reset/checkout, force-push, удаления чужих файлов/worktrees, остановку чужих experiments. Любое необходимое удаление своих файлов показывать в отчёте; существенное изменение scope требует согласования.
- Без нового явного разрешения не делать production deploy, npm publish, release/tag, remote push/merge, внешнюю рассылку или реальные production actions. Локальная сборка/упаковка/тестовый twin разрешены.
- Не обещать «first/only», уникальность, compliance/certification, investment readiness, клиентов, revenue или гарантированную безопасность. Текущие доказательства ограничены конкретным workflow и suites.

## Итоговая передача пользователю

Кратко: что реально работает; точный checkout/branch/SHA; команды запуска; где quickstart и report; какие проверки свежие; что остаётся неподдержанным; были ли удаления. Отдельно укажи статус production/npm: не опубликовано, если публикации не было.

Для каждого acceptance пункта поставь PASS/FAIL/NOT RUN с командой или артефактом. Если осталось обязательное — не объявляй MVP полностью готовым. Дай короткий hackathon сценарий на основе реально пройденного пути, без выдуманной traction и без подмены scripted control живым LLM.
