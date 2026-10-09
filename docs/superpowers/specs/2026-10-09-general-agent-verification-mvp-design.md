# RigorRun: general agent verification — three-hour MVP design

Дата: 2026-10-09. Статус: предложение на согласование, не выполненный релиз.

## 1. Решение

RigorRun — слой проверки действий AI-агентов перед развёртыванием. Он проверяет согласованный workflow в контролируемой среде и сопоставляет слова агента с наблюдаемыми изменениями, чтениями и отправками, доступными конкретному адаптеру.

Это не ещё один агент, который исполняет бизнес-задачу. Это инструмент разработчика, который отвечает: «После изменения модели, промпта, инструментов или прав наш агент всё ещё делает разрешённую работу и не делает запрещённую?»

Горизонт продукта — разные системы и workflows. Первый продаваемый результат — проверка одного заранее согласованного сценария, а не обещание автоматически проверить любые действия в любой системе.

Английский оффер:

> Verify what your AI agents actually do.
>
> Test agent permissions, workflow rules and side effects before deployment—with evidence from the system.

Обязательное уточнение:

> Start with bundled, testable workflows. Custom integrations require observable state and a safe test environment. RigorRun does not block production actions.

## 2. Что известно из аудита

Проверялись текущая рабочая копия и Git-объекты современной ветки. Код продукта в ходе этого аудита не менялся.

| Наблюдение                                                                                              | Основание                                                                                                               | Следствие                                                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Рабочая ветка — старый CLI v0.3.0; современный master — CLI v0.6.0                                      | HEAD `388e4825`; master `3e2d4e3db3d15b2301599251ad11a4b1b5127781`; remote heads проверены read-only                    | Не собирать MVP на старой ветке и не выкатывать её поверх современной версии                                                           |
| Универсальные контракт, компилятор, генератор, runner и verifier уже существуют                         | `packages/core`, `compiler`, `generator`, `runner`, `verifier`, `environment`                                           | Не переписывать ядро и не строить новый «универсальный AI firewall»                                                                    |
| Есть MCP/OpenAPI/browser подключения и HTTP-agent boundary                                              | `packages/connector`, `packages/daemon`; browser требует отдельного чтения состояния для доказательного вердикта        | Собственный агент подключается, но совместимость и наблюдаемость конкретной системы нужно проверять                                    |
| Есть пять синтетических workflows: refund, invoice, lead, access, fulfillment                           | `packages/environments/src/registry.ts`; UI вызывает `useDemo()` без ключа                                              | Показать широту на существующих примерах, не выдавая их за реальные клиентские интеграции                                              |
| CLI generate подтверждает inferred-правила автоматически; UI тоже подразумевает yes                     | `packages/cli/src/commands.ts:350`; `apps/app/src/demo/useDemo.ts:192`; `apps/app/src/product/stages.tsx:1346` в master | Исправить согласие, прежде чем обещать проверки правил пользователя                                                                    |
| Compile/review не сбрасывают весь downstream; run может завершиться по старой suite                     | `packages/daemon/src/service.ts:590,616,1084,1155`                                                                      | Привязать suite/assessment к источнику, отказывать при устаревании                                                                     |
| Project gate не требует пригодной suite assessment                                                      | `packages/cli/src/project.ts:148`; `service.ts:949`                                                                     | Непроверенная generated suite не должна давать release PASS                                                                            |
| Booking careful и reference control проходят только 2/5                                                 | Свежий диагностический прогон; relevant fixtures/compiler/generator/quality без diff с master                           | Это не доказательство, что «все правильные агенты плохие»; generic generation пока нельзя универсально рекламировать как надёжный gate |
| Invoice: 13 cases, reference/harmless-control failures 0; access: 13 cases, failures 0                  | Свежая in-memory диагностика общих с master модулей                                                                     | Подходят для иллюстрации широты; invoice пропускает часть mutants, access имеет dead rule — это не квалификация                        |
| Helpdesk имеет scoped/service-token демонстрацию, внешнего HTTP-кандидата и состояние/access log/outbox | `packages/env-helpdesk/test/cli.test.ts`, `src/demo/agents.ts`                                                          | Главный неплатёжный сквозной сценарий MVP                                                                                              |
| Stripe имеет строгий black-box project-gate E2E с exits 0/1                                             | `packages/cli/test/stripe.e2e.test.ts`                                                                                  | Сохранить как второй регрессионный контроль общего механизма                                                                           |

Фактически выполнено на **старой рабочей копии**: 10 файлов / 223 targeted tests PASS; `pnpm lint`, `pnpm typecheck`, `pnpm domain` PASS. Это не проверка master v0.6.0. Современный end-to-end нужно выполнить в новом worktree.

## 3. Пользователь и продаваемая проблема

Первый ICP: CTO, founding engineer или AI/platform lead B2B SaaS, у которого агент уже вызывает инструменты и работает с клиентскими данными либо изменяет записи.

Триггер: команда меняет модель, prompt, tool integration или credentials и не знает, не появился ли cross-tenant доступ, лишняя запись, неверная сумма/получатель, пропущенное согласование или утечка.

Покупатель платит сначала за подключение и надёжную проверку **его** workflow: бизнес-правила, тестовые данные, независимые readbacks, найденные регрессии и CI-процесс. OSS runner остаётся бесплатным. Облачная командная подписка — следующий продукт, не функция этого спринта. Платёжеспособность и цена пока гипотезы, не подтверждённый спрос.

## 4. Результат трёх часов

### Обязательный P0

1. Изолированная MVP-ветка от указанного master; текущие пользовательские и маркетинговые изменения сохранены.
2. Явное подтверждение/rejection inferred-правил. Неотвеченное правило остаётся inferred. Кнопка массового подтверждения — отдельное намеренное действие.
3. Отказ от release PASS по отсутствующим, устаревшим или недостаточно проверенным generated suites. Не запускать кандидатного агента до такого отказа.
4. Snapshot provenance для project suites и assessments; checkpoints ловят изменения правил, suite и relevant environment configuration во время долгих операций. Исторический run не удаляется и не становится актуальным baseline при устаревании.
5. Helpdesk: init → внешний HTTP-agent → default project gate → HTML evidence. Исправный scripted qualification control даёт 0, дефектный — 1. Не использовать answer-aware reference как оценку пользовательского агента.
6. Существующий Stripe black-box gate по-прежнему даёт 0/1. Не снижать thresholds ради зелёного демо.
7. Английский оффер объясняет общий продукт, доступные сейчас пакеты, ограничение проверяемости и отсутствие runtime interception. Контакт в согласованных местах: `erbol@rigorrun.xyz`.
8. Runbook: установка/запуск, один воспроизводимый demo, команды проверки и список ограничений именно этой сборки.

### Полезный P1: снимается первым, если не помещается

Selector для invoice и access рядом с существующим refund; сохранение workflow в URL; корректная ссылка на synthetic demo-ops. Реальные browser executions, но не release qualification и не полноценная запись действий пользователя из отдельного demo-ops приложения.

### Не входит

Production runtime blocking, произвольные MCP permission matrices, универсальный policy language/editor, исправление всех generic generator edge cases, hosted database/auth/RBAC, shared team workspace, checkout/subscription billing, enterprise/SOC2 обещания, public npm release, автоматический production deployment, полная квалификация изменённого engine tree.

## 5. Архитектура и границы доверия

Путь пользователя:

```text
Safe environment + explicit rules / bundled pack
  → reviewed contract
  → versioned suite
  → quality preflight (generated suites) / tested bundled pack
  → candidate executes through its own integration
  → system readback / available audit log / outbox
  → scoped verdict + limits + evidence + HTML + CI exit
```

Общая модель остаётся domain-agnostic. Интеграционно-специфичные schema, материализация тестовых записей и readbacks остаются в adapters/packs. Agent report — отдельное утверждение, не доказательство успешного изменения системы. Observational/PARTIAL ограничения не исчезают из-за новой формулировки на лендинге.

Generated-suite quality preflight не исправляет генератор. Он не позволяет недостаточным тестам стать уверенным release verdict. Assessment требует отдельного согласия: многократно выполняет writes в test/staging; никогда не запускать его автоматически из gate.

Для MVP generated release gate требует: свежий полный assessment, false-positive rate = 0, harmless-control failures = 0, stable replay, hidden-answer isolation, dead rules = 0, mutant kill rate = 1 и independent kill rate = 1. Missing/NaN metrics, empty cases/defect controls и warnings означают отказ. Это консервативное правило текущего MVP, не доказательство абсолютной безопасности и не будущий универсальный стандарт качества.

Bundled `helpdesk` / `stripe` suites проходят отдельный путь: assessment synthetic-reference к их materialization неприменим. Принимать только suite, установленную текущим pack-путём и связанную с текущими source hashes; существование pack name само по себе не квалифицирует произвольную suite. Их default good/bad gate проверяется в этой сборке.

Legacy/raw benchmark-file gate остаётся диагностическим и не предлагается как универсальная CI release-проверка этого MVP; его эквивалентная quality policy — следующий этап. Не ограничиваться отказом в project gate, а продолжать рекламировать обход через raw-file gate как безопасный release verdict.

## 6. Global constraints

- Baseline: `3e2d4e3db3d15b2301599251ad11a4b1b5127781` (`origin/master`, CLI v0.6.0).
- Runtime: Node 22.22.2 and pnpm 11.7.0; Python 3.14.7 available for existing Stripe E2E.
- No new runtime dependencies, no new LLM dependency, no hosted backend in this sprint.
- Product UI/copy: English. Planning and founder handoff: Russian.
- Preserve current dirty worktree; no reset, checkout-overwrite, bulk old-branch transplant or deployment from it.
- Read modern `AGENTS.md`, positioning/claims/progress and task brief before implementation. Do not edit protected claim/positioning/progress ledgers or `reports/**`.
- Changes under `packages/` invalidate applicability of previous qualified-tree evidence to this new build; disclose this, do not promote historic qualification to a fresh release claim.
- No secret printing, no production test writes, no automatic assessment, no automatic deployment/tag/npm publish.
- Review decisions are explicit; missing decisions never mean yes.
- Project gate: 0 = candidate passes scoped usable suite; 1 = candidate fails that suite; 2 = invalid setup/input; 3 = suite/evidence inadequate or stale. Quality preflight refusal happens before candidate contact.
- Snapshot checks are not transactions. MVP supports one writer/operator per project; simultaneous writes and full atomic consistency are unsupported.
- All public contacts covered by the scoped transplant use `erbol@rigorrun.xyz`; DNS/MX is not proof of inbox delivery.

## 7. Review focus: five likely failures

1. An unanswered, unknown or conflicting decision must not silently confirm a rule.
2. Recompile/review/configuration change/regeneration during a run must not promote an obsolete PASS or overwrite current project metadata.
3. Missing/stale/NaN quality or a failed harmless control must refuse release gating before contacting the candidate.
4. Workflow switching/reload/deep links must not reuse another domain's artefacts or imply approval not given by the user.
5. A credential-scope defect must be caught through the actual HTTP/MCP/system boundary; reference or pair-demo exit 0 must not substitute for candidate gate 0.

## 8. Timebox and fallback

0–15 minutes: safe baseline and initial acceptance checks. 15–120: parallel Core, UI and QA work; coordinator handles scoped copy and reviews. 120–150: integration and independent review. 150–175: acceptance and repeatable demo. 175–180: evidence-backed handoff.

At minute 90: no additional features. At minute 120: remove P1 selector if it threatens P0. If full generated-suite quality/freshness support cannot pass tests, use an explicitly tested temporary refusal of **all generated project release gates** (exit 3); retain diagnostic runs and the tested bundled-pack path. Do not waive safety tests, silently relax thresholds or claim generic release readiness.

If even the bundled default 0/1 gate cannot be verified, deliver a local technical preview plus the blocker, not a finished MVP claim. Three hours are a constrained attempt with checkpoints, not a guarantee of production readiness.

## 9. Pitch and next validation

Three-minute demo: scoped Helpdesk agent performs its permitted job; same scripted logic with overbroad credentials crosses a tenant boundary; RigorRun reads the system's evidence and rejects the release. Show invoice/access only as broader architectural examples, not qualified customer integrations. Label controls and synthetic data honestly. A model-driven run is optional after deterministic acceptance, uses user's configured provider, and its outcome is not pre-promised.

Then ask a prospect for one real workflow and one recent agent failure. Pilot acceptance must specify adapters, readable state, supported actions, sandbox/reset, agreed rules and defects the suite must distinguish. Validate repeated use and willingness to pay before building subscription infrastructure.
