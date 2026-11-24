# MessagingMatrix v6 — active roadmap + checkpoint

**Ez a lean, aktív fájl.** A teljes történelem (Phase 0–10 logok, összes deploy- és session-checkpoint 2026-04 → 2026-11-11, minden lezárt epic-log) szó szerint megvan itt: **`tasks/todo-archive.md`** (~9100 sor). Ott semmit nem törlünk — ez a hosszútávú emlékezet.

**Kész munka:** a kész, élesben lévő munka és a lezárt vagy felülírt tervek szó szerint a **`tasks/todo-done.md`**-ben vannak (szétbontva 2026-11-23). Ha egy szakasz elkészül, egészben annak a tetejére költözik.

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

- **Verzió: `6.132.0`**, él mindkét tenanton a Hetzner boxon: `erste.messagingmatrix.ai` (pm2 `mm6-erste`) és `telekom.messagingmatrix.ai` (pm2 `mm6-telekom`). Deploy: `DEPLOY.md`.
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

### Apróság-kör (user, 2026-09-10) — M12 + M9.1 + M4.2
Tételenként külön commit, `tsc` + vitest mindegyik után. A `MultiPill`-hez csak az M12.1 nyúl. Végén egy minor bump + CHANGELOG.

### M9 — MC archive/delete edit módban: már megoldott, csak a súgószöveg hiányos (user-döntés, 2026-09-10)
Az edit-mode panel Delete gombja archivál vagy töröl (M10 dialog), tehát az MC archiválás use-case-e **megvan** — az egykori M9.1 (külön Archive gomb a `MessageEditor` headerben) **kikerül**, nem építjük.
- [ ] **M9.1** `EditModePanel.tsx:40` súgószöveg bővítése: „Add / duplicate topics and audiences; add, copy and move Messaging Cards." → vegye fel, hogy **MC delete és archive** is edit módban érhető el (a Delete gomb dialogja dönt). Copy-only, semmi logika.
- [ ] **M9.3** (szomszédos, külön commit) audience/topic Archive-akció a `DimensionEditPanel`-be — a restore route-ok + editor-szintű showArchived már élnek, csak a panel kínál ma kizárólag hard-delete-et.

### M4 — Crosshair highlight (sor+oszlop) hover + click-pin
- [x] **M4.1 (✅ KÉSZ, 6.24.0, 2026-08-25)** Él-rail crosshair, NEM state-alapú. Imperatív (`GridView.paintCrosshair` + delegált `onMouseOver`/`onMouseLeave` a `<table>`-ön, ref) → hoverkor nincs grid-újrarajzolás. `data-col-key`/`data-row-key` a 2 header-`<th>`-re + mindkét cella-`<td>`-re; a `c`+`c-1` oszlop `border-right`-ja és a `r`+`r-1` sor `border-bottom`-ja kap `--mx-cross` színt (`matrix-grid__x--edge-r`/`--edge-b`, unlayered CSS). Csak meglévő border SZÍNE vált → **0 layout-shift**, `transition: border-color 140ms` → nem villódzik. Edit módban is megy (border-color ≠ ring box-shadow). Header-hover = csak az az oszlop/sor. Korlát: legszélső bal oszlop / legfelső sor külső élét a sticky header adja (nincs `c-1`/`r-1`).
- [ ] **M4.2** Click-to-pin: kattintásra pinnel escape/újraklikkig; a chip-open klikket nem nyeli el. ⚠️ OPEN Q: pin+hover mindkettő.

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

### UI-apróságok (mátrix + editor + library)

### Monitoring maradék (Wave 3)
- ~~**W3.g** Matrix cella stat-badge~~ — **KIVEZETVE (user, 2026-09-10).** Nem kell. (Tény a jövőnek: az adat-út kész lenne — `useMessageMetrics` + `/api/monitoring/message-metrics` per-`messageId` impr/cost/conv-ot ad; csak `clicks` hiányzik a `MessageMetricRow`-ból a CTR-hez.)
- [ ] **W3.h → átkeretezve, saját szelet, NEM UI-apróság (user: „most túl nagy", 2026-09-10).** Unmatched sor → message kézi link. **A naiv megoldás némán elveszik:** a monitoring import **periódusonként töröl + újratölt** minden sort (`import/route.ts:121-135`), tehát egy kézzel beírt `monitoring.messageId` **eltűnik a következő feltöltéskor** — és a W3.j-6 (mind a 4-5 riportfájl újraimportja) nyitva áll, szóval ez biztosan bekövetkezik. Túléléshez: override-tábla a **message-kulcsra** (`mcNumber+variant+audienceKey+topicKey` vagy pmmid) + **4. resolver-szint** a `buildMessageResolver`-ben + reapply-pass. Kész minta: `resolveProduct` keyword→product szabályok + `/api/monitoring/reapply-products` — **szabály, nem soronkénti kézimunka**, és épp ezért éli túl az újraimportot. **Első lépés felméréssel:** hány unmatched sor van, ebből mennyi `family_known` vs teljes no-match, és mennyi impressziót visznek — a szám dönti el, megéri-e bármit építeni.
- Deferred: **Meta parser/resolver** — blokkolva valós Meta export sample-ig.

### Agent-oldal (MCP + provenance)

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
- [x] **Kis fix (patch):** `npm update zod body-parser qs fast-uri ip-address`, zod `^4.6.6`. 2026-11-22-én még a sérülékeny verziók futnak (zod 4.4.1); külön task-kártya javasolva („mm6: zod és társai biztonsági patch”). **Kész:** 6.132.1 (2026-11-23), mindkét tenanton kint; a lockfile-ban zod 4.6.7. Törzs: `todo-done.md`, „2026-11-23 — Függőség-patch”.
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
- [ ] **`.thumbs` takarítása törléskor + méretriport** (2026-11-12, 6.129.0, CA 5. pont): a `.thumbs` alatti WebM-ek és stillek törlése, amikor a fájl vagy a share törlődik. Törzs: `todo-done.md`.
- [ ] **Dev-audit: vitest 3 → 4 (major)**, plusz a drizzle-kit és a typescript-eslint lánca (2026-11-23, a 6.132.1 follow-upja): külön feladat, a `dependencies.md` szerint ütemezve. Törzs: `todo-done.md`.
- [ ] **`mm6-deploy`: csak a lockfile `packages` részét hash-elje** (2026-11-23, a 6.132.1 tanulsága, Robi dönt): ma a teljes `package-lock.json` sha256-ja dönt az `npm ci`-ről, így a gyökér-verzió változása is `npm ci`-t indít az élő app alatt; a kézi bump-szabály ezt csak folyamatban kerüli el. Törzs: `todo-done.md`.

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
- [x] **S2** `limitBody` + a wrapperek + a három nyilvános route + `/mcp` + 413-naplózás; az `adform-snapshots` és a `monitoring/import` megkapja a hiányzó méret-ellenőrzést. S0 tesztjei zöldek.
- [x] **S3** (a zod-patch merge-e után, és csak ha a merge-elt lockfile-ban a mért zod-verzió van) `.max(n)` a 18 korlátlan tömbre, egyenként; a meglévő `mc_labels` `.max(20)` marad. A „0 elem-hívás” tesztet a merge utáni lockfile-on megismétlem; `tools/list`-diff a baseline-hoz.
  - **Plusz, zod-verziótól függetlenül:** `new McpServer(info, { maxToolInputElements: 50_000 })` a `buildMcpServer`-ben. Az SDK 1.32.1 `validateToolInput`-ja a zod-validálás **előtt** megszámolja a tömbelemeket és az objektumkulcsokat, és a limit fölött `InvalidParams`-ot dob (ellenőrizve: `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js` 210–212). Egy teljes mezős `mc_update_batch`-sor kb. 39 elem, tehát az 500-as batch kb. 20 000 elem. A testvér-session (`mm6: JSON body limits…`) szerint a `tools/list`-et nem változtatja. Teszt az SDK Clienten és `InMemoryTransport`-on át, mert a meglévő tesztek közvetlenül a handlert hívják, és kihagyják a `validateToolInput`-ot.
- [x] **S4** Verify (`npm test`, `tsc`, lint), diff-review külön reviewerrel (security), deploy telekom → erste Robi go-jával, az AGENTS.md teljes „After” listájával.
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
  - Az app futás közben nem használja: az `src`-ben csak kommentben szerepel. Két régi script használja (`scripts/seed-perf.ts`, `scripts/backfill-to-pg.mjs`). *(Pontosítva 2026-11-23: csak a `backfill-to-pg.mjs` importálja; a `seed-perf.ts` a PG-s `src/db`-t használja.)*
  - Javaslat (Robi dönt): **(a)** `better-sqlite3` → 12.12.0, egy függőség-patch a Node-csere előtt. Vagy **(b)** a függőség és a két script törlése. Vagy **(c)** fordítás a boxon.
- A `mm6-deploy` csak lockfile-változáskor futtat `npm ci`-t (`node_modules/.mm6-lock-sha`). Node-csere után ezt kézzel kell kikényszeríteni (a stamp törlése), különben a régi ABI-jú natív modulok maradnak. *(v2: az N2/N4 nem futtat `npm ci`-t, mert a P1 után minden natív modul N-API. Az első Node 24-es telepítés és build előbb izoláltan fut (P2), élesben pedig az N8-ban, a stamp törlésével.)*

**Terv v2 (2026-11-23 23:45; a v1 Codex-Stopja után; review-kérés: `~/agent-bus/requests/20261123-2345-mm6-boxb-node24-v2.md`, benne a box-útvonalak és a parancsok).** A v1 „Sorrend” és „Lépések” része helyett ez érvényes. Az előfeltételek (kernel, régi MM, zod) megvannak, lent.

**A fő változás:** a P1 (`better-sqlite3` törlése) után a boxon minden natív modul N-API (megfigyelve, `nm -D`, 8/8), a `.next` pedig Node-verziótól független JS. Ezért az N2/N4 csak futtatókörnyezet-csere: nincs `mm6-deploy`, `npm ci`, build, stamp-törlés vagy PATH-váltás, és így PATH sem ég be a pm2 env-be. Egy közbülső, rendes `mm6-deploy` Node 20-on buildel, és a megőrzött pin miatt Node 24-en fut tovább.

**Lépések (mindegyik Robi külön go-jával; a pm2-lépések előtt szólok a B box-sessionnek):**
- [ ] **P1. 6.132.2 (Node 20), telekom → erste.** *(Push 2026-11-23: `origin/main` = `2623caa`; Robi: „Igen, push + telekom”. **Telekom kész 22:29 UTC:**
  - deploy 85 s, `npm ci` lefutott, a maint mögött 1 s alatt felállt; minimum 1256 MB elérhető memória;
  - HEAD `2623caa`, 6.132.2, a stamp egyezik, restart 1, a hibalog üres; nincs `.next-old`/`.next-build`; `/login` 200 (loopback és publikus), munkamenet nélkül 401, `/_next/image` 404; a `better-sqlite3` nincs, 8/8 natív modul N-API;
  - a share-oldal-próba kimaradt.
  - Hitelesített próba (Robi belépett a Chrome-jában, én csak olvastam): a dashboard és a mátrix betölt, minden API-hívás 200, a konzolban nincs hiba. A mátrix `mc: 0/0`-ja nem hiba: a telekom mind a 64 MC-je `DRAFT`, audience nélkül (DB-ben megnézve), a rács pedig csak az elhelyezett sorokat mutatja. A dashboard „64 MCS in 64 cells” felirata a draftokat is beszámolja; ez régi, külön apróság.
  - **Erste kész 22:39 UTC** (Robi: „Igen, mehet”): deploy 81 s, minimum 1491 MB elérhető memória; ugyanazok az ellenőrzések rendben. Hitelesített próba: MCP `matrix_status` 200 az új folyamaton (a connector az erste vhostját éri). A hibalog régi sorai az AWS SDK `NodeVersionSupportWarning`-jai (az SDK a Node 20-at már nem támogatja); Node 24-en ezeknek el kell tűnniük.
  - Rollback-másolatok a boxon tenantonként (útvonal az infra-mapben).)*
- [x] **P1 kész mindkét tenanton.**
- [x] **P2. Izolált Node 24-es próba-build — kész 22:41 UTC** (Robi: „Igen, mehet”): friss klón a tenant-mappákon kívül, Node 24.22.3 / npm 11.19.1.
  - `npm ci` 34 s, build 87 s, mindkettő exit 0; 8/8 N-API; minimum 776 MB elérhető memória; a klón és az `.env`-másolat utána törölve.
  - **Lelet:** az npm 11.19.1 figyelmeztet, hogy 5 csomag install-scriptje „not yet covered by allowScripts”: négy `esbuild`-verzió (`node install.js`) és az `unrs-resolver` (`napi-postinstall … check`). Mind fejlesztői vagy build-eszköz; a futó app (next, sharp) nincs köztük. Hogy az npm lefuttatta-e őket, a figyelmeztetésből nem derül ki. Az N8-ban ellenőrizni kell, hogy a boxon működik-e a tsx és az esbuild (a `db:migrate` is használhatja). Előtte push. Tenantonként: rollback-másolat a `node_modules`-ról és a `.next`-ről; `mm6-maint on` **a deploy előtt**, így az `npm ci`, a build és a restart is maint mögött fut (becsült kiesés 2–4 perc, éjjel); `mm6-deploy`. Ellenőrzés: a DEPLOY.md „After” listája, a `better-sqlite3` nincs a `node_modules`-ban, minden `.node` N-API, egy hitelesített olvasás. Visszaállítás: a másolatok vissza + `git reset --hard 1b3e7ec` + restart, utána revert az originen.
- [x] **N1. Node 24.22.3 egymás mellé** — **kész 2026-11-23 22:31 UTC** (Robi: „Igen, mehet”):
  - Good signature (Antoine du Hamel, EdDSA `5BE8A3F6…B168D356`), a tarball sha256-ja egyezik az aláírt sorral és a nodejs.org fájljával;
  - `node` v24.22.3, ABI 137, npm 11.19.1; nincs csoport- vagy mások által írható fájl; a system Node érintetlen (20.20.2); az útvonal az infra-mapben.
  - Az eredeti szöveg: hivatalos tarball verziózott, root-tulajdonú mappába; a GPG-aláírás (`SHASUMS256.txt.asc`) és a sha256 ellenőrzése. A pinek a verziózott útvonalra mennek, nem a `current` linkre. Visszaállítás: a mappa törlése.
- [x] **N2. telekom — kész 2026-11-23 22:47 UTC** (Robi: „Igen, mehet most”; a B box-session értesítése nélkül: „Mehet nélküle”, az MM6-session nem válaszolt):
  - **N2a** (22:44): próbafolyamat Node 24.22.3-on a telekom buildjének másolatával egy szabad localhost-porton. `/login` 200 két másodperc után („Ready in 489ms”), munkamenet nélkül 401, `/_next/image` 404, asset 200, `/api/config-public` 200, RSS 141 MB, a kimenet hibamentes. Postgres-kapcsolatok: 17 → 18 a 100-ból. Leállítva, a dist-másolat törölve.
  - **N2b** (22:45:47–55, maint 8 s): pin + delete/start. `exe` = a Node 24-es bináris, `node_version` 24.22.3; a pm2 PATH-jában nincs Node 24; `/login` 200 loopbackon és publikusan, 401, `/_next/image` 404; a hibalog üres. Hitelesített próba Robi Chrome-jában (ő lépett be, én csak olvastam): a dashboard, a Drafts és az Audiences betölt, a konzolban nincs hiba.
  - **N2c**: vissza Node 20-ra (22:46:33–42, maint 9 s): `exe` = system Node, `/login` 200, Drafts betölt. **A pm2 a `"node"`-ot a system Node-ra oldja fel**, így ez az ismeretlen lezárult. Aztán újra Node 24 (22:47:09–16, maint 7 s), `pm2 save`; a dumpban a telekom a pinnel szerepel.
  - Mellék-lelet, nem Node-függő: a Telekom-DooH draft-előnézetei `/api/templates/Telekom-DooH/[[css]]`-t kérnek, és 404-et kapnak (Node 24-en 20-szor, Node 20-on 21-szer; a `/api/render` közben 200). Be nem helyettesített template-token; külön tétel.
  - Az eredeti szöveg:
  - **N2a, próba a boxon (a staging helyett):** egy ideiglenes, második folyamat Node 24-en, pm2-n kívül, egy szabad localhost-porton: `/login` 200, munkamenet nélkül 401, `/_next/image` 404, egy asset 200, hibamentes stderr, RSS; utána leállítva.
  - **N2b, átállás:** az interpreter-pin az ecosystemben, maint mögött `pm2 delete` + `start` (csak ez olvassa újra az ecosystemet), `pm2 save`. Ellenőrzés: `/proc/<pid>/exe` és `node_version` 24.22.3, a DEPLOY.md-próbák, egy hitelesített próba (Robi böngészőjében a mátrix-oldal; vagy az MM MCP-n egy olvasás), hibalog.
  - **N2c, visszaállítási próba:** a pin vissza `"node"`-ra (`exe` = system Node, `/login` 200, a hitelesített próba), aztán újra Node 24.
- [x] **N3.** *(Robi, 2026-11-24 08:49 UTC: „now” → az N4 10 óra figyelés után ment, a 24 óra előtt.)* *(Indult 2026-11-23 22:47 UTC; N4 legkorábban 11-24 22:47, legkésőbb 11-25 22:47 UTC; N6 legkésőbb N4 + 3 nap.)* Figyelés 24–48 óráig: restart-számláló, hibalog, RSS a `max_memory_restart` alatt.
  - **Köztes riport, 2026-11-24 08:47 UTC (10 óra, csak olvasva; a folytató „B box Node 24” session):**
    - A telekom online, `exe` és `node_version` 24.22.3, a 22:47:14-es folyamat. Restart 0, instabil 0. A Postgres 16.16-ra váltást (08:10, B2) restart nélkül élte túl.
    - RSS 163 MB, a csúcs (VmHWM) 266 MB, a limit 700 MiB. A box elérhető memóriája 2306 MB.
    - Hibalog: 150 sor, mind egy szkenner-sorozatból (07:27:23–26 UTC, 50 kérés `Next-Action: x` fejléccel → „Server Reference ID did not match”, 400). Ugyanez a sorozat az erstét (Node 20) 00:27-kor érte, és a 11-15 óta rotált logokban is megvan. Nem Node-függő.
    - AWS SDK `NodeVersionSupportWarning`: a telekom logjában Node 20-on sem volt soha (11-15 óta), mert az ablakban a folyamat nem hozott létre S3-klienst; a hiánya ezért önmagában nem bizonyít. Kontrollált próba a telekom telepített SDK-jával (`@aws-sdk/client-s3` 3.1075.0, csak kliens-létrehozás, kérés nélkül): Node 20.20.2-n kiírja, Node 24.22.3-on nem. Az erstén (Node 20) ma is megjelent. A figyelmeztetés szövege szerint a 2027. január első hete után kiadott SDK-verziók Node >=22-t kérnek.
- [x] **N4. erste — kész 2026-11-24 08:51 UTC** (Robi: „now”; a B box-session előtte értesítve):
  - **N4a** (08:50): próbafolyamat Node 24.22.3-on, az erste buildjének másolatával, egy szabad localhost-porton.
    - `/login` 200 két másodperc után („Ready in 478ms”); munkamenet nélkül 401; `/_next/image` 404; asset 200; `/api/config-public` 200.
    - RSS 140 MB, a kimenet hibamentes; Postgres-kapcsolatok 10 → 11 a 100-ból.
    - Leállítva, a másolat törölve. A `/favicon.ico` 404, az élő erstén is.
  - **N4b** (08:51:14–18, maint 4 s): pin + delete/start.
    - `exe` = a Node 24-es bináris, `node_version` 24.22.3, a listener pid-je = a pm2 pid; restart 0.
    - `/login` 200 loopbackon és publikusan, 401, `/_next/image` 404; a hibalog 0 új sor.
    - Hitelesített próba: MCP `matrix_status` 200 az új folyamaton (180 audience, 92 topic, 2945 MC). Előtte egy `/mcp` 400: a connector újrakapcsolódása, Node 20-on is így volt a P1 restartja után (22:30).
    - `pm2 save` 08:51:40; a dumpban mindkét tenant a pinnel, a két régi MM `stopped`.
  - N2c nincs, a terv szerint. Az N6 határideje így 2026-11-27 08:51 UTC.
- [x] **N5. customBrain — N5.0–N5.2 kész 2026-11-24 09:12 UTC** (Robi: „Go N5.0–N5.2”; a customBrain-session és a B box-session előtte értesítve; 0.78.5-deploy nem futott, a box 0.78.4-en). **`pm2 save` 09:16:27 UTC** (Robi: „Yes, pm2 save”): a dumpban a telekom, az erste és a custombrain a Node 24-es pinnel `online`, a két régi MM `stopped`; a mentés előtti dump: a review-kérés szerinti backup-mappában, `n5-20261124-091114`.
  - **N5.0** (09:10:12): a régi unit letiltva és leállítva (`disabled`, `inactive`; addig 14 770 sikertelen újraindulás). A pm2-es custombrain pid-je és portja nem változott.
  - **N5.1** (09:10:26–52): az `agenda-sync` a cron-sor parancsával, Node 24-gyel: exit 0, 22 esemény, 4 dúsítva, 24,8 s, hibamentes napló. Csak a naptár-cache fájlt írja, a következő óránkénti futás felülírja.
  - **N5.2** (09:11:14–18, kb. 4 s kiesés): stop → a port 1 s alatt szabad (a `fuser`-nek nem maradt dolga) → delete → start Node 24-es interpreterrel, ugyanazzal a névvel, mappával, scripttel, `merge_logs`-szal.
    - A `:3000` pid-je = a pm2 pid; `exe` és `node_version` 24.22.3; restart 0; `/stats` kulcs nélkül 401, mint előtte; a hibalog 0 sor.
    - Smoke a brain MCP-n, mind 200: `brain_stats` (1171 thought), `search` (a dense ág kimenő embedding-`fetch`-csel), `spider` és `map` (gráf-újraépítés a worker szálon: 1166 csúcs, 7844 él). Az első kérés 09:11:31-kor 400, a négy hívásom előtt; valószínűleg a connector újrakapcsolódása, mint az erstén. Nem ellenőriztem.
    - **Figyelni:** a gráf-újraépítés 24,9 s (Node 20-on 17,5–21,3 s); RSS 465 MB, csúcs 710 MB (Node 20-on állandósult állapotban 182 MB, a Node 20-as csúcsot nem mértem). Egy minta, friss folyamaton, párhuzamos hívások alatt; `max_memory_restart` nincs. A box elérhető memóriája 2028 MB.
    - 09:13:48 (2,5 perccel az indulás után, nyugalomban): RSS 296 MB, pm2 szerint 289 MB, csökken. Node 20-as nyugalmi érték (a customBrain-session átiratából, 8 napos futás után): 229,7 MB. Összevethető szám a beállt folyamatról jön: újramérés az N6 előtti ellenőrzésben.
  - A 7 cron-sor az N6-ig a system Node-on fut.
  - Az eredeti szöveg (a customBrain-sessionnek előtte és utána szólok):
  - **N5.0:** a régi, hibásan újrainduló customBrain systemd unit letiltása (Robi go-jával).
  - **N5.1, cron-kanári:** az `agenda-sync` egyszer kézzel, Node 24-gyel.
  - **N5.2, szerver:** a saját szabálya szerint (stop, a port felszabadítása), majd `pm2 delete` és `pm2 start --interpreter <node24>`. Ellenőrzés: a port pid-je egyezik a pm2 pid-jével, `exe`, `/stats`. Smoke a brain MCP-n: `brain_stats`, `search` (kimenő `fetch`, undici 7), `map`/`spider` (graphology).
  - Visszaállítás: ugyanez `--interpreter node`-dal.
- [ ] **N6. System Node, vezérelt ablakban:**
  - `pm2 save` + dump-mentés; a 20.20.2 .deb letöltése; NodeSource `node_24.x`; pontosan `24.22.3-1nodesource1`, különben stop; `NEEDRESTART_SUSPEND=1`.
  - Mindkét tenanton maint, customBrain stop + port szabad, `systemctl restart pm2-root` (nem `pm2 update`).
  - A démon, a logrotate és az appok `exe`-je ellenőrizve; a pinek ugyanabban az ablakban vissza `"node"`-ra (delete/start); customBrain start + port-ellenőrzés; maint off; `pm2 save`.
  - Visszaállítás állapotonként a review-kérésben. Az egymás melletti Node egy hétig tartalék.
  - Utána: a customBrain ellenőrzőlistája, a Security Signal újramérése.
- [ ] **N7.** `engines: { node: ">=24" }` a `package.json`-ban, commit; bump: patch; a következő rendes deployjal megy ki.

**Restartok:** tenantonként P1 1, N2/N4 3, N6 1, mind maint mögött; customBrain 2 (N5, N6), néhány másodperc, maint nélkül. **Adat:** a DB-ben nem változik semmi, kivéve a DEPLOY.md share-oldal-próbájának +1 nézettségét. **Staging:** az MM6-nak nincs; az N2a a helyettesítője, a telekom a kanári. Ez Robi kifejezett kivétele kell legyen (`dependencies.md`). **Body-limit:** az S2–S4 deployja N4 után jöhet, de nem az N6 napján.

**Door:** P1–N5 appokként kétirányú (pin vissza, az N2c ki is próbálja), egy-egy app a hatókör. N6 az egész box pm2-ét érinti, a mentett .deb-bel és a lépésenkénti visszaállítással visszafordítható. Kifelé semmi nem megy.

**Prediction:** az app viselkedése nem változik; helyben a 120 követett tesztfájl Node 24.13.1-en zöld. Megmutatja: az N2a/N2b próbái, az `exe`/`node_version`, a hibalog, az N3 restart-számlálója és RSS-e. Ismeretlen: a Next 16.4.5 a box 24.22.3-án; a customBrain undici 7-es `fetch`-e és a graphology (N5.2 smoke).

**v2.1 — a v2-review (CA és Codex: OK with changes, 2026-11-23 23:18–23:19) módosításai:**
- **Tiszta checkout:** a P1-commitot egy friss klónban ellenőrzöm (`npm ci`, lint, `tsc`, vitest), mert a munkafában más sessionök fájljai is vannak. A push előtt az `origin/main..main` csak docs-commitokat és az enyémet tartalmazza.
- **Próbák a maint mögött:** a maintenance gate minden proxizott kérésre 503-at ad, az MCP-re is. Ezért az oldal levétele előtt csak loopback-próbák futnak (`/login`, 401, asset); a hitelesített próba közvetlenül utána jön, és ha elbukik, azonnal visszaállítás következik. A P1-nél a `mm6-deploy` maga veszi le az oldalt, a hitelesített próba ezután jön.
- **N2a:** külön dist-másolatról fut (`.next-rehearsal`), hogy ne írjon a közös `.next/cache`-be; előtte a Postgres `max_connections` és az aktív kapcsolatok száma (a pool 10/folyamat). Utána a másolat törlődik.
- **N2c csak a telekomon;** az N4 kihagyja.
- **P2 (új), izolált eszközlánc-próba N1 után:** friss klón a boxon, a repó mappáin kívül; `npm ci` és build Node 24 / npm 11 alatt. Élő appot és `node_modules`-t nem érint. **N8 (új):** az N6 utáni első deploy előtt a stamp törlése, és teljes maint + rollback-másolat (`node_modules` és `.next`), mint a P1-ben.
- **Az N2–N6 ablakban** minden közbülső `mm6-deploy` után újra ellenőrzöm, hogy minden `.node` N-API. Az ablak határideje: az N6 legkésőbb N4 + 3 nap. Addig egy ideiglenes sor jelzi az infra-map „Box B” részében, hogy az appok pinelve vannak.
- **N6:**
  - a `pm2 save` után a dumpban a két régi MM-app és a leállított customBrain `stopped`, a resurrect után azonnal `pm2 jlist`;
  - az apt előtt és után `pm2 -v` és a globális modulok listája;
  - minden visszaállítási állapotban a csomagforrás is visszaáll, utána `apt update`;
  - a végén `exe`, listener, `stopped` régi appok, mentett állapot;
  - tenantonként egy maint-ablak, de két indulás (resurrect + unpin).
  - Az N6 előtt friss kontextusú reviewer nézi meg, security szempontból is (közös démon, nagy hatókör).
  - Az egymás melletti Node egy hét után törlődik.
- **Mellékhatások:**
  - az N5.2 `search` kimenő embedding-hívást tesz, ez a szokásos app-működés;
  - az `agenda-sync` kézi futtatása előtt megnézem, mit ír, és fut-e közben egy ütemezett példány. Amit ír, azt a Node visszaállítása nem vonja vissza, a következő futás felülírja.
- **Staging-kivétel — Robi, 2026-11-23: „Igen, kivétel”.** Staging helyett az N2a box-próba fut, a telekom a kanári.

### Végrehajtó session, előfeltételek (2026-11-23 22:05 UTC, csak olvasva a boxon)
Végrehajtó: a „B box Node 24” side-session (az MM6 státusz-session indította, Robi kérése: „kéne egy node frissítés a gépen külön sessiönben vigyél végig”).
- [x] Kernel + reboot ablak: megvolt, a box a 151-es kernelen fut, boot 11:21 UTC.
- [x] Régi MM kivezetés 1. lépés: mindkét régi app `stopped` a pm2-ben.
- [x] zod-patch: kint (6.132.1, mindkét tenant HEAD-je `1b3e7ec`). Az `origin/main` azóta csak docs-ot és a már kint lévő nginx-snippetet hozza; `src/` és `deploy/bin/` nem változott.
- **Robi döntései (2026-11-23 ~23:10):** `better-sqlite3` → (b) törlés, patch-deployként (6.132.2) Node 20-on, a csere előtt; a Node-csere megy a body-limit S2–S4 előtt (azok deployja N4 után); a „B box-session” kilétét az MM6 státusz-session mondja meg; a customBrain előbb kanáriként (pm2-pin), a cron-sorok az N6-tal.
- [ ] `better-sqlite3` (b): helyben kész (a függőség, a `@types`, a `serverExternalPackages`-bejegyzés és a `scripts/backfill-to-pg.mjs` törölve; a lockfile-ból 32 csomag ment ki, más nem változott). Commit, push, deploy telekom → erste: Robi go-jára. Pontosítás a fenti megfigyeléshez: csak a `scripts/backfill-to-pg.mjs` importálja; a `seed-perf.ts` a PG-s `src/db`-t használja, csak egy komment említi. A `next.config.ts` `serverExternalPackages`-ében is szerepel. A 12.10.1–12.12.0-ban van Node 24-es (node-v137) linux-x64 prebuild, a 13.x-ben nincs (GitHub releases, 2026-11-23).
- [x] Body-limit S2–S4: még nincs megírva (S1 és S1b kint). Robi: a Node-csere megy előbb, az S2–S4 deployja N4 után.
- Megfigyelve: a box 24.x legfrissebb kiadása a 24.22.3 (2026-11-10, security; npm 11.19.1, ABI 137); ez fut az A, C és D boxon is. A v26 2026-10-28 óta Active LTS.
- Mellék-lelet, nem ennek a tervnek a része: a boxon van egy engedélyezett, régi customBrain systemd unit, amely boot óta 5 másodpercenként sikertelenül újraindul (hiányzó env-fájl; Node-ot nem indít, a portot nem fogja). A CA szerint az N5 előtt le kell tiltani (N5.0).
- Helyben a (b) után: `tsc` 0 hiba; eslint 0 hiba, 146 figyelmeztetés, mint a baseline (a `.claude/worktrees/` nélkül; azokkal 438, a háromszorosa); vitest: a 120 követett tesztfájl zöld. A 14 bukás egy másik session nem követett S0-tesztfájljából jön (`request-body-limit.test.ts`).
- **Planning review v1** (`~/agent-bus/requests/20261123-2307-mm6-boxb-node24.md`): CA **OK with changes**, Codex **Stop**. A Codex kifogásai:
  - az `mm6-deploy` `npm ci`-je az élő app alatt, maint nélkül fut;
  - az N6 `pm2 update`-je mindent egyszerre indít újra, a customBrain port-szabálya nélkül;
  - az N6 visszaállítása nem teljes, és a csomagverzió nincs rögzítve;
  - staging nincs, és a `/login` önmagában kevés;
  - a todo és a kérés ellentmond egymásnak.
  - → Terv v2 (fent).
- **Planning review v2:** `~/agent-bus/requests/20261123-2345-mm6-boxb-node24-v2.md`: CA **OK with changes**, Codex **OK with changes**, Stop nincs. A módosítások a fenti v2.1-ben.

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
  - **Megfigyelve 21:21 UTC:** Robi Sheets-megnyitása újramentette a fájlt (ugyanaz az id, 547 656 bájt, md5 `3b167aee…`, új revízió). openpyxl-lel az élesen lévő javítotthoz képest: mindkét lapon 0 értékeltérés, a rejtett sorok (3536, tehát 308 látható) és a szűrő azonos. A Sheets az `inlineStr` cellákat shared stringgé alakította. Tanulság: a Sheets megnyitáskor is írhat, ezért csere közben a fájlnak zárva kell lennie.
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

## 2026-11-23 — mc-export tábla-csere szkript a repóba (KÉSZ; Robi: „Igen, emeld be a repóba teszttel”)

A ma használt két scratchpad-szkript (`patch_sheet.py`, `verify_patch.py`, most `round4-1080-codex/tabla-csere/`) TS-ben, a repóban, teszttel. Az adat nem megy át tokenen: helyi XML-szerkesztés, ellenőrzés a DB ellen, csere fájlművelettel.

**Touches:** új `src/lib/xlsx-sheet-patch.ts` (cellaolvasó + cellaíró egy xlsx lapján, jszip, a többi zip-tag és minden más sor bájtra változatlan), új `scripts/patch-mc-export.ts` (CLI), új `tests/unit/xlsx-sheet-patch.test.ts`. A `gen-mc-export.ts`-hez nem nyúlok; az oszlopokat a fejléc neve alapján keresem (`creative_id`, `image_text` … `updated_at`), nem betűjel alapján. Szemantikai modell nincs, a REBUILD_SPEC ezt a táblát nem tárgyalja.

**Door:** a kód kétirányú (új fájlok, az app nem importálja). Maga a csere (`--in-place`) ügyfélfájlt ír felül: alkalmanként Robi go-ja kell hozzá, ahogy ma.

**A reviewer három jelzése, amit javítok** (ma nem tüzeltek):
- megosztott-stringes kulcscella (A): a python csak `<v>`-t olvasott, a sharedStrings-t nem;
- önzáró `<row …/>`: a python sor-regexe a következő sor `</row>`-jáig nyelt volna;
- `<c>`, ahol nem az `r=` az első attribútum: a python kihagyta, és a sor újraépítésekor elveszett volna.

**Mechanizmus-ellenőrzés (új):** a W (`updated_at`) írása azt állítja, hogy a sor a DB-vel egyezik. Ezért a célsorok többi, a `creatives`-ből jövő oszlopát (a `matrix_status` és a `link` kivételével) a szkript összeveti a DB-vel, és eltérésnél nem ír. A nem célsoroknál csak jelez: a W eltér a DB-től, archivált, vagy hiányzik a táblából.

**Prediction:** a mai alapon és a mai id-listákkal futtatva a TS-kimenet `sheet2.xml`-je bájtra egyezik a python-kimenetével (`tabla-csere/mc-export 11.javitott.xlsx`), mert a célcellák már léteztek, és a stílusukat megtartom. A célsorok többi oszlopa egyezik a DB-vel. Ismeretlen: hogy a számcellák formája (pl. `101` vs `101.0`) egyezik-e a DB-értékkel, ezt a futás mutatja.

**Seam:** `patchSheetCells(buf, { sheet, keyHeader, updates })` és `readSheet(buf, sheet)`. Unit-teszt kézzel írt XML-ből épített mini-xlsx-en, a várt értékek a tesztben literálok.

**Szeletek:**
- [x] **T1** Unit-teszt (előbb piros, a modul hiánya miatt): 11 eset `tests/unit/xlsx-sheet-patch.test.ts`-ben.
- [x] **T2** `src/lib/xlsx-sheet-patch.ts` a zöldig.
- [x] **T3** `scripts/patch-mc-export.ts <xlsx> --ids <fájl>[,<fájl>] [--out <xlsx> | --in-place] [--remote <rclone-útvonal>] [--client erste]`. Kapcsoló nélkül csak jelent. `--in-place`: a futás elején és az írás előtt a fájl md5-je azonos; `--remote` esetén a Drive-szerver md5-je is azonos az írás előtt; írás helyben (truncate, nem rename → ugyanaz a fájl-id); utána a visszaolvasott md5 = a kimenet. A szerver-oldali utóellenőrzés parancsát kiírja.
- [x] **T4** Párhuzamos futás a mai alapon (scratchpad-másolatokon, a Drive-ot csak olvasva):
  - A DB-ellenőrzés 0 hibát talált: minden célsor aktív és benne van a táblában, a célsorok többi oszlopa = DB (a `101.0` → `101` normalizálás kell hozzá, és bevált); a nem célsoroknál nincs elmaradás. 2493 sor × 5 cella, célsor = DB 2493/2493.
  - **A jóslat bevált:** a TS-kimenet és az élesbe ment python-kimenet tagonként azonos (név, sorrend, dátum, tartalom), 621 651 bájt mindkettő.
  - **Elsőre nem jött be:** a JSZip két mappa-bejegyzést tett a zipbe (`xl/`, `xl/worksheets/`), és új dátumot adott a `sheet2.xml`-nek. A unit-teszt nem fogta meg, mert a fixture-ben is voltak mappák. Erre lett egy új, előbb piros teszt (nincs új zip-tag, a dátum marad), és a javítás (`createFolders: false`, `date`). Ami nem tartható meg: a tagok unix mód-bitjei (az eredetin 0600, a JSZip nem olvassa őket). Az Excel és a Sheets nem nézi ezeket, a kódban ez dokumentálva van.
  - A három út próbája: szándékosan elavított célsor-oszlop (18229 `file_name`) → „NEM írok”, a fájl érintetlen; `--remote` eltérő Drive-példánnyal → elutasítva, írás nélkül; `--in-place` scratch-fájlon → helyben írva, a visszaolvasott md5 = a kimenet.
- [x] **T5** typecheck 0 hiba; eslint a három új fájlon 0 hiba; a unit suite 46 fájl, 434 teszt zöld. Az integrációs suite-ot nem futtattam: app-kódot és sémát nem érint, a szkript csak olvasta az éles DB-t. Diff-review: önellenőrzés a terv ellen (kétirányú ajtó, új fájlok). Bump nincs (tooling, az app nem importálja).

**Használat legközelebb** (Robi go-ja és a böngészőben zárt fájl után):
`npx tsx --env-file=.env.local scripts/patch-mc-export.ts "<mount>/mc-export NN.xlsx" --ids <id-lista.txt> --in-place --remote "gdrive:Data/ERSTE HU/_messagingmatrix.ai/mc-export NN.xlsx"`, előtte ugyanez `--in-place` nélkül (csak jelentés).

## 2026-11-24 — Shares oldal: előnézet-oszlop, méretválasztó, szűrősáv (KÉSZ az ágon; bump és deploy Robi go-jára vár)

Robi kérése (szó szerint): „erre az oldalra kéne a cím elé egy 3 mini thumbnailes, preview a shareből, legyen létethető a preview, 1080x1080 vagy 300x250 vagy ha az sincs négyzetes szerű méretekből legyen a preview, ne a mréeteket sorolja fel a preview, hanem a shareben lévő mc és mc vrainatokat, a toolbárba beerülhetnegy egy 32 64 128 256 pixeles thumbnail size selector egy view boxba, ez a magasságát adja meg a preview thumnailnek, és kéne egy filter az oldal ttetejére mint a creative libraryba, share névre, mc-re, kreatívon lévő szövegre lehessen szürni és product lehullóra is”.
0. lépés (2026-11-24): Robi „Igen, építsd”; a „létethető” = **léptethető** (nyilakkal tovább lehet lapozni a share további MC-ire).
Ág: `claude/shares-preview-filter-5b03b5` (worktree `exciting-leakey-7043bd`).
Robi jóváhagyása (2026-11-24): „Mehet”; a léptetés hármasával; a picker is az MC-nkénti választást kapja (3. döntés).

**Touches:**
- A `/shares` admin lista: REBUILD_SPEC §6.10b (Drive `mm6-docs/REBUILD_SPEC.md`, 2026-09-06). **A dokumentum ezen a ponton elavult:** a Refresh (6.122.0, 6.131.0, 6.132.0) nincs benne. Kód: `src/app/(app)/shares/SharesView.tsx`.
- `GET /api/share-galleries` válasza (§3.10, §4.7: a lista-válasz hordozza a soronkénti számlálókat): `src/app/api/share-galleries/route.ts`.
- A share-snapshot (`share_galleries.metadata`, §3.10) olvasói: `shareThumbs` (`src/lib/share-snapshot.ts`, az „Add to shared” picker 4 képe) és `shareProducts` (`src/lib/share-metadata.ts`, a dashboard product-szűrője).
- Szomszédok: a szűrő-nyelv (§7.7, `parseSearchQuery`, `src/lib/search-query.ts`), a `MultiPill` Product legördülő és a `toggle-group` / `ToggleBtn` (matrix View/Density), a nyilvános galéria kép-URL-jei (`/share/[id]/file/…?thumb=`, `/publicshortcut/…`; §6.10: a `?thumb=` kérés nem számít letöltésnek).
- Szemantikai modell nincs; ezt a változást egyik modell sem fedi. A fogalmak (share, snapshot, matrix cell vs creative, MC/variáns) a specből.

**Mért tények (élő DB, csak olvasás, 2026-11-24):**
- Erste: 44 share; 206 matrix cell, 1121 creative, 3 asset. Minden snapshot-creative-nek van MC-száma; 275 share×MC csoport. A leggyakoribb méretek: 1080x1080 (248), 300x250 (200), 640x360, 1200x628, 300x600, 970x250.
- **A kreatívon lévő szöveg nincs a snapshotban:** a snapshot-creative-ek közül 40/1121-ben van `imageText` (a legtöbb share régebbi a képolvasásnál). A `creatives` táblában a 943 még meglévő sorból 895-nek van. Ezért a szöveget a `creatives` táblából olvasom id szerint (kliensre szűrve, 500-as IN-darabokban, mint a `shareThumbs`), a törölt soroknál a snapshot értékével. Share-enként deduplikálva ez ~21 KB képszöveg és ~10 KB matrix-copy az egész listára.
- `db-reads.md`: a node-postgres/Drizzle nem vág csendben 1000 sornál; a share-lista maga ~45 sor. Az IN-listák darabolva mennek.

**Door:** kétirányú. Csak olvasás és UI: nincs séma, migráció vagy adatírás, a `git revert` visszaviszi. Blast radius: a `/shares` oldal, a `GET /api/share-galleries` válasza (új mezők; a meglévők változatlanok), és ha a 3. döntést elfogadod, a picker thumbjai. Deploy nem része: külön go, a Node-csere után.

**Prediction:**
- Változik: a lista-válasz soronként `previews` (MC/variánsonként egy kép, a nézői sorrendben), `products` és `searchText` mezőt kap. A táblában a Title elé kerül egy Preview oszlop (3 thumb, ‹ › léptetés), a fejlécbe szűrőmező, Product legördülő és Clear, a jobb toolbarba egy „View” doboz a 32/64/128/256-os választóval. A sormagasság a választott thumb-magasságot követi.
- Változatlan: a többi oszlop, a rendezés, a kijelölés (shift is), a Refresh / Archive / Restore / Copy link, a nézettség- és letöltés-számlálók, a nyilvános galéria.
- Tesztek mutatják: unit (méret-preferencia, MC-csoportosítás, szöveg, szűrő-mezők), integráció valós PG-n (a route új mezői; a `creatives.image_text`-re akkor is talál, ha a snapshotban nincs).
- Ismeretlen: a matrix-cellák előnézete a teljes PNG, kisebb változata nincs (a nyilvános galéria is ezt tölti, `loading="lazy"`). Ha a lista ettől lassú, külön szelet lesz: `?thumb=` a `/publicshortcut` matrix-ágára.

**Seam:**
- Új tiszta modul `src/lib/share-list.ts`: `pickPreviewSize(sizes)`, `sharePreviewGroups(meta)`, `shareSearchText(meta, textById)`, `shareSearchFields(row)`. Unit-teszt: `tests/unit/share-list.test.ts`.
- `GET /api/share-galleries`: integrációs teszt a válaszra (`tests/integration/api/share-galleries-list.test.ts`).

**Döntések (ajánlott default, Robi felülírhatja):**
1. Méret: 1080x1080, ha nincs, 300x250, ha az sincs, a négyzethez legközelebbi (a `|ln(w/h)|` minimuma; döntetlennél a nagyobb terület, aztán a sorrendben első).
2. Csoport = MC-szám + variáns (MC12a és MC12b két kép); egy MC-ből egy kép, akárhány mérete vagy közönség-másolata van. MC nélküli tétel (asset) fájlonként egy csoport.
3. **Mechanizmus-fix a pickerben is.** A `shareThumbs` ma „az első 4 tételt” adja, ami egy matrix-share-nél ugyanaz az MC négy méretben, pont az, amit itt nem kérsz. A picker első 4 képét ugyanaz a csoportosító adja. Testvér-teszt: egy MC három méretével a mai `shareThumbs` 3 egyforma képet ad (piros), utána MC-nként egyet.
4. Léptetés: a ‹ › hármasával lapoz (1–3, 4–6 …), tooltipben „4–6 / 12”. Legfeljebb 3 MC-nél nincs nyíl.
5. Szöveg-szűrő: a szabad szöveg = share-név + MC-címkék + a kreatívon lévő szöveg (`image_text`; matrix cellánál headline, copy1, copy2, disclaimer, cta). Az `mc:` prefix az MC-re szűr. A képleírás (`image_description`) nem kerül bele, mert az nem a kreatívon lévő szöveg. A többi prefix (a: t: s: p: date:) itt nem él, a placeholder ezt mutatja.
6. Product: a meglévő `shareProducts` (a dashboard is ezt használja): a creative `product`-ja, matrix cellánál a topic-előtag. `MultiPill`, „(none)” opcióval.
7. Perzisztencia: `mm6_shares_filter_search`, `mm6_shares_filter_products`, `mm6_shares_preview_height` (alap: 64 px).
8. Fájl-thumbnál a választott magasság kétszereséhez legközelebbi meglévő szélesség-tier (80/200/400/800).

**Szeletek:**
- [x] **S1** `share-list.ts` + unit-tesztek (előbb piros). Független.
- [ ] **S2** Route: `previews` / `products` / `searchText` a lista-válaszban; a `shareThumbs` a csoportokra épül; integrációs teszt (előbb piros). S1 után.
- [ ] **S3** UI: Preview oszlop, léptetés, „View” doboz a méretválasztóval. S2 után.
- [ ] **S4** UI: szűrősáv (szöveg, Product, Clear) a fejlécben; a `toolbar__count` a szűrt számot mutatja. S2 után, S3-tól független.
- [x] **S5** Ellenőrzés: `npx tsc --noEmit`, eslint, `npm test` (unit + integráció). Helyi `dev:erste` böngészős próba; ez az élő DB-t olvassa, ezért csak nézelődés: nincs Refresh, Archive, és nem nyitok meg `/share/[id]` oldalt (az view-t számol). `component-inventory.md` frissítése, review-szakasz, minor bump-javaslat.

### Review (2026-11-24)

**Ami elkészült** (`claude/shares-preview-filter-5b03b5`):
- `src/lib/share-list.ts` (új, tiszta): méretválasztás, MC-csoportosítás, a kreatívon lévő szöveg, a szűrő-mezők és a sor-szűrő.
- `src/lib/share-snapshot.ts`: új `sharePreviews` (minden MC egy képpel, URL-lel) és `shareSearchTexts` (a `creatives.image_text` id szerint, kliensre szűrve, 500-as darabokban). A `shareThumbs` (picker) mostantól a `sharePreviews` első 4 elemét adja.
- `GET /api/share-galleries`: soronként `previews`, `products`, `searchText`. A meglévő mezők és a `?thumbs=1` változatlanok.
- `SharesView.tsx`: Preview oszlop a Title előtt (3 kép, ‹ › hármasával), szűrősáv a fejlécben (szöveg + Product + Clear), „View” doboz a jobb toolbarban (32/64/128/256, alap 64). A fejléc „N selected” száma a látható kijelölteket számolja, és van külön üres állapot arra, ha a szűrőre nincs találat.
- `component-inventory.md`: `share-preview-strip`, `shares-view-controls`, `shares-table__cell--preview`.

**Ellenőrzés:** `npx tsc --noEmit` 0 hiba. `npm run lint` 0 hiba, 145 warning; a módosított fájlokban eggyel kevesebb, mint előtte (a `rows`-useMemo warning megszűnt, a `RefreshThumb` `<img>`-warningja régi). `npm test`: 123 fájl, 1149 teszt zöld. Az új tesztek előbb pirosak voltak: unit 14 (`tests/unit/share-list.test.ts`), integráció 5 (`tests/integration/api/share-galleries-list.test.ts`, benne a picker testvér-tesztje: ma ugyanazt az MC-t 3× adta).
**Böngészős próba: nem volt.** Az oldal az élő DB valódi admin-belépését kéri, Robi a próbát kihagyatta. A képek helyben amúgy sem töltődnének be, mert a dev-env-ben nincs S3. A UI-t tehát csak a typecheck és a lint látta, szemmel senki: ez az első éles megnyitáskor derül ki.

**Jóslat vs. eredmény:**
- Bejött: az API új mezői, a `creatives`-ből olvasott szöveg (a snapshotban nincs), a picker javítása ugyanabból a csoportosítóból.
- Nem láttam előre, menet közben derült ki, és teszt fedi:
  1. **Archivált share:** a nyilvános fájl-proxy archivált share-re 404-et ad (`share-file.ts`). Ezért archivált share-nél a lista nem ad kép-URL-t, csak az MC-címkéket mutatja (§6.10b: archivált = nem nézhető).
  2. **SVG:** a `/share/[id]/file?thumb=` SVG-re nem a thumb-ágon fut, hanem a teljes fájlt adja, és **letöltést számol**. A lista SVG-re nem ad URL-t, így egy oldalbetöltés soha nem növeli a Downloads-t. Az élő share-ekben ma nincs SVG (png 987, jpeg 98, mp4 28, zip 12).
- Ismeretlen maradt: a matrix-cella előnézete a teljes PNG. Ha a lista ettől lassú, külön szelet: `?thumb=` a `/publicshortcut` matrix-ágára.

**Leletek, nem ebben a változásban (Robi dönt):**
- [ ] **Meglévő, rejtett hiba:** a nyilvános galéria (`ShareGallery.tsx` `thumbSrc`) SVG-fájlra is `?thumb=`-et kér, és ez letöltésnek számít, holott a §6.10 szerint a thumbnail sosem számít. Ma 0 SVG van share-ben. Mechanizmus-javítás: a file route `?thumb=` kérése sose számoljon letöltést (SVG-re szolgálja ki magát a fájlt, számláló nélkül).
- [ ] **REBUILD_SPEC §6.10b elavult** (Drive, 2026-09-06): nincs benne a Refresh, és most már a Preview oszlop, a szűrősáv és a View doboz sem.

**Verzió:** javaslat `6.132.2` → `6.133.0` (minor: új, felhasználónak látható funkció és új API-mezők). Robi dönt; a `package.json` és a `CHANGELOG.md` érintetlen. Deploy: nem történt; Robi külön go-ja kell, a B box Node-cseréje (N4–N8) után.

