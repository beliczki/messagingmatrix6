# MessagingMatrix v6 — active roadmap + checkpoint

**Ez a lean, aktív fájl.** A teljes történelem (Phase 0–10 logok, összes deploy- és session-checkpoint 2026-04 → 2026-07) szó szerint megvan itt: **`tasks/todo-archive.md`** (~4000 sor). Ott semmit nem törlünk — ez a hosszútávú emlékezet.

**Munkamenet:**
- Új session-checkpoint ennek a fájlnak az **aljára** kerül (append), nem az archívba.
- Ha az aktív rész kezd hízni a lezárt checkpointoktól, a régieket **átgörgetjük az archívba** (append oda), és itt hagyunk egy egysoros mutatót.
- Részletekért (file:line horgonyok, eredeti tervek, review-k) → `todo-archive.md`, szekció-cím vagy hozzávetőleges sor szerint hivatkozva.

**Kapcsolódó dokumentumok:**
- `docs/REBUILD_SPEC.md` — v6 design spec + multi-tenancy delta D1–D11.
- `tasks/component-inventory.md` — használatban lévő szemantikus class-nevek (új blokk-név előtt nézd meg).
- Master plan: `~/.claude/plans/you-ll-see-docs-and-snappy-charm.md`.

---

## Jelen állapot (2026-07-21)

- **Verzió: `6.9.0`**, **live** a Hetzner boxon (`erste.messagingmatrix.ai`, pm2 `mm6-erste`).
- Phase 0–10 szállítva. SQLite→Postgres migráció kész (közös Supabase a boxon, dev a `:5433` tunnelen éri). MinIO object store él (`:9000` tunnel). MCP server per-client bearerrel, **39 tool**.
- **Wave 0** ✅ teljesen zárva (W0.1 status-color single source + W0.2 filter-swatch — 6.9.0). **Wave 1** ✅ zárva (W1.2/1.3/1.4 edit-mode add/duplicate — 6.9.0; W1.1/1.5/1.6 smoke-ök obsolete). **Wave 3** nagyrészt szállítva (monitoring ingest end-to-end live).

**Prioritás-tierek lentebb:** 🟢 NOW = indulásra kész · 🟡 NEXT = green-light után · 🔵 LATER = push-back-first / blokkolt. Minden item commit-méretű; a wave/slice megnevezésével kell zöld-light indulás előtt. Minden tételnél "Fő lépések" + reuse-horgonyok (file:line a dráftelés napján igaz). A ⚠️ OPEN Q-k defaultja a fájl alján (**Nyitott döntések**).

---

## 🟢 NOW — indulásra kész (nincs blokkoló külső input)

### DRAFT-modell + státusz-takarítás epic (TERV, 2026-09-04, jóváhagyásra vár)
Kontextus: a `~/Grafia/OS/grafia-os-dokumentacio.md` munkamodell MM6-os leképezése; a purpose-doksi 9.2/9.4/11.1 nyitott kérdéseire ez a válasz.

**Lockolt döntések (user, 2026-09-04):**
- **Nincs külön brief/work-item réteg és nincs külön draft-tábla — a draft EGY `messages` sor.** Invariáns: `status='DRAFT'` ⟺ `audience IS NULL`. Aminek már van audience-e, az nem draft.
- A draft **a mátrixon kívül** él, saját creative-library-szerű felületen; T0-ban lehet "lukas" (csak szám + brief), a topic *javasolt név*, nem FK.
- A **brief egy normalizált Google Slides file-ID** (nem URL), több draft mutathat ugyanarra. Nincs brief-state, -owner, -due, -seal — a Grafia OS closure-contractjából tudatosan csak az intake-struktúra épül meg.
- Promote = audience+topic hozzárendelés + státuszváltás; a "kép ÉS DCO feed-sor" ág a második axisra **copy**-val megy (fan-out = copy, not create).
- Státuszlánc 12 → 6: `DRAFT → PREVIEW → APPROVED → ACTIVE → INACTIVE`, mellékág `DEAD`; **az archiválás az `archived_at` oszlop, nem státusz**.

**Miért ez a fő nyeremény (a user által megnevezett fájdalom):** a `numbering.ts:24` `isLive` **státusztól függetlenül** számol (`status !== 'deleted' && archived_at IS NULL`), és a `listLiveMessages` (`messages.ts:102`) minden sort visszaad → amint a draft `messages` sor, a **MC-száma T0-ban foglalt** minden további allokációval szemben. Nulla új mechanizmus kell hozzá.

**Mérés a prod DB-n (2026-09-04, erste, 2753 sor):** `ACTIVE` 1768 · `INACTIVE` 959 · `PLANNED` 8 (illegális: nincs a `STATUS_OPTIONS`-ban) · `DEAD` 6 · `CONTENT` 4 · `INCOMING` 4 · `PREVIEW` 4 · **`NAMING`/`APPROVED`/`ARCHIVED`/`ERROR`/`MEMORY` = 0**. Az `archived_at` 9 soron áll, `ARCHIVED` státuszon 0 → az archiválás már ma az oszlopban él. A `draft_messages`/`draft_previews` **mind a 4 kliensen 0 sor** → kockázatmentesen nyugdíjazható.

#### Slice 1 — séma + invariáns
- [x] **D1.1** ✅ `messages.audience` + `topic` NOT NULL → nullable (migráció `0012_shiny_iron_fist.sql`, additív). A `schema.ts` kommentjei átírva: a `status` mellett most ott áll, hogy a DRAFT-ot **az audience hiánya** tartja a mátrixon kívül, nem a státusz.
- [x] **D1.2** ✅ **Három** CHECK constraint, nem egy — a séma őrzi az invariánst, nem a fegyelem:
  - `messages_draft_has_no_audience`: `(status='DRAFT') = (audience IS NULL)` — kétirányú. Az egyik fele draftot nem enged cellába, a másik nem enged elhelyezett sort elveszíteni az oszlopát.
  - `messages_placed_has_topic`: `audience IS NULL OR topic IS NOT NULL` — egy cella (audience, topic) pár. Ez teszi az „van audience-e" szűkítést **helytállóvá** a „van topicja"-ra is, amire a TS-oldali `isPlaced` épül.
  - `messages_draft_has_no_pmmid`: `status != 'DRAFT' OR pmmid IS NULL` — ettől lesz a `getMessageByPmmid` **bizonyíthatóan draft-mentes**, és épp ezen a lekérdezésen keresztül oldja fel a forrásait a **copy és a move**, a két legdrágább tévedésű művelet.
- [x] **D1.3** ✅ `briefs` tábla (`slides_file_id` UNIQUE per kliens, `label`, `archived_at`) + `messages.brief_id` nullable FK `ON DELETE SET NULL` (a brief mutató, nem tulajdonos: elvesztése nem törölheti a munkát) + `messages_client_brief_idx`. **ID-t tárol, nem URL-t** — az I4 leckéje.
- [x] **D1.T** ✅ Integrációs teszt a migrációra (`tests/integration/briefs-draft-invariant.test.ts`, 12 eset, zöld): brief-unicitás kliensenként, cascade, `SET NULL`, „csak számot hordozó" draft, nem létező topic-kulcsú draft, és mind a négy invariáns-sértés **constraint-név szerint** ellenőrizve (nem puszta `toThrow()`, ami egy NOT NULL hibát is átengedne).
- [ ] **D1.4a** ⚠️ **Soft-link következmény (2026-09-04, a legacy-nyomozásból):** a `creatives`, `monitoring` és `prodlist_rows` táblák `(mc_number, mc_variant)` **soft linkkel** mutatnak az MC-re, nem FK-val. Amint a draft is `messages` sor **számmal és variánssal**, minden ilyen link **DRAFT sorra is illeszkedhet**. Konkrét eset már ma: a `MC78b`-hez tartozó 4 kreatív `(78,b)`-re illeszkedik, ami **két axison is létezik** — a DCO-sat most DRAFT-ba tesszük, a nonDCO-s marad. Döntendő: a creative↔cell match **lássa-e** a draftokat (mellette szól: így kap a draft kreatívot; ellene: a `family_known` több-találatos ág zajosabb lesz). A `monitoring` **soha** ne lásson draftot (nincs mérés draft előtt).
- [x] **D1.4** ✅ **Audit lefutott — a `tsc` elvégezte helyettünk: 49 hiba, 11 fájl, mind valódi határátlépés.** Az eszköz: `PlacedMessage = Message & {audience: string; topic: string}` + `isPlaced()` típusőr + a `listPlacedMessages()` lekérdezés a `listMessages` mellett. **Sehol nem `?? ""`** — minden helyszínen vagy a lekérdezés zárja ki a draftot (ez a valódi határ), vagy a művelet eleve nem értelmezett rá.
  - `messages.ts` (19): `updateMessage` **kihagyja a trafficking-újraszámolást** drafton (minden oszlopa a cellából származik) · `findSiblings`/`propagateToSiblings` üresen tér vissza (a draftnak nincs családja) · `sameAxisAs` csak elhelyezett sort fogad · `restoreMessage` szülő-ellenőrzése nem fut drafton (nincs szülője) · a copy **kimondott hibaüzenettel** utasítja el a draftot, a move `not_found`-dal.
  - `feed-export.ts` (6): a lekérdezés `isNotNull(audience)`-szel szűr. *(A régi `isServing` státusz-szűrő is kizárta volna — de az véletlen védelem: egy új státusz vagy egy átsorolás bármikor kinyitotta volna.)*
  - `export-xlsx.ts` (6): `listPlacedMessages` — az XLSX-export a mátrix egy munkalapon.
  - **`rekey.ts` (6): valódi szivárgás volt, nem csak típushiba.** A draft `topic`-ja szabad szöveg, ami *véletlenül* egyezhet egy létező topic-kulccsal — egy rekey így belerántotta volna a draftot és megpróbálta volna regenerálni a nem létező identitását. A `messagesOnKey` mostantól **audience szerint** szűkít, ami a topic-oldali ütközést is levágja.
  - **`topics.ts` (1): ugyanez a csapda** az MC-számlálóban — audience szerint szűkít, nem topic szerint, különben egy draft felfújta volna egy valódi topic MC-számát.
  - **`monitoring/import/route.ts` (1): a legfontosabb.** A draftnak van száma és variánsa — pontosan amire a `family_known` fallback kulcsol —, tehát szűrés nélkül egy riportsor ráilleszkedhetett volna olyan munkára, ami sehol nem futott. Regressziós teszt hozzáadva (`monitoring-table.test.ts`: „never resolves a report key onto a DRAFT").
  - `audiences.ts` (1), `dashboard-products.ts` (3), `dashboard-creatives.ts` (3), `CreativeStrip.tsx` (2): a dashboard a mátrixról riportál, a draft még nincs benne (nincs audience → nincs product). A `StripMessage` mostantól `PlacedMessage`.

**Slice 1–2 állapota (2026-09-04): KÓD-KOMPLETT, box-deploy hátravan.** `tsc` + `eslint` tiszta; **248 unit + 546 integrációs teszt zöld** (64 fájl). ⏳ **A `0012` migráció NINCS élesítve** — a migrate + `pm2 restart` egy passzban megy a boxon, soha nem külön lokális `db:migrate`.

#### Slice 2 — számozás + promote
- [x] **D2.1** ✅ A `sameAxis` a NULL audience-t DCO-nak vette volna → a draft **minden axison** foglalja a számát (`m.audience == null` → mindig „azonos axis"). Enélkül a draft száma csak a DCO ellen lett volna védve, és egy nonDCO create elvihette volna. A draft SAJÁT száma **globális max+1** (mindkét axis + a többi draft fölött): a per-axis szám a promótáláskor — amikor az axis végre kiderül — újraellenőrzésre szorulna és **elmozdulhatna**, ami épp az a bizonytalanság, amiért a foglalás létezik. Explicit claim ütközésére saját üzenet: *„MC number N is reserved by a draft"*.
- [x] **D2.2** ✅ `createDraft` + `promoteDraft` a `messages.ts`-ben (a draft egy message, a számozó gépezetet változatlanul használja). A promote **UPDATE, nem újra-létrehozás** — a draft és a belőle lett kártya ugyanaz az MC, így a szám, a brief-link és az előzmény túléli az átmenetet. Az audience+topic+státusz **egy write-ban** landol (a CHECK összeköti őket, két lépésben az első elbukna). Nem létező topicra **nem promótál** — a topics dimenziót nem hígítjuk fel promote-kor gyártott közel-duplikátumokkal.
- [x] **D2.3** ✅ „Mindkettő" ág **tesztelve, nem csak feltételezve**: a draft EGY kártyává promótál, a másik axis `copyMessages`-szel jön, közös szám alatt, külön pmmid-del (`draft-lifecycle.test.ts`: „reaches both axes under one number").
- [x] **D2.4** ✅ Invariáns-őr az `updateMessage`-ben + 400-as leképezés a PATCH route-on: a `status`/`audience` páros elrontása így **kimondott hibaüzenetet** ad, nem nyers DB-500-at (draftnak audience-t adni, elhelyezett kártyáról audience-t levenni, vagy státusszal visszaminősíteni).
- [x] **D2.T** ✅ `tests/integration/draft-lifecycle.test.ts` — **20 eset**: T0-állapot, javasolt topic-név, mindkét axis fölötti allokáció, számtartás DCO és nonDCO create ellen, „reserved by a draft" hiba, siblings-üresség, promote-invariánsok, variáns-bump, a szám felszabadulása promote után, és a mindkét-axis útvonal.

#### Slice 3 — `/drafts` felület (creative-library-szerű)
- [x] **D3.1** ✅ A `/drafts` `messages`-re áll (`status='DRAFT'`), `listDrafts` **legfrissebb elöl** (worklist, nem katalógus — a mátrix azért rendez szám szerint, mert ott katalógus). Reuse: `creative-card` + `__thumb` / `__meta` / `__mc`, `empty-state`, `toolbar`, `form-field`, `input-box`, `status-badge`, `tag-chip`, `modal__header|body|footer`, `Masonry` (`itemKey`-jel, a stabil-kulcs invariáns szerint).
- [x] **D3.2** ✅ `slides-link.ts` (az I4 `drive-link.ts` párja) + `entities/briefs.ts` + `/api/briefs`, `/api/briefs/[id]`. **A csatolás upsert, nem insert:** ugyanaz a deck editor-linkként és Drive-linkként **egy brief**, különben a közös briefű draftok szétesnének külön csoportokra. A mappalinket kimondott üzenettel utasítja el. Briefenkénti csoportosítás + `N open · M promoted` fejléc — **a Close Check 80%-a állapotgép nélkül**, mert mindkét szám magából a munkából számolódik.
- [x] **D3.3** ✅ **Nem kellett megépíteni — a modellválasztás megoldotta.** A draft egy message, tehát a `message_previews` meglévő verzió-alapú staleness-ét használja; a `collectStalePreviews` template alapján szűr, nem audience alapján, és a `render.ts` **sehol nem hivatkozik audience-re** → a draft renderelhető. A csempe megjelöli az elavult previewt (`stale preview` badge + halványítás) ahelyett, hogy régi képet mutatna jelöletlenül.
- [x] **D3.4** ✅ Side-toolbar a meglévő `right-toolbar` render-prop mintájával (collapsed = ikonsor, nyitott = teljes panel), saját `mm6_drafts_toolbar_open` persistence-kulccsal a `mm6_<page>_<thing>` konvenció szerint. Új blokk: `drafts-panel`, `brief-group`, `drafts-tile`.
- [x] **D3.5** ✅ `/api/drafts` átirányítva (GET: draftok + previewk + briefek egy körben; POST: `createDraft`), `/api/drafts/[id]/promote` az új `promoteDraft`-ra, a régi `/api/drafts/[id]` törölve (a draft szerkesztése `/api/messages/[id]` PATCH — egy draft egy message).
- [x] **D3.T** ✅ `slides-link.test.ts` (7 unit) + `briefs-entity.test.ts` (11 integrációs): file-ID normalizálás minden link-alakra, idempotencia, archivált brief visszahozása, progressz-számlálás, és hogy a brief **mutató, nem tulajdonos** (archiválás/törlés nem viszi el a munkát).

✅ *(A Slice 3 idején fennállt UI↔MCP inkonzisztenciát a Slice 4 lezárta.)*

#### Slice 4 — MCP (agent-facing)
- [x] **D4.1** ✅ A tool-nevek **megmaradtak** (`generate_test_creative`, `list_drafts`, `draft_get`, `draft_status`, `show_draft_previews`, `draft_promote`, `draft_delete`) — az agent-szerződés nem törik —, csak a mögöttes modell változott. Új: **`brief_attach`** (link → file-ID → upsert, egy hívásban draftot is köt hozzá) és **`list_briefs`** (`open_drafts` / `promoted` progresszel). A `generate_test_creative` mostantól visszaadja a **`mc_label`-t is**: az agent azonnal tudja, milyen szám lett lefoglalva. Új opcionális bemenetek: `brief_link`, `working_topic`.
- [x] **D4.2** ✅ `entities/drafts.ts` **újraírva** az új modellre (megmaradt a fő értéke: az egy körben visszaadott, minden problémát felsoroló validáció). A `draft_status` progressze mostantól **derivált** — egy méret akkor kész, ha a preview a draft AKTUÁLIS verziójánál készült —, tehát nincs se `render_status` oszlop, se job-tábla, és egy szerkesztés visszaejti a százalékot, ugyanazzal a staleness-szabállyal, amit a mátrix használ. A `draft_messages` + `draft_previews` tábla **eldobva** (`0013`), a `/api/draft-previews/*` route törölve (a draft previewja immár közönséges MC-preview), a `draft_delete` **archivál** (a szám retired marad, nem kerül vissza forgalomba).
- [x] **D4.3** ✅ `McpTab.tsx` prózája újraírva (a tool-lista auto-szinkron, a próza nem volt az).
- [x] **D4.T** ✅ `mcp-drafts.test.ts` újraírva, **15 eset** — köztük a két legfontosabb: a `generate_test_creative` által foglalt számot az `mc_create` **nem tudja elvenni** („reserved by a draft"), és `draft_delete` után sem szabadul fel („retired"). Az `mcp-auth.test.ts` READ_TOOLS listája kiegészítve a `list_briefs`-szel — ez a teszt fogta meg, hogy új read-tool került be, pontosan ahogy kell.

**Slice 1–5 állapota (2026-09-05): KÓD-KOMPLETT, box-deploy hátravan.** `tsc` + `eslint` tiszta; **257 unit + 542 integrációs teszt zöld** (62 fájl). A UI és az MCP ugyanazon a modellen áll.

✅ **DEPLOYOLVA 6.59.0 (2026-09-05)** — lásd a checkpointot a fájl alján.

#### Slice 5 — státusz-takarítás (12 → 6)
- [x] **D5.1** ✅ **Nem hat listát írtam át, hanem egyet csináltam belőlük.** Új `src/lib/mc-status.ts` a kanonikus lánccal; a `matrix/types.ts`, `MessageEditor`, `DesignTab`, `TemplateEditor`, `branding.ts` és `db/defaults.ts` mind **ebből származtat** (a CSS-változókat és a dot-osztályokat is a lista generálja, nem kézzel írt sorok). Ez nem szépészet: pontosan a hat párhuzamos lista szülte a `PLANNED`-bugot — bekerült a szűrőbe, de sehol máshova, és mivel ismeretlen státusz semmilyen szűrőopcióra nem illeszkedik, az a 8 kártya minden státusz-scope-olt nézetből kiesett. A `globals.css` státusz-változói és `.status-dot--*` / `.status-badge--*` osztályai a hatra szűkítve, `DRAFT` felvéve.
  - Új megkülönböztetés: **`MC_STATUSES`** (6, `DRAFT`-tal — színek, badge-ek) vs. **`MATRIX_STATUSES`** (5, `DRAFT` nélkül — mátrix-szűrő és editor-dropdown). A `DRAFT` felkínálása a mátrixban csak constraint-hibát tudna termelni.
  - A **kliensoldali** zár-lista (`MatrixGrid.tsx:475`, literál `["ACTIVE","INACTIVE","ARCHIVED"]`) is a közös `isMeasurementLocked`-re állt át — ez volt a második drift-csapda, és a törlés-dialógus zárolási figyelmeztetését hajtotta.
- [x] **D5.2** ✅ **`PREVIEW` a születési státusz** (`BIRTH_STATUS`): `createMessage` és az `import-xlsx` fallback is. Ez megszünteti a napi kézi átkattintást — a template-default eddig is kódból jött, csak a státusz nem.
- [x] **D5.3** ✅ A mérés-zár `ACTIVE`/`INACTIVE`-ra szűkült. Az `ARCHIVED` kiesése nem gyengíti: az archiválás az `archived_at` oszlop, és egy archivált sor **megtartja** a státuszát, tehát egy archivált ACTIVE kártyát továbbra is az ACTIVE zár véd. Amit a zár őriz, az a mérés folytonossága — egy sosem mért sornak nincs mit őrizni.
- [x] **D5.4** ✅ `scripts/status-cleanup.ts` + `npm run status:cleanup` — **dry-run az alapértelmezés**, `--apply` ír, egy tranzakcióban. Nem vakon hajt végre: minden sor alakját **újraellenőrzi** (üres? van ACTIVE ikre azonos névvel és képpel? hivatkozik rá kreatív/monitoring?), és ami nem illik a felmért mintába, azt `PREVIEW`-ra teszi a helyén hagyva, nem erőlteti bele egy csoportba. A DRAFT-ág az audience mellett a **teljes trafficking-identitást** (pmmid + 6 UTM + final URL) is nullázza — egy cellátlan sor nem hordozhat a régi cellájára mutató mérési kulcsot.
  - ⚠️ **Futtatási sorrend: `0012` + `0013` migráció ELŐBB.** A script a `brief_id`-t olvassa és `DRAFT`+NULL audience állapotot ír, amit a migrációk tesznek legálissá — migrálatlan DB-n az első lekérdezésen elszáll, nem a munka felénél.
  - Az élő adaton **read-only SQL-lel leellenőrizve**, hogy a besorolás a felmérttel egyezik: 8× `MC21a` üres → DELETE · `MC315 f/g/h/i` ACTIVE-duplikátum → DELETE · `MC6a`/`MC78 a/b/c` tartalommal → DRAFT. Egy megjegyzés a kimenetben: az **`MC78b`-hez 4 kreatív** kapcsolódik, és DRAFT-ként a `(78,b)` soft-link rá is illeszkedni fog — ez a `D1.4a` döntés következménye, ezért a script ki is írja.
- [x] **D5.T** ✅ `status-colors.test.ts` átírva: már nem az `ARCHIVED`-et őrzi (nincs ilyen), hanem azt, hogy **minden státusznak van CSS-változója és csak azoknak** — a hiányzó és a túlélő kulcs egyaránt hiba. `defaults.test.ts` a seedet a kanonikus listához köti (pontos egyezés). `messages.test.ts` (születési státusz) és `copy-move-messages.test.ts` (`ARCHIVED` zár) a szándékos viselkedésváltozás szerint frissítve, kommentben az indoklással.

#### Slice 6 — roadmapre, most NEM építjük
- [ ] **D6.1** Mért MC mozgatása pmmid-folytonossággal: first-class művelet explicit megerősítéssel + a régi pmmid megőrzésével, hogy az ACTIVE-ból visszakattintás kerülőút (és a "feedből némán kiesik" kockázat) megszűnjön. *Megjegyzés: a normál előre-irány (PREVIEW → APPROVED → mozgatás → ACTIVE → feed-export) nem kockázatos — a feed-export ACTIVE-ra gate-el, tehát közben nem exportálódik semmi. Csak a MÁR ACTIVE sor visszakattintása az.*
- [ ] **D6.2** Share-oldali approve gomb → `status='APPROVED'` (ember vagy agent). A purpose-doksi 9.3-as hiánya; az `APPROVED` ezért marad a listában (0 sora **be nem kötöttséget** jelent, nem feleslegességet).

**Legacy adat — ELLENŐRIZVE prod DB-n (2026-09-04), soronként, tartalommal és downstream-hivatkozással:**

| Sorok | Lelet | Verdikt |
|---|---|---|
| `MC21a` ×8 (`PLANNED`, SZA) | **Teljesen üres** (se név, se headline/copy/CTA/kép; csak a kód-default `template='html'`). **0 kreatív, 0 monitoring.** Soha nem módosítva (`updated_at == created_at`, 2026-05-01 15:59:43). | **Törlés.** A `PLANNED` nincs a `MEASUREMENT_LOCKED_STATUSES`-ben, a kód engedi a hard delete-et. Konzervatív alternatíva: `archived_at`. |
| `MC315 f/g/h/i` (`CONTENT`, SZA) | **Pontos duplikátumai a már `ACTIVE` `c/d/e` variánsoknak** — azonos név és `image1` (`f`≡`c`, `g`≡`d`, `h`≡`e`, `i`≡`c` másodszor), **14 másodperccel utánuk** létrehozva (13:43:26 → 13:43:40). Monitoring csak az `a–e`-n (132 sor), az `f–i`-n nincs. Véletlen duplakreálás. | **Törlés.** *(Korrekció: az első tervváltozat tévesen „befejezetlen folytatásnak" minősítette és PREVIEW-t javasolt.)* |
| `MC6a`, `MC78 a/b/c` (`INCOMING`, VAL, DCO) | Valódi copy („Társasházi Számlacsomag / Lakóközösségedre szabva.", `Érdekel!`), de az `image1` **`empty.png`** = szándékos placeholder → **félbehagyott DCO-gyártás**. **2026-08-30-án szerkesztve** (a legacy halmaz legfrissebb aktivitása). Nincs `ACTIVE` iker; a `MC78b` **nonDCO** ikre (`ch_disp`/`ch_soc`, `VAL_Tarsashaz_szamla_pro_b`) **leszállt fájlokkal + 4 kreatívval**, de `INACTIVE`. | **DRAFT** (user, 2026-09-04), onnan a user archiválja. Az audience kinullázása tudatos placement-eldobás; a négy sor négy külön variánst hordoz (`6a`/`78a`/`78b`/`78c`), így NEM olvad össze. A `pmmid` NULL-ra megy (soha nem volt mérve). A `MC78b` **nonDCO** ikre változatlanul marad — másik axis, másik sorok. |

DRAFT-ba egyik sem konvertálható: az invariáns (`DRAFT ⟺ audience IS NULL`) miatt az „átlökés" a placement eldobása lenne; a `MC21a`-nál ráadásul 8 sor → 1 draft összeomlás.

#### Slice 7 — a T0-szám megbízhatósága (a fenti nyomozásból esett ki, 2026-09-04)
- [x] **D7.1** ✅ **SZÁLLÍTVA (2026-09-04).** `mc:` szűrő substring-illesztés (`search-query.ts`) → `mc:21` behozza a `321`-et is. **Ez a user által megnevezett fájdalom konkrét oka** („lekérdezésre rossz számot kaptam"): a képernyőn MC21-nek hitt 48+4 sor valójában **MC321** volt. Javítás: `mcMatches` a `search-query.ts`-ben — a szám **egészére** horgonyoz (`\bmc21[a-z]*\b`), a variáns megadva pontosan illeszkedik, a nem-címke érték (a mátrix a pmmid-et is ebbe a mezőbe pakolja) marad substring. A `CreativeLibrary` ugyanezt a címkét építi, tehát egy javítás mindkettőt rendbe teszi. Teszt: +5 eset (`search-query.test.ts`, 34 zöld); suite 248/248, `tsc` tiszta.
- [ ] **D7.2** **Invariáns-sértés a prodban:** a `321` a **nonDCO axison két topicot fog át** (`HITEL_TCU_2026Q2_fullColorSurface` + `SZK_HITEL_a_TCU_2026Q2_fullColorSurface`), miközben a szabály *„a number never spans topics WITHIN an axis"* (`messages.ts:283`). Valószínű ok: a 2026-08-17-i kézi SQL-átszámozás (`MC838a → MC321a`), ami megkerülte a `createMessage` ellenőrzéseit. Két közel-duplikált topic is keletkezett. Felmérés → egy topicra összevonás vagy külön szám; és **ez az érv a D6.1 (first-class renumber/move) mellett** — a kézi SQL épp az invariánsokat kerüli meg.

### Text-formatting rule: exact-match érvényesítés (render ↔ editor aszimmetria fix)
Gyökér-ok (2026-08-15, MC301b nyomozás): a `render.ts:137-145` a rule-okat **substring-cserével** alkalmazza a teljes HTML-en, míg az editor (`MessageEditor.tsx:1199`) csak **pontos mező-egyezésnél** mutatja őket → láthatatlan szabály érvényesül (pl. a 176-os rule "Most Személyi Kölcsön" → `<br>`-ek belelógnak a hosszabb "…adósság-rendezéshez" copyba). A `feed-spans.ts:32` már most is exact-match — csak a render a bűnös. Hatásfelmérés prod DB-n: 122 aktív rule, mindegyik vagy exact-egyezik valamelyik üzenet-mezővel (működik tovább), vagy teljesen árva (már ma is halott) — **egyik sem támaszkodik szándékosan substring-matchre.**
- [x] **TF.1** `render.ts`: a formatting a placeholder-feloldáskor megy — feloldott érték után rule-keresés `textOriginal === value` + `matchesScope`; size-scoped rule előnyben az univerzálissal szemben (`applyFormatting`, a `feed-spans.ts` `pickVariantForSize` tükre); a teljes-HTML substring-pass törölve; fejléc-komment frissítve.
- [x] **TF.2** Tesztek: a 3 meglévő formatting-teszt átírva exact-match-re + regression (rövidebb rule NEM módosítja a hosszabb szöveget, az MC301b-eset) + size-scoped-vs-universal preferencia teszt. Suite: 556/556 zöld, `tsc` tiszta.
- [x] **TF.3** CHANGELOG (Unreleased/Changed) + bump-javaslat kiadva (minor).
- **Review:** egyetlen érdemi fájl változott (`render.ts`); a formatting mostantól CSAK olyan szövegre hat, ami az editorban is látszik a mező alatt — a render↔editor↔feed-export hármas azonos predikátummal dolgozik. Prod-hatás: a 9 árva rule halott marad, a többi 113 változatlanul él; az átvérzések (pl. 175/176 → hosszabb copyk) megszűnnek.

### DCO/nonDCO mátrix epic — statikus kreatívok first-class MC-ként (AKTÍV)
Cél: a statikus kép-kreatívok is MC-identitást kapjanak (MCP-hivatkozhatóság ingyen), mátrix header DCO/nonDCO toggle-lel; nonDCO oszlop = prodlist channel (6: DISP/SOC/PRG/GSN/GNW/YT), sor = auto-topic a kreatív nevéből. Terv: `~/.claude/plans/van-az-a-feladatd-encapsulated-meadow.md`. Lockolt: nonDCO MC = `messages` sor `template=null`+`image1`; nincs új MC-tábla; FR-A prodlist-ingest épül (deliverable-grain v1).
- [x] **Slice 0 — FR-A prodlist ingest:** `prodlist_rows` tábla (`0004_lumpy_blockbuster.sql`, deliverable-grain, unique `(clientId, deliverableId)`) + `entities/prodlist.ts` (list/get/upsert-batch/update + `listDistinctChannels`) + MCP `list_prodlist` (read) + `prodlist_upsert` (write, `bulk_upsert` audit) + McpTab "Prodlist" group. Teszt: `mcp-prodlist.test.ts` (5, zöld). `scripts/import-prodlist.ts` Slice 4-re halasztva (ingest addig MCP-n). ⏳ **Box deploy hátravan** (migr.+kód egy passzban).
- [x] **Slice 1 — Channel audiences + scoping:** `audiences.channel` oszlop (`0005_brief_pete_wisdom.sql`, nullable, `client_channel_idx`); `Audience` type (matrix + matrix/types) + `WRITABLE_FIELDS` + `createAudience`/`duplicateAudience` `channel`-átvezetés; `scripts/seed-channel-audiences.ts` (6 channel, idempotens). Teszt: `audiences.test.ts` +4 channel-eset. ⏳ **Box: migr.+seed hátravan.**
- [x] **Slice 2 — DCO/nonDCO toggle + szűrő:** `Filters.axis` + `MatrixAxis` (`types.ts`) + persist `mm6_matrix_state_v1` (`MatrixGrid` hydrate+payload); `matrix-axis-toggle` segmented control (`MatrixToolbar.tsx`, inventoryba felvéve); axis-partíció a `filtered` useMemóban (`channel==null` DCO vs `!=null` nonDCO) + axis-scoped audience-count; Clear megőrzi az axist. Nincs séma. `tsc` + 508/508 zöld.
- [x] **Slice 3 — Kép-cella preview template-null MC-hez:** `MatrixIframePreview` új `StaticImagePreview` ág (`template==null && image1` → `/api/drive/proxy/`, `thumb-checker` shell); `PreviewPane` új `staticImage` prop (prioritásos ág, `PreviewIframe` nem kell méret); `MessageEditor.refresh()` skip `/api/render` ha template null + image1. `matrix-static-preview` + `preview-pane__static-*` inventoryba. `tsc` tiszta.
- [x] **Slice 4 — Creative→message promóció:** `entities/promote.ts` (`autoTopicFromFilename` + `promoteCreative` egy tranzakcióban: find-or-create topic → `createMessage` template nélkül → `updateCreative` visszalink `mcNumber/mcVariant`); MCP `creative_promote` (creative_id VAGY file_name; explicit channel VAGY prodlist-familyKey-match; auto-topic VAGY override; already-matrixed refuse). Tesztek: `auto-topic.test.ts` (5) + `mcp-promote.test.ts` (6), zöld. UI "Matrixize" gomb: **halasztva** (agent-only elég v1-re).

### Slice 5 — Creative-library REBUILD lokális forrásból + nonDCO feltöltés (TERV, 2026-08-17, jóváhagyásra vár)
Kiváltó: user a lokális ground-truth-ből (`~/ERSTE Addressable AI Agent/creatives` 3417 fájl + `static_creatives_export.csv`) akarja újraépíteni a Creative Library-t, majd feltölteni a nonDCO mátrixot. **Előfeltétel kész:** nonDCO product-filter bug fix (`MatrixGrid.tsx:619` — csatorna-oszlopok product=NULL, nem szabad product-re vágni őket; kód alkalmazva 2026-08-17). Filename-formátum: `ERSTE_<PROD>_MC<N>_<var>_<TOPIC>_n<ver>_<WxH>.<ext>`, a `parseCreativeFilename` már bontja (`keywords` = a user topic-ja).
- **User-lockolt szabályok:** channel = méret-map (`1080x1080`+`1200x628` → SOC, minden más → DISP; többi channel később); topic = a `keywords` string **egy az egyben** (NEM a Slice-4 slug); mc/variant/version a **fájlnévből**.
- ⚠️ **Eltérés a Slice-4 gépezettől:** `promoteCreative` per-creative dolgozik, MAGA oszt MC-számot, és slug-topicot csinál → a rebuildhez kell egy script ami (a) a fájlnév MC-számát/variánsát megőrzi, (b) családonként (mc+variant+topic) EGY nonDCO MC-t rak channelenként a legfrissebb verzió képével, (c) topic = teljes keyword.
- **User-döntések (2026-08-17):** backup = CSV-dump + hard-delete (MinIO bájt marad); MC-szám a fájlnévből; Adobe PSD = mind hard-delete; rollout = sample-first LTP. Számmodell-ütközés (`egy szám = egy topic` vs fájlnév-szám, MC284 három topicon) feloldva: **topic per-szám = a variant-'a' keywordje**.
- [x] **nonDCO product-filter bug fix:** `MatrixGrid.tsx:619` — a 6 channel-audience `product=NULL`, product-szűrőkor kivágódtak → üres nonDCO grid. Fix: nonDCO-ban a product-szűrő nem vágja az audience-tengelyt, csak a topicokat. `tsc` tiszta.
- [x] **Script `scripts/rebuild-creatives.ts`** (termékre paraméterezve, dry-run default / `--commit`): (1) product creatives+uploaded_files hard-delete, (2) product Adobe PSD DCO MC-k hard-delete, (3) reimport folderből (`uploadFile`+`createCreative`, csak image+video), (4) nonDCO MC-k: kártya=(szám,variant), primary channel `createMessage`-dzsel (szám/variant megőrizve, MC0→auto), többi channel `copyMessages`-szel, channelenként saját méret-preview; channel=méret-map (1080x1080+1200x628→SOC, más→DISP); topic per-szám; creative back-link.
- [x] **Backup:** `~/ERSTE.../backup_20260817_113401/` — `creatives_rows.csv` (3035) + `uploaded_files_rows.csv` (3357), visszatölthető.
- [x] **LTP sample COMMIT (2026-08-17):** 51 régi creatives+uploaded_files törölve, 8 Adobe PSD DCO MC törölve (282-285), 51 creatives újraimportálva, **13 kártya → 21 cella** (13 SOC + 8 DISP), 12 új topic. Verifikálva: mind template-null+image1, mind a 21 image1 feloldódik uploaded_files-ra, 0 LTP PSD maradt, `tsc` tiszta. **⏳ User UI-review vár** (reload → nonDCO → LTP), utána a többi termék (SZA/SZK/VAL/HK/MARKET/HITEL).
- [x] **Deploy 6.15.1 (2026-08-17):** nonDCO product-filter bug fix élesben (box git pull + build + pm2 restart).
- [x] **LTP review-fixek (2026-08-17, 6.15.2):** (1) az új nonDCO topicok `product=NULL` voltak → LTP-szűrőre eltűntek; javítva a scriptben (`createTopic … product`) + a 9 LTP topic élőben back-fillelve `product=LTP`. (2) PreviewPane statikus mód: a DCO size-dropdown/skip-anim/image-preview vezérlők elrejtve template-null MC-nél → tiszta Creative-Library-stílusú kép-box (fájlnév-label + kép + háttér-váltó). `tsc` tiszta, deploy kész.
- **User review verdikt:** topic-szám modell OK; product-tag + preview-box javítva.
- [x] **nonDCO preview méret-switcher (2026-08-17, 6.16.0, deployolva):** a statikus MC preview dropdownja a kreatív VALÓDI tárolt méreteit listázza (azonos MC szám+variant → `creatives` sorok), váltásra az adott méret fájlját mutatja. Új scoped route `GET /api/creatives/by-mc?number=&variant=` + `listCreativesByMc`; PreviewPane statikus mód = Creative-Library-stílusú box (checker háttér default, bg-toggle, nincs template/animáció vezérlő). `tsc` tiszta; box health: `/api/creatives/by-mc` → 401 auth nélkül (helyes).
- [x] **Tengely-tudatos MC-számozás (2026-08-17, 6.17.0):** user-korrekció — DCO és nonDCO külön szám-tér, egy MC-szám párosíthat egy DCO kártyát a statikus nonDCO ikertestvérével (más topicban); a „szám nem ível át topicon" invariáns csak a cél audience TENGELYÉN belül él (`createMessage`, `channel==null` DCO vs set nonDCO). +2 teszt (cross-axis pár OK; nonDCO-n belül tiltott), 33/33 zöld. A `rebuild-creatives.ts` átírva **direct-insert**-re (pmmid+trafficking a valódi generátorokkal) → a fájlnév-szám DCO-pár mellett is megmarad, egy szám vihet eltérő variánsokat channelenként; a script **idempotens** (re-run előtt törli a termék nonDCO MC-it).
- [x] **TELJES ROLLOUT KÉSZ (2026-08-17):** mind a 7 termék újragenerálva a javított logikával. **826 nonDCO MC**, **3145 creatives**. Verifikálva: **DCO szám átível topicon = 0** (user fő szabálya), **Adobe PSD maradék = 0** (mind a 99 törölve), **feloldhatatlan preview = 0**. DCO/nonDCO **MC332-pár** él (DCO emlkezteto + nonDCO remarketing, azonos szám). Backupok: `~/ERSTE.../backup_20260817_113401/` (creatives, uploaded_files, törölt DCO placeholder MC-k, 339→332 renumber).
- **DCO-tisztítás (2026-08-17):** MC459a + 8 üres-template/preview DCO placeholder MC hard-delete (backup CSV); MC339a/b/c → MC332a/b/c átszámozva (pmmid+trafficking konzisztens).
- [x] **nonDCO topic on-the-fly (2026-08-17, 6.18.0, deployolva):** user-kifogás — a ~322 kép-származék topic hígította a DCO `topics` táblát. Javítás: a matrix nonDCO módban a sorokat a kreatív-backed üzenetekből képzi (`message.topic` = keyword, product a `<PROD>_` prefixből), NEM a topics táblából (`MatrixGrid.tsx` `nonDcoTopics` memo). A `rebuild-creatives.ts` már nem hoz létre topic-sort. A 322 nonDCO topic törölve a táblából (backup `deleted_nondco_topics.csv`); topics tábla most 83 (csak DCO), 826 nonDCO üzenet sértetlen.
- **Nyitott / megfigyelés:** nonDCO-ban a fájlnév-szám termékenként ismétlődhet → egy nonDCO szám megjelenhet két product-topicban (külön cella/pmmid, nem ütközik; a user DCO-szabálya nem tiltja). Ha nonDCO-egyediség kell, a scriptbe within-nonDCO ütközés-feloldás kell. Video-only channel (YT) + PRG/GSN/GNW méret-map: később. Deferred: nonDCO auto-topicok üres sorként a DCO nézetben (Slice-4 topic-scoping).

### Agentic test-creative gyártás MCP-n — `generate_test_creative` + draft pipeline (KÓD-KOMPLETT 2026-08-13)
Cél: agent mintát kérdez (mc_get / list_assets / get_media_file — mind létezett), külső eszközzel szöveget+képet generál, képet `asset_upload`-dal feltölti, majd `generate_test_creative` a mátrixon KÍVÜL draftol (`draft_messages`), méretenként async PNG-t renderel (közös Playwright-mutex), progress `draft_status` pollinggal (% + elapsed). Terv: `~/.claude/plans/k-ne-nekem-egy-j-functional-raven.md`.
- [x] **Slice 0** — `draft_messages` + `draft_previews` táblák (`0006_harsh_guardian.sql`) + tábla-teszt (5).
- [x] **Slice 1** — `preview-shooter.ts` generalizálás (`shootItems` persist-callbackkel, `shootPreviews` szignatúra változatlan) + `entities/drafts.ts` (create/render/status/list/get/delete/promote) + 16 teszt.
- [x] **Slice 2** — publikus `/api/draft-previews/[id]` + MCP `generate_test_creative` (async, azonnali draft_id) + `draft_status` (percent/elapsed/stalled) + 3 route-teszt.
- [x] **Slice 3** — MCP `list_drafts`/`draft_get` (read) + `draft_delete`/`draft_promote` (full) + `show_draft_previews` widget (MC-widget reuse) + 8 MCP-teszt.
- [x] **Slice 4** — `/drafts` oldal (masonry + render-progress polling + promote/delete dialog) + session route-ok (`/api/drafts*`) + Sidebar + component-inventory.
- [x] **Slice 5** — McpTab "Drafts" group + prose, CHANGELOG, bump **6.12.0**.
- [x] **Box deploy 2026-08-13:** migráció `0006` + kód egy passzban, élesben verifikálva (táblák + route-ok élnek).
- Halasztva (valós igényre): draft-edit tool (most: újragenerálás), TTL-cleanup, idempotency-kulcs a generate-hez.

### Scripts: unawaited `getActiveClient()` sweep (PG-cutover maradvány)
A `getActiveClient()` a SQLite→PG váltáskor lett async; a route-okat akkor javították, a `scripts/`-et nem (a tsconfig nem fedi, `tsc` nem fogja). A `seed-channel-audiences.ts` élesben elhasalt (`UNDEFINED_VALUE`, params:[undefined]) — 2026-08-13-án javítva. **9 további script ugyanígy törött:** scan-creatives, import-erste-sample, link-creative-files, reimport-media, import-erste, seed-multi, seed-perf, seed-keywords, seed-dev. Háromnál a befogadó `main()` nem is async → scriptenként kell (async-esítés + hívás). Előbb döntsd el, melyik retire-elhető (import-erste* / seed-dev SQLite-éra); a maradékra egyenkénti fix + kézi futtatás-teszt.
- [ ] Retire-vs-fix döntés scriptenként, aztán a maradék javítása egyesével.

### M9 — MC archiválás UI-ból (legkisebb; backend teljesen kész)
Cél: MC-t archiválni/visszaállítani lehessen az appból (ma csak MCP/HTTP). A DELETE-hívás + ARCHIVED status már megvan (`MessageEditor.tsx:1275`), csak a dedikált gomb hiányzik.
- [ ] **M9.1** Archive/Restore control a `MessageEditor` header action-clusterébe (`:544-624`), a `MediaEntityDialog:319,408-428` mintát másolva. Archive → `DELETE /api/messages/[id]` `If-Match: version`; Restore → `POST /api/messages/[id]/restore`; `parent_archived` 409 tiszta üzenettel; `["messages",{showArchived}]` invalidáció + dialog-zárás.
- [ ] **M9.2** (opcionális) chip-context akció `GridView.tsx`-ben editor-nyitás nélkül.
- [ ] **M9.3** (szomszédos, külön commit) audience/topic Archive-akció a `DimensionEditPanel`-be — a restore route-ok + editor-szintű showArchived már élnek, csak a panel kínál ma kizárólag hard-delete-et.

### M10 — Bulk Delete az edit-mode panelben: Archive **vagy** Delete dialog (✅ KÉSZ, 6.22.0, 2026-08-17)
Kiindulás: `EditModePanel.tsx:88-96` — a Delete gomb be van drótozva `disabled`-re (`title="Bulk delete — coming in v2"`), nincs mögötte se handler, se endpoint; a Copy/Move mögött ott a `bulk-copy`/`bulk-move`. Cél: kijelölés → Delete → dialog két kimenettel: **Archive** (soft, `archived_at`, „Show archived"-dal visszahozható) vagy **Delete** (hard, sor törlése), hogy az archívum ne teljen meg szeméttel. Rokon: M9 (egy-kártyás archive az editorból) — más belépési pont, ütközés nincs.
- [x] **M10.1** Entity-réteg (`lib/entities/messages.ts`): `archiveMessages()` + `deleteMessages()` a `moveMessages` (`:869`) mintájára — `{mcLabel, expectedVersion}[]`, egy tranzakció, hibán `{ok:false, reason, mcLabel}`. Reason-ök: `version_conflict`, `not_found`, `row_locked_by_status`, `creative_linked`.
  - Hard delete tiltva, ha a státusz a `BLOCKED_MOVE_STATUSES`-ban van (`:859`, ACTIVE/INACTIVE/ARCHIVED) — mérés-zárolt sor csak archiválható. A konstans mostantól két műveletet szolgál (move + delete), ezért semlegesebb néven (`MEASUREMENT_LOCKED_STATUSES`), egy fájlon belüli 2 hivatkozás.
  - Hard delete tiltva, ha ez az **utolsó élő (number, variant)** sor és van rá `creatives` back-link (`mc_number`/`mc_variant` nem FK, lógva maradna). Az üzenet nevezze meg az esetet (a többi MC-hiba stílusában).
  - Amit az FK elintéz: `message_previews` cascade (`schema.ts:353`), `monitoring.message_id` → null (`:621`), `draft_messages.promoted_message_id` → null (`:423`). A MinIO-ban maradó preview-PNG-k a meglévő `scripts/cleanup-unused-assets.ts` dolga, nem itt.
- [x] **M10.2** Route: `POST /api/messages/bulk-delete`, body `{ mode: "archive" | "purge", items: [{mc_label, version}] }`, a `bulk-move/route.ts` szerkezetével (zod + `withSession` + `denyDemo` + tranzakció + reason→HTTP: 409/404/400). Audit: hard delete-nél **soronként** `action:"delete"` a teljes `before`-ral (a sor után ez az egyetlen nyom), archive-nál egy aggregált `bulk_archive` (mint a `bulk_move`).
- [x] **M10.3** Dialog: `matrix/DeleteMcDialog.tsx` — `ModalBackdrop` + `modal`/`modal__header`/`modal__close` osztályok a `CreateMcDialog` mintájára, `alert-dialog` danger-tokenek (`bg-rose-600`, `ShieldAlert`) az `AlertDialog.tsx:139-144`-ből. Három kimenet (Archive / Delete permanently / Cancel), ezért nem fér az `AlertDialog` confirm API-jába (az bináris). Tartalom: N kijelölt MC + státusz-bontás; ha van zárolt sor, a Delete gomb disabled + `title` megnevezi, hány sor és miért.
- [x] **M10.4** Wiring (`MatrixGrid.tsx`): `deleteMutation` a `copyMutation`/`moveMutation` mintájára (`:296-318`), `EditApi` bővítés `openDeleteDialog` / `closeDeleteDialog` / `applyDelete(mode)`, `bulkBusy` + `bulkError` kiterjesztése (`:423-433`), siker után `invalidateQueries(["messages"])` + `clearSelection()`. A dialog a `CreateMcDialog` mellé renderelve (`:965`), mert a státusz-bontáshoz a `messagesById` kell. `EditModePanel.tsx:88-96` gomb élesítése (a `disabled` és a v2-title törlése).
- [x] **M10.5** Tesztek (lokális PG :55432): archive-bulk, hard delete törli a sort + a `message_previews` sorokat, status-lock elutasítás, creative-linked elutasítás, `version_conflict`.
- [x] **M10.6** `tasks/component-inventory.md` (`delete-mc-dialog`) + CHANGELOG + verzió: **minor, `6.21.0` → `6.22.0`** (új route + új UI-akció).

**User-döntés (2026-08-17):** státusz-zár OK; creative-linked eset = **tiltás** (nem néma unlink); egy dialog két akciógombbal. Így ment ki.

### M3 — Üres-vs-tele cella szín-különbség megszüntetése (✅ KÉSZ, 6.24.0, 2026-08-25)
Cél: egységes cella-háttér, hogy a color-by (M1) tiszta alapon üljön.
- [x] **M3.1** `GridView.tsx` PlainCell (`:665`) + EditableCell (`:733`): a `messages.length===0 ? "bg-slate-50/50 dark:bg-white/[0.03]" : "…bg-surface"` feltételes háttér lecserélve egységes `"bg-surface"`-re; a `matrix-grid__cell--has-messages` osztály megmarad szemantikus hookként (nincs saját CSS-e, sehol nem hivatkozzák CSS-ből). A drop-target/reject ring (EditableCell) érintetlen. `tsc` exit 0.

### M2 — "Hide inactive" checkbox a SAROK-cellába (audience + topic sor/oszlop)
Cél: INACTIVE audience/topic sorok/oszlopok elrejtése (MC-t soha). **User-döntés (2026-08-25): a checkbox a mátrix bal-felső SAROK-cellájába (`matrix-grid__corner`, `GridView.tsx:201`) kerül a transpose-gomb mellé, NEM a toolbarba.**
- [x] **M2.1** `hideInactive` state + persist a `mm6_matrix_state_v1`-be (`MatrixGrid.tsx`: `PersistedState`, hydrate, payload, default `false`). Prop + setter le a `GridView`-ba.
- [x] **M2.2** Checkbox a sarok-cellába (`GridView.tsx` `matrix-grid__corner`): `Hide inactive` pipa a transpose-gomb alá (`flex-col`), `normal-case font-normal` override; a sarok `h-20` marad.
- [x] **M2.3** Szűrő a `filtered` useMemóba: `hideInactive` esetén `auds`/`tops` `status!=="INACTIVE"` szűrés az `audKeys`/`topKeys` kiszámítása ELŐTT (MC a header eltűnésével esik ki); MC-t/archive-ot nem érint. **✅ KÉSZ (6.23.0, 2026-08-25).**

### M11 — Drag-and-drop sorrend a mátrix headereken (edit mode, `orderIndex`)
Cél: edit módban a sorok/oszlopok drag-drop-pal átrendezhetőek; a sorrend a meglévő `orderIndex`-be mentődik (audiences + topics). **User-döntés (2026-08-25): mindig látszó handle, de CSAK edit módban; sor elején (bal szél), oszlop alján a szín-border (`audienceEdgeClasses`) FELETT; minden density nézetben.**
Reuse: a `keywords/reorder` minta (`reorderKeywords` `entities/keywords.ts:190` + `POST /api/keywords/reorder` route + `KeywordsTab` reorder mutation `:149`). A grid már használ `@dnd-kit/core` DndContextet MC-chip drag-re (`GridView.tsx:100-146,460`), abba ágazok be.
- **Fázis 1 — valódi `orderIndex`-szel bíró entitások (DCO audiences+topics, nonDCO channel-audiences): ✅ KÉSZ (6.23.0, 2026-08-25).**
  - [x] **M11.1** Entity: `reorderAudiences`/`reorderTopics` (`entities/audiences.ts` / `topics.ts`), EGY tranzakcióban. **Permute-within-occupied-slots** (nem 0..N reindex): `slots = present.map(orderIndexOf).sort(asc)`, `newOrder[i] → orderIndex = slots[i]`; csak a küldött csoport pozíciói permutálódnak → DCO/nonDCO nem interleave-el. Más kliens id-ja + <2 id no-op.
  - [x] **M11.2** Route: `POST /api/audiences/reorder` + `POST /api/topics/reorder`, `withSession`+`denyDemo`, body `{ ids }`, audit `bulk_update` (before/after orderIndex). Bad-body → 400.
  - [x] **M11.3** GridView DnD: `ro:<kind>:<id>` draggable + `rod:<kind>:<id>` droppable a `mc:`/`cell:` mellé; `onDragStart`/`onDragEnd` branch a prefixre; drop → splice a látható `audiences`/`topics` prop id-listájában (nem `rows`/`cols` — a callback a korai return ELŐTT van) → `onReorder` → invalidate. Kind az id-ben kódolva (nincs stale-closure a rowKind-ra).
  - [x] **M11.4** Handle: `HeaderReorderHandle` (mindig látszó grip, CSAK edit módban) — `GripVertical` a row-header bal szélén (`inset-y-0 left-0`), `GripHorizontal` a col-header alján a szín-border felett (`inset-x-0 bottom-0`), a gomb `pl-4`/`pb-3.5` paddinggal nem takarja a szöveget; `HeaderDropZone` pointer-events-none overlay (geometria-alapú collision, isOver ring). Dense is támogatott. `topicReorderable={axis==="dco"}` → nonDCO synth topic-sor nincs grip.
  - [x] **M11.5** Tesztek: `reorderAudiences` (reverse, permute-slots, foreign-client drop, <2 no-op) + `reorderTopics` (permute-slots). ⚠️ **Nem futott le** — se Docker daemon, se lokális PG-szerver (csak libpq kliens); tsc tiszta + unit 181/181 zöld. Az integ-suite futtatása Docker-t igényel.
  - [x] **M11.6** CHANGELOG + bump **minor `6.22.2` → `6.23.0`** + component-inventory (`matrix-grid__row-reorder`/`__col-reorder`/`__reorder-overlay`/`__hide-inactive`).
- **Fázis 2 — nonDCO SZINTETIZÁLT topic-sorok sorrendje (⚠️ ÚJ TÁROLÁSI RÉTEG — push-back-first):** a nonDCO topic-sorok a `message.topic` keywordből szintetizálódnak menet közben (`MatrixGrid nonDcoTopics`, 6.18.0 óta nincsenek a `topics` táblában), nincs `orderIndex`-ük. Sorrend-mentéshez **új overlay-tábla kell** (`matrix_row_order(clientId, axis, rowKey, orderIndex)`, `0007+` migráció, deploy egy passzban). A user kérte ("handle mindenhol"), de ez külön epic — **3-kérdéses push-back kell (tényleg kell perzisztens sorrend a szintetizált soroknak? legolcsóbb 80% = kliens-oldali localStorage-order? build vs outcome?) MIELŐTT tábla születik.** Fázis 1 leszállítása után külön green-light.

### W2.6 + W2.7 — Unmatrixed filter pill + badge (Creative Library)
Cél: uploaded creative-ek MC-link nélkül láthatóak/szűrhetőek legyenek. (A link-mezők + a `CreativeDetailDialog` szerkesztés már él — csak a szűrő/badge hiányzik.)
- [ ] **W2.6** `All | Matrixed | Unmatrixed` pill a `CreativeLibrary` toolbarba (`:821-823` mellé), meglévő toolbar-pill stílus. Logika: `kind==='uploaded' && (mcNumber==null || mcVariant==null)`; persist `mm6_creative_library_match_filter`; `(N)` count.
- [ ] **W2.7** `status-badge--unmatrixed` sarok-badge a tile-on (látszik "All"-ban is).

### D1 — Státusz-szűrő: MC-darabszám opciónként a szűrt eredményben (✅ KÉSZ, 6.31.0, 2026-08-30)
Cél: a Status legördülőben minden opció jobb szélén **kis szürke szám** = hány MC esik arra a státuszra a JELENLEGI szűrt eredményben. Nem pill, nem badge (a pill a gombon már megvan) — csak jobbra igazított `text-xs text-slate-400`.
Reuse: a `MultiPill` már fogad opciónkénti extrát és rendereli az opció-sorban (`optionColors` → színpötty, `_components/MultiPill.tsx:140-143`); ugyanoda kerül egy `optionCounts?: Record<string, number>` prop `ml-auto` számmal. Forrás: a `MatrixGrid` `filtered` useMemója.
- [x] **D1.1** `optionCounts` prop a `MultiPill`-be + jobbra igazított szürke szám (nincs szám → nem renderel semmit).
- [x] **D1.2** `statusCounts` a `MatrixGrid`-ben → `MatrixToolbar` (`:80-85`) → `MultiPill`. **Fontos:** a számot a **státusz-szűrő alkalmazása ELŐTTI** részhalmazon kell képezni (product + search + axis + hide-inactive már ráment), különben minden kiválasztott státusz önmagát számolná, a ki nem választottak meg mindig 0-t mutatnának.
- ⚠️ Default: ugyanez a prop a Product-szűrőre is rámegy (egy hívási sor), ha a user kéri — nem külön munka.

### SV — Sankey view + Feed view kivezetése + egyesített Export box (✅ KÉSZ + DEPLOYOLVA, 6.60.0–6.60.2, 2026-09-05)

**Kérés (user, 2026-09-05):** a Feed view mint nézet szűnjön meg (a hatalmas tábla nem nézet), a helyére
Sankey kerüljön; a feed-táblázat költözzön az export modulba egy kapcsoló mögé; a jobb toolbar Export
doboza grid view-ban kapjon egy **Matrix / Feed** kapcsolót, ágonként saját setuppal és figyelmeztetéssel.

**Döntések (user, 2026-09-05):** szintek forrása = a meglévő `treeStructure` config (nincs új
`sankeyStructure` mező) · render = `d3-sankey` layout + saját SVG (a `tasks/cost-sankey-szakertes.md`
§5b ajánlása; a dependency engedélyezve) · a feed-tábla a mostani `FeedView` komponens, toggle mögött.

**Fontos elhatárolás:** ez a **struktúra-sankey** (szalagvastagság = üzenetszám), nem a
`cost-sankey-szakertes.md`-ben elemzett **cost-sankey** (az a monitoring oldalra való, `sum(cost)`
súllyal, és külön munka marad). A szakértés library-választása és rajzolási best practice-ei viszont
1:1 érvényesek itt is.

#### SV.1 — Sankey view (`_views/SankeyView.tsx`)
- [x] **SV.1.1** `d3-sankey` + `@types/d3-sankey` dependency (3 kB, csak layout).
- [x] **SV.1.2** `_tree/buildSankey.ts` — a **meglévő** `parseTreeStructure` + `buildTree` kimenetéből
      (`TreeData`: `nodes[{id,level,label,count,parentId,platform,messageId}]` + `edges`) d3-sankey
      gráf: node = tree-node, link value = a cél-node `count`-ja. Nincs új parser, nincs új config.
- [x] **SV.1.3** Top-N + „Other (N)" összevonás oszloponként (default 20). E nélkül a Messages-szint
      2700 levele olvashatatlan. `nodeSort`-tal a sorrend determinisztikus (count desc, majd label).
- [x] **SV.1.4** SVG render a TreeView vizuális nyelvén: ugyanaz a node-doboz, ugyanazok a
      `--lvl-0..5` / `--plat-*` csík-tokenek, CSS-változós dark mode, szemantikus osztálynevek
      (`sankey-view__node`, `__ribbon`, `__label`, `__count`). Csak node-ok kapnak címkét, szalag soha.
- [x] **SV.1.5** Interakció: hover = a **teljes útvonal** kiemelése (előre számolt path-halmaz) +
      tooltip (count + státusz-bontás); leaf klikk → `onOpenMessage`; archivált levél halványan
      (`row--archived`, a TreeView mintájára).
- [x] **SV.1.6** Pan/zoom = **ReactFlow, egyből** (user döntés, 2026-09-05; a szakértés „bónusz opciója").
      A d3-sankey koordinátái mennek a meglévő `@xyflow/react` canvasra: node `position={x0,y0}` +
      `width/height` a layoutból, él = custom edge a d3 `sankeyLinkHorizontal()` path-ával,
      `strokeWidth = link.width`. Így a pan/zoom/minimap és a toolbar `TreeViewNavigator` szekciója
      ingyen jön (a `ReactFlowProvider` már a `MatrixGrid`-en ül), és a Sankey tényleg a Tree másik
      megjelenítése lesz. A node-nak rejtett `Handle`-ök kellenek (left target / right source), hogy az
      él kirajzolódjon.
- [x] **SV.1.7** Loading / invalid-structure / empty state a `TreeView` három állapotának pontos
      mintájára (ugyanaz az `empty-state` doboz, ugyanaz a „Settings → Structure" mutató szöveg).

#### SV.2 — Feed view kivezetése
- [x] **SV.2.1** `types.ts`: `View = "grid" | "sankey" | "tree"` (a `"feed"` kikerül).
- [x] **SV.2.2** `MatrixGrid` hydrate-guard (`:196`): a perzisztált `"feed"` érték **`"grid"`-re migrál**,
      különben a mentett állapotú userek üres nézetet kapnának.
- [x] **SV.2.3** View-kapcsoló mindkét alakja: `CycleIconButton` (collapsed) + `ViewControls`
      (expanded) — Feed helyére Sankey, ikon `Waypoints` (lucide), label „Sankey view".
- [x] **SV.2.4** `FeedView.tsx` **marad a fájlfában**, de már csak a `FeedExportDialog` importálja.

#### SV.3 — Feed-tábla az export modulba
- [x] **SV.3.1** `FeedView` kap opcionális `onOpenMessage`-et: ha nincs, a sorok nem kattinthatók
      (dialógusban nem nyitunk MessageEditort a dialógus fölé).
- [x] **SV.3.2** `FeedExportDialog`: „Feed rows" nyitható blokk a **Diff details `<details>` mintájára**,
      benne a `<FeedView>` a dialógus saját `messages`-ével — ugyanaz a `feedStructure` oszlopkészlet,
      ugyanaz a kliensoldali pattern-kiértékelés, mint a régi nézetben.
- [x] **SV.3.3** `audiences` + `topics` átvezetése `MatrixGrid` → `FeedExportPanel` → `FeedExportDialog`
      (a `FeedView` ezekből oldja fel az `{{audiences[...]}}` placeholdereket).

#### SV.4 — Egyesített Export box a jobb toolbarban (grid view)
- [x] **SV.4.1** `ExportPanel.tsx` — egy doboz, tetején **Matrix | Feed** kapcsoló a meglévő
      `mode-switch` / `ToggleBtn` nyelven (nem új token), alatta a választott ág setupja.
- [x] **SV.4.2** Matrix ág = a mostani `MatrixExportPanel` tartalma változatlanul (filter-chipek +
      Download XLSX). Feed ág = a mostani `FeedExportPanel` változatlanul, **a gating-figyelmeztetéssel
      együtt** (egy product + ACTIVE/INACTIVE), plusz a „Live: vN / Default / uploaded" blokk.
- [x] **SV.4.3** Az ág-választás perzisztál: `mm6_matrix_export_mode` (a `mm6_<page>_<thing>` konvenció).
- [x] **SV.4.4** A `view === "feed"` ág törlése a `MatrixGrid` toolbar-renderjéből.

#### SV.5 — Doksi + zárás
- [x] **SV.5.1** `tasks/component-inventory.md`: `sankey-view__*` család + az `export-panel` kapcsoló;
      a `feed-export-panel` / `matrix-export-panel` bejegyzések „mostantól az `export-panel` ágai".
- [x] **SV.5.2** `docs/REBUILD_SPEC.md` §6.2: a Feed nézet leírása átkerül az export-dialógushoz,
      a Sankey a 3. nézet lesz (a §18.10 „out of scope — Sankey" pont törlendő).
- [x] **SV.5.3** Verzió: `6.59.1` → **`6.60.0`** (minor: új nézet + eltávolított nézet + toolbar-átalakítás)
      + `CHANGELOG.md`.

**Amit NEM csinálunk:** nincs `sankeyStructure` config, nincs cost-dimenzió a matrix-sankey-ben,
nincs v5 canvas-renderer portolás, nincs napi/animált bontás.

**DEPLOYOLVA 6.60.0 + 6.60.1 + 6.60.2 (2026-09-05):** commitok `cae6f7d` → `e124024` → `de380e0`, box `a868804`→`de380e0`, build 38.4s / 41s, `npm install` a boxon is kellett (**új dependency: `d3-sankey` 3 kB + `@types/d3-sankey`**), `pm2 restart mm6-erste --update-env` → online. **Séma-migráció nincs** (`git diff --name-only a868804..de380e0 -- db/migrations` üres). Health: `/` 307 · `/login` 200 · `/matrix` 307 · `/feeds` 307 · `/monitoring` 307 · `/api/feed-exports` 401 · `/mcp` 401 · publikus `erste.messagingmatrix.ai/login` **200**. Élőben ellenőrizve: Sankey renderel (SZK 677 → pro 444 / rem 233 → audience → topic → MC, Other-láncokkal), hover = teljes útvonal + tooltip státusz-bontással, Navigator ráköt, Export box Matrix|Feed kapcsolóval és perzisztálva, „Feed rows" checkbox mögött a feed tábla a dialógusban.

**Két utólagos javítás, mindkettő élőben talált:**
- **6.60.1 — a címkék egymásra csúsztak a sűrű oszlopokban.** A node magassága arányos az értékével, tehát ahol egy `Other` viszi a flow 90%-át, a maradék húsz sub-pixel csík: az egyetlen garantált elválasztás a node-ok közti `nodePadding`, ami 10px-en nem ért túl egy 18px-es címke-pillen. 22px lett, és a canvas magassága a legmagasabb oszlophoz igazodik.
- **6.60.2 — a tooltip rossz sarokban nyílt.** Az utolsó `mousemove`-ból pozicionált, de a `mouseover` ugyanarra a pozícióra **előbb** tüzel, tehát a minta mindig egy mozdulattal késett — az első hovernél pedig egyáltalán nem volt minta, és a tooltip a canvas origójába esett. A hover-esemény most viszi a saját koordinátáit, a canvas szélénél beszorítva.

**Utókövetés — 6.61.0 (2026-09-05, user):** a „pipás preview gomb" a **toolbar feed-paneljéből** hiányzott — a checkbox az export-dialógusba került, a diff mellé. Az a két kérdés nem ugyanaz: a dialógusbeli azt mondja meg, *mit küld ez az export*, a panelbeli azt, *mi van most a feedben*. Mindkettő megmarad; a panelben egy „Preview feed rows" checkbox ül **közvetlenül az Export gomb fölött**, és `AppDialog`-ban nyitja a `FeedView`-t a jelenlegi szűrésre (onnan semmi nem exportál). Commit `18fa9bb`, build 39.0s, box `6.61.0`, health `/` 307 · `/login` 200 · `/matrix` 307. Élőben ellenőrizve: VAL / 221 sor.

**6.61.1 (ugyanaz a session, user):** „azért nem jó az export dialógusba, mert nincs sor-previewnak még egy dialógus-layer, ne is legyen, jobb a previewt kint tartani." → a `feed-export-dialog__rows` blokk **törölve**; a tábla a dialóguson belül szűkítette az export saját setupját, és a dialógus a *döntésre* való (mi megy ki), nem sorböngészésre. A preview kizárólag a panel `Preview feed rows` checkboxán él. A `FeedExportDialog` `audiences`/`topics` propjai is visszakerültek (csak a beágyazott tábla miatt voltak ott). Commit `1e6bd5b`, build 40.0s, box `6.61.1`, health `/` 307 · `/login` 200 · `/matrix` 307 · `/feeds` 307. Élőben ellenőrizve: a dialógus a „Diff details"-szel zárul.

**6.62.0 (user, 2026-09-05) — a fold szabály rossz volt, nem a hangolása.** Két bejelentés ugyanarról: „az Almaid Céljaid miért megy az Otherbe, van neki MC332-je" és „ez az audience miért megy Otherbe, DCO szerint tök egyértelműek a témák". Ok: a cap **oszloponként** ment, nem szülőnként — így egy **látható** node teljes részfája elveszíthette az oszlop-szintű rangsort más szülők gyerekeivel szemben, és eltűnt egy közös `Other`-ben. A levélszinten ez a legrosszabb: minden MC `count = 1`, tehát ábécé döntött, és az `MC332` azért esett ki, mert az `MC330`/`MC331` után rendeződik — nem azért, mert kicsi.

Új szabály: **szülőnkénti top-8**. Egy látható node mindig a saját legnagyobb gyerekeit mutatja, és csak a saját túlcsordulása kerül a saját `Other`-ébe. `Other (1)` sosem renderelődik (egy sort kér és semmit nem mond), a gyökéroszlop pedig sosem hajtogat (nincs fölötte szülő, ami fogantyú lehetne). **Drill-down:** a túlcsorduló szülő a Tree chevronját kapja, kattintásra (vagy a saját `Other`-jére kattintva — ugyanaz a toggle) mind megjelenik; perzisztál a `mm6_sankey_expanded_v1`-ben. Commit `9d2…`, box `6.62.0`.

**Amit a mérés mutat, és ami nyitva marad:** ebben a szűrésben (SZK + ACTIVE) **681 üzenet, 90 audience, 446 külön (audience, topic) pár** van. Ezt egy képernyőn nem lehet olvashatóan megmutatni — a szülőnkénti fold ráadásul szintenként szorzódik, ezért a cap szándékosan kicsi (8), és a `fitView` 0.35-nél megáll (az alatt a pillek olvashatatlanok), tehát a magas ábra **pásztázható, nem összepréselt**. A nyitókép így is sűrű. Ha ez zavar, a következő lépés a Tree mintája: **alapból csak az első 1–2 szint nyitva**, a mélyebb oszlopok drill-downra jelennek meg — user dönt.

**6.63.0 (user, 2026-09-05) — a gyoker-hiba: a sankey utvonalakat rajzolt entitasok helyett.** User: „a topic oszlopban meg az MC oszlopban nem kene duplikalni az entitasokat annyiszor, ahany audience van — ez lenne a sankey lenyege nem?" Igaza volt. A `buildTree` a node-okat a **teljes osszel-lanccal** kulcsolja, mert egy faban minden node-nak egy szuloje van; a sankey viszont **DAG**: egy topic egy node, tobb befuto szalaggal. A fa-azonossag ujrahasznositasa minden topicot es minden kartyat lemasolt audience-enkent — pont az ellenkezoje annak, amire az abra valo, es egyben ez okozta az olvashatatlansagot is. Merve az elo szurest (SZK + ACTIVE): **topic 446 vs 27, MC 681 vs 54**.

A `buildSankey` mostantol maga jarja a szinteket es entitasra merge-el, de a sor-osszeallitast (`messageRows`) es a szintenkenti csoportositast (`groupValue`) megosztja a Tree-vel, hogy a ket nezet tovabbra se tudjon mast mondani a strukturarol. Egy tobb audience-ben szereplo kartya **egy** level, ami tobb uzenetet nyom. A fold visszament oszloponkentire (cap 120) — DAG-ban ez vegre oszinte: az `Other` orokli a tagjai sajat linkjeit, tehat egy behajtogatott audience folyama tovabbra is a valodi topicokba erkezik; nincs sehova nem vezeto node, es nem kell szurke lancot huzni a jobb szelig. 809 teszt zold, box `6.63.0`.

**6.64.0 (user, 2026-09-06) — metrika-sulyozas + feed preview a vaszonra.**

*Push-back es a valasz:* megmertem a `monitoring` tablat, mielott barmit terveztem. Augusztusban a **cost 13%-a**, az **impressions 35%-a** kotheto uzenethez, a **120 konverziobol 9**. Ezt elmondtam, a user igy is kerte a kapcsolot („mutassa ha nulla, es ki fogjuk deriteni hogy a report jobb legyen es legyen adat") — tehat megepult, **de minden delivery-mod kiirja a sajat lefedettseget** (70% alatt amber). Fontos arnyalat a `dashboard-monitoring.ts`-bol: product-szurovel a lefedettseg sokkal jobb (SZK-n 85%), es a matrix mindig szurve van — a 13% a szuretlen szam.

*Amit epitettunk:* `Weight by` doboz a jobb toolbarban (MC / Impr. / Cost) + riport-idoszak valaszto; uj `GET /api/monitoring/message-metrics` + `lib/sankey-metrics.ts`. **Csapda, amit kikerultunk:** a dashboard query eldobja az `impressions = 0` sorokat (1x1 click trackerek, a CTR miatt helyesen), de a cost 62%-a azokon ul — ez a lekerdezes ezert NEM dobja el oket. Konverzio a node-tooltipen, **nullanal is kiirva** (az ures sor „nincs adat"-ot jelentene, nem „nem konvertalt"-at). Ha semmi nem szallitott, explicit empty state jon, nem nullakbol allo layout.

*Feed preview:* a tabla kikerult a dialogusbol es **atveszi a matrix vasznat** — dialoguson belul egy sor nem tudja megnyitni az MC-t egy masodik dialogus-layer nelkul, tehat a sorok holtak voltak. A kapcsolo mostantol **pipas gomb** a `preview-pane__skip-anim` mintajara. Elohen ellenorizve: sor-klikk → MC editor nyilik; Cost modban a tooltip „292 309 Ft · 27 messages · 2 conversions". 813 teszt zold, box `6.64.0`.

*Nyitva a userenel:* a konverzio-import javitasa (120-bol 9 matchel) — ha ez import-hiba es nem valosag, az a kovetkezo lepes.

**6.64.1 (user, 2026-09-06) — a sankey kirakasokat nevezett uzenetnek.** Ket egymas utani user-eszrevetel ugyanarrol: „a 24 messages az nem 24 uzenet hanem 24 instance nem?" es „itt meg a 72 messages az 72 instance of 3 mc nem?". **Mindketto igaz** — es az elso valaszomban tevesen allitottam, hogy nem-level node-on a szo helyes. Elo DB-vel ellenorizve: `MC398a` = 24 sor / 24 audience / 1 topic; `Ne maradj le 26Q2` = **72 sor / 3 kartya (MC314a,b,c) / 24 audience**.

A `messages` tabla egy sora **kirakas (placement)**, nem uzenet: egy 24 audience-be kitett kartya 24 sor. A sorszam tehat MINDEN szinten kirakas-szam. A tooltip mostantol mindkettot megnevezi — nem-levelen `3 MCs · 72 placements · 24 audiences`, levelen (ahol a node MAGA a kartya) `24 placements · 24 audiences · 1 topic`. Az MC-modu suly **marad a sorszam** (egy kartya-node-nak annyit kell nyomnia, amennyit a befuto szalag hoz, kulonben a flow nem jon ki), de a pill hover-title-je es a `Weight by` hint kimondja: `placements`. `SankeyNodeDatum.messageCount` → `placementCount`, plusz uj `cardCount` / `audienceCount` / `topicCount`. 815 teszt zold, box `6.64.1`.

⚠️ **Nem ellenorizve vizualisan:** a 6.64.1 deploy utani utolso screenshot elmaradt (a bongeszoablak 0 szelessegu volt). A logikat unit teszt es DB-lekerdezes fedi, a health 307/200, de a tooltip uj szovege elohen meg nincs szemmel latva.

**6.65.0 (user, 2026-09-06) — statusz-szin az MC oszlopon + egy elesben elo, tagabb hiba.**

*A user ket dolgot kert:* legyen statusz-fuggo az MC oszlop szine, es a statusz-legordoloben latszodjon a tobbi statusz szine is (setting alapjan). A masodikat **nem tudtam volna kitalalni** — eloben megmertem a DOM-ot, mielott barmit irtam volna:

⚠️ **GYOKER-OK, es nem csak a legordulore igaz: az appban MINDEN statusz-pott atlatszo volt az ACTIVE kivetelevel.** A `.status-dot--*` es `.status-badge--*` szabalyok `@layer components`-ben ultek, az osztalynevek viszont futasidoben allnak ossze (`status-dot--${statusSlug(s)}`), tehat a Tailwind scanner sosem latja oket jeloltkent es **kipurgalja a szabalyt**. Az `ACTIVE` **veletlenul** maradt eletben: a `ClientsTab.tsx:79` kiirja szo szerint. Erintett volt a statusz-szuro opcioi, a matrix chipek, a feed sor-csik es a sankey tooltip is. Mert bizonyitek: `getComputedStyle(dot).backgroundColor === "rgba(0, 0, 0, 0)"` mindenhol az ACTIVE-on kivul.

*Javitas:* a szabalyok **unlayered**-ek lettek — a fajl sajat, mar meglevo gyogyszere erre (a platform-el blokk is igy all, „Unlayered ON PURPOSE"). Igy nem tunhetnek el ujra, ahogy a literalok jonnek-mennek. Ellenorizve deploy utan: mind az ot pott a **kliens mentett szinet** kapja (APPROVED = `rgb(15,138,97)` = az erste `#0f8a61`, nem a `#10b981` default).

*MC oszlop szine:* levelen a statusz nyer, a tobbi oszlopon marad a platform/melyseg kodolas (hogy a Tree-vel egyutt olvasson). **Kevert kartyanal nem valasztunk „dominans" szint** — egy 13/11 megoszlast zoldre festeni hazugsag lenne —, hanem aranyos `linear-gradient` kemeny stopokkal. Eloben: 100 statusz-szinezett level, 98 egyszinu, **2 gradiens**, es az aranyok pontosak (`MC134a` 29 kirakas → 68,97% ACTIVE / 31,03% INACTIVE; `MC94b` 9 → 44,44% / 55,56%). 815 teszt zold, box `6.65.0`.

**Amit szándékosan NEM csináltunk:** nincs `sankeyStructure` config (a `treeStructure` hajtja mindkét nézetet), nincs cost-dimenzió a matrix-sankey-ben (az a monitoring oldalra való — `tasks/cost-sankey-szakertes.md`), nincs v5 canvas-renderer portolás.

---

## 🟡 NEXT — green-light után, alacsony blokk

### MCP token-scope #3: `draft` — mindent olvas, csak draftot ír (USER KÉRÉS, 2026-09-06)
A workflow-agent ma vagy `read` (semmit nem tud létrehozni), vagy `full` (a teljes mátrixot írhatja). A munkamódszer viszont pont a közepét kívánja: az agent **lásson mindent** (mátrix, kreatívok, riport, sablonok — hogy tudjon dönteni), de **csak a draft-térbe írhasson**, ahol a hibája nem ér el élő kártyát.

- [ ] `mcp_tokens.scope` harmadik értéke: `read | draft | full` (a check/validáció a `mcp-tokens` route-ban és a Settings › MCP fülön).
- [ ] A `buildMcpServer` regisztrációs feltétele: `draft` = minden read tool + **a draft-írók** (`generate_test_creative`, `draft_archive`, `brief_attach`, és a draftra korlátozott `mc_update`?) — a `draft_promote` **NEM**, mert az cellát ad, azaz kilép a draft-térből. ⚠️ OPEN Q: a promote tényleg kimarad-e, vagy a scope „draft + promote" legyen.
- [ ] A ma `full`-höz kötött, draftra is ható tool-oknál a scope nem elég: a **sor** is draft kell legyen (`status='DRAFT'` ⟺ `audience IS NULL`) — a guard az entity-ben, nem a tool-listában, különben egy új tool kifelejtődik.
- [ ] Tesztek: `draft`-scope-os token nem tud `mc_create`-et / `draft_promote`-ot / dimenzió-írást; ugyanaz a token minden read toolt lát; a `full` és a `read` viselkedése változatlan (regresszió).
- [ ] `McpTab.tsx` prózája — a tool-lista magától szinkronizál a `mcp.ts`-ből, a **szöveges** szekciók kézzel írtak (l. `feedback_mcp_settings_page_sync`).

Miért ez a helyes gránulátum: a draft már ma is egy `messages` sor `audience IS NULL`-lal, tehát a „mit írhat" kérdésre **létező invariáns** válaszol — nem kell új jogosultsági fogalom, csak a meglévőt kell a token-scope-hoz kötni.


### M1 — Matrix "Color by" (Strategy | Platform | Both)
Cél: audience-oszlopok színezése strategy/platform szerint, legenddel.
- [ ] **M1.1** `Color by: None|Strategy|Platform|Both` dropdown a `MatrixToolbar`-ba; persist `mm6_matrix_color_by`.
- [ ] **M1.2** Determinisztikus value→color map a látható audience-ök distinct `strategy`/`buyingPlatform` értékeiből (sorted distinct → paletta-index). Szín-token reuse (ne hardcode `bg-*`; STATUS_COLOR mintája = `status-dot--*` CSS-var class).
- [ ] **M1.3** Szín **band az audience oszlop-fejlécen** (nem a cellán); `Both` = két vékony sáv; kis legend. ⚠️ OPEN Q: `Both` vizuál + header-only.

### M4 — Crosshair highlight (sor+oszlop) hover + click-pin
- [x] **M4.1 (✅ KÉSZ, 6.24.0, 2026-08-25)** Él-rail crosshair, NEM state-alapú. Imperatív (`GridView.paintCrosshair` + delegált `onMouseOver`/`onMouseLeave` a `<table>`-ön, ref) → hoverkor nincs grid-újrarajzolás. `data-col-key`/`data-row-key` a 2 header-`<th>`-re + mindkét cella-`<td>`-re; a `c`+`c-1` oszlop `border-right`-ja és a `r`+`r-1` sor `border-bottom`-ja kap `--mx-cross` színt (`matrix-grid__x--edge-r`/`--edge-b`, unlayered CSS). Csak meglévő border SZÍNE vált → **0 layout-shift**, `transition: border-color 140ms` → nem villódzik. Edit módban is megy (border-color ≠ ring box-shadow). Header-hover = csak az az oszlop/sor. Korlát: legszélső bal oszlop / legfelső sor külső élét a sticky header adja (nincs `c-1`/`r-1`).
- [ ] **M4.2** Click-to-pin: kattintásra pinnel escape/újraklikkig; a chip-open klikket nem nyeli el. ⚠️ OPEN Q: pin+hover mindkettő.

### M5 — Detail-view audience header: strategy tag + lineitem_id
- [ ] **M5.1** `MessageEditor` header (`:499-625`): `strategy` pill + `lineitemId` (ha van) az MC-label mellé; a ma Naming-tabon rejtett infó (`audienceRows` `:946,:950`) felhozva; status-badge stílus reuse.

### M6 — Detail-view: teljes key helyett product + tag pillék
- [ ] **M6.1** `NamingTab` disabled full-key inputjai (`:914-931`) helyett dekompozíció a betöltött rekordból (nincs key-parser). Topic: `product`+`tag1..4` (üres elhagyva). Audience: `product`+`strategy`+`buyingPlatform`+`device`+`tag`. ⚠️ OPEN Q: audience-mezőkészlet.

### M7 — Custom-CSS beszúró chipek az MC-editorban
- [ ] **M7.1** Két chip-sor a `customCss` textarea alá (`:1725-1731`); beszúrás cursor-pozícióba (ref + selectionStart/End splice).
- [ ] **M7.2** Méret-chipek: `TemplateInfo.sizes[]` (`:688-693`) → `.size-<W>x<H>`.
- [ ] **M7.3** Elem-ID chipek: parse-olt `id="..."` → `#<id>`.
- [ ] **M7.4** Plumbing: `elementIds: string[]` a `TemplateInfo`-ba `index.html` parse-olásával a `listVisibleTemplates`-ben (`lib/templates.ts`), a `sizes[]`-szel azonos cache-úton. (Ma nincs API-n kivezetve.)

### M8 — Creative Library size filter csoportosított dropdown
- [ ] **M8.1** `MultiPill` bővítése opcionális `groups` proppal (statikus kategória→méret map: Display / Social / Other; ismeretlen → Other). (Ma `MultiPill` flat only.)
- [ ] **M8.2** Csoport-fejléc tri-state checkbox (all/none/some); egyedi checkboxok maradnak; üres csoport rejtve. Persist `mm6_creative_library_filter_sizes` marad.

### Wave 2 maradék — guided picker + auto-match + bulk
Cél: a creative↔cella match a nyers mezőkön túl guided + tömeges legyen.
- [ ] **W2.2** `CreativeDetailDialog`: audience+topic dropdown, ami az MC number/variant pickert az adott metszet létező üzeneteire szűri (ma nyers DraftField `:182-186`).
- [ ] **W2.3** `POST /api/creatives` filenév-heurisztika `mc(\d+)([a-z])` → "Suggested match — confirm" (nem csendes commit).
- [ ] **W2.4** Toolbar "Bulk match by filename": regex a `mcNumber IS NULL` uploaded-ökre → confirm-table → batch `PATCH`; `FeedExportDialog` diff-stats mintát reusál. ⚠️ OPEN Q: W2.5 soft-link marad.

### Wave 3 maradék — cell-badge + unmatched-link + legacy-retire
- [ ] **W3.g** Matrix cella stat-badge: linkelt monitoring-sorral rendelkező MC-cellán kis impr/CTR badge (`GridView.tsx`); adat-wiring a lényeg, styling follow-up.
- [ ] **W3.h** Unmatched sor → message manuális link `MonitoringTable`-ben (ma csak match-filter `:369`, nincs kézi hozzárendelés).
- [x] **W3.i Monitoring: több periódus együtt (tartomány-választó) — GREEN-LIGHT (2026-09-01).** User: „van 4-5 hónap adatunk, tök jó lenne tetszőleges ezen belüli periódusból elemezni". Ma a `/api/monitoring` **pontosan egy** periódust ad (`route.ts:35` `eq(periodFrom, selected)`), a UI egy `<select>`-tel vált (`MonitoringTable.tsx:344`).
  - **Felmért tények (prod DB, 2026-09-01):** 4 periódus, **15 646** nyers sor, de csak **6 227** különböző message-kulcs → a négy hónap EGYÜTT 6 227 sorra aggregálódik, azaz **nagyjából akkora nézet, mint ma az augusztus egyedül (5 733)**. Nincs se skálázási, se compute-probléma. **2 623 kulcs (42 %) mind a 4 periódusban futott** — ez az a populáció, amiért az egész funkció van. Különböző MC: **267** → a per-MC/per-periódus trend-payload legfeljebb ~1 068 sor.
  - **A grain MA hónap — a választó ezért hónap-lista, NEM naptár.** A `monitoring`-ban nincs nap-oszlop, tehát „jún 15 – júl 20" ma nem kiszolgálható, és egy dátumválasztó olyan pontosságot ígérne, ami mögött nincs adat. ⚠️ **Korrekció:** ez a `monitoring` tábla és a parser korlátja, **nem a forrásfájlé** — a nyers riportban ott a nap, lásd **W3.j**. Ha a W3.j leszállít, ez a választó bővíthető nap-felbontásra ugyanezzel a szerver-oldali aggregációval.
  - **Aggregációs kulcs:** `(platform, audience_key, topic_key, mc_number, mc_variant, size)`. A `product` / `message_id` / `match_level` bemehet a GROUP BY-ba: **ma 0 olyan kulcs van, ahol ezek periódusok között eltérnének** (mérve). Ha egyszer eltérnének, az két sorként *látszik* — jobb, mint egy `max()`-szal némán feloldani.
  - **CTR mindig összegzett klikk/impresszióból újraszámolva**, soha nem periódus-CTR-ek átlaga.
  - [x] **W3.i-1** `/api/monitoring`: `?from=&to=` **összefüggő szelet** a periódus-listából (mindkettő inkluzív, a lista-sorrend szerint). Alap változatlanul a legfrissebb egy periódus — a mai viselkedés nem változik magától. A periódus-lista rendezése `periodDateKey`-re (`route.ts:24` ma a nyers `DD/MM/YYYY` szövegen `desc`-el → évfordulón megfordul).
  - [x] **W3.i-2** Új `mcTrend` a payloadban: `(mc_number, mc_variant, period_from)` → impressions/clicks, a kiválasztott szeletre. ~1 068 sor a teljes tartományra.
  - [x] **W3.i-3** `MonitoringTable`: a `<select>` helyére **két** select (`from` – `to`), alapból mindkettő a legfrissebb periódus. A `to < from` eset a UI-ban kizárva. A tábla többi része (méret-összecsukás, MultiPill-ek, match-szűrő, rendezés) változatlan — a szerver ugyanabban a méret-grainben adja a sorokat, mint ma.
  - [x] **W3.i-4** `MonitoringDetailDialog`: a mai (audience × méret) bontás mellé **periódus-bontás** (impr / klikk / CTR periódusonként) — egy MC havi lefutása. Ez a funkció tényleges haszna.
  - [x] **W3.i-5** Teszt: több periódus összegzése egy kulcsra, CTR újraszámolás (nem átlag), tartomány-határok inkluzivitása, évfordulós periódus-sorrend, `mcTrend` alak, kliens-izoláció.
  - **Verzió a slice végén:** `6.47.0` → `6.48.0` (minor — új API-paraméter + UI).
  - **Az átfedés-guard nyitva marad:** az import-replace a pontos `(from, to)` párra megy (`import/route.ts:108`), tehát egy havi és egy heti fájl ugyanarra az időszakra ma **egymás mellett élne és mindkettő számolna**. Rövidebb periódusok bevezetése előtt kell egy guard, ami átfedő tartományt visszautasít.
- [~] **W3.j Nap-grain ingest — ⚠️ KORREKCIÓ egy korábbi állításhoz (2026-09-01).** Azt írtam a usernek, hogy a forrás XLSX-ben nincs nap-dimenzió és ezért az AdForm report buildert kellene átállítani. **Ez téves volt.** A `docs/Creative rep_05_2026.xlsx` fejléce: `Date | Campaign | Line Item | Banner Ad Message | Banner/Adgroups | … | Rendered Impressions` — **a nap ott van minden sorban** (`01/05/2026`), és mindig is ott volt. A `parseAdformReport` egyszerűen **eldobja**: a `Date` oszlopot nem is olvassa ki, mindent a periódus egészére aggregál (`adform-report.ts:333` — a `col()` hívások között nincs `Date`).
  - **Mérve, a valódi parser-helperekkel (`extractPmmidToken` / `parsePmmid` / `extractSize` / `normalizePlatform`), tehát nem becslés:**

    | fájl | nyers sor | periódus-grain | **nap-grain** | szorzó |
    |---|---|---|---|---|
    | `Creative rep_04_2026.xlsx` | 85 222 | 3 244 | **73 488** | ×22,7 |
    | `Creative rep_05_2026.xlsx` | 83 905 | **3 002** | **67 749** | ×22,6 |

    A május periódus-grain 3 002 **pontosan egyezik** a DB-ben tárolt májusi sorszámmal → a mérési módszer hiteles.
  - **Következmény:** napi felbontás **nem igényel semmilyen változtatást abban, ahogy a riportot lehúzod**. Nem kell új AdForm-riport, nem lesz nagyobb a fájl (ma is 5,5 MB / 84 e sor, és ma is elparse-oljuk). Ami kell: `day` oszlop a `monitoring`-ra + az unique index bővítése + a parser olvassa a `Date`-et + újraimport azokra a periódusokra, amiknek **megvan még a forrásfájlja** (a `docs/`-ban április + május; a `source_filename` tárolt, a bájtok nem).
  - **Költség:** ~68–73 e sor/hónap a mai ~3 e helyett → ~0,8–0,9 M sor/év. Postgresnek indexszel semmi; az insert oldalt a 6.46.0 chunkolása már bírja (68 e sor × 20 bind-param ≫ 65 534, de a chunkolás pont ezt kezeli).
  - **Miért NEM volt szabad ezt a W3.i előtt megcsinálni:** a `/api/monitoring` a kiválasztott tartomány sorait küldi a böngészőnek. Nap-grainnél egyetlen hónap ~68 e sor JSON lenne. A **W3.i szerver-oldali aggregációja pontosan ez az előfeltétel** — nap-grain táblából is 3 e sort ad vissza egy hónapra. A sorrend tehát helyes volt, csak az indoklásom volt rossz.
  - **A user megerősítette (2026-09-01): a június / július / augusztus riportfájl is megvan** → a nap-grain **visszamenőleg teljes**, nem lesz kevert grainű tábla. Ez volt az egyetlen nyitott kockázat.
  - **Slice-határ:** ez a szelet CSAK azt csinálja, hogy a nap bekerül a táblába úgy, hogy **egyetlen mai fogyasztó se változzon**. A tényleges nap-felbontású tartomány-lekérdezés (`?from=2026-06-15&to=2026-07-20`, „last 30 days") külön szelet — **W3.k** —, mert az UI-t és a dashboard-csempéket is érinti.
  - **Miért nem törik el semmi közben:** minden mai fogyasztó **periódusra** csoportosít (`monthlyDelivery` a `period_from`-ra, a `/api/monitoring` a szeletre), és egy periódus napjait összegezve pontosan a mai számot kapja vissza. A payload-méret sem nő: a route továbbra is a message-kulcsra aggregál, nem napokra.
  - [x] **W3.j-1** Séma: `monitoring.day` — `text("day").notNull().default("")`, **ISO `YYYY-MM-DD`**. Nem a nyers `DD/MM/YYYY`: a nap épp azért kerül be, hogy rendezni és tartományozni lehessen rajta, és a `periodDateKey` már ma is DD/MM/YYYY↔ISO-t normalizál. Az üres string = „nincs napi bontás", pontosan a `size` meglévő konvenciója szerint (`schema.ts:642`) — így az unique index NULL-mentes marad. Migráció `0010`.
  - [x] **W3.j-2** `monitoring_client_period_key_idx` bővítése `day`-jel + új `monitoring_client_day_idx` a `(client_id, day)`-re.
  - [x] **W3.j-3** `parseAdformReport`: a `Date` oszlop kiolvasása (ma nincs is `col("Date")`), ISO-ra normalizálva, és bevétele az aggregációs kulcsba. **Ha nincs `Date` oszlop → `day = ""`**, tehát egy régi alakú riport ugyanúgy importál, mint ma.
  - [x] **W3.j-4** Import-route: `day` átvezetése. A replace továbbra is a `(client, period_from, period_to)` hármasra megy, tehát egy periódus újratöltése **egészben** vált periódus-grainről nap-grainre — félig átállt periódus nem létezhet. A sorszám ~3 e-ről ~68 e-re nő importonként (21 chunk a mai 3 276-os chunk-mérettel) — **az import futásidejét meg kell mérni**, nem feltételezni.
  - [x] **W3.j-5** Teszt: valódi alakú riport (Date oszloppal) naponként aggregál; `Date` nélküli riport `day=""`-vel importál (regresszió); ugyanaz a periódus újratöltése nem hagy vegyes grainű maradékot; a `monthlyDelivery` és a `/api/monitoring` **változatlan számokat** ad nap-grain tábla fölött (ez a szelet lényege).
  - [ ] **W3.j-6** Újraimport a 4 (5) meglévő riportfájlból a Monitoring oldal feltöltőjén át — nem script. **Migráció + kód egy passzban a boxon** (`migrate` + `pm2 restart`), ahogy a `mcp_tokens` szeletnél is.
  - **Verzió a slice végén:** `6.48.0` → `6.49.0` (minor — új oszlop + index + migráció).
- [ ] **Legacy `reporting` retire (LAST):** a 2 lingering olvasó (`mcp.ts:350` monitoring_status→adformStatus, `:977` matrix_status→syncedAt) átkötése `monitoring`-ra → tábla drop-migráció → import/export-xlsx + snapshot refek takarítása.
- Deferred: **Meta parser/resolver** — blokkolva valós Meta export sample-ig.

### MCP agent-trap fixek (2026-07-22, ✅ kész)
Kiváltó: egy agent nem tudott júniusi MC-rangsort csinálni. Két gyökér-ok, javítva `mcp.ts`-ben:
- [x] **Fix 1 — ISO `from` a riport-toolokban:** a `monitoring.period_from` `"DD/MM/YYYY 00:00:00"` szövegként tárolt; az agent ISO `"2026-06-01"`-et küld → exact `eq()` néma üres. Új közös `resolvePeriodFrom`/`periodDateKey` helper dátum-normalizál (DD/MM/YYYY ↔ ISO). `report_performance` + `get_mc_reporting` fogad ISO `from`-ot; ismeretlen `from` → hiba az elérhető period-listával (nem néma []). Teszt: mindkét tool-nál bare-ISO + unknown-from eset.
- [x] **Fix 2 — halott `monitoring_status` szűrő eltávolítva `list_mc`-ből:** az üres `reporting.adform_status`-t kérdezte → mindig []; a `monitoring`-ban nincs status oszlop, nem repointolható. Param + kód + description-mention törölve. (A `reporting` import + `matrix_status` olvasó marad — nagy legacy-retire, `:88`.)
- Verifikáció: `tsc --noEmit` clean, teljes integration suite 265/265 zöld (eldobható docker PG-n futtatva).

---

## 💡 Ötlet-inbox (2026-08-30, user) — döntések lezárva, terv jóváhagyásra vár

Négy ötlet érkezett; a user 2026-08-30-án mindháromra megadta az irányt (a negyedik, **D1**, döntés nélkül indítható és a 🟢 NOW-ban van). Alább: a **lezárt döntés**, a **felmért tények** (DB-ből és kódból, nem tippelve) és a **lépéslista**. Sorrend **lezárva (user, 2026-08-30): D1 + I3 megy elsőként** (a két kicsi, migráció nélkül), utána I1, végül I2.

### I3 — Tree view: színezés **platform** szerint (✅ KÉSZ, 6.31.0, 2026-08-30)
**User-döntés:** platform szerint színezzen, „mert az a kisebb egység — pl. dv360 és adform is programmatic", és a mátrix audience-headerben már a platformot színezzük. → **A csatorna-szín (YT/SOC/DISP) NEM ez a feladat**, és a Design-tab kivezetés egyelőre lekerül (lásd lent a tényt).
**Felmért tények:**
- A platform-szín ma **`audienceEdgeClasses`** (`GridView.tsx:33-51`): két hardcode-olt ág (`dv360` / `adform`) → CSS-osztályok (`globals.css:397-407`, `#43970b` és `#03c9ab`). A strategy a **vastagságot** kódolja (pro 3px / rem 5px), a platform a **színt**. Fontos részlet: **csak akkor színez, ha strategy ÉS platform is be van állítva** (különben `null`).
- **DB (2026-08-30): összesen két platform-érték létezik** — `adform` 105, `dv360` 68, `null` 7 audience. **YouTube / meta / egyéb platform-érték ma NINCS.** (A `monitoring` táblában van 16 „platform", de az riport-forrás — publisher-nevekkel, pl. telex/hvgonline —, más fogalom, nem az `audiences.buyingPlatform`.)
- A `buyingPlatform` **szabad szöveges** mező (autocomplete, `DimensionGrid/columns.ts:32`), nem enum → új platform = adat-kérdés, nem kód-kérdés, HA a színforrás map + fallback.
- A tree-node ma **mélység szerint** színez (`tree-view__node-wrap--lvl-0..5`, `TreeView.tsx:41,240`). A `buildTree` minden node-on gyűjti az átmenő message-id-ket (`AggNode.rows`), és a `parseTreeStructure` a `buyingPlatform`-ot már ismeri csoportosító mezőként (`:28-29`) → a node-onkénti platform kiszámítható, nincs szükség a fa átstrukturálására.
- **⇒ A Settings-kivezetés ma megalapozatlan** (két érték, mindkettőnek van színe). Default: **kódban rögzített map + fallback szín az ismeretlen platformra**; a `channels.color` oszlop + ChannelsTab-swatch csak akkor, ha tényleg lesz több csatorna-szín igény. Ha a user mégis most akarja a szerkeszthetőséget, az külön slice (új oszlop + migráció).
- [x] **I3.1** `PLATFORM_COLOR` map egy helyre (`matrix/types.ts`, a `STATUS_COLOR` mellé — az a bevált precedens), + `PLATFORM_COLOR_FALLBACK`. Az `audienceEdgeClasses` erre kötve: **viselkedés-változás nélkül** (ugyanaz a két osztály áll elő). Ismeretlen platform → fallback-osztály a mai `null` helyett? ⚠️ **NEM**: a mátrix-header maradjon változatlan ebben a slice-ban, a fallback csak a tree-é.
- [x] **I3.2** `buildTree`: `AggNode`-ra `platforms: Set<string>`, a `TreeNode`-ra `platform?: string` (pontosan egy distinct érték esetén) + `platformMixed?: true` (több esetén). A `rows` gyűjtésével azonos helyen (`buildTree.ts:118`), a row audience-éből.
- [x] **I3.3** `TreeView`: a node-osztály a platform-színt kapja a `--lvl-N` helyett, ha van egyértelmű platform; `mixed` → semleges (mai lvl-szín); nincs platform (pl. topic-ág) → mai lvl-szín. A `LEVEL_COLOR_CYCLE` marad fallbacknek.
- [x] **I3.4** `component-inventory` frissítve. **Legend NEM készült, szándékosan:** az appban ma sehol nincs legend-komponens (a mátrix audience-header is legend nélkül színez a platformmal), így a tree-hez építeni új mintát találna ki egy olyan kódoláshoz, ami máshol is magyarázat nélkül él. Külön kérésre, és akkor mindkét helyre egyszerre.
- ✅ **LEZÁRVA (user, 2026-08-30):** a tree **csak színt** kap; a strategy vastagság-kódolása NEM jön át (a tree-node keretvastagsága ma más célt szolgál).

### I5 — Feed-részletek a 500-as limit miatt (IGÉNY RÖGZÍTVE, 2026-08-31 — user: „ezzel majd később")
**Modell-javítás (user):** a „productonként egy live feed" **hibás kérés volt** — egy termékhez több élő feed tartozhat. **Az SZK mai esete a PLATFORM szerinti kettősség**, amit a 6.34.0 már megold (`feed_exports.platform`, `findLiveExport(product, platform)`, platformonkénti verzió-vonal és Live sor). **Máskor viszont a `MAX_ROWS_PER_FEED = 500` is szétvághat egy terméket két részletre** — ez a rész elhalasztva.
- **User-döntés, ami már megvan:** a részletek **két önálló feed** (nem egy feed két fele) → külön verzió-vonal, külön élő sor, külön diff — pontosan az a forma, amit a platform-oszlop csinál. Egy jövőbeli limit-alapú vágásnak ugyanígy **saját megkülönböztetőt** kell kapnia, nem az uniót kell diffelnie.
- **Nyitva:** mi a megkülönböztető a limit-alapú vágásnál (a vágás helye önmagában nem jelent semmit), és ki dönti el a vágást (automatikus limit szerint vs kézi MC-besorolás, ami megmarad a következő exportra). A user mindkettőt későbbre tette.
- **Tény a döntéshez:** `MAX_ROWS_PER_FEED = 500` (`feed-export.ts:32`), és az SZK exportok korábban **443 / 644 / 681** sorosak voltak — tehát a limit valós kényszer, nem elméleti.

### I6 — Diff-alap választó + „a feedből semmi nem tűnik el" szabály (TERV KÉSZ, ÉPÍTÉS ZÖLD-LIGHTRA VÁR)
**User-szabály, egy mondatban:** a feedből soha semmi nem tűnik el — ami kikerül a válogatásból, vagy amelynek az azonosítói megváltoztak, az bent marad `IsActive=FALSE`-szal, a pótlása hozzáfűződik; **törölni csak explicit „force new version" esetén** szabad.
**User-döntések (2026-08-31):** (1) diff-alapnak **bármelyik korábbi, termékre stimmelő feed** választható, default a **legfrissebb** (mindegy, referencia vagy export); (2) force nélkül a diff **ne mutasson sor-törlést** — azt mondja, hogy „az új feedben az alaphoz képest nincs benne x sor", és ezek a régiben INACTIVE-ra állnak; force esetén ezek törlődnének; (3) ha pmmid/advert_id változik: a korábbi sor INACTIVE lesz, és a frissült azonosítójú sor **újként hozzáadódik**.

**⚠️ LELET — ma a szűrő FELÜLÍRJA a sticky-supersetet.** `feed-export.ts:416`: `if (allowed && !allowed.has(m.id)) continue;` — a `messageIds` szűrő a carry-forward unió **ELŐTT** fut, tehát a mátrix-szűrőn kívül eső sor akkor is kiesik a feedből, ha benne van az élő exportban. Vagyis a user által tiltott törlés **ma megtörténik**, épp amikor szakaszonként szűrve exportál. Ez a szabály fő sérülési pontja, és egyben a javítás helye.

**Szeletek:**
- [x] **I6.1 Carry-forward a szűrő felett:** a `liveIdSet`-beli sorok ne essenek ki az `allowed` szűrőn; ha nincsenek a mai válogatásban, a soruk `IsActive=FALSE`-szal megy ki (az `isActiveCol` felülírás mintájára, ami ma az archivált sorokra megy, `:452`). ⚠️ **Feed-kimenetet változtat** — a négy lockolt invariáns egyike (sticky-superset), tesztekkel és külön ellenőrzéssel.
- [x] **I6.2 Diff-szöveg:** force nélkül ne „removed" legyen, hanem „x sor nincs benne az új feedben → INACTIVE lesz"; force-szal „x sor törlődik". A `diffRowSets` számol tovább, csak a bemutatás és a `decideVersion` indoklása változik.
- [x] **I6.3 Alap-választó:** a dialogban select a termék (és platform) korábbi feedjeiből, default a legfrissebb; a választott id a POST bodyba, a szerver ahhoz diffel (ma automatikus: legfrissebb referencia → utolsó export).
- [x] **I6.4 (A NEHÉZ RÉSZ) kulcsmező-változás:** ha egy MC pmmid/advert_id-je változott, a régi sornak nincs többé mögötte üzenet — tehát azt **az alap payloadjából** kell kihozni, INACTIVE-ra állítva. Ez új fogalom: „szellemsor", aminek nincs message-e. Érinti a `messageIds` párhuzamos tömböt és a DEFAULT-sor indexét. **Ezt külön szeletként, saját teszttel.**
- [x] **I6.5** Tesztek mind a négyre + CHANGELOG + bump.

**Miért nem kezdtem bele:** ez a `buildFeedRowSet` kimenetét módosítja, ami a **négy lockolt feed-invariáns** területe (sticky-superset, verzió-bump triggerek, uploaded≠exported, DEFAULT-sor transzformáció). Nem akartam egy hosszú session végén, más kiadással összekeverve hozzányúlni.

### I4 — Drive-linkek a kreatívokon (TERV KÉSZ, 2026-09-03 — ÉPÍTÉS ZÖLD-LIGHTRA VÁR)
**User-döntés (2026-09-03), ez váltja a korábbi „igény rögzítve, három nyitott kapu" állapotot:** minden feltöltött kreatívhoz **két** Drive-hivatkozás tartozik — (1) **parent folder link: a fontosabb, a user tölti ki, editálható**, feltöltéskor batch-szinten egyszer bepasztézva; (2) **direkt file link: számított, NEM editálható** — a mappa listázásából, fájlnév-egyezéssel áll elő. Megjelenítés: share-oldal fejlécében a benne szereplő kreatívok mappalinkjei, és minden kép/videó nézetben a szülőmappa. Újraellenőrzés/pótlás: **Creative Library side-toolbar „Drive link health check"**.

**Felmérés (2026-08-31 + 2026-09-03, ellenőrzött tények):**
- ⚠️ **Az `/api/drive/proxy/` NEM Google Drive.** v5-ös örökség: a `template.json` `path-messagingmatrix` útvonala, MinIO-ból szolgál ki bájtokat (`src/app/api/drive/proxy/[filename]/route.ts`). A projektben ma **nulla Drive-integráció** van, és nincs `googleapis` dep.
- **`creatives.file_id` NEM Drive-ID**, hanem az `uploaded_files.id` (nanoid). Prod: 3145 kreatív, mind 1:1 egy `uploaded_files` sorra (+349 asset ugyanabban a táblában).
- **A user gépén a Drive-mount rclone** (`gdrive:` remote, macfuse). Az `rclone lsjson` **valódi Drive ID-t ad** mappára és fájlra (ellenőrizve: `Data/ERSTE HU/MARKET/*` → `1dyAf70…`). Ez a backfill motorja — nulla OAuth.
- **A Leadás-mappák publikusak (anyone with the link):** auth nélküli `GET https://drive.google.com/drive/folders/1idXHYJYnXRNEW6jmhZ7RW8XCzT269xbe` → **200**, a mappanév a válaszban, nincs sign-in redirect. ⇒ (a) a share-oldal linkjei külsősnek is nyílnak, (b) a szerver **puszta API-kulccsal** listázhat, OAuth nélkül.
- **A share-oldal snapshotból renderel** (`share_galleries.metadata` JSON, `SnapshotCreative`), nem élő `creatives` sorból → a Drive-mezőket a snapshotba is bele kell tenni, különben a fejléc üres marad.
- **A szerver a folder linkből NEM tud fájl-linket számolni hívás nélkül** — a Drive ID opak, nincs névkonvenció. Kell egy listázó hívás; a kérdés csak az, hogy milyen hitelesítéssel (lásd I4.2).

**Ami ezzel MEGHAL:** a régi „számított útvonal" opció (bizonyítottan lehetetlen), a „teljes OAuth + token-tárolás a boxon" opció (nem kell, a mappák publikusak), és a **Wave 5 (Share → Drive export)** — a linkelés kiváltja a másolást. **FR-B Documents külön marad:** más kardinalitás (MC-nként több Slides doksi, státusszal).

**MÉRÉS (2026-09-03, kulccsal, ÉLES) — a Path A NYERT, a hitelesítés kérdése lezárva:**
- `GET drive/v3/files?q='1idXHYJYnXRNEW6jmhZ7RW8XCzT269xbe' in parents&key=…` → **HTTP 200, 42 fájl**, valódi ID-kkel (`1CqV_cyzunx…`) — az MC312-es Leadás-szett. Nincs OAuth, nincs dep, egy env-var: `GOOGLE_DRIVE_API_KEY` (GCP `grafia-2026` / „messagingMatrix" kulcs, Drive API-ra szűkítve, app-restriction None). **A boxra is ki kell vinni deploykor.**
- `files/<folderId>?fields=id,name` → `"Leadas 04 13"` ⇒ a `drive_folder_name` ingyen jön.
- Auth nélküli `GET drive.google.com/file/d/<fileId>/view` → **200** ⇒ a share-oldal file-linkjei külsősnek is nyílnak.
- A 42 Drive-fájlnév ellen a prod DB-ben **42 `creatives` sor** áll (`file_name LIKE 'ERSTE_MARKET_MC312_%…'`) ⇒ a fájlnév-join tartja magát.
- ⚠️ **A kulcs CSAK az anyone-with-link mappákat látja.** `Data/ERSTE HU/MARKET` és a `Future befektetés - GenZ` kampánymappa: `files.get` → **404**, a gyerek-listázás → **0 elem** (nem hiba!). A `Leadas 04 13` (amit leadáskor megosztasz) → **200**. ⇒ (a) gyökérből rekurzívan bejárni NEM lehet, (b) a „0 gyerek" nem azonos a „nincs találat"-tal — a resolvernek `files.get`-tel kell külön mérnie, hogy a mappa elérhető-e, különben egy megosztási hibát „fájl nem található"-ként jelentene.
- **A backfill mérete (prod, 600 legfrissebb kreatív):** 2026-06-12 → 08-13, **43 MC-szám, 5 termék** (SZA 210 / HK 125 / SZK 103 / MARKET 102 / VAL 60) ⇒ nagyságrendileg **20–40 Leadás-mappa link** fedi le az egészet.
- ⚠️ **A `parents` mezőt a kulcsos (anonim) hívás NEM adja vissza** — fájl-ID-ből tehát szerveroldalon nem lehet szülőmappát visszakeresni. A folder→file irány megy, a file→folder nem. Ezért a backfill **mappalinkek listájából** indul (I4.7), nem fájlokból; a lokális rclone csak arra kell, ha egy mappa nincs anyone-with-link megosztva.

**Szeletek:**
- [x] **I4.1 Séma + ID-parser (KÉSZ, 2026-09-03).** Migráció `0011_demonic_chameleon.sql` (négy additív nullable oszlop, a megosztott Hetzner DB-n **lefuttatva** — a régi kód sértetlen, a drizzle `select()` a saját sémájából állítja a kolumnalistát). `src/lib/drive-link.ts` + `tests/unit/drive-link.test.ts` (7 teszt, valódi Leadás-ID-kkel). ⚠️ **A `drizzle-kit` nem olvassa a `.env.local`-t** — `db:migrate` elé kell `export $(grep '^DATABASE_URL=' .env.local)`, különben a `:55432`-es eldobható teszt-DB-re menne. Teljes suite: 713 teszt zöld, `tsc` tiszta. Migráció: `creatives.drive_folder_id`, `drive_folder_name`, `drive_file_id`, `drive_checked_at` (mind nullable). **ID-t tárolunk, nem URL-t** — a bepasztézott link sokféle (`?usp=sharing`, `/u/0/`, `/drive/folders/`, `/file/d/`), nyers stringgel a share-fejléc mappa-csoportosítása elromlik. Új `src/lib/drive-link.ts`: `parseDriveFolderId(input)` / `folderUrl(id)` / `fileUrl(id)`, unit-tesztekkel. Státusz nem külön oszlop: `folder && !file && checked_at` = „nem talált".
- [x] **I4.2 Listázó lib (KÉSZ, 2026-09-03).** `src/lib/drive.ts`: `getDriveFolder` (404 → `null`, ez a „nincs anyone-with-link megosztás" jelzés) + `listDriveFolder` (`nextPageToken`-lapozás, `pageSize=1000`), tipizált `DriveError` konfig- és HTTP-hibára. Kulcs: `GOOGLE_DRIVE_API_KEY` (`.env.local`-ban, `.env.example`-be placeholderként felvéve — **a boxra is ki kell vinni deploykor**). 7 unit teszt stubolt `fetch`-csel (lapozás, 404, hiba, hiányzó kulcs) + **élő ellenőrzés a valódi API-n**: `Leadas 04 13` → 42 fájl, a MARKET-gyökér → `null`.
- [x] **I4.3 Resolver (KÉSZ, 2026-09-03).** `src/lib/drive-resolve.ts` → `resolveDriveFilesForCreatives(clientId, ids)`; hat kimenet: `resolved` / `unchanged` / `no_folder` / `folder_unreachable` / `file_not_found` / `ambiguous`. Mappánként **egy** listázás futásonként (`createFolderCache`), pontos `file_name`-egyezés, több találatnál nem tippel. Almappát sosem matchel (a kliens minden kreatívja png/jpg/mp4/mov — egy HTML5-bundle más link-alakot kívánna). Írás: **csak a `drive_*` oszlopok**, `version`/`updated_at` nem mozdul (az a user-szerkesztésé, és az editor optimista zárja ellen dolgozna); két bulk `UPDATE … FROM (VALUES …)` a soronkénti kör helyett, mert a health check százas nagyságrendben fut a tunnelen át. 9 integrációs teszt (köztük: elérhetetlen mappa ≠ hiányzó fájl, kliens-izoláció, mappa-cache).
- [x] **I4.4 Feltöltő út (KÉSZ, 2026-09-03).** `POST /api/creatives` + `PATCH /api/creatives/[id]` átveszi a `driveFolderUrl`-t: a `pickWritable` **parse-olja** (csak azon az úton kerülhet be ID a DB-be), rossz link → **400** (`CreativeError` + új `validationError` hook a `makeItemRoute`-on, a `makeCollectionRoute` mintájára). `updateCreative`: ha a mappa **változik vagy törlődik**, a származtatott `drive_file_id`/`drive_folder_name`/`drive_checked_at` nullázódik — máskülönben a file-link egy olyan mappára mutatna, amit a kreatív már nem vall magáénak. UI: az `UploadQueue` új `batchForm` render-propja (a `renderForm` mintájára) a queue fejlécében egy **batch-szintű** `DriveFolderBatchField`-et ad — egyszer pasztézod, minden sorra megy (a később bedobott fájlokra is), kliensoldali link-validációval; az egyfájlos `CreativeMetadataForm` saját mezőt kapott. **Eltérés a tervtől:** soronkénti felülírás nem a queue-rácsban van (5 apró oszlop, egy URL nem fér el), hanem a kreatív-detailben (I4.5). 9 integrációs teszt.
- [x] **I4.5 Kreatív-nézetek (KÉSZ, 2026-09-03).** `CreativeDetailDialog`: editálható „Drive parent folder link" mező a meglévő draft/autosave úton (a `diffPayload` **ID-t hasonlít, nem szöveget** — ugyanaz a mappa `?usp=sharing`-gel nem edit, és nem dobja el a feloldott file-linket), alatta `DriveLinks`: mappa-link (a mappa nevével) + **read-only** direkt file-link, vagy a hiány oka. A `StripCreative` és a virtuális „matrix" tile-ok is megkapták a mezőket (utóbbi mindig null — élőben renderelt, nincs mit Drive-on mutatni).
- [x] **I4.6 „Drive link health check" (KÉSZ, 2026-09-03).** Új `POST /api/creatives/drive-resolve` (id-lista a body-ban, **max 200/kérés** — a kliens chunkol 100-asával; a route sosem lapoz növekvő táblát maga). `DriveHealthCheck` a `RightToolbar`-ban az `ArchiveToggle` collapsed/kinyitott mintájára, a **szűrt** halmazra fut, riport: feloldva / változatlan / mappa nem elérhető / fájl nincs a mappában / kétértelmű név / nincs mappa. Drive-hiba → **502** (`drive_unavailable`), audit **futásonként egy sor** (a meglévő `bulk_update` akción, `kind: "drive_resolve"` payloaddal — nem született új audit-fogalom). 4 route-teszt.
- [x] **I4.7 Backfill mappalinkekből (KÉSZ, 2026-09-03).** `linkCreativesFromFolders(clientId, folderIds, {apply, overwrite})` a resolver mellett, **közös mappa-cache-sel és közös illesztéssel** — nincs második implementáció. Kimenetek: `linked` / `unchanged` / `conflict` (más mappát vall — nem írjuk felül `--overwrite` nélkül) / `ambiguous_creative` / `no_creative`, az elérhetetlen mappák külön listán. `scripts/drive-backfill.ts`: linkek argumentumként vagy `--file`-ból, **dry-run az alapértelmezés**, `--apply` ír, `--overwrite` repointol. **Élő próba (dry run, prod DB):** a `Leadas 04 13` mappára **42/42 kreatív talált**, 0 conflict, 0 gazdátlan fájl. 7 további integrációs teszt.
- [x] **I4.8 Share-oldal (KÉSZ, 2026-09-03).** A snapshot **magától** viszi az új oszlopokat (a `share-galleries` route teljes `creatives` sorokat ment) — csak a `SnapshotCreative` típus + a megjelenítés kellett: `share-gallery__drive` sor a fejlécben a **distinct** mappákkal (mappanévvel), és `share-detail-dialog__drive` link egy-egy kreatív nézegetésekor. A snapshot fagyaszt: amit a share készítésekor még nem oldottunk fel, az a régi share-en nem jelenik meg — tudatos.
- [x] **I4.9 Tesztek + zárás (KÉSZ, 2026-09-03).** Suite **749/749 zöld** (83 fájl; 713 → +36 új: link-parser alakok, `listDriveFolder` lapozás + 404 + hiányzó kulcs, resolver 16 eset, entity/route 13 eset), `tsc` tiszta. `tasks/component-inventory.md` (Creative Library + Share fejléc szekció) és `CHANGELOG.md` frissítve. **Verzió: `6.52.0` → `6.53.0`** (minor).

- [x] **I4.10 MCP — nincs új tool, csak látható mezők (KÉSZ, 2026-09-03).** A `list_creatives` minden sora kap `drive_folder_url` + `drive_file_url`-t (kész link, nem ID), a `list_mc` minden sora `drive_folders`-t (az MC-hez tartozó kreatívok distinct mappái — **egy** csoportosított lekérdezés a lapra, nem N+1). A `creative_update` írhatja a `fields.driveFolderUrl`-t (fájl-link elutasítva, `""` töröl), a hibás link most tipizált MCP-hibaüzenet, nem kivétel. A három tool leírása kimondja, mit jelent a hiányzó mappa és a feloldatlan fájl.

### I1 — Dashboard: hasznos **napi** áttekintő (DÖNTÉS LEZÁRVA)
**User-döntés:** „ha már van, hasznos áttekintőt szeretnék belőle faragni, **per nap**." → a dashboard **nap-scope-os digest**, nem szabad-szűrős analitika-oldal. Ez egyben megválaszolja a top-toolbar kérdést: a szűrő = **nap-választó** (Ma / Tegnap / utolsó 7 nap), nem generikus filter-sáv.
**Felmért tények (2026-08-30, prod DB):**
- **Az activity-log nem listázható nyersen:** ma **904** audit-sor van (tegnap 1754, 2026-08-17-én **5085**) — a mai 15-soros nyers lista (`page.tsx:37-43,105-125`) ebből semmit nem mutat. **A „legyen okosabb" valódi tartalma: aggregálás** (ki / mit / hány darabot), nem szebb sorok.
- A humanizálás két fele **már roadmap-item**: `FR-D D.1` (`actor_kind` ui|mcp oszlop → ember-vs-agent badge) és `D.2` (users-join a nyers `userId` helyett). **Az I1 ezeket előrehozza, nem duplikálja.**
- **A `reporting` tábla ÜRES (0 sor)** → a chartok forrása **kizárólag a `monitoring`** (6366 sor: impressions/clicks/cost/conversions, `period_from/to`, `imported_at`, `platform`, `mc_number`).
- **A monitoring-adat elavult:** a lefedett időszak **2026. május** (`01/05`–`31/05`), az utolsó import **2026-07-16**. ⇒ **A user által kért „report dátum" widget a legértékesebb az egész oldalon** (hangosan kiírja, hogy 6 hete nincs friss adat), a **chartok viszont ma 3 hónapos adatot rajzolnának** — ezért a chart-slice a monitoring-ingest újraindulásáig alacsony hozamú.
- **`feed_exports`:** 23 sor, oszlopok `exported_at` / `uploaded_to_adform_at` (nincs `created_at`). A legutóbbi három (SZA v2 ma, SZA v1 tegnap) **`uploaded_to_adform_at = NULL`** → az „exportálva, de nincs feltöltve" a legkonkrétabb napi jelzés, és pontosan a lockolt feed-invariánst (uploaded ≠ exported) teszi láthatóvá.
- **Kreatívok:** az 1080×1080 → 300×250 **arány-eltérés** (1:1 vs 1.2:1) → nem transzformáció, hanem illesztés. **Default: a 250×250 doboz** (arányhelyes), `object-contain`-nel, a Creative Library tile mintájára.
- Ma nincs chart-lib a projektben (új függőség = külön döntés).
- [ ] **I1.1 Nap-scope + fejléc:** `?d=YYYY-MM-DD` (default: ma) + Ma / Tegnap / 7 nap kapcsoló. A meglévő toolbar-pill stílust használja, nem új chrome. A page marad server component, a scope URL-ben (nincs kliens-state).
- [ ] **I1.2 Activity-digest (a nyers lista helyett):** aznapi `audit_log` **aggregálva** — `entityType` × `action` × aktor, darabszámmal, a top-N kibontható. Ide jön be `FR-D D.2` (users-join → email/név) — **`D.1` (`actor_kind`) séma-migráció, ezért külön slice** (lásd I1.6).
- [ ] **I1.3 Friss kreatívok — horizontális album (user-pontosítás, 2026-08-30):** aznap létrehozott `creatives` vízszintes csíkban. **Normalizálás MAGASSÁGRA, nem fix dobozra:** a 300×250 megy **eredeti méretben**, az 1080×1080 **250×250-re** kicsinyítve → minden tile **250px magas**, a szélesség változó. (Ez feloldja az arány-problémát: nem vágunk és nem letterboxolunk, csak azonos magasságra hozunk.) Vezérlés: **léptető gombok** + **mobil swipe** balra/jobbra, az elején **rugalmas visszapattanás**, a végén **infinite scroll** (lapozva tölt tovább). A Creative Library tile-t újrahasználva, ne szülessen új tile-komponens.
  - ⚠️ Tisztázandó a slice indulásakor: az „aznapi" halmaz mennyi tile-t jelent (ma 0–56/nap a `creatives` szerint) — ha egy napra kevés, az album scope-ja legyen-e inkább „legutóbbi N" a nap-scope helyett? Az infinite scroll csak akkor keres értelmet, ha van mit tölteni.
- [ ] **I1.4 Feed-exportok:** aznapi `feed_exports` (product, verzió, `exported_at`) + **„exportálva, nincs feltöltve" figyelmeztetés**, ha `uploaded_to_adform_at IS NULL`.
- [ ] **I1.5 Riport-frissesség tile:** `monitoring` `max(imported_at)` + a lefedett `period_from..period_to` + „N napja nincs friss import" jelzés. **Ez az egyetlen widget, ami MA is hasznos adatot mutat** — előre veendő.
- [ ] **I1.6 (külön slice, migrációval) `actor_kind`:** `FR-D D.1` — `ui|mcp` oszlop az `audit_log`-ra + beállítás a két writer-site-on + ember/agent badge a digestben. **Migráció + kód egy passzban a boxon.** Ugyanez az oszlop-fogalom kell az I2-höz → **egyszer szülessen meg.**
- [x] **I1.7 Chartok — GREEN-LIGHT (2026-09-01).** A halasztás oka megszűnt: a július + augusztus import tegnap leszállt, így **4 havi periódus** van (máj 8,3 M → jún 12,1 M → júl 15,5 M → aug 20,1 M impression), és havonta nő. **User-döntés:** a felső sor két redundáns csempéje (Activity, Feeds exported — mindkettő ugyanazt mondja, mint az alatta lévő panel) helyére **delivery-trend** + **matrix-lefedettség** megy; a Reporting data csempe marad harmadiknak.
  - **Lezárt döntések:**
    - **Havi grain, nem napi.** A két chart **nem** reagál a `?d`/`?r` nap-scope-ra (a `monitoring` havi periódusokat tárol — Today-en üres lenne). Saját címkét viselnek („2026. aug", „utolsó 6 hónap"); a nap-scope továbbra is csak a lenti paneleket vezérli. Ezt ki kell írni a csempére, nem elhallgatni.
    - **Nincs chart-lib.** 6 oszlop + egy ratio-bar inline SVG-ben megvan; a `page.tsx` marad server component (recharts = új dep + `"use client"` az egész felső sorra).
    - **`impressions > 0` szűrő kötelező:** a `size='1x1'` click-tracker sorok augusztusban 0 impression mellett **445 e klikket és 17,9 M Ft költséget** hoznak — beszámítva a CTR értelmetlen, a cost duplázódik.
    - **Rendezés parse-olt dátumkulcs szerint, NEM a `period_from` sztringen.** A tárolt alak `DD/MM/YYYY`, tehát `"01/12/2025" > "01/05/2026"` lexikailag → évfordulón megfordulna a trend. (A `/api/monitoring/route.ts:24` `orderBy(desc(periodFrom))`-ja ma csak azért jó, mert minden adat 2026-os.)
    - **Mit mutat a lefedettség:** a riportolt impressionsből mennyi köthető mátrix-MC-hez — aug **35 %**, júl 46 %, jún 78 %. A romlást a nem-matchelt publisher-sorok (telex, hvg, centralmedia…) növekvő volumene okozza; a csempe a Settings → Structure → Monitoring keyword→product szabályaira mutat.
  - [x] **I1.7a** `src/lib/dashboard-monitoring.ts` — `monthlyDelivery(clientId, n = 6)`: periódusonként impressions / clicks / cost / `matchedImpressions` (`message_id IS NOT NULL`), egy `GROUP BY`, ≤ 6 sor. A `dashboard-creatives.ts` + `dashboard-products.ts` mintáját követi.
  - [x] **I1.7b** `periodDateKey` (ma `mcp.ts:258`, privát) kiemelése `src/lib/period.ts`-be, az mcp.ts call-site-ok átkötve. Külön, izolált lépés — a rendezés ezen áll.
  - [x] **I1.7c** `_dashboard/DeliveryTrend.tsx` — `delivery-trend` csempe: havi oszlopdiagram impressionsből, nagy szám = utolsó hónap + MoM-delta (`20,1 M · +29 %`). A `signal-tile` layout-nyelvét (label / value / hint) követi, nem új csempe-família.
  - [x] **I1.7d** `_dashboard/CoverageTile.tsx` — `coverage-tile`: matched/total ratio-bar + havi mini-trend, link a `/monitoring`-ra.
  - [x] **I1.7e** A két régi `SignalTile` (Activity, Feeds exported) törlése a `dashboard__signals` sorból (`page.tsx:295-317`); a `FreshnessTile` marad.
  - [x] **I1.7f** Teszt a `monthlyDelivery`-re: 1x1-kizárás, **évfordulós rendezés** (2025-12 + 2026-01 fixture — a sztring-rendezéssel elbukna), kliens-izoláció.
  - [x] **I1.7g** `tasks/component-inventory.md` Dashboard szekció: `delivery-trend`, `coverage-tile` felvétele.
  - **Verzió a slice végén:** `6.46.0` → `6.47.0` (minor — új dashboard-widgetek + új lib-modul).
- [x] **I1.8 Activity panel product-szűrés (user, 2026-09-01):** „az activity pane is legyen időszakasz és product filtered (it seems to be only time filtered)". **Igaz:** az `activityDigest` (`page.tsx:84`) csak `clientId` + `createdAt` BETWEEN — a `products` tömböt meg sem kapja, míg a `feedsInScope` (`:123`) és a `listStripCreatives` (`dashboard-creatives.ts:145,154`) már szűr rá.
  - **Az audit_log-ban nincs product oszlop** (`schema.ts:106` — `entity_type` + `entity_id` + `action`), tehát a productot entitásonként fel kell oldani. 7 napra mérve (5679 sor): feloldható `messages` 5370 (94,6 %), `topics` 126, `feed_exports` 55, `assets` 30, `creatives` 5, `audiences` 4 → **97,3 %**. Nem oldható fel: `text_formatting` 33, `keywords` 25, `uploaded_files` 23, `share_galleries` 5, `monitoring` 2, `config` 1 — ezeknek nincs product-dimenziójuk, aktív szűrő mellett kiesnek. Ez helyes viselkedés (egy globális `config`-írás nem „SZK-aktivitás"), de ki kell mondani.
  - **A nonDCO cellák product-feloldása:** a `messages` sorok 13 %-a (688 cella: `ch_disp` 357 + `ch_soc` 331) **nonDCO**, azaz a `messages.audience`-ben egy csatorna-kulcs áll. A csatornák a **`channels` táblában** élnek (a 2026-08-17-i szétválasztás óta, `schema.ts:207`), nem az `audiences`-ben, és **nincs product oszlopuk** — ezeknél egyedül a topic-kulcs prefixe nevezi meg a productot (SZA 200, SZK 179, HITEL 139, HK 62, VAL 59, MARKET 55, LTP 18). Az I1.8 ezért `coalesce(audiences.product, split_part(topic,'_',1))` szerint old fel.
  - **⚠️ Külön ügy, NEM ebben a slice-ban:** a `dashboard-products.ts:58` nonDCO-ága a *régi* alakra van írva (`audiences.channel != null`), amit a channels-szétválasztás óta semmi nem elégít ki → a fölötte lévő `if (!a) continue;` elejti a 688 nonDCO cellát, tehát a ProductFilter nonDCO-számlálói 0-k. (Ezt a 6.45.1 „mind-nulla szegmens elrejtése" fixe *helyesen* takarja el a UI-ban; a számláló viszont attól még nem számol.) Átállítása a `channels` táblára külön döntés.
  - **Nem JS-ben szűrünk:** a nyers sorok lekérése 5679 (rossz napon 5085 egyetlen napra) → a row-cap szabályba ütközne, és a `:79` komment épp ezt tiltja. Marad az egy darab `GROUP BY` query, a product-feltétel egy `EXISTS` + `UNION ALL` feloldó-táblával a hat feloldható entitástípusra.
  - **Ismert korlát:** törölt entitás sora (7 nap: `feed_exports` delete 28, `topics` 3, `messages` 3) nem oldható fel join-nal — a sor már nincs meg, csak a `before` JSON-ban. Aktív szűrő mellett kiesnek; a `before` parse-olása szándékosan kimarad.
  - **A Shares panel is csak idő-szűrt** — ott viszont nincs mire szűrni: a `share_galleries`-nek nincs product oszlopa, egy galéria vegyes tartalmú. Változatlanul hagyva, nem az I1.8 tárgya.
  - [x] **I1.8a** `activityDigest(clientId, scope, products)` — `EXISTS` + `UNION ALL` product-feloldás (messages/topics/feed_exports/creatives/assets/audiences), üres `products`-nál változatlan a mai query.
  - [x] **I1.8b** Teszt: ch_* (audience nélküli) sor a topic-prefixére szűrve előjön; product nélküli entitástípus aktív szűrőnél kiesik; üres szűrő = mai viselkedés; kliens-izoláció.
- ⚠️ **Elvetve az első körből:** side toolbar view-kapcsolókkal — a nap-scope adja a nézetváltást, és 5-6 widgetnél a második toolbar üres chrome.

### I1.9–I1.11 — Dashboard: product-szűrés mindenütt, 30 napos scope, CTR-rendezés a kreatív-csíkon (user, 2026-09-02) ✅
**User:** „a library is legyen product filter érzékeny és a felső report sor is". Ma a `feedsInScope`, a `listStripCreatives` és (6.47.0 óta) az `activityDigest` szűr productra; a **`monthlyDelivery`** (Delivery + Matrix coverage csempe) és az **`entityCounts`** (Library · all time) nem kapja meg a `products` tömböt.
- **⚠️ A Matrix coverage jelentése megváltozik szűrt állapotban — mérve (2026. aug):**

  | product | impr | matched | % |
  |---|---|---|---|
  | *(nincs product)* | 10 942 699 | 0 | **0 %** |
  | SZK | 3 410 204 | 2 898 434 | 85 % |
  | HK | 2 190 585 | 2 190 585 | 100 % |
  | SZA | 1 595 581 | 1 181 107 | 74 % |
  | VAL | 1 320 319 | 763 252 | 58 % |
  | HITEL | 591 977 | 0 | 0 % |

  A szűretlen **35 %**-ot a product nélküli publisher-blokk húzza le, ami definíció szerint egyetlen product-szűrőnek sem felel meg → bármelyik productra szűrve a lefedettség 58–100 %-ra ugrik. **Ez helyes**: a product-szűrő a nevezőt is szűkíti, és a „mennyit magyaráz meg a mátrix az SZK forgalmából" önmagában érvényes kérdés. De a két szám **két különböző populációt** mér, és ezt tudni kell — a fejléc `Product N` pillje jelzi, hogy szűrt nézet van.
- **A hat Library-csempéből öt szűrhető:** `audiences` / `topics` / `assets` / `creatives` saját `product` oszlopból, a `messages` a `coalesce(audience.product, topic-prefix)` szabállyal (ugyanaz, mint az `activityDigest`-ben — a nonDCO cellák csatornán ülnek, a csatornának nincs productja). A **`text_formatting`-nak nincs product-dimenziója** (nincs ilyen oszlop) → a csempe **marad, de „all products" jelöléssel**; sem a 0 kiírása (a sorok léteznek), sem a szűrő néma figyelmen kívül hagyása nem volna őszinte.
- [x] **I1.9a** `monthlyDelivery(clientId, n, products)` — `inArray(monitoring.product, products)` üres tömbnél kihagyva.
- [x] **I1.9b** `entityCounts(clientId, products)` — táblánkénti product-predikátum; a `messages` a közös `messageProduct` kifejezéssel.
- [x] **I1.9c** A `coalesce(audience.product, topic-prefix)` kifejezés kiemelése egy helyre (`dashboard-products.ts`), és **mindkét** használat (`productScoped` + `entityCounts`) arra kötve — ez a szabály korrektségi szempontból kritikus, ne éljen két külön másolatban.
- [x] **I1.9d** `count-tile__note` a `text_formatting` csempére, csak aktív szűrőnél.
- [x] **I1.9e** Teszt: delivery product-szűrve; library-számlálók productonként; nonDCO cella a topic-prefixe szerint számolódik; `text_formatting` nem esik 0-ra; üres szűrő = mai számok.
- [x] **I1.10 „Last 30 days" a nap-scope gombok közé (user, 2026-09-02).** A `ScopeRange` `"day" | "7d" | "30d"`, a span egy `RANGE_SPAN` táblából jön (nem elszórt ternary-kből). Az üres állapot „szélesítő" linkje is egy fokkal feljebb lép: nap → 7 nap → 30 nap, tehát egy üres hét sem zsákutca többé.
- [x] **I1.11 Creative strip: „Open →" helyett rendezés-váltó (user, 2026-09-02).** `Time` / `CTR`, URL-ben `?cs=ctr`, a nap-scope és a product-szűrő megőrzi.
  - **A CTR mércéje:** MC-nként összegzett **matched** monitoring sorok (`message_id IS NOT NULL` — ugyanaz, amit a Monitoring tábla Matched szűrője ért alatta), **minden periódusra**, és csak a **100 000 impresszió** feletti MC-k (`CTR_MIN_IMPRESSIONS`). Enélkül a lista élére egy kétszer megjelenített, egyszer kattintott kreatív kerülne 50 %-kal.
  - **A CTR-rendezés ELDOBJA a nap-ablakot — mérve, ezért:** a 100 e felett minősülő **74 MC**-ből egy 7 napos ablak **9**-et tartalmaz, feltöltött kreatívot pedig **nullát**. Ablakkal a nézet üres lenne. A „legjobban teljesítő kreatív" amúgy is all-time kérdés, ahogy maga a ráta is periódusokra mért. A panel hintje ezt kiírja (`… · all time`), a `fallback` pedig CTR-rendezésnél soha nem igaz (nincs ablak, amiről visszaeshetne).
  - **A rendezés szűkít is:** matched riport nélküli vagy a küszöb alatti MC nem null-lal a lista végére kerül, hanem kiesik.
- **Verzió a slice végén:** `6.49.0` → `6.50.0` (minor).

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

## 🔵 LATER — push-back-first / blokkolt

**Séma-migráció szabály (memory):** új oszlop/tábla `db:generate` → `0004_*.sql` (jelenleg legmagasabb `0003_lovely_sumo.sql`), és a **migráció + kód-deploy egy passzban** megy a boxon (migrate + `pm2 restart mm6-erste`), soha nem lokál `db:migrate` önmagában.

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
- [ ] **FR-A Prodlist management** — agent-feldolgozott prodlist-sorok first-class rekordként; soronként MC vagy creative-hez köthető. Ref: `~/ERSTE Addressable AI Agent/outputs/prodlist_q3_2026`. Lépések: `prodlist_rows` tábla → `/api/prodlist/*` → MCP list/get/update/link/processed-mark → vékony lista-UI. ⚠️ OPEN Q lent.
- [ ] **FR-B Documents** — Google Slides link-tárház; agent követi melyik MC-nek van tracking-slide-ja + állapota. Lépések: `documents` tábla nullable soft-link a messages-hez → `/api/documents/*` → MCP list/get/add/update/link + "mely MC-knek nincs slide" query → vékony lista-UI.
- [ ] **FR-C Request-a-change** — ticket-inbox → auto-roadmap. **Default: legolcsóbb 80% = strukturált `todo.md` szekció** (ez a reorg adja az alapot), nem új tábla; `change_requests` tábla + státusz-pipeline csak valós multi-filer igényre.
- [ ] **FR-D Dashboard** (meglévő oldal, legkönnyebb push-back): **D.1** `actor_kind` (`ui|mcp`, opc. `token_id`) oszlop az `audit_log`-ba (`schema.ts:113` ma csak `userId`; `0004+` migráció) + beállítás a két writer-site-on (UI entity-route + `mcp.ts` ~30 call-site) + widget-badge. **D.2** users-join a raw `row.userId` helyett (`page.tsx:123` → email/név). **D.3** utolsó-90-nap `count()` predikátum az `entityCounts()`-ba (`page.tsx:18`) tile-onként.

### MCP SDK v2 migráció (`2026-07-28` spec)
- [ ] **NEM most.** Várunk a v2 stable-re (~2026-07-28), aztán branch-en. Migrációs checklist: archív § "MCP `2026-07-28` spec compatibility" (~L1450). A `show_mc_previews` widget (OpenAI Apps SDK) a valódi app-szintű munka.

### Parallel polish — Dark-mode component sweep (WP.1–8)
- [ ] Piecemeal, **soha nem search-and-replace**; egy klaszter egyszerre, vizuális verifikáció. Sorrend: sidebar → modals → grids → matrix chrome → forms → status pills → iframe chrome → QA. Alap (shadcn-tokenek) 2026-05-07-én landolt. Archív: § "Parallel polish" (~L2593) + punch list §10 (~L1585).

---

## 📌 Deferred / pinned (nincs változás)
- Phase 11 file-ingest pipeline (Forklift/Drive → `_inbox/` + MCP error-triage toolok, post-launch).
- Sankey alt-graph a Tree view-hoz (valós igényre).
- HTML creative auto-preview image link (use-case-ek scope-olása előbb).

---

## Nyitott döntések — AJÁNLOTT DEFAULTOK (user bólint / felülír)

1. **M1 `Both` vizuál** → *default:* két vékony egymásra-rakott sáv (strategy fent, platform lent) az oszlop-fejlécen, kis legenddel. Színezés **csak a fejlécen**, nem a cellákon.
2. **M4 pin + hover** → *default:* mindkettő — hover ideiglenes crosshair, kattintás pinnel escape/újraklikkig.
3. **M6 audience-dekompozíció** → *default:* topic = `product`+`tag1..4`; audience = `product`+`strategy`+`buyingPlatform`+`device`+`tag` (az audience-nek egy `tag`-je, nem tag1-4).
4. **W2.5 soft-link vs join-tábla** → *default:* marad a soft `(mcNumber, mcVariant)` link; join-tábla csak valós many-to-many workflow igényére.
5. **FR-A/B/C tábla vs view** → *default:* FR-C = strukturált `todo.md` szekció előbb (nincs új tábla); FR-A/B = új tábla nullable soft-linkkel a messages-hez + MCP write-tool — de csak a 3-kérdéses push-back után.
6. **M9 szomszédos gap** → *default:* audience/topic Archive-akció a `DimensionEditPanel`-be (restore route-ok élnek); külön kis commit (M9.3), nem M9.1 blokkolója.

---

## Session checkpointok (legutóbbi felül; régiek → archív)

### 2026-08-18 — Delete-dialog szövegjavítás (6.22.1)
- **User-kifogás:** a dialog „Remove 4 Messaging Cards" + 4× `MC290a` felirata azt sugallta, hogy magát a kártyát törli, pedig egy kijelölt cella = **egy audience-másolat**. A megkülönböztetés azért fontos, mert a kártya tartalma csak az UTOLSÓ másolat permanens törlésekor tűnik el.
- Javítás (`DeleteMcDialog.tsx` + `MatrixGrid.tsx`): a fejléc „Remove N audience copies", a lista **kártyánként csoportosít** ((number, variant, topic) = valódi audience-másolatok) „MC290a · 4 of 32 audience copies" formában, `LAST COPY` rose badge + piros figyelmeztető doboz ott, ahol a kijelölés az utolsó másolatot is tartalmazza. A darabszám a **teljes** üzenetlistából jön, nem a szűrt nézetből (szűrt másolat is életben tartja a kártyát).
- Backend változatlan; `tsc` tiszta. **DEPLOYOLVA 6.22.1** (2026-08-18): commit `d7c4c63`, box `b28b391`→`d7c4c63`, build OK, `pm2 restart mm6-erste` → Ready 1426ms. Health: `/` 307, `/login` 200, `/mcp` 401.

### 2026-08-17 — MC-átszámozás SQL-lel + M10 bulk delete (6.22.0)
- **MC renumber élesben (client 8).** A DCO html-kártyák a nonDCO eredetijük számát kapták meg (axis-scoped számozás, `entities/messages.ts:215-227`): `34800` MC838a → **MC290a**, `34801` MC838a → **MC321a**, `34802` MC838b → **MC321c**. Nincs app-szintű renumber (a `number`/`variant` nem writable a PATCH-en), ezért kézi SQL: `number`(+`variant`) mellett `pmmid` (`m_838`→`m_szám`, `-v_b-`→`-v_c-`), `utm_cd26`, `utm_term`, `final_trafficked_url`, `version+1`. Az `updateMessage` minden mentésen újraszámolja a trafficking mezőket, de a **pmmid-et soha** — azt kézzel kell vinni.
- Előtte ellenőrizve: cél-szám szabad a DCO tengelyen, 0 `creatives`/`monitoring`/`reporting`/`text_formatting`/preview hivatkozás, és egyik feed exportban sem szerepeltek.
- **Ismert csapda:** a `findSiblings` (`:448`) csak (number, variant)-re szűr, tengelyre nem → a global edit (`?propagate=siblings`) a nonDCO ikreket is testvérnek látja. A renumberelt kártyákon ne használd.
- **DEPLOYOLVA 6.22.0** (2026-08-18): commit `b28b391`, box `c71831c`→`b28b391`, `npm run build` OK, `pm2 restart mm6-erste` → Ready 1332ms. Séma-migráció nincs. Health: `/` 307, `/login` 200, `/mcp` 401, `POST /api/messages/bulk-delete` 401 auth nélkül (a route él, nem 404).
- **M10 leszállítva** (részletek fent): `archiveMessages`/`deleteMessages` + `POST /api/messages/bulk-delete` + `DeleteMcDialog` + a panel Delete gombja élesítve. 7 új integrációs teszt, teljes suite 573/573 zöld, `tsc --noEmit` tiszta. Böngészős click-through még nem volt.

### 2026-08-17 — 3 eltűnt SZK asset: root cause + restore (rebuild-creatives category-guard)
- **Tünet:** az Assets gridben három 08-16-án feltöltött SZK asset (id 1140–1142) szürke placeholderként jelent meg.
- **Root cause:** `scripts/rebuild-creatives.ts` 1. lépése (`drop this product's creatives + uploaded_files`) **csak fájlnév-prefix** alapján törölt (`filename like 'ERSTE_<PROD>_%'`), `category` szűrő nélkül. Az asset-library feltöltések ugyanezt a `ERSTE_<PROD>_MC…` névkonvenciót követik → a ma 11:06–11:12 UTC-kor futott SZK rebuild elvitte a három `category='asset'` sort is. Az `assets` sorokat a script nem törli, így azok életben maradtak egy halott `file_id`-vel → dangling hivatkozás → nincs mihez thumbnailt szolgálni.
- **Bizonyíték:** `audit_log` 3847–3852 (create-ek 08-16 07:51–07:53), `uploaded_files` category='asset' max created_at = 08-13 (a 08-16-osok eltűntek), SZK creative-ek mind 08-17 11:06–11:12. Törlésről nincs audit bejegyzés → nem app-útvonal volt.
- **Fix:** `eq(uploadedFiles.category, "creative")` a delete-be + magyarázó komment. Predikátum-ellenőrzés: régi 642 sor / új 639 sor → **pontosan a 3 asset kímélve**, minden SZK creative továbbra is törlődik.
- **Restore:** a bytok megvoltak MinIO-ban (a script nem hív `deleteStorageFile`-t). A három `uploaded_files` sor visszaírva az audit logból mentett eredeti `id`/`sha256`/`size`/`filename` + a MinIO key + az `assets` sorból a `dimensions` alapján; mindhárom objektum sha256-a **újraszámolva egyezik**. Dangling maradék: 2 db — a régi 2026-05-01-i `EBH_SELFIE_ONBOARDING_CSEMPÉK…` sorok, **más ok**, nyitott apróság.
- `tsc --noEmit` zöld. Élesen (boxon) a script frissítése kell a következő rebuild előtt; a DB közös, a restore már live.

### 2026-08-17 — DEPLOYOLVA 6.15.0 (edit-mode hint + MultiPill quick-select)
- Bump `6.14.0`→`6.15.0`, commit `d5489b8`, push, box deploy: `/var/www/mm6-erste` pull → build → `pm2 restart mm6-erste` (Ready 1623ms; séma-migráció nincs). Health: `/` 307, `/mcp` 401, `/login` 200.
- **User teendő (prod vizuális check):** (1) matrix jobb-toolbar Edit mode panel — a hint-sor a gomb fölött; (2) Status pill dropdown — "Select all / none"; (3) creative library Size pill — default/social/iab/none, `social`+`iab` stackel, ismételt kattintás leszedi.


- Kiindulás: user szerint nem lehet UI-ból audience/topic-ot felvenni. Valójában **lehet** — a `+` záró oszlop/sor csak **edit mode**-ban és csak **grid view**-ban látszik (`GridView.tsx:313,437` → `MatrixGrid.addHeader:534`, POST `/api/audiences|topics`, kulcs szerveroldali auto-gen: `config.patterns.audienceKey` vagy `aud{N+1}`). A felfedezhetőség volt a hiba, nem a funkció.
- **Fix 1:** `edit-mode-panel__hint` — egy szürke sor a title és a toggle között ("Add / duplicate topics and audiences; add, copy and move Messaging Cards.").
- **Fix 2:** `MultiPill` új opcionális `quickSelect` propja + `multi-pill__bulk` / `__bulk-link` osztályok. Status pillek (MatrixToolbar + DimensionGrid) → megosztott `STATUS_QUICK_SELECT` ("Select all / none"). Creative library Size pill → lokális `SIZE_QUICK_SELECT` (default/social/iab/none). Preset-szemantika: nevesített preset **togglel** (mind bent → kiveszi, különben hozzáadja), így `social`+`iab` stackelhető; `none` = all↔none flip; az `options`-ben nem létező méretekre hivatkozó preset link elrejtve.
- Nincs séma-migráció, nincs új route. `tsc --noEmit` zöld. (`npm run lint` a repo-ban interaktív ESLint-setup promptra fut — deprecated `next lint`, külön ügy.)
- **Nyitott apróság:** a collapsed jobb-toolbar ceruza-ikonja (`MatrixGrid.tsx:815`) csak `title="Enter edit mode"`-ot visel, a hint oda nem került be.

### 2026-08-16 — DEPLOYOLVA 6.14.0 (text-formatting exact-match)
- Bump `6.13.1`→`6.14.0`, commit `465ff9c`, push, box deploy: `/var/www/mm6-erste` pull → build → `pm2 restart mm6-erste` (Ready 1534ms; séma-migráció nincs). Health: `/` 307, `/mcp` 401, boxon a `465ff9c` + 6.14.0 verifikálva.
- User teendő (prod smoke): MC301b preview 300x250 — a Copy 1 törés nélkül, egyben ("Most Személyi Kölcsön adósság-rendezéshez"); egy pontos-egyezéses rule-os MC-n (pl. ahol a copy tényleg "Most Személyi Kölcsön") a `<br>`-ek továbbra is élnek.

### 2026-08-15 — Text-formatting exact-match fix (render.ts)
- MC301b-nyomozás: a 176-os rule ("Most Személyi Kölcsön" → `<br>`-ek) substringként belelógott a hosszabb copyba, miközben az editor nem mutatta (az csak teljes mező-egyezésnél listáz). Fix: a rule-alkalmazás a `render.ts`-ben placeholder-feloldáskor, `textOriginal === érték` teljes egyezéssel + scope-match; size-scoped > universal (feed-spans precedencia-tükör); a teljes-HTML substring-pass törölve. Prod DB hatásfelmérés: 122 aktív rule-ból 0 támaszkodott szándékosan substringre. Tesztek: 3 átírva + 2 új, 556/556 zöld. Részletek: NOW § "Text-formatting rule: exact-match".

### 2026-08-14 — Global edit: status + flight-dátumok szám-szintű propagálása
- Bug-bejelentés "status mindig local" → éles audit-logból verifikálva: az azonos (szám,variáns) audience-propagálás MŰKÖDÖTT (MC124/126 same-second sibling-auditok); a valódi rés: a global edit nem lépett át variánsok között, a user pedig a MC331 a/b/c-t kézzel állítgatta. User-döntés: **status + startDate/endDate szám-szintű** (a szám ÖSSZES variánsának összes élő sora), creative-mezők maradnak variáns-szintűek.
- Implementáció: `messages.ts` `PROPAGATED_FIELDS` → `CARD_FIELDS` + `NUMBER_LEVEL_FIELDS` két tier; `propagateToSiblings` a teljes szám-családot kérdezi, same-variant sor kap creative+number payloadot (trafficking-recompute-tal), other-variant sor csak status/dátumot (trafficking szándékosan érintetlen). Editor tooltipek frissítve. Teszt: +3 eset (`propagate-siblings.test.ts`), 554/554 zöld.

### 2026-08-14 — Audience-fejléc strategy/platform él (GridView + globals.css)
- Audience fejléceken bottom-border: vastagság = stratégia (`pro` 3px / `rem` 5px), szín = platform (`dv360` zöld #43970b / `adform` teal #03c9ab). Élő adatból verifikált értékkészlet; mindkét mező kell (a 13 channel-audience érintetlen). Mindkét orientációban (audience sor- és oszlop-fejléc). A 4 osztály a globals.css végén rétegen kívül ül, hogy a border utility-ket felülírja. Az M1 "Color by" ennek a felülete lehet később — ez a mindig-bekapcsolt v0.

### 2026-08-14 — Inactive audience/topic fejléc-jelölés a mátrixban (GridView.tsx)
- INACTIVE státuszú audience/topic oszlop- és sor-fejléc szövege halványszürke, dense függőleges labelre is; háttér/viselkedés változatlan. Új inventory-tokenek: `matrix-grid__{col,row}-header-label--inactive`. Follow-up user-kérésre: új **`--text-disabled`** design-token (light `#cccccc` / dark `#4d4d4d`, tailwind `text-text-disabled`) — a tertiary túl sötét volt. (Az M2 "Hide inactive" checkbox továbbra is nyitott, ez csak a vizuális jelölés.)

### 2026-08-14 — MC-editor autosave ön-konfliktus javítva (MessageEditor.tsx)
- Tünet: lassú gépelésnél (style / képnév mező) autosave közben "Someone else saved changes…" — a szerkesztő saját magával ütközött. Gyökér-ok, két úton: **(A)** nincs in-flight guard → 400 ms-nál hosszabb PATCH-körbeérésnél két átfedő mentés ugyanazzal az `If-Match`-csel → a második 409; pont a style/képnév mezők lassítják a PATCH-et (render-POST minden draft-változásra + karakterenkénti `/api/drive/proxy` GET-ek foglalják a kapcsolat-sort). **(B)** a saját SSE-visszhang refetch-e régebbi verziójú sort hozhat vissza a frissebb cache fölé → a Phase-B szigorú `!==` konfliktusnak látta.
- Fix (csak MessageEditor.tsx, nincs API/séma változás): mentések sorosítása (`saveInFlightRef` + `onMutate/onSettled`, a debounce-timer in-flight alatt nem mutál, settle után a friss snapshot ellen újraütemez; `manualSave` dupla-klikk guard); Phase-B `===` → `<=` (a régebbi echo-sor ignorálva, csak valóban ÚJABB verzió = peer edit); 7 stale-closure `setDraft({...draft})` → funkcionális forma (`SetDraft` típus, 5 tab). NEM user-tracking — a valódi két-tabos ütközés detektálása változatlan.
- Teszt: 551/551 zöld, `tsc` tiszta. Kézi smoke (user): lassú gépelés style mezőben autosave-vel, global edit móddal is.

### 2026-08-13 — DEPLOYOLVA: DCO/nonDCO (6.11.0) + agentic drafts (6.12.0), két passzban
- Committer-identity javítva (`beliczki.robert@gmail.com`, 3 commit reset-author). A két epic szétválasztva: PR #3 (DCO, `86249de`) merge → **1. passz**: box `06d8cc4`→`5b5da30`, build, `db:migrate` (0004+0005), `seed-channel-audiences` (6 audience: ch_disp…ch_yt, id 462–467), pm2 restart — `/` 307, `/mcp` 401. PR #5 (agentic, a base-törléskor auto-záródott #4 pótlása) merge → **2. passz**: box → `3ca2f5c`, build, `db:migrate` (0006), pm2 restart — `draft_messages`+`draft_previews` élesben ellenőrizve, `/api/draft-previews` route él.
- **Élesben talált+javított bug:** a seed script unawaited `getActiveClient()`-je (PG-cutover maradvány, `UNDEFINED_VALUE`) — fix `3ca2f5c`; 9 további script ugyanígy törött → új NOW-pont (retire-vs-fix scriptenként).
- User teendő (prod smoke): mátrix DCO/nonDCO toggle + nonDCO oszlopok; MCP-agentből `generate_test_creative` → `draft_status` polling → `/drafts` oldal.

### 2026-08-13 — Agentic test-creative epic (Slice 0–5) kód-komplett
- `generate_test_creative` MCP workflow end-to-end: `draft_messages`+`draft_previews` (`0006`), shooter-generalizálás (`shootItems`, közös mutex), 7 új MCP tool (read: list_drafts/draft_get/draft_status/show_draft_previews · full: generate_test_creative/draft_delete/draft_promote), publikus `/api/draft-previews/[id]`, `/drafts` oldal promote/delete-tel, McpTab Drafts szekció. Async render + polling (stateless MCP transport miatt nincs progress-notification); stalled-detekció pm2-restartra; hard delete storage-takarítással.
- Kulcsdöntések: teljes mező-paritás (disclaimer+styles+customCss), draft nem kerül snapshotba, `promoted_message_id` a dupla-promote guard, widget-HTML változatlan reuse. Terv: `~/.claude/plans/k-ne-nekem-egy-j-functional-raven.md`.
- Bump **6.11.0 → 6.12.0**. ⏳ Deploy: migráció+kód egy passzban a boxon.

### 2026-07-22 — DCO/nonDCO epic (Slice 0–4) kód-komplett, PR-re
- Az egész epic megvan a `feat/dco-nondco-matrix` branchen: `prodlist_rows` tábla (`0004`) + `audiences.channel` (`0005`) + DCO/nonDCO matrix-toggle + template-null MC kép-preview + `creative_promote` MCP-tool. nonDCO MC = `messages` sor `template=null`+`image1` → MCP-hivatkozhatóság 0 munkával. 6 channel-audience (DISP/SOC/PRG/GSN/GNW/YT). Auto-topic `familyKey`-ből, freeze-safe.
- **Tesztek: 519/519 zöld, `tsc` tiszta.** Bump **6.10.0 → 6.11.0** (minor). Terv: `~/.claude/plans/van-az-a-feladatd-encapsulated-meadow.md`.
- **Halasztva:** "Matrixize" UI-gomb (`CreativeLibrary.tsx`) + topic-tengely axis-scoping (auto-topic ütközés) + `scripts/import-prodlist.ts`.
- **Deploy hátravan** (PR-merge után, boxon egy passzban): `db:migrate` 0004+0005 a közös Postgresre + `seed-channel-audiences.ts` (ACTIVE_CLIENT_KEY=erste) + `pm2 restart mm6-erste`. A migrációk additívak (új tábla + nullable oszlop) → backward-kompatibilisek.


### 2026-07-21 — todo.md priorizálva (Now/Next/Later + lépés-vázlatok)
- A "Nyitott roadmap" mutató-lista lecserélve **🟢 NOW / 🟡 NEXT / 🔵 LATER** tierekre, minden tételnél fő lépések + reuse-horgonyok + open-Q defaultok. 3 Explore-agent audit korrigálta a done-állapotot: **W0.2 kész** (Wave 0 teljesen zárva), **Wave 2 link+dialog+import kész** (csak guided picker/auto-match/bulk/unmatrixed nyitott), **Wave 3 end-to-end live** (csak cell-badge/unmatched-link/retire nyitott), **audience/topic soft-archive UI részben megvan** (M9 gap szűkebb), **MCP = 39 tool**. Doc-only, nincs verzióbump. Terv: `~/.claude/plans/a-megmaradt-todot-szervezz-k-temporal-widget.md`.

### 2026-07-21 — todo.md szétbontva lean + archív
- `tasks/todo.md` (ez) = lean aktív roadmap + checkpoint. `tasks/todo-archive.md` = a régi ~4000 soros fájl teljes, szó szerinti másolata (semmi nem veszett el). Doc-only, nincs verzióbump.

### 2026-07-21 — W1.1 / W1.5 / W1.6 obsolete (Wave 1 zárva)
- A három maradék Wave 1 smoke-teszt lezárva obsolete-ként: napi live üzem (W1.1) / Phase 8 smoke már megvolt (W1.5) / productionizálva a külön `~/ERSTE Addressable AI Agent` skillben (W1.6). Nincs bump. Részletek: archív § "W1.1 / W1.5 / W1.6 LEZÁRVA".

### 2026-07-21 — DEPLOYOLVA 6.9.0
- Box `3f1d5f4`→`164dfd0`, 1 commit: W0.1 status-szín single-source + W1.2 dense New MC + W1.3 add audience/topic + W1.4 duplicate hover. Séma-migráció nincs. `pm2 restart mm6-erste` → Ready 1377ms. Health `/` 307, `/mcp` 401.
- **User teendő (prod vizuális check, edit-mód):** (1) status dot színek a Design-tab tokenekből, (2) dense New MC kis kör +, (3) add audience/topic záró cella + gomb, (4) header hover Duplicate.

*(Korábbi checkpointok — 6.1.0–6.8.0 deployok, MCP tool-bővítések, Postgres/MinIO migráció, Phase 0–10 — mind az archívban.)*

### 2026-08-17 — Global edit: státusz + flight date variant-szintűre
- **Root cause (nem bug, tervezési ütközés):** a `status`/`startDate`/`endDate` a 2026-08-14-i döntés óta **number-szintű** mezők voltak (`NUMBER_LEVEL_FIELDS`), így Global edit-nél az MC331c státusza szétterült az **összes variánsra** (a,b,c). A user viszont variant-szintet akart (331a inaktív mindenhol, 331c aktív mindenhol). Ezt látta „a c mellett az a és b is aktív lesz"-ként. A „nem megy tovább a többi audience-re" tünet = Global edit ki volt kapcsolva, vagy 409 (más is editálta → reload-only conflict, audit logban látszik).
- **Fix (user-döntés 2026-08-17, felülírja a 2026-08-14-it):** `NUMBER_LEVEL_FIELDS = []` — mindhárom mező variant-szintű lett (ugyanúgy propagál, mint a kreatív mezők: azonos number+variant, minden audience-ben; más variáns érintetlen). Frissítve: `messages.ts` komment + mező-lista, `MessageEditor.tsx` 2 tooltip copy, `propagate-siblings.test.ts` fő assertion (b variáns már NEM változik). Tesztek 9/9 zöld, `tsc` tiszta.
- **Nincs retroaktív adatjavítás:** a régi rossz állapotokat (ahol a/b már aktívra flippelt) a usernek egyszer manuálisan kell rendbe tennie (331a inaktív global, 331b inaktív global). Innentől helyesen propagál.
- **Kapcsolódó fix (ugyanaz a session):** globalEdit státusz-mentés után a TÖBBI audience testvér-pöttye ~30s-t késett. Ok: az `onSuccess` csak a primaryt patch-elte a cache-be (`setQueriesData`), a testvéreket egy `invalidateQueries` **teljes /api/messages refetch**-re bízta (~2435 sor, nehéz → lassú). A szerver viszont már kiszámolja a módosított testvér-sorokat (`propagateToSiblings` `changes`), csak eldobta. Fix: a `PATCH /api/messages/[id]` visszaadja a `siblings: after[]` sorokat, a kliens azokat is **közvetlenül bepatch-eli** (id→row Map), a teljes refetch kiesett. Cross-tab frissülés továbbra is az SSE broadcaston megy (writeAudit → `audit.ts:43`). Érintett: `messages/[id]/route.ts`, `MessageEditor.tsx` onSuccess. `tsc` tiszta, tesztek zöld.
- Bump-javaslat: **6.18.0 → 6.19.0** (minor, user-látható viselkedésváltozás — státusz-szint + azonnali sibling-frissülés).

### 2026-08-17 — TERV: Leadás-forrás átnevezés a javasolt névre + Creative Library újraépítés (JÓVÁHAGYÁSRA VÁR)
Kérés: `~/ERSTE Addressable AI Agent/static_creatives_export.csv` `suggested_filename` oszlopa alapján átnevezni **az eredeti fájlokat a GoogleDrive Leadás-könyvtárakban** (dátumok megőrzésével!), majd újra lefuttatni a creative-library update-et (dátumok ott is megmaradnak).

**Felderítés (kész, 2026-08-17):**
- CSV: 3227 sor, mind a 3227 forrás-path létezik; 1869 sor neve ≠ `suggested_filename`; 0 duplikált cél-név ugyanabban a könyvtárban.
- A GoogleDrive mount **case-insensitive** (macfuse) → 11 „csak kisbetű/nagybetű" átnevezés (`MC289_B` → `MC289_b`) csak **két lépésben** (temp néven át) megy.
- 26 `htmlFolder` sor valódi **könyvtár**, és a javaslat hibásan `.htmlFolder` kiterjesztést biggyeszt a végére → ezeknél a `.htmlFolder` suffixet le kell vágni.
- 10 sorban van `suggestion_correction` érték (kézi felülbírálás) → az élvez elsőbbséget a `suggested_filename`-nel szemben.
- 53 `suggested_filename` nem illeszkedik a kanonikus `ERSTE_<PROD>_MC<N>_<var>_<TOPIC>_n<v>_<WxH>.<ext>` mintára (pl. `MC3_va_`, hash-topicok).

**Fontos megállapítás (ez blokkolja a „aztán újra a library update" részt):**
- A lapos tükör (`~/ERSTE.../creatives`, 3227 fájl) **már most is pontosan a `suggested_filename` neveket viseli, és az mtime-ok bitre egyeznek a forrásokkal** (0 eltérés). A mm6 DB is ebből épült (3145 creatives = 3227 − 82 htmlFolder). → Az eredetik átnevezése **forrás-higiénia**, önmagában **nem változtat semmit a DB-ben**; a rebuild újrafuttatása ugyanazt az eredményt adná.
- A valószínű **valódi nonDCO-hiba:** 1259 `suggested_filename` **még mindig `MC0`-t tartalmaz**, miközben a CSV `suggested_mc_number` oszlopa valódi számot ad (MC2–MC388, 231 distinct). A `rebuild-creatives.ts` a **fájlnévből** veszi az MC-számot → az 1259 MC0-fájl **friss, globális max fölötti számot** kapott (ezért fut fel a nonDCO 837-ig) a szándékolt MC2–MC388 helyett.
- A behelyettesítés **nem mechanikus**: 43 `(suggested_mc_number, variant)` pár **több topichoz** tartozik, és 19 pár **ütközik** egy már számozott családdal (gyakran más termékben).

**Lépések (a ⚠️ döntés után indul):**
- [x] **R0** User-döntés (2026-08-17): **szó szerint a `suggested_filename`** (MC0 marad MC0) + a htmlFolder-mappáknál a `.htmlFolder` suffix levágva: az átnevezés csak a `suggested_filename`-t követi (MC0 marad), VAGY a `MC0` → `suggested_mc_number` behelyettesítéssel együtt (és akkor a 43+19 ütközés feloldási szabálya kell).
- [x] **R1** Rename-manifest generálás (dry-run CSV: `path`, régi név, új név, mtime ISO, ütközés-flag) — `.tmp_rename/` alatt, semmit nem ír.
- [x] **R2** Átnevezés végrehajtása: `os.rename` + **mtime visszaírás** (`os.utime` a CSV `date`-jéből), case-only esetek két lépésben, htmlFolder-suffix levágva, `suggestion_correction` prioritással. Rollback-manifest kiírása.
- [x] **R3** Verifikáció: 0 hiányzó forrás, 0 duplikátum, minden mtime egyezik a CSV `date`-tel.
- [ ] **R4** Lapos tükör (`~/ERSTE.../creatives`) újraszinkronizálása az új nevekre, mtime-megőrzéssel + `creatives_manifest.csv` / `static_creatives_export.csv` frissítés.
- [x] **R5** mm6 rebuild: `rebuild-creatives.ts <PROD> --commit` mind a 7 termékre (LTP/SZA/SZK/VAL/HK/MARKET/HITEL) — a script idempotens, a `createdAt` a fájl mtime-jából jön.
- [x] **R6** Ellenőrzés a DB-n: nonDCO max MC-szám, „DCO szám átível topicon = 0", feloldhatatlan preview = 0, creatives darabszám + `createdAt` eloszlás a CSV `date`-hez képest.
- [x] **R7** CHANGELOG + bump-javaslat.
- **DEPLOYOLVA 6.19.0** (2026-08-17): commit `11091ae`, box `a64235f`→`11091ae` (2 commit lemaradást is behozott: createdAt-backfill + docs), `npm run build` OK, `pm2 restart mm6-erste` → online. Nincs séma-migráció (csak route válasz-alak + propagáció-logika + kliens). Health `/` 307, `/mcp` 401.

**R1–R4 EREDMÉNY (2026-08-17):**
- **1867 fájl/mappa átnevezve** a Leadás-könyvtárakban (1358 már jó nevű volt, 0 ütközés). A 2 „failed" sor valójában lement — a macfuse a `rename` utáni `stat`-ra dobott ENOENT-et (metadata-cache), a cél-fájlok a helyükön vannak.
- **11 case-only átnevezés** (`MC289_B` → `MC289_b`) temp-néven keresztül lement, 0 temp-maradvány.
- **Dátumok:** a `rename` a Drive-mounton megőrzi az mtime-ot; a **26 htmlFolder-mappánál** viszont a Drive utólag felülírta (sync) → `os.utime`-mal visszaállítva a CSV `date`-ből. **Végállapot: 3227/3227 cél létezik, 0 mtime-eltérés a CSV-hez képest.**
- **R4 tárgytalan:** a lapos tükör (`~/ERSTE.../creatives`) nevei és mtime-jai már azonosak voltak a CSV-vel, és azok is maradtak (3227 fájl, 0 eltérés mindkét irányban).
- Manifestek: `rename_manifest.csv` + `rename_done.csv` a session-scratchpadban (rollback-alap).

**R5 — GYÖKÉR-OK JAVÍTVA (2026-08-17), fut a 7 termék:**
- **`rebuild-creatives.ts` számozás determinisztikussá téve.** A nonDCO MC-szám mostantól: (1) a fájlnévből, ha van valódi szám; (2) a `static_creatives_export.csv` `suggested_mc_number` oszlopából, ha a fájlnév `MC0`. A terv **az összes termékre egyszerre** számolódik, tisztán a mappa + CSV függvénye → **egy re-run bitre ugyanazt adja**. Az `autoNum = max(number)+1` fallback **törölve** (ez volt a 800+ számok forrása); ha egy fájl se fájlnév-, se CSV-számot nem hoz, a script **leáll**, nem talál ki számot.
- **Ütközés-szabály:** a fájlnév-igény veri a CSV-javaslatot. A CSV generátora 324–332-t osztott ki MC0-családoknak, miközben azok a számok már más termék fájlneveiben éltek → a 9 vesztes csoport a nonDCO-tér teteje fölé került: `HITEL MC324–329 → MC389–394`, `MARKET MC330–332 → MC395–397`. Determinisztikus (termék+szám szerint rendezve allokál). Fájlnév-vs-fájlnév ütközés (10 szám: 7/159/171/174/287/288/289/290/302/321) **érintetlen** — az a korábbi állapot, nem ez a terv hozta.
- **Számterv (dry-run, mind a 7 termék):** 446 nonDCO kártya → 688 cella, számtartomány **2–397** (a mai 826 sor / 333–837 helyett). 3145 forrásfájl: 1914 fájlnév-szám + 1231 CSV-javaslat.
- **Új-MC auto-számozás tengely-scope-olt** (`messages.ts` `liveOnAxis` + `numbering.ts` doc): egy új DCO MC a DCO-max+1-et kapja (333), egy új nonDCO a nonDCO-max+1-et (398) — nem ugrik át a másik tengely magasságára. +1 integrációs teszt (`messages.test.ts`), MCP tool-leírás + MatrixGrid komment frissítve.
- **Backup a destruktív futás előtt:** `~/ERSTE.../backup_20260817_prerenumber/` — `nondco_messages.csv` (826), `creatives_rows.csv` (3145), `uploaded_files_rows.csv` (3145).

**(eredeti blokkoló megjegyzés, feloldva):** a rebuild újrafuttatása **tartalmilag no-op** (a forrás bájtra és névre azonos), viszont **kárt okoz**: a `rebuild-creatives.ts:331` `autoNum = max(number)+1` a törlés UTÁN számol, így a **308 auto-számozott nonDCO kártya** (a 826-ból; 69 jön a fájlnévből) újraszámozódna 333–837-ről 838+-ra. Ez a nonDCO-hiba gyökere is: 1259 fájlnév `MC0`, a CSV `suggested_mc_number`-e viszont MC2–MC388 — ezt a mostani rename (szándékosan) nem javította.

---

## 🟡 NEXT — Channels-entitás + MC-creation defaults epic (TERV, 2026-08-17, JÓVÁHAGYÁSRA VÁR)

**Kiváltó (user, 2026-08-17):** 5 összefüggő igény. Döntések lockolva: (1) channelek KÜLÖN entitás, ch_* audience-ok kiszedve az audiences-ből; (2) default template a Templates oldalon megjelölve (per-client config); (3) egy nagy összefüggő terv.

**Élő adat (migráció mérete):** 6 ch_* channel-audience · 180 DCO audience · **826 nonDCO message hivatkozik `audience="ch_*"` string-kulcson** (nincs DB FK → törlésnél elárvulnának) · 826 template=null · 814 status null/üres.

**Architekturális tény (térkép, 2026-08-17):** a "channel" ma NEM tábla, hanem az `audiences.channel` nullable oszlop. nonDCO message a channelt közvetve, `messages.audience = "ch_disp"` kulcson hivatkozza. A DCO/nonDCO tengely mindenhol `audience.channel == null` vs `!= null`. `createMessage` (`messages.ts:322-351`) pmmid+trafficking-et épít az audience-kulcs lookupból → a channel-audience törlése a nonDCO pmmid/UTM-et is érinti.

**Ajánlott megközelítés (light-B, kockázat-minimalizált — jóváhagyandó):** új `channels` tábla adja a channel-definíciókat; a `messages.audience` string-kulcsok (`ch_disp`) VÁLTOZATLANOK maradnak (nincs 826-soros átdrótozás); a ch_* SOROK törlődnek az `audiences`-ből; a channel-kulcs lookupok (numbering / trafficking / matrix-oszlop / archive-cascade) **channel-aware fallback**-et kapnak (ha egy audience-kulcs nincs a valódi audience-ök közt, a channels táblából oldódik fel). Ez a user B-döntését teljesíti (külön entitás + ch_* kitakarítás) a 826-soros adat-rewrite és a `messages.channel` oszlop nélkül.

### Szeletek (mind commit-méretű, teszttel)

- [x] **S1 — Default status = INCOMING.** `createMessage`: `status: input.status ?? "INCOMING"` (lefedi dialog+MCP `mc_create`/`mc_create_batch`+promote+draft-promote; copy/move a forrás státuszát klónozza, változatlan). Teszt: create default INCOMING; explicit status felülír. *(Nyitott: a 814 meglévő null-status backfill — külön, opcionális.)*
- [x] **S2 — Default template DCO MC-hez.** Új per-client `config` kulcs `defaultTemplate` (a `visibleTemplates` mintájára). Templates oldal: "Set as default" jelölő egy HTML template-re → írja a configot. Create-logika: ha a cél audience DCO (nem channel) ÉS nincs template megadva → `template = config.defaultTemplate`; channel/nonDCO ág marad `null`. Teszt: DCO create default template-et kap, nonDCO nem.
- [x] **S3 — nonDCO edit-mode kivezetés + info box.** `filters.axis === "nondco"` guard: add-MC ("+" üres cella + dense), add-audience/add-topic header-gombok (`GridView.tsx:310-322,424-443,600-624`) elrejtve nonDCO-ban; az `EditModePanel` (`MatrixGrid.tsx:883-888`) helyén nonDCO-ban info box: "Upload correctly named creatives to the Creative Library to see them here." (empty-state token, szemantikus class). Nincs séma.
- [x] **S4 — Channels tábla + migráció (a nehéz mag).** Új `channels` tábla `(clientId, key, code, label, orderIndex, archivedAt)`. Migráció: tábla + seed a 6 ch_*-ból (kulcs `ch_disp`, kód `DISP`, label `Display` megőrzve) → majd a 6 ch_* audience SOR archiválása/törlése. Rewire channel-aware fallbackkel: matrix-oszlop deriv (`MatrixGrid.tsx:582-585,642-644`), axis-numbering `channelByAudience` (`messages.ts:215-227`), promote channel→kulcs (`promote.ts:63-79`), createMessage pmmid/trafficking lookup (channels a lookup-felületen), archive/restore cascade (`audiences.ts`/`messages.ts`). **Integr. teszt: migráció után a 826 nonDCO message + derivált topic-sorok VÁLTOZATLANUL látszanak a mátrixban; promote channelre rak; numbering DCO/nonDCO nem ütközik.**
- [x] **S5 — Settings › Channels management.** Új Settings tab/szekció a channel-lista kezelésére (label + sorrend + archive; a channel-SET forrása a `prodlist_rows.channel`-lel reconciled). Reuse: DimensionGrid vagy keywords-stílus. (Méret→channel map `egyelőre` kód-szintű marad, channels kulcsokra hivatkozva.)
- [x] **S6 — Audiences lista tiszta + verifikáció.** A ch_* sorok az S4 után már nincsenek az `audiences`-ben → a lista automatikusan tiszta; ellenőrzés + regressziós teszt hogy channel nem szivárog vissza. `types.ts:21` + `WRITABLE_FIELDS` channel-mező sorsa (marad a fallbackhez vagy törlődik) az S4-ben dől el.

### Kockázatok / hazardok (térkép szerint, sorrendben)
1. `messages.audience` nem-FK text → ch_* törlésnél a 826 sor csendben elárvulhat. **Kezelés:** kulcs-stringek megőrzése + channel-aware lookup, migrációs teszt.
2. Axis-numbering `sameAxis`/`targetIsDco` → rossz join DCO/nonDCO MC-szám ütközést okoz. **Kezelés:** dedikált numbering teszt.
3. Promote + rebuild-creatives + seed channel→audience lookup elhal. **Kezelés:** átirányítás channels táblára.
4. Archive/restore cascade parent-child alak változik. **Kezelés:** channel-aware cascade.
5. nonDCO pmmid/trafficking az audience-lookupon lóg. **Kezelés (S4 nyitott al-döntés):** ellenőrizni kell-e egyáltalán nonDCO-nak pmmid/UTM; ha igen, channels a lookup-felületen.

### Deploy
Séma-migráció (channels tábla) → **migrate+kód egy passzban a boxon** (`db:migrate` + build + `pm2 restart mm6-erste`), soha nem lokális migrate önmagában. Bump: minor (több user-látható változás + séma) — vagy a user dönthet nagyobbról a channel-modell törése miatt.

**Sorrend-javaslat:** S1 → S2 → S3 (független, gyors, alacsony kockázat, azonnal deployolható) ⇒ S4 → S5 → S6 (channel-mag, egyben migrálva/deployolva).
- **DEPLOYOLVA 6.20.0** (2026-08-17): S1–S3 (channel-epic 1/2, migration-free). Commit `6a818ca`, box `11091ae`→`6a818ca`, build OK, `pm2 restart mm6-erste` → online. Health `/` 307, `/mcp` 401. S4–S6 (channels tábla + migráció + Settings + audiences-takarítás) hátravan, egyben deployolva. ⚠️ Megjegyzés: a boxra NEM kerültek fel a `rebuild-creatives.ts`/`mcp.ts`/`numbering.ts` lokális commitolatlan módosítások (nem az én munkám) — csak origin/main.
- **DEPLOYOLVA 6.21.0** (2026-08-17): S4–S6 channel-mag. Commit `c71831c`, box `6a818ca`→`c71831c`. Séma-migráció `0007` (channels tábla) + `migrate-channels.ts` (erste): **6 channel seedelve, 6 ch_* audience törölve, 0 message elveszett** (ch_*-kulcsú msg 583→602 közben NŐTT a párhuzamos rebuild miatt). build OK, `pm2 restart` → online. Health `/` 307, `/mcp` 401, `/api/channels` 401. ⚠️ **rebuild-creatives.ts (user uncommitted) még channel-audience-t használ — a channels-táblára kell átírni futtatás előtt.** ⚠️ Csak erste-re futott a data-migráció; ha más kliens is használ nonDCO-t, nekik is kell.

**R5–R7 EREDMÉNY (2026-08-17):**
- **Mind a 7 termék újraépítve.** Az első háttérfutás a HITEL újraimportja közben megszakadt (külső kill, 520/555 creative bement, 0 nonDCO MC) — a script idempotens, a HITEL újrafuttatása rendbe tette.
- **Végállapot (DB, erste):** **688 nonDCO üzenet** (357 DISP + 331 SOC), **232 distinct MC-szám, tartomány 2–397** (a korábbi 826 sor / 333–837 helyett). 3145 creatives. `createdAt` visszaállítva a CSV file-dátumokból (`fix-creative-dates.ts --commit`, 3145 sor; 3118 CSV-ből, 27 mtime-ból).
- **Invariánsok:** DCO szám átível topicon = 0 · nonDCO image1 feloldhatatlan = 0 · nonDCO image1 hiányzik = 0 · DCO max = 332. nonDCO-ban 10 szám ível át topicon — pontosan a 10 előzetesen azonosított fájlnév-vs-fájlnév ütközés (7/159/171/174/287/288/289/290/302/321), ezeket szándékosan nem nyúltuk.
- **⚠️ Párhuzamos session:** közben a repo 6.19.0 → **6.21.0**-ra ment (channels epic: a channel-audience-ök átkerültek a külön `channels` táblába, `migrate-channels.ts`). A rebuild által írt `audience='ch_disp'/'ch_soc'` kulcsok **helyesek maradtak** — a channels-modell pont ezt írja elő ("nonDCO messages keep their audience key and resolve through the channels table"). A tengely-scope-olt auto-számozás (`liveOnAxis`) is bekerült HEAD-be a 6.20.0-val, a channels-modellhez igazítva.
- Tesztek **566/566 zöld**, `tsc` tiszta.
- **Nyitva maradt (user-döntés kérdése):** 1231 fájl neve továbbra is `MC0` — a szám a CSV-ből jön, nem a fájlnévből. Ha a fájlnevek is a valódi számot vinnék, a rename-et újra kéne futtatni MC0 → `suggested_mc_number` behelyettesítéssel (a 9 ütköző csoportra a fenti 389–397 leképezéssel).

### 2026-08-18 — MC0 → valódi szám a fájlnevekben is (a rename második köre)
- **User-döntés:** a fájlnevek is vigyék a valódi MC-számot, a rebuild által használt leképezéssel (fájlnév-szám nyer; `MC0` → CSV `suggested_mc_number`; a 9 ütköző csoport 389–397).
- **2518 átnevezés, 0 hiba** — 1259 eredeti a Leadás-könyvtárakban + 1259 a lapos tükörben. mtime mindkét helyen megőrizve (8 htmlFolder-mappánál a Drive felülírta → `os.utime`-mal visszaállítva). Végállapot: **0 `MC0` maradt**, 3227 eredeti + 3227 tükör, 0 dátum-eltérés.
- **CSV átvezetve** (`name`, `path`, `suggested_filename`, `suggestion_correction`, + a 9 csoport `suggested_mc_number`-e = 73 sor). Backup: `static_creatives_export.before_mc0_substitution.csv`. A `name`/`path` az ELSŐ rename kör után is elavult volt 610 sorban — most mind a 3227 sor a `suggested_filename`-ből újraszármaztatva, 0 hiányzó fájl. ⚠️ A `filename_ok` / `dimension_ok` oszlopokat nem nyúltam — azokat a külső szkennernek kell újraszámolnia.
- **CRLF-csapda:** a CSV újraírása CRLF-re váltott, amitől a `loadSuggestedNumbers` nem találta az utolsó oszlopot. A fájl visszaállítva LF-re, a parser pedig megvédve a `\r`-től.
- **DB in-place átnevezve, NEM újraépítve.** A `storage_path` tartalom-hash alapú, nem a fájlnévből jön → elég volt 4 UPDATE egy tranzakcióban (`uploaded_files.filename` + `original_filename` 1231, `creatives.file_name` 1231, `messages.image1` 290, `messages.name` 290). Ezzel megspóroltunk egy ~2 órás, destruktív újratöltést MinIO-ba.
- **Verifikáció:** `creatives.mc_number` vs az új fájlnév száma → **0 eltérés** (a DB számai már pontosan egyeztek). Rebuild dry-run: **3145 fájl, mind a fájlnévből, 0 CSV-javaslat, 0 újraallokáció** — a terv változatlan. DB: 688 nonDCO üzenet, 232 szám, **2–397**, feloldhatatlan image1 = 0, DB-név nincs a lemezen = 0. DCO max = **333** (közben született egy új DCO MC — pont a tengely-scope-olt allokáció működése).

---

## 🔴 INCIDENS — MC301c tartalom felülíródott (2026-08-17 20:15) — helyreállítva, javítás JÓVÁHAGYÁSRA VÁR

**Tünet (user, 2026-08-18):** MC301c tartalma MC330c/MC330a tartalmára cserélődött.

**Mi történt (audit_log alapján, bizonyított):** 2026-08-17 **20:15:42 → 20:15:59** között az MC301c **mind a 36 audience-sora** (34 DCO + 2 nonDCO `ch_disp`/`ch_soc`) hatszor egymás után teljesen felülíródott, mindig egy **másik** kártya tartalmával, ~3 mp-enként: **MC316a** („Kalkulátor - autó") → **MC317b** („Kalkulátor - lakás") → **MC319d** („Kalkulátor - varatlen") → két név nélküli kártya → **MC330a** („Lakásfelújítás lépésenként", `MC330_a_felhasznalas_lakasfelujitas_n1.jpg`). Kárfelmérés az egész audit-történetre (≥5 kártya-mező egyszerre változott): **csak a 301c érintett** (216 sor-update); a 332a/b/c találatok új kártya kitöltései, nem kár.

### Két külön gyökér-ok

**GY1 — elavult `committedSnapshot` az editorban (ez írta be a más kártya tartalmát).**
`MessageEditor.tsx` `save.onSuccess` **feltétel nélkül** rebase-eli a `committedSnapshot`-ot a mentett sorra, akkor is, ha az editor közben már **másik kártyára lépett** (prev/next `onJump`). Sorrend:
1. A kártyán fut egy autosave PATCH (globális szerkesztéssel ~2 mp, mert 35 testvérsort ír).
2. A user átlép B kártyára → a reset-effect `draft`+`committedSnapshot` = B.
3. Az A-ra indított mentés beér → `onSuccess` → `committedSnapshot` **vissza A-ra**, miközben a `draft` már B.
4. A következő autosave `diff(A, B)` = B **összes** mezője → PATCH **A sor id-jára** → A kártya tartalma = B tartalma.
5. Globális szerkesztéssel ez az összes audience-másolatra rámegy.
Önfenntartó: a lassú propagáló PATCH miatt a következő lapozáskor megint van in-flight mentés → 6 hullám 17 mp alatt.

**GY2 — a testvér-fan-out nem tengely-tudatos (a user diagnózisa, megerősítve).**
`messages.ts` `findSiblings` / `propagateToSiblings` **csak `(clientId, number, variant)`-ra szűr**, tengely nélkül — a kódkomment még a régi invariánst állítja („(number, variant) never spans more than one topic"). A **6.17.0** viszont pont ezt oldotta fel: `nextMcSlot` kommentje szerint „Cross-axis reuse is allowed — a DCO number may be claimed for its nonDCO twin". Így egy DCO MC301c global edit **beleír a nonDCO MC301c-be** (és fordítva). Élő kitettség most: **31 `(number, variant)` pár / 20 MC-szám él mindkét tengelyen.**

### Helyreállítás — KÉSZ (2026-08-18)
- [x] Forrás: `audit_log.before` a kaszkád **első** bejegyzéséből soronként (pontosabb, mint az xlsx: soronkénti, UTM-mel együtt). Backup a felülírt állapotról: scratchpad `mc301c_before_restore.jsonl` (36 sor).
- [x] 36 sor visszaállítva (tartalom + stílus + képek + UTM + státusz + flight dates), `version` +1. Ellenőrizve az `erste-SZK-feed-v1-22-merged-adform.xlsx` ellen: „Pattintsd le a régi hiteled!" / „Próbáld ki hitelkiváltás kalkulátorunkat!" / `keklabda_pattan` / `purple fullSurfaceColor objectGfx` — egyezik. A 2 nonDCO sor a saját statikus kreatív-nevét kapta vissza.
- [x] Previewk: `message_previews.message_version` = 1 vs `messages.version` = 9 → a meglévő stale-detektálás újragenerálja, nincs teendő.

### Javítás (TERV — jóváhagyásra vár)
- [x] **F1 (GY1)** `MessageEditor.tsx`: új `openRowIdRef` tartja a ténylegesen nyitott sort. `save.onSuccess` csak akkor rebase-eli a `committedSnapshot`-ot, ha `openRowIdRef.current === saved.message.id`; a `onError` konfliktus-ág elhagyott sorra `return`-öl (nem blokkolja a most nyitott kártyát). A grid-cache patch marad feltétel nélküli (a mentett sorok valósak).
- [x] **F2 (GY2)** `messages.ts`: új `sameAxisAs(clientId, primary)` helper (a `nextMcSlot` `sameAxis`-ával azonos szemantika: `listAudiences` + `listChannels().map(channelToAudience)`, ismeretlen kulcs = DCO). `findSiblings` és `propagateToSiblings` `family`-je is szűr rá. `MatrixGrid.openSiblingCount` szintén tengely-tudatos (`channelAudienceKeys`), hogy a figyelmeztetés azt mondja, amit a fan-out csinál. A `messages.ts:279` + a `propagateToSiblings` elavult kommentjei javítva.
- [x] **F3** Bump `6.22.1` → **`6.22.2`** (patch) + CHANGELOG. *(Alternatíva volt a minor, mert az F2 user-látható viselkedésváltozás — de mindkettő hibás viselkedés javítása, ezért patch.)*

**Tesztek:** 3 új integrációs teszt (`tests/integration/api/messages.test.ts`, `messages — global-edit fan-out is axis-scoped`): findSiblings kihagyja a nonDCO névrokont; DCO global edit nem ér el a nonDCO ikerhez; és fordítva. Ellenőrizve, hogy a javítás nélkül **buknak**. Teljes suite **576/576 zöld**, `tsc` tiszta.
**Nem fedi teszt:** az F1 React-race — a repo-ban nincs komponens-teszt infra (`.test.tsx` nincs), ezért nem építettem hozzá újat.
**Deploy:** nincs séma-migráció, sima build + `pm2 restart mm6-erste`. A DB-helyreállítás a közös Hetzner Postgresen már él.

- **DEPLOYOLVA 6.22.2** (2026-08-18): MC301c incidens javítása (F1 editor stale-snapshot + F2 tengely-scope-olt fan-out). Commit `0956f82`, box `d7c4c63`→`0956f82` (a 6.22.1-et is behozta), `npm run build` OK, `pm2 restart mm6-erste` → online. Nincs séma-migráció. Health `/` 307, `/mcp` 401, `/api/channels` 401. A DB-helyreállítás (36 sor) a közös Postgresen érintetlen.

### 2026-08-25 — Hide-inactive sarok-checkbox + header drag-reorder (6.23.0)
- **M2 ✅** — `Hide inactive` pipa a mátrix sarok-cellájába (transpose alá, `matrix-grid__hide-inactive`); `filtered` useMemo dobja az `INACTIVE` audience/topic headereket mindkét tengelyen (MC-t/archive-ot nem érint); persist `mm6_matrix_state_v1`.
- **M11 Fázis 1 ✅** — edit-mode drag-drop sorrend a headereken. Mindig látszó grip (csak edit módban): row bal szél (`GripVertical`), col alsó él a szín-border felett (`GripHorizontal`), minden density. `reorderAudiences`/`reorderTopics` (permute-within-occupied-slots — nem 0..N reindex, így DCO/nonDCO nem interleave-el) + `POST /api/{audiences,topics}/reorder` (`withSession`+`denyDemo`, audit). GridView DnD kiterjesztve `ro:`/`rod:` prefixekkel a meglévő `@dnd-kit` contextbe.
- **nonDCO topic-sorok:** nincs grip (synth, nincs orderIndex) → `topicReorderable={axis==="dco"}`. **M11 Fázis 2** (overlay-tábla a synth-sorok sorrendjéhez) külön epic, push-back-first — a user kérte ("handle mindenhol"), de új tárolási réteg, ezért elhalasztva.
- **Teszt-állapot:** tsc tiszta (lokál + box build exit 0), unit **181/181 zöld**. Új integ-tesztek (audiences: reverse/permute-slots/foreign-drop/no-op; topics: permute-slots) MEGÍRVA, de **nem futottak** — nincs se Docker daemon, se lokális PG-szerver (csak libpq kliens a gépen). ⏳ Integ-suite lefuttatása hátravan, amint a Docker fenn van (`npm run test:fast`).
- **Bump:** `6.22.2` → `6.23.0` (minor: 2 új route + új edit-mode UI-akció + új sarok-kontroll). CHANGELOG + component-inventory frissítve.
- **DEPLOYOLVA 6.23.0 (2026-08-25):** commit `12b1633`, push origin main, box `/var/www/mm6-erste` git pull `0956f82→12b1633` + `npm run build` (exit 0) + `pm2 restart mm6-erste` → online. Nincs séma-migráció. Health: `/`→307, `/mcp`→401, `/api/audiences/reorder` GET→405 (csak POST), `/api/topics/reorder` POST no-auth→401. `~$` Office lock-fájl gitignore-olva.

### 2026-08-25 — Egységes cella-háttér (M3) + hover crosshair (M4.1) — 6.24.0
- **6.23.1 (előző, addig nem checkpointolt):** audience strategy/platform szín-strip a jobb élre került transposed nézetben (audience=sor), nem az aljára — `audienceEdgeClasses` bottom/right ág + right-edge CSS-variánsok. Commit `245d58d`.
- **M3 ✅** — `GridView.tsx` PlainCell + EditableCell egységes `bg-surface` (üres és tele cella azonos háttér); a feltételes `bg-slate-50/50 dark:white/[0.03]` üres-tint törölve. A `matrix-grid__cell--has-messages` osztály marad szemantikus hookként (nincs saját CSS-e). Tiszta alap az M1 „Color by"-hoz.
- **M4.1 ✅** — hover crosshair él-rail-ekkel. Imperatív (`paintCrosshair` + delegált `onMouseOver`/`onMouseLeave` a `<table>`-ön), nincs grid re-render hoverkor. Oszlop bal+jobb (`c`+`c-1` `border-right`) és sor alsó+felső (`r`+`r-1` `border-bottom`) él kap `--mx-cross` színt; csak border-COLOR vált → 0 layout-shift, `transition: border-color 140ms` → nem villódzik. Edit módban is megy (nem ütközik a drop-ring box-shadow-jával). Header-hover = csak az az oszlop/sor. `data-col-key`/`data-row-key` a headereken + cellákon. Új CSS-token `--mx-cross` (light `#0ea5e9` / dark `#38bdf8`), unlayered mátrix-blokk.
- **Verifikáció:** `tsc --noEmit` exit 0. Vizuális check a boxon/dev-en (nem futott le böngészős smoke).
- **Bump:** `6.23.1` → `6.24.0` (minor — M4.1 új feature; M3 CSS-tisztítás egybevonva). CHANGELOG + component-inventory frissítve. Nincs séma-migráció.

### 2026-08-25 — Sidebar theme toggle (Confai2-minta) + crosshair szürke + dense pötty-centrálás — 6.25.0
- **User-kérés (3 db):** (1) crosshair NE kék legyen, hanem semleges szürke (light ~30%-kal sötétebb mint az alap border, dark picivel világosabb); (2) dense nézetben az egysoros pötty-csoportok vertikálisan középre; (3) a Confai2 light/dark switcherének működését+elhelyezését átvenni a sidebar fix alsó részébe (becsukva függőleges verzióval), és kivenni a theme-switchert a Settings/Design tabból (system állapot elhagyva).
- **(1) Crosshair szín:** `--mx-cross` → `rgba(0,0,0,0.4)` light / `rgba(255,255,255,0.4)` dark (kék `#0ea5e9`/`#38bdf8` helyett). Semleges szürke, egyértelműen sötétebb/világosabb a halvány rács-vonalnál.
- **(2) Dense pötty-centrálás:** `GridView.tsx` PlainCell + EditableCell — dense ágon `align-top` → `align-middle` (a `<td>` vertical-align középre teszi a pötty-blokkot a sor magasságában; egysoros és kétsoros csoport is centrálva). Nem-dense marad `align-top`.
- **(3) Sidebar theme toggle + verzió (Confai2-minta):** `Sidebar.tsx` — a footer aljára pinnelt `app-sidebar__theme` blokk. Expanded: Sun/Moon segmented pill (`app-sidebar__theme-pill`/`__theme-btn`) + inline verzió. Collapsed: függőleges verzió (`-rotate-90`, `h-11` box) + kör-ikon gomb (`app-sidebar__theme-round`). A toggle a `.dark` class-t váltja + `localStorage.mm6_theme` (per-böngésző, light/dark only). A verzió a nav-ból a fix footerbe költözött. **mm6 SAJÁT theme-infra újrahasznosítva** (nincs Confai2-provider import): a `<head>` FOUC inline-script + `localStorage.mm6_theme` + `.dark` már megvolt.
- **DesignTab:** a „Color mode" szekció + `ColorModeField` (light/dark/system pill) törölve; az `applyColorMode` és a `localStorage.setItem("mm6_theme", …)` **leválasztva** (különben egy brand-szín Save felülírná a sidebar theme-választását). A `colorMode` mező a configban marad (első-látogatás default), de UI-ból nem szerkeszthető; a system állapot a UI-ból eltűnt.
- **Verifikáció:** `tsc --noEmit` exit 0, `npm run build` exit 0. Böngészős smoke a userre vár (dark/light váltás + collapsed sidebar + crosshair szürke + dense pöttyök).
- **Bump:** `6.24.0` → `6.25.0` (minor — új sidebar feature + user-látható theme-áthelyezés). CHANGELOG + component-inventory frissítve. Nincs séma-migráció.
- **Deferred/megjegyzés:** Confai2 view-transition circle-reveal animáció (startViewTransition) NEM került át — plain instant váltás + color-transition; külön kérésre hozzáadható. A sidebar teljes dark-polish a külön WP-sweep tárgya (a bg-white/border-slate utilityk már remappeltek dark-ban).

### 2026-08-25 — Sidebar theme finomítás: kör-reveal animáció + verzió-szín + reorder — 6.26.0
- **User-észrevételek (3):** (1) miért színes a verzió? → legyen szürke mint minden más; (2) a switcher + verzió az admin@local FÖLÉ; (3) a switcher a Confai2 masked-animációja helyett koncentrikus kör-animáció a kattintás helyétől a teljes felületre, a megjelenés rögzítésével az animáció idejére.
- **(1) Verzió-szín:** `text-slate-400` → `text-slate-500`. Ok: a `slate-500/600` át van kötve dark-ban `--text-secondary`-re (semleges #999), a `slate-400` NEM → nyers Tailwind slate-400 (#94a3b8, kékes) → színesnek látszott. Most a többi muted label-lel egyezik.
- **(2) Reorder:** a `app-sidebar__theme` blokk a footer TETEJÉRE került (a user/`admin@local` blokk fölé), `border-b` elválasztóval (`border-t` helyett).
- **(3) Kör-reveal animáció:** `Sidebar.setTheme(next, e)` a class-flipet `document.startViewTransition`-be csomagolja; a kattintás `clientX/clientY`-ből `--theme-switch-x/y` a `<html>`-en; globals.css `::view-transition-new(mm-theme)` `clip-path: circle(0%→150% at var(...))` 0.5s, az `::view-transition-old` `animation:none` (befagyasztva). `prefers-reduced-motion` → JS kihagyja a view transitiont (azonnali flip); API nélküli böngészőn is azonnali flip. `html { view-transition-name: mm-theme }` (a Next router nem trigger-el view transitiont, biztonságos).
- **Verifikáció:** `tsc` exit 0, `npm run build` exit 0. Böngészős smoke a userre vár (kör-animáció a kattintás helyétől; verzió szürke; sorrend admin@local fölött).
- **Bump:** `6.25.0` → `6.26.0` (minor — új kör-reveal animáció-viselkedés). CHANGELOG frissítve. Nincs séma-migráció.

### 2026-08-25 — Dark-mode fixek + bug-hunt report (Finding 1–4,6) — 6.27.0
- **Dark-mode darabok (user-jelentés + screenshotok):** (1) sidebar: vonal törölve a switcher és admin@local közül (`border-b`→`mb-3`); (2) DCO/nonDCO toggle aktív `bg-slate-800`→`bg-slate-900` (invertál fehérre dark-ban); (3) MC-editor tab-sor `bg-slate-50/60`→`bg-slate-50` (a `/opacity` variáns NEM remappelt, a sima igen); (4) audience/topic property panelek `bg-slate-50/50`→`bg-slate-50`; (5) feed „Build & Download XLSX" gomb `bg-brand-button`→`bg-slate-900 hover:bg-slate-800` (mint az upload-gomb, invertál); (6) feed warning/success dobozok amber/emerald `dark:` variánsok.
- **Bug-hunt `docs/BUGHUNT_2026-08-25_matrix-filter-crash.md` — Finding 1–4,6 megcsinálva:**
  - **F1 (CRITICAL, én okoztam 6.24.0-ban):** a crosshair `tableRef`/`crossRef` az empty-axis early return ALÁ került → egy nullára szűkítő `t:`/`a:`/… filter React #300 („rendered fewer hooks") → egész app fehér képernyő. Fix: a két `useRef` az early return FÖLÉ, magyarázó kommenttel.
  - **F2:** `src/app/(app)/error.tsx` route-szintű error boundary (a layout/sidebar életben marad, Try again / Reload).
  - **F3:** ESLint flat config (`eslint.config.mjs`, `next/core-web-vitals` + `react-hooks/rules-of-hooks: error`), `lint`→`eslint .`. Verifikálva: a hook-after-early-return mintát elfogja (a fixet előtte buktatta volna). A `next build` mostantól enforce-olja → megjavítottam a build-blokkoló pre-existing errorokat: `useS3`→`s3Enabled` rename (sima fv, nem hook, 3 false-positive), `<a>`→`<Link>` (FeedExportDialog), 3 unescaped entity (McpTab/SnapshotsTab). Maradék: 72 warning (img/exhaustive-deps) — nem blokkol, külön takarítás.
  - **F4:** `quietConsole` flag a render-pipeline-on (render.ts `injectQuietConsole` → no-op console.log/debug/info, warn/error marad), csak a Creative Library grid-tile-okon bekapcsolva (Tile/Card/ListRow prop-átvezetés); editor/share/monitoring marad verbose.
  - **F6:** `/api/previews/status` offenders `mcLabel` szerint csoportosít (nem row-onként), `mcCount` = distinct label.
  - **F5 (NEM csinálva):** stored-preview kiszolgálás live-render helyett — design-change, a report is „discuss first"-nek jelöli.
- **Verifikáció:** `tsc` exit 0, `npm run build` exit 0. Integ-teszt Docker-igényes (down); komponens-teszt infra nincs (F1 React-race). 
- **Bump:** `6.26.0` → `6.27.0` (minor — kritikus crash-fix + több user-látható dark-mode/badge/console változás). CHANGELOG + component-inventory frissítve. Nincs séma-migráció.

### 2026-08-29 — Topic-hozzáadás 500 + header-dialog bezáródás tag-szerkesztésnél (bump vár: 6.27.4)
- **(1) „can't add topic" (prod 500):** az Erste `config.patterns.topicKey` = `{{product}}_{{tag1}}_{{tag2}}_{{tag3}}_{{tag4}}`. Új topicnál minden mező üres → a minta `____`-ra evaluálódik, ami NEM üres string, így a `generateTopicKey()` `out.trim() !== ""` fallback-őre átengedte → a 2. topictól `duplicate key ... topics_client_key_unique (8, ____)` → 500. (Prod pm2 logból, nem tippelve.) Fix `src/lib/entities/topics.ts`: `hasKeyContent()` — alfanumerikus tartalom nélküli minta-eredmény = üres → `top{orderIndex+1}` fallback; + `ensureUniqueKey()` a create és az update key-regen ágán (a meglévő `_N` suffix-konvencióval), ami a másik élő változatot is lezárja (két azonos product/tag kombójú topic ugyanazt a kulcsot generálta volna). 2 regressziós teszt (`topics.test.ts`).
- **(2) Tag-szerkesztés bezárta a header-dialogot:** a `MatrixGrid.headerDialog` state `{kind, key}`-t tárolt, a `headerEntity` pedig `topics.find(t => t.key === headerDialog.key)`. A tag/product mentése szerveroldalon ÚJRAGENERÁLJA a kulcsot (MC-guard: csak 0 MC-nél) → az autosave utáni refetch után a key-alapú lookup nem talált semmit → `headerEntity === null` → a dialog unmountolt. Fix: a state és az `onOpenHeader` id-alapú (`MatrixGrid.tsx`, `GridView.tsx`), a `headerMessages` a `headerEntity.key`-t használja. (Ugyanez érintette az audience-dialogot is.)
- **(3) Topic törlés:** már létezik — Topics oldal → sor kijelölése → Edit panel → Delete (hard delete, MC-vel rendelkező sort visszautasít). A matrix edit-mode header-menüben csak add/duplicate van; ha oda is kell törlés, külön kérés. A 606 (`____`, „New topic") és 612 („ - boost individual (2)") sor 0 MC-vel törölhető.
- **Audiences twin-bug NEM javítva:** a `generateAudienceKey()` ugyanezt az `out.trim() !== ""` ellenőrzést használja, ugyanezzel a minta-alakkal (`audienceKey`) → ugyanígy 500-azni fog. Külön kérésre tükrözöm.
- **Verifikáció:** `tsc --noEmit` exit 0, `npx vitest run` 583/583 zöld, eslint a módosított fájlokon 0 error. Deploy a boxra még nem történt meg.

### 2026-08-29 — Audience-kulcs fix + header-dialog Delete + legacy Tag mező — 6.28.0
- **(1) `generateAudienceKey()` ugyanaz a fix mint a topicnál (6.27.4):** `hasKeyContent()` (szeparátor-only minta-eredmény = üres → `aud{N}` fallback) + `ensureUniqueKey()` a create és az update key-regen ágán. 2 regressziós teszt (`audiences-key-pattern.test.ts`).
- **(2) Delete a header-dialogban (topic ÉS audience), az Autosave mellett:** rose-outline `matrix-header-dialog__delete` gomb. Folyamat: (a) kliens-precheck a **szűrők nélküli** MC-listán (`headerAllMessages`, bármilyen státusz) → ha van MC, `alert({variant:"warning", confirmLabel:"Cancel"})` a blokkolók listájával (`MC<szám><variant> — név — státusz`), csak Cancel; (b) ha nincs, `confirm({variant:"danger"})` → POST `hard-delete` (If-Match); (c) a szerver 409 `in_use` válasza (archivált MC-k, amiket a grid nem is töltött be) ugyanazt a warning-dialogot nyitja a szerver listájával. Meglévő `useAlertDialog()` infra, nem új dialog-komponens.
- **`referencedBy` szerződés-változás:** `number[]` → `BlockingMc[]` (`id, number, variant, status, name`), új közös `src/lib/entities/mc-refs.ts` (nincs import-ciklus a messages.ts-szel). Érinti: topics.ts, audiences.ts, entity-route.ts, DimensionEditPanel.tsx (csak típus), 2 teszt-assert.
- **(3) Legacy `Tag` mező kivéve a topic-formból:** a tag1–4 az, ami a Key-be generálódik; a sorszám nélküli `tag` ötödik, kulcs nélküli tagnek látszott. A DB-oszlop és a Topics-grid oszlopa marad (1 legacy sor tartalmaz értéket: topic 224).
- **Csatorna-sor bug (a 6.27.4 id-alapú lookup mellékhatása):** a nonDCO tengely channel-sorai a channels tábla id-jét hozzák → ütközhet valódi audience id-vel. A `headerDialog` state mostantól `{kind, id, channel}` és a lookup a channel-diszkriminátort is nézi; channel-sornál nincs Delete gomb (nem audience, nem törölhető azon a route-on).
- **Verifikáció:** `tsc --noEmit` exit 0, `npx vitest run` 585/585 zöld, `npm run build` exit 0, eslint 0 error. Component-inventory frissítve (`__delete`, `__blockers`).
- **Bump:** `6.27.4` → `6.28.0` (minor — új user-látható delete-akció + API-válasz alakváltozás). Deploy még nem történt meg.
- **6.28.1 (UI-nit, user):** a header-dialog Delete gombja a Close mellől a sor **elejére** (Autosave elé) került, és piros bordered gombból **szürke ikon-link** lett (`text-slate-500`, hover underline, `size-3` ikon) — destruktív akció ne legyen a Close felé vezető kurzor útjában, és a kisebb találati felület csökkenti a véletlen kattintást.
- **6.28.2 (dark-mode, user):** az edit-mode MC-kijelölés nem látszott dark-ban. Ok: a kijelölő gyűrű `ring-slate-900`, és a slate-900 családból (bg/border/text) **egyedül a `ring-` nem volt átkötve** a `globals.css` dark-remap blokkjában → fekete gyűrű fekete cellán. Fix: `html.dark .ring-slate-900 { --tw-ring-color: var(--text-primary); }` a `border-slate-900` mellé (`@layer utilities`, így a Tailwind saját utility-jét felülírja). Ugyanez javítja a Creative Library tile-kijelölést és a library drop-target gyűrűket is.

### 2026-08-30 — Asset batch upload (drag-drop + táblázatos overlay) — 6.29.0
- **User-panasz gyökere:** a drop handler CSAK az `assets-library__scroll` konténeren volt (`useDropTarget`), az „Upload asset" modal viszont z-50 backdroppal letakarja → a modalra ejtett fájlt a böngésző default módon megnyitotta új tabon. Ezért „nem működött" ott, ahol próbálta.
- **(1) Globális drop-guard:** `AppShell` document-szintű `dragover`/`drop` → `preventDefault`. Igazi drop-targetek működnek tovább (a React handler előbb fut, a listener csak a defaultot öli). Ez az, ami eddig kiugratta az appból.
- **(2) `useUploadQueue` hook** kiemelve az `UploadQueue.tsx`-ből (state gép: upload → metadata → commit, + új `updateMetadata` és `applyToAll`). A lebegő panel (`UploadQueue` default export) változatlanul ezt használja → **Creative Library nem változott**.
- **(3) Új `assets/AssetUploadDialog.tsx`:** 90vw×90vh modal (header-dialog méretek), soronként thumbnail (objectURL, revoke unmountkor) + fájlnév/méret/státusz/warning, 4 metadata oszlop (brand/product/type/keywords), sticky fejlécben **batch-sor** ugyanezekkel a mezőkkel + Apply (Enter is) → `applyToAll` csak a nem-üres mezőket írja rá a még szerkeszthető sorokra. Product/type `datalist` a meglévő értékekből. A dialog maga is drop-target, üres állapotban nagy dropzone.
- **(4) AssetsLibrary:** az Upload gomb és a rácsra dobás UGYANOTT köt ki (`droppedFiles` state → `initialFiles`). A régi egyfájlos `UploadDialog` + `AssetMetadataForm` + `QueueItemForm` + a csak ezekhez használt `Field` törölve az assets oldalról (a `UploadDialog` komponens marad a Creative Library-nek).
- **Verifikáció:** `tsc` 0, `npm run build` 0, `npx vitest run` 585/585, eslint 0 error. Component-inventory új szekció (`asset-upload-dialog`, `asset-upload-table`).
- **Bump:** `6.28.2` → `6.29.0` (minor — új user-látható feltöltő felület).

### 2026-08-30 — TERV: Dimenzió-kulcs újragenerálás + kaszkád (topic/audience rekey)
**Kiváltó ok:** két nap alatt kétszer kellett kézzel rekulcsolni (topic 261 `…individual`→`…valtscsapatot`, topic 266 `…150e`→`…120e`). Az `updateTopic`/`updateAudience` MC-guardja (`topics.ts:228`, `audiences.ts:257`) NÉMÁN kihagyja a kulcs-regent, ha bármelyik MC hivatkozik a kulcsra → a tag4 elmozdul, a kulcs nem, a PMMID pedig beégve viszi a régi kulcsot. A guard helyes; a némaság a hiba.

- [x] 1. `src/lib/message-identity.ts` — tiszta fv: PMMID + 7 trafficking oszlop db-oszlop alakban (`regeneratedIdentity` / `traffickingColumns`). Nincs db-import → nincs ciklus (a `mc-refs.ts` precedens).
- [x] 2. `createMessage` átkötése a helperre (tsc + tesztek)
- [x] 3. `copyMessages` átkötése (tsc + tesztek)
- [x] 4. `moveMessages` átkötése (tsc + tesztek)
- [x] 5. `updateMessage` átkötése (csak trafficking, PMMID marad) (tsc + tesztek)
- [x] 6. `writeAudit` `silent` opció → a kaszkád soronként auditál, de EGY broadcastot küld
- [x] 7. `src/lib/entities/rekey.ts` — `previewRekey` + `rekeyDimension("topic"|"audience")`, tranzakcióban
- [x] 8. Stale-kulcs jelzés: `listTopics`/`listAudiences` → `generatedKey` + `keyStale`
- [x] 9. `makeRekeyRoute` az `entity-route.ts`-ben + `/api/{topics,audiences}/[id]/rekey`
- [x] 10. `HeaderDetailDialog` — a read-only Key mező mellé stale-badge + akció + preview (régi→új kulcs, érintett MC-szám, minta-PMMID előtte/utána)
- [x] 11. Integrációs teszt (rekey + no-op másodszorra + guard-elutasítás)
- [x] 12. component-inventory + CHANGELOG + verzióbump

**Lezárt döntések (user: „close along your intuition"):**
- **Audit:** soronkénti audit-bejegyzés (MC-history megmarad) + EGY összevont SSE broadcast (nem 120).
- **Nem automatikus:** a guard marad, az akció explicit — a drift láthatóvá tétele volt a hiányzó darab.
- **Árvákat nem javít:** csak létező dimenzió kulcsát írja át; a 641 árva MC külön ügy.
- **Guard = „elszállt-e már?", nem „ACTIVE-e?"** — a 120 db ACTIVE MC336 rekulcsolása biztonságos volt, mert semmi nem fogyasztotta még a PMMID-eket. Elutasít, ha a régi kulcs szerepel egy **feltöltött** feed exportban, vagy ha van rá monitoring sor.
- **Történelmet NEM ír át** (korrekció az első vázlathoz képest): a `monitoring` sorok a platform-riportból parse-olt tények, ahogy a `feed_exports.payload_json` is — ezért ezek nem átírandók, hanem a guard részei. A guard miatt a kérdés amúgy is majdnem tárgytalan: ha semmi nem szállt el, monitoring sor sem létezhet a kulcsra.
- **Kulcs-ütközés:** nem suffixel némán (`_2`), hanem elutasít.

**Eredmény (2026-08-30):**
- **Új:** `src/lib/message-identity.ts` (tiszta PMMID+trafficking builder), `src/lib/entities/rekey.ts` (preview + kaszkád), `makeRekeyRoute` + `/api/{topics,audiences}/[id]/rekey`, `KeyField` a header-dialogban, `tests/integration/api/rekey.test.ts` (11 teszt).
- **Refaktor:** a „PMMID először, utána trafficking (utm_cd26 = {{PMMID}})" blokk **5 helyen** volt kimásolva (`createMessage`, `copyMessages`, `moveMessages`, `updateMessage`, `propagateToSiblings`) — mind az öt a közös helperre kötve, egyesével, tesztfuttatással a lépések között. A `propagateToSiblings` az ötödik példány volt, a tervezéskor csak hármat számoltam.
- **UI-gap javítva menet közben:** a stale-badge a `committed`-ből olvasott volna, amit a PATCH-válasz (nyers sor, `generatedKey`/`keyStale` nélkül) felülír → pont a tag-szerkesztés pillanatában tűnt volna el a jelzés. Most a lista-alapú `entity` propból olvas.
- **Verifikáció:** `tsc --noEmit` 0, `npm run build` 0, `npx vitest run` **596/596** (585 → +11), eslint 0 error a módosított fájlokon (3 pre-existing warning a HeaderDetailDialogban, nem az új kódban). Böngészős smoke a userre vár.
- **Bump:** `6.29.0` → `6.30.0` (minor: új user-látható akció + 2 új HTTP route + list-válasz bővülés). CHANGELOG + component-inventory frissítve. Nincs séma-migráció.
- **DEPLOYOLVA 6.30.0 (2026-08-30):** commit `4008914`, push origin main, box `/var/www/mm6-erste` git pull `4f98641`→`4008914` + `npm run build` (exit 0) + `pm2 restart mm6-erste` → **Ready 1477ms**. Séma-migráció nincs. Health: `/` 307, `/login` 200, `/mcp` 401, `/api/topics` 401, **`GET /api/topics/[id]/rekey` 401** és **`POST /api/audiences/[id]/rekey` 401** (az új route-ok élnek, nem 404). Böngészős smoke (stale-badge + preview dialog) még hátravan.

- **6.30.1 (UI-nit, user):** a header-dialog Key mezője **teljes szélességű**, alatta ugyanabban a mono betűtípusban a **generált kulcs** — a kettő karakterről karakterre összevethető, amit a két féloszlopos elrendezés pont nehezített. Az „out of date" badge kikerült; helyette a pár alatt egy sor magyarázza, mit csinál a Regenerate, mellette link-stílusú gombbal. A **„MC count" mező törölve** (audience + topic form): ugyanaz a szám ott van a jobb felső MC-léptető mellett `n/n` alakban. A `mcCount`/`uniqueMcCount`/`totalMcCount` plumbing is kivezetve. A Regenerate gomb kikerült a `Field` `<label>`-jéből (label nem foghat interaktív elemet).
- **DEPLOYOLVA 6.30.1 (2026-08-30):** commit `aea4a66`, push origin main, box `/var/www/mm6-erste` git pull `4008914`→`aea4a66` + `npm run build` (exit 0) + `pm2 restart mm6-erste` → **Ready 1353ms**. Séma-migráció nincs. Health: `/` 307, `/login` 200, `/mcp` 401, `GET /api/topics/[id]/rekey` 401. Böngészős smoke (teljes szélességű Key + generált kulcs összevetése + Regenerate preview) a userre vár.

- **6.30.2 (UI-nit, user):** a „Generated key" mező **szürkén jelent meg amber helyett** — az ok nem a szándék, hanem a Tailwind: a `clsx(readOnlyCls, "…bg-amber-50…")` két AZONOS rétegbeli utilityt tett egymás mellé (`bg-slate-50` vs `bg-amber-50`), és ilyenkor a stíluslap sorrendje dönt, nem a class-attribútumé. Most saját, explicit osztálylistája van (nincs merge), a labelje is amber (`Field` új opcionális `labelCls` propja). A gomb felirata `Regenerate` → **`Regenerate dependencies`**, amber tónusban.
- **DEPLOYOLVA 6.30.2 (2026-08-30):** commit `def87db`, box `aea4a66`→`def87db`, build exit 0, `pm2 restart mm6-erste` → **Ready 1341ms**. Health: `/` 307, `/login` 200, `/mcp` 401.

---

## Session 2026-08-30 — MC337a → MC294 átszámozás + tartalom a régi VAL feedből (TERV)

Forrás: `docs/Erste_Vallalkozo_2026 (0508).xlsx` (régi Adform VAL feed, 179 sor: MC1 default 101, MC293 76, MC294 2).
Cél-sor a mátrixban: **id 35943** — DCO, `MC337a`, audience `VAL_microlp`, topic `VAL_brand_bankvaltas_NA_rem120e`, status `PREVIEW`, minden tartalmi mező üres (a user előkészített helye).

### Feladat 1 — átszámozás + tartalom-feltöltés (VÉGREHAJTÁS)
- [x] **1.1** `number` 337 → 294. Szabad a DCO tengelyen (294-et csak a nonDCO `ch_soc`/`ch_disp` páros tartja `VAL_Remarketing_Erstes-leszek_120e_rem` topicban — cross-axis párosítás 6.17.0 óta engedett).
- [x] **1.2** `pmmid` + trafficking ÚJRAGENERÁLÁS `regeneratedIdentity()`-vel (`message-identity.ts`) — az `updateMessage` szándékosan NEM nyúl a pmmidhez, a szám viszont benne van (`-m_337-`), és az `utm_term` (`...!hu!337a`) + `utm_cd26` + `final_trafficked_url` is.
- [x] **1.3** Tartalmi mezők a feed aktív (2026-os, ADFPLAID 14234692) sorából:
  - `template` = `html`, `template_variant_classes` = `animated purple fullSurfaceColor objectGfx`
  - `headline` = `Legyél erstés vállalkozóként is!` (PLAIN — v6-ban egyetlen üzenet sem tárol HTML-t a szövegmezőben)
  - `copy1` = `Tedd meg az első lépést még most!` (PLAIN)
  - `headline_style` = `font-size:1.15rem;`, `copy1_style` = `font-size:0.9rem;`
  - `cta` = `Érdekel!`
  - `landing_url` = `https://www.erstebank.hu/hu/ebh-business/kisvallalkozasok/szamlak-napi-penzugyek/bankvaltas`
  - assets a `patterns.feed` map szerint (`image1`→bg1, `image2`→bg2, `image5`→brand, `image6`→sticker): `empty.png` / `erste_vallalkozo_object.png` / `EBH_Logo_screen_white.png` / `empty.png`, `image3` = `empty.png` (MC23/MC108 objectGfx konvenció), `video1` üres.
- [x] **1.4** A feed HTML-formázása NEM a mezőbe megy, hanem 2 `text_formatting` szabályba (exact-match, universal scope):
  - `Legyél erstés vállalkozóként is!` → `Legyél erstés<br> vállalkozóként is!`
  - `Tedd meg az első lépést még most!` → `Tedd meg az első <span style=white-space:nowrap>lépést még most!</span>`
- **NEM nyúlok hozzá:** `status` (marad PREVIEW), `start_date`/`end_date` (a régi feed 2025-02-02→2026-12-31 flight-dátuma lifecycle-állapot, nem tartalom), `name`, `audience`, `topic`.
- ⚠️ **Hiányzó asset:** `erste_vallalkozo_object` nincs az `uploaded_files`/`assets` táblában egyik kliensnél sem, és a lokális `~/ERSTE .../assets` mappában sincs. A `.png` kiterjesztés a többi `*_object.png` konvencióból következtetve. A feed-export így a helyes stringet adja, de az in-app preview addig nem oldja fel, amíg a fájl nincs feltöltve a media libarybe.

### Feladat 2 — audience-elemzés (CSAK ELEMZÉS, nincs írás)
- [x] **2.1** Régi feed MC294 audience-ei vs. mátrix VAL audience-ek — lásd lent.

**Módszer:** a pmmid `-a_...-` szegmens nem elég (a feed két névgeneráció keveréke: az MC1 default sor már az ÚJ `VAL_*` kulcsokat használja, az MC293/294 még a régi Adform-neveket). Megbízható join: **`AdformSignal:ADFPLAID` ↔ `audiences.lineitem_id`**.

**Eredmény — MC294 = 1 audience:**
| régi név | ADFPLAID | IsActive | DateFrom→DateTo | mátrix audience |
|---|---|---|---|---|
| `afwesegall` | 14234692 | TRUE | 2025-02-02 → 2026-12-31 | ✅ `VAL_microlp` — Landing Page Visitors (rem / websiteEvent / segment / all), **ACTIVE** |
| `afwesegall` | 12994656 | FALSE | 2025-02-02 → 2026-12-31 | ❌ nincs — ez a 2025-ös kampány (`mID25-00101`) line itemje, ugyanaz az audience, leváltva a 2026-osra (`mID26-00016`) |

- A 2 feedsor tehát **ugyanaz az egy audience**, csak két kampányévvel. Élő audience-szám: **1**.
- Ez pontosan az az audience, amire a user a helyet (MC337a) előkészítette → a placement stimmel, nincs mit pótolni.
- **Kontroll (MC293, a prospecting kártya): 19/19 audience megvan** a mátrixban (`afadwlall`→`VAL_adaptive`, `afafwldtfindsk`→`VAL_wlfin-findsk`, `afdgsegallincome`→`VAL_wldigiseg-income` stb.), 0 hiányzó. Az audience-migráció tehát teljes volt — a régi feedben nincs olyan VAL audience, ami kimaradt.
- **Struktúra:** MC293 (19 pro audience) és MC294 (1 rem audience) diszjunkt — `VAL_microlp` NEM szerepel MC293-ban. MC294 a VAL termék **egyetlen remarketing kreatívja** volt, és a `VAL_microlp` az egyetlen ACTIVE `rem`-stratégiájú VAL audience (a `VAL_microtarasaslp` INACTIVE, nincs line itemje).

### Végrehajtva
Egyszeri script (`scripts/renumber-337-to-294.ts`, dry-run → `--commit`, futás után törölve — nem újrahasznosítható művelet). Utána `version` 3→4 kézzel (az optimistic lockot a direkt UPDATE nem emelte volna, egy nyitott böngészőfül elavult verzióval felülírhatta volna).

**Eredmény (id 35943):** `MC294a` · `VAL_microlp` · `VAL_brand_bankvaltas_NA_rem120e` · PREVIEW · `html` + `animated purple fullSurfaceColor objectGfx` · pmmid `p_adform-s_rem-a_VAL_microlp-m_294-t_VAL_brand_bankvaltas_NA_rem120e-v_a-n_1` · utm_term `con!adform!VAL_microlp!...!hu!294a`. 2 új `text_formatting` szabály (id 228, 229).

**Nyitott:** `erste_vallalkozo_object.png` fel kell tölteni a media libarybe (a mezőben már benne a hivatkozás, a feed-export helyes stringet ad, de a preview addig nem oldja fel). Nincs kódváltozás → nincs verzió-bump.

### 2026-08-30 — Státusz-darabszám a szűrőben (D1) + tree platform-szín (I3) — 6.31.0
- **Előzmény:** a user négy ötletet adott (dashboard-felújítás, komment-thread, tree platform-színek, státusz-darabszám). Mind a négy felmérve (kód + prod DB), a döntések lezárva, a tervek a **💡 Ötlet-inbox** szekcióban. A user a két kicsit engedte el elsőnek.
- **D1 ✅ — státusz-darabszám a Status-szűrőben.** `MultiPill` új opcionális `optionCounts` propja (`ml-auto text-xs tabular-nums text-slate-400`, `multi-pill__count`) — az `optionColors` színpötty mellé, ugyanabba az opció-sorba. A `MatrixGrid` `filtered` useMemója számolja és adja tovább a toolbaron át.
  - **A számolás helye a lényeg:** a státusz-szűrőt **átmozgattam a search-szűrő MÖGÉ**, és a darabszámot a kettő közt veszem — minden más szűrő (product, axis, hide-inactive, search) érvényes, a státusz-szűrő még nem. Utána számolva minden kiválasztott státusz csak önmagát számolná, a kiválasztatlanok meg mind 0-t mutatnának. A státusz és a search független sor-predikátumok, ezért a sorrendcsere azonos `msgs` halmazt ad — a viselkedés nem változik.
  - A `DimensionGrid` Status-pillje nem ad `optionCounts`-ot → ott nincs szám (a prop opcionális).
- **I3 ✅ — tree-node színezés platform szerint** (user-döntés: platform, „mert az a kisebb egység"; **csak szín, strategy-vastagság nem**).
  - `buildTree`: az `AggNode` gyűjti a node alatti distinct `buyingPlatform`-okat; a `TreeNode` **csak akkor** kap `platform`-ot, ha pontosan egy van. Kevert vagy platform nélküli részfa → nincs mező, a node marad a mélység-színénél — így a „nincs szín" sosem olvasódik platformnak.
  - `TreeView`: pontosan EGYIK osztályt adja rá (`--plat-*` VAGY `--lvl-*`), nem kettőt egymásra — nincs specificitás-játék, a `border-left` shorthand tisztán felülíródik.
  - **Szín-forrás egy helyre:** a két hex kétszer szerepelt a `globals.css`-ben (alsó- és jobb-él variáns), a platform→szín elágazás pedig be volt drótozva a `GridView`-ba. Most a **`--plat-dv360` / `--plat-adform` CSS-változó** az egyetlen hely, ahol a szín él, és **`matrix/types.ts` `PLATFORM_TOKENS`** az egyetlen hely, ahol az dől el, melyik platform-string kap színt. A `platformToken()` trimmel + kisbetűsít (a `buyingPlatform` szabad szöveges mező) — ez szigorú bővítés, a mátrix-header vizuálisan nem változott.
  - **Adat-tény:** a prod DB-ben ma **csak két** platform-érték él (adform 105, dv360 68, null 7) — youtube/meta nincs. Ezért a Settings-szintű szín-szerkesztés kimaradt: új platform ma **egy sor** a `PLATFORM_TOKENS`-ben + egy var. Ha tényleg állítgatni kell, az külön slice (új oszlop + migráció).
  - Menet közben javítva egy **elavult CSS-komment**: a tree-blokk egy `LEVEL_COLORS` tömbre hivatkozott a `TreeView.tsx`-ben, ami nem létezik (a MiniMap saját flat `nodeColor`-t fest).
- **Verifikáció:** `tsc --noEmit` 0, `npm run build` 0, `npx vitest run` **599/599** (596 → +3 új `build-tree` teszt: egységes platform öröklődik felfelé; kevert részfa nem kap platformot, de az alatta lévő egységes node igen; platform nélküli fa érintetlen), eslint 0 error a módosított fájlokon. **Böngészős smoke a userre vár** (tree platform-csíkok + státusz-számok).
- **Bump:** `6.30.2` → `6.31.0` (minor — két user-látható feature). CHANGELOG + component-inventory frissítve. Nincs séma-migráció.
- **⚠️ Menet közben:** a HEAD elmozdult (`def87db`, 6.30.2 a userre) — a `-42` sor a todo.md diffben a saját, commitolatlan v1 ötlet-blokkom lecserélése v2-re, nem elveszett tartalom.

### 2026-08-30 — MC335→398, MC336→399 renumber (DCO tengely) — adatjavítás
**Kérés:** a DCO kampány-kártyák MC335/MC336 száma ütközik az azonos számú analóg (nonDCO) MARKET témákkal; írjuk át őket. Első javaslat 340/341 volt, de azok a nonDCO tengelyen foglaltak (MARKET_GoApp 340c, SZA_Szamlanyitas 341a) → user döntés: **398 / 399** (a kliens max MC-je 397, tehát mindkét tengelyen szabad).

**Scope (user által megerősítve):** csak a **DCO** oldal mozdul.
- `SZA_beerste_bankvaltas_NA_valtscsapatot` MC335 a–i, 216 sor (ACTIVE, a c variáns INACTIVE) → **MC398**
- `VAL_beerste_bankvaltas_NA_valtscsapatot120e` MC336 a–f, 120 sor (ACTIVE) → **MC399**
- Az analóg `MARKET_MCx_f_genZbefektetes_2026Q1` (335) és `MARKET_MCx_genZbefektetes_2026Q1` (336) **marad**.

- [x] 1. `scripts/renumber-mc-dco.ts` — dry-run alapértelmezett, `--commit` ír
- [x] 2. Blokkoló-ellenőrzés futás közben: cél-szám foglaltság a DCO tengelyen, feltöltött feed export, monitoring sor
- [x] 3. Dry-run + PMMID before/after minta bemutatása
- [x] 4. `--commit` egy tranzakcióban: `number` + `pmmid` + 7 trafficking oszlop + `version+1` + audit sor MC-nként
- [x] 5. Utóellenőrzés SQL-lel, script törlése (egyszeri művelet)

**Előzetesen ellenőrzött tények:** `monitoring` 0 sor a 335/336-ra; `prodlist_rows` 0 sor; a `creatives` 32 rekordja mind az *analóg* MARKET fájlokhoz tartozik (`ERSTE_MARKET_MC335_a_...`), a DCO kártyákhoz egy sem → creative-link nem szakad el (sőt, a mai téves (mc_number,mc_variant) egyezés megszűnik). 3 feed export (SZA v1, v1, v2) tartalmaz `-m_335-`-öt, de **egyik sincs Adformra feltöltve** → nem blokkoló; a payloadot nem írjuk át (shipped-history invariáns), a következő exportnál újragenerálódik.

### Végrehajtva
Egyszeri script (`scripts/renumber-mc-dco.ts`, dry-run → `--commit`, futás után törölve — a `renumber-337-to-294.ts` precedensét követve). A `number` szándékosan nem writable mező (`WRITABLE_FIELDS`), ezért nincs támogatott app-útvonal; a script a `entities/rekey.ts` mintáját másolja: ugyanazok a blokkoló-ellenőrzések, ugyanaz a „regeneráld az identitást, de a leszállított history-t soha ne írd át" szabály, MC-nként audit sor.

**Kulcs-kontroll a commit előtt:** mind a 336 sorra lefuttattam a `regeneratedIdentity`-t **változatlan** számmal, és a 8 generált oszlop (`pmmid` + 7 trafficking) **bitre azonosan** reprodukálódott a tároltakkal. Tehát nem volt előzetes pattern-sodródás, amit a javítás csendben behúzott volna — a commit tényleg csak a számot és a belőle képzett részstringeket írta át.

**Eredmény:** 336 sor. `MC335 → MC398` (SZA_beerste_bankvaltas, a–i, 216 sor), `MC336 → MC399` (VAL_beerste_bankvaltas120e, a–f, 120 sor). Pl. `p_adform-s_pro-a_SZA_adaptive_IDF-m_398-t_SZA_beerste_bankvaltas_NA_valtscsapatot-v_a-n_1`, utm_term `...!hu!398a`. 336 audit sor, `version` mindenhol +1. Utóellenőrzés: 0 maradék `m_335`/`m_336` a mozgatott sorok generált oszlopaiban; a 335/336 mostantól kizárólag az analóg MARKET témáké. Adat-only javítás, nincs kódváltozás → **nincs verzió-bump**.

**⚠️ Nyitott — még 20 szám ütközik keresztbe a két tengelyen**, köztük a szomszédos `332` (SZK_emlkezteto ↔ SZK_remarketing) és `334` (SZK_edukacio ↔ MARKET_MCx_e_genZbefektetes), valamint 5, 124, 131, 134, 141, 290, 294, 301, 302, 311, 316–321, 330, 331. A tengelyenkénti számozás ezt megengedi (a DCO kártya és a statikus nonDCO ikre szándékosan oszthat számot), de ha a cél a globálisan egyedi MC-szám, ez külön kör. A `MARKET_MCx_*_genZbefektetes` sorozat amúgy is szét van szórva: b=396, c=397, d=333, e=334, f=335, alap=336.

### 2026-08-30 — MC-ütközés riport (`docs/mc-collisions.html`)
**Kérés:** gyűjtsük ki az ütközéseket egy statikus HTML-be a `/docs`-ba, a DCO bannereket statikban megépítve, képekkel, 3 oszlopos táblázatban, az ütközés természetének magyarázatával.

- [x] `scripts/gen-collisions-doc.ts` — **megtartva** (a `renumber-*` scriptektől eltérően ez csak olvas: újrafuttatható riport-generátor, ahogy az ütközések fogynak). Dev szerver kell hozzá.
- [x] 20 DCO banner renderelve az app saját pipeline-jával (`shootItems` → `templates/html`, 300×250, headless Chromium) — nem külön reimplementáció, ugyanaz a kód fut, mint a preview-knál. **A `message_previews` táblához nem nyúl**, a PNG-t a saját `persist` callback kapja el.
- [x] Statikus kreatívok az objektumtárból (`readFileBytes`), `sips`-szel 440px-re kicsinyítve; minden kép **data URI-ként beágyazva** → a 2.6 MB-os fájl hálózat nélkül is megnyílik.
- [x] Böngészős ellenőrzés (Playwright screenshot, 1440px).

**Az ütközések természete — 3 kategória, nem egy:**
- **Szándékos ikerpár (18)** — ugyanaz a kampány két formában; a DCO kártya és a statikus kivágata. A közös szám itt *helyes*, a tengelyenkénti számozás pont ezt engedi meg. A 316–320-nál a kötés a legszorosabb: a DCO háttér maga a statikus precompja (`precomp_ERSTE_MC316_a_..._n7.png`, `preCompBg`).
- **Valódi ütközés (3)** — két nem összetartozó kampány: **MC5** (VAL Társasházi Számlacsomag ↔ HITEL Babaváró), **MC302** (SZK bankváltás ↔ SZA online számlanyitás — itt *mellette* van egy szabályos iker is), **MC334** (SZK kamatkedvezmény ↔ MARKET genZbefektetes). Ez ugyanaz az eset, mint a ma javított 335/336.
- **nonDCO duplikáció (2)** — **MC290** és **MC321**: ugyanaz a statikus kreatív kétszer importálva, két téma alatt (`HITEL_*` és `SZK_HITEL_a_*`). Ez nem tengelyek közti ütközés, hanem kétszeres import; érdemes a kettőt együtt rendezni.

**Menet közbeni észrevétel:** a **DCO MC332c** a vizsgálatkor a 332a szó szerinti klónja volt (ugyanaz a headline, flash, class, sőt a 332**a** háttérképe), miközben a valódi 332c más felépítésű kreatív (teal színfelület + kivágott objektum, „Akár 15M Ft kölcsön nagyobb terveidhez is."). **A user ezt közben maga javította az appban** (16:02 UTC) — a riport már a javított állapotot tükrözi. Nem én írtam.

**Nincs verzió-bump:** új doksi + egy `scripts/` riport-generátor, a futó appot nem érinti.

### 2026-08-30 — Társasház DCO kártya: MC5 → MC78
**Kérés:** a DCO MC5 (VAL Társasházi Számlacsomag) kapjon új számot, mert a HITEL Babaváró statikussal ütközött. Első kör: „keressünk lukat 100 alatt" → MC10. Utána user-korrekció: **MC78**, mert a kártya eredetileg is a meglévő statikus `ERSTE_VAL_MC78_b_Tarsashaz_szamla_pro_b` DCO párja akart lenni, csak sosem készült el.

- **Végrehajtva:** `scripts/renumber-mc-dco.ts` (újra megírva és **most megtartva** — másodszor kellett; a `MAP=from:to` env paraméterezi). 5→10, majd 10→78; mindkettő 3 sor (a,b,c variáns, `VAL_wldigiseg-realestate`, INCOMING). Blokkoló egyik lépésnél sem volt.
- **Kontroll:** az 5→10 után diffeltem a 8 generált oszlopot úgy, hogy a régi számot előbb kicseréltem az újra — **identikus**, tehát csak a szám és a belőle képzett részstringek mozdultak.
- **Eredmény:** MC5 mostantól kizárólag a HITEL Babaváró statikusé. MC78 = szándékos ikerpár: DCO a/b/c (`VAL_feature_tarsashaz_szamlacsomag_`) + a meglévő statikus b (`VAL_Tarsashaz_szamla_pro_b`, 4 creative fájl). MC10 újra szabad.
- **Mellékhatás, ami jó:** a 6 HITEL Babaváró creative (`mc_number=5, mc_variant=c`) eddig tévesen egyezett a DCO MC5c cellával — ez megszűnt.
- **Számtér-tény 100 alatt:** csak **10, 11, 12** volt teljesen szabad (mindkét tengelyen). Minden más 100 alatti „szabad" szám csak a DCO tengelyen szabad — azokra átírni új keresztirányú ütközést csinálna.

### 2026-08-30 — MC302: megvizsgálva, NEM írjuk át (blokkolt)
**Kérés:** a DCO MC302 mehetne-e valamilyen 300-as sorozatú számra.

**Van luk** a 300-as tartományban: **300, 312, 353** teljesen szabad. **De a DCO MC302-t nem szabad átírni** — a script blokkolja, jogosan:
- **Feed export #8 (SZK, v0) 2026-05-03-án fel lett töltve Adformra**, és tartalmazza a DCO 302 pmmid-jét → az átírás hazuggá tenné a leszállított feedet.
- **540 monitoring sor** ül a 302-n, ebből **529 pontosan a DCO témára** (`SZK_felhaszcelja_..._bankvaltasAdossagrendezes`, b: 273, c: 256) — valós beérkezett riportadat, ami árván maradna.

**A fontosabb felismerés: nem a DCO oldal a hibás.** A 302-n a **nonDCO tengelyen két külön téma** ül — `SZK_bankvalats_hitel` (a,b,c, 6 sor, a DCO kártya szabályos statikus ikre) és `SZA_onlineszamla_2026Q1_fullImageSurface` (a–e, 10 sor, a betolakodó). Egy tengelyen belül egy szám **soha nem léphet át témát** — a rendszer saját szabálya sérül itt, nem a DCO↔nonDCO ikerpár a baj.

**Javaslat (user döntésére vár):** az `SZA_onlineszamla_2026Q1_fullImageSurface` menjen új számra (10 sor, 11 monitoring sor a `onlineszamla_q2` témán, + 56 SZA-nevű creative `mc_number`-ét vinni kell vele), ne a 91 soros, leszállított DCO kártya. Ehhez **nonDCO-tengelyes renumber kell** — a mostani script csak a DCO tengelyt kezeli, és a `creatives.mc_number` átírását sem csinálja. A rokon SZA online számla kártyák: 296, 368–372, 375 — nincs szoros szomszédsági kényszer.

**Döntés (user, 2026-08-30):** az MC302 **marad** — „két külön productban van, nem baj, és a DCO része már inaktív". Helyette magyarázó komment került mind a **107** MC302 sorra (mindkét tengely: 91 DCO + 6 SZK statikus iker + 10 SZA online számla):

> Átálláskor keletkezett azonos MC: a 302 két különböző productban fut — SZK bankváltás/adósságrendezés (DCO, INACTIVE, + statikus ikre) és SZA online számla (statikus). Szándékos, nem javítandó. Átírni amúgy sem lehetne: a v0 SZK feed 2026-05-03-án felment Adformra, és 529 monitoring sor hivatkozik rá.

- Egyszeri script (`scripts/_set-mc302-comment.ts`, dry-run → `--commit`, futás után törölve). **Csak a `comment` mezőt írja** — a komment egyetlen patternbe sem folyik bele (a pmmid/trafficking az audience/topic/number/variant/versionNo/landingUrl-ből épül), így a 107 élő sor UTM-oszlopait nem bolygattuk meg fölöslegesen. Ellenőrizve: mind a 107 pmmid változatlanul `-m_302-`.
- A `version` viszont **emelve** (1→2), hogy egy nyitott szerkesztőfül elavult verzióval ne írhassa felül a kommentet.
- A script visszautasítja a futást, ha bármelyik soron már van komment (appendelés emberi döntés) — most mind a 107 üres volt.
- `docs/mc-collisions.html` frissítve: a 302 sora most rögzíti, hogy megvizsgált és **elfogadott** eset, a blokkoló okokkal együtt.

### 2026-08-30 — MC334 (genZ „e" statikus) → MC312, fájlnevekkel együtt
**Kérés:** az utolsó tengely-ütközés (334: DCO `SZK_edukacio_NA_NA_kamatkedvezmeny` ↔ nonDCO `MARKET_MCx_e_genZbefektetes_2026Q1`) feloldása; új szám a 300-as tartományból, és a fájlnév átírása a DB-ben **és** a Drive-on (`~/GoogleDrive/Data/ERSTE HU/MARKET/Future befektetés - GenZ`) — leadás fájlok + source PSD.

**Választott szám: MC312** (300, 312, 353 volt a három teljesen szabad a 300-as tartományban).

- **DB:** 2 `messages` (number + name + image1 + pmmid/trafficking regenerálva), 7 `creatives` (mc_number + file_name), 7 `uploaded_files` (filename + original_filename). Az objektumtárhoz **nem** nyúltunk — a storage key content-hash, a fájlnév csak metaadat.
- **Drive:** 7 leadás fájl + a source PSD átnevezve.
- **Második kör (user):** a fájlnevekből ki az `_a_MCx` rész → `ERSTE_MARKET_MC312_e_genZbefektetes_2026Q1_n1_<méret>.jpg`. Mind a 7 név egyedi marad (a méret különbözteti meg). Ugyanez a DB-ben, **csak az MC312-es szettre szűkítve** (az első lekérdezésem az egész genZ sorozatot elkapta volna — 42 fájlt 7 helyett).
- **PSD (user-döntés):** `ERSTE_MARKET_e_...psd` → `ERSTE_MARKET_MC312_e_genZbefektetes_2026Q1_fullImageSurface.psd`. A genZ PSD-kben eredetileg **nem volt** MC-szám (a `vagyonkezelés` mappában van, a `BefCast`/`Go`-ban üres `MC_` placeholder — nincs egységes konvenció).

**⚠️ Következmény, amit tudni kell:** a fájlnév-séma `ERSTE_<PRODUCT>_MC<n>_<variáns>_<kampány>_n<k>_<méret>`. Az `_a_` törlésével a **sorozat-betű (`e`) csúszott a variáns-helyre**, miközben a DB-ben a `variant`/`mc_variant` továbbra is **`a`**. A creative↔cella kötés az oszlopokból dolgozik, nem a fájlnévből, tehát ma jól működik — de a `scripts/scan-creatives.ts` a **fájlnévből** parse-olja a variánst, így egy újraszkennelés `e`-t vezetne le és nem találna rá az `a` sorra. Ha ez a szándékolt végállapot, a `variant`/`mc_variant` oszlopot is `e`-re kell vinni.

**Új lelet a riportban:** a `creatives` táblában egy `(mc_number, mc_variant)` páron **két különböző kampány** fájljai is ülhetnek — a Drive két külön mappájából (`Future befektetés - GenZ` vs `vagyonkezelés`, `BefCast` vs `3D_icon`/`agrarcsalad`). Ez nem tengely-ütközés, hanem creative-szintű átfedés; külön szekciót kapott a riportban. Az első, naiv detektálásom 28 sort dobott, aminek a nagy része hamis (`..._badge`, `...-promo-2`, `..._fullImageSurface` ugyanannak a kampánynak a névváltozatai) — szigorítva: a rendition-jelölő tokenek (`creative`, `asset`, `image`, `only`) kiesnek, és két kampány csak akkor számít külön kampánynak, ha egyik token-halmaza sem tartalmazza a másikat és az első tokenjük is eltér. Így **24 jelölt** maradt, és a riport kimondja, hogy ez **jelöltlista, nem ítélet**. A szemmel is egyértelmű valódi esetek: `BeErste3`↔`WIZZAIR` (MC287), `diakszamla`↔`munkashitel` (MC288, MC289), `genZbefektetes`↔`tengeri_hajozas`/`jazz_piknik` (MC333, MC335), `MCx_BefCast`↔`3D_icon`/`agrarcsalad` (MC337, MC338).

### 2026-08-30 — MARKET konszolidáció: genZ → MC312 a–f, BefCast → MC300 a,b
**Előzmény:** a PSD-nevek árulkodóak — a `vagyonkezelés` mappa PSD-iben **van** MC-szám (`ERSTE_MARKET_MC333_a_tengeri_hajozas_n1.psd`), a `BefCast` és a genZ PSD-kben **nincs** (`ERSTE_MARKET_MC_a_BefCast…`, `ERSTE_MARKET_a_genZ…`). Vagyis a vagyonkezelés az eredeti tulajdonos, a másik kettő betolakodó. **User-döntés:** egy kampány = egy MC-szám, a renderek variánsok.

- **genZ:** 336a→**312a**, 396a→312b, 397a→312c, 333a→312d, 312a→312e, 335a→312f. Közös téma: `MARKET_genZbefektetes_2026Q1`.
- **BefCast:** 338a→**300a**, 337a→300b. Közös téma: `MARKET_BefCast_2026Q2`.
- **Érintetlen** (a vagyonkezelés visszakapta a számait): 333b tengeri_hajozas, 335b jazz_piknik, 337b 3D_icon, 338b buzakalasz, 338c agrarvallakozo.
- **Volumen:** 16 message (szám + variáns + téma + name/image1 + pmmid/trafficking), 60 creative, 60 uploaded_file, 60 Drive-fájl, 7 PSD.
- **Nem hoztam létre `topics` sorokat:** a nonDCO témák 230-ból 226 esetben amúgy sem léteznek sorként, csak string-hivatkozások — sorok gyártása itt lenne a kilógó eset.
- Minden `creatives`/`uploaded_files` egyezés **fájlnév-prefix** szerint szűrve, sosem puszta `mc_number` alapján — különben a vagyonkezelés fájljai is elmozdultak volna ugyanarról a számról.

**⚠️ Saját hiba, javítva:** a Drive-átnevező bash függvényemben egyetlen sorban írtam `local b="${f##*/}" t="…${b#$op}"` — zsh-ban `b` a `t` kiértékelésekor még az **előző iteráció** értékét tartja, így az első fájl neve a puszta prefixre csonkolt, a többi pedig eggyel eltolódott. Nem veszett el fájl (42 + 18 megvan). Helyreállítás **tartalom-hash alapján** (`uploaded_files.sha256`), két menetben (előbb ideiglenes névre, hogy az ütközések feloldódjanak) → **60/60 fájl neve egyezik a DB-vel**. A PSD-k (nincs hash a DB-ben) a csonkolt névben megőrzött betűjel alapján álltak helyre. Tanulság: külön sorban deklaráld a köztes változót, és a rename után **mindig** auditálj.

**⚠️ Nyitott:** a helyben maradt vagyonkezelés-sorok témája még a régi, félrevezető nevet viseli (MC333b `tengeri_hajozas` a `MARKET_MCx_d_genZbefektetes_2026Q1` témában, MC337b/338b/338c a `MARKET_MCx_*BefCast` témákban). A user azt kérte, ezek maradjanak — a **számuk** maradt is, de a téma-nevük külön kört érdemel.

### Riport-átépítés
- **4 fül** a tetején: Szándékos ikerpár (19) · Valódi ütközés (1) · nonDCO duplikáció (2) · Creative-átfedés (20). Sima JS, panel-váltás `hidden`-nel. Egy sor több fülön is megjelenhet (a 302 ikerpár **és** ütközés).
- **A creative-átfedés szekció most képes:** kampányonként egy reprezentatív kreatív (a négyzetes 1080x1080-at preferálva) az objektumtárból, 260px-re kicsinyítve, data URI-ként beágyazva. Így ránézésre látszik az ütközés — pl. MC159-nél két Személyi kölcsön kreatív mellett egy **Erste Max Hitelkártya**.
- A riport 4,4 MB, továbbra is önálló fájl.

### 2026-08-30 — Feed export: DEFAULT sor label-javítás + clickTAG DEFAULT-osítás (6.32.0)
- **Tünet:** feed 35 (SZA) DEFAULT sorában a `Text:pmmid` és a `ReportingLabel` megtartotta a valódi audience key-t (`-a_SZA_rtg-allvisitors_IDF-`), nem lett `-a_DEFAULT-`. Feed 30-ban ugyanaz a termék még jól működött.
- **Gyökérok:** `feed-export.ts` → `applyDefaultLabelTransforms` regexe `/(-a_)[^-]*(-m_)/` volt. A `[^-]*` nem tud átlépni az audience key-ben lévő kötőjelen (`SZA_rtg-allvisitors_IDF`), így a csere némán nem talált. A `-l_\d+ → -l_ANY` csere közben lefutott, ezért tűnt úgy, hogy „félig" működik. A 30-as export default üzenetének audience key-e (`SZA_afrtsegallvisitors`) kötőjel nélküli volt.
- **Fix:** lusta illesztés `/(-a_).*?(-m_)/` — ugyanaz a minta, amit az `adform-snapshot.ts` már használ (`/-a_(.+?)-m_/`).
- **Teszt:** `tests/unit/feed-default-labels.test.ts` — 7 eset (label: sima key / kötőjeles key / `-l_` szuffix; URL: utm_cd26, utm_term, érintetlen utm_campaign+utm_source, nem-egyező key = no-op).
- **clickTAG is átírva (user-döntés, új viselkedés):** a DEFAULT sor trafficking URL-jében eddig — a v5-ben és az élő Adform fájlban is — a donor audience key ült, így egy fallback-kattintás az analyticsben megkülönböztethetetlen volt a donor saját sorára érkező kattintástól. Mostantól két helyen DEFAULT: az `utm_cd26` PMMID-jében (`-a_<key>-m_`) és az `utm_term` önálló tokenjében. **Szándékosan érintetlen:** `utm_campaign` / `utm_source`, mert azok `audiences[<key>].Field` lookupok — nincs DEFAULT nevű audience sor, átírva üres paraméterek mennének ki.
- Kis/nagybetű: mindenhol nagybetűs `DEFAULT` — az `adform-snapshot.ts:105` pont erre a stringre szűri ki a sentinel audience-t visszaimportáláskor.

**DEPLOYOLVA 6.32.0 (2026-08-30):** két commit ment ki egy passzban — `2aab359` (a commitolatlanul állt 6.31.0: status-filter countok, tree platform-színek, `--plat-*` tokenek, + a MARKET-session két one-off scriptje) és `36cf83c` (ez a feed-fix). Box `def87db`→`36cf83c`, `npm run build` exit 0, `pm2 restart mm6-erste` → **Ready 1470ms**. Séma-migráció nincs. Health: `/` 307, `/login` 200, `/mcp` 401, `/api/feed-exports` 401; publikus `https://erste.messagingmatrix.ai/login` 200.
**Hátravan:** a feed 35 (SZA) újraexportálása — a most kint lévő sor mindkét hibát viszi (donor audience key a pmmidben/ReportingLabelben és a clickTAG-ben).

### Riport-bővítés — DCO kereszthivatkozások + dokumentáció
- **A creative-átfedés kártyák mellé jobbra zárt referencia-blokk** került, két kérdésre válaszolva: (1) *van-e DCO kártya ezen a számon* — tiszta DB-lekérdezés; (2) *a képen olvasható szöveg alapján melyik DCO MC-nek ugyanez a headline-ja*.
- **OCR:** a generátor lefordít egy pici Swift programot (`OCR_SWIFT` → `swiftc` → temp), ami az Apple **Vision** `VNRecognizeTextRequest`-jét használja (`hu-HU` + `en-US`), és az **eredeti méretű** kreatívokon fut. Nem kellett külső függőség — se tesseract, se Python csomag.
- **Normalizálás:** NFD + ékezet-eldobás + kisbetű + nem-alfanumerikus → szóköz. A felismerő rendszeresen elhagyja az ékezetet („almaid"), ékezet-érzékeny összevetés semmit nem találna.
- **Küszöb, ami nélkül használhatatlan:** headline csak akkor vesz részt, ha normalizálva ≥20 karakter **és** ≥4 szó. Enélkül a „Személyi Kölcsön" a fél SZK termékvonalra illeszkedett — **946 találat** jött ki; a küszöbökkel **60**. Kártyánként max 6 tétel látszik, a többi „+N további".
- **Valódi leletek:** az MC171 statikus (`gamertech`) szövege a DCO **MC271**-re illeszkedik; az MC287 (`BeErste3` + `WIZZAIR`) szövege a ma átszámozott **MC398**-ra („Válts csapatot, legyél erstés!", ACTIVE). A „szám szerinti" oszlop többnyire üres — a 8 átfedő számból 6 nonDCO-only, csak a 301/302 érinti a DCO oldalt.
- **`docs/mc-collisions.md`** — kísérő dokumentáció a riport mellé: újrafuttatás egy paranccsal, mit tekint ütközésnek (tengely-definíció, a három `NOTES`-kategória, a creative-átfedés heurisztikája a rendition-szűrővel), hogyan működik az OCR-es kereszthivatkozás a küszöbökkel, honnan jönnek a képek, gyorsítótár, és a már megfizetett buktatók (fájlnév-prefix szerinti szűrés, Drive-rename audit, nonDCO témák nem `topics` sorok).
- **Feljegyezve a jövőre:** a fájlnév `ERSTE_<PRODUCT>_` prefixe erősebb jel a kampány-tokennél — ha két külön termék fájljai ülnek egy számon, az biztos találat. A generátor ma nem használja szűrésre; ez a következő szigorítás helye.

### Product tag a creative-átfedés kártyákon
Minden kampány-thumbnail alatt, a fájlszámláló sor **bal oldalán** termék-címke (`SZK` `SZA` `HK` `HITEL` `VAL` `MARKET` `LTP`), a fájlnév `ERSTE_<PRODUCT>_` prefixéből — vagyis abból, amihez az adott MC ténylegesen parse-olódik. Termékenként saját szín; ismeretlen termék semleges szürkét kap (nincs `.product-tag--*` osztály → a `.product-tag` alap háttere marad), tehát új termék nem töri el a riportot. 62 címke a 20 kártyán.

Ettől egy pillantásra látszik a kemény eset: **MC287** = `SZA` + `HK`, **MC302** = `SZA` + `SZK`. A `docs/mc-collisions.md` frissítve — a korábbi „ezt a generátor nem mutatja" megjegyzés helyére pontos leírás került: a termék **látszik**, de a jelöltlistát továbbra is a kampány-token heurisztika állítja elő, a termék-alapú szigorítás a következő lépés.

### 2026-08-31 — nonDCO státuszok kiosztása
**Kérés:** minden nonDCO (statikus) kreatív kapjon státuszt — idei dátumúak `ACTIVE`, régebbiek `INACTIVE`, ne maradjon státusz nélküli.

- **A dátum forrása a lényeg:** `creatives.created_at` (amit a `scripts/fix-creative-dates.ts` a valódi fájldátumból töltött fel), **nem** a `messages.created_at` — az utóbbi az egységes 2026-08-17-i import-időbélyeg, azzal minden sor ACTIVE lett volna. Ellenőrizve: a legkésőbbi kreatív-dátum 2026-08-13, tehát nincs import-szennyeződés.
- **A join fájlnév szerint** (`messages.name = creatives.file_name`), nem `(mc_number, mc_variant)` alapján — az a pár kampányok és tengelyek közt osztott. Mind a 688 nonDCO sor pontosan illeszkedett, egy sem maradt dátum nélkül (a script kilép, ha bármelyik nem talál dátumot — így nem tud „none" státuszú sor keletkezni).
- **Eredmény:** 676 sor kapott státuszt → nonDCO összesen **374 ACTIVE / 314 INACTIVE**, 0 üres. Kereszttábla: 2024 → 56 INACTIVE, 2025 → 258 INACTIVE, 2026 → 373 ACTIVE.
- **Csak az üres státuszúakhoz nyúltam.** A 12 már beállított sort békén hagytam; ezek közül **egy tér el a szabálytól**: MC290a `HITEL_kerdoiv_hitelvalaszto_hiteltinder_1` `ACTIVE`, pedig a kreatívja 2025-10-28-i. Szándékosan nem írtam felül — emberi döntés volt, és a testvérsora (2026-os) is ACTIVE. Ha kell, egy paranccsal átbillenthető.
- Egyszeri script (`_status-nondco.ts`), futás után törölve. `messages` biztonsági mentés a futás előtt.
- A riport újragenerálva — a nonDCO oszlopban mostantól valódi státusz-badge-ek látszanak a korábbi „—" helyett.

### 2026-08-31 — „None" státusz kizárása MC-ken (elemzés + fix, bump vár)
**User-kérdés:** hogyan keletkezik kreatív-feltöltéskor státusz nélküli MC, és hogyan előzzük meg. **User-döntés:** a „nincs státusz" **nem legális állapot**, és mivel rendszerint leadott (élő) kreatívok töltődnek fel, a default **ACTIVE**.
- **Elemzés — a feltöltés két külön dolog:**
  - **Fájl → Creative Library:** `useUploadQueue` → `POST /api/files/upload` (`uploaded_files`, MinIO, sha256-dedup) → `POST /api/creatives` → `createCreative`. **Ez az út nem tud „none"-t gyártani:** a `creatives` táblán nincs is status oszlop, és nem keletkezik `messages` sor.
  - **Kreatív → MC:** `creative_promote` → `promoteCreative` → `createMessage` (INCOMING default), VAGY `scripts/rebuild-creatives.ts` nyers insertje.
- **Gyökér-ok:** `rebuild-creatives.ts:499` nyers `db.insert(messages)`-e **kihagyta a `status` mezőt**. Szándékosan kerüli meg a `createMessage`-et (hogy a fájlnévből jövő MC-szám megmaradjon) — így viszont annak `status: input.status ?? "INCOMING"` defaultját is megkerülte. **Mind a 676 status nélküli MC innen jött, 2026-08-17-én** (mind nonDCO channel-MC, mind template-null; DCO oldalon 0 db volt).
- **Miért volt rosszabb, mint amilyennek látszott:** a szűrő `m.status && ss.has(m.status)` szerint dolgozik, és a `statusOptions` csak létező státuszokat kínál → **egy null-státuszú MC eltűnt, amint bármelyik státuszt bepipáltad, és rá szűrni sem lehetett.** Nem szürke volt, hanem láthatatlan a státusz-tengelyen.
- **A 676 sort a user időközben maga szétosztotta** ACTIVE (+362) / INACTIVE (+314) között — a backfill tehát megtörtént, a munka a megelőzésről szól.
- **Fix — a réteg + mind a három forrás:**
  - [x] **Séma:** `messages.status` → `NOT NULL DEFAULT 'ACTIVE'`, migráció **`0008_nifty_the_initiative.sql`**. A generált SQL elé **kézzel betettem egy backfill UPDATE-et**: a `SET NOT NULL` egyetlen megmaradt NULL-on is elhasal, és a gyártó script a fájl megírása és a deploy között még lefuthat.
  - [x] **`scripts/rebuild-creatives.ts`:** explicit `status: "ACTIVE"` (nem a kolumna-defaultra bízva — olvashatóság).
  - [x] **`MessageEditor`:** a Status legördülő `— none —` opciója **törölve** (ez volt szó szerint a „none", és minden MC-n elérhető volt; a global edit ráadásul propagálta a testvérekre).
  - [x] **`import-xlsx.ts`:** üres Status cella → `INCOMING`, **nem** a kolumna ACTIVE defaultja. ⚠️ **Kimondott feltevés:** egy táblázat-sor, ami sosem mondta hogy „élő", ne váljon élővé mulasztásból. Ha ezt máshogy akarod, egy szó átírása.
  - [x] **`promoteCreative`:** explicit `status: "ACTIVE"` (eddig a `createMessage` INCOMING-ját örökölte, ami egy kész, leadott fájlra hamis). **Kézzel létrehozott MC változatlanul INCOMING.**
- **Verifikáció:** `tsc` 0, `npm run build` 0, `npx vitest run` **606/606**, eslint 0 error a módosított fájlokon.
- **⚠️ Deploy:** séma-migráció van → **migrate + kód EGY passzban** a boxon (`db:migrate` + build + `pm2 restart mm6-erste`), soha nem lokál `db:migrate` önmagában.
- **Bump-javaslat:** `6.32.0` → **`6.33.0`** (minor: séma-migráció + user-látható viselkedés-változás). A CHANGELOG-bejegyzés egyelőre `[Unreleased]` alatt áll, mert menet közben te is bumpoltál (6.31.0 → 6.32.0) — nem akartam verziót ütni rád.
- **Nyitva hagyva (nem kértél rá):** 8 db **`PLANNED`** státuszú MC van, ami nincs a kanonikus `STATUS_OPTIONS`-ban; a `Message` TS-típus még `status: string | null`-t mond (a DB már nem engedi); a `MessageEditor` saját, karakterre azonos `STATUS_OPTIONS` másolatot tart a `types.ts`-beli mellett.

### 2026-08-31 — Feed-váltás crash nyomozás (BLOKKOLVA — hibaszöveg kell)
**Bejelentés:** mátrixban változtatás → átlépés Feed view-ra → az app errorral elszáll; reload után a feed rendben feljön.
**Kizárva (nem ez):**
- **Lazy chunk / ChunkLoadError:** a `GridView`/`FeedView`/`TreeView` **statikus import** a `MatrixGrid`-ben, nincs `dynamic()`/`lazy()`, nincs `Suspense`.
- **Hook-sorrend (a 6.24.0-s F1 minta):** a `FeedView`-ban minden hook a return előtt van, korai return nincs; a `FeedExportPanel`-ben pedig **már ott a védelem és a magyarázó komment is** (a `filteredIds` memo szándékosan a `if (!ready) return` FÖLÖTT van). Az eslint `rules-of-hooks: error` óta (6.27.0) a statikus alakot amúgy is elfogná a build.
- **Query-hiba mint render-crash:** a globális `QueryClient`-en nincs `throwOnError` (`QueryProvider.tsx:9-16`), tehát egy elszálló query nem dobja a boundaryt.
- **Cache-alak romlás:** a mátrixban **nincs `setQueryData`**, csak invalidálás → a feed ugyanazt az alakot kapja, mint reload után.
- A `FeedView` adat-útja (`columns`/`rows`/`sizesByTemplate`) végig `??` fallbackös, nem dob.
**Ami hátravan:** a tényleges hibaszöveg. Kliens-oldali render-hiba, a box logjában nem látszik, lokálisan pedig nem tudom reprodukálni (nincs bejelentkezésem — a dev a KÖZÖS prod Postgresre megy).
**Következő lépés:** a user másolja ki a piros hibaképernyő / konzol első sorát (React #300/#310 vs. egy konkrét `TypeError`), abból egy lépésben megvan. Megjegyzés: a **6.32.0** épp feed-fixet hozott (DEFAULT-sor audience-rewrite) — ha az után is megvan, az kizár egy lehetséges okot.

### 2026-08-31 — Feeds lista: fájlnév-oszlop + Exported áthelyezés; a „mindig v1" magyarázata
**User-kérés (3):** (1) a generált XLSX neve legyen az első oszlop, pontosan ahogy a letöltés adja; (2) az `Exported` kerüljön a `Published at` elé; (3) fura, hogy a verzió mindig `v1`, pedig egy VAL feedből rögtön 4-et generált, mire végleges lett.
- [x] **(1) Fájlnév-oszlop.** Új `src/lib/feed-filename.ts` (`feedExportFilename`, db-függőség nélkül, hogy kliens is használhassa). A letöltő route (`feed-exports/[id]`) és a lista-route MOSTANTÓL UGYANEZT hívja — eddig a formátum-string csak a letöltőben élt, egy második másolat garantáltan szétcsúszott volna. A lista-route visszaad egy `filename` mezőt (kell hozzá a `clients.key`, +1 lekérdezés listánként). A `FeedsView` első oszlopa `File` (300px, mono), és **a detail-link is ide költözött** a dátumról — az első oszlop a sor identitása. ⚠️ Feltevés, egy sor visszacsinálni, ha a linket a dátumon akarod.
- [x] **(2) `Exported` áthelyezve** közvetlenül a `Published at` elé, sima cellaként (`feeds-table__exported`). A default rendezés marad `exportedAt desc`, a fejléc a `COLUMNS`-ból generálódik, tehát a sorrend automatikusan követi.
- **(3) A verzió NEM bug — ez a lockolt „uploaded ≠ exported" invariáns.** `decideVersion` (`feed-export.ts:560`) a `liveExport`-ból indul ki, amit a `findLiveExport` **kizárólag a `uploaded_to_adform_at`-tal rendelkező sorokból** választ. Ha nincs publikált előd → `{feedVersion: 1, action: "first"}`. Ha van, akkor is csak három ok bumpol: a user kéri, a sorszám átlépi a `MAX_ROWS_PER_FEED`-et, vagy sor tűnne el (sticky-superset); egyébként `append` ugyanarra a verzióra.
  - **Adat igazolja:** VAL 4 export (id 37–40), publikálva csak a 40-es, 12:50-kor — vagyis mind a 4 generáláskor még nem volt publikált VAL előd → mind `v1`. Termékenként: SZA 13 export / 2 publikált / max v2; SZK 16 / 1 / v1; VAL 4 / 1 / v1. A minta konzisztens.
  - **Fogalmi különbség:** a `Version` azt mondja, **melyik verziót kapja/kapta az Adform**, nem azt, hányszor nyomtál Exportot. A „hányadik próbálkozás" egy külön fogalom (export-sorszám), amit ma az `Exported` időbélyeg + a sor id hordoz — és a fájlnév végén lévő id meg is különbözteti a négy VAL fájlt (`…-v1-37.xlsx` … `…-v1-40.xlsx`).
  - **Ha mégis látni akarod a próbálkozás-számot:** külön oszlop (ordinal a product+version csoporton belül) a helyes megoldás — **a `Version` szemantikáját NEM szabad átírni**, mert az az AdForm advert_id identitáshoz van kötve (a négy lockolt feed-invariáns egyike). Külön kérésre megcsinálom.
- **Mellékes lelet:** a `src/lib/feed-export.ts` **nyers NUL bájtot tartalmaz** (offset 18511, 502. sor) egy kulcs-összefűzés elválasztójaként: `` `${row[advertIdCol] ?? ""}\x00${row[reportingCol] ?? ""}` ``. Működik, de emiatt a `file` és a `grep` **binárisnak látja az egész fájlt és némán kihagyja** — ezért nem találtam meg elsőre a verzió-logikát benne. Egy karakteres javítás: nyers bájt helyett `\u0000` escape, futásidőben azonos. Nem nyúltam hozzá, mert nem kérted.
- **Verifikáció:** `tsc` 0, `npm run build` 0, eslint 0 error/0 warning a négy érintett fájlon.

- **DEPLOYOLVA 6.33.0 (2026-08-31):** commit `9d34ec0`, push origin main, box `36cf83c`→`9d34ec0`. **Séma-migráció VAN:** `npm run db:migrate` → `0008` alkalmazva (9 migráció összesen), utána `npm run build` (Compiled successfully 41s) + `pm2 restart mm6-erste` → **Ready 1460ms**, online. Verifikálva a közös Postgresen: `messages.status` `is_nullable=NO`, `column_default='ACTIVE'::text`, **0 null sor**. Health: `/` 307, `/login` 200, `/mcp` 401, `/api/feed-exports` 401, `/feeds` 307. A box-on nincs `psql` (a DB-ellenőrzés lokálról, a tunnelen ment).

### 2026-08-31 — DV360 vs AdForm signal-oszlop: export-dropdown + referencia-visszatöltés (bump vár)
**Kiváltó:** a user két SZK feedet tett a `docs/`-ba (`…-27-merged-adform-…`, `…-28-merged-DV360-…`). **Megállapítás: pontosan EGY oszlop tér el, a 3.** — `AdformSignal:ADFPLAID` vs `ExternalSignal:ExternalSignal`; a maradék 32 fejléc karakterre azonos. Az **érték** oldal viszont már ma is helyes: mindkettőnél a `{{audiences[…].lineitem_id}}` pattern tölti, és az audience a saját buying platformjához tartozó id-t hordozza (adform 8 jegyű placement id, dv360 11 jegyű line item id). **Tehát nem új oszlop, nem új pattern, nem külön feed-struktúra kell — csak a fejlécnév.**
- [x] **Közös modul `src/lib/feed-signal.ts`** — `SIGNAL_COLUMN_OPTIONS` (a két érték + platform-címke), `DEFAULT_SIGNAL_COLUMN` (= AdForm, hogy a régi viselkedés változatlan maradjon), `isSignalColumn`, `isValidSignalColumn`. Függőség-mentes, mert a panel (kliens) és a route-ok (szerver) is használják.
- [x] **`FeedRowSet.signalColumn?`** — a választott fejléc a payloadban tárolódik, de **szándékosan NEM a `columns`-ban**. Ok: a `columns` a sor-értékek lookup-kulcsa, és a `diffRowSets` oszlopnév szerint hasonlít — ha az alias bekerülne a `columns`-ba, egy DV360-as export MINDEN sora „changed"-nek olvasódna egy AdForm-oshoz képest.
- [x] **`buildXlsxBuffer`** — csak a fejléc-cellát írja át (`isSignalColumn` találatnál), az értékeket továbbra is az eredeti kulcson olvassa.
- [x] **`POST /api/feed-exports`** — `signalColumn` a body-ban, ismeretlen érték **elutasítva** (400 `bad_signal_column`), nem átengedve: ez a string egy olyan fejlécbe kerül, amit AdForm és DV360 is szigorúan parse-ol, egy elgépelés használhatatlan fájlt adna a túloldalon.
- [x] **Referencia-visszatöltés (`adform-snapshots`)** — (a) a `findColumnMismatch` a signal-vs-signal esetet egyezésnek veszi; (b) a feltöltött snapshot a **konfigurált névre normalizálva** tárolódik (oszlop + sor-kulcsok), a fájl által használt alias a `signalColumn`-ba kerül — különben a feltöltés átmenne, de utána minden sor „changed"-nek látszana a diffben.
- [x] **UI:** `Signal column` dropdown közvetlenül a `Default for this export` alatt (`feed-export-panel__signal`), azonos stílus; perzisztencia terméken­ként (`mm6_feed_export_signal_<product>`), a default-sor mintájára. A hookok mind a `if (!ready)` korai return FÖLÖTT maradtak (a panel ismert csapdája).
- **Verifikáció a VALÓDI fájlokon:** a konfigurált struktúra 33 oszlop; az AdForm fájl régen is, most is átmegy; a **DV360 fájl régen elakadt** (`3. oszlop: "ExternalSignal:ExternalSignal" vs "AdformSignal:ADFPLAID"`), **most átmegy**. `tsc` 0, `npm run build` 0, eslint 0 error/0 warning, új `tests/unit/feed-signal.test.ts` (4 teszt: alias-felismerés, stamp nélkül változatlan fejléc, rename csak a fejlécen az értékek megtartásával, a `columns` érintetlen marad).
- **Bump-javaslat:** `6.33.0` → **`6.34.0`** (minor: új user-látható vezérlő + új HTTP body-mező). Nincs séma-migráció.

### 2026-08-31 — Feeds `Live` oszlop: egy élő sor / termék + ACTIVE szín (bump vár)
**User-kérés (2):** (1) a `Live` cella háttere legyen az ACTIVE státusz-szín, hogy jobban látsszon; (2) ne lehessen két Live sor ugyanarra a termékre — ha új SZA feedet tölt fel referenciaként, a másiknak vissza kéne állnia.
- **Gyökér-ok (2): az oszlop rossz dolgot mutatott.** `live = r.uploadedToAdformAt !== null`, azaz „valaha publikálva lett" — nem „ez az élő". A rendszer saját definíciója viszont a `findLiveExport` (`feed-export.ts`): a publikált sorok közül a **legfrissebb**. Vagyis a DB-ben mindig is pontosan egy élő sor volt terméken­ként, csak a UI mutatott kettőt.
- [x] **Megjelenítés javítva, adat nem** — `liveIdByProduct` memo a TELJES listából (nem a `filtered`-ből: a termék-szűrés nem promótálhat más sort élővé); `live = liveIdByProduct.get(r.product) === r.id`. A leváltott sor **megtartja a `Published at` dátumát** — egyszer tényleg élő volt, az tény, nem törlendő. Így nem kell adatot rombolni ahhoz, hogy egy élő sor legyen. Tooltip megkülönbözteti: „currently live" vs „was published, but a newer export has since gone live".
- [x] **Rendezés is az új definíción** (`compareRows` kapja a mapet) — különben a `Live` szerinti rendezés mást csoportosítana, mint amit az oszlop mutat.
- [x] **(1) Szín:** `feeds-table__cell--live` a teljes cellán, a meglévő `status-badge--active` szín-képletével (`color-mix(… var(--status-active) 18%, white)` + `var(--status-active)` szöveg) — nem új szín-család, és követi a Design tab státusz-színeit.
- [x] **⚠️ Menet közben talált VALÓDI hiba — vegyes időbélyeg-formátum.** Két író volt: a `mark-uploaded` route a séma `nowUtc`-ját (`YYYY-MM-DD HH:MM:SS`), az `adform-snapshots` viszont `new Date().toISOString()`-et (`…T…Z`). Ezeket az oszlopokat **stringként** hasonlítjuk össze (a `findLiveExport` és mostantól a UI is), és `"T"` (0x54) > `" "` (0x20) → **azonos napon egy ISO-bélyegű reggeli referencia felülírja a délután publikált exportot.** Ez nem elméleti: a user ma reggel töltött fel referenciát SZA-ra és SZK-ra. A snapshot-route átírva `nowUtc`-ra.
  - ⏳ **NYITVA (user döntése kell, prod UPDATE):** két meglévő sor ISO-formátumú — `id 41 (SZA, 2026-08-31T12:50:18.068Z)` és `id 42 (SZK, 2026-08-31T13:21:22.145Z)`. Amíg nincsenek normalizálva, ugyanez a hiba elsülhet rajtuk. Javasolt: `update feed_exports set uploaded_to_adform_at = to_char((uploaded_to_adform_at::timestamptz at time zone 'utc'), 'YYYY-MM-DD HH24:MI:SS') where uploaded_to_adform_at like '%T%Z';` — MA mindkettő a legfrissebb a termékén, tehát az élő sor nem változna tőle.
- **Verifikáció:** `tsc` 0, build 0, eslint 0 error. Az adaton: publikált sorok SZA 41+16, SZK 42, VAL 40 → az új szabály szerint élő SZA=41, SZK=42, VAL=40, ami **karakterre egyezik** a `findLiveExport` `distinct on (product)` eredményével.
- **Bump-javaslat:** a `6.34.0` javaslathoz hozzáadva (ugyanaz a kiadás, nincs séma-migráció).

## 🟢 AKTÍV — Feed platform-dimenzió + split export (TERV, 2026-08-31, user green-light: „platform + split egyben")

**Kiváltó / premissza-javítás (user):** egy termékhez **jogosan tartozik két élő feed** — egy AdForm, egy DV360 —, mert a két platform külön feedet kap (más signal-fejléc, más lineitemek). Ez érvényteleníti a 6.34.0-ba írt „egy élő / termék" szabályt: ma véletlenül helyes (mind a 4 publikált sor `AdformSignal:ADFPLAID`-et hordoz, ellenőrizve a payloadokban), de az első DV360 feednél elrejtené az élő AdForm sort. **A termék-scope-os szabály NEM megy ki** — ugyanebben a kiadásban a platform-scope-os váltja le.
**A valódi hiányzó darab nem a split, hanem hogy sehol nem tároljuk, melyik platformnak készült egy feed.** A `findLiveExport` is `(clientId, product)` szerint keres → egy DV360 referencia lenne a következő AdForm export verzió-alapja; a két `docs/`-beli fájl 362 vs 467 soros, tehát a keresztbe-diff tömegével „removed" sort adna, ami **verzió-bump trigger** → spontán verzióugrások.

### P1 — platform first-class a `feed_exports`-on (ez oldja meg a korrektséget)
- [x] **P1.1** `feed_exports.platform` (`NOT NULL DEFAULT 'adform'`), `0009` migráció. Backfill: minden meglévő sor `adform` — igazolva, mindegyik payload `AdformSignal:ADFPLAID`-et tartalmaz.
- [x] **P1.2** `findLiveExport(clientId, product, platform)` — az élő-keresés, és ezzel a verzió-döntés + diff-alap platformra szűkül.
- [x] **P1.3** `POST /api/feed-exports` a `signalColumn`-ból vezeti le és tárolja a platformot.
- [x] **P1.4** Referencia-feltöltés: a platform a **feltöltött fájl signal-fejlécéből** derül ki (`isSignalColumn`) — nincs „split vagy single" kapcsoló, mert egy fájlnak egy fejléce van, tehát fizikailag nem lehet split.
- [x] **P1.5** Feeds lista: `Platform` oszlop + a Live „egy élő / (termék × platform)". Ez váltja le a termék-scope-os szabályt.
- [ ] **P1.6** Tesztek (élő-választás platformonként; a cross-platform alap ne szivárogjon be a verzió-döntésbe).

### P2 — split export (kényelem: egy művelet két menet helyett)
- [x] **P2.1** A default-választó átkerül a side toolbarból az **export dialogba** (user kérése). Perzisztencia terméken­kéntiről termék+platformra bővül.
- [x] **P2.2** Split kapcsoló a dialogban: bekapcsolva a `filteredMessages` `audience.buyingPlatform` szerint particionálódik, **platformonként külön default-választóval**.
- [x] **P2.3** Egy művelet **két `feed_exports` sort** hoz létre (platformonként egyet), mindegyik a saját signal-fejlécével és **saját verzió-vonalával**.
- [x] **P2.4** Letöltés: **egy ZIP** a két XLSX-szel (`jszip` már függőség, nincs új dep).
- [x] **P2.5** Elutasítási szabály: ha egy sor audience-ének nincs `buyingPlatform`-ja, a split **megtagadja és felsorolja őket** — feedből sort némán elhagyni veszélyes. Ma ez csak a 7 `*_INCOMING` staging audience-t érintené (egyetlen érdeminek 2 üzenete van).
- [ ] **P2.6** Tesztek + component-inventory + CHANGELOG + bump.

**Kimondott feltevések (egy szó átírni, ha másképp kell):**
1. **Platformonként külön verzió-vonal** — az első DV360 export `v1` akkor is, ha az AdForm már `v3`-nál tart. Két külön feed két külön rendszerben; közös számozás félrevezetne.
2. **A fájlnév megkapja a platformot** (`erste-SZA-adform-feed-v1-40.xlsx`), különben a split két fájlja csak a záró id-ben térne el. Érinti a `lib/feed-filename.ts`-t és a Feeds lista első oszlopát.
3. **A single (nem split) export megmarad** a signal-dropdownnal — a split nem váltja ki, csak automatizálja a két menetet.

- [x] **P2.6 részben** — component-inventory + CHANGELOG kész. **Új integrációs teszt a split útra még NINCS** (a meglévő 610 lefut); a split kliens-oldali particionálás, amire nincs komponens-teszt-infra a projektben. A szerver-oldali rész (platform-scope-olt `findLiveExport`, zip-route) tesztelhető lenne integrációs szinten — ha kell, külön kérésre.
- **Megvalósítás — eltérés a tervtől, indoklással:** a split NEM egy új „többlábú" POST végpont, hanem a dialog **legenként hívja a meglévő `POST /api/feed-exports`-ot** (szekvenciálisan). Ok: az a route már tartalmazza a teljes verzió-döntést, diffet és auditot; egy második, több-legű változat lemásolta volna mindezt. A két leg amúgy is két független export (külön verzió-vonal), tehát a szekvenciális hívás az őszinte modell. A ZIP-et külön `GET /api/feed-exports/zip?ids=` adja (`jszip`, max 10 id, hiányzó id → 404, hogy a zip ne legyen némán hiányos).
- **Egységes „leg" modell:** a nem-split export = 1 leg, a split = platformonként 1. Így a preview, a commit és a letöltés nem ágazik el a `split` flagre minden lépésnél; a preview EGY `useQuery`, ami `Promise.all`-lal futtatja a legeket (fix hook-szám, akárhány platform).

## MC export a docs-ba (2026-08-31)

Kérés: ismételhető export az összes **DCO** MC-ről, ami ACTIVE vagy INACTIVE (= ami szolgál ki) — product, MC szám, variáns, PMMID, status, preview kép link. A preview-generátor újrafuttatása után csak újra kell futtatni, és a linkek frissülnek.

Döntések (user, AskUserQuestion):
- **Granularitás:** egy sor = egy MC szám+variáns (219 sor), a PMMID-k (2038 db) összevonva darabszámmal + listával, a status ACTIVE/INACTIVE bontásban összesítve.
- **Formátum:** XLSX (`node-xlsx`, már függőség) → `docs/mc-export.xlsx`.
- **Origin:** `https://erste.messagingmatrix.ai` (a `/api/previews/[id]` route szándékosan publikus), `MC_EXPORT_ORIGIN`-nal felülírható.

- [x] **M1** `scripts/gen-mc-export.ts` — read-only, lapozó (500/oldal) lekérés. DCO-teszt a kanonikus `sameAxisAs` szerint: az `audience` kulcs **nem** oldódik fel channelre. Product = `audiences.product ?? topics.product`.
- [x] **M2** Preview linkek: `message_previews` minden méretre külön oszlop, csoportonként a legkisebb message id reprezentánsa, `?v=updated_at` cache-busterrel (ugyanaz a forma, mint a `list_mc`-é és a szerkesztőé).
- [x] **M3** `npm run export:mc` script a `package.json`-be.
- [x] **M4** Futtatás + a fájl ellenőrzése; CHANGELOG + verzióbump javaslat.

**Kész (2026-08-31).** `npm run export:mc` → `docs/mc-export.xlsx`: **219 MC** (2038 message sorból összevonva), méretek 300x250 / 300x600 / 640x360 / 970x250. Egy élő link ellenőrizve: `200 image/png`. **25 MC-nek nincs egyetlen preview-ja sem** — mind `html` sablonos, tehát csak még nem futott rájuk a shooter; `npm run gen:previews` + újra `export:mc` betölti őket. Product/topic/template kártya-szintű egyezése nem feltételezés: eltérésre a script figyelmeztet (most egy sem volt).

## Share oldal + Creative Library kör (2026-08-31)

### B1 — BUG: a HTML néha nem jelenik meg (gyökérok megvan)
`PublicMatrixPreview.tsx:50` és `MatrixIframeTile.tsx:189` egyaránt így olvassa az IntersectionObservert:
`(entries) => setVisible(entries[0]?.isIntersecting === true)`.
Az IO callback a legutóbbi kézbesítés óta **sorba állt összes** entry-t kapja, és `entries[0]` a **LEGRÉGEBBI**. Gyors görgetésnél (19 iframe, terhelt main thread) a sor `[false, true]` lesz → a kód a `false`-ot olvassa ki, a tile `visible=false` marad. A tile ezután mozdulatlanul áll a képernyőn, **több intersection-változás nincs**, tehát soha nem tér magához → örök `</>` placeholder. Ráadásul a `visible → false` az effect cleanupját is lefuttatja: a már repülő render-fetch `cancelled=true` lesz, és a beérkező válasz a guard miatt **még a modul-szintű `renderCache`-be sem kerül be**, tehát a következő mount sem tudja megúszni.
- [x] **B1.1** Az utolsó entry olvasása (`entries[entries.length - 1]`) mindkét fájlban.
- [x] **B1.2** `renderCache.set(...)` a `cancelled` guard **elé** — egy megérkezett render soha ne vesszen el.
- [x] **B1.3** Ez a belépett Creative Library masonryjában is ott van (`MatrixIframeTile`), tehát a user kérdésére: **de igen, ott is** ugyanez a hiba.

### S1 — Select all filtered (Creative Library)
- [x] **S1.1** Gomb a `SelectionActions`-be, a Share **fölé**; a teljes `filtered` halmazt jelöli ki, nem csak a végtelen-görgetéssel betöltött 200-at. Collapsed toolbarhoz ikonos variáns.

### S2 — Share oldal fejléc-átrendezés
- [x] **S2.1** 1. sáv: brand / breadcrumb / cím + jobbra a **comments számláló és a captured dátum** (ma alul van).
- [x] **S2.2** 2. sáv: **balra** Size filter + Commented only (a cím alatt), **jobbra** View switcher + Image preview + Download all.

### S3 — Image preview kapcsoló a share oldalon
- [x] **S3.1** Új publikus `GET /share/[id]/previews` — a snapshotban szereplő üzenetek `{messageId, size, previewId, updatedAt}` listája. Ugyanaz a kapuzás, mint a `/share/[id]/file/[fileId]`-nál (a share snapshotja a hozzáférési lista). A PNG-t maga a már publikus `/api/previews/[id]` szolgálja ki.
- [x] **S3.2** Pipás kapcsoló a View mellé, a Download all elé — ugyanaz a checkbox-forma, mint az MC editor „Image preview"-je. Bekapcsolva a matrix-tile-ok az eltárolt PNG-t mutatják iframe helyett.
- [x] **S3.3** Download all: image módban a PNG-ket zipeli, egyébként a HTML-eket (a statikus kreatívok mindkét módban a saját fájljukat adják).

### S4 — Kompaktabb masonry a share oldalon
- [~] **S4.1** ELVETVE (user): nem a szélesség a baj. A `max-w-6xl` marad.
- [x] **S4.2** A `Masonry` round-robin osztása (item i → i % colCount) vegyes képarányoknál csálé aljat ad. Opcionális, magasság-becslésen alapuló „legrövidebb oszlopba" pakolás — **csak a share galéria kapcsolja be**, a library olvasási sorrendje marad.

**Kész (2026-08-31).** Build zöld, 613 teszt zöld, a share oldal élőben ellenőrizve localhost:6009-en.
- **B1**: a gyökérok igazolva a kódból, nem tünetkezelés. Ugyanaz a hiba volt a belépett Creative Library masonryjában (`MatrixIframeTile`) is — ott is javítva.
- **S3**: új publikus `GET /share/[id]/previews`. Hiányzó PNG-nél a tile „no preview image", és **kimarad a zipből** (user döntése) — az Image preview gomb számlálója ezért mutatja külön, hány elemnek van képe: ha eltér a Download all számától, azonnal látszik.
- **S4.2**: a `Masonry` új, opcionális `estimateHeight` propja — a share galéria a banner-méretből / fájl-dimenzióból előre kiszámolja a tile magasságát, és mindig a **legrövidebb oszlopba** pakol. A library round-robinja (olvasási sorrend) érintetlen. Ellenőrizve: a négy oszlop alja ~300px-en belül ér véget, korábban több képernyőnyi volt a különbség.
- A `StoredPreview` `aspectRatio`-t foglal betöltés előtt, különben a galéria 0 magasságra esik össze a módváltáskor.
- **Figyelem:** a 6001-es dev szervered újraindítás nélkül nem látja az új `/share/[id]/previews` route-ot (a Next dev nem szedte fel az új könyvtárat) — a 6009-esen ezért teszteltem.

- **DEPLOYOLVA 6.34.0 (2026-08-31):** commit `e173869`, push origin main, box `9d34ec0`→`e173869`. **Séma-migráció VAN:** `npm run db:migrate` → `0009` alkalmazva, majd `npm run build` (Compiled successfully 51s) + `pm2 restart mm6-erste` → **Ready 1388ms**, online. Verifikálva a közös Postgresen: `feed_exports.platform` `is_nullable=NO`, `default='adform'::text`, mind a **33 sor `adform`**. Health: `/` 307, `/login` 200, `/mcp` 401, `/api/feed-exports` 401, **`/api/feed-exports/zip?ids=1` 401** (az új route él, nem 404), `/feeds` 307.
- **Két szál egy kiadásban:** a feed platform-dimenzió + split (ez a szál) és a share-galéria preview / masonry / select-all / `export:mc` (másik szál, a `[Unreleased]` alatt már ott voltak a bejegyzései). Kombinált fán ellenőrizve deploy előtt: `tsc` 0, `npm run build` 0, **613/613 teszt zöld**.

### 2026-08-31 — Share-dialog image preview + referencia-fájlnév a Feeds listán (bump vár)
- **Image preview a detail-dialogban (user):** a kapcsoló a lightbox fejlécébe is bekerült, és **kétirányban szinkron** — nem két állapot szinkronizálva, hanem **EGY**: a `ShareGallery` `imagePreview`-ja megy le propként (`imageMode`/`setImageMode`). Szinkronizáló effect nincs, tehát nem is romolhat el.
  - A kapcsoló kikerült közös modulba (`share/[id]/ImagePreviewToggle.tsx`): a galéria adja a `ready`/`total` számot, a dialog nem (egy elemre értelmetlen lenne) → ott nincs count-badge, és `compact` módban felirat nélkül, csak ikonnal fér a fejlécbe a BgToggle mellé.
  - **Kép-mód a stage-ben:** a tárolt PNG a live render HELYETT, de **ugyanabban a skálázott dobozban és ugyanazon az `AnnotationLayer`-en belül** — így a meglévő pin/box annotációk koordinátái változatlanul ugyanoda mutatnak. Ha az elemnek nincs tárolt képe, **visszaesik a live renderre** (üres stage azt üzenné, hogy „elromlott a hirdetés", nem azt, hogy „még nincs preview").
  - Csak `kind === "matrix"` elemnél látszik a kapcsoló — a kreatívok amúgy is képek.
- **Feed-referencia fájlnév (user):** a File oszlop generált nevet mutatott (`erste-SZK-adform-feed-v0-42.xlsx`) olyan fájlokra is, amiket nem tőlünk töltöttek le. A feltöltött név a `notes`-ban van (`"Uploaded from AdForm: <név>"`), volt is rá helper az `adform-snapshots` route-ban — **közös helyre került** (`lib/feed-filename.ts`: `filenameFromNotes` + `feedExportDisplayName`), és a lista ezt használja. Export sorok változatlanok. +3 teszt.
- **Verifikáció:** `tsc` 0, `npm run build` 0, eslint 0 error, **616/616 teszt zöld** (613 → +3).
- **Bump-javaslat:** `6.34.0` → **`6.35.0`** (minor — user-látható új vezérlő + oszlop-tartalom változás). Nincs séma-migráció.

- **DEPLOYOLVA 6.35.0 (2026-08-31):** commit `722db94`, push origin main, box `e173869`→`722db94`, `npm run build` (Compiled successfully 35.9s) + `pm2 restart mm6-erste` → **Ready 1485ms**, online. **Nincs séma-migráció** (sima pull + build + restart). Health: `/` 307, `/login` 200, `/mcp` 401, `/api/feed-exports` 401, `/feeds` 307. Böngészős smoke a userre vár: a share-dialog image-preview kapcsolója (kétirányú szinkron a galériával, annotációk a helyükön maradnak) + a Feeds lista File oszlopa a két REFERENCE soron.

### 2026-08-31 — A feed-váltás crash GYÖKÉR-OKA megvan + 3 azonos rejtett hiba (bump vár)
**A hibaszöveg oldotta meg** (`TypeError: l.filter is not a function`, `formatted` → `String.replace` → `Array.map` → `useMemo`), amit a korábbi statikus elemzésem nem talált meg — mert nem hook-sorrend, nem chunk-load, nem `throwOnError` volt, hanem **közös react-query cache-kulcs eltérő ALAKKAL**.
- **Gyökér-ok:** a `MessageEditor.tsx:1085` és a `FeedView.tsx:88` is a `["text-formatting"]` kulcsot használta, de az editor a **teljes borítékot** tette a cache-be (`{ text_formatting: [...] }`), a FeedView a **kicsomagolt tömböt**. Amelyik előbb mountol, az nyeri a bejegyzést. MC-t nyitsz (vagy az editor bármelyik `invalidateQueries`-e fut) → a cache objektum lesz → Feed nézet → a `rules` átcsúszik a `formatted` mod `!rules` őrén (objektum, tehát truthy), majd `feed-spans.ts:30` `rules.filter(...)` → **TypeError renderelés közben → route error boundary**. Reload után azért működött, mert akkor a FeedView töltötte fel elsőként.
- **Javítás:** közös `useTextFormattingRules` hook (`matrix/useTextFormattingRules.ts`) — egy fetch, egy alak, egy hibakezelés. **Nem** védekező `Array.isArray` őr a fogyasztóban: a forrás volt a hibás, nem a fogyasztó.
- **⚠️ Beyond-the-ask, de ugyanez a hiba, háromszor:** mivel ez az osztály épp egy prod crash-t okozott, végigszkenneltem a `useQuery` definíciókat közös kulcsokra. A `MonitoringTable` **három kulcson** (`["messages"]`, `["audiences"]`, `["templates","folders"]`) kicsomagolt, míg mind a **négy** másik fogyasztó (MatrixGrid, CreativeLibrary, TemplateEditor, DraftsView, AudiencesEditor) borítékot tárol. Következmény: mátrixról Monitoringra lépve `templates.map` objektumot kap → crash; visszafelé a mátrix template-listája **némán kiürül**. A `MonitoringTable` most borítékot tárol, mint mindenki más — a saját kommentje is azt állítja, hogy „same sources as Creative Library". Ellenőrizve: a `["config","patterns"]` páros (FeedView + StructureTab) **rendben van**, mindkettő `Patterns` objektumot ad.
- **Tanulság a jövőre:** a query key **a cache-elt ALAK szerződése**, nem csak az URL-é. Két `useQuery` ugyanazzal a kulccsal, eltérő `queryFn`-nel = időzítéstől függő crash, amit reload elrejt.
- **Verifikáció:** `tsc` 0, `npm run build` 0, eslint 0 error, **616/616 teszt zöld**. ⚠️ Komponens-teszt-infra nincs, ezért erre a hiba-osztályra nem született automata teszt; a szerkezeti javítás (egy hook) a megelőzés.
- **Bump-javaslat:** `6.35.0` → **`6.35.1`** (patch — két crash-fix, nincs user-látható új viselkedés). Nincs séma-migráció.

- **DEPLOYOLVA 6.35.1 (2026-08-31):** commit `fc82682`, push origin main, box `722db94`→`fc82682`, `npm run build` (Compiled successfully 34.9s) + `pm2 restart mm6-erste` → **Ready 1271ms**, online. Nincs séma-migráció. Health: `/` 307, `/login` 200, `/mcp` 401, `/api/text-formatting` 401, `/matrix` 307, `/monitoring` 307. **Böngészős smoke a userre vár — ez a lényeg:** (1) MC szerkesztése → Feed nézetre váltás (a bejelentett crash), (2) mátrix → Monitoring és vissza (a szkennel talált három azonos hiba).

### 2026-08-31 — Referencia-feltöltés: vége az „egy snapshot / termék" szabálynak (bump vár)
**User:** „nem tudom felmásolni az SZK feed két változatát, egymást felülírják" → majd: **„ne legyen többet egy snapshot per termék, ez butaság volt kérnem."**
- **Gyökér-ok:** az `adform-snapshots` POST **upsert** volt `(clientId, product)` kulcson — beszúrás előtt **törölte** a termék meglévő snapshotját (`route.ts:252-268`), platformtól függetlenül. Ez a szabály régebbi, mint a 6.34.0 platform-oszlopa, ezért az SZK dv360 feltöltése kitörölte az adform-osat. (A képernyőképen 5 sor maradt, az SZK adform referencia eltűnt.)
- **Javítás (a user döntése szerint, nem csak platformra scope-olva):** a törlés **teljesen kivéve** — a referenciák halmozódnak, és a **legfrissebb** (product, platform) párra épül a diff. Ugyanaz a szabály, mint az exportoknál; a régiek történelemként megmaradnak. Az audit `action` mostantól mindig `create` (a feltöltés hozzáad, nem cserél), és a `platform` bekerült az audit `after`-be.
- **Második, ugyanilyen hiba ugyanabban a folyamatban:** a diff-alapot adó snapshot-lekérdezés (`feed-exports/route.ts:212`) **csak termékre** szűrt, `limit(1)`-gyel és **rendezés nélkül** → amint egy terméknek adform ÉS dv360 referenciája is van, egy adform export a dv360 képhez hasonlíthatott volna (a másik platform minden sora eltérésnek olvasódik). Most `platform`-ra is szűr és `uploadedToAdformAt desc` szerint rendez. Az `adform-snapshots` GET `?product=` szintén rendez (eddig tetszőleges sort adhatott).
- **⚠️ SÜRGŐSSÉ VÁLT: az utolsó ISO-formátumú időbélyeg.** Mivel a diff-alapot mostantól `uploadedToAdformAt` szerinti rendezés dönti el, az `id 41` (SZA adform, `2026-08-31T12:50:18.068Z`) aktívan árt: egy MA feltöltött SZA adform referencia bélyege `2026-08-31 22:…` lenne, ami **stringként kisebb** a `T`-s alaknál (`' '` 0x20 < `'T'` 0x54) → a friss feltöltés NEM lenne az alap. Egy soros javítás, azonos pillanat, más írásmód: `update feed_exports set uploaded_to_adform_at = to_char((uploaded_to_adform_at::timestamptz at time zone 'utc'), 'YYYY-MM-DD HH24:MI:SS') where uploaded_to_adform_at like '%T%Z';`
- **Verifikáció:** `tsc` 0, `npm run build` 0, eslint 0 error, **616/616 teszt zöld**.
- **Bump-javaslat:** `6.35.1` → **`6.35.2`** (patch — adatvesztést okozó bug + rossz diff-alap javítása). Nincs séma-migráció.

### 2026-08-31 — Split export KIVÉVE (user), a dialog visszaáll egy exportra
**User:** „az export dialogból ki szeretném venni a split funkciót, fogom filterezni hogy éppen melyik szakaszt akarom exportálni, választom a defaultot és a signal oszlop nevét."
- A tegnapi P2 (split) **visszavonva**: a `Leg` modell, a platform-particionálás, a platformonkénti default-választók, a `splitBlocked` ág és a `GET /api/feed-exports/zip` **törölve**. Az `audiences` prop is kikerült a panelből és a dialogból (csak a particionálás miatt kellett).
- **Ami MARAD:** a `feed_exports.platform` oszlop, a platformonkénti élő feed és verzió-vonal (`findLiveExport(product, platform)`), a signal-oszlop választó és a default-választó — mindkettő a dialogban, ahogy a user kérte. A default perzisztencia `mm6_feed_export_default_<product>_<platform>` maradt.
- **Miért nem baj, hogy eldobtuk:** a split kényelmi funkció volt (egy művelet két menet helyett), nem korrektségi. A korrektségi rész — hogy egy termékhez platformonként külön élő feed és külön verzió-vonal tartozik — a platform-oszlopban van, és érintetlen.
- **Verifikáció:** `tsc` 0, `npm run build` 0, eslint 0 error, 616/616 zöld.

### 2026-08-31 — I6.1–I6.3 kész: alap-választó + „semmi nem tűnik el" szabály (bump vár)
- **ISO-időbélyeg javítva (prod UPDATE, user jóváhagyta):** `id 41` (SZA adform referencia) `2026-08-31T12:50:18.068Z` → `2026-08-31 12:50:18`. 1 sor, 0 ISO maradt; az SZA sorrend változatlanul helyes (41 frissebb, mint 16). Ez azért vált sürgőssé, mert mostantól a rendezés dönti el a diff-alapot.
- **I6.1 ✅ — a szűrő többé nem töröl sorokat.** `feed-export.ts`: az `allowed` (mátrix-szűrő) eddig a carry-forward unió ELŐTT futott, tehát egy szakasz exportálása kidobta a többi szakasz sorait a feedből. Most a `liveIdSet`-beli sorok túlélik a szűrőt, és `IsActive=FALSE`-szal mennek ki (`deactivated` halmaz, az archivált-sorok meglévő felülírása mellett).
- **I6.3 ✅ — alap-választó.** `baselineExportId` a POST bodyban → `BuildOptions` → új `findExportById` (kliensre ÉS termékre scope-olva, hogy kézzel átadott id ne húzhasson be másik termék feedjét). A dialogban „Compare against" select a termék korábbi feedjeivel, legfrissebb előre kiválasztva; a választott alap egyben a **diff-alap ÉS a carry-forward halmaz**. A `diffSource` címke a sor `source`-ából derül, hogy egy export-alapot ne nevezzen „AdForm snapshot"-nak.
- **I6.2 ✅ — diff-szöveg:** a „Removed" statisztika neve force nélkül **„Switched off"**, force-szal **„Dropped"**.
- **⚠️ I6.4 NINCS KÉSZ — kimondom, mert élesben számít:** ha egy MC **pmmid-je vagy advert_id-je megváltozik**, a régi sor ma NEM kerül be inaktívként (nincs mögötte üzenet, az alap payloadjából kellene kihozni — „szellemsor"). Vagyis kulcsmező-változás esetén a régi sor továbbra is eltűnik. Ez a rekey-funkcióval fordulhat elő; ha ma nem rekeyelsz, nem érint.
- **Teszt:** új `tests/integration/api/feed-carry-forward.test.ts` (3): a kizárt sor bent marad FALSE-szal; az alap által nem hordozott sor NEM támad fel; a kiválasztott sor normálisan szolgál. Az első a régi kóddal elbukott volna. Suite: **619/619 zöld** (616 → +3), `tsc` 0, build 0, eslint 0 error.
- **Bump-javaslat:** `6.35.1` → **`6.36.0`** (minor — új vezérlő + feed-kimenet viselkedés-változás). Nincs séma-migráció.

- **DEPLOYOLVA 6.36.0 (2026-08-31 este):** commit `237f3bc`, push origin main, box `fc82682`→`237f3bc`, `npm run build` (Compiled successfully 42s) + `pm2 restart mm6-erste` → **Ready 1490ms**, online. Nincs séma-migráció. Health: `/` 307, `/login` 200, `/mcp` 401, `/api/feed-exports` 401, `/feeds` 307, `/matrix` 307. A törölt zip-route `401`-et ad (nem 404): a `[id]` dinamikus útvonal fogja el `id="zip"`-ként, és az auth előbb fut a `bad_id` validációnál — helyes.

### 2026-09-01 — Export-dialog: alap vezérli a mezőket, szűrhető diff, fejléc-fájlnév — 6.37.0
- **⚠️ A tegnapi carry-forward javítás FÉLIG MŰKÖDÖTT — user képe leplezte le.** Egy feltöltött referencia `messageIds`-e csupa `-1` (`adform-snapshot.ts:64`), mert egy AdForm-XLSX nem ismeri az MM6 sor-azonosítókat → a `liveIdSet` ÜRES lett → a „semmi nem tűnik el" szabály **referencia-alap esetén nem érvényesült**, pedig épp az a gyakori eset. Ezért mutatott a preview 23 eltűnő sort. Javítás: ha a `liveIdSet` üres, a carry-forward halmaz az alap payloadjának **PMMID-oszlopából** oldódik fel az üzenetekre (ugyanaz a párosítás, amit a diff már használ).
- **Verzió-indoklás szövege:** „N live rows would be removed (sticky-superset rule)" → force nélkül „N baseline row(s) are not in this selection - they go out switched off, not deleted", force-szal „…are dropped from this version".
- **Az alap kitölti a signalt és a defaultot:** a `baselineExportId` változásakor a `platform`-ból signal-oszlop, a sor `defaultMessageId`-jából default. ⚠️ Csapda, amit kezelni kellett: a localStorage-restore effect kulcsa tartalmazza a platformot, tehát a signal átállása után AZONNAL felülírta volna a defaultot — ezért a restore csak `baselineExportId === null` esetén fut.
- **Diff-csempék szűrőként:** Added / Changed / Switched off gomb; a kiválasztott a details listát arra a szeletre szűkíti és kinyitja. A `Stat` opcionálisan kattintható (`onClick` nélkül sima kijelző marad).
- **Fejléc:** a leendő fájlnév a termék helyett. A dry-run válasza `filenamePreview`-t ad; a `feedExportFilename` `id` paramétere `number | null`, null esetén `new` (nem `0`, ami valódi id-nek látszana). Export után a valódi név látszik.
- **Sorrend:** inputok felül, alattuk (elválasztóval) a diff-forrás, a verzió-figyelmeztetés és a details — a diff addig értelmetlen, amíg nincs megadva, mihez képest.
- **Verifikáció:** `tsc` 0, build 0, eslint 0 error, **619/619 zöld**.
- **NYITVA — advert_name záró szám (user kérdezte):** a minta `MC{{number}}_{{variant}}_{{topic}}_{{version}}`, és a `{{version}}` a **`messages.version`**, azaz az optimistic-lock szerkesztés-számláló (`buildContext` `...m`-mel teszi be), nem az MC verziója. Ezért nő minden mentésnél (41→43, 5→97), és ezért látszik sok „changed" sor. **Ez konfig, nem kód** (Settings → Patterns → feed → `advert_name`). Ha kiszedjük, EGYSZERI churn: minden sor advert_name-je megváltozik, tehát a következő diff mindent „changed"-nek mutat. Nem nyúltam hozzá — user döntése.

- **DEPLOYOLVA 6.37.0 (2026-09-01):** commit `90821f5`, box `237f3bc`→`90821f5`, build 33.0s, `pm2 restart` → **Ready 1316ms**, online. Nincs séma-migráció. Health: `/` 307, `/login` 200, `/matrix` 307, `/api/feed-exports` 401.

### 2026-09-01 — Két hiba a user képéről: default-sor + a verzió-döntés diffje — 6.37.1
- **User kérdése:** „nem ismeri fel a default sort, miért nem?" Az adat megvolt: a referencia (id 46) `default_message_id = 32654` (MC301b). A hiba a kliensen: a szerver a **teljes** üzenet-listából oldja fel a default MC-t (`feed-export.ts:532`), a legördülő viszont a **szűrt** halmazból épült → a szűrésen kívüli MC-hez nem volt `<option>`, és a select némán az elsőre esett vissza. Javítás: az alap saját defaultja opcióként bekerül, „from baseline, outside this filter" felirattal.
- **⚠️ A képen a figyelmeztetés 190 sort mondott, a csempe 46-ot — ez két különböző diff volt.** A `versionDiff` az alapértelmezett `rowKey`-vel párosít **(advert_id, ReportingLabel)**, ami csak két MM6 export között működik: **az MM6 soraiban nincs advert_id** (az AdForm-é), a referenciában viszont van → szinte semmi nem párosult, majdnem minden sor „removed"-nak számított, és **a verzió-döntés ezen a diffen született**. A preview ugyanezt PMMID-vel számolta (46). Mostantól referencia-alapnál a döntés is `pmmidRowKey`-t használ. A régi komment („the only source of stable advert_id identity") épp azt a feltevést rögzítette, ami referencia-alapnál nem áll.
- **Verifikáció:** `tsc` 0, build 0, eslint 0 error, 619/619 zöld. ⚠️ A 190→46 változást élesben a te preview-d fogja igazolni.

- **DEPLOYOLVA 6.37.1 (2026-09-01):** commit `0ee3ec8`, box `90821f5`→`0ee3ec8`, build 36.3s, `pm2 restart` → **Ready 1674ms**, online. Nincs séma-migráció. Health: `/` 307, `/matrix` 307, `/api/feed-exports` 401.

### 2026-09-01 — I6.4 kész: szellemsorok + gazdag alap-választó — 6.38.0
- **User két kérdése a preview-ról, mindkettő valós hibát fedett fel.**
- **(1) „Miért akar még egy default sort hozzáadni?"** — a referencia-fájl **önmagával inkonzisztens**: a DEFAULT sorában `messaging_card_id=301` / `advert_name=MC301_b_…`, a PMMID és a ReportingLabel viszont `-m_302-`. Az `extractDefaultMc` a card-id oszlopokból olvas → `default_message_id` = MC301b; a diff viszont PMMID szerint párosít → a mi `-m_301-` DEFAULT sorunk nem talál párt, ezért „added", a fájlé meg „switched off". **Nem kód-hiba: a feltöltött (kézzel merge-elt) fájl mond két különbözőt.** Egy feed egyébként is pontosan egy DEFAULT sort visz, tehát a csere helyes viselkedés.
- **(2) „A switched off nem kéne hogy kikerüljön a feedből"** — IGAZA VAN, és ki is került: 361 alap − 46 + 1 = 316 sor. Ok: mind a 46 sor PMMID-je olyan MC-re mutat, ami **már nem létezik** (MC90, MC91, MC92…), tehát nincs mögötte üzenet, amiből a sort felépíthetném — a tegnapi PMMID-alapú carry-forward csak létező üzenetre tud hordozni. **Javítás (I6.4):** az alap payloadjából **szó szerint újra kiírjuk** ezeket a sorokat `IsActive=FALSE`-szal, a feed-struktúra oszlopaira szűkítve (hogy egy másik struktúrájú alap ne szélesítse a lapot). Az alap saját DEFAULT sora kimarad (egy feed egy DEFAULT-ot visz).
- **Gazdag alap-választó** (`BaselinePicker`): fájlnév + `reference`/`export vN` + `· live` + dátum. Natív select helyett popover, `MultiPill` mechanikával. **Az „automatic" sor megszűnt:** a legfrissebb ÉLŐ feed van előre kijelölve (ha nincs élő, a legfrissebb épített), kézi választást soha nem ír felül.
- **Teszt:** +2 (`feed-carry-forward.test.ts`): a nem-építhető sor bent van FALSE-szal és a ReportingLabelje sértetlen; a frissen épített sor nem duplázódik az alapból. Suite **621/621 zöld**.
- **Bump:** `6.37.1` → **`6.38.0`** (minor — feed-kimenet viselkedés-változás + új vezérlő).

- **DEPLOYOLVA 6.38.0 (2026-09-01):** commit `65db982`, box `0ee3ec8`→`65db982`, build 36.8s, `pm2 restart` → **Ready 1393ms**, online. Nincs séma-migráció. Health: `/` 307, `/matrix` 307, `/api/feed-exports` 401.

### 2026-09-01 — DEFAULT sor: a PMMID a forrás, nem a leíró oszlopok — 6.38.1
- **User: „a defaultot még mindig meg akarja változtatni, miért?"** A 6.38.0 után 361 sor (a carry-forward rendben), de maradt **1 added + 1 switched off — mindkettő a DEFAULT sor**: a miénk `-m_301-`, a fájlé `-m_302-`.
- **Gyökér-ok a MI oldalunkon:** az `extractDefaultMc` a `messaging_card_id`/`_variant` oszlopokból olvasott, azok viszont **leíró szöveg**, ami elmehet a sor saját PMMID-jétől. A user referenciájában pontosan ez történt: card-id `301/b`, PMMID és ReportingLabel `-m_302-`. Mivel MINDEN párosítás (diff, carry-forward, AdForm riport) PMMID-n megy, a DEFAULT sort más MC-ből építettük újra → sosem talált párt → **minden export örökre 1 added + 1 switched off**.
- **Javítás:** a DEFAULT MC a **PMMID-ből** derül (`-m_<szám>-`, `-v_<variáns>-`, `-n_<verzió>-`), a leíró oszlopok maradnak fallbacknek. A **verzió is kell**: az MC302b két verzióban létezik (`n_1` és `n_4`), és rossz verzióval olyan PMMID-t generálnánk, ami továbbra sem egyezik. +2 unit teszt.
- **A meglévő referencia adata is javítva** (a kód csak új feltöltésre hat): `feed_exports.id=46` `default_message_id` `32654` (MC301b) → **`32208`** (MC302b n4, topic egyezik), `default_label` frissítve. Ellenőrizve: ennek a PMMID-je a DEFAULT-átírás után **karakterre** a referencia DEFAULT sora.
- **Verifikáció:** `tsc` 0, build 0, eslint 0 error, **623/623 zöld**.

- **DEPLOYOLVA 6.38.1 (2026-09-01):** commit `a9f7e55`, box `65db982`→`a9f7e55`, build 33.0s, `pm2 restart` → **Ready 1516ms**, online. Nincs séma-migráció. Health: `/` 307, `/matrix` 307.

### 2026-09-01 — Az alap köti a mezőket; a force tényleg töröl — 6.39.0
- **User-kérdés volt, hogy a `none (new feed, new version)` sor vagy a disabled compare-against a jobb.** Egyik sem: mindkettő azt feltételezi, hogy „force new version" = „nincs alap". **Nem ugyanaz** — a leggyakoribb verzióugrás épp az, amikor új verziót csinálsz, DE látni akarod a diffet a régihez képest. Ha a `none` lenne az egyetlen út a verzióugráshoz, pont akkor veszne el a diff, amikor a legjobban kell. Ezért a pipa maradt, de a jelentése lett éles: **kötve vagy-e az alaphoz**.
- **Lezárt viselkedés (user döntései):**
  - **Alap + nincs force → kötve:** a signal-oszlop és a DEFAULT sor az alapé; mindkét legördülő **mutatja az értéket és disabled**, és az alap **saját DEFAULT sora szó szerint** kerül az exportba (nem generáljuk újra). Az újragenerálás volt az oka az örökös „1 added + 1 switched off" párnak.
  - **Force bepipálva → a mezők felszabadulnak**, ÉS a válogatásból kimaradt sorok **tényleg kiesnek** (se carry-forward, se szellemsor). Eddig a force csak a verziószámot emelte, miközben minden sor bent maradt — vagyis **egyáltalán nem volt mód sort kivezetni**.
  - A pipa a baseline-választó ALÁ került, mert az alatta lévő mezők viselkedését dönti el.
- **Mellékhatás kezelve:** ha a DEFAULT sort az alapból hozzuk, a `default_message_id` csak tájékoztató → a route `default_not_found` (422) ellenőrzése kihagyódik ilyenkor (`built.defaultCarried`), különben egy időközben átszámozott MC blokkolna egy exportot, aminek a DEFAULT sora amúgy helyes.
- **Teszt:** +2 (force: a kizárt sor NEM kerül be; a nem-építhető sor sem). Suite **623/623 + 2 = 625** (a force-tesztekkel a fájl 7).

- **DEPLOYOLVA 6.39.0 (2026-09-01):** commit `fbe6747`, build OK, `pm2 restart` → online. Nincs séma-migráció.

### 2026-09-01 — Append / New feed kapcsoló + diff-szűrő — 6.40.0
- **User:** „a force new version is rossz UI, kéne felülre egy jobbra-balra nagy kapcsoló leírással, Append or New Feed… a new-nál nincs értelme a diffnek." Igaza van: a pipa egy MÓDOSÍTÓ volt egy cselekvésen, holott **két külön cselekvésről** van szó.
  - **Append:** alap **kötelező** (a gomb tiltva nélküle), a signal és a DEFAULT sor onnan öröklődik (disabled mezők), sor soha nem tűnik el.
  - **New feed:** nincs alap-választó, nincs diff (helyette egy sor: hány sor megy ki), a signal és a default szabadon választható, és csak a mostani válogatás megy ki.
  - A dróton továbbra is `forceNewVersion` megy (`mode === "new"`), és New feed esetén `baselineExportId: null` — a szerver-oldali szemantika változatlan, csak a UI mondja ki tisztán.
- **Diff details:** a szerver **50 sorra** vágta mindhárom listát, a changed viszont 206 volt → a keresett sor tipikusan a vágás után volt. Ez okozta a user panaszát („nem látom az MC331 változásait"). **Ellenőriztem az adatot: mindhárom változás BENNE VAN** — MC331a/b `IsActive` FALSE→TRUE (a referenciában FALSE, ma ACTIVE), MC331c `bg1` `…_n1`→`…_n2`. Limit 1000-re emelve (a feed amúgy is max 500 sor), és **szabadszöveges szűrő** került a lista tetejére, ami minden cellaértéken keres.
- **Verifikáció:** `tsc` 0, build 0, eslint 0 error, **625/625 zöld**.

- **DEPLOYOLVA 6.40.0 (2026-09-01):** commit `c20d718`, build 37.9s, `pm2 restart` → **Ready 1415ms**, online. Nincs séma-migráció. Tartalom: Append/New feed kapcsoló, diff-szűrő + 1000-es limit, a panel gombja `Export`.

---

## Checkpoint 2026-09-01 — tenant-fork tanulmány (docs-only)

Kérdés: Telekom-fejlesztés fork/clone/worktree-vel, Erste-funkciók sérülése nélkül, két ág fenntartása nélkül.
Új doksi: **`docs/TENANT_FORK_STRATEGY.md`** (361 sor). Kódot nem érintett.

**Verdikt:** nincs fork, nincs hosszú életű `telekom` ág. A kód már mély multi-tenant (minden tenant-tábla `client_id`, `ACTIVE_CLIENT_KEY` boot-pin, `src/`-ben 21 „erste"-találat és mind komment/placeholder). Elválasztás futásidőben; `git worktree` csak munkaeszközként (külön könyvtár + port 6002 + `ACTIVE_CLIENT_KEY=telekom`, közös DB, izolált adat).

**Feltárt tények (a doksiban részletesen):**
- A `*Structure` config-kulcsok nagyrészt dekoráció — csak a `StructureTab` olvassa őket; a valódi oszlopok a `schema.ts`-ben fixek. Kivétel: `feedStructure` + `treeStructure` (ezek élnek).
- A státusz-készlet hardcode-olt 5 helyen (`matrix/types.ts:160`, `DesignTab.tsx:11`, `MessageEditor.tsx:50`, `TemplateEditor.tsx:82`, `branding.ts:54`) — csak a *színek* per-kliensek.
- Hosszú párhuzamos ágak konkrét gyilkosa: a drizzle migráció-sorszámok (`0009` a legmagasabb) két ágon ütköznének egy közös éles DB-n.

**Javasolt védőháló (még NINCS megcsinálva, backlog):** G1 Erste-golden tesztréteg a közös kódutakra (`feed-export.ts`, `numbering.ts`, `patterns/pmmid/trafficking`), G2 additív-only migrációs szabály a `CLAUDE.md`-be, G3 tenant-capability flag config-ban (kliens-kulcs szerinti `if` tilos), G4 külön checkout + `mm6-telekom` pm2 app.

**Nyitott döntés a userre (a doksi 10. pontja):** a Telekom store-fan-out modellje — N valódi `messages` sor vs. 1 üzenet × N lokalizáció (`message_locales` additív tábla). Ez az egyetlen visszafordíthatatlan döntés, és az egyetlen pont, ahol a Telekom adatmennyiséggel ronthatna Erste-élményt. **Az első tömeges import ELŐTT kell eldönteni.**

**Kiegészítés (ugyanaz a session):** a doksi új **11. fejezettel** bővült — „Séma-változás tenant-igényre". Lényeg: a közös DB + eltolt deploy miatt a destruktív migráció NEM „kockázatos", hanem azonnal leviszi a futó Erste-t (a drizzle felsorolja az oszlopokat, nem `SELECT *`), tehát az additív-only + expand→backfill→switch→contract üzemeltetési kényszer. Eszköz-sorrend: config (státusz-készlet, `*Structure` valódivá tétele) → sidecar tábla domain-névvel (precedens: `message_previews`/`text_formatting`) → additív nullable oszlop → külön adatbázis. **`search_path` schema-per-tenant: ne** (a drizzle-journal + globális táblák + pool miatt a data-access réteg átírása lenne, olyan izolációért, ami már megvan). `jsonb`: ma **nulla** json/jsonb oszlop van a sémában, tehát új minta lenne — egyelőre ne. Négy javasolt `CLAUDE.md`-szabály a 11.9-ben.

---

## SESSION-OSSZEFOGLALO — 2026-08-28 -> 09-01 (`6.27.3` -> `6.40.0`)

**Kiadasok:** 6.28–6.30 (topic/audience kulcs-fixek, header-dialog delete, asset batch upload, rekey-kaszkad) · 6.31 (statusz-darabszam a szuroben, tree platform-szinek) · 6.32 (feed DEFAULT-sor audience-rewrite, masik szal) · 6.33 (MC-statusz NOT NULL, Feeds fajlnev-oszlop) · 6.34 (feed platform-dimenzio + split + share-galeria) · 6.35 (share image-preview, referencia-fajlnev; .1 a ket query-key crash) · 6.36–6.40 (diff-alap valaszto, carry-forward, szellemsorok, Append/New feed kapcsolo, diff-szuro).

**A harom legfontosabb tanulsag — mindharom memoriaba is felkerult:**
1. **A query key a cache-elt ALAK szerzodese**, nem csak az URL-e. Ket `useQuery` egy kulcson, eltero alakkal = sorrendfuggo crash, amit a reload elrejt. Negyszer volt meg elesben. -> `project_query_key_shape_contract.md`
2. **Az idobelyegek stringkent hasonlitodnak.** Mindig `nowUtc`, soha `toISOString()` — azonos napon a `T` felulirja a szokozt, es a sorrend megfordul. Egy sort kezzel kellett normalizalni. -> `project_timestamp_string_ordering.md`
3. **A feed-invariansok kibovultek** (platform az identitas resze; PMMID a MI azonositonk, az advert_id az AdForme; a feedbol semmi nem tunik el; Append != New feed). -> a `project_adform_export_invariants.md` atirva, 5–8. pont.

**Modszertani tanulsag:** a feed-hibak egyiket sem teszt talalta meg, hanem a user, aki ranezett egy preview-szamra es megkerdezte, miert annyi. A „190 vs 46" elteres, az „1 added default", a 316 vs 361 sor — mind ilyen. **Ha egy feed-szam furcsan nez ki, azt vegig kell kerdezni.**

**Nyitva maradt:**
- **`advert_name` zaro szama** — a minta `{{version}}`-t hasznal, ami a `messages.version` optimistic-lock szamlalo, tehat minden mentesnel no (ez sok „changed" sor oka). **Konfig, nem kod** (Settings -> Patterns). Kivetelekor **egyszeri nagy churn** lesz: minden sor advert_name-je valtozik. **User dontese.**
- **`feed-export.ts` nyers NUL bajtja** (502. sor, kulcs-elvalaszto) — emiatt a `grep`/`file` binarisnak latja es nemán kihagyja a fajlt; engem is megvezetett. Egy karakteres javitas: nyers bajt helyett `\u0000` escape.
- **I4** Drive-linkek a kreativokon (parent folder + szamitott file link, health check, 600-as backfill) - TERV KESZ 2026-09-03, zold-lightra var.
- **I5** 500-as limit szerinti feed-reszletek (user: „kesobb"; a modell-dontes megvan: ket onallo feed).
- **I6.4 reszben:** kulcsmezo-valtozasnal (pmmid/advert_id) a regi sor ma az alapbol hordozodik szellemsorkent — ez mukodik —, de a *szandekos* rekey-forgatokonyv vegig nincs tesztelve.
- **M9, W2.6/W2.7, M1, M4.2, M5–M8** es a Channels-epic S4–S6 tovabbra is a roadmapen.

---

## 2026-09-01 — I1 Dashboard átépítés (auto mód, user: „dönts magad")

**Scope-döntés (magam hoztam, user felhatalmazásával):** I1.1 + I1.2 (D.2 users-join nélkül migráció) + I1.3 (egyszerűsítve) + I1.4 + I1.5 megy egy körben. **I1.6 (`actor_kind` migráció) és I1.7 (chartok) NEM** — előbbi séma-migrációt kér (külön passz a boxon), utóbbi 3 hónapos adatot rajzolna.
- [x] **I1.1** `?d=YYYY-MM-DD&r=day|7d` nap-scope + Today / Yesterday / Last 7 days pill-sor. Server component marad, a scope az URL-ben. UTC-nap (a tárolt bélyeg UTC), a fejléc kimondja.
- [x] **I1.2** Activity-digest: `entityType × action × aktor` aggregálva, darabszámmal, users-join (email a nyers `user_id` helyett). A 15-soros nyers lista helyett.
- [x] **I1.3** Friss kreatívok vízszintes csík, 250px egységes MAGASSÁG, léptető gombokkal. **Infinite scroll / swipe-fizika kimarad** (a nap-scope halmaza kicsi, nincs mit tölteni).
- [x] **I1.4** Aznapi feed-exportok + „exportálva, nincs feltöltve" badge.
- [x] **I1.5** Riport-frissesség tile (`monitoring` max(imported_at) + lefedett periódus + „N napja").
- [x] Entity-count csempék megmaradnak, de a lap aljára („Library"), mert nem nap-scope-osak.

**KÉSZ ÉS DEPLOYOLVA — 6.41.0.**
- **Új fájlok:** `src/lib/day-scope.ts` (scope-feloldás, 7 unit teszt), `(app)/_dashboard/CreativeStrip.tsx`. Átírva: `(app)/page.tsx`.
- **Amit a lap most mond (élő adaton ellenőrizve):** ma 3 írás / 3 export (2 nem publikált), 7 napra 5569 írás 25 fajtából, `messages` update 5242 (ebből `system` 1145 — **null `user_id`**, tehát az `actor_kind` (I1.6) kérdése tényleg él), riport-adat **47 napja** áll.
- **Két döntés, amit a terv nyitva hagyott, és most eldőlt:**
  1. **A kreatív-csík nem lehet szigorúan nap-scope-os** — az utolsó `creatives.created_at` **2025-12-22**, tehát a widget örökre üres lenne. Megoldás: a scope vezet, de ha üres, a **legutóbbi 24** kreatívot mutatja, és **kiírja, hogy azt csinálja** (`none in this window — latest arrived …`). Infinite scroll/swipe-fizika ezért kimaradt: nincs mit tölteni.
  2. **A magasság a médián van, nem az anchoron.** Az anchor szélessége a képből jön, a kép magassága pedig százalékban az anchorhoz kötődött volna — körkörös; a tile-ok 10px-es csíkokká estek össze. `h-[250px]` az `img`/`video`/placeholder elemre.
- **Nem került bele:** I1.6 (`actor_kind` — séma-migráció, külön passz a boxon) és I1.7 (chartok — a 47 napos adat miatt).
- **Verifikáció:** `tsc` 0, `npm run build` 0, eslint **0 error**, **632/632 teszt zöld** (625 + 7 új). Vizuálisan mindkét scope ellenőrizve élő adattal.
- **Bump:** `6.40.0` → **`6.41.0`** (minor — új oldal-viselkedés).

- **DEPLOYOLVA 6.41.0 (2026-09-01):** commit `d554cb6`, box `c20d718`→`d554cb6` (a két docs-commit is felment), `npm run build` ok, `pm2 restart mm6-erste` → **Ready 1235ms**, online, box `package.json` **6.41.0**. Séma-migráció nincs. Health: `/` 307, `/login` 200, `/matrix` 307, `/feeds` 307, `/api/feed-exports` 401, `/mcp` 401. Az `error.log`-ban a restart óta nincs új bejegyzés (a benne álló utolsó sorok az AWS SDK node>=22 figyelmeztetése, korábbról).
- ⚠️ **Auto módban az `ssh` a boxra blokkolva van** (klasszifikátor) — a deploy csak auto módon kívül ment át. Ha ez rendszeresen kell, `.claude/settings.json` permission-szabály oldja meg.

**Kiegészítés 2 (ugyanaz a session):** új **12. fejezet** — „A két anti-minta közelről", valódi repo-esetekkel. (1) `audiences.channel` teljes íve: overload (séma-komment: `NULL = DCO`) → szétterjedés (mátrix-partíció `MatrixGrid.tsx:782`, tengely-scope-olt számozás `messages.ts:230`) → **két dokumentált éles bug** (nonDCO product-filter 6.15.1, LTP topic-eltűnés 6.15.2 — mindkettő a fabricált sorok `product=NULL`-jából) → kiemelés saját táblába (`0007`, `migrateChannelsFromAudiences`) → **maradvány, ami ma is él**: `channelToAudience` 11 mezőt tölt `null`-lal, 6 hívási hely. (2) `messages.template=null` mint implicit típus (`isStatic = !draftTemplate && !!draftImage1`, `MessageEditor.tsx:1977`) — ne folytassuk `video1 != null`-lal a Telekom-videónál.

**Korrekció a fenti checkpointhoz:** a „21 találat, mind komment" pontatlan volt. Pontosan: `client.key ===` szerinti elágazás **0** (ez a lényegi szám, változatlanul), de van **1 élő tenant-nevű azonosító**: `importErsteXlsx` (`import-xlsx.ts:92`, hívva `api/import/xlsx/route.ts:58`). A függvény generikus, csak a neve tenant-specifikus — olcsó átnevezés most (2 fájl, 3 sor), drága akkor, ha jön mellé egy `importTelekomXlsx`. A `docs/TENANT_FORK_STRATEGY.md` 1.1 táblázata javítva.

**Backlog-jelölt (NINCS megcsinálva, engedélyre vár):** `npm run check:tenant-leak` — a 12.6 négy grepje scriptbe kötve, `test`-be akasztva. Kapu: a `client.key ===` szám maradjon 0.

### 2026-09-01 — A user két hibája a 6.41.0 dashboardon — 6.42.0
- **„nem ezek a legújabb kreák"** — igaza volt, és a hiba az én sorrendezésem: `creatives.id DESC`. **Ebben a könyvtárban az id NEM recencia:** a legmagasabb id-k (17370…) `created_at`-je **2025-12-22**, a fájljuk viszont 2026-08-17-én került fel. Vagyis a „new creatives" csík a legrégebbi szállítást vezette fel, és a „latest arrived" felirat ugyanazt a rossz dátumot ismételte. **Most `created_at DESC`** — ez az, amire a Creative Library is default-ból rendez (`ListSortHeader.DEFAULT_SORT`), tehát a „legújabb" ugyanazt jelenti a két lapon. Az élen most MC318c (2026-08-13), utána MC338 (08-06).
  - ⚠️ **Amit menet közben megtudtam, és számít:** `uploaded_files.created_at` **sem** használható „érkezés"-nek — mind a **3140 élő kreatív fájlja 2026-08-17-re esik** (a storage-migráció napja). Az egyetlen valós szállítás-jel a `creatives.created_at`.
- **„nem infinite scroll, pedig azt kértem jobbra"** — jogos, ezt a 6.41.0-ban kihagytam. Most megvan: új **`GET /api/dashboard/creatives?d=&r=&offset=`** (24-es lapok, scope-on belül), az első lapot a szerver rendereli, a többi görgetésre jön, 800px-szel a jobb szél előtt indul.
  - **Egy valós versenyhelyzet javítva még kiszállítás előtt:** a scroll-esemény gyorsabban tüzel, mint ahogy a React state-et commitol, tehát két esemény ugyanazt az offsetet tölthette volna be kétszer (dupla tile, dupla key). A kurzor és az „épp tölt" jelző **ref**, nem state.
- **Teszt:** új `tests/integration/api/dashboard-creatives.test.ts` (5) — a sorrend-teszt fixture-je pont az éles alakzat (a legkésőbb beszúrt sor a legrégebbi `created_at`), tehát a régi kóddal elbukna; + lapozás vége, kliens-izoláció, archivált kihagyása. Suite **637/637 zöld** (632 → +5).
- **Bump:** `6.41.0` → **`6.42.0`** (minor — új HTTP route + viselkedés-változás).

- **DEPLOYOLVA 6.42.0 (2026-09-01):** commit `7e696a9`, box `d554cb6`→`7e696a9`, build 36.8s, `pm2 restart` → **Ready 1395ms**, box `package.json` **6.42.0**. Séma-migráció nincs. Health: `/` 307, `/login` 200, `/matrix` 307, `/api/dashboard/creatives` **401** (auth mögött, helyes).

### 2026-09-01 — A csík négy user-kérése: két méret, DCO is, hover, dialog — 6.43.0
- **User:** „minden méretet nem rakunk ki ide csak a 300x250 és a 1080x1080" · „ezek a képek nem a legfrissebb módosítások még mindig" · „mouse overre írjuk ki az MC számot, variánst és topicot" · „kattintásra megnyílhat ugyanaz a dialog mint a creative libraryban" · **majd menet közben:** „nem csak a creative library hanem a **dco kreatívok** is a listába kéne kerüljenek legutóbbi változás dátuma szerint".
- **A „legfrissebb" kérdés végigkövetése (három rossz jel után a negyedik a jó):**
  1. `creatives.id` — **nem recencia** (a legmagasabb id-k `created_at`-je 2025-12-22). Ez volt a 6.41.0 hibája.
  2. `uploaded_files.created_at` — **sem**: mind a 3140 kreatív fájlja `2026-08-17`, a storage-migráció napja.
  3. `creatives.created_at` — a szállítás napja, de a *módosítás* nem látszik rajta (6.42.0 ezt használta; a user szerint még mindig nem a friss).
  4. **`updated_at` mindkét forráson** — ez a valódi „utolsó változás". A csík éle most MC331a/b/c (2026-08-31 21:02), pontosan az, amin a user tegnap dolgozott.
- **Két forrás, egy idővonal:** a kurzor egy SQL `union all` (uploaded creative + DCO üzenet), `changed_at desc` szerint, és külön hidratálódik a két fajta. A DCO ág **`distinct on (number, variant)`** — egy MC annyi cellában él, ahány audience-e van, és nélküle egyetlen szerkesztett MC kitöltené a csíkot (élesben 24-ből 24 tile volt MC331a). A Creative Library ugyanígy dedupál (`seen` a `number|variant|size`-on).
- **Ugyanaz a szűrés, mint a Library-ben:** csak ACTIVE cella, csak olyan sablon, ami rendel a két méret valamelyikére (`listAllTemplates()` a forrás; élesben az `html` 300x250-et ad, 1080x1080-at egyik sablon sem — az a méret az **uploaded** oldalról jön).
- **Hover:** MC szám+variáns és alatta a topic. A kreatívon nincs topic, az üzenetről oldódik fel `mcNumber+mcVariant` alapján; a 630 párból 40 több topicra fut ki — ilyenkor **mind** kiíródik, mert az egyik önkényes választása rossz cellát nevezne meg.
- **Kattintás:** a Library saját dialógusai — uploaded → `CreativeDetailDialog`, DCO → `MatrixDetailDialog`. A DCO tile élő `MatrixIframePreview` (`fit-rect`, 250px magas dobozban), tehát egy perce mentett szöveg is látszik; IntersectionObserver miatt csak a látható tile kér `/api/render`-t.
- **Teszt:** `dashboard-creatives.test.ts` **11** eset (sorrend, két méret, verzió-család, topic, DCO beszúrás a közös sorrendbe, MC-dedupe, nem-ACTIVE és sablon nélküli cella kizárása, lapozás, kliens-izoláció, archivált). Suite **643/643 zöld**.
- **Bump:** `6.42.0` → **`6.43.0`** (minor).

- **DEPLOYOLVA 6.43.0 (2026-09-01):** commit `01f540a`, build 39.8s, `pm2 restart` → **Ready 1255ms**, box `package.json` **6.43.0**. Séma-migráció nincs. Health: `/` 307, `/matrix` 307, `/api/dashboard/creatives` 401.

### 2026-09-01 — Shares-összegző + a fejléc az aloldalak nyelvén — 6.44.0
- **User:** „kéne egy shares összegző is időtartomány szerint" · „a dashboard yesterday elég a fejlécbe, nem kell alá még egyszer az Erste" · „a Dashboard és az időszak mehet azzal a megjelenéssel, mint a fejléc az aloldalakon" · „a bal felső sarokban az ERSTE szóra kattintva jöhet a dashboard (nem kell külön menüpont)".
- **Shares panel:** az ablakban nyitott share-ek (elemszám, nézet, letöltés, archivált badge) + **az ablakban érkezett kommentek minden share-en** — a régi share-re ma írt komment ma hír, és a share-sorok önmagukban sosem mutatnák meg. ⚠️ **A nézet- és letöltésszám kumulatív** (nincs napi bontás a sémában), ezért a felirat és a tooltip kimondja, hogy all-time — nem adom el ablak-adatnak.
- **Fejléc:** a lap most ugyanazzal a sticky `toolbar`-ral nyit, mint a Feeds/Shares (cím → szűrők → jobbra darabszám). A kliens-név kikerült: a sidebar minden képernyőn kiírja.
- **Sidebar:** a kliens-név `Link` a `/`-ra. Dashboard menüpont **nem** kell (user döntése).
- `shareItemCount` kikerült a share-galleries route-ból `lib/share-metadata.ts`-be (két hívó).
- **Bump:** `6.43.0` → **`6.44.0`** (minor).

### 2026-09-01 — Product filter mindenhol: all/none + darabszámok — 6.45.0
- **User:** „filter gombok közé kéne egy product filter mint a matrixnál, amibe kéne egy olyan mint a statuszban hogy all none, és termékenként megjelölni kicsi szürke számmal a dco nondco mc és creative számokat, in fact a matrix és több product filterbe is jó lenne egy ilyen".
- **A `MultiPill` kapta a bővítést, nem minden hívó külön:** az `optionCounts` értéke lehet **szám vagy szám-tömb** (több dolog egy opció mellett, ponttal elválasztva), és `countLabels` nevezi meg a szegmenseket a tooltipben. A `STATUS_QUICK_SELECT` átnevezve **`ALL_NONE_QUICK_SELECT`**-re — sosem a státuszról szólt, és most hat szűrőn van rajta.
- **Hol lett all/none + darabszám:** dashboard (új), matrix (DCO · nonDCO), creative library (DCO · uploaded), feeds, assets, monitoring (sima sor-darabszám).
- **DCO vs nonDCO definíciója (a mátrix tengelyétől örökölve):** `audiences.channel == null` → DCO; `!= null` → nonDCO, és ott a **termék a topic-kulcs prefixéből** jön, mert a channel-audience-ek termék-agnosztikusak. ⚠️ **Erstében ma 0 channel-audience van (mind a 180 `channel = null`)**, ezért a nonDCO oszlop mindenhol 0 — ez helyes adat, nem hiba; a teszt viszont lefedi a nonDCO ágat, hogy amikor jön ilyen adat, működjön.
- **A darabszám az EGÉSZ könyvtárra megy, nem az ablakra** (a státusz-darabszámmal ellentétben): egy termék-választót azért néz meg az ember, hogy eldöntse, hova nézzen — csendes napon a nullák haszontalanok lennének. A `MultiPill` doksija eddig is kimondta, hogy a saját szűrője ELŐTT kell számolni.
- **Dashboard-szűrés:** a `?p=SZK,VAL` a csíkot és a feed-panelt szűkíti — az a két panel, aminek a sorain van termék. Az activity, a shares és a Library-összegek érintetlenek (nincs rajtuk termék). ⚠️ **A két forrás máshogy éri el a terméket:** a kreatívnak saját `product` oszlopa van, a cellának az audience-én lóg (subquery az audience-kulcsokra).
- **Teszt:** új `dashboard-products.test.ts` (4) + a csík product-szűrő tesztje. Suite **648/648 zöld**.
- **Bump:** `6.44.0` → **`6.45.0`** (minor).

- **DEPLOYOLVA 6.44.0 + 6.45.0 (2026-09-01):** `c201838` (shares panel, toolbar-fejléc, sidebar-link) és `8459c12` (product filter), build 34.7s / 39.0s, `pm2 restart` → Ready 1378ms / 1301ms, box `package.json` **6.45.0**. Séma-migráció egyikhez sem kell. Health mindkettő után: `/` 307, `/matrix` 307, `/shares` 307, `/creative-library` 307.

### 2026-09-01 — „mi az a 0-ás oszlop középen?" + toolbar-sorrend — 6.45.1
- **User kérdése volt a bizonyíték arra, amit előző körben tudtam, de nem javítottam:** a nonDCO oszlop minden terméknél 0 (nincs channel-audience Erstében), és egy csupa-nulla oszlop csak kérdést szül. **`trimEmptyCountSegments`** (`lib/count-segments.ts`): ha egy szegmens MINDEN opciónál nulla, kiesik — a `countLabels` vele együtt. Magától visszajön, amint lesz ilyen adat. Ugyanez a mátrixban (DCO · nonDCO) és a Creative Library-ben (DCO · uploaded). Az utolsó szegmens sosem esik ki.
- **Toolbar-sorrend (user):** product a cím után, a nap-scope jobbra a dátum mellé.
- **⚠️ Menet közben talált hiba:** a nap-léptető és a Today/Yesterday/7 days linkek **nem vitték tovább a `?p=`-t**, tehát egy napváltás némán törölte a termékszűrőt. Most minden scope-link (és az üres állapot „try the last 7 days" linkje is) viszi.
- **Teszt:** `count-segments.test.ts` (5) + a product-inventory tesztek a vágott alakra írva. Suite **653/653 zöld**.
- **Bump:** `6.45.0` → **`6.45.1`** (patch).

- **DEPLOYOLVA 6.45.1 (2026-09-01):** commit `6893831`, build 35.4s, `pm2 restart` → Ready 1457ms, box `package.json` **6.45.1**. Health: `/` 307, `/matrix` 307.

### 2026-09-01 — Monitoring import: 3 hiba a július/augusztus riporton — 6.46.0
**Tünet:** `/monitoring` feltöltés előbb 422 („Could not read Reporting Period From/To"), majd 502 (`Unexpected token '<', "<html> <h"…` = nginx hibaoldal, tehát a node process meghalt a kérés alatt).

**Bizonyított okok:**
1. **Front Page oszlop-eltolás.** Az igazi AdForm export A oszlopa üres (címke B-ben, érték C-ben); a generált fájlokban a címke az A-ban van. A `readPeriod` fixen `row[1]`/`row[2]`-t olvas (`src/lib/adform-report.ts:277`) → üres periódus → 422.
2. **Insert bind-paraméter plafon.** A `values`-ban **20 oszlop/sor**, a postgres.js hard limitje **65 534 paraméter** → **max 3 276 sor egy statementben**. Mért aggregált sorszám: június **3 364**, július **3 574**, augusztus **5 785**. Élő próbával (tranzakció + rollback) igazolva: 3 364 és 5 785 → `MAX_PARAMETERS_EXCEEDED`. **A júniusi újratöltés is elhasalna ma** — a meglévő 3 364 soros júniusi adat még a `size` aggregációs kulcsba vétele előtti importból van.
3. **Parse-memória (valószínű, nem bizonyított a crashre).** A generált fájlokban **nincs `sharedStrings.xml`** — minden ismétlődő kampánynév inline. Kicsomagolva: június 52 MB XML / 94k sor, július 118 MB / 112k, augusztus **136 MB / 130k**. Peak RSS a parse alatt: 549 / 767 / **905 MB**. A boxon 3,8 GB RAM, ~1,5 GB már használatban, 5 app fut. Kernel-OOM logot nem találtam, de a process 18:49-kor némán újraindult a POST alatt.

**Terv:**
- [x] 1. `readPeriod` pozíciófüggetlen: a `Reporting Period From/To` címkét a sor **bármelyik** cellájában keresse, és a rá következő nem üres cellát vegye értéknek. Mindkét alak megy utána.
- [x] 2. Az insert **darabolása** (1000 sor/statement) a meglévő tranzakción belül. Ez a globális „row caps" szabály write-oldali párja.
- [x] 3. Unit teszt mindkettőre: (a) behúzás nélküli Front Page, (b) 4000+ soros insert egy tranzakcióban (integration).
- [x] 4. Memória: **elfér, nem kell hozzányúlni.** Élesben mérve az augusztusi (legnagyobb) fájl importja alatt: app RSS **1 085 MB peak**, a boxon a szabad memória **1 486 MB**-ig ment le, a process nem indult újra (restart-számláló 98-on maradt), a kérés után visszaesett 519 MB-ra. ⚠️ **A tartalék vékony:** ha a riport tovább nő, vagy a boxon több app fut, ez elfogyhat. Ha egyszer 502-t adna, a sorrend: (a) generátor írjon `sharedStrings`-et (feleannyi XML), (b) SheetJS `dense: true` (835→718 MB mérve).
- [x] 5. Bump + CHANGELOG + deploy.

**Eredmény:**
- `valueAfterLabel()` (`adform-report.ts`): a címkét a sor bármelyik cellájában megtalálja, értéknek a rá következő nem üres cellát veszi. Mindhárom igazi fájl periódusa kiolvasható: `01/06`, `01/07`, `01/08` → `30/06`, `31/07`, `31/08`.
- `INSERT_CHUNK = 1000` az import route-ban, a meglévő tranzakción belül (a periódus-csere így továbbra is atomi). Aggregált sorszám a három fájlon: **3 364 / 3 547 / 5 733** → 4 / 4 / 6 statement.
- ⚠️ **A bind-paraméter plafon eddig is ott volt, csak nem ütköztünk bele:** 20 paraméter/sor × 3 276 sor = a limit. A júniusi 3 364 sor már fölötte van — az adat még a `size` aggregációs kulcsba vétele előtti importból származik, egy mai újratöltés elhasalt volna.
- **Teszt:** új `api/monitoring-import.test.ts` (2 route-szintű eset: 3 500 aggregált sor importja + újratöltés-csere) — mindkettő `MAX_PARAMETERS_EXCEEDED`-del bukik a javítás előtti kódon, ellenőriztem. `adform-report.test.ts` +1 (behúzás nélküli Front Page). Suite **656/656 zöld**.
- **Bump:** `6.45.1` → **`6.46.0`**. (Szigorúan véve két bugfix, tehát patch is védhető lett volna; a jóváhagyott terv minorra szólt, azt tartottam.)

**Élesben ellenőrizve (2026-09-01 19:21 / 19:23):** július és augusztus is bement.

| időszak | sor | matched | impr | cost | fájl Dashboard impr | eltérés |
|---|---|---|---|---|---|---|
| 01/07 | 3 547 | 2 920 | 15 508 359 | 20 697 514 | 15 510 180 | 1 821 |
| 01/08 | 5 733 | 5 024 | 20 051 365 | 35 883 108 | 20 053 243 | 1 878 |

Az eltérés a **kihagyott DEFAULT/brand sorok** (454 / 439) — nincs a PMMID-jükben `-m_`/`-v_`, tehát egyetlen cellához sem tartoznak. Szándékos, nem veszteség.

---

## 2026-09-01 — I1.7 dashboard-chartok + I1.8 activity product-szűrés — 6.47.0

**User:** „a top left two tiles are redundant, az adat a nagyobb panelekben van, de szeretnék jó kinézetű monitoring chartokat a dashboard felső sorába" · „az activity pane is legyen időszakasz és product filtered (it seems to be only time filtered)".

- [x] **I1.7 teljes** — a felső sor: `DeliveryTrend` + `CoverageTile` + a megmaradt `FreshnessTile`. Új: `src/lib/dashboard-monitoring.ts` (`monthlyDelivery`, `monthLabel`, `compactNumber`), `src/lib/period.ts` (`periodDateKey` az `mcp.ts`-ből kiemelve), `_dashboard/DeliveryTrend.tsx`, `_dashboard/CoverageTile.tsx`.
- [x] **I1.8 teljes** — `activityDigest` átköltözve `src/lib/dashboard-activity.ts`-be (a `dashboard-creatives.ts` / `dashboard-products.ts` mintájára; a `page.tsx`-ben privát volt, így tesztelhetetlen), + `productScoped()` row-constructor IN feloldó.

**Amit az adat mondott (prod DB, ellenőrizve):**
- 4 havi periódus: máj 8,34 M → jún 12,14 M → júl 15,51 M → aug 20,05 M impression (+29 % MoM). CTR (valós sorok): 0,235 / 0,227 / 0,338 / 0,294 %.
- **Lefedettség romlik:** 45 % → 78 % → 46 % → **35 %**. Nem a mátrix romlott, a nem-matchelt publisher-volumen nő (aug 20 M-ból 10,9 M nem-matchelt).
- **`size='1x1'` csapda igazolva:** augusztusban 0 impression mellett 445 366 klikk és 17,9 M Ft költség. A `monthlyDelivery` `impressions > 0`-val szűr.
- **SZK-szűrés az activityn:** 1452 `messages:update` az 5344-ből — ebből **179 sor csak a `coalesce(audience.product, topic-prefix)` miatt jön be** (a `ch_disp`/`ch_soc` cellák).

**⚠️ KORREKCIÓ (ugyanaznap, a `channels` tábla felfedezése után):** először azt írtam, hogy a 688 `ch_disp`/`ch_soc` cella „hiányzó audience-sorokra hivatkozik", és hogy a 6.45.1 fixe a tünetet takarta. **Mindkettő téves.** A csatornák szándékosan külön táblában (`channels`, `schema.ts:207`) élnek a 2026-08-17-i szétválasztás óta, és tényleg nincs channel-*audience* — a 6.45.1 megfogalmazása helyes volt. Ami valóban nyitott: a `dashboard-products.ts:58` nonDCO-ága még a régi `audiences.channel != null` alakra van írva, ezért a ProductFilter nonDCO-számlálói 0-k. Külön döntés, lásd I1.8.

**Teszt:** `tests/integration/dashboard-monitoring.test.ts` (7 — 1x1-kizárás, évfordulós rendezés `01/12/2025` vs `01/01/2026`, newest-n, matched-impressions, kliens-izoláció, üres sorozat) + `tests/integration/dashboard-activity.test.ts` (7 — product-szűrés, `ch_*` topic-prefix feloldás, product nélküli entitástípusok kiesése, nem-numerikus `entity_id`, törölt entitás, `topics.product` fallback, scope+kliens). Suite **670/670 zöld** (656 → +14). `npm run build` sikeres.

**Vizuális ellenőrzés:** a két csempe `renderToStaticMarkup` + playwright screenshottal ellenőrizve él adaton. Első körben a coverage %-sor a ratio-bar tengelyének látszott → átírva a delivery-vel azonos oszlop-nyelvre (fix 0–100 %-os skálán), így a felső sor egy vizuális nyelvet beszél.

**Verzió:** `6.46.0` → **`6.47.0`** (minor). Séma-migráció nincs. **Deploy még nem történt.**

---

## 2026-09-01 (folytatás) — W3.i monitoring periódus-tartomány — 6.48.0

**User:** „kell a periódus-selector később? van 4-5 hónap adatunk, tök jó lenne tetszőleges ezen belüli periódusból elemezni."

**Az én tévedésem, kétszer, ugyanabban a szálban:**
1. Azt írtam, „amíg egy periódus egy hónap, az összevonás semmit nem ad a mostani választóhoz képest". **Téves** — a mai route pontosan EGY periódust ad, több hónap együtt-nézése más képesség, és az adat támogatja.
2. Azt írtam, a forrás XLSX-ben nincs nap-dimenzió, ezért az AdForm report buildert kellene átállítani. **Téves** — a nap ott van minden sorban, a parser dobja el. Részletek + mérés: **W3.j**.

**Szállítva:**
- `/api/monitoring?from=&to=` — összefüggő szelet a periódus-listából, mindkét marker inkluzív, tetszőleges sorrendben adható (a route `min`/`max`-szal normalizál). Alap változatlanul a legfrissebb egy periódus. Sorok szerver-oldalon aggregálva a `(platform, product, size, message_id, match_level, audience_key, topic_key, mc_number, mc_variant)` kulcsra; a `messages.name`/`status` **explicit benne a GROUP BY-ban** (a `monitoring.message_id`-hez kötődnek, nem a `messages.id`-hez, tehát Postgres nem tudja levezetni — a régi PG-dialect csapda).
- Új `mcTrend` a payloadban: `(mc, periódus)` → impr/klikk, ~1 068 sor a teljes történetre.
- `MonitoringTable`: két select (`__period-range`), „N periods summed" jelzés 1-nél több periódusnál.
- `MonitoringDetailDialog`: új `__periods` tábla (periódusonkénti impr/klikk/CTR), csak több-periódusos tartománynál.
- Periódus-lista rendezése `periodDateKey`-re (évforduló-bug).

**Miért nem nő a payload:** 4 periódus = 15 646 tárolt sor, de **6 227** különböző kulcs → a teljes történet ~akkora nézet, mint ma az augusztus (5 733). Mérve.

**Teszt:** `tests/integration/api/monitoring-range.test.ts` (10 — alapértelmezett egy periódus, összegzés kulcsra, CTR újraszámolás nem átlag, fordított markerek, kulcs-szétválasztás, évfordulós sorrend, ismeretlen marker fallback, `mcTrend` alak, kliens-izoláció, üres payload). Suite **680/680 zöld** (670 → +10). Build sikeres.

**Verzió:** `6.47.0` → **`6.48.0`** (minor). Séma-migráció nincs. **Deploy még nem történt** (6.47.0 sem).

---

## 2026-09-01 (folytatás 2) — W3.j nap-grain ingest — 6.49.0

**User:** „megvan" (a jún/júl/aug riportfájl) → „mehet".

**Szállítva:** `monitoring.day` (`text notNull default ''`, ISO `YYYY-MM-DD`), migráció **`0010`** — unique index bővítve `day`-jel + új `monitoring_client_day_idx`. A `parseAdformReport` kiolvassa a `Date` oszlopot (`periodDateKey`-vel ISO-ra normalizálva) és beveszi az aggregációs kulcsba; az import-route átvezeti. `Date` oszlop nélküli riport `day=""`-vel importál, változatlanul.

**Mérve valódi fájlokon (nem becslés):**

| | ápr | máj |
|---|---|---|
| nyers sor | 85 222 | 83 905 |
| periódus-grain (régi) | 3 244 | **3 002** |
| **nap-grain (új)** | **73 488** | **67 749** |
| parse | 2,26 s | 2,11 s |
| impressions összeg | 10 029 134 | **8 335 352** |

A májusi 3 002 sor és a 8 335 352 impresszió **pontosan** a ma tárolt érték → a parse nem veszít és nem duplikál. Insert (teszt-PG, 68 chunk × 1000): **5,0 s**. Aggregátum egy teljes nap-grain periódus fölött: **15 ms**. Egy hónap importja tehát ~7 s — kézi feltöltéshez bőven jó.

**Amiért nem tört el semmi:** minden mai olvasó periódusra csoportosít. Erre külön teszt van, ami ugyanazt a riportot **összecsukva ÉS naponta** importálja, és a `monthlyDelivery` + `/api/monitoring` kimenetét összehasonlítja — azonos.

**A két bukó unit teszt nem regresszió volt:** a `tests/unit/adform-report.test.ts` fixture-jében ugyanaz az MC1a két különböző napon szerepel, tehát most helyesen két sor. A tesztet úgy írtam át, hogy a **változást mutassa**: napi sorok külön assertálva, plusz egy assert, hogy a két nap összege továbbra is a régi 150/5/15/1.

**Teszt:** új `tests/integration/api/monitoring-day-grain.test.ts` (4) + `adform-report.test.ts` frissítve. Suite **684/684 zöld** (680 → +4). Build sikeres.

**Verzió:** `6.48.0` → **`6.49.0`** (minor, séma-migrációval).

**⚠️ Nyitva — `W3.j-6`, a useré:** a 4–5 riportfájl újratöltése a Monitoring feltöltőjén. Amíg egy periódus nincs újratöltve, az `day=""`-vel, összecsukva marad — ez nem hiba, csak azon a periódison nem lesz napi bontás. **Deploy: a migráció + kód egy passzban kell a boxra** (`npm run db:migrate` + build + `pm2 restart`), és három verzió megy ki egyszerre: 6.47.0 + 6.48.0 + 6.49.0.

**Menet közbeni korrekció:** kiderült, hogy létezik a `channels` tábla (`schema.ts:207`, 2026-08-17-i szétválasztás, 6 sor: ch_disp/soc/prg/gsn/gnw/yt). Az I1.8-nál tett állításom, hogy a 688 `ch_disp`/`ch_soc` cella „hiányzó audience-sorokra hivatkozik" és hogy a 6.45.1 fixe „a tünetet takarta", **téves volt** — a nonDCO csatornák szándékosan külön táblában élnek. A kód viselkedése helyes maradt (a nonDCO product a topic-prefixből jön, mert a csatornának nincs productja), csak az indoklás volt rossz; a kommentek, a teszt neve, a CHANGELOG és az I1.8 jegyzet javítva.

**DEPLOYOLVA 6.47.0 + 6.48.0 + 6.49.0 (2026-09-02):** commit `9dab838`, push origin main, box `6a7bcbd`→`9dab838`, box `package.json` **6.49.0**.
- **Séma-migráció `0010` LEFUTOTT a boxon** (`npm run db:migrate` → „migrations applied successfully"), a kóddal egy passzban, build + restart előtt. Ellenőrizve: `monitoring` **15 646 sor / 56 035 192 impresszió / 4 periódus — a migráció előtti értékkel azonos**, semmi nem veszett el. Új `day` oszlop: `text NOT NULL DEFAULT ''`. Mind a 15 646 meglévő sor `day=''` (összecsukva) — ez a helyes állapot újraimportig. Indexek: `monitoring_client_day_idx` létrejött, `monitoring_client_period_key_idx` újra létrehozva a `day`-jel.
- `npm run build` **Compiled successfully 36.3s**, 58/58 static page. `pm2 restart mm6-erste` → **Ready 1283ms**, online.
- Health (localhost:6001): `/` 307 · `/login` 200 · `/matrix` 307 · `/monitoring` 307 · `/feeds` 307 · `/mcp` 401 · `/api/monitoring` 401 · `/api/dashboard/creatives` 401. Publikus hoston (`erste.messagingmatrix.ai`): `/` 307 · `/login` 200 · `/monitoring` 307.
- A logban látszó „Failed to find Server Action" sorok **04:50-esek, a deploy (08:13) ELŐTTIEK** — elavult action-id-t hívó régi böngészőfül, nem ebből a kiadásból.
- **Böngészős smoke a userre vár:** (1) dashboard felső sor — Delivery + Matrix coverage csempe valós számokkal; (2) product-szűrő az Activity panelen; (3) Monitoring periódus-tartomány két selecttel + „N periods summed"; (4) egy MC detail dialógusa több-periódusos tartománynál (periódus-bontó tábla).
- **Nyitva marad `W3.j-6`:** a 4–5 riportfájl újratöltése a Monitoring feltöltőjén — enélkül a napi bontás nem jelenik meg (a `day` oszlopot amúgy sem olvassa még semmi).

---

## 2026-09-02 — I1.9–I1.11 dashboard: product-szűrés mindenütt, 30 napos scope, CTR-rendezés — 6.50.0

**User (három kérés egy menetben):** „a library is legyen product filter érzékeny és a felső report sor is" · „legyen last 30 nap is az idő filter gombok között" · „a creative sliderben meg kéne az open helyett egy order by: time / ctr (ctr values under 100k impression filtered out, only matched)".

**Mérések, amik döntöttek (prod DB):**
- **Coverage productonként (2026. aug):** `(nincs product)` 10 942 699 impr / **0 %** matched · SZK 85 % · HK 100 % · SZA 74 % · VAL 58 % · HITEL 0 %. A szűretlen 35 %-ot a product nélküli publisher-blokk húzza le → bármelyik productra szűrve 58–100 %. Helyes, de **más populáció** — a CHANGELOG kiírja.
- **CTR-küszöb hatása:** 100 e impresszió felett **74 MC** minősül; ebből egy **7 napos ablakban 9** MC és **0 feltöltött kreatív**. Ezért dobja el a CTR-rendezés a nap-ablakot (all-time), különben a nézet gyakorlatilag üres lenne.

**Szállítva:** `monthlyDelivery(clientId, n, products)`; `entityCounts` → `libraryCounts(clientId, products)` a `dashboard-products.ts`-ben; közös `messageProduct` SQL-kifejezés (a `productScoped` is erre kötve — a DCO/nonDCO szabály ne éljen két másolatban); `count-tile__note` a Text formattingon; `ScopeRange` + `RANGE_SPAN` a 30 napra; `panel__action` slot; `creative-sort` váltó; `mcPerformance()` + `CTR_MIN_IMPRESSIONS` a `dashboard-creatives.ts`-ben; `?cs=` az oldalon és a strip API-n.

**Teszt:** új `dashboard-library-counts.test.ts` (6) + `dashboard-creatives-ctr.test.ts` (8) + 2 új `monthlyDelivery` eset + 2 új `day-scope` unit eset. Suite **702/702 zöld** (694 → +8, illetve 684 → +18 a nap eleje óta). Build sikeres.

**Egy saját teszt-hiba, nem kód-hiba:** a CTR-tesztek először üres listát adtak, mert a fixture csak `match_level`-t állított. A „matched" a `message_id IS NOT NULL` — ugyanaz, amit a Monitoring tábla Matched szűrője ért alatta. A fixture javítva (valódi `messages` sorral), a kód nem változott.

**Verzió:** `6.49.0` → **`6.50.0`** (minor). Séma-migráció nincs. **Deploy még nem történt.**

---

## 2026-09-02 (folytatás) — Monitoring toolbar-átrendezés, közös feltöltő-shell, MC-számláló — 6.51.0

**User:** „itt nem kell a report period label" · „az all/matched/unmatched view kapcsoló kimehet a jobb oldali side toolbarba felülre, az upload meg mehet alulra" · „ez az upload metódus tök jó, lehetne ilyen az assets és a creative upload is, de úgy hogy ha toolbar össze van csukva akkor gomb megnyitja nagyban az upload drag-and-dropot, ha nyitva akkor egyből ott a drop zone" · „a librarynál azt kéne kiírni a messages helyett hogy hány különböző, variánsokkal együtt MC-nk van".

**Szállítva:**
- `Report period` label törölve — a két dátum-select önmagát magyarázza.
- A match-szűrő kikerült a `MonitoringMatchFilter`-be, a jobb toolbar tetejére (`Rows` szekció). Az állapot a `MonitoringView`-ba emelve, mert a kontroll a railben van, a sorok meg a táblában. Összecsukva három ikon (`List` / `Link2` / `Unlink2`), a `LibraryViewSwitcher`/`ArchiveToggle` collapsed-nyelvén.
- Az upload a rail aljára került (a tartalom flex-oszlopba csomagolva, mint az Assetsnél — enélkül az `mt-auto` nem ér le).
- Új közös `_components/ToolbarUpload.tsx`: összecsukva a régi primary ikon-gomb (a lap saját dialógusát nyitja), kinyitva drop zone. **Nincs benne upload-logika** (`onActivate` + `onFiles`), mert mindhárom hívó mást csinál a fájlokkal: Monitoring közvetlen import, Assets a metaadat-dialógus (`setDroppedFiles` + `setUploadOpen`, a plumbing már megvolt), Creative Library az upload-queue (`queue.addFiles`).
  - **`mt-auto` a hívóé, nem a komponensé** (az `ArchiveToggle` mintájára): az Assets/CL railben az `ArchiveToggle` már kéri, és két `mt-auto` szétosztja a szabad helyet ahelyett, hogy fölöttük gyűlne össze — emiatt csúszott először középre a „Show archived".
- **Library `Messages` → `MCs`.** A `messages` sor **cella**, nem MC: egy MC annyi cellában él, ahány audience-e van (MC316a **43** cellában). Mérve: **2 753 sor → 635** különböző (szám, variáns), SZK-ra szűrve 1 381 → 209. A csempe a 635-öt írja, alatta jegyzetben `in 2,753 cells` — a régi szám kontextusként megmarad, nem tűnik el.

**Teszt:** `dashboard-library-counts.test.ts` +1 eset (egy MC két audience-en + egy második variáns → 6 cella, 5 MC; a régi számlálással elbukna), a többi `mcs`/`messageCells`-re átírva. Suite **703/703 zöld**. Build sikeres. Vizuálisan ellenőrizve lokális prod buildben mind a négy felület (monitoring nyitva+csukva, assets rail, library csempék).

**Verzió:** `6.50.0` → **`6.51.0`** (minor). Séma-migráció nincs. **Deploy: sem a 6.50.0, sem a 6.51.0 nincs kint.**

**DEPLOYOLVA 6.50.0 + 6.51.0 (2026-09-02):** commit `5fbbdf2`, push origin main, box `9dab838`→`5fbbdf2`, box `package.json` **6.51.0**.
- **Séma-migráció NINCS** egyik verzióban sem (`git diff --name-only 6ca011a..5fbbdf2 -- db/migrations` üres) — a `0010` a 6.49.0-val már kiment. Ellenőrizve deploy után: `monitoring` **15 646 sor / 56 035 192 impresszió**, változatlan.
- `npm run build` **Compiled successfully 37.7s**, `pm2 restart mm6-erste` → **Ready 1325ms**, online.
- Health (localhost:6001): `/` 307 · `/login` 200 · `/matrix` 307 · `/monitoring` 307 · `/assets` 307 · `/creative-library` 307 · `/feeds` 307 · `/mcp` 401 · `/api/monitoring` 401 · `/api/dashboard/creatives` 401. Publikus hoston: `/` 307 · `/login` 200 · `/monitoring` 307 · `/assets` 307.
- **Böngészős smoke a userre vár:** (1) dashboard product-szűrő → felső sor + Library csempék együtt mozognak; (2) `Last 30 days`; (3) kreatív-csík `Time`/`CTR` váltó; (4) Monitoring jobb toolbar nyitva/csukva (Rows felül, upload alul); (5) Assets és Creative Library drop zone nyitott railnél, gomb csukva; (6) Library `MCS 635 · in 2,753 cells`.
- **Nyitva marad:** `W3.j-6` (a 4–5 riportfájl újratöltése a napi bontásért) és az archivált sorok kérdése a Library-számlálókban.

---

## 2026-09-02 (folytatás) — nonDCO videó-preview + méret-görgetés — 6.52.0

**User:** „a nonDCO creak között a videó megjelenítése nem megy" · „jó lenne az azonos nevű de más méreteket egy pöttyként megjeleníteni" · „ha preview box felett scrollozok vagy swipolok akkor pörgesse a méret választó opciót körbe-körbe".

- [x] **Videó-preview — GYÖKÉROK, nem tünet:** a `PreviewPane` a `staticImage`-et **feltétel nélkül `<img>`-ként** rendereli (`:212`), de a nonDCO kreatív lehet `.mp4` → az `<img>` az alt-szöveget mutatja a sakktábla-háttéren. Pontosan ez látszott a képernyőképen (`ERSTE_SZK_MC104_a_fuggoagy_halfBg_n1_480x480.mp4`). Kiterjesztés szerint választ `<video>`-t, az asset-previewk bevett kezelésével (`controls` / `preload=metadata` / `muted` / `playsInline` / `#t=0.1`).
  - **Nem írtam negyedik kiterjesztés-listát:** a `parse-filename.ts` `EXT_TYPE` mapja (amivel az importer osztályoz) kapott egy `mediaKindFromFilename` exportot. 3 unit teszt (kis/nagybetű, pontot tartalmazó könyvtárnév ≠ kiterjesztés, ismeretlen kiterjesztés → null).
- [x] **Méret-körbeléptetés a preview fölött:** wheel + touch-swipe, mindkét végén körbefordul. A wheel listener **kézzel, `passive: false`-szal** van felkötve — React `onWheel`-je passzív, `preventDefault` nélkül a mögötte lévő lap is görögne. A viewport maga sosem görgethető (`overflow-hidden`), tehát nem veszünk el valódi gesztust. Trackpad-burst ellen 60px küszöb + 220ms cooldown.
- [ ] **„Azonos nevű, más méret = egy pötty" — MÉG NEM CSINÁLTAM MEG, kérdés a userhez.** A felmérés mást mutat, mint amire a kérés szó szerint utal:
  - **Egy nonDCO cellán belül NINCS azonos nevű, méretben eltérő duplikátum** (0 csoport, mérve). A méretek már ma össze vannak vonva: egy MC-hez több `creatives` sor tartozik méretenként (MC311a: 32 méret), és a preview méret-választója ezeket listázza.
  - **Ami valójában sokszorozódik: a VARIÁNSOK.** Az MC97 `a…o` variánsai egyenként **egy-egy méretet** jelentenek ugyanabból a kreatívból: a/b/l 970x250, c 1080x1080 + 640x640, e 160x600, f 300x250, g 300x600, h 468x120, j 640x360, m 970x90, n/o 1080x1080 + 960x1200. Mind a 12 ugyanabban a cellában ül, azonos alapnévvel → 12 pötty.
  - ⇒ A kérés teljesítése **a variánsok összevonását** jelentené egy pöttybe, ami átírja, mit jelent egy pötty a mátrixban (kattintás melyik variánst nyitja? kijelölés? DCO-ra is vonatkozzon?). Ezt nem döntöm el magamtól — a `project_mc_numbering_rules` szerint a variáns tengely jelentéshordozó.

**Teszt:** `parse-filename.test.ts` +3. Suite **706/706 zöld**. Build sikeres.

**Verzió:** `6.51.0` → **`6.52.0`** (minor: hibajavítás + új interakció). Séma-migráció nincs.

## Checkpoint 2026-09-03 — MM6 képesség-térkép a workflow-tervezéshez (docs-only)

Új doksi: **`docs/MM6_PURPOSE_STATE_CAPABILITIES.md`** (392 sor). Cél: input annak az agentnek, amelyikkel a user az új ERSTE munkamódszert dolgozza ki. Kódot nem érintett.

Tartalom: fogalom-szótár (MC / audience / topic / channel / DCO-nonDCO / PMMID / tengely) · mai állapot · 11 menüpont képességei + Settings 10 fül + editor 5 fül · 49 MCP tool read/full bontásban · kimenetek · **őszinte hiánylista** · a tervezett workflow 11 lépésének leképezése.

**A legfontosabb feltárt tény: NULLA Google-integráció van a kódban.** Nincs `googleapis` függőség; a `GOOGLE_SERVICE_ACCOUNT_JSON` szerepel a `.env.example`-ben, de **sehol nem olvassuk** (0 találat `src/` + `scripts/`); nincs Sheets route (csak XLSX). ⚠️ Névcsapda: az `/api/drive/proxy/[filename]` **nem** Google Drive — v5-örökség név, a saját MinIO/lemez bájtjait szolgálja ki (a template.json hard-kódolja a `path-messagingmatrix` előtagot). A tervezett workflow 4 lépése Google-alapú → ma mind kézi.

**További hiányok:** nincs task/brief életciklus-entitás (de van `messages.brief` oszlop + a 11 értékű `status` ami de facto már állapotgép) · az approve nem zárja a kört (share-komment ✅, de nincs approve-állapot; a `messages.status=APPROVED` külön él) · nincs link-mező külső dokumentumhoz (a slide-URL ma csak `comment`/`brief` szabad szövegbe fér) · nincs kreatív↔cella auto-párosítás · nincs mappa-figyelő ingest.

**Mérleg:** a hurok 11 lépéséből **7 működik ma**, 2 részleges, 4 hiányzik — és mind a 4 vagy Google-integráció, vagy task-entitás.

**Javaslat a doksiban (11.2):** a slide-kapcsolatra először a minimális út — egy link-mező (`messages.brief_url` nullable VAGY `message_links` sidecar), és minden Google-művelet MM6-on kívüli agent-lépés. Valódi Google-integráció csak akkor, ha a hurok egy hónapig működött és a fájdalom konkrét. Az MC-kreálás nem hiány, hanem döntési fa (mindhárom út él: `mc_create` / `creative_promote` / `generate_test_creative`) — nulla kód.

**Következő:** a doksi + a majdani workflow-terv két thoughtként megy a brainbe (user kérése).

**⚠️ KORREKCIÓ a fenti checkpointhoz (user jelezte menet közben): NEM igaz, hogy „nulla Google-integráció" — csak a mai KÓDRA igaz.** A `tasks/todo.md`-ben ott az **I4 — Drive-linkek a kreatívokon** (TERV KÉSZ, 2026-09-03, építés zöld-lightra vár), lemért Drive API v3 + API-kulcs úttal (OAuth nélkül, mert a Leadás-mappák anyone-with-link), és ott az **FR-B Documents** (MC↔Slides link + státusz) meg az **FR-C ticket-inbox** is. A doksi (`docs/MM6_PURPOSE_STATE_CAPABILITIES.md`, most 479 sor) javítva:

- **9.1 átírva:** a kód-tény megmarad (nincs `googleapis` dep, nincs Sheets route, az `/api/drive/proxy` névcsapda), de mellé került az I4 teljes felmérése (két hivatkozás kreatívonként, 4 nullable oszlop ID-vel nem URL-lel, 42 fájl / 42 egyező `creatives` sor, `GOOGLE_DRIVE_API_KEY`, I4.10 = nincs új MCP tool, a `list_creatives`/`list_mc` magától mutatja).
- **9.2 + 9.4 kiegészítve** FR-C-vel és FR-B-vel; kimondva, hogy **az I4 és az FR-B külön marad** (más kardinalitás: kreatívnak 1 mappa+1 fájl, MC-nek több Slides doksi státusszal) — **a workflow „slide-kapcsolat" pontja az FR-B, nem az I4**.
- **Új 9.7:** roadmap-térkép (I4 / FR-B / FR-C / FR-A / FR-D / I1 / I6) + figyelmeztetés, hogy a `reporting` tábla üres és a `monitoring` 2026. májusi adat (utolsó import 2026-07-16) → a visszacsatolási ág ma nem friss.
- **10. fejezet táblázata + legenda** újraszínezve (`⛔ ma · 🟡 terv kész` / `🔵 tervben`); az összegzés új verdiktje: **a hurok nem 4 hiányzó képességen múlik, hanem 2 nyitott döntésen** (hol él a munkadarab állapota; hol él a Slides-link+státusz).
- **11.2 újraírva:** az eredeti „először minimális link-mező, integráció csak később" ajánlásom **elavult** — a user már tovább ment és lemérte, hogy a teljes Drive-út olcsó (nincs OAuth, nincs dep). Helyette az FR-B három nyitott kérdésére adtam ajánlást (generikus `kind`-mezős link-store; sidecar tábla, nem oszlop; és a state-kérdés a legfontosabb, mert a doksi-státusz és a `messages.status` kettőzése garantáltan szétcsúszik).

**Brain:** a doksi bement thoughtként (`6da7f5d6-43be-4537-a67f-58c3afe335eb`, „MM6 — Képességek és terv 2026-09-03"). Az első, hibás kerettel felvitt változat (`5de4bb33…`) átcímkézve ELAVULT-ra. A 2. thought (workflow-terv) akkor megy be, ha a workflow-agenttel elkészül.

---

## 2026-09-03 — I4 Drive-linkek a kreatívokon: TELJES SZÁLLÍTÁS + DEPLOY — 6.52.0 + 6.53.0

**User-kérés (szó szerint):** „minden feltöltött kreatívhoz tartozik egy drive link és egy parent drive folder link, a drive folder a fontosabb (ezt visszamenőleg is ki lehet tölteni), a file linket meg ha megadtam a folder linket akkor már ki lehet nyomozni programozottan" + share-fejlécbe a mappalinkek + minden kép/videó nézegetésnél a szülőmappa. Pontosítások: parent editálható, **file link számított és nem editálható**; a backfill darabokban, csak kreatívokra, a 600 legfrissebbre; MCP-ben nem kell külön tool, de listázáskor látszódjon.

**A terv és a tíz szelet: lásd az I4 szekciót fent** (mind `[x]`, a lemért tényekkel együtt).

**A négy mérés, ami a tervet eldöntötte (élesben, API-kulccsal):** (1) a Leadás-mappa listázása kulccsal **200 / 42 fájl** → nincs OAuth; (2) a mappa neve `files.get`-tel jön → `drive_folder_name` ingyen; (3) auth nélküli file-link **200** → külsősnek is nyílik; (4) 42 Drive-fájl ↔ **42 `creatives` sor** → a fájlnév-join tart. **Két korlát:** a kulcs **nem adja a `parents` mezőt** (fájlból nem lehet mappát visszakeresni) és **csak az anyone-with-link mappákat látja** (a MARKET-gyökér `files.get` → 404, listázás → **0 elem, nem hiba**) — ezért indul minden mappából, és ezért méri a resolver külön a mappa elérhetőségét.

**Verzió:** `6.52.0` → **`6.53.0`** (minor: 4 új oszlop + migráció `0011` + új route + új UI + MCP-mezők). Suite **749/749 zöld** (+36), `tsc` tiszta.

**DEPLOYOLVA 6.52.0 + 6.53.0 (2026-09-03):** commit `9cb2883`, push origin main, box `5fbbdf2`→`9cb2883`, box `package.json` **6.53.0**.
- **`GOOGLE_DRIVE_API_KEY` felvéve a box `/var/www/mm6-erste/.env`-jébe** (mentés: `.env.bak-20260903-drivekey`), `pm2 restart --update-env`. A boxról ellenőrizve: a Drive-listázás onnan is **200-at ad valódi fájlnevekkel** — van kifelé menő elérés a googleapis.com-ra.
- **Migráció `0011`:** a shared Postgresen már fent volt (lokálból futott a tunnelen), a boxi `db:migrate` így no-op → „migrations applied successfully". Ellenőrizve: `creatives` **3145 sor**, `drive_folder_id`/`drive_file_id` mindenhol NULL (ez a helyes kiindulás a backfill előtt).
- `npm run build` sikeres, `pm2 restart mm6-erste` → **Ready 1417ms**, online. Health (localhost:6001): `/` 307 · `/login` 200 · `/creative-library` 307 · `/mcp` 401. Publikus host: `erste.messagingmatrix.ai/login` **200**.
- ⚠️ **A `drizzle-kit` nem olvassa a `.env.local`-t** (lokálban `export $(grep '^DATABASE_URL=' .env.local)` kell a `db:migrate` elé); a boxon a `.env` miatt ez nem gond.

**Nyitva (a useré):**
- **A 600-as backfill élesben** — a mappalinkek listája kell hozzá: `ACTIVE_CLIENT_KEY=erste npx tsx scripts/drive-backfill.ts --file links.txt` (dry-run), majd `--apply`.
- **Böngészős smoke:** feltöltő queue batch-mezője · kreatív-detail mappa/file link · toolbar „Drive link check" riportja · share-fejléc mappasora.
- `docs/MM6_PURPOSE_STATE_CAPABILITIES.md` 9.1/9.7 még „I4 = terv kész, építésre vár"-t ír — frissítendő, ha a doksi tovább él.

## 2026-09-03 (folytatás) — feltöltő UX + MC-parse: 6.54.0 + 6.54.1 (DEPLOYOLVA)

**User élesben tesztelt, három lelet:** (1) „nagy ablakban nem megy a drag and drop" · (2) „kis ablakban nincs ott a bulk edit" · (3) „jó lenne ha át lehetne menni a kicsi ablakból a nagyba" · (4) „miért nem tudja kiolvasni az MC és variantot? hát tök világos a fájlnevekből" · (5) „drive check box mehet a show archived gomb alá alulra".

- **(2) nem volt hiba:** a böngészőben még a `v6.51.0` bundle futott (a sidebar verziója árulta el); reload után ott a batch-mező. Tanulság: élő teszt előtt a sidebar verziószámát nézzük.
- **(1) + (3) — a nagy ablak most a közös batch-ablak.** A Creative Library feltöltő gombja eddig az egyfájlos `UploadDialog`-ot nyitotta (nincs drop, nincs batch-mező), miközben az Assets oldalon **már létezett** a jó forma (táblázat + „Set for all" sor + drop). Ez lett közössé: `_components/BatchUploadDialog.tsx`, a `block` prop adja az osztálynév-prefixet (`asset-upload` / `creative-upload`), a **queue-t a hívó birtokolja** (`useUploadQueue`) — ezért tud a lebegő panel és a nagy ablak **ugyanarra a batch-re** nézni. A panel fejlécében új `upload-queue__expand` gomb nyitja a nagyot. Az egyfájlos dialógus + a `CreativeMetadataForm` **törölve** (elérhetetlen maradt volna).
- **(4) nem a parser hibája: a szabályok nem kérték.** A `DEFAULT_CREATIVE_PARSING_RULES` csak brand/product/type-ot definiált — MC-re és variánsra soha nem volt szabály. Két pattern-szabály került be, **a teljes élő korpuszon ellenőrizve (3145 fájlnév)**: a szám 3145/3145-ben egyezik a DB-vel; a variáns **egyetlen kisbetűt** fogad (`MC\d+_([a-z])_`) → 3097 pontos egyezés, **0 rossz**, és a maradék 48 (ahol `va`/`vc`/`px`/`bg`/`c1` áll a helyén, a könyvtár pedig `a` variánsnak veszi) **üresen marad** — rossz előtöltés helyett a user tölti ki. A négy kliens tárolt configja (mind a szállított defaulton állt) helyben frissítve → **reload után azonnal él, deploy nélkül is**.
- **(5)** A Drive link check a toolbar aljára, a Show archived alá került; a saját `px-3`-ja elhagyva (a `right-toolbar__body` már ad paddinget).

**Verzió:** `6.53.0` → **`6.54.0`** (minor: új feltöltő-ablak, közös komponens, parse-szabályok) → **`6.54.1`** (patch: toolbar-sorrend). Unit suite 238 zöld, `tsc` tiszta, build sikeres.

**DEPLOYOLVA (2026-09-03):** commit `ab8d2da` + `9f0…` (6.54.1), box `9cb2883`→`6.54.1`, build 38.2s, `pm2 restart` után `/login` 200 · `/creative-library` 307.


## Checkpoint 2026-09-04 — `MM6_PURPOSE_STATE_CAPABILITIES.md` frissítve a 6.57.0 állapotra (docs-only)

A user jelezte: **kész a Drive-integráció a leadási/preview-share ágon, most a brief-slide draft connection jön.** A doksi `6.39.0`-s állapotot írt, közben **18 minor** ment ki — nem csak a Drive-pontot frissítettem, hanem az egész doksit végigvittem. Most **536 sor**. (A `todo.md:1574` maga kérte ezt a frissítést.)

**Amit átírtam:**
- **Fejléc + 3. fejezet:** `6.39.0` → **`6.57.0`**, 613 → **749 teszt**. Új adatszámok: **635 MC 2 753 cellában** (a régi „~826 nonDCO MC" félrevezető volt — cella ≠ MC), ebből **688 nonDCO cella**, ~3 145 kreatív.
- **Új 4.0 Dashboard szakasz** (I1 leszállt: nap-scope, termék-szűrő, Delivery + Matrix-coverage chartok, CTR-rendezésű kreatív-csík) — eddig nem is szerepelt a doksiban, pedig a sidebar kliens-nevéről elérhető.
- **4.2 / 4.8 / 5. / 6. kiegészítve** a Drive-résszel (batch mappalink, health check hat kimenettel, share-fejléc distinct mappái, `drive_folder_url`/`drive_file_url`/`drive_folders` a meglévő MCP toolokon — **nem született új tool**).
- **9.1 teljesen átírva:** „nulla Google-integráció" → **„a Drive-oldal kész (6.53.0), a Slides-oldal nincs"**. Bent maradt három tartós korlát: nincs Slides/Sheets API, nincs mappa-figyelés (a link **hivatkozás, nem ingest**), és a kulcsos hívás **nem adja vissza a `parents`-et** → csak mappa→fájl irány megy.
- **9.4 + 11.2 átírva:** a kreatív-oldal kész, az MC↔Slides oldal az **FR-B**, aminek a `todo.md`-ben már konkrét lépéssora van (`documents` tábla soft-linkkel → `/api/documents/*` → MCP → vékony UI).
- **9.7 táblázat:** I4 / I1 / I6 → ✅ szállítva. **A „az adat elavult" figyelmeztetés törölve** — a monitoring 2026 augusztusáig friss (20,1M megjelenés, +29%); helyette az maradt, hogy a **mátrixhoz kötött arány 35%** (júniusban 78% volt), mert a nem matrixolt publisher-sorok nőnek gyorsabban.
- **10. táblázat:** 5. és 8b. → ✅; összegzés újraszámolva **18 sorból 11 ✅ / 2 🟡 / 5 ⛔** (a korábbi „11 lépésből 7" a részsorok miatt nem stimmelt).
- **12. kérdéssor:** a „marad-e a Leadás mappa" kérdés **megválaszoltra** állítva, és bekerült egy új kérdés (approve-állapot a share-en vagy `messages.status`) — mert az FR-B state-kérdésével együtt kell eldönteni: **hol lakik a fázis**.

**A doksi verdiktje most:** a folyamat leadási–megosztási fele kész; ami maradt (1. brief, 3. slide-link, 7. slides update, 11. task close) **két döntésre vezethető vissza** — hol él a brief-doksi linkje+státusza (FR-B), és hol él a munkadarab állapota (FR-C vs. `messages.status`).

**Brain:** a mostani frissítés **még nem ment be** thoughtként — a 2026-09-03-i `6da7f5d6` thought a `6.39.0` állapotot írja le, tehát a Drive-részben elavult. Eldöntendő: új thought a friss állapotról (a régit ELAVULT-ra címkézve, ahogy az `5de4bb33`-mal tettük), vagy megvárjuk a workflow-tervet és egyben megy be a kettő.

---

## 2026-09-04 — Dashboard: a szűrők megjegyzése — 6.58.0

**User:** „a dashboard meg kéne jegyezze a filterek beállítását, legutóbbi date filter, product filter".

**Szállítva:** `src/lib/dashboard-view.ts` (kodek + `viewHref`), `_dashboard/RememberView.tsx` (süti-író kliens), és a `page.tsx`-ben a csupasz `/` → tárolt nézet redirect.

**Két döntés, amit meg kellett hozni:**
- **Süti, nem localStorage.** A dashboard szándékosan server component, az állapota az URL — az olvasó tehát a szerver. localStorage-dzsel az alapértelmezett dashboard felvillanna, majd kliensoldalról írná át magát.
- **A PILL-t jegyzi meg, nem a dátumot.** A „Yesterday" mindig a mostani naphoz képesti tegnapot jelenti, a nyilakkal elnavigált tetszőleges nap pedig sima „today"-ként jön vissza. Egy hét múlva egy befagyasztott dátumra nyíló, üres dashboard nem preferenciának, hanem üzemzavarnak látszana.
- **Explicit paraméter mindig nyer** a megjegyzett nézet fölött (megosztott link is), és az alapértelmezett nézetért nem redirectelünk.

**Ellenőrizve böngészőben, lokális prod buildben, öt eset:** (1) friss csupasz `/` → nincs redirect; (2) nézetválasztás → süti `r=30d&back=0&p=SZK&cs=ctr`; (3) csupasz `/` → `?d=2026-09-04&r=30d&p=SZK&cs=ctr`, az aktív pill „Last 30 days"; (4) explicit link felülírja; (5) „Yesterday" → `?d=2026-09-03&r=day` a mai naphoz képest.

**Teszt:** új `tests/unit/dashboard-view.test.ts` (6 — oda-vissza kódolás, Yesterday-pill, ismeretlen süti visszautasítása, mai naphoz horgonyzás, product+sort az URL-ben, alapértelmezett felismerése). Suite **758/758 zöld**. Build sikeres.

**⚠️ Megjegyzés a session-hez:** ez a szelet a **6.57.0**-ra ült rá — a 6.53–6.57 más sessionökben készült (share phone layout, Drive ikonok, creative-library fixek), a teszt-szám időközben 706 → 752-re nőtt. A saját változtatásom konfliktus nélkül alkalmazható volt.

**Verzió:** `6.57.0` → **`6.58.0`** (minor). Séma-migráció nincs. **Deploy még nem történt.**

### 2026-09-05 — DRAFT-modell + státusz-takarítás DEPLOYOLVA (6.58.0 + 6.59.0)
- **Commit `5b1f3b6`**, box `ac3928e` → `5b1f3b6`. A **`6.58.0` sosem volt kint** (lokálban maradt), így két kiadás ment egyszerre.
- **Destruktív migráció kockázat-ellenőrzése ELŐBB** (az archívum „közös DB + eltolt deploy" szabálya miatt, a `0013` két táblát dob): a v5 appok (`mm-server-*`) **SQLite-ot** használnak (`/var/www/messagingmatrix/db/messaging-matrix.db`), **egyetlen v6 deploy** van (`/var/www/mm6-erste`), és a két dobandó tábla **üres volt**. Vagyis az egyetlen fogyasztót ugyanabban a passzban frissítettük — a szabály nem sérült.
- **Migráció `0012` + `0013` lefutott.** Ellenőrizve utána: `messages` **2753**, `creatives` **3167**, `monitoring` **15 646** — mind azonos a migráció előtti értékkel. `briefs` tábla létrejött, `draft_messages`/`draft_previews` eltűnt, mindhárom CHECK constraint áll (`messages_draft_has_no_audience`, `messages_placed_has_topic`, `messages_draft_has_no_pmmid`), `audience`/`topic`/`brief_id` nullable.
- `npm run build` ok, `pm2 restart mm6-erste --update-env` → **Ready 1621ms**, box `package.json` **6.59.0**. Health: `/` 307 · `/login` 200 · `/matrix` 307 · `/drafts` 307 · `/creative-library` 307 · `/shares` 307 · `/feeds` 307 · `/monitoring` 307 · `/api/drafts` 401 · `/api/briefs` 401 · `/mcp` 401 · publikus `erste.messagingmatrix.ai/login` **200**. Az `error.log`-ban csak a régi AWS SDK node>=22 figyelmeztetés.
- ⚠️ **`tsx` nem olvassa a box `.env`-jét** (a Next igen) — a `status:cleanup` első futása `ECONNREFUSED`-dal elszállt. Megoldás: `set -a && . ./.env && set +a &&` a parancs elé. Ugyanez érvényes minden `tsx`-es scriptre a boxon (`gen:previews`, `import-*`, …).
- **`status:cleanup` dry-run → apply.** A dry-run pontosan a felmért tervet adta, és a safety-net **0 sort** fogott (minden sor tisztán besorolódott). Törölve **12** (8× üres `MC21a`, `MC315 f/g/h/i` mint az ACTIVE `c/d/e` duplikátumai — a script megnevezte a konkrét ikret), DRAFT-ba **4** (`MC6a`, `MC78 a/b/c`, audience + pmmid + 6 UTM + final URL nullázva, a tartalom és a munkacím-topic megtartva). Retired státuszon maradt: **0**.
- **Az apply előtt mind a 16 sor JSON-mentése készült** (`~/legacy-rows-backup-20260905.json`, 28 kB) — a törlés így visszafordítható.
- Végállapot: `ACTIVE` 1768 · `INACTIVE` 959 · `DEAD` 6 · `DRAFT` 4 · `PREVIEW` 4 (2741 = 2753 − 12).
- ✅ **Lezárva 6.59.1-ben (ugyanaznap):** a `feed-export.ts` `rowKey`-jében a diff-kulcs NUL elválasztója **nyers bájtként** volt beírva escape helyett. Ettől a fájl binárisnak minősül, a `grep` pedig bináris fájlra **némán nulla találatot** ad, hiba nélkül — a lezárt feed-invariánsok fájljában ez a legrosszabb hibamód, mert nem töröttnek látszik, hanem üresnek. Escape-re átírva: a előállított string azonos, a fájl újra kereshető (`grep -c allMessages`: boxon is **0 → 5**). Feed-tesztek 26/26, teljes sor 257 + 542 zöld. Kommentben rögzítve, hogy soha ne kerüljön vissza nyers bájtra.
- ⚠️ **Mellékhatás, amit érdemes tudni:** a nyers vezérlőkarakter **a saját eszközláncomat is blokkolta** — két parancsom elszállt „command contains control characters" hibával, mert a `\u0000` a JSON-paraméterben valódi NUL-lá dekódolódik. Ha ilyet kell írni, fájlon keresztül menjen.

---

## 2026-09-06 — Draft editor = MC editor + Brief tab + Agentic átnevezés (TERV, jóváhagyásra vár)

**User kérése:** „a draft editornak úgy kéne kinézzen mint az MC editor, tabok jobb oldalt Naming helyett Promote to matrix, aztán Template, aztán Draft content, Draft styles, trafficking ide biztos nem kell; viszont az MC editorben is meg itt is kell egy Brief tab, ahol a belinkelt Google Docs slide-nak jó lenne ha lenne egy previewja — nem a fő/cover slide, hanem a konkrét belinkelt slide." + „a Promote to matrix tabon kéne legyen az is, hogy DCO-ba vagy nonDCO-ba vagy mindkettőbe promotáljuk; illetve a nonDCO-t nevezzük át Agentic-re, futtassunk okos refactort."

**Eldöntve (AskUserQuestion, 2026-09-06):**
1. **A draft editor NEM külön komponens** — a `MessageEditor` nyílik meg a `/drafts` oldalon is, más tab-készlettel. A `DraftDetailDialog` törlődik.
2. **Slide preview = Google Slides iframe embed** (`/embed?slide=id.gXXX`), nem szerveroldali PNG. Nulla backend, nincs új env. Feltétele, hogy a deck „anyone with the link" megosztású legyen — ugyanaz a feltétel, mint az I4 delivery-mappáknál.
3. **A slide-horgony per MC/draft**, új `messages.brief_slide_id` oszlop. Üres horgony ⇒ a deck elejét mutatjuk.
4. **Az átnevezés a UI-ra és az azonosítókra megy, a TÁROLT TOKEN marad `"nondco"`.**
5. **Agentic promotálásnál csak létező topic választható** — a „a promote sosem hoz létre topicot" szabály nem lazul.
6. **A Brief az utolsó tab** mindkét editorban.

**Ami ezzel ütközik és tudatosan felülíródik:** a `MatrixGrid.tsx:529` kommentje kimondja, hogy *„nonDCO MCs are born only from correctly-named creative uploads, never hand-added"*. A draft→Agentic promote ezt megszegi. A kommentet át kell írni (a promote a második törvényes születési út), nem csendben megkerülni.

**Ami NEM ez:** az **FR-B Documents** (MC-nként több Slides doksi, státusszal, saját tábla) továbbra is külön marad. Itt egy MC-nek **egy** briefje van (a meglévő `briefId` FK), és azon belül **egy** slide-horgonya. A `brief_slide_id` nem az FR-B store csírája.

### A. Brief tab (mindkét editorban)
- [ ] **A1** `messages.brief_slide_id` text nullable + drizzle migráció `0014_*`
- [ ] **A2** `slides-link.ts`: `parseSlideAnchor(link)` (a `#slide=id.gXXX` → `gXXX`) + `slidesEmbedUrl(fileId, slideId)`. A meglévő `parseSlidesFileId` NEM változik — a file id és a horgony két külön dolog
- [ ] **A3** `WRITABLE_FIELDS` += `briefSlideId`; a `MessageEditor` `EditableFields`/`EDITABLE_KEYS` += `briefId`, `briefSlideId`, `brief`
- [ ] **A4** Új `src/app/(app)/matrix/BriefTab.tsx` (a MessageEditor 2200 sora ne nőjön tovább): brief-választó a `/api/briefs` listából + „attach by link" (POST `/api/briefs`, idempotens file id-re), slide deep-link mező → parse → horgony, iframe preview a konkrét slide-ra, és a szabad szöveges `messages.brief` jegyzet
- [ ] **A5** Brief tab felvétele a tab-barba, utolsóként, mindkét módban

### B. Draft editor = MessageEditor
- [ ] **B1** Mód-diszkriminátor: `message.status === "DRAFT"` a committed snapshotból — **nem** új `mode` prop. (Két független diszkriminátor egy fogalomra szétcsúszik; a séma is a status/audience párost köti össze.)
- [ ] **B2** Tab-készlet módfüggő; draftnál az induló tab a Promote
- [ ] **B3** Új `PromoteTab`: a mai `DraftDetailDialog` promote-blokkja + working topic name + Archive. Ide jön a **DCO / Agentic / mindkettő** célválasztó (lásd C)
- [ ] **B4** `DraftsView` a `MessageEditor`-t nyitja (`visibleMessages` = a draft lista → prev/next működik a draftok közt); a `Draft` kliens-típus helyett `Message` (a `/api/drafts` már ma is teljes sorokat ad); `DraftDetailDialog.tsx` törlés
- [ ] **B5** Ellenőrizni, hogy a `MessagePreview` és a Template tab elviseli az audience nélküli sort

### C. Promote: DCO / Agentic / mindkettő
- [ ] **C1** A promote body kap egy célt: `{ target: "dco" | "agentic" | "both", audienceKey, topicKey, agenticChannelKey, agenticTopicKey }`. A `findAudienceByKey` már ma is beleés a `channels`-be, tehát az Agentic audience feloldása kész
- [ ] **C2** „Mindkettő" = **két sor**: a draft lesz a DCO cella (`promoteDraft`), az Agentic iker pedig `createMessage({ requestedNumber: draft.number })` a channel-audience-re — pontosan az az „explicit twin" út, amit a `createDraft` kommentje leír. Ez azért konzisztens, mert a draft száma eleve **mindkét tengelyen** foglalt
- [ ] **C3** A `MatrixGrid.tsx:529` invariáns-komment átírása: a promote a második törvényes születési út egy Agentic MC-nek
- [ ] **C4** Ha az Agentic topic nem létezik, a promote elutasít és megmondja, hogy előbb topicot kell létrehozni (a mai szabály változatlan)

### D. nonDCO → Agentic átnevezés (okos refactor)
272 előfordulás / 44 fájl. **Nem search-and-replace** — fájlonként, egyesével, közben `npm run build`.
- [ ] **D1** A `MatrixAxis` értéke **marad** `"dco" | "nondco"`, komment magyarázza: ez a `mm6_matrix_state_v1` localStorage-ba mentett wire token, a `MatrixGrid.tsx:248` ismeretlen értéket némán `"dco"`-ra ejt — átnevezve minden felhasználó mentett mátrix-nézete csendben visszaállna
- [ ] **D2** Látható címkék: `MatrixToolbar` (`nonDCO` → `Agentic`), `ProductFilter`, `CreativeLibrary` és `MatrixGrid` count-pill szegmensek (`["DCO","nonDCO"]` → `["DCO","Agentic"]`), `ChannelsTab` prózája
- [ ] **D3** Azonosítók: `isNonDco` → `isAgentic`, `nonDcoTopics` → `agenticTopics` — hívási helyenként olvasva, nem globálisan
- [ ] **D4** Kommentek/prózák a `src/`-ben (a `messages.ts`, `schema.ts`, `channels.ts`, `numbering.ts` stb. magyarázó blokkjai)
- [ ] **D5** Tesztek + scriptek szókincse; `docs/mc-collisions.html`+`.md` **újragenerálva** a `gen-collisions-doc.ts`-ből, nem kézzel írva
- [ ] **D6** `tasks/component-inventory.md` frissítés, ha új blokknév keletkezett (`brief-tab`, `promote-tab`, `slide-preview`)

### E. Ellenőrzés
- [ ] **E1** Unit teszt: `parseSlideAnchor` (deep link, fragment nélkül, csak `?usp=sharing`, bare id)
- [ ] **E2** Integrációs teszt: `0014` migráció + draft→Agentic és draft→mindkettő promote (a twin ugyanazt a számot kapja)
- [ ] **E3** `npm run build` + a teljes suite
- [ ] **E4** Böngészős ellenőrzés a felhasználó MC400 draftján

**Verzió-javaslat a végén:** `6.65.0` → **`6.66.0`** (minor — új oszlop + migráció, új tab, új promote-célok, felhasználó által látható átnevezés).

### ELHALASZTVA (külön szelet, a fenti terv UTÁN) — Agentic kreatív-feltöltési folyamat

**User felvetése (2026-09-06):** „nem-e ki kéne kommentelni a creative libraryba feltöltést (historikusan helyes volt a léte), de ha a munkafolyamatot jól akarjuk managelni, akkor Agentic creative-ot létrehozott drafthoz lehessen feltölteni, és az rögtön ellenőrzi a MC és terméknév helyességét; és ha új verziót akar feltölteni az ember, akkor az Agentic matrix MC megnyitása után lehessen n+1 verziót feltölteni."

**Értékelés (feltárt tények):**
1. A Creative Library feltöltés **ma nem hoz létre MC-t** — csak `creatives` sort (`CreativeLibrary.tsx:326`). Az `mcNumber`/`mcVariant` a fájlnév-parserből jön, és a batch-ablakban **szabad szöveges mező** (`CREATIVE_UPLOAD_COLUMNS`). Semmi nem ellenőrzi a szám létezését, a termék egyezését, a foglaltságot. **Ez a valódi hiba.**
2. A `promoteCreative()` egyetlen hívója a `src/lib/mcp.ts:2246` — **csak MCP-ből érhető el, a UI-ból sehonnan**. A mai Agentic sorokat a `scripts/rebuild-creatives.ts` építette közvetlen INSERT-tel (terméknként hard-delete + újraépítés).
3. A verziózás **már kész és fájlnév-vezérelt**: `group-creative-versions.ts`, `familyKey + deklarált méret` szerint; a `creatives.version` NEM használható (optimistic-concurrency számláló), egyedül a `_nN` token mérvadó.

**Verdikt:** a diagnózis jó, a „kikommentelni a library feltöltést" rész téves — az az egyetlen működő UI-s bemeneti út (3167 kreatív, tömeges beérkezés). És ha a draftra töltünk fel, **nincs mit ellenőrizni**: a draft tudja a saját MC-számát és termékét. A validáció band-aid lenne egy mezőn, aminek ebben a folyamatban nem kéne léteznie — a fájlnevet a rendszer generálja, nem a user gépeli és mi bíráljuk el.

**Helyes felosztás — a kettő nem konkurens, hanem két munkafolyamat:**
- [ ] A Creative Library feltöltés **marad** = a TÖMEGES út (ügynökség lead 200 fájlt 30 MC-re)
- [ ] A draft/MC editor kap „kreatív feltöltése ide" utat = a MENEDZSELT, darabonkénti út. **Nincs MC# mező, nincs termék mező, nincs validáció** — a fájlnév a cellából származik
- [ ] n+1 verzió az Agentic MC-ből: `max(_nN) + 1` a meglévő verzió-családból (a `by-mc` végpont és a `groupCreativeVersions` már megvan)
- [ ] ⚠️ **A lyuk, amit meg KELL csinálni:** az Agentic cella a `message.image1`-et rendereli — egy rögzített fájlnevet (`MatrixIframeTile.tsx:93`). Egy új `_n4` feltöltés bekerül a könyvtárba, de **a mátrixban nem jelenik meg**, amíg az `image1` át nem mutat rá. Enélkül a funkció néma hibaként viselkedik: „feltöltöttem, mégsem változott semmi"

---

## 2026-09-06 — Draft editor = MC editor + Brief tab + Agentic átnevezés — SZÁLLÍTVA

A fenti terv A–E szeletei lementek, plusz két menet közben érkezett kérés.

### Amit a terv tartalmazott
- **A1–A2** `messages.brief_slide_id` (nullable text) + `0014_dusty_lorna_dane.sql` (egyetlen additív ALTER). `slides-link.ts`: új `parseSlideAnchor()` + `slidesEmbedUrl()`. A meglévő `parseSlidesFileId` **változatlan** — a deck a brief identitása, a slide a kártyáé, és egyik parser sem nyelheti el a másikat (külön teszt védi).
- **A3–A5** `WRITABLE_FIELDS` += `briefSlideId`; a `MessageEditor` `EditableFields`-e += `brief`/`briefId`/`briefSlideId`. Új `BriefTab.tsx` + `EditorField.tsx` (a `Field` kiemelve a `MessageEditor`-ból, hogy két fájl ne duplikálja a label-tipográfiát). Brief tab **utolsóként** mindkét módban.
- **B1–B5** A `/drafts` a **`MessageEditor`-t nyitja**; a `DraftDetailDialog` **törölve**. A mód-diszkriminátor **`audience === null`**, nem `status === "DRAFT"` — ez a séma saját diszkriminátora (a `messages_draft_has_no_audience` check köti a kettőt össze), **és ez az, amire a TypeScript szűkíteni tud**: a fordító bizonyítja, hogy a Naming és a Trafficking tab sosem kap draftot. Új `DraftMessage`/`EditableMessage` típus a `matrix/types.ts`-ben; a `drafts/types.ts` már csak alias.
- **C1–C4** A promote route kap egy `target`-et (`dco` | `agentic` | `both`). Kimaradt `target` = a régi viselkedés (MCP és minden korábbi hívó érintetlen). **A „both" nem `createMessage(requestedNumber)`, hanem promote + `copyMessages`** — a `draft-lifecycle.test.ts:208` („the user's *image AND DCO feed row* case") ezt már 2026 augusztusa óta így oldja meg, és a copy azért helyes, mert *klónozza a mezőket*: a két tengely egy kártya marad, nem két véletlenül azonos számú. A tervbe írt `createMessage` út rossz eszköz volt.
- **D1–D6** nonDCO → **Agentic**, fájlonként. A `MatrixAxis` értéke **marad `"nondco"`** (a `mm6_matrix_state_v1` localStorage tokenje; a `MatrixGrid.tsx:248` ismeretlen értéket némán `"dco"`-ra ejt → átnevezve minden mentett nézet visszaállna). `isNonDco`→`isAgentic`, `nonDcoTopics`→`agenticTopics`, count-pill címkék, `PRODUCT_COUNT_LABELS`, MCP tool-leírások, `matrix-nondco-info`→`matrix-agentic-info` (inventory frissítve).
- **E1–E2** `slides-link.test.ts` 7 → **14 teszt**; új `tests/integration/api/drafts-promote-targets.test.ts` (**5 teszt**): default target, agentic, both (ikerpár egy szám alatt), „both channel nélkül elutasít és a draftot NEM helyezi el félig", és „nem létező topicot továbbra sem mint".

### Menet közben érkezett, szintén kész
- **Creative Library Type szűrő** → a filter box **elé** került, és a fájltípus (html/image/video) helyett **DCO / Agentic** két pipa. Ez a meglévő `kind` diszkriminátor megjelenítése (`"matrix"` = sablonrender, `"uploaded"` = leszállított fájl), nem új fogalom. **Új localStorage kulcs** (`mm6_creative_library_filter_axis`): a régi `..._filter_types` újrahasznosítása egy mentett `{"image"}`-et DCO/Agentic opciókra illesztett volna → nulla találat, üres könyvtár, „üzemzavarnak látszó" mentett preferencia. A `typeOptions` memo megmarad — a batch feltöltő Type datalistjét táplálja.
- **„Attach a brief" gomb + dialógus törölve** a drafts oldalról; az attach a draft editor Brief tabján történik, egy link beillesztésével. **Label mező sincs** többé.

### Amit tudatosan felülírtunk
A `MatrixGrid.tsx` invariáns-kommentje („Agentic MC csak kreatív-feltöltésből születhet") át lett írva: **két törvényes születési útja van** — a helyesen elnevezett kreatív-feltöltés, és a draft promotálása egy csatornára. A `ChannelsTab` prózája és a rács info-boxa is ezt mondja most.

### Ellenőrzés
`npx tsc --noEmit` tiszta, `npm run build` sikeres, ESLint 0 error a 6 érintett fájlon.

### ⚠️ Nyitva maradt
- **Brief label:** a label mező eltűnt, de a `briefs.label` oszlop maradt, és a drafts oldal **csoportfejléce erre esik vissza** (`b.label || "Brief {id}"`). Új brief így „Brief 7"-ként jelenik meg a mai „SZÁMLAVÁLASZTÓ" helyett. A természetes megoldás a deck nevének lekérése a **meglévő** `GOOGLE_DRIVE_API_KEY`-jel (`files.get?fields=id,name` — a `drive.ts` `getDriveFolder`-e pontosan ez a hívás, csak mappára elnevezve), mert a brief-deckek ugyanúgy „anyone with the link" megosztásúak, mint a delivery mappák. **Nem csináltam meg — nem volt kérve.**
- **Slide preview megosztás-függő:** az iframe csak akkor renderel, ha a deck link-megosztott. Böngészős ellenőrzés az MC400-on még nem történt meg.
- `scripts/gen-collisions-doc.ts` és a `docs/mc-collisions.*` **szándékosan** megtartja a nonDCO szókincset az adatkulcsaiban és a magyar prózájában: az egy 2026-08-i elemzés befagyasztott jegyzőkönyve, nem élő szókincs. A script saját magyarázó kommentjei viszont követik az új nevet.

### 2026-09-06 (folytatás) — draftok termék szerint, nem brief szerint — 6.67.0

**User:** „a draftot sem briefenként kéne kategorizálni hanem termékenként, tehát már a draftnak is kell legyen Termék/Product tagje, és lehet az oldalon olyan hogy no product set yet."

**A tény, ami a formát eldöntötte:** a `messages` táblán **nincs** `product` oszlop. A termék ma *származtatott* — DCO-nál `audiences.product`, Agentic-nél a topic kulcs prefixe (`dashboard-products.ts`, „correctness-critical, must not drift" megjelöléssel). A draftnak viszont se audience-e, se valódi topicja nincs — pont ez teszi drafttá. Tehát erre az egy állapotra tárolni kell.

**Eldöntve (AskUserQuestion):**
1. **Draft-mező, promotáláskor elengedve.** A promote nem validál és nem töröl — a cella átveszi a kérdést, a tárolt érték elveszti a tekintélyét.
2. **A brief-csoportosítás eltűnik**, a brief a Brief tabon marad.

**Az oszlop neve `draft_product`, nem `product`** — szándékosan. Egy `messages.product` nevű oszlopot a következő olvasó a kártya termékének fogja olvasni, és pontosan az a második igazság keletkezne, ami elcsúszna a mátrixtól és a dashboardtól. A név maga mondja meg a hatókört, nem egy komment, amit meg kell találni.

- [x] `messages.draft_product` (nullable text) + `0015_silent_zzzax.sql` (additív)
- [x] `WRITABLE_FIELDS` += `draftProduct`; `EditableFields` + kliens `Message` típus
- [x] Product select a **Promote tab tetején** — az opciók az `audiences`/`topics` meglévő termékeiből jönnek, nem külön hardkódolt listából
- [x] `BriefGroup` → `ProductGroup` (`product-group` blokk); ábécé szerint, a termék nélküliek **utolsóként**; toolbar számláló „N open · M products"
- [x] Két új teszt: a promote **érintetlenül átviszi** a draft termékét (nem validál, nem töröl), és a termék nélküli draft is promotálható

**Nyitva:** a `briefs.label` mező továbbra sincs kitöltve sehonnan (a Brief tabon nincs label input), de mostantól **nem számít** — a csoportfejléc a termék, nem a brief. A brief-választó legördülő viszont még mindig `Brief {id}`-ként listáz. A Drive-névlekérés (`GOOGLE_DRIVE_API_KEY`, `files.get?fields=id,name`) továbbra is a természetes megoldás, ha zavaró lesz.

### 2026-09-06 — a Brief tab egy mezőre húzva — 6.67.1

**User:** „ennek a lehullónak mi értelme? szerintem nekünk tök elég az hogy egy slide-ot be lehet linkelni, deck link sem kell, miért tetted oda, védd meg magad mielőtt vakon szótfogadsz."

**Az élesben ellenőrizve (user képernyőképe):** a slide **preview működik** — a 3. slide-ot rendereli („Számlakonstrukciók MC401"). Ez volt a nyitva maradt E4 pont; a deck elég szélesen van megosztva az iframe-hez.

**A legördülő védhetetlen volt.** Egyetlen dolga az volt, hogy megmondja, melyik CSOPORTBA kerül a draft — amikor a drafts oldal briefenként csoportosított. A csoportosítás egy szelettel korábban átment termékre, és **nem nyitottam ki újra a Brief tabot**. Egy vezérlő, ami túlélte a saját indoklását. A UI-ban a `briefId` egyetlen olvasója maga a `BriefTab` volt. Ráadásul a label mező kivétele után „Brief 2"-t kínált — értelmezhetetlen opciók egy következmény nélküli döntéshez.

**Amit megvédtem, és megmaradt: a brief-SOR, csak kérdés nélkül.** A slide link *tartalmazza* a deck id-jét (`parseSlidesFileId` + `parseSlideAnchor`, tesztelve, hogy egyik sem nyeli el a másikat), tehát „egy mező" és „a deck azonosítva van" nem alternatívák — az egyik következik a másikból, nulla UI-költséggel. Amit a sor eldobása elvinne: az MCP `list_briefs` `open_drafts`/`promoted` válasza a „mi lett ebből a deckből?" kérdésre; a „hat kártya egy deckből" mint TÉNY, nem URL-string-egyezés (pont ez a `parseSlidesFileId` létezésének oka); és egy destruktív migráció olyasmiért, amire az FR-B még mutat.

- [x] `BriefTab` → egy `Brief slide` mező + preview + Note. Legördülő, attach-doboz, Attach gomb törölve
- [x] A mező a **tárolt állapotot mutatja** (kanonikus link a file id + horgony párból), és blur/Enter-re alkalmaz — az attach írás, egy beillesztés akkor kész, amikor a fókusz elmegy
- [x] Üres mező = leválasztás (`briefId` + `briefSlideId` null)
- [x] A `["briefs"]` query megmarad, de **csak lookupra** (az embednek kell a deck file id-je), nem renderel vezérlőt

**Tanulság a következő szelethez:** amikor egy csoportosítási/rendezési döntés megváltozik, végig kell nézni, mely vezérlők léteztek KIZÁRÓLAG azért a döntésért. Ez a hiba nem a rossz tervezés volt, hanem hogy nem tértem vissza.

### 2026-09-06 — a feltöltött creative nem kerül be az Agentic mátrixba (TERV)

**Tünet (user):** „mult héten feltöltöttem a creative libraryba mc324 b és c variáns sorozatot de nem látom az agentic mátrixba pedig sztem jol voltak elnevezve".

**Diagnózis (DB-ből igazolva):** a fájlnevek hibátlanok, a parse jó (`creatives.mc_number=324`, `mc_variant=b/c`, 11+11 fájl). Az Agentic mátrix viszont a `messages` táblát rajzolja, és a Creative Library feltöltés **csak `creatives` sort ír** (`CreativeLibrary.tsx:348` → `POST /api/creatives` → `createCreative`). MC-t sosem hozott létre. Az MC324a azért van bent, mert azt még a `scripts/rebuild-creatives.ts` batch generálta (2026-08-17). A `MatrixToolbar` szövege („upload correctly-named creatives to the Creative Library") **a mai kódra nem igaz**.

**Második blokkoló:** a `promoteCreative` (`promote.ts:113`) „már mátrixolt"-nak minősít mindent, aminek van `mcNumber` ÉS `mcVariant` mezője — a feltöltéskor viszont épp a fájlnévből *beírjuk* mindkettőt. Így az egyetlen élő creative→MC út is elutasítja őket. A guard a **back-link mezőt** nézi a **message létezése** helyett.

**Érintettek (nem csak a 324):** 6 orphan MC, 66 fájl — `324b`, `324c` (2026-09-03), `338a` (08-06), `333a`, `335a`, `337a` (07-29). Mindegyiknek van már azonos számú testvér-message-e, tehát a topic mindegyiknél örökölhető.

#### 1. lépés — a 6 orphan behúzása
- [x] `ensureAgenticMc(clientId, creative)` a `promote.ts`-be: (szám, variáns, méretből jövő csatorna) hármasra keres/létrehoz egy template-nélküli message-t. Csatorna a rebuild user-lockolt szabálya szerint (`1080x1080`/`1200x628` → SOC, egyébként DISP). Topic: az azonos számú **létező testvér** topicja, ha van; különben `${product}_${keywords}`. Identity a `regeneratedIdentity`-vel (nem a script kézi pmmid+trafficking másolatával). Státusz `ACTIVE` — leszállított fájl, nem megírandó kártya.
- [x] **Nem frissít meglévő message-t** (nincs image1-felülírás) — csak hiányzót pótol, hogy kurált mezőt soha ne írjon felül.
- [x] `scripts/backfill-orphan-mcs.ts` — dry-run alapból, `--commit`-tal ír. Csoportonként a reprezentáns fájl = max verzió, majd max terület (a batch `pickRep`-je).
- [x] Dry-run megmutatva → user zöld lámpa → commit → DB-ellenőrzés.

#### 2. lépés — a tartós javítás
- [x] A feltöltés maga ejtse a tükör-MC-t: `createCreativeWithMirror` a `POST /api/creatives` route-ban és az MCP `creative_create`-ben (a `createCreative` marad tiszta insert).
- [x] `promoteCreative` guard: a „már mátrixolt" a **message létezésén** múljon, ne a `mcNumber`/`mcVariant` mezőn. Ha a creative-nek van fájlnévből jövő száma → `ensureAgenticMc` (a szám marad), ha nincs → a mai auto-assign ág.
- [x] `MatrixToolbar` Agentic-szövege igazzá válik — marad, ahogy van.
- [x] Tesztek: feltöltés → message születik; második fájl ugyanabba a cellába nem duplikál; a méret-alapú csatornaszétosztás; a promote guard már nem utasít el message nélküli creative-et.

**Review (2026-09-06, szállítva):**

- **A dry-run 7 MC-t talált, nem 6-ot.** Az `MC334a` azért hiányzott az első listámból, mert a „van-e message ezzel a számmal" lekérdezésem **nem tengelyre szűrt**: a 334-es a DCO oldalon foglalt (SZK, HTML, 35 kártya), és ez elnyelte a MARKET `premium_utazas` statikus sorozatot. A scriptbeli ellenőrzés csatorna-audience-re szűkít, ezért találta meg. User döntése: mind a 14 cella megy (lockolt cross-axis szabály — a DCO és az Agentic külön számtér).
- **A 672-ből 658 cella már létezett** — vagyis az `ensureAgenticMc` csatorna- és csoportosítási szabálya bitre reprodukálja, amit a batch import kiírt. Ez volt a legerősebb ellenőrzés arra, hogy a szabály tényleg ugyanaz: ha elcsúszott volna, több száz „hiányzó" cellát jelentett volna.
- **Élesben:** 14 sor, PMMID + trafficking generálva, `ACTIVE`, `template=null`. Az MC324 a/b/c most egy cellában ül (`SZA_DiakszamlaQ3_csakfoto`). Fájl nem mozdult, MinIO-t nem érintettük.
- **Nyitva hagyva (nem ennek a szeletnek a dolga):** a `333/335/337` topic-sztringje félrevezető (`MARKET_MCx_d_genZbefektetes_2026Q1` a `tengeri_hajozas` sorozat felett) — a batch `topicByNumber`-e annak idején rossz variáns-'a' rekordot fogott meg. A backfill **örökölte** ezt, mert egy szám nem ívelhet át topicokon a tengelyen belül: az `a` oda kell, ahol a `b` már ül. Egy topic-átnevezés mindkettőt egyszerre vinné a helyes sorba.
- **Deploy kell:** a 14 cella már látszik élesben (közös DB), de a **feltöltési hook csak deploy után** él a boxon.

**DEPLOYOLVA 6.68.0 (2026-09-06):** commit `f6620d2`, box `4fd7848`→`f6620d2`, `npm run build` OK, `pm2 restart mm6-erste --update-env` → Ready 1236ms. **Séma-migráció nincs** (`git diff --name-only 4fd7848..f6620d2 -- db/migrations` üres). Health: `/` 307 · `/login` 200 · `/matrix` 307 · `/creative-library` 307 · `/api/creatives` 401 · `/mcp` 401; publikus `erste.messagingmatrix.ai/login` **200**. Boxon a `6.68.0` verifikálva. A backfill 14 sora a deploy előtt ment ki (közös DB), a feltöltési hook a deploytól él.

---

## MCP end-to-end tesztforgatókönyv — doksi kész (2026-09-06)

**`docs/MM6_MCP_E2E_TEST.md`** — modellezés + futtatható forgatókönyv, hogy erstés
kollégák MCP-behívása előtt bizonyítható legyen: draft → brief → promote (DCO/Agentic)
→ creative library → MC search → monitoring végigmegy, és minden kérdésükre jó választ ad.

- [x] Tool-felület modellezve: **51 tool**, `read` = 21, `full` = +30. A doksi táblázata
      a `buildMcpServer()` regisztrációs sorrendjéből jön, nem kézi listából.
- [x] **„admin vs user token" tisztázva: nem ez a tengely.** Az MCP rétegben nincs szerep,
      csak `mcp_tokens.scope ∈ {full, read}`. Egy `role=user` full tokene ugyanazt az 51
      toolt látja, mint egy adminé. A `role` a webes UI-t és a token-kiadást kapuzza;
      egyetlen kapcsolat: `role=demo` csak `read` tokent kaphat.
- [x] F0–F11 forgatókönyv magyar, tool-nevet nem tartalmazó promptokkal + jegyzőkönyv-sablon.
- [x] Takarítási terv: célzott törlés (objektumtár → `messages` DELETE → brief → token).

**Az élő tokenkészlet (2026-09-06) átrendezte a tesztet:** egyetlen `full` token van
(`admin@local`), a két erstés (`tamas.varfi@`, `csaba.brunner@`) **`read`**. Vagyis ma egy
behívott kolléga nem tud draftot csinálni, briefet kötni, promotálni — a 30 író tool meg sem
jelenik neki. A `read` futam ezért az **elsődleges** eset, a `full` a másodlagos.

---

### MCP tool-leírás javítások — a workflow-teszt modellezéséből (2026-09-06)

Ezek **nem** a tesztfutamból jöttek (az még nem futott), hanem a `src/lib/mcp.ts`
átolvasásából, miközben a fenti forgatókönyvet terveztem. Azért kerültek ide, mert
mindkettő olyan pont, ahol az agent **kénytelen találgatni**, és a találgatás a
workflow közepén fog kiderülni.

- [ ] **T1 — a tartalom-módosítás útja hiányzik a leírásokból.** Az agent ma nem tudja
      kitalálni, hogyan írjon át egy szöveget. A valóság kétágú:
      - **Draft** (`status=DRAFT`, nincs audience): **nem szerkeszthető MCP-n.** Nincs
        `draft_update`, a `mc_update` pedig `findMessageByPmmid`-del keres, egy draftnak
        viszont nincs PMMID-je (DB check `messages_draft_has_no_pmmid`). Egyetlen út:
        `draft_delete` + `generate_test_creative` újra.
      - **Promotált MC**: `list_mc` (vagy `mc_get`) → a sor **`pmmid` + `version`** →
        `mc_update(mc_label: <pmmid>, version: <version>, fields: {…})`. A `version`
        kötelező (optimistic lock), utána a preview elavul → `preview_generate`.

      **Teendő:** ez a két ág menjen bele a tool-leírásokba, hogy az agent ne találgasson:
      - `mc_update` leírásába: honnan jön az `mc_label` és a `version` (`list_mc`/`mc_get`),
        és hogy **draftra nem működik**.
      - `generate_test_creative` és `draft_get` leírásába: a draft tartalma MCP-n nem
        módosítható, csak eldobás + újra, vagy promote után `mc_update`.
      - `draft_promote` leírásába egy záró mondat: promote után a szerkesztés útja
        `list_mc → pmmid → mc_update`.
      - `preview_generate` leírásába: `mc_update` után a preview elavul, ez a lépés kell.
      ⚠ **Csak leírás-változás, kódlogika nem.** A `docs/MM6_MCP_E2E_TEST.md` F6 lépése
      ezt méri — a javítás után az agentnek magától be kell járnia a láncot.
      ⚠ `feedback_mcp_settings_page_sync`: a Settings › MCP tool-listája automatikusan
      szinkronizál a `mcp.ts`-ből, de a `McpTab.tsx` **prózai** szakaszai kézzel írottak —
      ha ott is szerepel a szerkesztés útja, azt külön kell frissíteni.

- [ ] **T2 — `matrix_status.last_export` mindig `null`.** (`mcp.ts:1077`,
      `// No export-history tracking yet — Phase 8d/9c TBD.`) Az agent ebből azt a
      hamis következtetést vonja le, hogy „még sosem exportáltunk".
      A `feed_exports` tábla viszont **létezik és él** (egy sor per Preview & Export
      akció, `uploaded_to_adform_at`-tal) — tehát van mit visszaadni.
      **Teendő:** `last_export` a `feed_exports` legutóbbi sorából (`created_at`, és
      külön a legutóbbi `uploaded_to_adform_at`), vagy ha nem érjük meg, akkor a mező
      **kivétele** a válaszból — a `null` rosszabb, mint a hiány.
      Döntés kell: visszaadjuk vagy kivesszük.

### A modellezés közben kiesett további megfigyelések (nem tesztelt, nem ütemezett)

3. **A snapshot/restore veszteséges.** `SnapshotPayload` 10 táblát ment, `message_previews`-t
   **nem**, a restore viszont törli a `messages`-t → a cascade elviszi az **összes** preview-t
   az egész kliensen. Takarításra tilos használni; és önmagában is bug.
4. `draft_delete` leírása szerint a szám „nyugdíjazva marad", de `nextNewNumber` a live sorok
   maximumát nézi → a **legnagyobb** szám archiválása után újra kiosztódik.

**Nyitott (roadmap, sorrendben):**
- [ ] `scripts/mcp-e2e-cleanup.ts` — a §7 három lépése egy tranzakcióban, `--dry-run`.
      Ez kell **már az első kézi futam után is**. (Ma még nincs mit takarítani: a
      forgatókönyv **nem futott le**, csak a kódolvasásból készült.)
- [ ] Lefedettség 24/51-ről feljebb: asset/creative feltöltés, `creative_promote`,
      `prodlist_upsert`, batch család, audience/topic írás, `preview_generate`, `get_media_file`.
      Előfeltétele a takarítószkript (ezek fájlokat is hagynak az objektumtárban).
- [ ] Automatizált futtatás — csak ha a kézi kör után kiderül, hogy ismételni akarjuk.

### 2026-09-06 — /drafts összeomlás: a query-key alakszerződés ÖTÖDSZÖR — 6.69.1

**User (képernyőképpel):** „csomószor járok igy frisítés után hogy menube kattintgatá ilyen és egyéb eroroket dobál, nem jó" — `TypeError: (intermediate value)(intermediate value) is not iterable` a `useMemo`-ban, a `/drafts` az error boundary-ra cserélve.

**Ok:** a `DraftsView` három megosztott kulcson (`["audiences"]`, `["topics"]`, `["channels"]`) a **csupasz tömböt** tette a cache-be (`.then((d) => d.audiences)`), miközben a MatrixGrid, CreativeLibrary, MonitoringTable, AudiencesEditor és TopicsEditor mind a **burkolót**. Így az döntötte el, mit olvas a másik, hogy melyik oldal mountolt előbb — pontosan ezért „frissítés után, menüben kattintgatva". Mátrixról jőve a drafts egy objektumot spreadelt (crash); fordítva a mátrix egy tömb `.audiences`-ét olvasta (undefined → **néma üres rács**). Nem a mai szelet okozta, de a mai szelet oldalán csapódott ki.

- [x] A `DraftsView` három queryFn-je a burkolót adja vissza, a kicsomagolás a használat helyére került
- [x] `tests/unit/query-key-shape.test.ts` — statikus őr: egy kulcs-literálhoz egy alak. **Ellenőrizve, hogy fog is**: a hibát visszatéve mind a négy hívási helyet kiírja
- [x] Az őr a TELJES kulcstömbre néz, nem az első elemére (`["feed-exports","all"]` ≠ `[…, product]`), és az `invalidateQueries`-t nem számolja alak-deklarációnak

**Ez a memóriámban rögzített hibaosztály 5. előfordulása** (`project_query_key_shape_contract.md`: „two useQuery on one key with different shapes = order-dependent crash a reload hides; found 4× in prod"). A négy korábbi javítás után is visszajött, mert a szabály a figyelmen múlt — most a teszten múlik.

### 2026-09-06 — a brief nem tábla, hanem oszlop + draft-törlés + élő draft-kártyák — 6.70.0

**User:** „de nekünk nem kell brief tábla, a brief link az a draft egy mezeje nem?" — **igaza volt.** A brief identitása a Drive file ID, amit a `parseSlidesFileId` minden URL-alakból ugyanarra a stringre normalizál; egy kanonikus érték mellé az integer id csak surrogate kulcs. A „hat kártya egy deckből" ettől `GROUP BY`, nem join.

**A 6.67.1-es védésem nem állt meg.** Három érve volt a sor megtartására: (1) a `list_briefs` open/promoted számlálói — ezt egy GROUP BY ugyanúgy adja; (2) „tény, nem string-egyezés" — a tény attól tény, hogy a file ID normalizált, nem attól, hogy van hozzá sor; (3) a migráció destruktív — ez költség, nem haszon. Amit a tábla ténylegesen hozzátett: árva sor minden leválasztáskor, 300 sor entity+route, és egy `["briefs"]` fetch a szerkesztőben, aminek egyetlen dolga volt visszafejteni egy id-ből azt a stringet, amiből parse-oltuk.

- [x] `messages.brief_slides_file_id` (`0016` add column, `0017` backfill → FK/oszlop/tábla drop). A `0017` generált sorrendje **hibás volt** (a `DROP TABLE … CASCADE` már elviszi az FK-t, amit a következő utasítás még egyszer eldobna) — kézzel újraírva, a backfill-lel az élén
- [x] `entities/briefs.ts` 167 → 78 sor: `listBriefDecks` (GROUP BY) + `briefFileIdFromLink`. `/api/briefs` + `/api/briefs/[id]` törölve
- [x] `BriefTab`: nincs több `["briefs"]` query és POST — a beillesztés két mező írása, amit a szerkesztő autosave-je ment
- [x] MCP: `list_briefs` a kártyákból csoportosít; `brief_attach` mezőt ír, ezért **`draft_id` kötelező** (deck kártya nélkül nem létezik), és a slide-horgonyt is eltárolja; `generate_test_creative` `brief_link`-je ugyanígy
- [x] Tesztek átírva a `briefs-entity` / `briefs-draft-invariant` / `mcp-drafts` fájlokban — a tábla-invariánsok helyére az **oszlop** invariánsai (több kártya oszthat egy decket; az egyik leválasztása nem nyúl a másikhoz)

**Draft törlés (user: „kéne tudja törölni elrontott draftot"):** `deleteDraft` + `DELETE /api/drafts/[id]`, a Promote fülön az Archive mellett, második kattintásra megerősítve. **A különbség a szám:** az archiválás nyugdíjazza a számot (ez helyes annak, ami megtörtént), a törlés visszaadja. Ez az egyetlen hely az appban, ahol hard delete van a UI-ból — és azért szabad, mert egy draftnak nincs cellája: nincs PMMID (a séma tiltja), nincs feed-sor, nincs riport rákötve.

**A draft-kártya nem hazudik többet (user: „ezt mondja 400-ra hogy nincs contetnt pedig van"):** a csempe az MCP-pipeline lőtte PNG-jét mutatta, és ahol nem volt, azt írta: „No content yet — this draft has only its number". Ez a *preview* hiányát mondta ki *content*-hiánynak — minden kézzel írt draft ezt írta ki, headline-nal, copyval együtt. Mostantól a mátrix `MatrixIframePreview`-jával renderel élőben (sablon default méretén), tehát nincs mit lőni előre és nincs mi elavuljon; a `/api/drafts` `previews` payloadja és a stale-badge elment vele. Sablon nélküli kártya `aspect-[300/250]` placeholdert kap, hogy a masonry sorban maradjon.

**Nyitva:** az MCP `draft_delete` továbbra is **archivál**, nem töröl (a neve ezt nem mondja meg) — nem nyúltam hozzá, mert a kérés a UI-ra szólt. Ha az agentnek is kell a szám-visszaadás, az egy sor.

**DEPLOYOLVA 6.70.0 (2026-09-06):** commit `342bb19`, box `c60c1d6`→`342bb19`. **Séma-migráció VAN**, egy passzban: `export $(grep '^DATABASE_URL=' .env | xargs) && npm run db:migrate` (0016+0017) → build 43s → `pm2 restart mm6-erste --update-env` → Ready 1275ms. **Mentés a migráció előtt** (`scratchpad/briefs-backup-20260906.sql` + `messages-briefid-backup-20260906.csv`): 4 brief-sor, 9 hivatkozás. Ellenőrizve élesben: `to_regclass('briefs')` = NULL, mind a **9 hivatkozás átjött** a `brief_slides_file_id`-be a helyes deck-ID-vel. Health: `/` 307 · `/login` 200 · `/drafts` 307 · `/matrix` 307 · `/api/drafts` 401 · **`/api/briefs` 404** (a route eltűnt, ahogy kell) · `/mcp` 401.

**Böngészőben ellenőrizve:** a drafts fal 9 kártyája élőben renderel (MC400a a saját headline/copy/CTA-jával — pont az, ami eddig „No content yet"-et írt); a sablonnal még nem rendelkezők üres bannert mutatnak, nem hazug szöveget; a Promote fülön ott az `Archive | Delete` páros. A `</>` ikon a render előtti pillanat placeholdere, nem hiba.

### 2026-09-06 — `draft_delete` → `draft_archive` — 6.71.0

**User:** „akkor hívjuk úgy az mcp funkciot draft_delete helyett draft_archive ne legyen féreveztő" — igen: a tool sosem törölt, archivál, és a szám nyugdíjazva marad. A név az ellenkezőjét ígérte, ráadásul pont annál a hívásnál, amelyikhez az agent akkor nyúl, amikor el akar dobni valamit.

- [x] `mcp.ts`: a regisztrált név `draft_archive`; a leírás kimondja, hogy **semmi nem töröl MCP-n**, és hogy a UI Delete gombjának (elrontott draft, a szám visszajár) **szándékosan nincs MCP-párja** — egy sorokat hard-deletelni képes agent más kockázat, mint egy polcra tevő
- [x] A `generate_test_creative` záró mondata is átírva (`draft_archive to shelve it`)
- [x] `McpTab.tsx` prózája — a tool-lista magától szinkronizál, ez a bekezdés kézzel írt (l. `feedback_mcp_settings_page_sync`)
- [x] `mcp-drafts.test.ts` + `mcp-auth.test.ts` (mindkét scope-lista); `docs/MM6_PURPOSE_STATE_CAPABILITIES.md` + `docs/MM6_MCP_E2E_TEST.md`
- [x] A todo **korábbi checkpointjaiban** meghagytam a régi nevet (D4.1/D4.2/D4.T, Slice 3, 717.) — azok azt rögzítik, ami akkor igaz volt; a történet nem íródik át

⚠️ **Ez töri az agent-szerződést:** a `~/ERSTE Addressable AI Agent` skill (és bármely más kliens), ha hívja a `draft_delete`-et, `tool not found`-ot fog kapni. A paraméterek és a válasz változatlanok, csak a név más.
