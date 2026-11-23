# MessagingMatrix v6 — active roadmap + checkpoint

**Ez a lean, aktív fájl.** A teljes történelem (Phase 0–10 logok, összes deploy- és session-checkpoint 2026-04 → 2026-11-11, minden lezárt epic-log) szó szerint megvan itt: **`tasks/todo-archive.md`** (~9100 sor). Ott semmit nem törlünk — ez a hosszútávú emlékezet.

**Munkamenet:**
- Új session-checkpoint ennek a fájlnak az **aljára** kerül (append), nem az archívba.
- Ha az aktív rész kezd hízni a lezárt checkpointoktól, a régieket **átgörgetjük az archívba** (append oda), és itt hagyunk egy egysoros mutatót.
- Részletekért (file:line horgonyok, eredeti tervek, review-k) → `todo-archive.md`, szekció-cím vagy hozzávetőleges sor szerint hivatkozva.

**Kapcsolódó dokumentumok:**
- `REBUILD_SPEC.md` (Drive: `MessagingMatrix/mm6-docs/`, 2026-11-22 óta nincs a `docs/`-ban) — v6 design spec + multi-tenancy delta D1–D11.
- `tasks/component-inventory.md` — használatban lévő szemantikus class-nevek (új blokk-név előtt nézd meg).
- Master plan: `~/.claude/plans/you-ll-see-docs-and-snappy-charm.md`.

---

## Jelen állapot (2026-11-22)

- **Verzió: `6.132.0`**, él mindkét tenanton a Hetzner boxon: `erste.messagingmatrix.ai` (pm2 `mm6-erste`) és `telekom.messagingmatrix.ai` (pm2 `mm6-telekom`). Deploy: `AGENTS.md` → Deploy.
- Phase 0–10 + a 2026-08/09-es epicek mind leszállítva: DCO/Agentic mátrix, Creative Library rebuild, DRAFT-modell (draft = `messages` sor `audience IS NULL`), draft-variánsok, státusz-takarítás (6 státusz), monitoring periódus-tartomány + nap-grain, Drive-linkek, feed diff-alap + „semmi nem tűnik el", dashboard napi áttekintő, Channels-entitás, MCP per-user tokenek.
- **Átrendezés 2026-09-10:** minden lezárt epic-log és a 2026-09-10 előtti checkpointok szó szerint átkerültek a `todo-archive.md`-be („Archivált 2026-09-10 — todo.md átrendezés" szekció). Itt csak a nyitott munka maradt.
- **Átrendezés 2026-11-22:** a 2026-09-10 → 2026-11-11 checkpointok és a lezárt roadmap-tételek törzse szintén szó szerint az archívban („Archivált 2026-11-22 — todo.md frissítés”); a nyitott tételeik mutatója a „Session checkpointok” alatt.

**Prioritás-tierek lentebb:** 🟢 NOW = indulásra kész · 🟡 NEXT = green-light után · 🧹 TECH-ADÓSSÁG = adathigiénia és maradványok · 🔵 LATER = push-back-first / blokkolt. Minden item commit-méretű.

---

## 🟢 NOW — indulásra kész (nincs blokkoló külső input)

### ~~Telekom mm6 instance a boxra — `telekom.messagingmatrix.ai`~~ — **✅ ÉL (2026-09-12)**
Tanulmány: `docs/TELEKOM_DEMO_STUDY.md`. A tanulmány A-csomagja (infra) **leszállítva ~1,5 óra alatt**.
- [x] **T1** Backup: `/var/www/messagingmatrix-telekom` → `/var/backups/mm5-legacy/messagingmatrix-telekom-20260912` (a **v5 SQLite adat megvan**: `messaging-matrix.db` 1.1M + 4.5M WAL + a `.before-v5.1.0` backup). Mentve a régi nginx vhost és a v5 ecosystem is ugyanide.
- [x] **T2** `pm2 delete mm-server-telekom` + `pm2 save`. **A v5 `mm-server-erste` (3003) és `mm-server-proficio` (3005) FUT TOVÁBB** — külön döntés kell rájuk (lásd Nyitott döntések).
- [x] **T3** `/var/www/mm6-telekom` — lokális klón az `mm6-erste`-ből, majd `git remote` → GitHub és ff az `origin/main` tipjére: **`a12e47c` (6.90.0)**.
- [x] **T4** `.env`: `ACTIVE_CLIENT_KEY=telekom`, `PORT=6002`, **saját** `JWT_SECRET` + `MCP_BEARER_TOKEN` (nem az Erste-é), **közös** `DATABASE_URL` és MinIO bucket (a scope `client_id`-n / `telekom/...` prefixen van). `TEMPLATES_ROOT=/var/www/mm6-telekom-templates` — **a checkouton kívül**, a tanulmány R2 kockázata miatt; a repo sablonjaival feltöltve.
- [x] **T5** `npm ci` (702 csomag, 30s) + `npm run build` — hiba nélkül.
- [x] **T6** Kliens **id=9 `telekom`** + admin user (`beliczki.robert@gmail.com`) létrehozva. ⚠️ A `scripts/seed-multi.ts` **nem használható**: benne az ismert unawaited `getActiveClient()` hiba (tech-adósság szekció) — egyszeri saját scripttel ment, ami utána törölve lett.
- [x] **T7** `ecosystem.config.cjs` (`mm6-telekom`, 6002, `max_memory_restart: 700M`) + `pm2 start` + `pm2 save`.
- [x] **T8** nginx vhost átírva az Erste mintájára (`/mcp` no-buffering blokk + `client_max_body_size 200M`, proxy→6002; a v5 `/assets` alias kivezetve). Certbot cert **változatlan**, 2026-11-30-ig érvényes. `nginx -t` OK → reload.
- [x] **T9** Health publikusan: `/`→307 · `/login`→200 · `/matrix|/drafts|/creative-library|/shares|/feeds|/monitoring`→307 · `/mcp`→401 · `/api/templates`→401 · http→https 301. **Valódi login 200** (token `cid:9`, role admin), rossz jelszó 401. **Erste-regresszió: nincs** (`/` 307, `/login` 200, `/matrix` 307, `/mcp` 401).

**Megfigyelés (nem hiba, de figyelni kell):** az `mm6-erste` egyszer újraindult a build ablakában (18:57, restart 145→146) — `unstable restarts 0`, 1252ms alatt felállt, a logban csak a régi AWS-SDK node>=22 figyelmeztetés, OOM-kill nincs. Ma amúgy is 4× indult újra (14:19, 14:29, 17:16 = a 6.90.0 deploy, 18:57). **Viszont a box most két Next appot futtat 3,7G RAM-on** (erste 287M + telekom 273M), és az Erste `max_memory_restart`-ja 900M — a következő nagy buildnél érdemes a telekomot `pm2 stop`-olni.

**Worktree (2026-09-12, `TENANT_FORK_STRATEGY.md` §6):** `../mm6-telekom` = `feat/telekom-demo` ág,
közös `.git`, külön `node_modules`, saját `.env.local`-ban **beleírt** `ACTIVE_CLIENT_KEY=telekom`
(így egy `npx tsx` sem futhat véletlenül Erste-scope-ban). Indítás: `npm run dev:telekom` (6002).
Ellenőrizve: a worktree a `telekom` klienst látja (id=9, 0 audience / 0 topic / 0 MC).
**Routing szabály — a merge ezen múlik, nem a worktreen** (részletek: `docs/TELEKOM_DEMO_STUDY.md` §11):
megosztott kódban talált hiba → **egyenesen `main`** (mint a `c8432cb` empty-state fix);
Telekom-specifikus feature → `feat/telekom-*` ág, napokban él; adat és config → **sehova**, az a DB-ben él.
Migrációt **mindig `main`-ről** generálni (G2), `if (client.key === "telekom")` **tilos** (G3).

**Állapot:** a site **üres, de működik** — nincs benne audience/topic/MC, a branding default (szürke), a sablonok az Erste-ék. A tanulmány B–E csomagja (arculat, sablonok, adat, dramaturgia) jön.

### ~~Box deploy — 6.83.0~~ — **✅ DEPLOYOLVA (2026-09-11)** — törzs: `todo-archive.md` „Archivált 2026-11-22” A)

### Apróság-kör (user, 2026-09-10) — M12 + M9.1 + M4.2
Tételenként külön commit, `tsc` + vitest mindegyik után. A `MultiPill`-hez csak az M12.1 nyúl. Végén egy minor bump + CHANGELOG.

### M12 — Mátrix szűrő-pillek: kijelölt érték a pillben + product tag a sor/oszlop-fejléceken (user, 2026-09-10)
Apróságok, screenshotból (`/matrix`, Product + Status `multi-pill`):
- [x] **M12.1 (✅ KÉSZ, 6.83.0, 2026-09-10)** 1–2 kijelölésnél a `multi-pill__badge` a **kijelölt értékeket** írja ki (`HK, SZK`), 3+-nál marad a szám (tooltipben az értékek). Nem prop, hanem **alapviselkedés** minden `MultiPill`-en (Product, Status, Size, Platform, Type, DimensionGrid) — egy `describeSelection()` dönt, nincs call-site logika. Sorrend az **opció-lista** szerint, nem a Set (=klikk-)sorrend szerint; az opciók közül eltűnt, de kijelölt érték a végére kerül és **számít** (perzisztált szűrő, ami tényleg rejt sorokat). 6 unit teszt.
- [x] **M12.2 (✅ KÉSZ, 6.88.0, 2026-09-12 — a D6-ban)** Ha **több product** van kijelölve, az **audience oszlop-fejléc** és a **topic sor-fejléc** elejére (a név elé) **product tag** kerül, hogy látsszon melyik termékhez tartozik. Vizuál = a draft-kártya `tag-chip drafts-tile__product` pillje (sötét `bg-slate-800 text-white`, `text-[10px]`) — reuse, ne új család. **Minden density-ben ott legyen, a dense-ben is.** Egy product kijelölésnél (vagy szűrő nélkül, ha egy termék látszik) nem kell.

### M9 — MC archive/delete edit módban: már megoldott, csak a súgószöveg hiányos (user-döntés, 2026-09-10)
Az edit-mode panel Delete gombja archivál vagy töröl (M10 dialog), tehát az MC archiválás use-case-e **megvan** — az egykori M9.1 (külön Archive gomb a `MessageEditor` headerben) **kikerül**, nem építjük.
- [ ] **M9.1** `EditModePanel.tsx:40` súgószöveg bővítése: „Add / duplicate topics and audiences; add, copy and move Messaging Cards." → vegye fel, hogy **MC delete és archive** is edit módban érhető el (a Delete gomb dialogja dönt). Copy-only, semmi logika.
- [ ] **M9.3** (szomszédos, külön commit) audience/topic Archive-akció a `DimensionEditPanel`-be — a restore route-ok + editor-szintű showArchived már élnek, csak a panel kínál ma kizárólag hard-delete-et.

### M4 — Crosshair highlight (sor+oszlop) hover + click-pin
- [x] **M4.1 (✅ KÉSZ, 6.24.0, 2026-08-25)** Él-rail crosshair, NEM state-alapú. Imperatív (`GridView.paintCrosshair` + delegált `onMouseOver`/`onMouseLeave` a `<table>`-ön, ref) → hoverkor nincs grid-újrarajzolás. `data-col-key`/`data-row-key` a 2 header-`<th>`-re + mindkét cella-`<td>`-re; a `c`+`c-1` oszlop `border-right`-ja és a `r`+`r-1` sor `border-bottom`-ja kap `--mx-cross` színt (`matrix-grid__x--edge-r`/`--edge-b`, unlayered CSS). Csak meglévő border SZÍNE vált → **0 layout-shift**, `transition: border-color 140ms` → nem villódzik. Edit módban is megy (border-color ≠ ring box-shadow). Header-hover = csak az az oszlop/sor. Korlát: legszélső bal oszlop / legfelső sor külső élét a sticky header adja (nincs `c-1`/`r-1`).
- [ ] **M4.2** Click-to-pin: kattintásra pinnel escape/újraklikkig; a chip-open klikket nem nyeli el. ⚠️ OPEN Q: pin+hover mindkettő.

### ~~D — Design tab kör: capsule · fontok · ikonkészlet · cobrand · navigáció~~ — **✅ LESZÁLLÍTVA (6.88.0, 2026-09-12)** — törzs: `todo-archive.md` „Archivált 2026-11-22” A)



### ~~D6–D8 — a második kör (user, 2026-09-12): fejléc-product-tag · navigáció + brand-hely · mátrix Type-szűrő~~ — **✅ D6 + D7 KÉSZ, D8 ELVETVE** — törzs: `todo-archive.md` „Archivált 2026-11-22” A)


### ~~D8 — Mátrix „Type" szűrő a Creative Library mintájára~~ — **ELVETVE (user, 2026-09-12: „Q3-at dobjuk el")** — törzs: `todo-archive.md` „Archivált 2026-11-22” A)



---

## 🟡 NEXT — green-light után, alacsony blokk

### EPIC CA — Kreatív-attribúció: saját adatgyűjtés (AdForm API + Meta API) + Performance/Attribution nézet a Monitoringon (TERV, 2026-10-27 — jóváhagyásra vár)

**User-döntések (2026-10-27):** a projekt része; az ügynökségtől **semmit nem kérünk** — minden adatot mi húzunk
API-ból (AdForm, Meta). A régi R1–R6 (2026-09-16 felmérés) ezzel **felülírva**: R1 kiesik, R2–R5 beolvad ide.
Kísérleti design, amire a matek épül:
- **AdForm:** audience-en belül az aktív kreatívok **random rotálnak** → audience-en belül a kreatív-különbség
  **causalis** (post-view konverzióra is: az abszolút szám nem inkrementális, de a *relatív* különbség igen).
- **Meta:** ad seten belül a győztes kreatív kap mindent → ad seten belüli ad-összehasonlítás **torzított, nem
  használjuk**. Kampányon belül azonos budgetű ad setek rotálnak → az **ad set a kísérleti egység**, metrika
  per költés (konv / 1000 HUF), csak azonos targetingű ad setek között.

**A matek (v1, TS-ben, nincs Python sidecar):**
- **SRM-őr:** audience-en belül a kreatívok impresszió-aránya tényleg egyenletes-e (χ²). Ha nem, a réteg
  „nem randomizált" jelzést kap és kimarad a causalis számításból — ez véd a csendben bekapcsolt optimalizálás ellen.
- **Empirical Bayes beta-binomiális** CTR/CVR kreatívonként, rétegen (audience × hónap) belül → hihetőségi
  intervallum + P(legjobb). Minimum-minta küszöb alatt „kevés adat", nem rangsor.
- **Dimenzió-hatás:** rétegzett (Mantel–Haenszel-típusú) összevont lift a mátrix-dimenziókra (topic, variáns,
  méret, üzenetelem) — a randomizáció miatt elég, GLMM nem kell v1-hez.

**Lépések (mindegyik külön szelet, `tsc` + vitest után):**
- [ ] **CA0 (0 kód) Minta-riport.** ⚠️ **2026-10-27 módosítás (user): AdForm API most NINCS** — a user maga
      rakja össze és tölti le az AdForm-riportot, abból dolgozunk. Kell egy minta-xlsx ezekkel: nap, kampány,
      **line item** (a kísérleti réteg), Banner/Adgroups (pmmid + méret), impressions, clicks, és a konverziók
      **tracking pointonként (e2e, vhk) × post-click / post-view** bontásban. Helye: `~/GoogleDrive/Data/ERSTE HU/_riports/`.
      A régi spike-szöveg (API) alább, későbbre:
- [ ] ~~CA0-API~~ **(később) Hozzáférés + spike.** AdForm API kliens-hitelesítő (client id/secret, scope) + Meta system-user
      token (`ads_read`) + ad account id. Spike: egy valós lekérdezés mindkettőből → **lockolni**, milyen dimenziók
      jönnek (AdForm: nap × line item × banner × tracking point × post-click/post-view; Meta: ad × nap × `actions`
      attribution-ablakonként). Az AdForm-mezőneveket a spike dönti el, nem feltételezzük. Env-nevek: a
      `.env.example:42-48` már foglalja az `ADFORM_CLIENT_ID/SECRET/TOKEN_URL/API_BASE/SCOPE`-ot (kód még nem olvassa),
      ezeket használjuk; Meta-hoz új: `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`. Kimenet: valós minta-JSON a
      tesztekhez. Hitelesítő **csak env-ben a boxon**, soha nem fájlban/URL-ben.
- [ ] **CA1 (minor, migráció) Séma.** A mostani `monitoring` sor egyetlen `conversions` int-et tárol és nincs benne a
      kísérleti egység — ez a T2-gond mechanizmusa. Javaslat: (a) `monitoring` kap `source` (`xlsx|api`),
      `campaign_id`, `unit_id` (AdForm line item / Meta ad set), `unit_name` oszlopot, a unique kulcsba a `unit_id`;
      (b) **új `monitoring_conversions` tábla** hosszú formában: `monitoring_id`, `event` (tracking point / Meta
      action_type), `attribution` (`pc|pv|1d_click|7d_click|1d_view`…), `count`, `value`. Így új esemény/ablak nem
      igényel új oszlopot. Integrációs teszt a migrációra.
- [ ] **CA2 (minor) AdForm ingest — most az xlsx-importer bővítése** (`parseAdformReport`, `adform-report.ts:307`)
      az új riport-formára (line item + tracking point × pc/pv → `monitoring_conversions`); a régi „Creative rep"
      forma továbbra is olvasható. Az API-változat (alább) későbbre.
      ~~AdForm API ingest.~~ `src/lib/adform-api.ts` (OAuth client-credentials + stats lekérdezés) →
      ugyanaz a `parsePmmid` / `buildMessageResolver` / `resolveProduct` út, mint az xlsx-é. Upsert **nap-ablakra**
      (az ablak napjai cserélődnek, nem a teljes periódus) → ez megoldja a W3.j-6 újraimportot is. Az xlsx-feltöltő
      marad fallbacknek. Unbounded olvasás → lapozott helper.
- [ ] **CA3 (minor) Meta API ingest.** `src/lib/meta-api.ts`: Insights `level=ad`, napi bontás, `spend/impressions/
      clicks/actions` attribution-ablakonként + ad set/kampány id és budget. Kulcs: hirdetésnév-szám+variáns, üres
      `-a_` nem eldobás (volt R2), `platform=meta`. A 2026-09-16-i B-kategória (név ≠ pmmid `m_`) és a régi
      számozású ütközések (312/111/41c/129) → Ad ID-re kulcsolt override (a W3.h szabály-mintával, túléli az újrahúzást).
- [ ] **CA4 (minor) Sync-indítás — csak a Meta-hoz kell** (AdForm = meglévő feltöltő). „Sync now" a Monitoring
      jobb toolbarján (dátum-ablakkal). Cron nem (user-döntés).
- [ ] **CA4b (minor) MCP: attribúció lekérdezhető** (user, 2026-10-27). Új read-scope tool (pl. `attribution_query`:
      kliens-szűrők platform/audience/hónap/esemény → kreatív-becslések intervallummal, dimenzió-hatás, SRM/kevés-adat
      jelzés) — ugyanazt a CA5 stats libet hívja, mint a UI, nincs külön számítás. MCP settings oldal prózája
      (`McpTab.tsx`) kézzel frissítendő.
- [ ] **CA5 (minor) Stats lib.** `src/lib/attribution/` tiszta függvények: SRM, EB beta-binomiális, rétegzett lift,
      P(legjobb), Meta ad set-összehasonlítás per költés. Vitest **szimulációval ismert igazságra** (beültetett
      lift visszajön-e, SRM jelez-e torzított rotációnál, kis mintán nem rangsorol-e).
- [ ] **CA6 (minor, UI) Monitoring: Performance | Attribution nézet.** Tab-bar a Monitoring tetején (meglévő
      tab-bar minta). **Performance** = a mostani tábla + CTR/CVR/CPA + `event`/`attribution` szűrő. **Attribution** =
      kreatív forest plot intervallummal rétegenként, dimenzió-hatás panel, SRM / kevés-adat jelzések, Meta ad set
      nézet külön. Grafikonok előtt `dataviz` skill; component-inventory frissítés.
- [ ] **CA7 (patch) Takarítás.** A legacy R1–R6 jelölése lezártnak; `MessageMetricRow` kap `clicks`-et, ha a
      dashboard is CTR-t mutatna (csak ha kéri).

**Döntések (user, 2026-10-27):** (1) KPI-események az AdForm tracking pointjaiból: **e2e** = end-to-end online
igénylés, **vhk** = visszahívást kérek — külön eseményként tároljuk, a nézetben választható. (2) **DV360 bent van**:
azt is az AdForm adserver szolgálja ki, tehát az AdForm API-ból jön, egy helyen. ⚠️ A DV360-sorokon az AdForm
cost ~0 (a vásárlás a DV360-ban van) → **DV360 csak adserver-adatból** (CTR/CVR), költés-arányosítás nincs, és
nem is lesz (user megerősítette).
(3) **Kézi sync** v1-hez; cron nem.

### ~~P — Preview-generálás a Creative Library jobb toolbarjából~~ — **✅ KÉSZ (6.87.0, 2026-09-12)** — törzs: `todo-archive.md` „Archivált 2026-11-22” A)




### UI-apróságok (mátrix + editor + library)

### ~~M1 — Matrix „Color by"~~ — **KIVEZETVE (user, 2026-09-10)** — törzs: `todo-archive.md` „Archivált 2026-11-22” A)

### M7 — Custom-CSS beszúró chipek az MC-editorban — **✅ KÉSZ (6.83.0, 2026-09-10)** — törzs: `todo-archive.md` „Archivált 2026-11-22” A) (a Classes-sor összecsukásának kis ötlete is ott)

### ~~M8 — Creative Library size filter csoportosított dropdown~~ — **KIVEZETVE (user, 2026-09-10)** — törzs: `todo-archive.md` „Archivált 2026-11-22” A)

### Monitoring maradék (Wave 3)
- ~~**W3.g** Matrix cella stat-badge~~ — **KIVEZETVE (user, 2026-09-10).** Nem kell. (Tény a jövőnek: az adat-út kész lenne — `useMessageMetrics` + `/api/monitoring/message-metrics` per-`messageId` impr/cost/conv-ot ad; csak `clicks` hiányzik a `MessageMetricRow`-ból a CTR-hez.)
- [ ] **W3.h → átkeretezve, saját szelet, NEM UI-apróság (user: „most túl nagy", 2026-09-10).** Unmatched sor → message kézi link. **A naiv megoldás némán elveszik:** a monitoring import **periódusonként töröl + újratölt** minden sort (`import/route.ts:121-135`), tehát egy kézzel beírt `monitoring.messageId` **eltűnik a következő feltöltéskor** — és a W3.j-6 (mind a 4-5 riportfájl újraimportja) nyitva áll, szóval ez biztosan bekövetkezik. Túléléshez: override-tábla a **message-kulcsra** (`mcNumber+variant+audienceKey+topicKey` vagy pmmid) + **4. resolver-szint** a `buildMessageResolver`-ben + reapply-pass. Kész minta: `resolveProduct` keyword→product szabályok + `/api/monitoring/reapply-products` — **szabály, nem soronkénti kézimunka**, és épp ezért éli túl az újraimportot. **Első lépés felméréssel:** hány unmatched sor van, ebből mennyi `family_known` vs teljes no-match, és mennyi impressziót visznek — a szám dönti el, megéri-e bármit építeni.
- Deferred: **Meta parser/resolver** — blokkolva valós Meta export sample-ig.

### Agent-oldal (MCP + provenance)

### ~~MCP token-scope #3: `draft`~~ — **✅ KÉSZ (6.84.0, 2026-09-12)** — törzs: `todo-archive.md` „Archivált 2026-11-22” A) (a nyitott `scope`-döntés: TECH-ADÓSSÁG)

### I2 — Komment-thread mint **entitás-provenance** (DÖNTÉS LEZÁRVA)
**User-döntés:** „thread lenne a legjobb, fáj hogy nem látszik ki mikor mit" + **a cél explicit: az agenteknek kontextust adni** arról, hogy mi változott, milyen kérésre, miért, és **egyáltalán miért hívnak úgy egy topicot / audience-t / MC-t, mi van rajtuk, miért jöttek létre.**
⇒ **Ez átkeretezi a feladatot:** nem „chat-buborék UI" a fő termék, hanem **entitásonkénti provenance-napló, aminek az agent az elsődleges olvasója és társ-írója**. Az MCP olvasó/író oldal tehát nem opcionális ráadás, hanem a lényeg.
**Felmért tények:**
- Ma **egyetlen `comment` text oszlop** van (nincs szerző, idő, thread): `audiences:175`, `channels:248`, `topics:311`, `messages`, `assets:487`, `creatives:528` (`src/db/schema.ts`).
- **`share_comments` (`:704-726`) viszont már valódi thread-tároló:** `itemKey` diszkriminátor (`"matrix:{messageId}:{size}"` / `"creative:{id}"`), `authorName`, `body`, normalizált `annotation` (point/rect JSON), `createdAt`, `archivedAt`. Ma a publikus share-galériához kötve (`shareGalleryId` NOT NULL).
- **`share_comments`-ben mindössze 2 sor van** ⇒ az általánosításnak **nincs érdemi adat-migrációs kockázata**.
- Az „ember vagy agent" **ugyanaz az egy fogalom, mint az `FR-D D.1` `actor_kind`-ja** → **egyszer definiáljuk** (I1.6), és a komment ugyanazt használja.
- [ ] **I2.1 Séma:** `share_comments` általánosítása — `share_gallery_id` **nullable**, + `entity_type` / `entity_id`, + `author_kind` (`user|agent`), + `user_id` / `mcp_token_id`. A meglévő 2 sor `entity_type='share_item'`-mel back-fillelve. Migráció (`0008+`) **+ kód egy passzban** a boxon. A régi 6 `comment` oszlop **marad** (nem migrálunk adatot az első körben).
- [ ] **I2.2 Entity-réteg:** `entities/comments.ts` — `listComments(entityType, entityId)` / `addComment` / `archiveComment`. A `keywords`-minta (managed tábla ordering+archive-val) a precedens.
- [ ] **I2.3 MCP (a lényeg):** `list_comments` (read) + `comment_add` (write, `author_kind='agent'`, a hívó token azonosításával) — így az agent **olvassa a miértet és hozzá is ír**. McpTab „Comments" group + prose (a tool-lista auto-szinkron, a prózát kézzel kell).
- [ ] **I2.4 UI — EGY helyen debütál:** buborék-thread az **MC-editorban**; ember/agent avatar-jelöléssel, idővel, szerzővel. Csak ha bevált, terjed a topic/audience header-dialogra és az asset/creative detailre.
- [ ] **I2.5** Tesztek (entity + MCP + route) · component-inventory · CHANGELOG · bump.
- ✅ **LEZÁRVA (user, 2026-08-30):** a mai egy-mezős `comment` oszlopok **változatlanul maradnak** a thread mellett — az első kör semmit nem vesz el.

---

### I1.6 — `actor_kind` az audit_logon (az I1 dashboard egyetlen nyitott tétele; az I2-vel EGY migrációs passzban)
- [ ] **I1.6 (külön slice, migrációval) `actor_kind`:** `FR-D D.1` — `ui|mcp` oszlop az `audit_log`-ra + beállítás a két writer-site-on + ember/agent badge a digestben. **Migráció + kód egy passzban a boxon.** Ugyanez az oszlop-fogalom kell az I2-höz → **egyszer szülessen meg.**

---

## 🧹 TECH-ADÓSSÁG — adathigiénia és migrációs maradványok

### Scripts: unawaited `getActiveClient()` sweep (PG-cutover maradvány)
A `getActiveClient()` a SQLite→PG váltáskor lett async; a route-okat akkor javították, a `scripts/`-et nem (a tsconfig nem fedi, `tsc` nem fogja). A `seed-channel-audiences.ts` élesben elhasalt (`UNDEFINED_VALUE`, params:[undefined]) — 2026-08-13-án javítva. **9 további script ugyanígy törött:** scan-creatives, import-erste-sample, link-creative-files, reimport-media, import-erste, seed-multi, seed-perf, seed-keywords, seed-dev. Háromnál a befogadó `main()` nem is async → scriptenként kell (async-esítés + hívás). Előbb döntsd el, melyik retire-elhető (import-erste* / seed-dev SQLite-éra); a maradékra egyenkénti fix + kézi futtatás-teszt.
- [ ] Retire-vs-fix döntés scriptenként, aztán a maradék javítása egyesével.

### Legacy `reporting` tábla retire
- [ ] **Legacy `reporting` retire (LAST):** a 2 lingering olvasó (`mcp.ts:350` monitoring_status→adformStatus, `:977` matrix_status→syncedAt) átkötése `monitoring`-ra → tábla drop-migráció → import/export-xlsx + snapshot refek takarítása.

### Monitoring nap-grain — az újraimport a useré
- [ ] **W3.j-6** Újraimport a 4 (5) meglévő riportfájlból a Monitoring oldal feltöltőjén át — nem script. **Migráció + kód egy passzban a boxon** (`migrate` + `pm2 restart`), ahogy a `mcp_tokens` szeletnél is.

### DRAFT-modell utóélet (Slice 1–5 leszállítva 2026-09-04–06, log az archívban)
- [ ] **D1.4a** ⚠️ **Soft-link következmény (2026-09-04, a legacy-nyomozásból):** a `creatives`, `monitoring` és `prodlist_rows` táblák `(mc_number, mc_variant)` **soft linkkel** mutatnak az MC-re, nem FK-val. Amint a draft is `messages` sor **számmal és variánssal**, minden ilyen link **DRAFT sorra is illeszkedhet**. Konkrét eset már ma: a `MC78b`-hez tartozó 4 kreatív `(78,b)`-re illeszkedik, ami **két axison is létezik** — a DCO-sat most DRAFT-ba tesszük, a nonDCO-s marad. Döntendő: a creative↔cell match **lássa-e** a draftokat (mellette szól: így kap a draft kreatívot; ellene: a `family_known` több-találatos ág zajosabb lesz). A `monitoring` **soha** ne lásson draftot (nincs mérés draft előtt).
- [ ] **D7.2** **Invariáns-sértés a prodban:** a `321` a **nonDCO axison két topicot fog át** (`HITEL_TCU_2026Q2_fullColorSurface` + `SZK_HITEL_a_TCU_2026Q2_fullColorSurface`), miközben a szabály *„a number never spans topics WITHIN an axis"* (`messages.ts:283`). Valószínű ok: a 2026-08-17-i kézi SQL-átszámozás (`MC838a → MC321a`), ami megkerülte a `createMessage` ellenőrzéseit. Két közel-duplikált topic is keletkezett. Felmérés → egy topicra összevonás vagy külön szám; és **ez az érv a D6.1 (first-class renumber/move) mellett** — a kézi SQL épp az invariánsokat kerüli meg.

### nonDCO szám-egyediség — megfigyelés (Creative Library rebuild, 2026-08-17)
- **Nyitott / megfigyelés:** nonDCO-ban a fájlnév-szám termékenként ismétlődhet → egy nonDCO szám megjelenhet két product-topicban (külön cella/pmmid, nem ütközik; a user DCO-szabálya nem tiltja). Ha nonDCO-egyediség kell, a scriptbe within-nonDCO ütközés-feloldás kell. Video-only channel (YT) + PRG/GSN/GNW méret-map: később. Deferred: nonDCO auto-topicok üres sorként a DCO nézetben (Slice-4 topic-scoping).

### npm audit — zod és társai (vizsgálat 2026-11-04, archív „Archivált 2026-11-22” C))
- [ ] **Kis fix (patch):** `npm update zod body-parser qs fast-uri ip-address`, zod `^4.6.6`. 2026-11-22-én még a sérülékeny verziók futnak (zod 4.4.1); külön task-kártya javasolva („mm6: zod és társai biztonsági patch”).
- [ ] **Alapos fix (Robi dönt):** a JSON-végpontoknak nincs saját méretkorlátjuk (az nginx 200M-ja vonatkozik rájuk); alacsony nginx-limit a feltöltési útvonalak kivételével vagy közös, korlátos JSON-olvasó, plusz `.max()` a 18 tömbre. **Terv: a fájl alján, „2026-11-23 — Terv: kérés-törzs méretkorlát”.**

### MCP token `scope`: nincs check constraint (6.84.0 óta dokumentálva, archív A) MCP token-scope #3)
- [ ] Az ismeretlen `scope` érték `full`-ra szélesedik (`resolveBearerClient`); egy elgépelt kézi SQL teljes jogot ad. Szűkítés `read`-re + check constraint = egy migrációs szelet; a user dönt.

---

## 🔵 LATER — push-back-first / blokkolt

**Séma-migráció szabály (memory):** új oszlop/tábla `db:generate` → `0019_*.sql` (jelenleg legmagasabb `0018_jazzy_steel_serpent.sql`), és a **migráció + kód-deploy egy passzban** megy a boxon (migrate + `pm2 restart mm6-erste`), soha nem lokál `db:migrate` önmagában.

### Wave 4 — Platform expansion (Meta / DV360 / Direct Display)
**Push-back gate (W4.1):** a user Metát MM6-ból *hajt* (full audience+feed lifecycle) vagy csak *trackel* (a Wave 3 monitoring-ingesttel már megvan)? Tracking-only → az egész Wave egyetlen audience platform-tag-re esik össze.
Fő lépések (ha full-lifecycle):
- [ ] **W4.2** `audiences.platform` enum-by-convention (`adform|meta|dv360|direct_display`, default `adform`) — `schema.ts:157`; `db:generate`→`0004`; per-row backfill. `buyingPlatform` (`:170`) marad DSP/seat-label.
- [ ] **W4.3** Audiences UI: platform pill a `DimensionGrid`-be + `Platform: All|AdForm|Meta|DV360|Direct` filter.
- [ ] **W4.4** Per-platform feed-config: ma `feedStructure` egyetlen config-string + `patterns.feed` Record (`feed-export.ts`) → per-platform kulcsra; Settings → Patterns platform-tab.
- [ ] **W4.5** Feed-export route platform-aware: `platform` a `BuildOptions`-ba (`feed-export.ts:63`) + POST bodyba; `buildFeedRowSet` (`:276`) a `readFeedStructure/Patterns` hívásnál (`:287-289`) platform szerint választ. **BLOKKOLT** míg a Meta export-formát nem lockoljuk (Custom Audience CSV vs bulk Ads Manager XLSX).
- [ ] **W4.6** Feeds UI platform-diszkriminátor oszlop+filter (`FeedsView`).
- [ ] **W4.7** Direct Display: csak `platform='direct_display'` tag; vendor a `buyingPlatform`-ban (default: nincs új mező).

### Wave 5 — Share → Google Drive
**Push-back gate (W5.1):** a legolcsóbb 80% = share-view PDF-export + manuális Drive drop? Ha igen → **kill the build.** Csak konkrét kliens/agency-workflow igényre.
- [ ] **W5.1** Push-back döntés.
- [ ] **W5.2** Open Q-k lock (ha build): target folder · formátum (PDF/CSV-JSON/assets+manifest) · naming · auth (per-user Google vs MM service account) · snapshot-vs-sync · lifecycle.
- [ ] **W5.3** Destination toggle: Option 1 = mai MM (default), Option 2 = Drive (placeholder) → Option 2 narrowest-viable-first.

### FR-A/B/C/D — agent-facing tárházak
**Elv:** elsősorban az AGENTEKÉRT (vékony UI + MCP tool-felület). Mindegyik előtt 3-kérdéses push-back (tényleg MM6 vs brain/inbox? legolcsóbb 80%? build vs outcome?).
**Közös minta (grounded):** managed tábla ordering+archive-val → `keywords` pgTable (`schema.ts:725`) + `/api/keywords/*` + `KeywordsTab`. Új MCP tool → `registerTool(name,{description,inputSchema:zod-field-map},handler)`; write: `requireRate`→entity-helper→`writeAudit({userId:mcpUserId})`→`jsonResult`; batch = `db.transaction`+egy audit (`mcp.ts:1180/2122/228`). Új Settings tab → folder+komponens + `TabKey` + `TABS` + render-ág (`SettingsView.tsx:16,27-37,115-131`).
- [x] **FR-A Prodlist management** — agent-feldolgozott prodlist-sorok first-class rekordként; soronként MC vagy creative-hez köthető. Ref: `~/ERSTE Addressable AI Agent/outputs/prodlist_q3_2026`. Lépések: `prodlist_rows` tábla → `/api/prodlist/*` → MCP list/get/update/link/processed-mark → vékony lista-UI. ⚠️ OPEN Q lent.
- [x] **FR-B Documents** — Google Slides link-tárház; agent követi melyik MC-nek van tracking-slide-ja + állapota. Lépések: `documents` tábla nullable soft-link a messages-hez → `/api/documents/*` → MCP list/get/add/update/link + "mely MC-knek nincs slide" query → vékony lista-UI.
- [x] **FR-C Request-a-change** — ticket-inbox → auto-roadmap. **Default: legolcsóbb 80% = strukturált `todo.md` szekció** (ez a reorg adja az alapot), nem új tábla; `change_requests` tábla + státusz-pipeline csak valós multi-filer igényre.
- [x] **FR-D Dashboard** (meglévő oldal, legkönnyebb push-back): **D.1** `actor_kind` (`ui|mcp`, opc. `token_id`) oszlop az `audit_log`-ba (`schema.ts:113` ma csak `userId`; `0004+` migráció) + beállítás a két writer-site-on (UI entity-route + `mcp.ts` ~30 call-site) + widget-badge. **D.2** users-join a raw `row.userId` helyett (`page.tsx:123` → email/név). **D.3** utolsó-90-nap `count()` predikátum az `entityCounts()`-ba (`page.tsx:18`) tile-onként.

### MCP SDK v2 migráció (`2026-07-28` spec)
- [ ] **NEM most.** Várunk a v2 stable-re (~2026-07-28), aztán branch-en. Migrációs checklist: archív § "MCP `2026-07-28` spec compatibility" (~L1450). A `show_mc_previews` widget (OpenAI Apps SDK) a valódi app-szintű munka.

### Parallel polish — Dark-mode component sweep (WP.1–8)
- [ ] Piecemeal, **soha nem search-and-replace**; egy klaszter egyszerre, vizuális verifikáció. Sorrend: sidebar → modals → grids → matrix chrome → forms → status pills → iframe chrome → QA. Alap (shadcn-tokenek) 2026-05-07-én landolt. Archív: § "Parallel polish" (~L2593) + punch list §10 (~L1585).

---

### DRAFT-modell Slice 6 — roadmapre, most NEM építjük
- [ ] **D6.1** Mért MC mozgatása pmmid-folytonossággal: first-class művelet explicit megerősítéssel + a régi pmmid megőrzésével, hogy az ACTIVE-ból visszakattintás kerülőút (és a "feedből némán kiesik" kockázat) megszűnjön. *Megjegyzés: a normál előre-irány (PREVIEW → APPROVED → mozgatás → ACTIVE → feed-export) nem kockázatos — a feed-export ACTIVE-ra gate-el, tehát közben nem exportálódik semmi. Csak a MÁR ACTIVE sor visszakattintása az.*
- [ ] **D6.2** Share-oldali approve gomb → `status='APPROVED'` (ember vagy agent). A purpose-doksi 9.3-as hiánya; az `APPROVED` ezért marad a listában (0 sora **be nem kötöttséget** jelent, nem feleslegességet).

### I5 — Feed-részletek a 500-as limit miatt (IGÉNY RÖGZÍTVE, 2026-08-31 — user: „ezzel majd később")
**Modell-javítás (user):** a „productonként egy live feed" **hibás kérés volt** — egy termékhez több élő feed tartozhat. **Az SZK mai esete a PLATFORM szerinti kettősség**, amit a 6.34.0 már megold (`feed_exports.platform`, `findLiveExport(product, platform)`, platformonkénti verzió-vonal és Live sor). **Máskor viszont a `MAX_ROWS_PER_FEED = 500` is szétvághat egy terméket két részletre** — ez a rész elhalasztva.
- **User-döntés, ami már megvan:** a részletek **két önálló feed** (nem egy feed két fele) → külön verzió-vonal, külön élő sor, külön diff — pontosan az a forma, amit a platform-oszlop csinál. Egy jövőbeli limit-alapú vágásnak ugyanígy **saját megkülönböztetőt** kell kapnia, nem az uniót kell diffelnie.
- **Nyitva:** mi a megkülönböztető a limit-alapú vágásnál (a vágás helye önmagában nem jelent semmit), és ki dönti el a vágást (automatikus limit szerint vs kézi MC-besorolás, ami megmarad a következő exportra). A user mindkettőt későbbre tette.
- **Tény a döntéshez:** `MAX_ROWS_PER_FEED = 500` (`feed-export.ts:32`), és az SZK exportok korábban **443 / 644 / 681** sorosak voltak — tehát a limit valós kényszer, nem elméleti.

### M11 Fázis 2 — nonDCO szintetizált topic-sorok sorrendje (⚠️ ÚJ TÁROLÁSI RÉTEG — push-back-first)
A nonDCO topic-sorok a `message.topic` keywordből szintetizálódnak, nincs `orderIndex`-ük. Sorrend-mentéshez új overlay-tábla kellene (`matrix_row_order`). **3-kérdéses push-back MIELŐTT tábla születik** (tényleg kell perzisztens sorrend? legolcsóbb 80% = localStorage-order? build vs outcome?). Fázis 1 (valódi `orderIndex`) kész 6.23.0-ban — részletek az archívban.

### W3.k — nap-felbontású monitoring tartomány-lekérdezés (`?from=2026-06-15&to=2026-07-20`, „last 30 days")
Előfeltétel: W3.j-6 újraimport (fent). UI-t és dashboard-csempéket is érint, külön szelet.

---

## 📌 Deferred / pinned (nincs változás)
- Phase 11 file-ingest pipeline (Forklift/Drive → `_inbox/` + MCP error-triage toolok, post-launch).
- Sankey alt-graph a Tree view-hoz (valós igényre).
- HTML creative auto-preview image link (use-case-ek scope-olása előbb).

---

## Nyitott döntések — AJÁNLOTT DEFAULTOK (user bólint / felülír)

1. ~~**M1 `Both` vizuál**~~ — tárgytalan, az M1 kivezetve (2026-09-10).
2. **M4 pin + hover** → *default:* mindkettő — hover ideiglenes crosshair, kattintás pinnel escape/újraklikkig.
3. **W2.5 soft-link vs join-tábla** → *default:* marad a soft `(mcNumber, mcVariant)` link; join-tábla csak valós many-to-many workflow igényére.
4. **FR-A/B/C tábla vs view** → *default:* FR-C = strukturált `todo.md` szekció előbb (nincs új tábla); FR-A/B = új tábla nullable soft-linkkel a messages-hez + MCP write-tool — de csak a 3-kérdéses push-back után.

---

## Session checkpointok (legutóbbi felül; régiek → archív)

> 2026-09-10 előtti checkpointok (2026-07-21 → 2026-09-07, 6.9.0 → 6.72.0) + minden lezárt epic-log: `todo-archive.md` § „Archivált 2026-09-10 — todo.md átrendezés".
> 2026-09-10 → 2026-11-11 checkpointok: `todo-archive.md` § „Archivált 2026-11-22 — todo.md frissítés”, B) rész.

**Nyitott tételek az archivált checkpointokból (2026-11-22-i állapot):**
- [ ] **H1–H16 riport-egyeztetés** (2026-09-16 (2) és 2026-09-26): a teendők nyitottak. A 2026-09-16-i R1–R6 tervet az EPIC CA (NEXT) felülírta.
- [ ] **Tech-adósság a Next 16 körből** (2026-10-09): react-hooks 7 finding egyesével, 31 Turbopack trace-warning.
- [ ] **Assets → Share éles böngésző-ellenőrzése** (2026-10-19, 6.124.0): Select → 2 elem → Share; az asset megjelenik, kommentelhető, letölthető.
- [ ] **„Filter to these” éles próbája** (2026-11-02): az első valódi feltöltésnél.

## 2026-11-12 — Share: videós share-ben se Image preview, se képletöltés; WebM letöltés (Robi jóváhagyta: „igen, mehet a terv, fix minőség jó”)

Robi kérése: ha egy share-ben videók vannak, az Image preview kapcsoló és a képformátumos letöltés értelmetlen. A videó legyen letölthető WebM-ben is, a Download all menüben és a részletes nézet Download gombján is, formátumválasztó legördülővel.

**Gyökérok, Image preview:** a `canImagePreview` (`ShareGallery.tsx:264`) minden nem-képes creative-ot cserélhetőnek számol: a videót és a HTML5-csomagot is. A kép-mód viszont csak MC-n cserél (`item.kind === "matrix" && imageMode`), creative-ra az `imageSrcFor` nem ad képet. Tiszta videós share-ben ezért a kapcsoló 0-s számlálóval kirajzolódik, és nem csinál semmit. Javítás: a feltétel ugyanaz legyen, amit a kártyák használnak, vagyis legyen MC a share-ben. A mobil Actions menü ugyanazt a flaget kapja.

**Download all:**
- A képformátum-sorok csak akkor jelennek meg, ha van konvertálható kép (MC-preview vagy raszteres creative).
- A videósorok (as Original MP4, as WebM) csak akkor, ha van videó.
- Vegyes share-ben két csoport jelenik meg, címkével, ahogy most a Preview images · N. Mindegyik csak a saját fajtáját konvertálja, a többi eredetiben megy.

**WebM a szerveren:** a boxon ffmpeg 6.1.1 fut libvpx-vp9 és libopus kódolóval, 2 vCPU-n, 3.8 GB memóriával. Az nginx `location /` timeoutja 300 s, mindkét tenanton.
- `?as=webm` ugyanazon a `/share/[id]/file/[fileId]` route-on, amelyen a képkonverzió is megy.
- Kódolás: VP9 + Opus, fix minőséggel (CRF), knob nélkül.
- Cache a stillek mellé: `<client>/.thumbs/<fileId>.webm`. Másodszorra azonnal jön.
- Folyamatonként egyszerre egy kódolás fut, ugyanarra a fájlra legfeljebb egy (single-flight). Publikus, bejelentkezés nélküli úton ez tartja korlátban a CPU-t: egy videó legfeljebb egyszer kódolódik.
- A `downloadCount` nő, ahogy a képkonverziónál.
- Ha a forrás már WebM, a sor nem jelenik meg (mint a képformátumoknál).

Lépések:
- [x] 1. Mérés a boxon: MC412a 1920x1080, 10 s, 6.2 MB MP4, hang nélkül. VP9 CRF 32, `-cpu-used 4`: 29.7 s, 441 KB; `-cpu-used 6`: 31.2 s (nem gyorsabb). A mintát Range-kéréssel húztam le, így nem számított letöltésnek. Tanulság: az ffmpeg `-nostdin` nélkül a heredoc maradékát parancsként olvasta, ezért a takarítás elmaradt; a mappát utána kézzel töröltem. Az appban is `-nostdin` megy.
- [x] 2. `canImagePreview` = van MC a share-ben (`ShareGallery.tsx`). A mobil Actions menü ugyanezt a flaget kapja.
- [x] 3. `src/lib/video-formats.ts` (kliensbiztos: formátumlista, címke, `isConvertibleVideo`, `withVideoFormat`) és `src/lib/video-convert.ts`: ffmpeg `nice -n 10` alatt, a cache a stillek mellett (`<client>/.thumbs/<fileId>-v1.webm`), egy fájlra egy futás, folyamatonként egy kódolás. Eltérés a tervtől: nem a stillek 2-es ffmpeg-keretét használja, hanem saját, egyhelyes sort, mert egy kódolás már mindkét magot viszi. Bekötés: `?as=webm` a share file route-on; 400, ha a fájl nem videó vagy már WebM; 503, ha nem sikerül. Új integrációs tesztek a `share-file-convert.test.ts`-ben: valódi 1 s-os klip, VP9 64x48, a második kérés a cache-ből jön, a `downloadCount` 2; képre és WebM-re 400.
- [x] 4. `ItemDownloadMenu` → `VideoDownloadMenu`: as Original MP4, as WebM. A WebM-et fetch-csel tölti, a gomb közben „Converting…” (spinnerrel), hiba esetén „Conversion failed”. Közvetlen linkkel ~30 s-ig semmi nem látszana.
- [x] 5. `BulkDownloadRows` és `bulkEntry`: a képformátumok csak akkor jelennek meg, ha van kép (`pictureCount`), a WebM csak akkor, ha van videó (`videoCount`). Ha MC vagy kép is van mellette, a WebM saját „Videos · N” címke alatt áll. Az „as Original” mellé a videók kiterjesztése is kiíródik (MP4). Új mód: `{ mode: "video", as }`. A mobil Actions menü ugyanezeket kapja.
- [x] Mellékesen: a `DownloadMenu` resize-figyelője a scroll-kezelőt hívta, a `contains(window)` kivételt dobott, és a menü nyitva maradt. Mostantól saját `onResize` zárja be. Átméretezéssel ellenőrizve.
- [x] 6. Ellenőrzés helyi dev szerveren, az éles DB-vel:
  - Videós share (WyEy2p): nincs Image preview. A Download all, a részletes nézet és a mobil Actions menü is „as Original MP4” és „as WebM” sort mutat.
  - Egy WebM-letöltés végig: „Converting…”, utána 200. A helyi cache-ben VP9 1080x1920, 10.04 s, 492 KB. Mellékhatás az éles DB-ben: a WyEy2p `downloadCount` +1, a `viewCount` néhány oldalbetöltéssel nőtt.
  - MC-share (d1zZ7rcWrpMn): van Image preview (20), a menü változatlan, WebM nélkül.
  - Képes share (zYivZmN1jRkl): változatlan.
  - Vegyes share (videó és kép vagy MC együtt) nem volt az utolsó 40 ERSTE share-ben, azt nem láttam.
  - vitest: 119 fájl, 1107 teszt zöld. tsc tiszta.
- [x] 7. CHANGELOG az `[Unreleased]` alatt. Verziójavaslat: 6.128.4 → 6.129.0 (minor). Nincs commitolva.

### 6.129.0 deploy — Chief Architect: OK with changes (`~/agent-bus/answers/20261112-1459-mm6-6.129.0-webm-deploy.md`)
- [x] Push `5afc63b..358d711` (Robi: „Igen, push + deploy”). Pre-flight: 12 GB szabad a `/`-en, 2120 MB elérhető memória, mindkét tenant `5afc63b`, pm2 online, a deploy-script `c3438a49`.
- [x] Deploy felfüggesztve, Robi döntött: „Igen, építsd be”. Az 1. és 2. pont beépítve, a verzió marad 6.129.0, mert még nem ment élesbe.
  1. Felső korlát bemenetenként: execFile `timeout` 240 s, SIGKILL (az nginx 300 s alatt), `-threads 2`, és előellenőrzés: a forrás mérete legfeljebb 150 MB, ffprobe-hossz legfeljebb 60 s, felbontás legfeljebb 1080p. Felette 422, a gomb azt mondja: használd az Original-t.
  2. A várósor korlátja: folyamatonként legfeljebb 2 várakozó kódolás, felette 503 `Retry-After`-rel. A Download all sorban kér (`for` + `await`), ezt ellenőriztem.
  - Mellé: egy naplósor kódolásonként (fileId, ms, be/ki bájt), hogy látszódjon a visszaélés.
  - 3. (memória): a 150 MB-os korlát lefedi. 4. (Cache-Control): az eredeti bájtok ágával egyezik (`public, max-age=86400`), nem változtatok. 5. (`.thumbs` takarítása törléskor + méretriport): külön feladat, a stillekre is igaz.
  - Beépítve: a forrásméret előre a DB-ből jön, a hossz és a felbontás ffprobe-bal a kódolás előtt. A korlát feletti fájl memóriában marad, így nem töltjük le újra. 422 esetén a gomb „Too long for WebM”, 503 esetén „Busy — try again”. A sor: legfeljebb 2 várakozó, unit teszttel (`tests/unit/video-convert-queue.test.ts`). Integrációs teszt: 2560x1440 és 61 s → 422, kódolás és letöltésszámlálás nélkül. Naplósor: `[video-convert] <fileId> webm WxH Ns Nms in= out=`.
- [ ] Nyitott, külön feladat (CA 5. pont): a `.thumbs` alatti WebM-ek (és a stillek) törlése, amikor a fájl vagy a share törlődik, plusz méretriport.
- [x] Commit `fc5065d` (a korlátok), push `358d711..fc5065d`.
- [x] **DEPLOYOLVA `mm6-telekom`** (14:07 UTC): 52 s, `npm ci` nem futott, a legkevesebb szabad memória 1152 MB, a swap legfeljebb 694 MB. HEAD `fc5065d`, 6.129.0, next 16.4.5, `/login` 200, `/` 307, `/_next/image` 404, az error log üres. Előtte ellenőrizve: `nice`, `ffmpeg`, libvpx-vp9 és libopus megvan.
  - WebM-próba (`3_Ml4cJyfDkA`, 1080x1920, 10 s, 13.6 MB): hidegen **110 s**, 2.9 MB; a második kérés 0.13 s, a cache-ből. A legkevesebb szabad memória 1392 MB. A naplósor megjelent. A share `downloadCount`-ja +2.
- [x] **DEPLOYOLVA `mm6-erste`** (14:13 UTC): 51 s, a legkevesebb szabad memória 909 MB, a swap legfeljebb 755 MB. HEAD `fc5065d`, 6.129.0, `/login` 200, `/_next/image` 404. Az error logban csak az ismert AWS SDK Node 20 figyelmeztetés van.
  - WebM-próba (WyEy2p, MC412a 1920x1080, 10 s, 6.2 MB): hidegen 29.8 s, 441 KB; másodszor 0.05 s. A legkevesebb szabad memória 1755 MB. A WyEy2p `downloadCount`-ja +2.
- [ ] **Tanulság:** a kódolási idő erősen tartalomfüggő. A Telekom-klip 11 s/s, az ERSTE-klip 3 s/s. Ilyen tartalom mellett a 240 s-os időkorlát kb. 20 s-nyi videót enged, nem 60 s-ot. Ami túllépi, azt most minden kérés újra 240 s-ig kódolja, majd 503-at kap.
  - Javaslat: a lejárt kódolást ugyanúgy jegyezze meg, mint a korlát fölöttit (422, „Too long for WebM”).
  - Mérjünk gyorsabb beállítást (`-deadline realtime` vagy `-cpu-used 5`) ugyanazon a klipen.

## 2026-11-12 — Videó kezdőképe az utolsó előtti másodperc + mély link a nyitott előnézetre + WebM-tanulság (Robi: „Igen, mehet”, a library-ben is)

Robi kérése: a videók alapból az utolsó előtti másodpercet mutassák, mert akkor van rajtuk a teljes szöveg, ne a 0. képkockát. Kell továbbá mély link: ha egy előnézeti ablak nyitva van, a link oda vigyen.

**Kezdőkép.** Ma a szerver dönti el: a videó "thumbnail"-je a 0. still (`?thumb=` a share-proxyn, `/api/files/[id]/thumbnail` bejelentkezve). Ezt a library kártyái, a draft-borítók és a share csempéi mind ugyanígy kérik. A `VideoThumb` arra épít, hogy a poszter = 0. képkocka (nyugalmi idő 0:00, a 0-s indexre visszatérés a posztert fedi fel).
- Mechanizmus-szintű javítás: egy függvény a `still-strip.ts`-ben (`posterStillIndex(manifest)`): az a still, amelyik legközelebb esik a `hossz − 1 s`-hoz. Egy 10 s-os klipnél ez a 9.1 s-os tick. A szerver ezt adja posztereként, a `VideoThumb` pedig ettől az indextől indul. A badge nyugalomban `0:09 / 0:10`, a scrub a 0. képkockát is mutatja. A manifesthez nem kell új mező és nem kell újravágás: az index a meglévő mezőkből jön.
- A részletes nézet `<video>`-ja: a betöltés után az utolsó előtti másodpercre áll, saját felbontásban. Az első Play a 0-ról indul.

**Mély link.** A share nézete már most kétirányú URL-paraméterekben él (`share-view-params.ts`: theme, layout, size, q, commented, image). Ez egy új paramétert kap: `open=<elem kulcsa>`, például `?open=c-1234` vagy `?open=m-45-300x250`. A kulcs a stabil DB-id-ből jön.
- Nyitáskor, lapozáskor (előző/következő) és záráskor ugyanaz a `replaceState` írja.
- Betöltéskor, ha az elem létezik és a szűrők nem rejtik el, a dialógus nyitva indul.

Lépések:
- [x] 1. `posterStillIndex` (`still-strip.ts`) + unit teszt: 10 s → 9 s, 6 s → 5 s, 90 s → 88 s (döntetlennél a korábbi), ismeretlen hossz → 0.
- [x] 2. `readPosterResized` (`video-stills.ts`), a share `?thumb=` és a `/api/files/[id]/thumbnail` is ezt hívja. Az ETag a kiválasztott indexet tartalmazza, így a böngésző a régi 0-s posztert újraérvényesíti.
- [x] 3. `VideoThumb`: a manifest megérkezésekor az index, a shown és a ready a poszterindexre áll. Az overlay minden indexre mehet, kivéve a poszterét.
- [x] 4. `LateFrameVideo` (`ShareDetailDialog.tsx`, a fájllal kulcsolva): `loadedmetadata`-kor `hossz − 1`-re ugrik, az első Play a 0-ról indul, kivéve ha a néző már maga tekert. A library saját lejátszói (MatrixDetailDialog, ScaledMediaPreview, Assets, Drafts) változatlanok, ott csak a csempe kezdőképe váltott.
- [x] 5. `open` a `share-view-params.ts`-ben, tesztekkel. A `detailKey` a linkből indul, és ugyanaz a `replaceState` írja vissza. A nem létező kulcsot a meglévő effekt zárja be, és az URL-ből is kikerül.
- [x] 6. Ellenőrzés helyben, a WyEy2p share-en:
  - A csempék a teljes szövegű képkockát mutatják `0:09 / 0:10`-en, a scrub eléri a 0:00-t.
  - A dialógus videója 9.04/10.04-en áll, Play után 1.2 s-mal 1.18 s-on tart.
  - A `?layout=grid&open=c-18201` link nyitott dialógussal indul, a Next `open=c-18206`-ra vált (a videó újra 9.04-en), Escape után `?layout=grid` marad.
  - `open=c-999999`: zárva marad, az URL kitisztul.
  - A library-csempét nem néztem böngészőben, mert a helyi dev szerveren nem vagyok belépve. Ugyanazt a szerverfüggvényt hívja.
  - CHANGELOG az `[Unreleased]` alatt, verziójavaslat 6.130.0.
- [x] 7. WebM:
  - A korlát fölötti és a lejárt kódolás jelölőfájlt kap (`<fileId>-v2.webm.over`), ami újraindítás után is megmarad, és azonnal 422-t ad. Integrációs teszt 1 ms-os időkorláttal.
  - Mérés a boxon (Telekom-klip, nice 19, SSIM a forráshoz):
    - good/4: 99 s, 2.9 MB, 0.9811
    - good/5: 92 s, 0.9801
    - realtime/6: 19 s, 3.7 MB, 0.9817
    - realtime/8: 14 s, 4.1 MB, 0.9815
  - Átállás realtime/6-ra, `CACHE_VERSION` 2: a régi cache és a régi jelölők is újrapróbálódnak.

### 6.130.0 deploy — Chief Architect: OK with changes (`~/agent-bus/answers/20261112-1529-mm6-6.130.0-poster-deeplink-deploy.md`)
- [x] Push `fc5065d..654bec0` (Robi: „Igen, push + deploy”).
- [x] A CA-pontokból beépítve, saját commitban a 6.130.0-n belül, mert még nem ment élesbe:
  - A jelölő kétféle. A `.over` (korlát fölött) végleges. A `.timeout` 24 óra után lejár, mert a terhelés is okozhatja.
  - Jelölés csak akkor jön, ha a saját időkorlátunk ölte meg a kódolást (`killed && signal === "SIGKILL"`). Más leállást (OOM, ffmpeg-összeomlás) naplózunk, de nem jegyzünk meg.
  - A `?open=` csak `^[mca]-[0-9a-z-]{1,62}$` alakot fogad el.
  - Tesztek: lejárt `.timeout` után újra kódol (200), és rossz alakú `open` → null.
- Már teljesült a beépítés előtt is:
  - (3) a részleges kimenet a tmp-ben készül, utána copy + rename, így sosem kerül a cache-be;
  - (6) a poszter indexére a `readStillResized` határellenőrzése → 404, a Cache-Control nem változott.
- Nem csináltam meg:
  - (4) a régi `*-v1.webm` törlését (2 fájl, kb. 3.4 MB a köteten): törlés, Robi kifejezett jóváhagyása kell.
  - A CA szerint a Box B 91%-on van; ez nem stimmel: `/` 68%, a tárolókötet 10%.
- [x] Commit `ed0d719` (CA-javítások), push `654bec0..ed0d719`.
- [x] **DEPLOYOLVA `mm6-telekom`** (14:34 UTC):
  - 47 s, a legkevesebb szabad memória 1560 MB. HEAD `ed0d719`, 6.130.0, `/login` 200, `/_next/image` 404.
  - Poszter: ETag `s5-…-9-400` (a 10 s-os klip 9. stillje), If-None-Match-re 304.
  - WebM v2: hidegen **16.9 s** (reggel 110 s), 3.7 MB; másodszor 0.05 s. A legkevesebb szabad memória 1978 MB.
- [x] **DEPLOYOLVA `mm6-erste`** (14:36 UTC):
  - 42 s, a legkevesebb szabad memória 1534 MB. HEAD `ed0d719`, 6.130.0, `/login` 200, `/_next/image` 404.
  - Poszter: index 9, 304.
  - WebM v2: hidegen **6.5 s** (reggel 29.8 s), 627 KB; másodszor 0.02 s.
  - Az error logban a deploy óta nincs új sor.
  - Korábbi, nem ehhez tartozó sor: 14:11:45-kor egy `uncaughtException: Controller is already closed` még a 6.128.4-es kódon. Valószínűleg egy megszakított videó-Range-stream. Egyetlen előfordulás; ha ismétlődik, a `readFileStream` → web stream átalakítást kell megnézni.
  - A `?open=` élesben még nem volt kipróbálva, helyben igen.
- [x] A régi `*-v1.webm` törlése (Robi: „igen, töröld a két régi webm-et”). A két fájlt név szerint töröltem, összesen 3.4 MB; v1-es jelölő nem volt. A v2-es fájlok megvannak, az ERSTE WebM 0.05 s alatt jön a cache-ből. Ez a kérés a WyEy2p `downloadCount`-ját +1-gyel növelte.

## 2026-11-20 — Share Refresh hozza be az újabb verziót (n1 → n2) — Robi: „Mehet, átvinni” (alapos terv, a kommentek átkerülnek)

Robi: „van most ezen két méret https://erste.messagingmatrix.ai/share/0FVkKhe4V3H3 aminek van n2 verziója, nem szeretnék új share linket, szeretném ha n2-k befrissülnének a sharebe … kéne”.

**Most:** a Shares lap Refresh gombja (`refreshShare`, `src/lib/share-snapshot.ts:340`) csak ugyanazokat a creative id-ket olvassa újra. Az n2 viszont új creative sor, új id-vel. Az Add to share a végére fűzi az n2-t, de az n1 is bent marad, és egy elemet kivenni a share-ből nem lehet. Erre a share-re (BlackFriday TCÜ, 11 creative, 0 komment) ez a két csere jönne:
- 18295 `ERSTE_SZA_MC420_a_BF_TCU_n1_1080x1920.jpg` → 18303 `…_n2_1080x1920.jpg`
- 18302 `ERSTE_SZA_MC420_b_BF_TCU_animated_n1_1080x1920.mp4` → 18304 `…_animated_n2_1080x1920.mp4`

**Kicsi javítás (nem ajánlom):** külön „Replace with newest versions” gomb. Ezzel két, majdnem ugyanazt csináló gomb lenne.

**Alapos javítás (ajánlott):** a Refresh jelentése az lesz, hogy a share a mostani állapotot mutassa. Ebbe beletartozik, hogy minden creative-et a saját verziócsaládja legújabb, nem archivált tagjára cserél, a share-en belül ugyanazon a helyen. A család ugyanaz a kulcs, amit a library használ (`versionFamilyKey`: fájlnév + deklarált méret, a zip külön család), így a későbbi n3 is magától bejön.
- [x] `refreshShare`: a share creative-jeinek `mc_number`-ére egyetlen lekérdezés (index: `creatives_client_mc_idx`; nem az összes creative, mert az ERSTE-nél 18k sor van, és belefutna a 1000-es plafonba). `versionFamilyKey` szerint csoportosít, és ha van újabb verzió, cserél: a creative sor és a hozzá tartozó `files` bejegyzés is a régi helyére kerül.
- [x] Ha az újabb verzió már bent van a share-ben, a régit kiveszi, hogy ne legyen duplikátum.
- [x] A régi elem kommentjei (`share_comments.item_key` `c-<régi id>` → `c-<új id>`) ugyanabban a tranzakcióban átkerülnek az új verzióra, különben eltűnnének a linkről. Robi döntése: átvisszük, az archivált kommentekkel együtt.
- [x] Az új fájloknak `warmShareStills` (a videó still-strip előre elkészül), ahogy az Add to share-nél is.
- [x] Az audit `after` mezőjébe a `replaced` lista; a Refresh visszajelzése: „N updated, M replaced by a newer version”. A gomb tooltipje marad: „to the current creatives”.
- [x] Integrációs teszt: n1 → n2 csere a helyén, az archivált n2-t kihagyja, duplikátumnál a régit kiveszi, a kommentek átkerülnek, a zip és a jpg két külön család.
- [x] Bump: 6.130.0 → 6.131.0 (minor, mert a felhasználó számára látható viselkedés változik), CHANGELOG, deploy (először Telekom), utána Refresh ezen a share-en élesben.

Mellékhatás: egy régi `?open=c-18295` link a csere után nem nyitja meg az új elemet. A share alapnézete ettől még rendben megjelenik.

### Megvalósítás (nem commitolt)
- `src/lib/share-snapshot.ts` `refreshShare`: a kreatívokat a saját MC-számuk szerint keresi, az oszlopból és a fájlnévből is. Csak a nem archivált kreatívok jöhetnek szóba, és csak a magasabb `_nN` cserél. Ugyanazon verzión belül a legkésőbbi feltöltés nyer. A lecserélt n1 fájlja kikerül a `files` listából, kivéve, ha más elem is használja. Az eredményben új mező a `replaced` és a `newFileIds`.
- `refresh/route.ts`: `warmShareStills` az új fájlokra, az auditba `replaced`.
- `SharesView.tsx`: az app-ban nincs toast komponens, ezért a Refresh sikeres futás után továbbra is csendes. A megerősítő ablak szövege mondja el, hogy az újabb verzió a helyére kerül a kommentjeivel együtt.
- Korlát: ha egy kreatívnak se az oszlopában, se a fájlnevében nincs MC-szám, az újabb verzióját nem keresi meg. Az ERSTE-nél ez 1 a 3792 élő kreatívból.
- Az élő share-en a két fájlnév családkulcsa egyezik: `erste_sza_mc420_a_bf_tcu|1080x1920` n1 → n2, és `…_b_bf_tcu_animated|1080x1920` n1 → n2. Csak ez a kettő cserélődne.
- Teszt: `tests/integration/api/share-add-items.test.ts`, 2 új eset (10/10 zöld).


### 6.131.0 deploy — Chief Architect: OK with changes (`~/agent-bus/answers/20261120-1255-mm6-6.131.0-share-refresh-versions.md`)
- [x] CA pontjai:
  - A `warmShareStills` csak a DB-lookupot várja meg, a stilleket `void warmStills` indítja, így a Refresh kérés nem vár az ffmpeg-re.
  - A `c-<id>` elemkulcsot csak a `share_comments` használja; más elemhez kötött adat nincs.
  - A fájl-proxy `public, max-age=86400`-zal szolgál ki. Ismert korlát: aki az n1 URL-jét már letöltötte, a böngészője legfeljebb egy napig a cache-ből még megmutatja. A galéria az n2-t új URL-en hozza.
  - A CA toastot javasolt a cserék számával; az app-ban nincs toast komponens, ez nyitott kérdés Robinak.
- [x] Commit `ed2f6c6`, push `ed0d719..ed2f6c6`.
- [x] **DEPLOYOLVA `mm6-telekom`** (11:56 UTC): 69 s, a legkevesebb szabad memória 1075 MB. HEAD `ed2f6c6`, 6.131.0, `/login` 200, pm2 online, az error log üres.
- [x] **DEPLOYOLVA `mm6-erste`** (11:58 UTC): 59 s, a legkevesebb szabad memória 1220 MB. HEAD `ed2f6c6`, 6.131.0, `/login` 200, `/share/0FVkKhe4V3H3` 200, az error log üres.
- [x] (2026-11-21, ellenőrizve az élő DB-ben, lásd lent) Robi a Shares lapon Refresh-t nyom a BlackFriday TCÜ share-re. Előtte: creatives `18296,18297,18292,18295,18294,18293,18298,18299,18300,18302,18301`, 0 komment, `updated_at` 11:12:34. Várt eredmény: 18295 → 18303 és 18302 → 18304 ugyanazon a helyen, az n1 fájljai kikerülnek a `files`-ból, a kommentszám nem változik.

## 2026-11-20 — Refresh előnézet: a megerősítő ablak thumbnaillel mutatja, mi cserélődik — Robi: „jó lenne ha itt kiírná már hogy mit fog refreshelni thumbnail-el”

Most a Refresh ablak csak általános szöveget ír, nem mondja meg, melyik kreatív cserélődik melyikre.

**Mechanizmus (javasolt):** a cseretervet egyetlen függvény számolja (`planShareRefresh`). Ugyanezt használja a Refresh (POST) és az előnézet is: egy új `GET /api/share-galleries/[id]/refresh`, ami nem ír semmit. Így az ablak nem mutathat mást, mint amit a Refresh tényleg csinál. Az elvetett kis megoldás: a családkulcs-logika a kliensben is lefutna. Ez másolat lenne, ami előbb-utóbb eltérne a szervertől.
Ütközés a CA tanácsával: a 6.131.0 válaszában azt írta, „Do not add a preview/dry-run layer”. Itt nincs külön réteg, mert az előnézet ugyanazt a függvényt hívja. A döntés Robié.

- [x] `src/lib/share-snapshot.ts`: a jelölt-keresés és a „legújabb a családban” rész kikerül a `planShareRefresh(tx, clientId, creatives)` függvénybe. Visszaadja a `{ from, to }` párokat fájlnévvel és `fileId`-val. A `refreshShare` ugyanezt hívja, a viselkedése nem változik.
- [x] `refresh/route.ts`: új `GET`, `withSession` mögött, kliensre szűrve. Válasz: `{ replaced: [{ from:{id,fileName,fileId}, to:{…} }] }`. Archivált share-re 409, mint a POST-nál.
- [x] `SharesView.tsx` `refreshSelected`: a kijelölt share-ek előnézetét párhuzamosan lekéri, és csak utána nyitja meg a megerősítő ablakot. Az ablak törzse (ReactNode) share-enként mutatja a párokat: n1 thumbnail → n2 thumbnail, alattuk a fájlnév. Thumbnail: `/api/files/<fileId>/thumbnail?w=200`, ami képre, videó-posterre és HTML5 zip posterre is működik. Ha nincs csere: „No newer versions — content and styles are re-read.” Görgethető, max. magasságú lista.
- [x] Szemantikus osztályok: `share-refresh-preview`, `__share`, `__pair`, `__thumb` (+ `thumb-checker`), `__arrow`, `__name`. Bekerülnek a `tasks/component-inventory.md`-be.
- [x] Integrációs teszt: a GET ugyanazt a párlistát adja, mint utána a POST `replaced`-je. A GET nem módosít semmit (metadata, kommentek, `updated_at` változatlan). Másik kliens share-jére 404.
- [x] Bump: 6.131.0 → 6.132.0 (minor, új HTTP route + látható változás), CHANGELOG. Deploy csak Robi go-ja után.

Ismert korlát: ha az előnézet és a Refresh gomb megnyomása között új verzió érkezik, a Refresh már azt hozza. A POST válasza a ténylegesen lefutott cserelistát adja vissza.

### Megvalósítás (nem commitolt) — Robi: „Mehet”
- `share-snapshot.ts`: a `planVersionSwaps(q, clientId, current)` kiemelve, és a `refreshShare` is ezt hívja. Új `previewShareRefresh`, ami csak olvas. A fájltípust a tárolt mime alapján adja meg a `creativeMediaKind`.
- `refresh/route.ts`: `GET` → `{ replaced: [{ from, to }] }`, az elutasítások ugyanazok, mint a POST-nál (404/409).
- `SharesView.tsx`: a Refresh előbb lekéri a kijelölt share-ek előnézetét, közben a gomb tiltva van. Az ablak törzse a `RefreshPreview`: share-enként régi → új thumbnail, alatta a fájlnév. Több share kijelölésekor a share címe is látszik. Ha nincs csere: „No newer versions — nothing is swapped.”
- Teszt: 2 új eset (12/12 zöld). Az előnézet ugyanazt a párlistát adja, mint utána a Refresh, és semmit nem ír. 404/409.
- Élő, csak olvasó próba a BlackFriday TCÜ share-en (helyi kód, éles DB): 18295 → 18303 (jpg, image) és 18302 → 18304 (mp4, video). A share érintetlen, `updated_at` 11:12:34.
- Nem ellenőrzött: az ablak megjelenése a böngészőben, mert a helyi app bejelentkezést kér.

### 2026-11-21 — Robi döntése, bump
- Robi döntött a CA-ütközésről: „direkt kérem hogy a dialogus mutassa mi mire cserélne”. Az előnézet marad.
- 6.132.0, CHANGELOG, commit `9be22f7`, push `ed2f6c6..9be22f7` (Robi: „Mehet a deploy”).
- Chief Architect: OK (`~/agent-bus/answers/20261121-1615-mm6-6.132.0-refresh-preview-deploy.md`). A pontjai:
  - A thumbnail route a kliensre szűr (`getFile(claims.cid, …)`), nem a share fájlkapujára, így a régi kép is betölt.
  - A `warmShareStills` miatti aggodalom már a 6.131.0-nál le volt zárva: csak a DB-lookupot várja meg.
  - Bejelentkezett GET-smoke-ot (200 + `replaced`, másik tenantról 404) nem tudtam futtatni, mert nem jelentkezem be. Helyette: a bejelentkezés nélküli GET mindkét tenanton 401, az élő DB-n a `previewShareRefresh` pedig a két várt cserét adja. A 404/409 eseteket a teszt fedi.
- [x] **DEPLOYOLVA `mm6-telekom`** (15:16 UTC): 44 s, a legkevesebb szabad memória 1279 MB, a swap legfeljebb 567 MB. Előtte: a box scriptje egyezik a repóval (`c3438a49`), előző HEAD `ed2f6c6`. Utána: HEAD `9be22f7`, 6.132.0, `/login` 200, a refresh GET bejelentkezés nélkül 401, pm2 online, az error logba nem jött új sor.
- [x] **DEPLOYOLVA `mm6-erste`** (15:17 UTC): 44 s, a legkevesebb szabad memória 1286 MB, a swap legfeljebb 604 MB. HEAD `9be22f7`, 6.132.0, `/login` 200, `/share/0FVkKhe4V3H3` 200 (ez a `curl` a viewCount-ot 1-gyel növelte), a refresh GET 401, az error logba nem jött új sor.
- [x] Deploy után: Robi megnyomja a Refresh-t a BlackFriday TCÜ share-en, és az ablakban a 18295 → 18303 és 18302 → 18304 párnak kell látszania. Utána DB-ben ellenőrizni: a kreatívok sorrendje, az n1 fájlok kikerültek a `files`-ból, a kommentszám változatlan, az audit sorban ott a `replaced`.
  - Robi megnyomta (2026-11-21 15:19 UTC). DB: a sorrend `18296,18297,18292,18303,18294,18293,18298,18299,18300,18304,18301`, az n1 fájlok (`o_YrF6…`, `3C8XaR…`) kikerültek a `files`-ból, az n2 fájlok bekerültek, a kommentszám 0 (előtte is 0), az audit sor `replaced: [{18295→18303},{18302→18304}]`.

## 2026-11-22 — Szabályfájlok: az AGENTS.md a forrás, a CLAUDE.md csak importálja (TERV, Robi jóváhagyására vár)

Kérés: a Learning session adta át Robi kérését. A repó szabályfájljai igazodjanak az új globális szabályokhoz (`~/.claude/CLAUDE.md` = `~/.agents/AGENTS.md`, plusz `~/.claude/rules/claude-code.md`). A repó szabályainak forrása az AGENTS.md legyen, mert a Codex ezt olvassa. Nevezze meg a Drive-mappát és a szemantikai modellt, és egyetlen szabály se vesszen el.

**Touches:** a gyökérben lévő `AGENTS.md` és `CLAUDE.md`. A szomszédjai: a globális szabályfájl, a `claude-code.md` és a `.claude/settings.json` Stop-hookja (erre a szöveg hivatkozik). A szabályfájlokról magukról nincs Drive-dokumentum, ez megállapítás. App-kódot a változás nem érint.
**Door:** kétirányú, `git revert` visszacsinálja. A hatósugár: minden későbbi agent-session ebben a repóban (Claude Code, Codex).
**Prediction:**
- A Codex az összefésült AGENTS.md-t olvassa, a Claude Code ugyanazt az `@AGENTS.md` importon át.
- Az alábbi listában szereplő szabályok mind megmaradnak, kivéve azokat, amiket Robi D2–D4-ben átír.
- Nincs verzióemelés, mert ez tooling/config változás.
- Ismeretlen: a Codex követi-e az AGENTS.md-ben lévő relatív hivatkozásokat. Ezt nem mértem.
**Seam:** egy friss session betöltött utasításai.

### Mai állapot (megfigyelve, 2026-11-22)
- **Az AGENTS.md a régebbi tartalom**, csak a fájl dátuma újabb (2026-10-21). A tartalma megegyezik a 2026-05-24-i commitéval (`3d27182`). Ez a régi CLAUDE.md, amiben „Claude” helyén „Codex” áll, ezért hibás útvonalak kerültek bele: `~/.Codex/AGENTS.md`, `.Codex/settings.json`. Még `6.0.0-pre` állapotot ír. A CLAUDE.md 2026-08-13-i (`2af65c0`), tartalomban ez az újabb: `6.0.0` utáni semver, `todo-archive.md`.
- **Elavult tények mindkettőben:**
  - „currently `6.1.0`”, a valóság 6.132.0;
  - „All share the same SQLite at `db/matrix.db`”, valójában Postgres a Hetzneren, helyi gépről a :5433 tunnelen át;
  - „167+ tests as of Phase 10”, ma 1119 teszt van;
  - „todo.md … kept small, read fully”, ma 3388 sor.
- **Drive-mappa (jelöltek):**
  - `~/GoogleDrive/Data/MessagingMatrix/`: benne van az `MM6_SYSTEM_OVERVIEW.md` (2026-05-15), a `Dev Reports/`, a `Humanody integration/` és a design-fájlok.
  - `~/GoogleDrive/Data/Beliczki.hu/MessagingMatrix/`: üres, 2026-10-10-én jött létre.
  - Ügyfélmappák a leadásokhoz: `ERSTE HU/_messagingmatrix.ai`, `Telekom/_messagingmatrix.ai`.
  - A customBrainben nem találtam jegyzetet arról, melyik a projekt mappája.
- **Szemantikai modell: még nincs.** Van egy tanulmány és roadmap: a Google Doc `1m2bS-eLqyXCsOzWmCTYf-qiAbLzaHLm2D4oB_kRitmE`, 2026-11-02, újraolvasva 11-05-én (brain: „Messaging matrix — Szemantikai modell roadmap”, `d9f4c6b2`). Ennek P1 szakasza, az „olvasható szemantikai modell”, nem készült el.
- **A meglévő jelentés-dokumentumok:**
  - `docs/REBUILD_SPEC.md`: a fájl 2026-09-06-i. Gitben már nincs (az utolsó commit, ami érintette, 2026-04-26-i).
  - `docs/MM6_PURPOSE_STATE_CAPABILITIES.md`: 2026-09-06, 6.39.0-s állapot, valószínűleg elavult.
  - `docs/MM6_SYSTEM_OVERVIEW.md`: 2026-05-08, egyezik a Drive-on lévő példánnyal.
  - A `docs/` könyvtár gitignore-olt, minden fájlja csak ezen a gépen létezik.

### Robi döntései (ajánlással)
- **D1 Drive-mappa:** ajánlom a `~/GoogleDrive/Data/MessagingMatrix/`-t, mert ott vannak a projekt dokumentumai. Az üres `Beliczki.hu/MessagingMatrix/` lenne az új otthon? Az ügyfélmappák külön sorban szerepelnének.
- **D2 verziószám:** a „currently X” sor kikerül, helyette: „a jelenlegi verzió a `package.json`-ban van”. Ez minden bumpnál elavult.
- **D3 todo.md:** a szabály marad (lean fájl + `todo-archive.md`). A mostani 3388 sor archívumba görgetése külön feladat, ebbe nem kerül bele.
- **D4 elavult tények:**
  - SQLite helyett Postgres: Hetzner, helyben a :5433 tunnel; az integrációs tesztekhez docker Postgres kell a :55432-n.
  - A tesztszám helyett: „`npm test` (vitest)”.
  - A CHANGELOG-nál: „már létezik”.
- **D5 (nem ebben a változásban):** a gitignore-olt `docs/` jelentés-dokumentumai a „Repo = code, Drive = documents” szabály szerint a Drive-ra valók. Ez külön feladat.

### Szeletek
- [x] **S1 AGENTS.md mint egyetlen forrás.**
  - Alapja a CLAUDE.md újabb tartalma, minden agentre általánosítva.
  - A globális hivatkozás: `~/.agents/AGENTS.md`.
  - A hibás `.Codex` útvonalak javítva.
  - Új szakasz: „Meaning: Drive folder and semantic model”. Tartalma D1, a „nincs még modell” megállapítás a roadmap-dokumentummal, és a jelentés-dokumentumok dátummal, az elavulás jelzésével.
  - D2–D4 Robi döntése szerint. A nyelv marad angol.
- [x] **S2 CLAUDE.md:** `@AGENTS.md`, alatta egyetlen Claude-only sor: a `.claude/settings.json` Stop-hook figyelmeztetése.
- [x] **S3 Ellenőrzés** (részben, lásd a review-t):
  - Szabályonkénti lista, minden régi szabály ott van az új AGENTS.md-ben, vagy D2–D4 szerint szándékosan változott:
    - hol élnek a tervek (todo, archive, REBUILD_SPEC, component-inventory);
    - semver egyetlen `package.json`-ban;
    - bump-emlékeztető, nincs csendes bump, a javaslat formája;
    - patch/minor/major heurisztika, a majort a user dönti, kétes esetben a magasabb;
    - CHANGELOG: `[Unreleased]` alá, Added/Changed/Fixed/Removed, összefoglal, nem duplikál;
    - mi nem számít befejezett munkának;
    - todo checkpoint alulra;
    - Stop-hook;
    - dev portok 6000–6003;
    - migrációhoz integrációs teszt.
  - Friss `claude -p` a repóban, ami szó szerint idézi a Drive-mappa sorát: ez bizonyítja, hogy az import feloldódik. `codex exec -s read-only` ugyanígy.
- [x] **S4 Commit:** csak az `AGENTS.md`, a `CLAUDE.md` és a saját todo-hunk. Push csak Robi go-jára. Nincs bump. (`12449e0`, pusholva)

Planning review: ez nem tartozik a kötelező esetek közé (nincs új réteg, séma-, auth- vagy deploy-változás, és major dependency-emelés sincs). Ezért nem kértem tőle véleményt, Robi kérheti. A `codex` most már telepítve van: `~/.local/bin/codex`.

### Review (2026-11-22) — Robi: „Mehet az ajánlással” (D1–D4 az ajánlás szerint)
- **AGENTS.md:** szó szerint a régi CLAUDE.md, ezekkel a változtatásokkal:
  - fejléc: minden agentnek szól, és a globális `~/.agents/AGENTS.md`-re hivatkozik;
  - új „Meaning: Drive folder and semantic model” szakasz;
  - D2: a „currently 6.1.0” helyett „the current version is the one in that file”;
  - D4: SQLite helyett Postgres a :5433 tunnelen, a tesztszám helyett a :55432-es teszt-Postgres;
  - a tooling-sor a `.codex/` setting és „this file” kiegészítést kapta;
  - a Stop-hook sor átkerült a CLAUDE.md-be.
- **Ellenőrzés:** `git diff --word-diff` a régi CLAUDE.md-hez képest, és csak a fenti változások látszanak. A régi AGENTS.md-ből szándékosan kimaradt:
  - a `6.0.0-pre` szabályok, amiket a 6.0.0 graduálás meghaladt;
  - „create CHANGELOG on first bump”, mert a fájl létezik;
  - „todo.md large, read with tail”, mert D3 szerint a lean + read fully szabály marad;
  - a hibás `.Codex` útvonalak.
- **Privacy:** a repó publikus (GitHub), ezért a tanulmány Google Doc linkje nem került a fájlba, csak a címe és a brain-jegyzet neve.
- **Codex:** egy friss `codex exec -s read-only` fájlolvasás nélkül szó szerint visszaidézte a Drive-mappa sorát. Az AGENTS.md tehát betöltődik.
- **Claude Code:** NEM ellenőrzött. A `claude -p` „OAuth session expired” hibával leállt, ezért nem tudtam friss Claude-sessionben próbálni az `@AGENTS.md` importot. A következő friss session indulásakor kiderül, hogy az import feloldódik-e.
- **Mellékes:** a `claude -p` figyelmeztetett, hogy a `.claude/settings.local.json` egyik Bash allow-szabályában a `*` túl tág. Nem nyúltam hozzá.

## 2026-11-22 — AGENTS.md „Deploy” szakasz (TERV, Robi jóváhagyására vár)

Kérés: a Learning session adta át Robi kérését. Az MM6 deploy-tudása kerüljön az AGENTS.md-be egy „Deploy” szakaszba. A box-szintű tények helye a `~/.agents/infra-map.md`. A repó publikus, ezért nem kerülhet bele IP, ssh-user, szerverport, kulcsnév, szerverútvonal, és titok semmiképp.

**Touches:**
- `AGENTS.md`: új „Deploy” szakasz.
- A Claude-memória 3 jegyzete és a `MEMORY.md` index.
- Szomszédok: `deploy/bin/mm6-deploy` (a forrás, nem változik), `~/.agents/infra-map.md` „Box B” (csak olvasom), a globális szabály „Read before you touch → Deploy” pontja.
- A deployról nincs Drive-dokumentum. A tudás a scriptben, a memóriában és a todo checkpointjaiban van.

**Door:** kétirányú, `git revert` és a memória visszaírása visszacsinálja. Hatósugár: minden későbbi deployt ez a szöveg vezet.

**Prediction:**
- Egy friss agent az AGENTS.md-ből meg tudja mondani a deploy sorrendjét, a migrációs szabályt és a rollbacket.
- A szöveg nem tartalmaz IP-t, usert, szerverportot, kulcsnevet vagy szerverútvonalat. Ellenőrzés: `grep` a fájlon.
- App-kód nem változik, verzióemelés nincs.

**Seam:** a betöltött AGENTS.md (a Codex-próba úgy, mint a múltkor).

### Összevetés: memória (`reference_hetzner_box.md`, 2026-06-27) ↔ infra-map Box B ↔ megfigyelés (2026-11-21 pm2 lista)
- **A memória elavult:**
  - `mm-server-telekom` futó appként szerepel, de az infra-mapben nincs, és a 11-21-i pm2 listában sincs. Ott ez az öt app futott: `custombrain`, `mm-server-erste`, `mm-server-proficio`, `mm6-erste`, `mm6-telekom`.
  - „Postgres 5432 free”: azóta ott fut a Supabase Postgres.
  - Ezekben az infra-map a helyes.
- **Box-szintű tények, amik nincsenek az infra-mapben.** Ezeket NEM írom a repóba, itt jelzem, az infra-map gazdája vegye fel őket:
  1. Hozzáférés: a box kulcsa egy `.ppk`-ból konvertált OpenSSH kulcs. A `~/.ssh/mm pub` nevű fájl félrevezető név, használhatatlan.
  2. Docker 29 és Compose v5 (2026-06, nem ellenőriztem újra).
  3. A pm2 alatt fut a `pm2-logrotate` modul is (megfigyelve 2026-11-21).
  4. A Mac-tunnel részletei: a `com.mm6.db-tunnel` launchd agent (autossh, KeepAlive), a plist és a log helye, kézi tartalék-parancs. Ezek a `project_db_tunnel_launchagent.md` memóriában vannak.
  5. Az MM6 thumbnail-cache (`STORAGE_ROOT`) mindkét deploy `.env`-jében a Hetzner volume-on van, nem a gyökérlemezen (memória: `project_mm6_object_store.md`).
  6. A régi `supabase-mm6_mm6-minio-data` docker volume (~8 GB a `/`-n) rollback-pontként megmaradt, a törléséről Robi még nem döntött. Az infra-map csak annyit ír, hogy ez „volt” az adat helye.
  7. A boxon telepített `mm6-deploy` és `mm6-maint` (a repó `deploy/bin/` másolatai) helye nincs az infra-mapben.
- **A mai AGENTS.md-ben van két helyi port** (`localhost:5433`, `:55432`). Ezeket a tegnapi D4 tette bele. Az infra-map szabálya szerint port nem kerülhet repófájlba.
  - Javaslat: helyettük „a megosztott Postgres helyi tunnelje” és „a `mm6-test-pg` teszt-Postgres”, hivatkozással az infra-map „Mac” szakaszára.
  - A 6000–6003 dev-portok maradnak, mert a `package.json` scriptjeiben amúgy is ott vannak.

### A „Deploy” szakasz tartalma (angolul, szerver-adat nélkül)
1. **Hol:** az infra-map Box B sorai, `mm6-erste` és `mm6-telekom`. Egy kódbázis, tenantonként egy deploy, mindkettő ugyanazt a Postgrest és MinIO-t használja.
2. **Parancs:** a boxon `mm6-deploy <tenant>`, a forrása `deploy/bin/mm6-deploy`. A lépései, ahogy a scriptben vannak:
   - `git pull --ff-only`;
   - ha a lockfile változott, `npm ci`;
   - build a `.next-build`-be, közben az élő app kiszolgál;
   - maintenance oldal fel;
   - csere;
   - `pm2 restart`;
   - várakozás, amíg a `/login` 200-at ad;
   - maintenance oldal le;
   - a `.next-old` törlése.
   - A script megáll, ha a telepített példánya eltér a repóétól.
3. **Előtte:**
   - Robi go-ja tenantonként.
   - Planning review a globális szabály szerint.
   - Push előbb, mert a box az originről húz.
   - A szabad memória és a lemez ellenőrzése: a box a kapacitás-kockázat, lásd az infra-mapet.
   - Az előző HEAD feljegyzése.
   - **Sorrend: Telekom, utána ERSTE.**
   - Napközben is mehet: a build ~45–160 s, a kiesés ~1 s a maintenance oldal mögött.
4. **Közben:** szabad memória figyelése. Ha az elérhető memória ~120 MB alá esik, a `next build` leállítása.
5. **Migráció:**
   - A helyi `DATABASE_URL` az éles DB, ezért helyben soha nem fut `db:migrate`.
   - Az `mm6-deploy` NEM migrál. Ha új `db/migrations/*.sql` jön: a boxon pull, utána `db:migrate` a deploy env-jével, utána `mm6-deploy`, egy menetben.
   - Mivel a két tenant egy DB-n van, a migráció mindkettőt egyszerre éri. A másik tenant a régi kóddal fut az új sémán, amíg őt is deployolod. Ezért a migráció legyen additív, és a második tenant menjen közvetlenül utána.
   - Migrációt mindig `main`-ről generálunk.
   - ⚠️ Megjegyzés: a todo-ban nem találtam leírt migrációs deployt az `mm6-deploy` mellett. Ez a lépéssor a régi kézi deployokból (6.33–6.73) és a scriptből összerakott eljárás, nem megfigyelt.
6. **Rollback:**
   - Bukott build: semmi nem változott, a régi build szolgál ki.
   - Az app nem jön fel: a maintenance oldal fent marad, a `.next-old` megvan. Ilyenkor vissza kell cserélni, `pm2 restart`, `mm6-maint off`.
   - **Sikeres deploy után a `.next-old` már törölve van**, ilyenkor a rollback `git revert`, push, és újra `mm6-deploy`. Ha a lockfile is mozgott, a következő deploy magától `npm ci`-t futtat.
   - Migrációnál a DROP-ot előre leírjuk a tervbe.
   - (A tegnapi CA-kérésben tévesen „`.next-old` swap” szerepelt rollbackként egy sikeres deploy után.)
7. **Utána:**
   - HEAD és verzió;
   - pm2 online, a restartok száma csak eggyel nő;
   - `/login` 200, egy share oldal 200 (ez a view count-ot növeli);
   - egy új route bejelentkezés nélkül 401;
   - az error logba nem jött új sor;
   - nem maradt `.next-old` vagy `.next-build`;
   - a `/_next/image` 404-et ad (`images.unoptimized` a 16.4.5 óta).
8. **Tanulságok:**
   - nginx mögött a `req.url` a helyi bind cím, ezért abszolút URL-hez a `requestOrigin()` kell;
   - a build a root layoutot a DB-n prerendereli, ezért érvényes `DATABASE_URL` kell a build előtt;
   - a boxon a storage root más fájlrendszeren van, mint a temp, ezért `copyFile` kell, soha `rename` (EXDEV);
   - helyben épített build megölte az élő appot, ezért van a `.next-build`;
   - a boxon telepített script egyszer elcsúszott a repóétól, ezért van a `cmp` védelem.

### Memória
- `project_next_origin_behind_nginx.md` → egysoros mutató az AGENTS.md Deploy szakaszára (a tartalma teljesen átkerül).
- `project_mcp_per_user_tokens.md`: csak a „Deploy coupling” mondat helyére jön egy mutató. Az MCP-token tényei maradnak.
- `reference_hetzner_box.md` → egysoros mutató az infra-map Box B-re és az AGENTS.md Deployra. **Csak akkor, ha az 1–2. hiányzó tény bekerült az infra-mapbe.** Addig a két sor a jegyzetben marad, különben elvesznek.
- A `MEMORY.md` index sorai ennek megfelelően.

### Szeletek
- [x] **S1** AGENTS.md „Deploy” szakasz (1–8), plusz a két helyi port lecserélése infra-map-hivatkozásra (ha Robi jóváhagyja).
- [x] **S2** Ellenőrzés:
  - `grep` a fájlon IP-re, `root@`-ra, `/var/www`-ra, `/opt`-ra, `.ssh`-ra és szerverportra: nulla találat;
  - Codex-próba: vissza tudja-e mondani a sorrendet és a migrációs szabályt.
- [x] **S3** Memória: a fenti 3 jegyzet és a `MEMORY.md`.
- [x] **S4** Commit: csak az `AGENTS.md` és a saját todo-hunk. Push csak Robi go-jára. Nincs bump. (`7238029`, pusholva)
- [ ] **Robinak / a Learning sessionnek:** a 7 hiányzó box-tényt az infra-map gazdája vegye fel. Én a globális fájlt nem szerkesztem.

### Review (2026-11-22) — Robi: „Mehet”
- **AGENTS.md:** új „Deploy” szakasz az 1–8. pont szerint. A két helyi port helyett hivatkozás az infra-map „Mac” szakaszára.
- **Ellenőrzés:**
  - `grep` IP-re, `root@`-ra, `/var/www`-ra, `/opt/`-ra, `/mnt/`-re, `.ssh`-ra, a kulcsnévre és a szerverportokra (5432/5433/55432/6001/6002/9000): nulla találat.
  - Codex, fájlolvasás nélkül, helyesen visszamondta: a Telekom megy elsőnek; migrációnál pull, `db:migrate` a `.env`-ből, aztán deploy, additívan; sikeres deploy után `git revert`, push, újradeploy, mert a `.next-old` már nincs meg.
- **Memória:**
  - a `project_next_origin_behind_nginx` mutató lett;
  - a `project_mcp_per_user_tokens` deploy-mondata mutató lett;
  - a `reference_hetzner_box` mutató lett, de a kulcs eredetéről szóló és a Docker-verziós sor benne maradt, amíg az infra-map fel nem veszi őket;
  - a `MEMORY.md` index frissült.
- **A 7 hiányzó box-tény** ment a Learning sessionnek. Az infra-mapet nem szerkesztettem.

## 2026-11-22 — Nyitott kérdések lezárva; `docs/` → Drive; todo archiválás; a régi MinIO volume (TERV, Robi jóváhagyására vár)

Robi (2026-11-22): „szándékos volt, mérlegeljük, nem kell flex webm, open működik, mini mehet törlésre kukába a régi mini IO volume, maradjon, csináljuk a docs mozgatást és frissítsük archiváljuk a todo-t”.

### Lezárva (Robi döntése, 2026-11-22)
- A 3 MC288a sor törlése szándékos volt.
- Flex-WebM változat nem kell.
- A `?open=` élesben működik (Robi kipróbálta).
- A `.claude/settings.local.json` széles wildcardja marad.

### Mit érint
- **Szemantikai modell:** nincs. Ez dokumentum- és tárhely-szervezés, az app viselkedését nem érinti. Szabály: a globális „Repo = code, Drive = documents” (2026-10-16), és az AGENTS.md „Meaning” és „Where plans live” része.
- **A) `docs/` → Drive:** kétirányú ajtó. Az eredetik a Kukába mennek, onnan visszahozhatók. A Drive egy rclone mounton (`gdrive:`) át íródik.
- **B) todo archiválás:** kétirányú (`git revert`).
- **C) a MinIO volume törlése:** **egyirányú.** A `docker volume rm`-nek nincs kukája, a 7,9 GB végleg eltűnik.
- **D) npm-audit ág:** a jegyzet átvétele kétirányú. Az ág commitja (`378caa3`) a törlés után még a reflogban marad.

### A) `docs/` → Drive (26 fájl, megnézve 2026-11-22)
| Hova | Mi |
|---|---|
| `~/GoogleDrive/Data/MessagingMatrix/mm6-docs/` (új) | 12 .md: REBUILD_SPEC, MM6_PURPOSE_STATE_CAPABILITIES, MM6_MCP_E2E_TEST, PLATFORM_STRUCTURE_FILES, REPORT_RECONCILIATION_STUDY, SZALLASHU_DEMO_STUDY, TELEKOM_DEMO_STUDY, TENANT_FORK_STRATEGY, ICON_SET_STUDY, BUGHUNT_2026-08-25…, mc-collisions.md, variant-splits.md. Plusz a `mc-collisions.html` és a 2 AdForm-képernyőkép (jpg). |
| `~/GoogleDrive/Data/ERSTE HU/_messagingmatrix.ai/mm6-docs/` (új) | 9 xlsx: az ERSTE „15 March” mátrix, Creative rep 04 és 05, Erste_Vallalkozo, adfrom_current_SZK_feed, erste-SZK-feed v1-27 és v1-28, orphan-mcs, mc-export. |
| Kukába, másolás nélkül | `MM6_SYSTEM_OVERVIEW.md`: bájtra azonos a Drive-on lévővel (`cmp`). `~$ERSTE….xlsx`: 165 bájtos Excel-zárfájl. |

- **Miért új almappák:** az rclone mount a Google Sheeteket 0 bájtos `.xlsx`-ként mutatja, és a MessagingMatrix gyökerében már van egy natív Sheet ugyanazzal a névvel, mint az ERSTE „15 March” fájl. Új mappában nem lehet névütközés.
- **Menet fájlonként:**
  1. `cp -p`, aztán `cmp`.
  2. A Drive connectoron ellenőrzöm, hogy a fájl ott van és a mérete egyezik. Ez bizonyítja a feltöltést, nem csak az rclone cache-t.
  3. Ezután megy az eredeti a `~/.Trash`-be.

  A `docs/` üresen és gitignore-olva marad.
- **Repo-hivatkozások, fájlonként:**
  - `AGENTS.md`: a meaning-dokumentumok útvonalai, a `docs/` mondat és a REBUILD_SPEC sor;
  - `tests/README.md` (2 sor), `scripts/recon/README.md` (1 sor);
  - `src/app/_icons/core-map.ts` (csak komment).
- **A scriptek nem változnak:**
  - a `gen-*` scriptek továbbra is a `docs/`-ba írnak, az most munkamappa;
  - az `import-erste`, a `reimport-media` és a `seed-keywords` kapcsolóval kapja az xlsx útvonalát;
  - az `import-erste-sample`-nek nincs ilyen kapcsolója, és az alapútvonala megszűnik. Ez egy 2026-05-ös, régi script.
- **Memória:** `reference_spec.md`, `reference_docs_dir.md`.
- **Előrejelzés:** a `src/`-ben nincs olyan futásidejű olvasás, ami a `docs/`-ból olvasna (`grep`: csak a core-map.ts kommentje). Útvonal nélkül a fenti scriptek „file not found” hibát adnak. A `tsc` nem változik.

### B) todo.md: frissítés és archiválás (most 3585 sor, az archív 6173)
- **B0, Robi dönt.** A másik session EPIC CA részei 2026-11-20 óta nincsenek commitolva. Az egyik a 201. sornál van (+72 soros terv), a másik a 2010. sornál (a régi R-terv fejléce „FELÜLÍRVA”). A 2010-es abban a 2026-09-16-os szakaszban van, amit archiválnék.
  - **Ajánlás:** a saját nevükön, külön commitban commitolom őket („docs(todo): EPIC CA terv, 2026-10-27, jóváhagyásra vár — másik sessionből”), és csak utána archiválok.
  - **Alternatíva:** a 2026-09-16-os „Ügynökségi riportok” szakasz a todo-ban marad, amíg az a session nem commitol.
- **B1, archívba szó szerint** (a végére, „Archivált 2026-11-22” fejléc alá):
  - minden checkpoint 2026-11-12 előttről (most a 478–3198. sor);
  - a roadmap lezárt tételeinek törzse (✅, KIVEZETVE, ELVETVE: Telekom instance, Box deploy 6.83.0, D Design tab, D8, P, M1, M7, M8, MCP draft scope); a fejlécük és egy pointer marad;
  - a D) pont npm-audit jegyzete.

  Ellenőrzés: egy script összeveti a kivett szöveget az archívba írttal, és a kettőnek egyeznie kell.
- **B2, frissítés:**
  - „Jelen állapot (2026-09-10)” → 2026-11-22: a 6.132.0 fut mindkét tenanton;
  - az archivált rész nyitott tételei egy-egy soros pointerrel a roadmapbe kerülnek: H1–H16 riport-egyeztetés (R1–R6-ot az EPIC CA felülírta), react-hooks és Turbopack tech-adósság, a „Filter to these” éles próbája;
  - a D) pont két nyitott javaslata;
  - kipipálom, ami kész: a 6.131.0 bump és deploy, a BlackFriday Refresh, a két S4 commit, és a C) után a MinIO;
  - a fenti „Lezárva” döntések.
- **AGENTS.md:** az archív leírása („2026-04 → 2026-07, ~4000 lines”) az új állapotra frissül.
- **Előrejelzés:** a todo.md kb. 700–800 sor lesz, és egy nyitott tétel sem tűnik el pointer nélkül.

### C) A régi MinIO volume — VÉGLEGES törlés
Box B, csak olvasva, 2026-11-22:
- `supabase-mm6_mm6-minio-data`: 7,9 GB a `/`-n, 2026-06-28-án jött létre.
- Egyetlen konténer sem hivatkozik rá (`docker ps -a --filter volume=`). A `supabase-mm6-minio` konténer a bind mountról fut (`/mnt/HC_Volume_104001329/minio`).
- Kulcsonkénti összevetés: a régiben 22 754 objektum van, az élőben 22 862. **A régiből egy sem hiányzik az élőből.** A régibe 2026-10-31 óta semmi nem írt.
- A `/` most 68%-os (25G/38G), utána kb. 47% lesz.

Teendők:
- [ ] `docker volume rm supabase-mm6_mm6-minio-data`. **Ennek nincs kukája,** a „kukába” itt végleges törlést jelent.
- A compose fájl még deklarálja a `mm6-minio-data:` volume-ot (83. sor), de egy szolgáltatás sem csatolja. Egy `docker compose up` legfeljebb egy üres volume-ot hozna létre. Nem nyúlok hozzá.
- Utána: `df`, a MinIO `/minio/health/live` 200-at ad, a `/login` 200-at ad mindkét tenanton.
- Az infra-map 169. sorát (rollback-pont) a gazdája frissíti: a Learning sessionnek jelzem.

### D) npm-audit ág (`claude/festive-galileo-ac1dfd`) — mérlegelés
- Egyetlen commit van rajta (`378caa3`, 2026-11-04), csak `tasks/todo.md` +36 sor, kódváltozás nincs. Ez az npm audit elérhetőségi vizsgálata, amit a CA a 3182. sorban 2026-11-06-ra kért. Eredménye: a zod élesben csak auth után érhető el; egy belépett felhasználó vagy egy `full` token egyetlen kéréssel OOM-ba viheti a saját tenantja folyamatát; a többi csomag nem érhető el.
- 12 committal le van maradva a main mögött.
- **Ajánlás:** nem git-merge. A jegyzetet szó szerint átveszem a B1-gyel, a két javaslatát (kis fix, illetve JSON-méretkorlát) a roadmapbe teszem, aztán törlöm a worktree-t (tiszta) és a helyi ágat.
- **A mai állapot:** a sérülékeny verziók még futnak. Helyben ezek vannak fent: `zod 4.4.1`, `body-parser 2.3.0`, `qs 6.16.0`, `fast-uri 3.1.8`, `ip-address 10.7.3`, és a `package-lock.json` a 6.128.3 óta nem változott. A kis fix (`npm update …`, zod `^4.6.6`) egy függőség-patch deployjal együtt, ezért külön feladat.

### Szeletek
- [x] **S1** B0: az EPIC CA részek külön commitban, ha Robi így dönt.
- [x] **S2** A: másolás, `cmp`, Drive-ellenőrzés, Kuka; a repo-hivatkozások egyenként; memória.
- [x] **S3** B és D: archiválás az ellenőrző összevetéssel, frissítés, az npm-audit jegyzet átvétele; a worktree és az ág törlése.
- [x] **S4** C: a volume törlése, utána ellenőrzés.
- [x] **S5** Commit: `AGENTS.md`, `tests/README.md`, `scripts/recon/README.md`, `core-map.ts` (komment), `todo.md`, `todo-archive.md`. Push csak Robi go-jára. Bump nincs, mert ez doksi és tooling.
- A CA-review nem kell: egyik felsorolt kategóriába sem esik. Ha Robi kéri, a C) előtt kérek.

### Review (2026-11-22) — Robi: „Mehet, törléssel”
- **S1:** az EPIC CA két része `de31a8c`-ben, a tartalmuk változatlan. A working tree-ben ezután csak a saját változásaim maradtak.
- **S4, MinIO:**
  - `docker volume rm supabase-mm6_mm6-minio-data` lefutott, a törlés előtt 0 konténer használta.
  - A `/` 68%-ról (25G) 46%-ra (17G) ment le.
  - Utána: a MinIO `/minio/health/live` 200, az erste és a telekom `/login` 200, az élő tárolóban 22 862 objektum (ugyanannyi, mint előtte).
- **S2, `docs/`:**
  - 24 fájl került a két új `mm6-docs/` mappába, mindegyiknél `cmp` egyezés. A Drive API-n mind a 24 fájl megvan egyező mérettel, duplikátum nincs.
  - A 26 eredeti a `~/.Trash/mm6-docs-2026-11-22/` mappában van.
  - **Menet közben:** a `cp -p` az rclone mounton (macfuse) xattr-hibát adott, és az xlsx-eknél a tartalmat sem írta végig. A fájlokat `cat`-tel újraírtam, és csak ezután jött a `cmp` és a Drive-ellenőrzés.
  - Repo-hivatkozások: `AGENTS.md`, `tests/README.md`, `scripts/recon/README.md`, `core-map.ts` (komment).
  - Memória: `reference_spec.md`, `reference_docs_dir.md`, `MEMORY.md`.
- **S3, todo:**
  - 3674 → 773 sor a scripttel, ezzel a review-val együtt kb. 810. Az archívba 2965 sor került (most 9137 sor).
  - A script minden tartomány első és utolsó sorát ellenőrizte, és bizonyította, hogy a kivett sorok sorrendben, egyezően az archívban vannak.
  - **Eltérés a tervtől:** a Telekom instance szakasza a todo-ban maradt, mert élő szabály van benne (a `../mm6-telekom` worktree és a G2/G3 routing). Ehelyett a D6–D8 szakasz ment, mert mindhárom tétele lezárult.
  - A nyitott tételek mutatói: „Session checkpointok” (H1–H16, Next 16 tech-adósság, Assets → Share éles ellenőrzés, „Filter to these”), TECH-ADÓSSÁG (npm audit két javaslata, MCP `scope` check constraint).
  - A 3064–3070. sor (share nézet linkben) nem nyitott, a 6.126.0 leszállította.
- **D:** az npm-audit jegyzet az archív C) részében van, szó szerint. A worktree tiszta volt, eltávolítottam; a `claude/festive-galileo-ac1dfd` ág törölve (`378caa3`, a reflogban még megvan).
- **Tanulság (javaslat):** az rclone mountra `cp -p` helyett `cat src > dst` és `cmp` kell; ez most a `reference_docs_dir` memóriában van. Ha gyakran kell, egy kis `scripts/`-mentes shell-függvény a Drive-ra másoláshoz. Robi dönt.

## 2026-11-23 — Függőség-patch: az `npm audit --omit=dev` találatainak zárása (TERV, Robi jóváhagyására vár)

Kérés: egy másik session adta át. Ez a 2026-11-04-i vizsgálat kis fixe (archív „Archivált 2026-11-22” C), roadmap: TECH-ADÓSSÁG → „npm audit”). Az alapos fix (JSON-méretkorlát, `.max()` a 18 tömbre, alacsonyabb nginx-limit) nem része, csak follow-up.

### Mai állapot (megfigyelve, 2026-11-23, helyben)
- **Az audit most 7 találatot ad, nem 5-öt** (2 high, 5 moderate). A 11-04-i öt mellé két új jött, mindkettő moderate, és mindkettő az MCP SDK (`@modelcontextprotocol/sdk` 1.32.1) függősége:
  - `hono` ≤4.13.15, 5 advisory (helyben 4.13.13);
  - `@hono/node-server` 2.0.0–2.1.5, 2 advisory (helyben 2.1.4).
- Telepítve: zod 4.4.1, body-parser 2.3.0, qs 6.16.0, fast-uri 3.1.8, ip-address 10.7.3, iconv-lite 0.7.2. A `package-lock.json` a 6.128.3 óta nem változott. A zod-ot használó kód (`mcp.ts`, `mcp/tools`, a három `messages/bulk-*` route) sem változott 11-04 óta (`git log`).
- **A hono elérhetősége:** az SDK-ban csak a Node-os `server/streamableHttp.js` és egy példa importálja. Az mm6 két belépőpontja a `server/mcp.js` és a `server/webStandardStreamableHttp.js`. Ezek statikus import-gráfja 18 fájl, és nincs benne hono, express vagy `streamableHttp.js`. Csomag csak öt van benne: ajv, ajv-formats, content-type, zod, zod-to-json-schema. Élesben tehát valószínűleg nem töltődik be. A box bundle-jét nem néztem meg.
- **Szimuláció a lock másolatán** (`npm update … --package-lock-only`, `npm audit --omit=dev --package-lock-only`):
  - **(A) csak az öt csomag:** zod 4.6.7, body-parser 2.4.0, qs 6.17.1, fast-uri 3.1.9, ip-address 10.7.6, iconv-lite 0.7.3 (a body-parser alatt). Ez pontosan a 11-04-i jóslat. Utána **2 moderate marad** (hono, @hono/node-server).
  - **(B) az öt + `hono @hono/node-server`:** ugyanez, plusz hono 4.13.20 és @hono/node-server 2.1.11. Az audit **0 találatot ad**. A lock diffje 60 sor: ez a 9 csomag, plusz a lock gyökér-verziója (6.128.3 → 6.132.0, a `package.json`-hoz igazodik).
- **Engines:** minden célverzió fut a box Node 20.20.2-jén (`@hono/node-server` ≥20, body-parser ≥18, a többi lazább).
- **Frissesség:** a hono 4.13.20 tegnap jelent meg (2026-11-22), a @hono/node-server 2.1.11 2026-11-20-án. Az első javító verziók régebbiek: hono 4.13.16 (11-01), @hono/node-server 2.1.6 (11-02). Az `npm update` a tartomány legújabbját hozza; a régebbit csak `overrides`-szal lehetne rögzíteni, ezt nem ajánlom.
- **A zod-advisory** (GHSA-mrhx-c7xc-m3w5, 2026-10-01): a `$ZodArray` minden hibás elemre külön issue-t gyűjt, plafon és korai leállás nélkül. Ez a hossz-korlát nélküli tömbökre vonatkozik, 4.6.6 javítja.
- **Mérés a zod 4.4.1-gyel** (a `bulk-copy` séma másolata, csupa hibás elem, Node 24, 2 GB heap):
  - 1 MiB: 524 288 issue, +553 MB heap, 742 ms;
  - 4 MiB: 2 097 152 issue, +1556 MB heap, 2,9 s.
  - Ez egyezik a 11-04-i számokkal. Ugyanezt a mérést a frissítés után is lefuttatom: ebből derül ki, hogy a patch tényleg zárja-e a mi sémáinkon az OOM-utat, vagy ahhoz az alapos fix kell.

### Robi döntése (ajánlással)
- **H1:** a hono is bekerüljön? **Ajánlás: igen, (B).**
  - Ugyanaz a mechanizmus: tranzitív patch az SDK tartományán belül.
  - A „kész” feltétele az audit 0.
  - Élesben a hono valószínűleg be sem töltődik, ezért a friss verzió kockázata kicsi.
  - Ha nem: (A), és a 2 moderate marad.

### Terv
**Touches:**
- `package.json`: zod `^4.4.1` → `^4.6.6`.
- `package-lock.json`: 6 (A) vagy 8 (B) csomag, plusz az iconv-lite.
- Alkalmazáskód nem változik.
- Ahol a zod fut: az MCP végpont (`src/app/mcp/route.ts`, `src/lib/mcp.ts`, a toolok `inputSchema`-ja és az SDK), a `src/app/api/mcp/tools` (Settings → MCP leírás `z.toJSONSchema`-val) és a három `messages/bulk-*` route.
- Szemantikai modell nincs. A meaning-dokumentumok (REBUILD_SPEC 2026-09-06, PURPOSE 2026-09-06) nem szólnak a függőségekről, ez megállapítás.
- Forrás: a 2026-11-04-i vizsgálat (archív C) és `~/.agents/standards/dependencies.md`.

**Door:**
- A commit kétirányú (`git revert`).
- A deploy (külön lépés) szintén kétirányú: revert, push, `mm6-deploy`. A lockfile változása miatt a script `npm ci`-t futtat.
- Hatósugár: minden zod-validált bemenet mindkét tenanton. Migráció és adatváltozás nincs.

**Prediction:**
- `npm audit --omit=dev`: 0 találat (B), illetve 2 moderate (A).
- `tsc`, eslint, vitest: ugyanaz, mint a baseline. A baseline most fut a régi függőségekkel, a száma ide kerül.
- Ismeretlen: a zod 4.4 → 4.6 minor emelés változtat-e a típus-inferencián, a hibaüzenetek alakján vagy a JSON Schema kimeneten.
- Ami nem változhat: az MCP `tools/list` válasza (52 tool, `scope: full`), mert az agentek ezt látják. A régi zod-dal már lementettem a baseline-t.

**Seam:**
- `npm audit --omit=dev`.
- A repó saját ellenőrzései.
- Az MCP `tools/list` JSON-ja, régi és új zod-dal összevetve. Scratch-script `InMemoryTransport`-tal, a teszt-DB URL-jével, handler nem fut.
- A zod-memóriamérés a frissítés előtt és után.

**Szeletek:**
- [x] **S1** `npm pkg set dependencies.zod='^4.6.6'`, `npm update zod body-parser qs fast-uri ip-address` (B esetén `hono @hono/node-server` is). Utána `npm audit --omit=dev`, `npm ls` a régi verziók nélkül, és a lock diffje csak a várt csomagokat tartalmazza.
- [x] **S2** `npx tsc --noEmit`, eslint és `npm test` (a `mm6-test-pg` fut), a baseline-hoz mérve. Ugyanitt a `tools/list` diff és a zod-mérés.
- [x] **S3** CHANGELOG az `[Unreleased]` alatt. Verziójavaslat: 6.132.0 → 6.132.1 (patch); a bump csak Robi szavára. Commit a saját ágon: `package.json`, `package-lock.json`, `CHANGELOG.md`, a saját todo-szakasz. Push nincs. Commit előtt rebase a `main`-re, mert egy másik session a todo-t archiválja.
- [ ] **S4** Deploy-terv Robinak, nem futtatom:
  - planning review (CA + Codex) a commit után;
  - push;
  - `telekom`, utána `erste`, mindegyik Robi külön go-jára;
  - a boxon `npm ci` fut (lockfile változott), ezért az idő és a memória is nagyobb lehet;
  - utána a boxon `npm ls zod hono` és `npm audit --omit=dev`, plusz az AGENTS.md „After” lista.

### Eredmény (2026-11-23) — Robi: „Yes, B”
- **S1:**
  - `npm audit --omit=dev` → **found 0 vulnerabilities**.
  - A `package-lock.json` bájtra azonos a szimulált (B) lockkal: 60 soros diff, csak a 9 várt csomag.
  - `npm ls` tiszta. Az új verziók: zod 4.6.7, body-parser 2.4.0, qs 6.17.1, fast-uri 3.1.9, ip-address 10.7.6, iconv-lite 0.7.3 (a body-parser alatt), hono 4.13.20, @hono/node-server 2.1.11.
  - A `package.json`-ban csak a zod sora változott (`^4.6.6`).
- **S2, a repó ellenőrzései** (előtte a régi függőségekkel is lefuttatva, baseline):
  - `tsc --noEmit`: tiszta, előtte és utána is.
  - eslint: 0 hiba, 146 warning; a kimenet bájtra azonos a baseline-éval.
  - vitest: 120 fájl, 1119 teszt zöld, előtte és utána is.
  - A jóslat teljesült. Az ismeretlen (típus-inferencia, hibaüzenet-alak, JSON Schema) nem okozott eltérést.
- **MCP `tools/list`:** a régi és az új zod-dal **bájtra azonos** (52 tool, `scope: full`, 65 308 bájt). Az agentek ugyanazokat a sémákat látják.
- **zod-mérés** (a `bulk-copy` séma másolata, csupa hibás elem, Node 24, 2 GB heap):

  | Törzs | zod 4.4.1 | zod 4.6.7 |
  |---|---|---|
  | 1 MiB | 524 288 issue, +553 MB, 742 ms | 524 288 issue, **+190 MB**, 173 ms |
  | 4 MiB | 2 097 152 issue, +1556 MB, 2,9 s | 2 097 152 issue, **+931 MB**, 713 ms |
  | 10 MiB | (nem mértem) | **OOM**, a folyamat leáll (exit 134) |
  | 4 MiB, `.max(1000)` a tömbökön | (nem mértem) | **2 issue, 0 MB, 1 ms** |

  - **Következtetés:** a 4.6.7 hibás elemenként továbbra is egy issue-t gyűjt a hossz-korlát nélküli tömbön. Kevesebb memóriát és időt visz, de 10 MiB-nál még mindig OOM.
  - Az MCP-t az SDK 4 MiB-ra korlátozza. A 4 MiB-os kérés +931 MB-ot foglal, ez a pm2 `max_memory_restart` értéke (erste 900 MiB, telekom 700 MiB) fölött van, így valószínűleg újraindítást vált ki. Ezt nem mértem a boxon.
  - A REST `bulk-*` route-okat csak az nginx 200M-ja korlátozza, ott az OOM-út nyitva marad.
  - A `.max()` a 4.6.7-ben korán leáll, tehát az alapos fix (`.max()` a 18 tömbre plus JSON-méretkorlát) hatásos. **Ez follow-up, nem része ennek a változásnak.**
- **A teljes `npm audit` (dev is):** 16 találat (3 critical, 13 moderate), mind dev-függőség, ez nem része a feladatnak.
  - critical: `vitest` 3.2.4 és `@vitest/ui`, a `tinypool`-on át; a javítás a vitest 4.x-ben van, ez major. A Vitest UI szerver futása közben érinti a fejlesztői gépet.
  - moderate: `drizzle-kit` (az esbuild-kit/esbuild láncon), `typescript-eslint` (minimatch), `postcss-selector-parser`.
  - Élesbe egyik sem kerül, a `--omit=dev` szerint.

### S4 Deploy-terv (nem futtattam; minden lépés Robi külön go-jára)
1. ✅ **Bump** (Robi: „Yes, bump”, 2026-11-23): 6.132.0 → 6.132.1 (patch), `npm version --no-git-tag-version`. A `package.json` és a lock két gyökér-verziója változott, a CHANGELOG-ban a bejegyzés a `[6.132.1] — 2026-11-23` alatt van. Saját commit ezen az ágon.
2. **Rebase a `main`-re**, utána Robi merge-el. Egy másik session a todo-t archiválja a `main`-en.
3. **Planning review** (Robi: „Yes, request review”, 2026-11-23; a CA webhook 200, a Codex fut):
   - request: `~/agent-bus/requests/20261123-1145-mm6-6.132.1-deps-patch-deploy.md` (cél, diff, a fenti mérések, rollback, 3 nyitott kérdés: `npm ci` az élő app alatt, a hono frissessége, Node 20 EOL);
   - CA webhook és `codex exec -s read-only`;
   - „Stop” esetén nincs deploy.
4. **Push** az `origin main`-re.
5. **Pre-flight a boxon:**
   - szabad lemez és memória;
   - mindkét tenant HEAD-je, ez a rollback-pont;
   - a deploy-script egyezik-e a repóéval.
6. **`mm6-deploy telekom`.**
   - A lockfile változott, ezért a script a build előtt `npm ci`-t futtat. Utoljára 2026-09-12-én mértük: 702 csomag, 30 s.
   - Közben a memóriát mintavételezem. Ha az elérhető memória ~120 MB alá esik, leállítom a `next build`-et.
   - ⚠️ Az `npm ci` az élő app alatt cseréli a `node_modules`-t. Ha ezután a build bukik, a régi `.next` az új `node_modules`-szal szolgál ki, amíg egy deploy sikerül vagy a lock visszaáll (a script megjegyzése is ezt írja, 54–56. sor). Patch-szintű tranzitív emelésnél ezt elfogadhatónak tartom.
7. **Ellenőrzés utána (telekom):**
   - HEAD a pusholt commit, a `package.json` 6.132.1;
   - a boxon `npm ls zod hono @hono/node-server body-parser` az új verziókat mutatja, és `npm audit --omit=dev` 0;
   - pm2 online, a restart-szám csak eggyel nő;
   - `/login` 200, `POST /mcp` token nélkül 401;
   - az error logba nem jön új sor;
   - nem maradt `.next-old` vagy `.next-build`;
   - `/_next/image` 404.
8. **`mm6-deploy erste`**: ugyanez, plusz egy share oldal 200 (ez a view count-ot 1-gyel növeli).
9. **Rollback:**
   - Ha a build bukik, semmi nem cserélődik, de a `node_modules` már az új (lásd 6.).
   - Ha az app nem jön fel: a `.next-old` visszacserélése, `pm2 restart`, `mm6-maint off <tenant>`.
   - Sikeres deploy után: `git revert`, push, `mm6-deploy`. A régi lock miatt ez újra `npm ci`-t futtat.
   - Migráció nincs.

### Follow-upok (nem ebben a változásban)
- **Alapos fix (Robi dönt):** `.max()` a 18 tömbre és korlátos JSON-olvasó, vagy alacsony nginx-limit a feltöltések kivételével.
  - A fenti mérés szerint a zod 4.6.7 a `.max()`-os tömbön korán leáll.
  - Korlát nélkül 10 MiB-nál még OOM.
  - A REST `bulk-*` route-okat ma csak az nginx 200M-ja korlátozza.
- **Dev-audit:** a vitest 3 → 4 (major), plusz a drizzle-kit és a typescript-eslint lánca. Külön feladat, a `dependencies.md` szerint ütemezve.

### Planning review — Chief Architect: OK with changes (`~/agent-bus/answers/20261123-1145-mm6-6.132.1-deps-patch-deploy.md`)
- **Beépítve:**
  - **(8)** A CHANGELOG nem állítja, hogy a patch zárja az OOM-utat. A bejegyzés kimondja, hogy a hibás elemű nagy tömb validálása továbbra is memóriát visz (a régi 34–60 %-át, mérve), és ezt a külön body-size limit zárja.
  - **(5)** A todo-változás commitolva; a merge pontosan a saját commitjaimat viszi.
  - **(2, opcionális)** `npm view … dist.attestations`: a hono 4.13.20 és a @hono/node-server 2.1.11 SLSA provenance-szal jött, a GitHub Actions trusted publisher a `honojs/hono` és a `honojs/node-server` repóból. Az `npm audit signatures` 728 csomag registry-aláírását igazolta, ebből 139-nek attestation-je is van. `overrides` nincs, a legújabb marad.
- **A deploy-tervbe (S4) kerül:**
  - **(1)** Az `npm ci` előbb törli a `node_modules`-t. A telepítés ablakában egy lusta `require` vagy dinamikus import (egy route chunk első hívása) `MODULE_NOT_FOUND`-ot dobhat. Ezért off-peak megy, és az `npm ci` alatt a pm2 error logot figyelem. Ha ilyen sor jön, az a következő szelet (telepítés mellékkönyvtárba + csere), nem most.
    - ⚠️ Eltérés: az AGENTS.md szerint napközben is mehet. Ez a lockfile nélküli deployokra igaz; az időpontot Robi dönti el.
  - **(2)** A build után a boxon `grep -rl 'hono' .next/server`: a hono nincs a bundle-ben. Ezzel zárul a nyitott rés.
  - **(4)** Egy ellenőrzés, ami tényleg zod-ot futtat a boxon (a 401-es próba nem éri el):
    - bejelentkezett `tools/list` = 52 tool;
    - egy tool-hívás hibás payloaddal validációs hibát ad. A Codex a másik terv kapcsán megfigyelte, hogy ez HTTP 200, `result.isError: true` alakban jön.
    - Token kell hozzá. Robi futtatja, vagy a meglévő mm6 MCP connectorral, ha az ezen a tenanton van. Tokent nem kezelek.
  - **(6)** A pre-flight mindkét tenant HEAD-jét **és** a régi `package-lock.json` sha256-ját rögzíti. Az `npm ci` miatt ez a valódi rollback-pont.
  - **(3)** A Node 20.20.2 → 24.x (TIP-061, EOL) és a Next 16.4.6 nem ide tartozik. A Node-csere a következő, külön szelet.
  - **(7)** A memória-őr 120 MB-nál rendben van.

### Planning review — Codex: OK with changes (`~/agent-bus/answers/20261123-1145-mm6-6.132.1-deps-patch-deploy.codex.md`)
- **Ütközés a CA-val, Robi dönt:**
  - Codex: maintenance oldal fel és a tenant leállítása az `npm ci` előtt.
  - CA: az `npm ci` mehet az élő app alatt, off-peak, a pm2 error logot figyelve.
  - **Ajánlás: a CA-é.** Precedens: a 6.128.4 (2026-11-11, Next 16.4.5) pontosan így ment mindkét tenanton, `mm6-deploy`-jal, csendes időszakban. Az error log üres maradt, az `npm ci` alatt is (archív, ~9059. és 9076. sor).
  - A Codex változata a scripten kívüli kézi lépéseket kívánna (a script maga futtatja az `npm ci`-t, a lock-jelölőt is ő írja).
  - A mechanizmus-javítás (telepítés mellékkönyvtárba + csere, vagy a gate az `npm ci` elé) külön szelet, ahogy a CA javasolja.
- **Beépítve a deploy-tervbe:**
  - **Teljes rollback** (a 6.128.4-es lockfile-mozgató terv szerint, archív ~9079. sor). Ha az app nem jön fel:
    1. a boxon `git reset --hard <régi HEAD>`;
    2. `npm ci` (a régi lockkal);
    3. a `.next-old` vissza;
    4. `pm2 restart`;
    5. `mm6-maint off`, csak ha a `/login` 200.
    - Ha a régi lockkal az `npm ci` is bukik, a maintenance oldal fent marad, és Robi dönt.
  - **Clean-tree gate:**
    - helyben a working tree tiszta a commit után;
    - a boxon mindkét checkoutban `git status --porcelain` üres a pre-flightban.
  - **SHA és megállás:**
    - a deployolt SHA a review-zott commitok fast-forward merge-e a `main`-re (merge commit nélkül, hogy a box ugyanazt építse);
    - ha a Telekom bármelyik ellenőrzése bukik, az Erste nem megy.
  - **Bejelentkezett ellenőrzés** (egyezik a CA 4. pontjával): `tools/list` a baseline-hoz mérve, és egy share oldal 200 **mindkét** tenanton.
    - Javaslat, tokenkezelés nélkül: ennek a sessionnek a csatolt mm6 MCP connectora full scope-pal 52 toolt lát, ugyanannyit, mint a baseline. Ezen át csak olvasó hívások mennek:
      - előbb `matrix_status`, hogy kiderüljön, melyik tenanté;
      - a tool-szám a deploy előtt és után;
      - `get_mc_preview_files` hibás `sizes` payloaddal → `isError` validációs hiba.
    - A másik tenantot Robi ellenőrzi a saját tokenjével, vagy ott ez kimarad.
  - **Pontosság:** a CHANGELOG már kimondja, hogy a nagy, hibás tömb OOM-útja nyitva marad; a body-limit follow-up él, külön sessionben.
  - **Node:** a Node 20 EOL miatt a 24.x a következő, külön szelet, a meglévő runtime mellé telepítve.
- **Megjegyzés:** a 6.128.4-nél a lock gyökér-verzióját szándékosan nem emelték, hogy egy puszta bump ne indítson `npm ci`-t. Itt a lock úgyis változik (`npm update`), és az `npm version` is emelte. A következő bumpnál a `package-lock.json` verziómezőjét érdemes békén hagyni (`npm version` helyett kézzel a `package.json`-ban).

### 6.132.1 deploy — Robi: „CA but right now, off peak does not make sense presently”
- Robi döntött: a CA változata (`npm ci` az élő app alatt, a script alapértelmezése), és most, nem off-peak.
- [x] Push: `5c939e4..1b3e7ec`, fast-forward a `main`-re. A box ezt a 4 review-zott commitot építi.
- [x] **Pre-flight a boxon** (10:53 UTC):
  - lemez 46%, 1973 MB elérhető memória, 1553 MB szabad swap, Node 20.20.2;
  - a telepített `mm6-deploy` egyezik a repóval (`c3438a49…`);
  - mindkét tenant HEAD-je `9be22f7` (6.132.0), a lock sha256 `94a433f64dfd…`, ez egyezik a jelölővel; ez a rollback-pont;
  - a checkoutokban csak régi, követetlen fájlok vannak (`.env` mentések, `ecosystem.config.cjs`), követett fájl nem változott;
  - az erste error logban 3 régebbi sor 08:04-ről: Server Action-próba („Server Reference ID … Received "x"”). Az mm6-ban nincs Server Action, ez nem ehhez a deployhoz tartozik.
- [x] **DEPLOYOLVA `mm6-telekom`** (10:54 UTC):
  - 105 s, az `npm ci` 45 s (733 csomag);
  - a legkevesebb elérhető memória 897 MB, a swap legfeljebb 1016 MB;
  - az error logba 0 új sor jött, az `npm ci` alatt sem.
  - **Ellenőrzés:**
    - HEAD `1b3e7ec`, 6.132.1, a lock-jelölő egyezik;
    - a boxon `npm ls`: zod 4.6.7, body-parser 2.4.0, qs 6.17.1, fast-uri 3.1.9, ip-address 10.7.6, hono 4.13.20, @hono/node-server 2.1.11;
    - a boxon `npm audit --omit=dev`: 0;
    - `.next/server`: szó szerinti `hono` 0 fájlban; a 12 találat mind „honor/honour” kommentben és egy user-agent regexben, tehát a hono nincs a bundle-ben;
    - nincs `.next-old` és `.next-build`;
    - pm2 online, a restart-szám 2 → 3;
    - `/login` 200, `/_next/image` 404, `POST /mcp` token nélkül 401;
    - a share `3_Ml4cJyfDkA` 200; ez a view count-ot 26 → 27-re emelte.
  - **Bejelentkezett MCP-próba a Telekomon: nem futott,** nincs hozzá token ebben a sessionben. A connector az „ERSTE MessagingMatrix”, 52 toollal.
- [x] **DEPLOYOLVA `mm6-erste`** (10:58 UTC, Robi: „Yes, deploy erste”):
  - előtte 2436 MB elérhető memória, HEAD `9be22f7`, a követett fájlok tiszták;
  - 94 s, az `npm ci` 33 s (733 csomag);
  - a legkevesebb elérhető memória 1351 MB, a swap legfeljebb 1069 MB;
  - a deploy alatt 0 új sor jött az error logba;
  - ugyanaz a 23 Turbopack trace-warning, mint a Telekomnál (ismert tech-adósság).
  - **Ellenőrzés:**
    - HEAD `1b3e7ec`, 6.132.1, a lock-jelölő egyezik;
    - `npm ls`: ugyanazok az új verziók, mint a Telekomon; a boxon `npm audit --omit=dev`: 0;
    - szó szerinti `hono` 0 fájlban;
    - nincs `.next-old` és `.next-build`;
    - pm2 online, a restart-szám 2 → 3;
    - `/login` 200, `/_next/image` 404, `POST /mcp` token nélkül 401;
    - `/share/0FVkKhe4V3H3` 200; ez a view count-ot 1-gyel emelte.
  - **Error log a deploy után:** 3 → 12 sor. A 9 új sor 11:00:18-kor az ismert AWS SDK figyelmeztetés: az SDK 2027 januárja utáni kiadásai `node >=22`-t kérnek, a box `v20.20.2`-n fut. Az első S3-használatkor íródik ki, a korábbi deployoknál is megjelent. Hiba nincs, de ez is a Node-csere mellett szól.
  - **Bejelentkezett MCP-próba** (az „ERSTE MessagingMatrix” connectoron, a deploy előtt és után):
    - a `matrix_status` (2945 MC, 180 audience, 92 topic) és a `list_products` (7 termék) kimenete azonos;
    - a `tools/call` az új buildön zod-validálással fut;
    - a connector 52 toolt lát; ez a session elején lekért lista, a deploy után nem kértem le újra.
  - **Nem futott:**
    - a hibás payloados hívás. A kliensoldal ugyanazzal a sémával validál, így ilyen kérés el sem indul;
    - a bejelentkezett próba a Telekomon.

### Review (2026-11-23)
- **Jóslat és megfigyelés:**
  - az audit 0 lett, helyben és mindkét boxon is;
  - a lockfile pontosan a szimulált;
  - a `tsc`, az eslint, a vitest és a `tools/list` nem változott;
  - a hono nincs a bundle-ben.
- **Amit a jóslat kihagyott:**
  - 11-04 óta két új hono-advisory jött; a terv ezt a mai audit-futásból vette fel, H1 döntéssel;
  - a zod-patch nem zárja a nagy, hibás tömb OOM-útját, csak 34–60%-ra csökkenti. A body-limit follow-up kártyán indult, külön sessionben fut.
- **Az `npm ci` az élő app alatt** mindkét tenanton hibasor nélkül ment (45 s és 33 s). A CA 1. pontja szerinti `MODULE_NOT_FOUND`-ot nem láttam, így a mechanizmus-javításra (telepítés mellékkönyvtárba) most nincs bizonyíték.
- **Tanulság, javaslat** (Robi dönt, hova kerüljön):
  - az `npm version` a `package-lock.json` gyökér-verzióját is emeli;
  - a `mm6-deploy` a lock sha256-ja alapján dönt az `npm ci`-ről, ezért egy puszta bump is `npm ci`-t indít az élő app alatt. A 6.128.4 ezt kézzel kerülte el;
  - helye: egy sor az AGENTS.md „Versioning” részébe: „bump only `package.json`, by hand, not `npm version`”;
  - még jobb, ha ellenőrzés futja magától: a deploy-script csak a `packages` részt hash-elné, a gyökér-verziót nem.
- **Nyitott follow-upok:**
  - body-size limit (fut, `mm6-json-body-limits-and`);
  - Node 20 → 24 (TIP-061);
  - dev-audit: vitest 4 (major).

## 2026-11-23 — Terv: kérés-törzs méretkorlát (az npm-audit „alapos fix”-e) — Robi review-jára vár

Robi 2026-11-23: „indítsd a zod kártyát, és aztán térjünk át az alapos fixre”. A kis fix (`npm update …`) külön sessionben fut (`claude/exciting-leakey-7043bd` worktree), ez a terv nem nyúl a `package.json`-hoz.

**Touches:**
- Komponens: a HTTP route-réteg (`src/app/api/**/route.ts`, `src/app/share/[id]/comments/route.ts`, `src/app/mcp/route.ts`), a közös wrapperek (`withSession` / `withAdmin`, `src/lib/scoped.ts`), az MCP tool-sémák (`src/lib/mcp.ts`; a tömb-limit **operation contract változás**), a három `messages/bulk-*` route sémája, a `deploy/nginx/` snippetek, és a boxon a két tenant nginx vhostja.
- Szomszédok: mögötte a zod-validálás és az entity-réteg; előtte az nginx és (az `/mcp`-n) az SDK saját 4 MiB-os korlátja.
- Dokumentum: `REBUILD_SPEC.md` (Drive `mm6-docs/`, 2026-09-06) §4 Backend API, §4.4 Files & uploads, §4.9a Monitoring ingest. **A spec nem mond semmit a kérés-törzs méretéről**: ez lelet, nem hiány, amit kitalálással töltök ki. A limit értékei új szabály, Robi dönt. Szemantikai modell nincs.

**Mechanizmus (egy mondat):** az appban egyetlen kérés-törzsnek sincs mérethatára, minden route a teljes törzset memóriába olvassa (`req.json()` 31 fájlban, `req.formData()` 4-ben, `req.text()` 1-ben), mielőtt bármit ellenőrizne, és az egyetlen korlát az nginx szerverszintű `client_max_body_size 200M`-je (mindkét vhost, location-szintű felülírás és `limit_req` nincs; a boxon olvasva 2026-11-23). Proxy/middleware fájl nincs, ezért a Next 10 MiB-os `proxyClientMaxBodySize`-a sem érvényes (a `node_modules/next` 16.4.5 kódja szerint csak a proxy-hoz klónozott törzsre hat).

**Testvérek (ugyanez a mechanizmus):**
1. **Új, belépés nélküli:** a `POST /api/render/public` és a `POST /api/auth/login` bármilyen auth vagy ellenőrzés előtt `req.json()`-t hív; a `POST /share/[id]/comments` egy érvényes share-id után (a share-linkek nyilvánosak). Bárki küldhet 200 MB-ot.
   - **Mérve helyben, 2026-11-23** (csak `new Request(…).json()`, Node 24.13.1, nem a teljes app; a box Node 20.20.2): 50 MB → +203 MB heap, 863 MB RSS, 0,5 s; 100 MB → +402 MB heap, 1415 MB RSS, 1,1 s; 190 MB → +761 MB heap, 2149 MB RSS, 2,5 s blokkolt event loop.
   - A pm2 `max_memory_restart` 900 MiB (erste) és 700 MiB (telekom), a box-on kb. 2,2 GB available (2026-11-04-i jegyzet). Következtetés, nem megfigyelés: egy névtelen 100 MB-os kérés valószínűleg pm2-restartot vált ki, néhány párhuzamos kimerítheti a box memóriáját. Élesben szándékosan nem próbáltam (az DoS lenne a production ellen).
2. **Ismert, belépés után:** a zod 4.4.1 `issues`-robbanása (2026-11-04-i mérés, archív C). A kis fix javítja a zod-ot, de a korlátlan tömböket nem.
3. **Feltöltések:** a `req.formData()` a teljes multipart törzset puffereli, és csak utána jön az 50 MB-os ellenőrzés (`files/upload`, `import/xlsx`); az `adform-snapshots` és a `monitoring/import` route-ban méret-ellenőrzés egyáltalán nincs.
4. **Template-írás:** a `PUT /api/templates/[name]/[file]` (admin) `req.text()`-tel korlát nélkül olvas.
5. **Tömbök:** 18 korlátlan bemeneti zod-tömb: az `mcp.ts`-ben 14 (a 17 `z.array`-ből 2 az `outputSchema`-ban van, 1 a `preview_generate` `.max(20)`-a), és a bulk-copy 2, a bulk-move 1, a bulk-delete 1. Ez egyezik a 2026-11-04-i jegyzettel; az első számolásom (20) a két kimeneti sémát is beleszámolta. Az MCP-n a 4 MiB-on belül egy `read` token string-tömbje 1,5 GB heapet foglalt (2026-11-04, archív C).

**Megoldás (v3, a második review-kör után; a gate-ről Robi döntött 2026-11-23: „Ötvözet”):**
- **Él (nginx, a boxon):** szerverszinten `client_max_body_size 1m`; `location ^~ /mcp` 5m (az SDK legfeljebb 4 MiB-ot olvas); horgonyzott regex a négy feltöltési route-ra (`^/api/(files/upload|import/xlsx|adform-snapshots|monitoring/import)$`) 60m (50 MB fájl + multipart-overhead); `^/api/templates/[^/]+/[^/]+$` 5m. A gate és a proxy-fejlécek közös snippetbe kerülnek: `deploy/nginx/mm6-proxy-common.conf`. Ez a repóba mehet, mert nincs benne port; a két maintenance-snippet már ott van, és a boxon lévő példány egyezik a repóéval (`cmp`, 2026-11-23). A vhost-diff portokat tartalmaz, ezért nem kerül a repóba: a review-kérésben van (`~/agent-bus/requests/20261123-1125-mm6-body-size-limit-v2.md`).
- **App, a mechanizmus helye — az „ötvözet”, v3:**
  - A `limitBody(req, maxBytes)` (`src/lib/body-limit.ts`) a `withSession` / `withAdmin` wrapperben **a handler meghívása előtt** olvassa végig a törzset, bájtszámlálóval. A `Content-Length`-előszűrés ezt is megelőzi, még a `readSession` előtt fut.
  - Ha a törzs túllépi a limitet, a wrapper lezárja a forrást, és 413-at ad (`{ error: "payload_too_large", maxBytes }`). **A handler ilyenkor le sem fut, tehát mellékhatás sincs.**
  - A limit alatt a handler egy új `NextRequest`-et kap a már beolvasott bájtokkal. Ebben az eredeti fejlécek (a multipart boundary-vel együtt), a cookie-k, a `nextUrl` és a `signal` is benne vannak.
  - **Miért v3:** a v2-ben a handler a lenyelt limit-hiba után még írhatott. A Codex egy memóriában futó próbával megmutatta: a `POST /api/drafts` 413-at adott, közben a `createDraft` és a `writeAudit` egyszer lefutott (`req.json().catch(() => null)` → `{}` → `createDraft`). A CA ugyanezt jelezte; szerinte kb. 75 `.catch`-es body-olvasás van a kódban.
  - A v3-ban a túlcsordulás el sem jut a handlerig, ezért nem kell külön hibatípus vagy jelző, és a wrapper nem nyúl a válaszhoz (az `/mcp` SSE-streamjéhez sem).
  - Ára egy másolat a limitig (alapból 1 MiB; a feltöltéseknél 60 MiB, amit a `formData()` ma is a memóriában tart).
  - 411 nincs. `Content-Length` nélkül a gate a limitig olvas, és csak utána utasít el.
  - A `withSession` / `withAdmin` alapból 1 MiB; `{ maxBodyBytes }` opció a négy feltöltéshez (60 MiB) és a template-íráshoz (5 MiB). A három nyilvános route és az `/mcp` közvetlenül hívja. GET/HEAD és törzs nélküli kérés kimarad. A 31 + 5 (`entity-route.ts`) hívási hely nem változik.
  - Az első héten minden app-413 naplózódik route-tal és bájtszámmal (CA). Az nginx 413-ai az nginx access logban látszanak (status 413).
  - Prototípus (v2, helyben, a Next 16.4.5 `NextRequest`-jén): a bájtszámláló 1,13 MiB után megáll, és lezárja a forrást; a limit alatt a JSON, az UTF-8 és a multipart ép marad. A route-runtime-ban még nem próbáltam, ezt S0 mutatja meg.
- **Tömbök: sima `.max(n)` a javított zodon, `boundedArray` nélkül.**
  - A v2-es `boundedArray` (`z.unknown()…pipe(…)`) a Codex szerint az MCP `tools/list`-ben `"sizes": {}`-t hirdetne: a tömb-típus és az elem-séma elveszne. A Settings → MCP másik konverziót használ, ezért ott nem látszana.
  - **Helyben megfigyelve a zod-session worktree-jében (zod 4.6.7):**
    - `z.array(el).max(50)` 501 hibás elemmel → 1 issue, 0 elem-hívás;
    - kb. 4 MiB-nyi (2 097 152) hibás elemmel → 1 issue, 0 elem-hívás, +16 MB heap (ez maga a tömb), 2 ms.
    - A 4.4.1-en ugyanez 502 issue, illetve 501 elem-hívás volt.
  - Tehát a javított zodon a `.max()` már az elemek előtt elutasít, és a séma `maxItems`-ként hirdeti a limitet. **S3 a zod-patch merge-e után jön**, a teszt pedig a `tools/list`-en keresztül fut (tömb-típus, elem-séma, `maxItems`, a meglévő `min` és `optional` is megmarad), a zod-session mentett `tools/list` baseline-jához mérve.
  - A limitek műveletenként:
    - `sizes` (`get_mc_preview_files`, `show_mc_previews`, `show_draft_previews`, `generate_test_creative`, `draft_update`): méretenként egy elem. A repo template-jeiben 3–4 méret van, élesben nem tudom → 50.
    - `show_mc_previews.variants`: egy betű a–z-ig (`mc_create` szerződés) → 26.
    - `preview_generate.mc_labels`: marad 20.
    - Batch-tömbök (`prodlist_upsert.rows`, `audience_create_batch`, `topic_create_batch`, `mc_create_batch`, `mc_update_batch`, `mc_copy_batch` ×2, `mc_move_batch`, REST bulk-copy ×2 / bulk-move / bulk-delete): batch-méret szerződés nincs. A legnagyobb eddigi batch ismeretlen; S0-ban az `audit_log`-ból DB-oldali aggregálással nézem meg (`db-reads.md`). Addig 500.
  - A tool-sémák `.max()`-a **operation contract változás**: a Touches-ban és a CHANGELOG-ban is szerepel.
- **Kívül esik, külön tétel:** a `POST /api/drafts` olvashatatlan törzzsel is üres draftot hoz létre (`.catch(() => null)` → `{}`). Ez nem a méretkorlát hibája, és a v3 után a túlcsordulás nem éri el. Hogy szándékos-e (üres „új draft”), az Robi döntése.

**Door:**
- S1 (nginx): a globális definíció szerint egyirányú, mert `git revert` nem vonja vissza (a vhost nincs a repóban, és a repo nyilvános, a portok nem kerülhetnek bele). A visszaállítás olcsó: a két vhost mentése, `nginx -t && systemctl reload nginx`, másodpercek. Hatókör: mindkét tenant minden kérése. Ezért külön reviewer nézi a diffet.
- S2–S4 (app): kétirányú (git), de a hatókör széles: deploy után minden POST/PUT/PATCH mindkét tenanton átmegy a gate-en, és egy túl alacsony limit legitim mentést törne 413-mal.
**Prediction:**
- Változik:
  - a limit fölötti törzs 413-at kap. `Content-Length`-tel azelőtt, hogy az app bármit beolvasna; nélküle a limitet átlépő chunk után. A handler nem fut le, írás nincs.
  - Az nginx HTML 413-at ad, az app JSON-t.
  - A `.max()` fölötti tömb az elemek validálása előtt hibát kap: a REST-en 400, az MCP-n HTTP 200 `result.isError: true`-val, 0 tool-handler-hívással (Codex v3).
  - Az MCP `tools/list` a tömböknél `maxItems`-et hirdet.
- Ugyanaz marad: minden mai legitim kérés (UI-mentések, 50 MB-ig feltöltés, MCP-hívások, az `/mcp` SSE-streamje), és a `tools/list` a `maxItems`-en kívül bájtra azonos. Mutatja: a teljes `npm test` zöld, a `tools/list`-diff, deploy után a `/login` 200, egy share-oldal 200, egy szokásos mátrix-mentés mindkét tenanton.
- S0-ban pirosnak várom, utána zöld (még nem futott, tehát nem megfigyelés):
  - route-szintű vitest: `POST /api/render/public` 2 MiB-os törzzsel → 413; ugyanez az `auth/login` és a `share/[id]/comments` route-ra;
  - **413 és nincs mellékhatás:** `POST /api/drafts` a limit fölött → 413, a `createDraft` és a `writeAudit` 0-szor fut (Codex); ugyanez a visszaállítási utakon (`messages/[id]/restore` és az `entity-route.ts` restore-ja; a Codex „If-Match restoration paths”-ként említi, az `If-Match` fejlécet a kód a `drafts/[id]`-ben olvassa);
  - wrapper-teszt: a forrás a limit után nem olvasódik tovább; a `Content-Length`-előszűrés a `readSession` előtt fut; a cookie-k, a `signal` és a multipart átmegy;
  - zod (a javított verzión): bulk-copy 501 labellel → 400, 0 elem-hívás.
- Ismeretlen:
  - a legnagyobb legitim törzs route-onként (S0, a hívási helyekből; ami 1 MiB fölé mehet, **S1 előtt** az nginx- és az app-limitbe is bekerül);
  - hogy a valódi Next route-runtime-ban a forrás lezárása teljes 413-választ ad-e, kapcsolat-reset nélkül (S0, `next start` helyben);
  - a legnagyobb eddigi batch (S0, `audit_log`).

**Seam:** a `limitBody`, a `withSession` / `withAdmin` (`src/lib/scoped.ts`), a három nyilvános route handlere, a `POST /api/drafts` handlere, és az MCP `tools/list`.

**Tesztek (S0-ban írom):**
- pontosan a limit és limit + 1 bájt; chunked, `Content-Length` nélkül; üres törzs; UTF-8 többbájtos karakter (a bájtot számolja); `withAdmin`; multipart; `/mcp` SSE-vel;
- „413 és nincs írás” a drafts és a restore route-on;
- a `tools/list` megmaradó sémái.
- Reprodukció egy izolált helyi appon (`next start` a teszt-DB-vel): 100 MB-os POST a `/api/render/public`-ra, a folyamat RSS-e előtte és utána, és a válasz teljes-e. Élesben nem.

**Szeletek v3** (S0 → S1-review → S1 → S1b → S2 → S3 → S4; S3 a zod-patch merge-e után):
- [ ] **S0** Tesztek + a helyi reprodukció; az `audit_log`-ból a legnagyobb batch (DB-oldali aggregálással, `db-reads.md`); a `monitoring/import` és az `adform-snapshots` legitim maximuma; a 31 + 5 hívási hely legnagyobb legitim törzse. Ha bármelyik 1 MiB fölé mehet, a limitje S1 előtt az nginxbe és az appba is bekerül. Alkalmazáskód még nem változik.
- [ ] **S1-review** A két vhost teljes, effektív konfigja (`nginx -T`, benne `grep client_max_body_size`, hogy a `nginx.conf` és a `conf.d` ne írja felül) és a `mm6-proxy-common.conf`, a mentéssel és a visszaállítással, külön reviewernél, **S1 előtt**. A `proxy_request_buffering` mindenhol marad alapértelmezett (on).
- [x] **S1 — KÉSZ 2026-11-23 16:21 UTC** (Robi: „Igen, mehet mindkettő”; a B box-sessionnek előtte és utána is szóltam):
  - Mindkét vhost valódi fájlja a review-zott eredetivel egyezett (sha), az időbélyeges mentés után cseréltem. A `sites-enabled` symlinkek érintetlenek, `nginx -t` rendben, reload. Az `nginx -T` szerint: szerverszinten 1m, `/mcp` 5m, feltöltés 60m, template 5m.
  - A közös snippet a repóban van (`deploy/nginx/mm6-proxy-common.conf`), a boxon lévő példány egyezik vele (`cmp`).
  - Ellenőrzés mindkét tenanton, írás nélkül:
    - 2 MiB-os POST a `/api/render/public`-ra → 413;
    - kis login-POST → 401;
    - 49,9 MiB-os feltöltés session nélkül → 401;
    - 2 MiB-os POST az `/mcp`-re → 401, 6 MiB-os → 413;
    - 2 MiB-os template-PUT → 401;
    - `/login` 200, `/_next/image` 404.
  - Az erste `/artifacts/` 403, a `/__deploy-status.json` 404, mindkettő ugyanaz, mint előtte. Az nginx error logban csak a próbák „too large body” sorai és az `/artifacts/` próba sorai jelentek meg. A pm2 appok online, egyik sem indult újra; a brain 200.
  - Nem próbáltam élesben: a maintenance-oldalt, mert az a felhasználóknak is megjelent volna. A config szerint minden proxyzó location behúzza a gate-et.
  - Az eredeti terv lépései:
  - időbélyeges mentés, `nginx -t`, reload;
  - utána mindkét tenanton: 2 MiB-os POST a `/api/render/public`-ra 413; egy kb. 49,9 MB-os feltöltés átmegy; a `/login` 200; az `/mcp` 401 token nélkül; a maintenance-oldal továbbra is megjelenik;
  - visszaállítás: a mentés vissza, `nginx -t && systemctl reload nginx`;
  - az infra-map Box B sorát a gazdája (Learning) frissíti, jelzem neki.
- [x] **S1b — KÉSZ 2026-11-23 16:30 UTC** (Robi: „Jöhet az S1b - Igen, mehet”; a B box-sessionnek előtte és utána is szóltam, az infra-map miatt a Learningnek is):
  - Mindkét tenant `ecosystem.config.cjs`-ében `args: "start -H 127.0.0.1 -p <port>"`.
  - A lépések tenantonként: mentés a `/root/pm2-backup/`-ba (a pm2 dump és mindkét ecosystem-fájl, `*.s1b-20261123-162905`), `mm6-maint on`, `pm2 delete`, `pm2 start ecosystem.config.cjs --only`, várás a `127.0.0.1:<port>/login` 200-ára, végül `mm6-maint off`.
  - Telekom 16:30:02–09, 7 s a maintenance-oldal mögött; erste 16:30:36–39, 3 s. `pm2 save` 16:31:21: a dumpban mindkét új indítóparancs benne van, a régi MM két bejegyzése továbbra is `stopped`.
  - Ellenőrzés a boxon belülről, előtte → utána: a listener `*:<port>` → `127.0.0.1:<port>`. A `[::1]:<port>` és a publikus IP `:<port>` 200 → kapcsolat elutasítva. A `127.0.0.1:<port>` 200 → 200.
  - Kívülről, az nginxen át mindkét tenanton változatlan: `/login` 200, `/` 307 → `/login`, `/_next/image` 404, `/api/config` 401, `POST /mcp` 401. Az app saját `Location`-je relatív, a `-H` nem változtatta meg.
  - Mindkét új folyamat tart Postgres-kapcsolatot. A két app és az nginx error logjában nincs új sor. Restart 0, Node 20.20.2.
  - A kódban semmi nem hívja az appot `localhost`-on: a `preview-shooter` és a `mm6-deploy` is a `127.0.0.1`-et használja. Az abszolút URL-ek az `x-forwarded-host` / `Host` fejlécből jönnek, a `req.url` hosztja csak tartalék.
  - **A tervtől eltérően** az újraindítás `mm6-maint on/off` közé került, ahogy a `mm6-deploy`-ban is. Így a kiesés alatt a maintenance-oldal jelent meg, nem 502. Az oldalt közben nem kértem le, ezért a gate-et ez sem igazolja élesben.
  - **Prediction vs observed:** a terv kb. 1 s-os kiesést várt tenantonként, a maintenance-oldal 7, illetve 3 s-ig volt fent. A különbség a `pm2 delete` + `start` és a hidegindítás ideje.
  - **Lelet:** az erste pm2-környezetében volt egy shellből örökölt `DATABASE_URL`. A hash-e egyezett a `.env`-ével, tehát most semmi nem változott, és az új folyamat környezetében már nincs ilyen.
    - Valószínű mechanizmus (következtetés, nem megfigyelés): az AGENTS.md migrációs lépése, `export $(grep '^DATABASE_URL=' .env | xargs) && npm run db:migrate`, utána ugyanabban a shellben `mm6-deploy`. Ennek a `pm2 restart --update-env`-je a shell változóit beégeti a pm2 env-be. A Next a `.env`-ből nem írja felül a már meglévő változót, ezért egy későbbi `.env`-csere csendben hatástalan maradna.
    - Javaslat, Robi dönt: a migráció subshellben fusson, `(export …; npm run db:migrate)`. Ez egy sor az AGENTS.md „Migrations” részében.
  - Mellékes: a `custombrain`-t 16:29:24 és 16:29:44 között valaki más leállította és elindította (új pid), még az első lépésem előtt. Nem én voltam, és nem néztem utána, ki. Az én `pm2 save`-jeim (16:30:36, 16:31:21) már az online állapotát rögzítették.
  - Visszaállítás: a mentett ecosystem-fájlok vissza, ugyanaz a `pm2 delete` / `pm2 start --only`, majd `pm2 save`.
  - Az infra-map Box B sorát a gazdája (Learning) frissíti, szóltam neki.
- [ ] **S2** `limitBody` + a wrapperek + a három nyilvános route + `/mcp` + 413-naplózás; az `adform-snapshots` és a `monitoring/import` megkapja a hiányzó méret-ellenőrzést. S0 tesztjei zöldek.
- [ ] **S3** (a zod-patch merge-e után, és csak ha a merge-elt lockfile-ban a mért zod-verzió van) `.max(n)` a 18 korlátlan tömbre, egyenként; a meglévő `mc_labels` `.max(20)` marad. A „0 elem-hívás” tesztet a merge utáni lockfile-on megismétlem; `tools/list`-diff a baseline-hoz.
  - **Plusz, zod-verziótól függetlenül:** `new McpServer(info, { maxToolInputElements: 50_000 })` a `buildMcpServer`-ben. Az SDK 1.32.1 `validateToolInput`-ja a zod-validálás **előtt** megszámolja a tömbelemeket és az objektumkulcsokat, és a limit fölött `InvalidParams`-ot dob (ellenőrizve: `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js` 210–212). Egy teljes mezős `mc_update_batch`-sor kb. 39 elem, tehát az 500-as batch kb. 20 000 elem. A testvér-session (`mm6: JSON body limits…`) szerint a `tools/list`-et nem változtatja. Teszt az SDK Clienten és `InMemoryTransport`-on át, mert a meglévő tesztek közvetlenül a handlert hívják, és kihagyják a `validateToolInput`-ot.
- [ ] **S4** Verify (`npm test`, `tsc`, lint), diff-review külön reviewerrel (security), deploy telekom → erste Robi go-jával, az AGENTS.md teljes „After” listájával.
  - **Bump: minor (6.133.0).** A v3-körben a CA is visszavonta a patch-javaslatát: az AGENTS.md szerint a felhasználó által látható viselkedésváltozás minor, és a `tools/list` `maxItems` MCP-szerződés-változás. Robi dönt.

**Nyitott kérdések Robinak:**
1. ~~Gate-típus~~ — eldöntve: ötvözet (2026-11-23). A v3 ezen belül marad, csak a handler előtt olvas.
2. A limitek: JSON 1 MiB, `/mcp` 5m, feltöltés 60m, template-írás 5m?
3. Tömb-limitek: `sizes` 50, `variants` 26, `mc_labels` 20, batch 500 (S0 után véglegesítve)?
4. S1b (`-H 127.0.0.1`) kötelező szelet legyen?
5. Bump: minor vagy patch?

**Planning review:** kérve 2026-11-23 10:55: `~/agent-bus/requests/20261123-1055-mm6-body-size-limit.md`; a válaszok ugyanezen a néven az `~/agent-bus/answers/`-ben (a Codexé `.codex.md`).

### Planning review — Chief Architect: **OK with changes** (2026-11-23 10:57; a Codex még fut)
Tanács, nem utasítás; amit átveszek, Robi jóváhagyásával kerül a szeletekbe.
- **Rangsor:** a belépés nélküli DoS a zod-hiba előtt, és S1 (nginx) jön először. Egyezik a tervvel.
- **Gate:** a `Content-Length`-alapú gate a wrapperekben, nem a streamelő olvasó. Feltétele, hogy az app csak a 127.0.0.1-en figyeljen. **A boxon olvasva (2026-11-23): mindkét app minden interfészen figyel (`*:<port>`), csak a ufw zár** (OpenSSH és Nginx Full engedve). → Új szelet javaslat: **S1b** `next start -H 127.0.0.1` mindkét tenantnál (pm2 indítóparancs), Robi dönt.
- **411:** csak POST/PUT/PATCH-re, és csak ha nincs sem `Content-Length`, sem `Transfer-Encoding`. A gate a `readSession` **előtt** fut, és a teszt bizonyítja, hogy a törzs nem olvasódik be.
- **nginx:** `location ^~ /mcp`, horgonyzott feltöltési regex (`^/api/(files/upload|import/xlsx|adform-snapshots|monitoring/import)$`). A proxy-fejlécek és a maintenance-gate egy közös include-snippetbe kerülnek, amelyet mindhárom location behúz.
- **Limitek:** kiindulásnak rendben vannak. S0-ban a `monitoring/import` és az `adform-snapshots` legitim maximumát külön kell nézni. Az MCP tool-sémák `.max()`-a **operation contract változás**: bekerül a Touches-ba és a CHANGELOG-ba.
- **Rollback és ellenőrzés:**
  - vhost-mentés időbélyeggel, reload előtt `nginx -t`;
  - S1 után 40 MB-os feltöltés **mindkét** tenanton;
  - az első héten a 413-ak naplózása (route + `Content-Length`).
- **Kívül esik, külön tétel:** a box Node 20.20.2-je EOL; `limit_req` a login és a render/public route-ra. Egyik sem ennek a fixnek a része.
- **Bump:** patch elég, Robi dönt.

### Planning review — Codex: **Stop** (2026-11-23) → újratervezés
A „Stop” azt jelenti, hogy ebben a formában nem hajtom végre. A pontjai és amit átvennék:
1. **A `.max()` nem állítja meg az elemvalidálást.** **Helyben megfigyelve (zod 4.4.1):** `z.array(el).max(50)` 501 hibás elemmel 502 issue-t ad, és 501 jó elemnél is mind az 501 elem-validátor lefut. Ha egy hossz-gate jön az elemek **előtt** (`z.unknown().superRefine(…fatal…).pipe(z.array(el))`), 1 issue lesz és 0 elem-hívás. → S3: hossz-gate az elemvalidálás előtt, a sémában (így az MCP SDK validálása is elé kerül). A teszt az elem-validátor hívásszámát nézi (0), nem csak a 400-at. A javított zodon (a zod-session után) újramérem.
2. **Gate: a CA és a Codex ellentmond.** A CA a `Content-Length`-alapú gate-et ajánlja a wrapperekben; a Codex a valódi bájtszámláló olvasót, mert a 411 új szerződés, és az nginx `Content-Length`-garanciája nincs igazolva. **Javaslatom (Robi dönt), a kettő ötvözete:** a `withSession` / `withAdmin` a kérés törzsét egy bájtszámláló streamre cseréli. Így a handlerek `req.json()` / `formData()` / `text()` hívása a limitnél megáll, és a wrapper 413-at ad. Mellé jön egy `Content-Length`-előszűrés az olcsó elutasításhoz. 411 nincs, a fejlécben nem kell megbízni, és a 31 + 5 hívási hely változatlan marad. A három nyilvános route és az `/mcp` ugyanezt a függvényt hívja.
3. **Leltár és tesztek:**
   - Az `src/lib/entity-route.ts` további 5 JSON-olvasást tartalmaz. Ezek a `withSession` alatt futnak, a wrapperes megoldás lefedi őket.
   - Tesztek: pontosan a limit, és limit + 1 bájt; chunked; üres törzs; UTF-8 többbájtos karakter (bájt, nem karakter); `withAdmin`; multipart; MCP.
   - A feltöltés megmaradását egy kb. 49,9 MB-os fájl bizonyítja, nem 40 MB-os.
   - A tömb-limitek műveletenként, indoklással (a feed-limit nem általános batch-szerződés).
4. **Az nginx-diff S1 előtt kap külön review-t:** a konkrét konfig-diffel, a kivételek illesztésével, időbélyeges mentéssel és visszaállítási lépésekkel (a CA közös include-snippetjével együtt). S4 hivatkozik az AGENTS.md teljes „After” listájára.
5. **Bizonyíték-státusz:**
   - A tesztek még nem futottak, ezért nem „megfigyelten pirosak” (fent javítva).
   - S0 egy reprodukáló paranccsal indul egy izolált, helyi appon (`next start` a teszt-DB-vel), nem élesben.
   - A production OOM következtetés marad.
   - A spec (2026-09-06) **elavult lehet**: azóta 31 commit érintette az `src/app/api`, a `scoped.ts` és az `entity-route.ts` fájlokat.

**Következő:** Robi a gate-ről döntött („Ötvözet”). A v2 fent van, és 2026-11-23 11:25-kor újra kiment mindkét reviewernek: `~/agent-bus/requests/20261123-1125-mm6-body-size-limit-v2.md` (benne a portokat tartalmazó vhost-diff, ami a repóba nem kerülhet). Nyitott még a limitek, a tömb-limitek és az S1b.

### Planning review v2 — CA: **OK with changes**, Codex: **Stop** (2026-11-23) → v3 fent
- **Közös fő pont:** a v2-ben a 413-felülírás nem akadályozta meg az írást, ha a handler lenyelte a hibát. A Codex próbája: a `POST /api/drafts` 413-at adott, a `createDraft` és a `writeAudit` közben lefutott. → v3: a wrapper a handler előtt olvas.
- **Codex:** a `boundedArray` elrontaná a `tools/list` sémáját (`"sizes": {}`). → v3: sima `.max(n)` a javított zodon, ahol ez már az elemek előtt elutasít (helyben megfigyelve, zod 4.6.7). S3 a zod-patch után jön.
- **Codex:** a bump legyen minor. **CA:** patch. → Robi dönt, a terv a minort javasolja.
- **CA:** az S1b legyen kötelező; `nginx -T` az S1-review-ban; a `proxy_request_buffering` maradjon alapértelmezett.
- **Mindkettő szerint jó:** az nginx-diff és a snippet-öröklés.
- **v3 review:** kérve 11:50-kor, `~/agent-bus/requests/20261123-1150-mm6-body-size-limit-v3.md`.

### Planning review v3 — Codex: **OK with changes**, CA: **OK with changes** (2026-11-23) — Stop nincs
A végrehajtáskor betartandó pontosítások:
- **Sorrend:** `Content-Length`-előszűrés (csak fejléc) → auth (`readSession` / admin / `resolveBearerClient`, mind csak fejléc) → korlátos olvasás → handler. Auth nélkül a törzs nem olvasódik be (ma is 401 olvasás nélkül). Teszt: auth nélküli kérés `Content-Length` nélkül, a törzs érintetlen.
- **Az új kérés:** `new NextRequest(req.url, { method, headers, body: bytes, signal: req.signal })`. A `content-length` a tényleges bájtszám lesz, a `transfer-encoding` kiesik. A wrapper-teszt a `nextUrl.searchParams`-ot is nézi.
- **A `signal`-átadás nem megszakítás** (Codex próbája): a korlátos olvasás maga álljon le kliens-bontáskor; erre is kell teszt.
- **Feltöltési memória:** S0-ban mérem egy elfogadott, kb. 50 MB-os feltöltés **csúcs-RSS-ét** (a puffer, a `formData()` és a `Buffer.from` együtt; a CA becslése kb. 3×, vagyis kb. 180 MB, a telekom `max_memory_restart`-ja 700 MiB). Ha 250 MB fölött van, a négy feltöltési route a számlált streamet kapja, nem a puffert.
- **Node 20.20.2:** a valódi-Next próbák (teljes 413 reset nélkül, bontás, multipart, `signal`) S0-ban és S2 után is a box Node-verzióján futnak, nem csak a helyi 24-en. A Node-csere (TIP-061) nem ennek a tervnek a része.
- **A drafts- és restore-teszt** `Content-Length` nélküli túlcsordulással is fut, a restore érvényes `If-Match`-csel.
- **`/mcp`:** `tools/call` és a JSON-válasz (`enableJsonResponse`) ép marad; a sorrend ugyanaz, mint fent.
- **Külön tétel, nem ebbe a diffbe:** a write-route-ok `.catch`-es body-olvasásainak listája (CA), köztük a drafts üres-draft viselkedése.
- **S1b:** mindkét reviewer szerint bekerül (a CA szerint kötelező).
- A limitek (1m / 5m / 60m / 5m; 50 / 26 / 20 / 500) kiindulásnak mindkettőjüknek rendben vannak.

**Robi döntése (2026-11-23): „Igen, mind”.** Mehetnek a limitek (JSON 1 MiB, `/mcp` 5m, feltöltés 60m, template-írás 5m), a tömb-limitek (`sizes` 50, `variants` 26, `mc_labels` 20, batch 500, S0 után véglegesítve), az S1b kötelező szeletként, és a bump minor (6.133.0). A deployok és az S1 (nginx) továbbra is külön go-t kapnak.

### S0 — eredmények (2026-11-23)
- **Legitim JSON-törzsek** (élő DB, csak olvasó tranzakció, DB-oldali aggregálás; a hívási helyekkel összevetve):
  - a legnagyobb `config`-érték 3367 bájt, a legnagyobb `messages`-sor JSON-ként 3967 bájt, a legnagyobb `text_formatting`-sor 417 bájt;
  - 3009 message, 189 audience, 102 topic (a két tenant együtt). A reorder- és share-szelekciós tömbök tehát legfeljebb néhány ezer id-ből, néhányszor 10 KB-ból állnak.
  - Az 1 MiB-os JSON-limit így kb. 250× tartalékot hagy. **Egyik JSON-route sem kap kivételt**, az nginx-diff marad.
- **Batch-maximum** (`audit_log`, `bulk_*` sorok, DB-oldalon csoportosítva): `messages bulk_update` 154, `bulk_copy` 147 (ez a létrehozott példányok száma), `bulk_move` 7, `bulk_create` 5. Telekomon nincs bulk-sor. → **a batch-limit 500 marad** (kb. 3× tartalék).
- **Feltöltések** (`uploaded_files`): a creative-ok p99-e 8,8 MB, az asseteké 0,9 MB. Két videó nagyobb 40 MB-nál (61,6 és 53,0 MB, 2026-08-17). Ezek nem a `files/upload` útvonalon jöttek, mert annak az 50 MB-os limitje az első commit óta él; aznap a import-scriptek dolgoztak (`git log` 2026-08-17). A 60m-es feltöltési limit tehát lefed minden legitim kérést.
- A `monitoring/import` és az `adform-snapshots` fájlmérete nincs eltárolva, ezért ismeretlen. Mindkettő a 60m-es feltöltési location alá kerül.
- Az MCP `asset_upload` leírása „max 10MB decoded” base64-et ígér, de az SDK legfeljebb 4 MiB-os törzset olvas (2026-11-04-i jegyzet). Ez meglévő eltérés, nem ennek a fixnek a része, külön jelzem.
- **Tesztek, megfigyelten pirosak** (`tests/integration/api/request-body-limit.test.ts`, 2026-11-23): 18-ból 14 bukik, 4 védőteszt zöld (az auth nélküli kérés 401-et kap, és a törzséből egy bájt sem olvasódik; a pontosan limitnyi törzs eljut a handlerig). A bukások ma ezt mutatják, a limit + 1 bájtos (vagy +1 MiB-os) törzzsel:
  - `render/public` 404, `auth/login` 401: mindkettő a teljes törzs beolvasása után;
  - a share-komment **létrejön** (201), a draft **létrejön** (201), az archivált audience érvényes `If-Match`-csel **visszaáll** (200);
  - a feltöltés a teljes, limit fölötti törzset beolvassa, és csak utána bukik meg a multipart-parszoláson; a template-írás 404-et ad a beolvasás után;
  - ugyanez `Content-Length`-tel és nélküle is.
- **Feltöltési memória** (helyben, Node 24.13.1, a Next `NextRequest`-jén, nem a route-runtime-ban; 50 MB-os fájl): a mai út (`formData()` az eredeti streamen) +102 MB RSS, a v3 pufferelős útja +201 MB, a kétszerese. A boxon most a két mm6-folyamat 339 és 179 MB-on fut, a pm2 küszöbe 900 és 700 MiB, available 1747 MB.
  - **Döntés (a CA javaslata szerint, a jóváhagyott ötvözeten belül):** a négy feltöltési route a **számlált streamet** kapja, nem a puffert. Ott a limit fölött a stream hibával áll le, és a wrapper 413-at ad. A négy route egyike sem tud írni parszolt űrlap nélkül; a teszt ezt is ellenőrzi (nincs `uploaded_files`-sor). A JSON- és szöveg-route-ok pufferelnek (1 MiB, illetve 5 MiB), ez elhanyagolható.
- **Még nyitott S0-ból:**
  - a Node 20.20.2-es próbák, mert helyben csak Node 24 van (letöltés kell, Robi engedélyével);
  - a valódi `next start`-os reprodukció. Ezt az S2 utánra teszem, ott egyszerre mutatja a hibát (a régi builden) és a javítást.
- **S1-review előkészítés:**
  - `nginx -T` (2026-11-23): `client_max_body_size` csak a három vhostban van (a két mm6-ban 200M, a proficióban 50M); `http`-szintű beállítás és `proxy_request_buffering` sehol nincs, tehát az alapértelmezett „on” él.
  - A telekom-diff tartalmilag megegyezik az erstéével (más a port és a tenant, és nincs `/artifacts`).
  - A diffet egy friss kontextusú reviewer nézi (2026-11-23).
- **S1-review (friss kontextusú reviewer, 2026-11-23): OK with changes.** Átvett javítások az S1 lépéseibe:
  - A `sites-enabled` vhostok symlinkek a `sites-available`-be. **A mentés és a szerkesztés a valódi fájlon** történik (`sites-available`, vagy `cp -aL`); a linkre `sed -i` vagy `mv` nem mehet. Reload után `nginx -T | grep client_max_body_size` és a hibalog; a repó snippetjét `cmp`-vel vetem össze a box példányával.
  - **Az utóellenőrzés nem írhat élesbe.** A 49,9 MB-os feltöltés **session nélkül** megy, és 401-et vár (ezzel igazolja, hogy átjutott az nginxen), nem írja a MinIO-t és a DB-t. Plusz: 2 MiB-os POST `/mcp`-re token nélkül → 401; 6 MiB-os POST `/mcp`-re → 413; 2 MiB-os PUT `/api/templates/a/b` session nélkül → 401.
  - Pontosítás: az 50 MB-os app-limit csak a `files/upload` és az `import/xlsx` route-ban van, az `adform-snapshots` és a `monitoring/import` route-nak a 60m lesz az egyetlen korlátja (az S2 adja hozzá az app-oldalit).
  - Opcionális: `error_page 413` JSON-nal, mert a `MonitoringUpload` `r.json()`-t hív. Csak 60 MiB fölött számít.
  - Meglévő, nem ennek a változásnak a hibája: az MCP `asset_upload` / `creative_upload` 10 MB-os base64-et hirdet, a transport legfeljebb 4 MiB-ot olvas.

## 2026-11-23 — Régi MM kivezetése a B boxon (TERV, Robi go-jára vár)

Kérés: a Head of Dev 2026-11-23-i üzenete; a Head of Security szerint Robi döntése „Vezessük ki”. **Robi ebben a sessionben még nem erősítette meg.** A régi MM másik repó, abba nem írok. Box-tények: infra-map, „Box B”, a `proficio.messagingmatrix.ai → mm-server-proficio` és az `mm-server-erste` sor.

### ⚠ Lelet (2026-11-23, csak olvasva): élő kulcsszivárgás
- A `mm-server-proficio` buildjében (2026-02-08) **három nyilvánosan kiszolgált JS-fájl tartalmazza a `.env` `VITE_ANTHROPIC_API_KEY` értékét** (`assets/Settings-*.js`, `assets/ai-assistant-*.js`, `assets/templates-*.js`). Mindhárom HTTP 200-zal letölthető, és a letöltött válaszban benne van a kulcs. A `VITE_` előtagú változókat a Vite a böngésző-bundle-be égeti.
- Az elmúlt 14 napban ezt a három fájlt 13, 23 és 12 alkalommal töltötték le, 8–15 különböző user agenttel. **A kulcsot kompromittáltnak kell tekinteni.**
- Ugyanez az érték az mm6 két tenantjának és a customBrainnek a `.env`-jében nincs meg. A `VITE_SUPABASE_PW`, a `JWT_SECRET` és az `MCP_BEARER_TOKEN` egyik build-fájlban sincs benne. A `/.env` és a `/.git/config` útvonal az SPA `index.html`-jét adja (ugyanaz a sha, mint a `/`-é), tehát ott nincs szivárgás.
- **A kulcs törölve:** Robi 2026-11-23-án ezt írta: „ezt már letörröltük”. Ezt én nem ellenőriztem, a kulccsal semmit nem próbáltam ki. A kiszolgálás 11:25 UTC óta leállt (lent, 1. lépés).

### Használja-e még valaki (2026-11-23, csak olvasva)
- `mm-server-erste`: nincs vhost, a portját kívülről a ufw zárja, élő kapcsolata 0, és az MM6 repó nem hivatkozik rá. Csak a boxról érhető el.
- `mm-server-proficio`: nincs saját access logja. A kérései a közös `access.log`-ba mennek, a customBrainé és a default szerveré mellé, és ez a log **14 napig** él, nem 30-ig.
  - 14 nap alatt a felülete bundle-jét 151-szer töltötték le böngésző user agenttel (124-szer 2026-11-09-én, utána naponta 1–5-ször), 18 különböző kliensről.
  - Író API-hívás nem volt, csak scanner-POST-ok, amelyek 301-et kaptak.
  - Nem néztem meg, hogy a régi frontend a saját API-ját hívja-e, vagy közvetlenül a Google-t. Ezért az API-hívások hiánya nem bizonyítja, hogy senki nem használja. Hogy a 18 kliens valódi felhasználó-e (például Proficio), azt Robi dönti el.
- Adat: mindkét app mappájában SQLite-fájlok vannak (`db/*.db`), és mindkettőnek van `.env`-je titkokkal. Rollback-pontként a helyükön maradnak.

### Lépések
**Door:** az 1. lépés visszafordítható, de kifelé látszik (a proficio domain megszűnik); a 2. lépés egyirányú.
- [x] **0.** Robi 2026-11-23: „Igen, állítsd le” (ezzel a „Vezessük ki” megerősítve). A kulcsot Robi szerint már törölték („ezt már letörröltük”, 2026-11-23).
- [x] **1. Leállítás — KÉSZ 2026-11-23 11:25 UTC** (a B box-session reboot-ablaka után, vele egyeztetve):
  - Időbélyeges mentés a boxon: a proficio vhost valódi fájlja és a pm2 dump (`…-20261123-112459`); a `sites-enabled` bejegyzés symlink maradt.
  - **Sorrend a tervtől eltérően:** előbb a vhost, utána a pm2. Így a kulcsos fájlok azonnal elérhetetlenné váltak, és 502-es pillanat sem volt.
  - A vhost `location /`-ja `return 410;`, a szöveges „megszűnt” oldal helyett, mert szöveget nem adtál. `nginx -t` ok, reload.
  - `pm2 stop mm-server-proficio mm-server-erste`, `pm2 save` (11:25:30): a mentett dumpban mindkettő `stopped`, ezért a következő reboot sem hozza vissza őket. A két régi port nem figyel.
  - Kívülről ellenőrizve: a proficio domain `/` és a három kulcsos fájl 410-et ad, az erste és a telekom `/login`-ja 200, a brain 200, az nginx error logban nincs új sor.
  - Az eredeti terv lépései:
  - `pm2 stop mm-server-proficio mm-server-erste`, majd `pm2 save`;
  - a proficio vhost a valódi fájl időbélyeges mentése után egy statikus „megszűnt” oldalt ad (a szövegét Robi adja), vagy 410-et;
  - ellenőrzés: a proficio domain a megszűnt-oldalt adja, a három kulcsos fájl nem tölthető le, az mm6 két tenantjának `/login`-ja 200, a customBrain él;
  - visszaállítás: `pm2 start mm-server-proficio mm-server-erste`, `pm2 save`, a vhost-mentés vissza, `nginx -t && systemctl reload nginx`.
- [ ] **2. Törlés** (külön go, az 1. után néhány nappal): a két app mappája (benne a SQLite-fájlokkal és a `.env`-ekkel) tömörítve a Hetzner kötetre, csak rootnak olvashatóan; titkot tartalmaz, ezért nem kerül a Drive-ra titkosítás nélkül. Utána `pm2 delete` mindkettőre, `pm2 save`, a vhost és a symlink törlése, `certbot delete --cert-name proficio.messagingmatrix.ai`. Visszaállítás csak az archívumból lehetséges.
- [ ] **3.** Az infra-map Box B sorait a gazdája (Learning) frissíti, jelzem neki.
- Ha az 1. lépés a Node-csere előtt lefut, a régi MM-et nem kell Node 24 alatt tesztelni.

## 2026-11-23 — B box: Node 20 → 24 (TERV, Robi lépésenkénti go-jára vár)

Kérés: a Head of Dev 2026-11-23-i üzenete; a Head of Security szondája (2026-11-23): a B box system Node-ja 20.20.2, EOL (2026-04-30). Végrehajtó: ez a session (a Head of Dev kijelölése, nem go). Box-tények: infra-map „Box B”. Előzmény: `~/SecAudit/tasks/node24-migration.md` (2026-09-06, az A boxra írták; azóta az A box minden appja 24.22.3-on fut, a módszer ott bevált).

**Touches:** a B box pm2-appjainak futtatókörnyezete (mm6-erste, mm6-telekom, custombrain; a régi MM a kivezetés 1. lépéséig), az mm6 build a boxon (`mm6-deploy` → `npm ci` + `npm run build`), a pm2 démon (`pm2-root.service`), és a tenantok `ecosystem.config.cjs`-e (ez a boxon a repón kívül van, git nem követi). Szemantikai modell nincs, a meaning-dokumentumok a futtatókörnyezetről nem szólnak. Szabvány: `~/.agents/standards/dependencies.md` (a futtatókörnyezet egymás mellé települ; a kockázatos app megy először).

**Megfigyelve (2026-11-23):**
- A boxon: Node 20.20.2 a NodeSource csomagból (`nodesource.list`), x86_64. A pm2 rootként fut, `pm2-root.service`. Minden app `interpreter: node` (a PATH-ból), fork módban; a tenantok ecosystem-fájljában `interpreter: "node"`, `next start -p <port>`. Build-eszközök vannak (python3, make, g++).
- Helyben: a teljes tesztcsomag (1119 teszt) Node 24.13.1-en zöld (a zod-session baseline-ja, 2026-11-23). Az MM6-at helyben eddig is Node 24-en fejlesztettük.
- Natív modulok: a sharp, a `@next/swc`, a `@unrs`, a `@rollup` és az esbuild N-API-s vagy önálló bináris, Node-főverziótól független. A playwright `>=18`, a next és a sharp `>=20.9.0`.
- **Egyetlen gond: a `better-sqlite3` 11.10.0.** A GitHub release-ben csak `node-v115` és `node-v127` linux-x64 prebuild van (Node 20 és 22), `node-v137` (Node 24) nincs. Node 24-en a `npm ci` tehát a boxon forrásból fordítana (node-gyp), ami a 4 GB-os boxon lassú és memóriaigényes. A 12.10–12.12 verziókban van `node-v137` prebuild, a 13.x-ben nincs.
  - Az app futás közben nem használja: az `src`-ben csak kommentben szerepel. Két régi script használja (`scripts/seed-perf.ts`, `scripts/backfill-to-pg.mjs`).
  - Javaslat (Robi dönt): **(a)** `better-sqlite3` → 12.12.0, egy függőség-patch a Node-csere előtt. Vagy **(b)** a függőség és a két script törlése. Vagy **(c)** fordítás a boxon.
- A `mm6-deploy` csak lockfile-változáskor futtat `npm ci`-t (`node_modules/.mm6-lock-sha`). Node-csere után ezt kézzel kell kikényszeríteni (a stamp törlése), különben a régi ABI-jú natív modulok maradnak.

**Sorrend (javaslat, Robi dönt):**
1. A B box-session kernel-151 + reboot ablaka **előbb**, külön ablakban.
2. A régi MM kivezetésének 1. lépése (fent), így a Node-csere csak három appot érint.
3. Az mm6 függőség-patchei: a zod-patch (`claude/exciting-leakey-7043bd`, `13386ba`), a `better-sqlite3` (a) szerint, és a body-limit szeletei, amíg még a régi Node-on futnak, hogy egy hiba egy változáshoz legyen köthető.
4. Node 24 egymás mellé, appokként (lent).
5. A system Node cseréje a végén.

**Lépések (mindegyik Robi külön go-jával; a pm2-lépések előtt szólok a B box-sessionnek):**
- [ ] **N1. Node 24 egymás mellé:** a hivatalos 24.x LTS tarball (a legfrissebb biztonsági kiadás) egy verziózott mappába (az útvonal az infra-mapbe kerül, nem ide). Ellenőrzés: a `SHASUMS256.txt` aláírással; `<node24>/bin/node -v`. A system Node érintetlen. Visszaállítás: a mappa törlése.
- [ ] **N2. mm6-telekom:**
  - `PATH=<node24>/bin:$PATH` alatt: a stamp törlése, majd `mm6-deploy telekom` (ez `npm ci` + build Node 24-gyel);
  - az ecosystemben `interpreter: "<node24>/bin/node"`, aztán `pm2 delete mm6-telekom && pm2 start ecosystem.config.cjs --only mm6-telekom && pm2 save`;
  - ellenőrzés: az AGENTS.md „After” listája, a `pm2 jlist`-ben `node_version` 24, és a hibalog;
  - visszaállítás: `interpreter: "node"`, ugyanez a pm2-sor. Az N-API-modulok Node 20 alatt is futnak, a `better-sqlite3`-at az app nem tölti be. Ez következtetés, ezért a visszaállítást az N2-ben ki is próbálom: a Node 20-ra visszaváltva a `/login` 200-at ad.
- [ ] **N3.** Figyelés 24–48 óráig: a restart-számláló, a hibalog, a memória.
- [ ] **N4. mm6-erste:** ugyanaz, mint N2.
- [ ] **N5. custombrain:** az igényeit a customBrain státusz-session adta át (2026-11-23; a gépszintű részletek a közös jegyzetmappában: `custombrain-node24-igenyek-2026-11-23.md`).
  - Nem kell `npm install`, rebuild vagy build: tiszta JavaScript, natív modul nincs. **A csere közben a customBrain mappájában nem futhat `npm install`** (lockfile nincs a gitben, egy telepítés mást hozna).
  - A hét cron-sora teljes úton a system Node-ot hívja. Ezért **a customBrain az N6-tal, a helyben cserélt system Node-dal megy át**, és a cron-sorokhoz nem kell nyúlni. Kanárinak (Robi dönt) választható a pin, vagy egyetlen cron-sor (`agenda-sync`). Ehhez a hét sort át kellene írni, és N6 után visszaírni.
  - Az újraindítás a customBrain saját Deploy-szabálya szerint megy (stop, a port felszabadítása, start). **Soha nem `pm2 restart all`**, és démon-újraindítás után pid-ellenőrzés kell (a régi folyamat kétszer is a porton ragadt).
  - Ami változik: a beépített `fetch` undicija 6.24.1-ről 7.x-re lép (20 hívás 11 fájlban). A graphology két csomagját Node 24-en még nem próbálták.
  - Utána: a jegyzet ellenőrzőlistája (a `/proc/<pid>/exe`, a port pid-je, a hibanapló, 10 percen és 1 órán belül a cron-naplók, másnap a mentés). Végül szólok a customBrain-sessionnek, ő a brain MCP-n át ellenőriz.
- [ ] **N6. System Node csere** (amikor minden app 24-en fut és stabil):
  - a mostani `nodejs` .deb mentése (`/var/cache/apt/archives`, vagy `apt download nodejs=20.20.2-1nodesource1`);
  - a NodeSource repó 24.x-re, `apt install nodejs`, majd `pm2 update` (a démon is az új Node-ra áll; ez minden pm2-folyamatot újraindít, ezért utána jön a customBrain pid-ellenőrzése, és az mm6 két tenantjáé is);
  - az interpreter-pinek visszaállítása `"node"`-ra, és `pm2 save`.
  - Visszaállítás: a mentett .deb `dpkg -i`, `pm2 update`.
  - A postgres-meta konténer saját Node-ja ettől nem változik (lent külön tétel).
- [ ] **N7.** `engines: { node: ">=24" }` a `package.json`-ban, commit; bump: patch.

**Door:** N1–N5 appokként kétirányú (pin vissza), egy-egy app a hatókör. N6 az egész box pm2-ét érinti, a mentett .deb-bel visszafordítható. A kiesés appokként egy pm2-restart (kb. 1 s, a maintenance-oldal mögött).

**Prediction:** az app viselkedése nem változik, a tesztek Node 24-en ma is zöldek. A deploy idejét a `npm ci` növeli. Ismeretlen: a Next 16.4.5 és a playwright viselkedése a box Node 24-én (helyben 24.13.1-en fut), és a customBrain igényei.

### Mellékes tételek (külön, nem ebbe a cserébe)
- [ ] **postgres:16 konténer (16.14):** a többi boxon 16.15–16.16 fut. A minor-frissítés image-csere, adatmigráció nélkül, de a közös DB mindkét tenantot és a többi appot érinti. Előtte `pg_dump`; az infra-map szerint az image-ek `:latest`-en vannak, és véletlenül nem pullolunk. Hogy van-e újabb `postgres:16` image, azt nem néztem meg.
- [ ] **supabase studio (Next 16.2.6):** csak a 127.0.0.1-en érhető el, ezért alacsony prioritás. Frissítése image-pull a studióra.

## 2026-11-23 — AGENTS.md méretkapu pre-commit hookban (TERV, Robi go-jára vár)

Kérés: a Learning session üzenete, Robi szavával („Igen, szólj nekik”). A Codex a projekt `AGENTS.md`-jét csak 32 768 bájtig olvassa, a többit szó nélkül levágja. Minta: `~/bizi/.githooks/pre-commit` (`2b39634`, csak olvastam).

**Megfigyelve (2026-11-23):**
- Az `AGENTS.md` most 9 894 bájt, jóval a bizi 26 000 bájtos küszöbe alatt.
- A `core.hooksPath` itt a klón saját `.git/config`-jában van beállítva, abszolút úton a `.git/hooks`-ra. Ez az alapértelmezett hely, és csak `*.sample` fájlok vannak benne, tehát ma egyetlen hook sem fut.
- Ki állította be: nem tudom. A projekt egyik Claude-átiratában sem szerepel (grep a session-átiratokon), és a többi repóban (customBrain, confAi2, HINT-map, nexus, brandBrain) nincs beállítva. Mivel az alapértelmezett helyre mutat, az átírással semmi nem vész el.
- A `core.hooksPath` a közös configban van, ezért a worktree-kre is hat. A relatív `.githooks` worktree-nként oldódik fel. Ahol még nincs `.githooks` (például a zod-session ága a merge előtt), ott ugyanúgy nem fut hook, mint ma.

**Touches:** repó-tooling (`.githooks/pre-commit`, új), ennek a klónnak a git configja, és egy sor az `AGENTS.md` „Workflow notes” részében. Az app futását nem érinti, szemantikai modell nincs.

**Door:** kétirányú. A commit `git revert`-tel visszavonható; a config visszaállítása: `git config core.hooksPath /Users/robertbeliczki/messagingmatrix6/.git/hooks`.

**Prediction:** ha az `AGENTS.md` a commitban van és 26 000 bájt fölött van, a commit elutasul; ha alatta, átmegy; ha nincs a commitban, a hook semmit nem csinál. A hook a stage-elt változatot méri (`git show :AGENTS.md`), így egy pathspec-es commit is átmegy rajta. Próba egy eldobható worktree-ben, a bizi mintájára: túlméret → elutasítva; normál és `AGENTS.md` nélküli commit → átmegy.

**Szeletek:**
- [ ] **H1** `.githooks/pre-commit` a bizi mintájára (POSIX sh, futtatható). A hibaüzenet a Codex 32 768 bájtos határát nevezi meg; „Méret” sor nincs az `AGENTS.md` tetején, ezért arra nem hivatkozik.
- [ ] **H2** Egy sor az `AGENTS.md` „Workflow notes”-ába: „Once per clone: `git config core.hooksPath .githooks` (the AGENTS.md size gate)”. Enélkül egy új klónban a kapu csendben hiányzik.
- [ ] **H3** `git config core.hooksPath .githooks` ezen a Macen, és a három próba egy eldobható worktree-ben.
- [ ] **H4** Commit: `.githooks/pre-commit`, `AGENTS.md`, és a `tasks/todo.md`-ből **csak ennek a szakasznak** a hunkjai. A ma írt többi todo-szakasz (a régi MM-é a kulcsszivárgással együtt) addig ne kerüljön a nyilvános repóba, amíg a kulcs nincs visszavonva és a fájlok nincsenek offline. Push Robi go-jára. Bump nincs, mert ez tooling.

### Állapot, 2026-11-23 délután
- **A zod-patch kint van:** 6.132.1 (`13386ba`), az origin/main-en, mindkét tenanton deployolva (erste 10:58 UTC; Robi go-ja a zod-sessionben). Ezzel a body-limit S3-ja (`.max()` a javított zodon) nem vár tovább; a „0 elem-hívás” tesztet a merge-elt lockfile-on futtatom.
- Ez a checkout 4 committal az origin/main mögött van, és itt nem commitolt todo-szakaszok vannak. A következő commit előtt pullolok, és a todo.md végét kézzel fésülöm össze.

## 2026-11-23 — mc-export 11.xlsx: képleírás az 1080x1080-as kreatívokra (LEFUTOTT 21:14 UTC; nyitott: Robi Sheets-ellenőrzése)

Kérés: a `local_2a015641` session átadó jegyzete (`mc-export-11-handover-2026-11-23.md`), Robi: „csak jóváhagyás után írj a DB-be vagy a táblába”. A kör (163 vagy 434) nyitott.

**Megfigyelve (2026-11-23 16:30 UTC, élő DB + a Drive-on lévő xlsx, ami 11:59 óta nem változott):**
- 579 aktív Erste kreatív 1080x1080 (`file_dimensions` és fájlnév egyezik). 145 olvasott (118 `kepleltar-v1`, 27 `kepleltar-video-v1`), **434 olvasatlan**: 431 kép (275 png, 156 jpg), 3 mp4; 145 MC, 258 (MC, betű) design. Mind a 434 sha256-ja különböző, tehát duplikátum-szűréssel nem spórolunk.
- A táblában a 434-ből **163 látszik** Robi szűrőjével (mind kép, 30 MC, 63 design); 268 kép + 3 videó rejtett sorban van.
- `export-creatives-for-reading.ts --missing` méretszűrő nélkül **2794** fájlt írna ki (minden méret). Kell egy `--dims` szűrő.
- A meglévő olvasatok mintája: a szöveg soronként, „ERSTE”-vel kezdve, a THM pontosan; a leírás magyar, legfeljebb 3 mondat (átlag 107 / 196 karakter). Az eredeti olvasó-promptot nem találtam (repo, mappák), a mintákból rakom össze.
- Az `image_read_model`-t csak a `gen-mc-export.ts` olvassa (az xlsx V oszlopa), logika nem épül rá.
- Táblaoszlopok: S `image_text`, T `image_description`, U `image_read_at`, V `image_read_model`, W `updated_at`. Az import a DB-ben az `updated_at`-et is átírja, ezért a W-t is frissíteni kell, különben a tábla és a DB eltér.
- Képköltség, mérve ebben a sessionben (`get_usage` különbség): egy 1080x1080 kép ≈ 1,6–1,7 ezer input token.

**Touches:** `creatives.image_text / image_description / image_read_at / image_read_model / updated_at` (élő DB, Erste), a `scripts/export-creatives-for-reading.ts` (új `--dims` kapcsoló), és az ERSTE mappában lévő `mc-export 11.xlsx` „Creative export” füle (S–W oszlop). Szemantikai modell nincs. A REBUILD_SPEC ezt a mezőt nem tárgyalja (nem kerestem benne célzottan).

**Door:**
- DB: egyirányú (éles adat), de kis sugarú és visszaállítható: csak `image_text IS NULL` sorok kapnak értéket, az audit őrzi az előtte-értéket (null). Rollback: `UPDATE creatives SET image_text=NULL, image_description=NULL, image_read_at=NULL, image_read_model=NULL WHERE id IN (<a kör id-listája>) AND image_read_at >= '<futás kezdete>';`
- Tábla: a Drive megőrzi az előző revíziót, és helyi másolat is lesz róla. Közösen használt ügyfélfájl, ezért ezt a lépést egy friss kontextusú reviewer is megnézi.

**Prediction:** a kör minden sorában az S–V kitöltve, a W megegyezik a DB-vel; minden más cella, a szűrő, a rejtett sorok és a Q-képletek bájtra/értékre változatlanok. Az import száraz futása `írva: N, nincs találat: 0, többértelmű: 0`. Ismeretlen: mennyi plan-keretet eszik (ezt a pilot méri), és hogy a Sonnet-olvasó hozza-e a THM-pontosságot (ezt a pilot vak próbája méri).

**Seam:** az `import-image-readings.ts` (a leltár-xlsx → DB), és az xlsx cellái a csere előtt/után összevetve.

**Fordulat (Robi, 2026-11-23 17:20): az olvasást a Codex végzi, 3 csomagban, csomagonként egy xlsx és a letöltött képek egy mappában.** Ez a Codex saját munkamappája, a repón és az élesen kívül (globális szabály: Robi közvetlen kérésére a Codex ott végrehajthat). A DB-be és a táblába továbbra is Claude ír, Robi go-jára. Az alábbi Sonnet-becslés ezzel elavult, csak összevetésnek marad.

**Codex-csomagok** (`~/ERSTE Addressable AI Agent/problematic creatives/round4-1080-codex/`): `csomag-1/-2/-3` = 144 / 144 / 143 kép (48 / 49 / 48 MC, egy MC egy csomagban; a látható 163-ból 71 / 37 / 55). Mappánként `kepek/`, `kepleltar.xlsx` (a régi 4 oszlop, útvonal `kepek/idNNNN__…`) és `OLVASD-EL.md` (a szabályok a 36 meglévő 1080x1080 olvasatból). A 3 mp4-et a `view_image` nem nyitja: a záró kockájuk a `round4-1080-video/`-ban, azokat Claude olvassa (`kepleltar-video-v1`).

**Pilot (megfigyelve, Codex 0.171, gpt-6-astra, xhigh):**
- 1. pilot, 10 kép (5 vak, már olvasott + 5 új): 313 s, 95 898 Codex-token. Minden THM és összeg karakterre egyezett, de a sorrend a képi helyet követte (a kör a logó elé került; az én „fentről lefelé” szabályom hibája), a telefon- és kártyaképernyőt szinte teljesen átírta, és egyszer „Személyi kölcsön”-t írt a képen álló „Személyi Kölcsön” helyett (a képen ellenőriztem).
- Az `OLVASD-EL.md` javítva: kötött sorrend (logó → főszöveg → THM → kör → gomb → lábjegyzet → tárgyszöveg), tárgyról csak cím-szintű szöveg, a fotó véletlen feliratai nem kellenek, a nagybetűre külön figyelmeztetés.
- 2. pilot, 7 kép (ugyanaz az 5 vak + a 2 `[olvashatatlan]`-os): 208 s, 70 228 token. **Az 5 vakból 5 helyes.** Az egy kiírt eltérés a régi olvasaté: az id13803-nál a `kepleltar-v1` egy sorba írta, hogy „ERSTE | VISA” (szó szerinti függőleges vonallal).
- Extrapoláció: ~30 s és ~10 ezer Codex-token képenként, csomagonként ~72 perc és ~1,45 M token, a három együtt ~4,3 M; párhuzamosan ~75 perc. Hogy ez a Codex-keret mekkora része, nem tudom.

**Token-becslés — elavult (olvasás Sonnet-subagentekkel, 40 kép/agent, 8 kép/kör; a kimenet ~150–300 token/olvasat, becslés):**
| kör | agent | egyedi input | összes feldolgozott input (cache-elt újraolvasással) | output |
|---|---|---|---|---|
| pilot | 1 | ~40 ezer | ~0,1 M | ~5 ezer |
| 163 | 4–5 | ~0,3 M | ~1,0 M | ~40 ezer |
| 434 | 11 + 3 videó | ~0,8 M | ~2,7 M | ~110 ezer |
Ehhez jön ennek a sessionnek a saját költsége: ~150 ezres kontextus, minden körömben újraküldve (cache). Ezért kevés kört csinálok (az agentek egyszerre indulnak, rövid riporttal). Hogy ez a plan-keret hány százaléka, nem tudom; a pilot előtt/után leolvasom (16:30-kor: 5 órás 22%, heti 50%).

**Szeletek:**
- [x] **K1** `--dims` kapcsoló az `export-creatives-for-reading.ts`-be (nincs commitolva). Export: `round4-1080/` 434 fájl (431 kép + 3 mp4); videókockák: `round4-1080-video/` (11 záró kártya, 4 kontaktlap; ebből a 18203, 18205, 18300 kell).
- [x] **K2 Pilot** — Codexszel, két körben, lásd fent. Az 5 vakból 5 helyes.
- [x] **K3** **Robi go** → a három csomag párhuzamosan: `codex exec -s workspace-write --skip-git-repo-check -C <csomag> "Olvasd el az OLVASD-EL.md fájlt…"`. Claude utána ellenőrzi: minden sor kitöltve, az A/B oszlop és a sorszám változatlan, nincs `[olvashatatlan]` a THM-ben, szúrópróba MC-nként. A 3 videót Claude olvassa.
  - **Lefutott (Robi go: „Igen, indítsd”), 16:46–17:04 UTC:** 144 / 144 / 143 sor kitöltve, csomagonként ~16 perc és ~283–316 ezer Codex-token (képenként ~7 s, a pilot negyede). A fejléc, az A/B oszlop és a sorrend változatlan.
  - Szúrópróba a képen (Claude): 4 véletlen kép szövege karakterre helyes. **A THM viszont egy helyen hibás:** az id17164 képén `THM: 0,74 – 8,92%` áll, a Codex `9,02%`-ot írt. Mind az 5 `n4` munkáshitel-fájl `9,02`-t kapott; a fájlnevük `8_98`-at mond (elavult szelet), a kép 8,92-t.
  - **Valódi elírás az ügyfélkreatívon:** az id16188 (befektetés, „Vedd kézbe a befektetéseid”) képén „piacokegy helyen” áll; a Codex betűhíven átírta. Az id16188 telefonsorát (`[olvashatatlan]`) kivettem.
  - A 3 videó olvasata kész (`round4-1080-video/kepleltar-video.xlsx`), a száraz import: `írva: 3`.
- [x] **K3b** Független számellenőrzés: második Codex-menet `SZAMOK.md` szerint, csak a számok, nagyítva, a `kepleltar.xlsx` megnyitása nélkül → `szamok.csv` (5–8 perc és ~150–180 ezer token csomagonként; az xlsx-ekhez nem nyúlt). A számjegyek 431-ből 423-nál egyeztek. A 8 eltérést Claude a képen döntötte el:
  - 5× az első menet tévedett: `n4` munkáshitel, `9,02%` → `8,92%` (17164, 17176, 17192, 17204, 17218);
  - 1× az első menet egy kivágott részletet írt le (15168: hiányzott a logó, a THM és a gomb, a leírás „üres” felső és alsó részt mondott) → átírva;
  - 2× az első menetnek volt igaza (16894, 16895: a szám az ikonon is szerepel).
  - Ezen felül javítva: 16891 és 17247 (hiányzó `ERSTE`), 15143 („Sharpie” → „Nincs szöveg a képen.”), 16188 (az `[olvashatatlan]` telefonsor törölve). Napló: `round4-1080-codex/claude-javitasok.tsv` (a 16188 előtte készült, nincs benne).
  - Ami nem számot érint (kihagyott gomb, logó), azt a számellenőrzés nem fogja meg. Ehhez a „nem ERSTE-vel kezdődik” jelzés és 4 véletlen szúrópróba maradt (4/4 helyes).
- [x] **K4** Száraz futás: csomag-1/2/3 `írva: 144 / 144 / 143`, videó `írva: 3`; nincs találat 0, többértelmű 0. **Éles import (Robi: „Igen, mehet”), kezdés 2026-11-23 17:15:47 UTC:** 434 írva, 434 audit-sor; mind az 579 db 1080x1080-nak van olvasata (549 `kepleltar-v1`, 30 `kepleltar-video-v1`). Rollback: `round4-1080-codex/import-id-lista.txt` + `import-start-utc.txt`.
- [x] **K4b Méret-testvérek** (Robi, import közben: „az azonos nevűek, csak méretben különbözőek kitölthetők ez alapján, mert csak méretmutációk; esetleg egy plusz CTA-ban különböznek”). Kulcs: a fájlnév a WxH nélkül, a kiterjesztéssel együtt. A 687 már saját olvasattal bíró testvérből 283 karakterre azonos a 1080-assal, 391 csak egy plusz sorban tér el (szinte mindig `Érdekel`), 13 más szövegű, THM-eltérés 0. **2059 testvér kitöltve** (2053 kép `kepleltar-v1-1080`, 6 videó `kepleltar-video-v1-1080`), kezdés 17:18:15 UTC, 2059 audit-sor. A leírás képi elrendezése a többi méreten eltérhet; ezt a címke jelzi. Rollback: `round4-1080-meret-testverek/import-id-lista.txt` + `import-start-utc.txt`. Az Erste 3844 aktív kreatívjából most 3530-nak van olvasata, 314-nek nincs (nincs 1080-as testvérük).
- [x] **K4 (eredeti terv; lefutott, lásd fent)** `import-image-readings.ts <csomag>/kepleltar.xlsx --model kepleltar-v1 --dry` mindhárom csomagra (a videókra `--model kepleltar-video-v1`) → `nincs találat: 0, többértelmű: 0`. **Robi go** → éles import, id-lista mentve a rollbackhez.
- [x] **K5 (lecserélve 2026-11-23 21:14 UTC)** 2493 sor (434 + 2059) S–W-je a DB-ből, `patch_sheet.py` (scratchpad). Megfigyelve: csak a célsorok S–W cellái változtak, a többi zip-tag bájtra azonos, a sor-attribútumok (rejtett, magasság) és a 2054 képlet azonos, a sheetData-n kívüli rész azonos, 2493/2493 célsor egyezik a DB-vel, Excel javítás nélkül nyitja („mc-export 11.xlsx”, 2 lap). Drive: modifiedTime 2026-11-23T10:59:55Z, 496 889 bájt, md5 `cf852335…` = az alap. **Friss reviewer: OK with changes.** A fájlban hibát nem talált: expat-parse tiszta, `unzip -t` tiszta, 2493 sor × 5 cella változott, minden más bájtra azonos, 0 vezérlőkarakter, a W stílusa (quotePrefix) megmaradt. Jelzett, de itt nem tüzelő hibák a `patch_sheet.py`-ban: megosztott-stringes A-cella, önzáró `<row/>`, olyan `<c>`, ahol nem az `r=` az első attribútum. Kozmetikai: a `sharedStrings` `count` elavult (az Excel így is javítás nélkül nyitja), a `sortState` (W szerint) nem egyezik a sorrenddel (ez már előtte is így volt). Nem ellenőrzött: hogyan kezeli a Google Sheets az `inlineStr`-t és a Google `roundtripDataChecksum`-ot. Ezt a csere után Sheetsben kell megnézni. Az ellenőrzőm képlet-számolása a `<filter>` tagot is számolta; újraszámolva 398 → 398 valódi képlet-tag.
  - **Újraellenőrizve 2026-11-23 21:10 UTC** (a kontextus törlése után): a Drive-fájl md5-je még mindig az alapé (`cf852335…`); a `verify_patch.py` újrafuttatva: 2493/2493 célsor = DB, nem várt eltérés 0. A tábla 10:59:55-ös alapja óta a célsorokon kívül csak a 18198–18200 változott (az archiválás, 11:52 UTC), és ezek már nincsenek a táblában. Az Erste-kreatívok utolsó változása 17:21:30 UTC.
  - A javított másolat, az alap és a két szkript a `/tmp`-ből kimentve: `round4-1080-codex/tabla-csere/` (`mc-export 11.javitott.xlsx`, md5 `ec41f5a8…`; `mc-export 11.alap.xlsx`, md5 `cf852335…`).
  - **Csere (Robi: „Igen, mehet”), 21:14:33 UTC:** közvetlenül előtte a Drive-fájl md5-je az alapé volt, a `viewedByMeTime` 10:59:55 (azóta senki nem nyitotta meg), az Erste-kreatívok utolsó változása 17:21:30. Helyben felülírva a mounton (`cat >`, nem `mv`), az rclone 10 s alatt feltöltötte.
  - **Megfigyelve utána:** ugyanaz a fájl-id (`1SJUW9Sh…`), 621 651 bájt, modifiedTime 21:14:33.623Z, a Drive-szerver md5-je `ec41f5a8…` = a javított másolat. A Drive-ról közvetlenül (`rclone cat`, a mount-cache nélkül) letöltött fájl bájtra azonos a javítottal, `unzip -t` tiszta, a `verify_patch.py` az alaphoz képest: nem várt eltérés 0, a sor-attribútumok és a 2054 képlet azonos, 2493/2493 célsor = DB.
  - **Rollback:** a Drive megőrizte az előző revíziót (11:00:32 UTC, `0B6MahnrpfUMVV2Rh…`, nincs kitűzve, tehát a Drive 30 nap után törölheti), és ott van a helyi alap (`tabla-csere/mc-export 11.alap.xlsx`). Visszaállítás: `cat alap > mount`, ugyanígy.
  - **Nem ellenőrzött:** hogy a Google Sheets jól mutatja-e az `inlineStr` cellákat és megtartja-e a szűrőt (308 látható sor). Ez Robi ellenőrzése Sheetsben.
- [x] **K5 (eredeti terv; lefutott, lásd fent)** Táblába írás XML-szerkesztéssel: a `sheet2.xml`-ben csak a kör sorainak S–W celláit írom (inline string, a szomszéd sorok stílusával), a W-t a DB-ből. Ellenőrzés: openpyxl-diff az eredetihez (csak a várt cellák változtak), szűrő, rejtett sorok és Q-képletek változatlanok, Excelben javítás nélkül nyílik. Friss reviewer. **Robi go** (és zárja be a fájlt a böngészőben) → csere az rclone mounton ugyanazon a fájl-id-n; Drive `modifiedTime` + újraletöltés + diff.
- [x] **K6** Review-szakasz ide, az átadó jegyzet frissítése. Bump nincs (a szkript tooling, az adat nem kód).

**Eldöntve (Robi):** a kör 434 + 2059 méret-testvér; az xlsx-írás XML-szerkesztéssel; a címke `kepleltar-v1` (a testvéreken `kepleltar-v1-1080`). **Nyitott:** Robi Sheets-ellenőrzése (S–W, szűrő); a `--dims` kapcsoló nincs commitolva.

**Review (2026-11-23):**
- *A jóslat bevált:* a kör minden sorában kitöltött az S–V, a W = DB, minden más cella, a szűrő, a rejtett sorok és a képletek változatlanok; a száraz importok `nincs találat: 0, többértelmű: 0`. A kör menet közben nőtt Robi döntésére (+2059 testvér).
- *Ami nem jött be:* a pilot vak próbája (5/5 helyes) nem fedte le az `n4` munkáshitel-családot, ahol a Codex első menete mind az 5 fájlon hibás THM-et írt (9,02% a képen álló 8,92% helyett). A független számellenőrzés (K3b) mind az ötöt megfogta, és egy kivágott részletet is (15168).
- *Ismeretlenek:* a Sonnet-olvasó nem kellett (Codex olvasott); a Codex-költség: a 3 csomag ~0,9 M token, a számellenőrzés ~0,5 M token.
- *Lecke (javaslat, Robi dönt):* a független, csak-szám második menet legyen minden olvasási kör kötelező lépése. Önműködő ellenőrzésként: az `import-image-readings.ts` egy `--szamok <csv>` kapcsolóval megtagadhatná az importot, ha a `image_text` THM-je és a második menet száma eltér. Ha ez túl sok, akkor egy sor az olvasási kör leírásába (`OLVASD-EL.md`-minta).

## 2026-11-23 — Kreatív-manifest: leírás és kulcsszavak a leadással együtt (TERV, 1. lépcső, Robi go-jára vár)

Kérés (Robi): amikor a Codex a leadást gyártja, adjon mellé egy `manifest.json`-t MC-nként és variánsonként, és a mátrix ebből töltse ki a kreatívok adatait. Döntések: **1. lépcső = manifest + betöltő szkript, felületi változás nélkül**; a `visual_keyword` **csak ott kap értéket, ahol üres**. A `copy_keyword` a headline és a copy kulcsszavai, a `visual_keyword` a vizuális leírás kulcsszavai.

**Megfigyelve (2026-11-23, élő DB, Erste, 3844 aktív kreatív):**
- `visual_keyword`: 3093 kitöltve, ebből 3033 szó szerint a fájlnévben van (kampány-szelet, pl. `BeErste3Q2_personas`), a maradék 60 egy régebbi elnevezés szelete (`MCx_b_BefCast`). Csak a 2026-08-13 előtt létrehozott kreatívokon; a 2026-09-03 óta feltöltött 751 mind üres.
- Az Erste `creativeParsingRules`-ban (config tábla) nincs `visualKeyword` szabály, ezért a feltöltés nem tölti. A régi értékek valószínűleg a régi Erste-forrástábla „Visual_keyword” oszlopából jöttek (`src/lib/import-xlsx.ts:438`); ezt importfuttatással nem ellenőriztem.
- `copy_keyword`: sehol nincs kitöltve (0). Csak az `import-xlsx` írná, a „Visual_description” oszlopból (`:439`), és az MCP `creative_upload` explicit értékként.
- Eddigi forma: egy token, szóköz és vessző nélkül, aláhúzással összefűzve. Képleírásból egyik sem jött; az audit szerint senki nem írt kulcsszót olvasásból.
- REBUILD_SPEC (2026-09-06) §3.4: a `visual_keyword` „Filter taxonomy”, §6.4: a feltöltéskor a fájlnévből auto-parse. A `copy_keyword` jelentését nem írja le. **A döntéssel a `visual_keyword` jelentése kettős lesz:** a régi sorokon fájlnév-szelet, az újakon a vizuális leírás kulcsszavai. Robi így döntött („Csak az üreseket”).

**Touches:** új `src/lib/creative-manifest.ts` (zod-séma + `applyCreativeManifest`), új `scripts/import-creative-manifest.ts` (vékony CLI), a `creatives` hat mezője (`image_text`, `image_description`, `image_read_at`, `image_read_model`, `copy_keyword`, `visual_keyword`) + `updated_at`, és az `audit_log`. Az `import-image-readings.ts`-hez nem nyúlok. Szemantikai modell nincs.

**Door:** a kód kétirányú. Az adat: csak üres mezőt tölt, minden írás auditált (előtte-érték: null); rollback a futás id-listájával, mezőnként vissza nullra.

**A manifest formája (javaslat):**
```json
{ "version": 1, "client": "erste", "source": "codex",
  "groups": [
    { "mc": 101, "variant": "c",
      "image_text": "ERSTE\nSzemélyi kölcsön\n…", "image_description": "…",
      "copy_keyword": "személyi kölcsön, fix kamat, karrierváltás",
      "visual_keyword": "férfi, kávézó, szemüveg, laptop",
      "files": ["ERSTE_SZK_MC101_c_…_n1_1080x1080.png", "…_300x250.png"] } ] }
```
- Egy csoport = azonos adatú fájlok (jellemzően egy MC + variáns + verzió). Ha egy méreten más a szöveg, az külön csoport.
- Párosítás: pontos `file_name` egyezés a kliens aktív kreatívjai között. Ha a talált kreatív MC-je vagy variánsa eltér a csoportétól, nem ír, hanem hibát jelez. Nincs találat vagy több találat esetén is jelez.
- Csak üres mezőt tölt (mind a hatot). `image_read_model = codex-manifest`, hogy látszódjon: „adott”, nem „olvasott”.
- Kulcsszó-forma: 3–6 kulcsszó, kisbetűvel, magyarul, vesszővel elválasztva (Robi még nem hagyta jóvá).

**Prediction:** a száraz futás fájlonként listázza: írandó mezők / már kitöltött, kihagyott mezők / nincs találat / többértelmű / MC-eltérés. Változatlan marad minden kitöltött mező és minden, a manifestben nem szereplő kreatív. Ismeretlen: a Codex leadás-folyamata hol él, vagyis hová kerül a manifest-utasítás.

**Seam:** `applyCreativeManifest(db, clientId, manifest, { dry })`. A 2. lépcső (feltöltés) ugyanezt hívja majd. Integrációs teszt a teszt-Postgresen: üres mezőt tölt; kitöltött `visual_keyword`-öt nem ír felül; ismeretlen fájlt jelez; MC-eltérésnél nem ír; a `dry` semmit nem ír.

**Szeletek:**
- [ ] **M1** Zod-séma + `applyCreativeManifest` + integrációs teszt (előbb piros).
- [ ] **M2** `scripts/import-creative-manifest.ts <manifest.json> [--client erste] [--dry]`, összesítő riporttal.
- [ ] **M3** A formaleírás a Codexnek: a séma a repóban a szerződés; a rövid utasítás oda kerül, ahol a Codex leadás-promptja él (Robi mondja meg, hol).
- [ ] **M4** Az első valódi leadáson: száraz futás → Robi go → éles.
- Bump: nincs, amíg csak szkript használja (tooling); a 2. lépcső (feltöltés) minor lesz.

**Nyitott (Robi):** a kulcsszó-forma (az ajánlásom: 3–6, kisbetű, vessző); hol él a Codex leadás-folyamata; felülírhatja-e a manifest a meglévő `image_text`-et újrafeltöltéskor (az ajánlásom: nem, csak üreset tölt, a kulcsszavakkal egyezően). Lehetséges folytatás: a meglévő kreatívok kulcsszavai a már leolvasott `image_text` / `image_description`-ből, egy szöveges Codex-menettel, ugyanezzel a manifesttel.
