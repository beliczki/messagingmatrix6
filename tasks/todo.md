# MessagingMatrix v6 — active roadmap + checkpoint

**Ez a lean, aktív fájl.** A teljes történelem (Phase 0–10 logok, összes deploy- és session-checkpoint 2026-04 → 2026-09-07, minden lezárt epic-log) szó szerint megvan itt: **`tasks/todo-archive.md`** (~6200 sor). Ott semmit nem törlünk — ez a hosszútávú emlékezet.

**Munkamenet:**
- Új session-checkpoint ennek a fájlnak az **aljára** kerül (append), nem az archívba.
- Ha az aktív rész kezd hízni a lezárt checkpointoktól, a régieket **átgörgetjük az archívba** (append oda), és itt hagyunk egy egysoros mutatót.
- Részletekért (file:line horgonyok, eredeti tervek, review-k) → `todo-archive.md`, szekció-cím vagy hozzávetőleges sor szerint hivatkozva.

**Kapcsolódó dokumentumok:**
- `docs/REBUILD_SPEC.md` — v6 design spec + multi-tenancy delta D1–D11.
- `tasks/component-inventory.md` — használatban lévő szemantikus class-nevek (új blokk-név előtt nézd meg).
- Master plan: `~/.claude/plans/you-ll-see-docs-and-snappy-charm.md`.

---

## Jelen állapot (2026-09-10)

- **Verzió: `6.87.0`**, **live** a Hetzner boxon (`erste.messagingmatrix.ai`, pm2 `mm6-erste`). a Hetzner boxon (`erste.messagingmatrix.ai`, pm2 `mm6-erste`). Working tree tiszta; a 6.82.x munkák commitálva.
- Phase 0–10 + a 2026-08/09-es epicek mind leszállítva: DCO/Agentic mátrix, Creative Library rebuild, DRAFT-modell (draft = `messages` sor `audience IS NULL`), draft-variánsok, státusz-takarítás (6 státusz), monitoring periódus-tartomány + nap-grain, Drive-linkek, feed diff-alap + „semmi nem tűnik el", dashboard napi áttekintő, Channels-entitás, MCP per-user tokenek.
- **Átrendezés 2026-09-10:** minden lezárt epic-log és a 2026-09-10 előtti checkpointok szó szerint átkerültek a `todo-archive.md`-be („Archivált 2026-09-10 — todo.md átrendezés" szekció). Itt csak a nyitott munka maradt.

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

### ~~Box deploy — 6.83.0~~ — **✅ DEPLOYOLVA (2026-09-11)**
commit `c49d391`, box `0c6bce0`→`c49d391`, `npm run build` OK, `pm2 restart mm6-erste --update-env` → **Ready 1310ms**, box `package.json` **6.83.0**. **Séma-migráció nincs** (`git diff --name-only 0c6bce0..c49d391 -- db/migrations` üres). `error.log` a restart óta üres. Health: `/` 307 · `/login` 200 · `/matrix` 307 · `/drafts` 307 · `/creative-library` 307 · `/api/templates` 401 · `/mcp` 401; publikus `erste.messagingmatrix.ai/login` **200**.

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

### ~~D — Design tab kör: capsule · fontok · ikonkészlet · cobrand · navigáció~~ — **✅ LESZÁLLÍTVA (6.88.0, 2026-09-12)**

**User:** „a capsule design most nem csinál semmit, ne is csináljon, vegyük ki, takarítsunk ki utána; mm5-ból
vegyük át a TeleNeo font családot és tegyük lehullóssá a font választót, és vegyük be még választhatónak a
Poppins családot; nézzük meg hogy a co brand most működik-e, tettem hozzá fehér és fekete Erste és fehér és
fekete Telekom logót; az icon választót pedig tehetjük lehullóssá mint a font választót és kéne rá rögtön
preview sor úgy hogy a page title-lel megmutatjuk a font választót és mellé teszünk pár ikont amit a menüben
/ dialógusokban használunk."

**Felmérés (2026-09-12, kód + élő DB) — három meglepetés:**

1. **A `capsuleDesign` tényleg halott, de nem csak „nem csinál semmit": be is van kapcsolva.**
   Az élő `erste` tenant `lookAndFeel`-jében `capsuleDesign: true`, és **egyetlen olvasója sincs** —
   a `grep` az egész `src/`-ben csak a `DesignTab.tsx:199` checkboxot és a `defaults.ts:10` alapértéket
   adja, nulla CSS, nulla komponens. **Ugyanígy halott a `laf.logo` mező is** (`defaults.ts:7`): sehol
   nem olvassa senki, a login a `cobranding.logoUrl`-t használja. Két mező megy, nem egy.

2. **A font-választó ma egy szabadszöveges mező egy olyan fonthoz, amit soha nem töltünk le.**
   A `--font-base` (`globals.css:13`) `"Inter", system-ui, sans-serif`, a Tailwind `font-sans`-a erre
   mutat (`tailwind.config.ts:52`) — de **`@font-face` nincs, `next/font` nincs, `public/fonts/` nincs**.
   Vagyis az egész app ma a rendszer-betűvel megy (macOS-en a system-ui), és a mezőbe bármit be lehet írni,
   a képernyőn semmi nem történik. A „tegyük lehullóssá" tehát nem kozmetika: **a lenyílónak előbb kell,
   hogy legyen mit betöltenie**, különben ugyanaz a placebo marad, csak kevesebb opcióval.

3. **A cobrand plumbing él, de három ponton nem ér földet.**
   - Mind a 4 tenantban `cobranding: {enabled:false, logoUrl:""}` — sehol nincs bekapcsolva, sehol nincs URL.
   - **Egyetlen renderelő hely a login oldal** (`login/page.tsx:63`). A sidebar és a share-oldal a
     `mmatrix.svg`-t viszi, a cobrand logó oda nem jut el.
   - **Nincs feltöltés:** a mező egy URL-string, és az appban nincs hely, ahová a logót fel lehetne tenni
     (a `public/` a boxon is csak `mmatrix*.svg` + a drive-ikon). **A hozzáadott fehér/fekete Erste és
     Telekom logókat nem találom** — se a repóban, se a `storage/`-ban, se az `assets` / `uploaded_files`
     táblában, se a box `public/`-jában. ⚠️ **Kérdés a userhez: hova kerültek?**
   - A fehér+fekete pár eleve azt mondja, hogy **világos/sötét változat kell** (`logoUrl` + `logoUrlDark`),
     nem egy mező.

4. **Az ikon-váltó ára változatlanul a `ICON_SET_STUDY.md` 1. lépése:** ma nincs indirekció, **66 fájl**
   importál közvetlenül `lucide-react`-ből (87 ikon). A lenyíló + preview sor **önmagában 2 óra**, de amíg
   a 66 fájl nem megy át a regiszteren, a kapcsoló **csak a preview sort** váltja — az app többi része
   lucide marad. Ez a szelet fő döntése (l. lent, Q1).

**Szeletek — mindegyik külön commit, `tsc` + vitest utána, a végén egy bump + CHANGELOG:**

- [x] **D1 — capsule + halott `logo` mező kivezetése (patch).** `defaults.ts`: `capsuleDesign` és `logo`
      törlése; `DesignTab.tsx`: a checkbox + a `CheckboxField` használat törlése (a komponens marad, a
      Cobranding szekció használja). A DB-ben maradó kulcsok ártalmatlanok (a merge a defaultra épít, és
      senki nem olvassa őket) — **opcionális** egy `UPDATE config SET value = value::jsonb - 'capsuleDesign'
      - 'logo'` takarítás mind a 4 tenanton. Teszt: nincs mit, `tsc` elég.

- [x] **D2 — valódi, self-hosted fontok + font-lenyíló (minor).**
      - `public/fonts/` + `src/app/fonts.css` (`globals.css`-ből importálva): **woff2-only**, súlyonként
        egy fájl, `font-display: swap`.
      - **TeleNeo**: mm5 `src/styles/Fonts/TeleNeoWeb-{Regular,Medium,Bold}.woff2` átemelve (400/500/700,
        ~160 KB). Dőlt nem kell az UI-nak; ha később kiderül hogy kell, 3 fájl hozzáadása.
      - **Poppins + Inter**: `latin` + **`latin-ext`** subset (a magyar `ő`/`ű` csak abban van), a Google
        Fonts CSS-ből a woff2-k letöltve és **beemelve** — futásidejű `fonts.googleapis.com` link nincs
        (a login oldal a bejelentkezés ELŐTT renderel, és a box nem hív ki hálózatra).
      - `src/lib/fonts.ts` — **egy** forrás: `FONT_OPTIONS = [{ value, label, stack }]` (System / Inter /
        TeleNeo / Poppins). A `branding.ts` és a `DesignTab.applyLive` innen veszi a **stacket**, nem
        `"${fontFamily}", system-ui, sans-serif`-et fűz össze (ma az a sor a `defaults.ts`-szel kettőzve él).
      - A `TextField` „Font family" → `SelectField` az opciókkal. Ismeretlen, kézzel beírt régi érték nem
        vész el: ha a tárolt érték nincs a listában, saját opcióként megjelenik (a `MultiPill`
        „eltűnt, de kijelölt érték" mintája).
      - ⚠️ **Jogi lábjegyzet, nem blokkoló:** a TeleNeo a Deutsche Telekom céges betűje; a saját termékünk
        UI-jában használni Telekom-demóhoz szürke zóna. Az mm5 évek óta így szállítja — jelzem, a döntés a
        useré.
      - Teszt: unit a `fonts.ts` stack-feloldására (ismert érték · ismeretlen érték → fallback).

- [x] **D3 — Identity preview sor (minor).** `design-tab__preview` blokk az Identity szekció alatt:
      a **page title** a kiválasztott fonttal, alatta egy súly-minta (400/500/700) és egy **ikon-sor**
      abból, amit a menü és a dialógusok tényleg használnak (Matrix `Table2`, Creative Library `Image`,
      Drafts `FlaskConical`, Settings `Cog`, mentés `Check`, törlés `Trash2`, bezárás `X`, `ChevronDown`).
      Élő: a font- és ikon-lenyíló változtatására azonnal átrajzol (az `applyLive` már ezt csinálja a
      színekkel). Új név a `component-inventory.md`-be.

- [x] **D4 — cobrand földet ér (minor).** ⚠️ **Blokkolva a Q2 válaszáig.** Terv, ha a válasz „töltsük fel
      az appból": `cobranding` → `{ enabled, logoUrl, logoUrlDark }`, feltöltés a meglévő asset-útón
      (MinIO), render a **login** + a **sidebar** fejlécében (világos/sötét pár a `dark:hidden` /
      `hidden dark:block` mintával, ahogy a `mmatrix.svg` is megy), és a Design tab preview sorában is
      látszik. Ha a válasz „elég a `public/`": akkor csak a két URL-mező + a sidebar-render.

- [x] **D5 — ikonkészlet-váltó.** Hatóköre a Q1 döntésétől függ. A `ICON_SET_STUDY.md` §5.7 1–3. lépése
      a teljes változat; a lenyíló + preview sor a 2. lépés vége.


### D6–D8 — a második kör (user, 2026-09-12): fejléc-product-tag · navigáció + brand-hely · mátrix Type-szűrő

- [x] **D6 = M12.2** (product tag a topic/audience fejlécekre, ha több product van kijelölve).
      Nem írom le kétszer — a tétel az „Apróság-kör" szekcióban él. **Amit a felmérés hozzátesz:**
      a fejléc **generikus** (`GridView.tsx:358` `colKind`/`rowKind`), tehát egy helyen megírva
      transzponált nézetben is jó. A `tag-chip drafts-tile__product` vizuál (sötét `bg-slate-800
      text-white`, `text-[10px]`) reuse. ⚠️ **A `dense` a nehéz eset:** ott az oszlopfejléc 28 px széles,
      a név függőlegesen fut (`[writing-mode:vertical-rl]`) — oda nem fér chip. Javaslat: dense-ben a
      product **kétbetűs rövidítése** a függőleges név fölé, ugyanabban a sötét chipben; ha az is sok,
      csak egy 3 px-es színsáv. Döntés a vizuális körben.

- [x] **D7 — Dashboard a menü tetejére, a kliensnév a lap-toolbarba (minor).**
      - `Sidebar.ITEMS` elejére `{ href: "/", label: "Dashboard" }`. ⚠️ **Az aktív-jelölés ma
        `pathname.startsWith(it.href + "/")`** (`Sidebar.tsx:106`) — `"/"`-re ez **minden oldalt**
        aktívnak jelölne; a `/` pontos egyezést kap.
      - A kliensnév (`app-sidebar__client-name`, `Sidebar.tsx:93`) **kikerül a brand-sávból**. A mai
        kommentje kimondja, hogy „a kliensnév a visszaút a dashboardra — nem kell neki saját nav-item
        (user döntése)"; ez most **megfordul**, a komment is cserélődik.
      - Új `AppBrandTag` komponens a lap-toolbarokba, a cím ELÉ. **10 toolbar** viseli ma a
        `toolbar__title`-t (matrix, creative-library, assets, drafts, feeds, shares, monitoring,
        dashboard, dimension-grid, right-toolbar) — egy-egy soros beszúrás, nem közös layout-sáv,
        mert közös felső sáv ma nincs (az `AppShell` csak sidebar + `<main>`).
      - **Cobrand-csere:** ha `cobranding.enabled` és van logó, a kliensnév helyett a logó megy oda
        (világos/sötét pár). Ez **a D4-re épül** — addig a tag a nevet mutatja. A laf-ot a toolbarnak
        kliens-oldalon kell látnia: a `AppShell` már megkapja a `client`-et, a `lookAndFeel`-t viszont
        nem — vagy az `(app)/layout.tsx` adja tovább (SSR, nincs villanás), vagy a meglévő
        `["config","lookAndFeel"]` query. **Az SSR-út a helyes**, a Design tab `applyLive`-ja pedig
        ugyanúgy él marad.

### ~~D8 — Mátrix „Type" szűrő a Creative Library mintájára~~ — **ELVETVE (user, 2026-09-12: „Q3-at dobjuk el")**
A mátrix `matrix-axis-toggle`-je **kizárólagos** marad (DCO | Agentic). A felmérés, ami a döntést
megalapozta, egy mondatban: a CL-ben a Type egy lapos lista szűrője, a mátrixban viszont az axis a
rács **két tengelyét particionálja** (`MatrixGrid.tsx:852-870`), tehát a „mindkettő" egy vegyes rácsot
jelentene — és ott az edit mód (ma az egész Agentic tengelyen tiltott, `:540`), a product-szűrő
oszlop-vágása (`:866`), a `(number, variant)` tengelyen belüli egyedisége (`:937`) és a perzisztált
skalár `axis` mind újraszabályozásra szorulna. Ha egyszer mégis kell, ez a négy pont a munka.



---

## 🟡 NEXT — green-light után, alacsony blokk

### ~~P — Preview-generálás a Creative Library jobb toolbarjából~~ — **✅ KÉSZ (6.87.0, 2026-09-12)**

**User:** „jó lenne a hetzner boxra is feltenni a chromiumot és ott is képesnek lenni preview képet
generálni… a header toolbarból a »nincs preview x MC-hez« warningot ki kéne hozni a side toolbarba és
oda tenni a generate preview for missing, valami aszinkron kapcsolttal hogy látszódjon a preview gen
progress, infóval hogy éppen mit csinál a háttérscript."

**Felmérés (2026-09-12) — a fele már kész:**
- **Chromium MÁR fent van a boxon és megy:** smoke-teszt a `/var/www/mm6-erste`-ből → playwright
  chromium **1164 ms** alatt indult, PNG-t lőtt. Telepíteni nincs mit.
- **A szerveroldali lövés is kész:** `POST /api/previews/generate` (`withSession` + `denyDemo`,
  max 20 message id/hívás, `collectStalePreviews` → `shootPreviews`). A `preview-shooter`
  `defaultBaseUrl()`-je `127.0.0.1:$PORT`, tehát a boxon a saját appjára néz — jó.
- **Ami hiányzik: a UI sosem kínálja fel.** A `PreviewWarning` a *header* toolbarban ül
  (`CreativeLibrary.tsx:966`), csak listáz, és a tooltipje még mindig azt tanácsolja:
  „run `npm run gen:previews`" — a boxon ez félrevezető.
- **Mennyi a hátralék (élő DB):** 2068 html MC · 8208 preview sor · **228 elavult** + ~64 hiányzó
  ≈ **~290 felvétel ≈ 10–20 perc** serializált chromiummal. Tehát ez hosszan futó munka.
- **Két kész minta, amit újra kell használni:** a `DriveHealthCheck` (ugyanabban a jobb toolbarban,
  chunkolt futás + élő riport) és az SSE (`/api/events` + `lib/events.ts` `broadcast/subscribe`,
  minden belépett kliens már hallgatja). A `shootPreviews`-nak **van `onShot` callbackje**.

**User-döntések (2026-09-12):** hatókör = **a szűrt nézet**; progress = **élő SSE sor**.

- [x] **P1 (szerver)** `BroadcastEvent` opcionális `detail` mezővel (additív). A generate-route
      `onShot`-ot ad a `shootPreviews`-nak, és felvételenként broadcastol:
      `{entity:"previews", action:"shot", ids:[messageId], detail:{mcLabel, size, ok, done, total}}`.
      ⚠️ Ellenőrizendő: a kliens event-fogyasztója ne invalidáljon query-t erre az entityre.
- [x] **P2 (kliens)** `PreviewWarning` → **`PreviewHealth`**, a `RightToolbar`-ba, a `DriveHealthCheck`
      collapsed/expanded mintájával (collapsed = ikongomb, nyitva = gomb + offender-lista).
      A futtatás hatóköre a **szűrt nézet `kind:"matrix"` elemeinek `message.id`-ja**, dedupe-olva,
      20-asával chunkolva (a route cap-je). A gomb a hatókör számát viszi, 0-nál tiltott.
      A blokk a kliens-szintű warningot is mutatja (mint ma), hogy látszódjon: a szűrőn kívül
      mennyi maradt.
- [x] **P3** Copy-javítás (a „run `npm run gen:previews`" tanács helyett a gomb), az élő sor
      („MC404a 300×250 · 12/290"), `component-inventory.md` (`preview-health*`, a
      `creative-library__preview-warning*` nevek nyugdíjazása), tesztek (route broadcastol;
      hatókör-helper unit), CHANGELOG + minor bump.

**Amit ez NEM csinál:** nem lesz szerveroldali job-tábla/worker. A futást a kliens hajtja chunkonként,
tehát a fül bezárása két chunk között **leállítja** — cserébe nincs árva job, és nincs új tárolási
réteg. Ha később kell „fusson tovább, ha elmegyek", az külön szelet, saját push-backkel.



### UI-apróságok (mátrix + editor + library)

### ~~M1 — Matrix „Color by"~~ — **KIVEZETVE (user, 2026-09-10)**
A funkció lényege **már él, más néven**: `GridView.audienceEdgeClasses()` (`:33`) az audience-fejléc élére csíkot rak, ahol a **vastagság = strategy** (pro 3px / rem 5px), a **szín = platform** (`--plat-dv360` / `--plat-adform`), transzponált nézetben is (`globals.css:609-619`). A user döntése: **sem a „Color by" dropdown, sem legend nem kell.** Az M1.1–M1.3 törölve, nem építjük.

### M7 — Custom-CSS beszúró chipek az MC-editorban — **✅ KÉSZ (6.83.0, 2026-09-10)**
- [x] **M7.4** `elementIds` + `elementClasses` a `TemplateInfo`-ba, `index.html` parse-olásával a `readTemplate`-ben (`lib/templates.ts`), a `sizes[]`-szel azonos cache-úton — az API (`/api/templates`) a teljes `TemplateInfo`-t adja vissza, így külön kivezetés nem kellett. Placeholderből épített név (`id="{{pmmid}}"`, `class="{{template_variant_class}}"`) kiesik. Non-html kind: üres, ahogy a `sizes` is.
- [x] **M7.1** Chip-blokk a `customCss` textarea alá (`SelectorChips`), beszúrás a kurzorpozícióba (ref + selectionStart/End splice), szóköz-normalizálással mindkét oldalon — két chip így **descendant selectorrá** áll össze, nem fúzionál. A kurzor `useEffect`-tel áll a beszúrt token mögé (a textarea kontrollált: klikk-időben a DOM még a régi stringet hordja).
- [x] **M7.2** Méret-chipek: `.size-<W>x<H>`.
- [x] **M7.3 + bővítés** Elem-chipek **két sorban**: `CLASSES` (`.headline_text_1`) és `ELEMENTS` (`#adContainer`). **Felfedezés a valós adatból:** a mentett override-ok mind **osztályra** hivatkoznak (MC94a: `.size-300x250 .copy_text_2 {…}`), az id-k a konténereken ülnek — a todo eredeti `#<id>`-only terve a rossz szókincset kínálta volna.
- **Nyitva hagyva (kicsi):** a `html` sablonnál 25 class + 22 id = 47 chip, ami hosszú blokk. Ha zavaró, egy „több…" összecsukás a Classes sorra a következő kör.

### ~~M8 — Creative Library size filter csoportosított dropdown~~ — **KIVEZETVE (user, 2026-09-10)**
A legolcsóbb 80% már él: a Size pill `SIZE_QUICK_SELECT` preset-linkjei (`CreativeLibrary.tsx:44-51`) — `default / social / iab / none`, és egy preset csak akkor jelenik meg, ha a data tényleg tartalmazza azokat a méreteket. Csoport-fejléc + tri-state = `MultiPill`-műtét (5 használati hely) egy megoldott problémára. **Ha a méretlista tényleg hosszúra nő és zavaró lesz, visszahozzuk** — addig nem.

### Monitoring maradék (Wave 3)
- ~~**W3.g** Matrix cella stat-badge~~ — **KIVEZETVE (user, 2026-09-10).** Nem kell. (Tény a jövőnek: az adat-út kész lenne — `useMessageMetrics` + `/api/monitoring/message-metrics` per-`messageId` impr/cost/conv-ot ad; csak `clicks` hiányzik a `MessageMetricRow`-ból a CTR-hez.)
- [ ] **W3.h → átkeretezve, saját szelet, NEM UI-apróság (user: „most túl nagy", 2026-09-10).** Unmatched sor → message kézi link. **A naiv megoldás némán elveszik:** a monitoring import **periódusonként töröl + újratölt** minden sort (`import/route.ts:121-135`), tehát egy kézzel beírt `monitoring.messageId` **eltűnik a következő feltöltéskor** — és a W3.j-6 (mind a 4-5 riportfájl újraimportja) nyitva áll, szóval ez biztosan bekövetkezik. Túléléshez: override-tábla a **message-kulcsra** (`mcNumber+variant+audienceKey+topicKey` vagy pmmid) + **4. resolver-szint** a `buildMessageResolver`-ben + reapply-pass. Kész minta: `resolveProduct` keyword→product szabályok + `/api/monitoring/reapply-products` — **szabály, nem soronkénti kézimunka**, és épp ezért éli túl az újraimportot. **Első lépés felméréssel:** hány unmatched sor van, ebből mennyi `family_known` vs teljes no-match, és mennyi impressziót visznek — a szám dönti el, megéri-e bármit építeni.
- Deferred: **Meta parser/resolver** — blokkolva valós Meta export sample-ig.

### Agent-oldal (MCP + provenance)

### ~~MCP token-scope #3: `draft`~~ — **✅ KÉSZ (6.84.0, 2026-09-12)**
Leszállítva: `read | draft | full`. A `draft` mindent olvas, és csak a draft-térbe ír
(`generate_test_creative`, `brief_attach`, `draft_archive`, `asset_upload`). **Séma-migráció nincs**
(`mcp_tokens.scope` sima `text`, check constraint nélkül).

- [x] **S1** `McpScope = "read" | "draft" | "full"`; `resolveBearerClient` a tárolt értéket adja.
- [x] **S2** `buildMcpServer` `draft` ága; `draft_promote` külön `registerDraftPromoteTool`-ba emelve,
      csak `full` kapja — a promote cellát ad, azaz kilép a draft-térből.
- [x] **S3** `outsideDraftScope()` sorszintű őr. Két helyen kellett: `brief_attach` (bármely message
      id-t elfogad) **és — menet közben derült ki — az `asset_upload` `replace_existing`-je**: a
      fájlnév-feloldás newest-first, tehát a csere azt írja át, amit egy **már kihelyezett** kártya
      renderel. Az őr a SORON ül, nem a tool-listán, különben egy később hozzáadott tool kicsúszik.
- [x] **S4** `mcp-tokens/route.ts` validáció (`read|draft|full`); demo user marad `read`-only.
- [x] **S5** `McpTab.tsx`: típus, `SCOPE_BADGE` map (amber), select-opció, próza.
- [x] **S6** 5 új teszt (tool-lista draft scope-ban · bearer-feloldás · `brief_attach` placed kártyán
      elutasít + full-scope kontroll · `replace_existing` elutasítás + új név megy). 911/911.
- [x] **S7** CHANGELOG + `6.84.0` minor bump.

**⚠️ Nyitva hagyott döntés (user elé):** a `scope` oszlopon **nincs check constraint**, és az ismeretlen
érték **`full`-ra szélesedik** (`mcp.ts` `resolveBearerClient`) — ez a 6.0 óta így van, én csak
dokumentáltam (teszt + komment). Egy elgépelt kézi SQL így teljes jogot ad. Szűkítés `read`-re +
check constraint = egy migrációs szelet; a user dönt.

**Következő szelet → ✅ leszállítva `6.85.0`-ban:** `draft_update` MCP tool.

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

### 2026-09-10 — dashboard: friss adat kattintásra + „ebben a hónapban még nincs riport" (TERV, jóváhagyásra vár)

**User (két kérés, egy képernyő):**
1. „frissítési gond volt, kéne hogy ha átkattintok akkor reload nélkül is frissüljön"
2. „ha szeptemberi időszakban vagyunk sept 4-10 ig akkor azt kéne mutassa … hogy szeptemberre nincs adatunk, még akkor is ha mutatja a multat ami jó, de kéne ott egy szeptember oszlop hogy üres"

**Gyökérok (1) — nem cache-bug.** A `staleTimes.dynamic` alapértéke a Next 15.5-ben `0`
(`node_modules/next/dist/server/config-shared.js:203`), a `/` ráadásul `force-dynamic`
(`src/app/(app)/page.tsx:63`), tehát appon belüli navigációnál a szerver úgyis újrarenderel.
Ami tegnap megfogott: **a fül órákig nyitva állt, és a napi horgony a URL-be van fagyasztva**
(`?d=2026-09-09&r=7d`). Éjfél után ugyanaz a URL már a *tegnapi* ablakot kéri — a ma készült
MC-k nem hiányoztak, csak kívül estek. A cookie ezt jól kezeli (`dashboard-view.ts`: „a CHOSEN
VIEW, nem egy befagyasztott dátum"), a nyitva felejtett fül URL-je nem.

- [x] `_dashboard/DashboardLiveRefresh.tsx` (client, semmit nem renderel): `visibilitychange` →
      ha a URL `d`-je < mai UTC nap, `router.replace` a mai horgonyra (a `r`/`p`/`cs`
      paramétereket megtartva); egyébként `router.refresh()`.
- [x] Nincs interval, nincs polling — a kiváltó ok a fül visszafókuszálása, nem az idő múlása.
      Csak `visibilitychange`: egy eseményt hallgat, így nincs mit deduplikálni (a `focus`
      ugyanarra a fülváltásra másodszor is tüzelne).
- [x] Csak a dashboardon (user: „Csak a dashboardon"). A Matrix / Creative Library szerkesztési
      állapotot tart; ott egy magától érkező refresh kockázat, nem szolgáltatás.

**Gyökérok (2).** `monthlyDelivery` (`src/lib/dashboard-monitoring.ts:33`) azt a néhány perió­dust
adja vissza, ami a `monitoring`-ban **létezik** — szeptemberi import nincs, így szeptemberi oszlop
sincs. Mindkét csempe (`DeliveryTrend`, `CoverageTile`) a sor utolsó elemét tekinti „current"-nek,
ezért az augusztus úgy néz ki, mintha a mostani hónap volna.

- [x] `DeliveryMonth` kap egy `reported: boolean` mezőt; `monthlyDelivery` új 4. paramétere
      (`throughMonth`, „YYYY-MM") a legutolsó importált periódus és a scope horgony-hónapja közti
      naptári hónapokat **üres elemként** hozzáfűzi (`padMissingMonths`). A page a
      `scope.date.slice(0, 7)`-et adja át.
- [x] A fejszám (20.1M / 35%) **marad az utolsó importált hónapon** — a user szerint a múlt mutatása
      jó. Mindkét csempében `measured = months.filter(m => m.reported)`, és a `latest` innen jön;
      a coverage `0/0`-t sosem oszt.
- [x] Az üres hónap oszlopa **nem 6%-os csonk** (az „majdnem nulla delivery"-t jelentene), hanem
      szaggatott keretű, teljes magasságú placeholder; tooltip: „Sep 2026: not imported".
      A tengelyfelirat `text-slate-300`. A hint mondatban is ki van mondva:
      „impressions · Aug 2026 vs Jul · no Sep data yet".
- [x] Új szemantikus nevek a `component-inventory.md`-ben: `delivery-trend__bar--missing`,
      `coverage-tile__bar--missing`.
- [x] 4 új teszt a `tests/integration/dashboard-monitoring.test.ts`-ben (kitöltés, évforduló,
      „a scope hónapja ≤ utolsó import → nincs padding", „nincs import → nincs horgony").
      13/13 zöld.

**Döntés (user, 2026-09-10):** a feltöltés a *scope* horgony-hónapjáig megy — júniusra
visszalapozva nincs padding, a csempe azt mutatja, ami akkor igaz volt.

**Nyitva:** a lokális prod buildet böngészőben nem néztem meg (a login a userre tartozik);
`npm run build` + `tsc` + `eslint` + a 13 teszt zöld.

### 2026-09-10 — draft variánsok + Creative Library mint a draft anyagtára (TERV jóváhagyva)

Teljes terv: `~/.claude/plans/v-rjunk-m-g-van-m-g-jiggly-storm.md`. User-döntések: a draft **nyitva marad indexként**
(nincs auto-promote/archiválás), a `target` **átkerül a Brief fülre**, variáns-létrehozás **két akció**
(duplicate / empty), cover **csak 300×250**, egyébként „No 300×250 agentic preview yet".

- [x] **Slice 1 — `promoteDraft` guardok** (séma nélkül, UI nélkül): cross-topic szám-guard (axis-scoped,
      `sameAxisAs`) + archivált-iker guard. Előbb megy ki, mint a Slice 2, mert az teszi elérhetővé őket.
- [x] **Slice 2 — MC404b**: `createDraft` `requestedNumber`, `createDraftVariant(mode)`, `POST /api/drafts`
      `{ from_draft_id, mode }`, két gomb a Brief fülön, Delete-copy javítás több draft esetén.
- [x] **Slice 3 — `draft_target`**: 0018 migráció + check constraint, plumbing, szegmentált vezérlő a Brief
      fülön, a Promote fül olvassa (read-only sorral).
- [x] **Slice 4a — matched adat + Promote fül**: `listCreativeMatchesForMcs`, additív `matches` a
      `/api/creatives/by-mc`-n és a `/api/drafts`-on, számláló + bélyegkép-sor.
- [x] **Slice 4b — fal + jobb panel**: kártya-cover szabály, sarok-badge, editor jobb panel library-preview.

**Mind az öt szelet leszállítva, 6.73.0 (2026-09-10).** `npm test` 871/871 (92 fájl, ebből új:
`draft-target`, `creative-matches`, `api/drafts-variant`, plusz 9 új eset a `draft-lifecycle`-ben),
`tsc` + `eslint` + `next build` tiszta.

⚠️ **Deploy-figyelmeztetés: séma-migráció VAN (`0018_jazzy_steel_serpent.sql`).** A dev a *közös*
Hetzner Postgresre néz, tehát amíg a migráció nem futott, **sem lokálisan, sem élesben nem indul**
a `messages`-t olvasó lekérdezés (`column "draft_target" does not exist`). Egy passzban, a boxon:
`export $(grep '^DATABASE_URL=' .env | xargs) && npm run db:migrate` → build → `pm2 restart
mm6-erste --update-env`. Az oszlop nullable + check, a régi kód sosem írja, tehát a migráció
önmagában ártalmatlan a futó verzióra.

**A dashboard-szelet (üres hónap-oszlop + fókusz-frissítés) ugyanebben a bumpban ment.**

**DEPLOYOLVA 6.73.0 (2026-09-10):** commit `5f285d0`, box `e1886f7`→`5f285d0`. **Séma-migráció VAN**,
egy passzban: `export $(grep '^DATABASE_URL=' .env | xargs) && npm run db:migrate` (0018) → build →
`pm2 restart mm6-erste --update-env` → Ready 1240ms. Mentés nem kellett: a migráció tisztán additív
(`ADD COLUMN draft_target text` + check), a rollback egyetlen `ALTER TABLE messages DROP COLUMN
draft_target`. Ellenőrizve élesben: az oszlop és a `messages_draft_target_values` constraint ott van,
`error.log` üres a restart óta, `deployed 6.73.0`. Health: `/login` 200 · `/` 307 · `/drafts` 307 ·
`/matrix` 307 · `/api/drafts` 401 · `/mcp` 401 · **`/share/fke-60Mn5frC` 200** — ez utóbbi a lényeg,
mert publikus és `messages`-t olvas az új sémán át, tehát a kód és a DB együtt van.

~~**Böngészőben NEM ellenőrizve**~~ → a 6.74–6.83 iterációk mind ezeken a felületeken mentek, élőben
használva. Lezárva 2026-09-12.

### 2026-09-10 — draft-kártya: kétsoros meta + akció-menü — 6.74.0

**User:** „tegyük az MC alá a product taget és a draft name-et, és tegyünk egy ellipsis local menüt a
kártyára ahonnan lehet a duplicate, new variant, az archive és delete akciókat választani"

- [x] `drafts-tile__meta` **két sor**: `__mc` külön, alatta `__sub` = product chip + név. A 6.72.0-s
      egysoros szabályt a *tördelés* indokolta (egyes kártyákon két sorra nőtt, másokon nem) — a fix
      kétsoros blokk ezt nem hozza vissza, egyik sor sem tördel.
- [x] `drafts-tile__menu` — ellipszis a média jobb felső sarkában, `opacity-0 group-hover:opacity-100`;
      Duplicate as variant · New empty variant · ─ · Archive · Delete. Kívülre kattintás + Escape zár
      (a `creative-library__preview-warning` mintája).
- [x] **A csempe külső eleme `div` lett, benne a kattintható `button`** — gomb a gombban érvénytelen
      markup, a böngésző lezárja a külsőt és a kártya saját kattintása elromlik egy részén.
- [x] A Delete helyben, két kattintással erősít, és a SZÁMRÓL beszél: testvér-drafttal
      „MC404 stays reserved.", egyébként „free the number?". Ugyanaz a nyelv, mint a Promote fülön.
- [x] A matched-badge **balra** költözött, mert a jobb felső sarkot a menü kapta.

`npm test` 871/871, `tsc` + `eslint` + `next build` tiszta. Séma-migráció nincs.

### 2026-09-10 — a draft akciói egy helyre: a kártya drop-up menüje — 6.75.0

**User:** „legyen az első sor Product tag + MC, és a name legyen a második sor, az ellipsis legyen
felhulló menü és jobb alsó sarokban, vízszintes ellipsis, és legyenek bele kivezetve az akciógombok
ne csak bemenjen a kártyára, és ezeket az akciógombokat meg vegyük ki belülről. A Brief fülön a
product lehet egymás mellett a Draft name-mel, nem kell az input mezők alá a magyarázat szürke
szöveg, a variants úgy kerüljön ki az action menübe."

- [x] `drafts-tile__meta` első sor: `__product` + `__mc`; második sor: `__name`. `pr-8`, hogy a menü
      ne üljön rá.
- [x] `drafts-tile__menu` a **jobb alsó** sarokban, **felfelé** nyílik (`bottom-full mb-1`) — a gomb a
      kártya alsó élén ül, lefelé nyílva kilógna a kártyából és az utolsó soron a görgetőből is.
- [x] `brief-tab__variant` **megszűnt** — a két variáns-akció a kártya menüjében él.
- [x] A Promote fül `promote-tab__discard` párosa (Archive/Delete) **megszűnt** — ugyanoda költözött.
      A fül egy kérdést válaszol meg: hova. Vele ment a `siblingDraftCount` prop és a `confirming` state.
- [x] `brief-tab__intake-row`: Draft name (`flex-1`) + Product (`w-36`) egy sorban.
- [x] A Brief fül `Field`-jei **hint nélkül**. A Brief slide inputnak placeholdere van, a hibát a
      `form-field__error` mondja ki — a magyarázó bekezdést senki nem olvassa kétszer.

`npm test` 871/871, `tsc` + `eslint` + `next build` tiszta. Séma-migráció nincs.

### 2026-09-10 — draft = egy MC, a variánsok befelé (TERV, jóváhagyásra vár)

**User:** „a draftokat ne kezeljük variánsonként, mert nem tudjuk előre hány lesz — a draft fogja csak
az MC sorszámot, a variánskezelés menjen belülre: Brief fül, aztán variant a / variant b tabok, de
csak egy tabbal indulunk. Egy tabon belül legyen minden content dolog: template szekció, content
szekció, style szekció. Lehessen tabot duplikálni vagy hozzáadni. Ha több tab mint 4, ne írjuk ki
hogy »variant a«, csak »a, b, c«. A tervezett topic mezőt vezessük ki a Brief fülre a Target fölé.
A promote akció kerüljön a kártya ellipszis-menüjébe, dialógust nyisson, ahol beállítható mely
variánsokat promotáljuk, milyen audience-re (default INCOMING), milyen státusszal (default PREVIEW),
melyik topicra, és hogy promote után a draft megmaradjon vagy archiválódjon — két megerősítő gomb:
»Promote and archive« / »Promote«. Nem kell form element."

**Két tisztázott döntés (user, 2026-09-10):**
- **A promote konvertál, nincs duplikátum** — a sor megszűnik draft lenni, ahogy ma. A „megmaradjon
  vagy archiválódjon" tehát a **nem promotált** variánsokra vonatkozik: a `Promote` a maradékot a
  falon hagyja, a `Promote and archive` nyugdíjazza. **Nincs modellváltás**, a szám/brief/történet
  ugyanúgy átmegy.
- **Cover:** az `a` variánssal indul, és a kártya fölött **vízszintesen scrubbolva** vált — ahány
  variáns, annyi aktív sáv a médián, és a preview arra ugrik.

**Séma-migráció NINCS.** A variánsok ma is külön `messages` sorok ugyanazon a `number`-en; a változás
az, hogy a fal és a szerkesztő ezt **egy kártyaként** kezeli.

- [x] **Slice 1 — a fal MC-számonként csoportosít.** `DraftsView`: `drafts` → `Map<number, Draft[]>`
      betű szerint rendezve, egy `DraftTile` csoportonként. A csempe címkéje `MC404` (betű nélkül).
      Cover = `a`, `drafts-tile__scrub` sávokkal: N egyenlő zóna a médián, `onMouseEnter`-re vált az
      aktív variánsra, `onMouseLeave`-re visszaáll `a`-ra; alul N szegmensű jelző. A `mc:` szűrő a
      csoportra illeszkedjen. Az Archive/Delete a **teljes MC-re** hat (minden variáns-sora), a
      megerősítő szöveg mondja ki a darabszámot.
- [x] **Slice 1b — a matched-jelzés a médiáról a meta sorba.** A sarok-badge megszűnik; helyette az
      MC szám **mellett**: `MC404 · matched 18 (a,b)` — az összes találat a variánsokon át, és
      zárójelben azok a betűk, amelyekhez tartozik anyag. Nulla találatnál nem írunk ki semmit.
      (User, 2026-09-10: „ne a jobb sarokba írjuk ki hogy 9 creative found, hanem az MC szám mellett".)
- [x] **Slice 2 — variánsváltó a szerkesztő FEJLÉCÉBEN, nem fülekben** (user, menet közben: „ne
      kelljen szétbaszni az MC editor fülkezelését"). Új, önálló komponens a `‹ ● MC404a › 1/5`
      léptető mellé: a szám variánsai gombként (`a` `b` `c`), az aktív kiemelve, kattintásra a
      meglévő `onJump`-pal vált sorra; mellette `+` a *Duplicate this variant* / *New empty variant*
      párossal. **A Template / Content / Styles fülek érintetlenül maradnak**, és a mátrix
      fülkezeléséhez egyáltalán nem nyúlunk. A `Promote` fül eltűnik (a kártya dialógusába megy).
- [x] **Slice 3 — tervezett topic a Brief fülre**, a Target fölé (a draft szabadszöveges `topic`-ja).
      A Promote fül hintje eddig ott mondta ki; az a hely megszűnik.
- [x] **Slice 4 — Promote dialógus a kártya menüjéből.** `AppDialog` shell, **nincs `<form>`**:
      variáns-checkboxok (default mind) · audience `<select>` (default `<PRODUCT>_INCOMING`, ha van
      ilyen kulcs) · státusz `<select>` (default `PREVIEW`) · topic `<select>` (csak létező topic,
      a promote sosem hoz létre topicot) · két gomb: `Promote` és `Promote and archive`.
      Új route: `POST /api/drafts/promote` `{ ids, audienceKey, topicKey, status, archiveRest }`,
      betűsorrendben hívja a `promoteDraft`-ot, és per-id eredményt ad vissza.
- [x] **Slice 4b — a saját betű megtartása promotáláskor.** Ma a `promoteDraft` akkor is a következő
      szabad betűre ugrik, ha a draft SAJÁT betűje szabad a cellában (404a és 404c promotálásakor a
      `c`-ből `b` lesz, csendben). A javítás: ha a draft betűje szabad a célcellában, maradjon; csak
      ütközéskor bumpoljon. Enélkül a dialógus részhalmaz-promotálása átnevezi a variánsokat.

**Amit ez visszavon a mai munkából:** a kártya menüjéből a két variáns-akció kikerül (befelé megy a
fülsorra), a Promote fül megszűnik. Az Archive/Delete a menüben marad, de MC-szintre tágul.

**Leszállítva 6.76.0 (2026-09-10).** `npm test` 880/880 (93 fájl, új: `api/drafts-promote-batch`),
`tsc` + `eslint` + `next build` tiszta. **Séma-migráció nincs.**

Két dolog, ami menet közben derült ki:
- A `promoteDraft` **saját betű** javítása nem kozmetika: a dialógus részhalmaz-promotálása nélküle
  minden alkalommal átnevezte volna a variánsokat (404a + 404c → a és **b**).
- A `topic` bekerült a szerkesztő `EDITABLE_KEYS`-ébe, de `string | null`-ként felülírva:
  a placed kártya `topic`-ja nem nullable, a drafté igen, és a Brief fül csak a draft-only
  intake-blokkban kínálja.

### 2026-09-10 — a variáns-betű a draft sorozata, nem a mátrixé — 6.77.0

**User:** „duplicate-re egyből C-re ugrott, nem látszik a B variáns, amúgy van már hozzá creative
library item, lehet ez a baj?" — igen, és a szabály volt rossz, nem a library.

Az adat: `MC404` — draft `a` (36016) + **négy élő Agentic sor** (`404a`/`404b` × `ch_disp`/`ch_soc`,
36017–36020), amiket a `ensureAgenticMc` mintázott a feltöltött `ERSTE_MARKET_MC404_a/b_…` fájlokból.
A 6.75.0-s `createDraft` a **teljes élő halmazon** kereste a következő betűt, így a `b`-t foglaltnak
látta és `c`-t adott (36021).

- [x] A betű a **draft sorokon** fut (`live.filter(audience === null && number === n)`), nem az
      összes élő soron. A leszállított MC404b fájlok nem „valami más": pont az, amiért a `b` variáns
      van, és `(number, variant)`-tal találják meg. Draftnak nincs cellája, tehát nem is ütközhet
      placed sorral; az igazi ütközés a promote-nál van, ahol a `promoteDraft` már bumpol.
- [x] A teszt megfordítva (`takes the next DRAFT letter…`), plusz új eset: másik **draft** által
      tartott betű elutasítva.
- [x] `draft-variants__item--ghost` — a máshol létező betűk (matched kreatívok alapján) szaggatottan
      megjelennek a fejlécben, tartalom nélkül. A `matches` map-ből, új lekérdezés nélkül.
- [x] `draft-variants__delete` — a nyitott variáns törlése a `+` mellett, két kattintással; utána a
      szerkesztő a megmaradt betűre ugrik, vagy bezár, ha a szám elfogyott.

**A user 404c sorához nem nyúltam** — az új törlés-gombbal maga akarta eltüntetni, utána a duplicate
már `b`-t ad.

### 2026-09-10 — a scrub kiolvasása az MC címkén — 6.78.0

**User:** „nem kell ide a c jelölés a preview kép fölé, de a működés az jó — úgy tegyük érthetővé
hogy miért vált a kép, hogy mouse overre az MC jelölés végére tegyük oda azt a variánst, amit épp
a mouse over megjelenít."

- [x] `drafts-tile__variants` / `__variant` **megszűnt** — a betűcsík lekerült a képről.
- [x] `drafts-tile__mc` több variáns esetén a végén viszi az aktív betűt (`MC404a` → `MC404b`).
      Egy variánsnál nincs mit váltani, marad `MC404`.
- [x] A `__scrub` zónák maradnak, csak most semmit nem rajzolnak.

### 2026-09-10 — a dashboard strip egy csempét ad egy variánsnak — 6.79.0

**User:** „miért van kétszer itt a legfrissebbek között a 404 a és b — 404 most nem both hanem
agentic, így nem kell a html preview."

**A diagnózis más volt, mint a feltételezés:** nem html preview duplázott. Az MC404 Agentic tükrei
`template = null`-lal ülnek, a strip `mc` ága pedig csak sablonos sort vesz, tehát onnan MC404 nem
is jöhet. Mind a négy csempe **feltöltött fájl** volt: `MC404a` és `MC404b`, egyenként 300×250-ben
ÉS 1080×1080-ban — a strip mindkét elfogadott méretet kirakta.

- [x] Az uploaded ág `distinct on (mc_number, mc_variant)`-ra ment, a 300×250 nyer (az a forma,
      amiben a strip többi csempéje is van). Ez egy **ellentmondást is felold**: az `mc` ág mindig is
      `(number, variant)`-onként egy csempét adott, épp azért, amiért az uploaded ág nem.
- [x] MC-szám nélküli kreatívokat NEM csoportosít — nincs mi szerint; két számozatlan fájl két
      szállítás. Az id tartja őket külön.
- [x] A `sourceCount` ugyanígy számol, különben a „N in this window" és a lapozás elcsúszna.
- [x] Három új teszt (mindkét méret megérkezett · csak a négyzetes van · számozatlanok nem
      csoportosulnak). `npm test` 884/884.

### 2026-09-10 — Production target + tagelt planned topic — 6.80.0

**User:** „a planned topicot tegyük a Target alá (a Targetet nevezzük át production target-re), ha DCO
akkor legyen itt a tag 1-2-3 lehulló egymás után és a Tag 4 free input field, és ha both akkor is,
ha pedig agentic akkor legyen egy üres mező, Topic input field."

- [x] `Target` → **`Production target`**, a planned topic **alá** került.
- [x] `PlannedTopicField` — DCO/Both: tag1–3 legördülő + tag4 szabad szöveg + a összeálló kulcs
      előnézete; Agentic: egy szabad mező.
- [x] A szótár a **ténylegesen használt** értékekből jön (`topics.tag1..tag3`), `NA` elöl. Egy olyan
      érték, amit a draft visz, de a dimenzió már nem (archivált topic), nem tűnik el a saját
      legördülőjéből.
- [x] Az összefűzés a kliens `topicKey` mintáját követi
      (`{{product}}_{{tag1}}_{{tag2}}_{{tag3}}_{{tag4}}`); a mérvadó generátor továbbra is a
      `keyFromPattern`. A komponens `_`-ra fűz és `_`-nál bont, tehát a két fele egymással
      konzisztens; a tag4 megtarthatja a saját aláhúzásait.

**Mellékesen tisztázva (user kérdés):** a dashboard creative-strip **nincs 5-re vágva** — a lusta
vízszintes végtelen görgetés megvan (`CreativeStrip.loadMore`, `nextOffset`, oldalanként 24). Az
„5 in this window" a teljes találat; 7-ről 5-re a 6.79.0-s összevonás vitte (MC404a/b négy csempéje
kettő lett).

### 2026-09-10 — a mentés nem perzisztált a drafts oldalon — 6.81.0

**User:** „ha A és B-t átállítom DCO-ra, elkezdek lépkedni a headerben, előbb-utóbb visszaugrik
Agenticre; oldalfrissítés után jól jelenik meg, pedig kiírta az autosave hogy saved. Általában van
problémám, hogy a megváltoztatott értékek nem perzisztálnak, valami state-ben bent marad."

**Gyökérok — nem a mentés, hanem a cache.** A `MessageEditor` `save.onSuccess`-e a szerver által
visszaadott sort **bepatcheli a lista-cache-be**, hogy a rács azonnal a mentett értéket mutassa —
de csak a `["messages"]` kulcsba (`MessageEditor.tsx:464`). A drafts oldal viszont a saját sorait a
**`["drafts"]`** borítékban tartja. Az a másolat a mentés ELŐTTI értékeken maradt, a szerkesztő
pedig minden sor-váltáskor **abból** veti újra a `draft` state-jét — tehát variánsváltás (vagy a
`‹ ›` léptető) után visszatérve a régi értékek íródtak a frissen mentettek fölé. A „saved" nem
hazudott: a szerver oldalon ott volt, csak a képernyőn nem.

- [x] `save.onSuccess` a `["drafts"]` borítékot is patcheli (a `matches` kulcsot érintetlenül
      átvíve). Minden draft-mezőt érint, nem csak a targetet.
- [x] **A mátrix szerkesztő nem volt érintett:** a rács kulcsa `["messages", { showArchived }]`, amit
      a meglévő prefix-illesztésű `setQueriesData` már lefed — ezt a kód kommentje ki is mondja.
- [x] `planned-topic__row` — a négy tag egy sorban, kulcs-sorrendben.

### 2026-09-10 — a tag4-be gépelés a tag1-be került — 6.81.1

**User:** „nem tudok rendesen gépelni pl. a tag4 mezőbe, mert mindig a mentés miatt elugrik a kurzor."

**Nem a mentés volt, hanem a tegnapi composerem.** A `joinTopic` `filter(Boolean)`-nel dobta az üres
részeket, így `tag4 = "t"` → `MARKET_t`, amit a `splitTopic` **tag1 = "t"**-nek olvasott vissza: a
karakter átugrott az első mezőbe, a kurzor vele. Ráadásul minden leütés a composed stringen keresztül
ment oda-vissza, tehát az input értéke az volt, ami a round-tripet túlélte.

- [x] `joinTopic` **pozíciótartó** (üres slot üres szegmens marad: `MARKET____t`) — pont az, amit a
      tárolt kulcs-minta is előállít ugyanerre a bemenetre. Csak a záró üresek esnek ki.
- [x] A négy rész **saját state**, `composedRef`-fel: a `value` csak akkor seedel újra, ha kívülről
      változott (másik variáns, reload), nem minden leütésnél.
- [x] 7 unit teszt a `tests/unit/planned-topic.test.ts`-ben, benne a konkrét hibás eset.

~~**NYITVA — külön feladat:** 409 a saját mentés ellen~~ → **LEZÁRVA 6.82.1-ben** (a fan-out sorok
elavult `version`-je a kliens-cache-ben volt az ok, l. lent).

### 2026-09-10 — a brief az MC-hez tartozik, nem a variánshoz — 6.82.0

**User:** „a briefnek MC-hez kéne tartoznia és nem variánshoz — nem lehet az, hogy az a és b DCO, a c
meg agentic, és az sem, hogy a variánsoknak más a topicja, tag-je; a brief is mindig ugyanaz. A
mostani b és c brief-füles adatait el lehet dobni, ami az a varianson van, az vonatkozik az egész
draft MC-re."

- [x] `propagateBriefAcrossDraftVariants` az `updateMessage` végén: draft soron az intake
      (`brief`, `briefSlidesFileId`, `briefSlideId`, `topic`, `draftProduct`, `draftTarget`)
      a szám **összes élő draft sorára** kiíródik. A **teljes** intake megy ki, nem csak a
      megváltozott mező — ettől szűnik meg a korábbi eltérés, nem félig.
- [x] Placed kártyát nem érint (`status='DRAFT'` + `audience is null` szűrő), és a variáns-szintű
      tartalom (template/content/styles) érintetlen — 4 új teszt fedi mindkettőt.
- [x] **Miért nem külön MC-tábla:** ezek nem draft-only oszlopok. A `brief_slides_file_id`/`brief`
      a placed kártyákon is él, a mátrix Brief füle ott **kártyánként** szerkeszti, és az MCP
      `list_briefs` ez alapján csoportosít — két külön cellában lévő kártya jogosan vihet más
      briefet. A számra normalizálás attól a felülettől venné el, amelyiknek kell.
- [x] **Live adat rendezve:** `a` variáns intake-je ráírva a többire (MC400 b/c topicja
      `SZA____szamlavalaszto` → `SZA_edukacio_NA_tudatossag_szamlavalaszto`; MC404 már egyezett).
      2 sor módosult, mentés előtte: `scratchpad/draft-intake-backup-20260910.csv` (8 sor).

### 2026-09-10 — a fan-out a képernyőig — 6.82.1

**User:** „ha egy MC minden variánsának ugyanaz a brief füle, akkor hogy lehet a 404a ilyen, a 404b meg
ilyen?" — a **DB-ben nem is tért el**: mindkettő `agentic`, ugyanazzal az `updated_at`-tel. Amit
látott, kizárólag kliens-cache.

**Gyökérok:** a 6.82.0 fan-outja a szám többi draft sorát is írja, de azok **nincsenek benne a PATCH
válaszában**, a kliens pedig csak a visszakapott sort patchelte. A többi variáns így a fan-out előtti
értéket mutatta reloadig — és a cache-elt **`version`-jük is ott maradt**, tehát a következő
szerkesztés rajtuk elavult `If-Match`-csel ment ki. **Innen jött a „saját munkámba akadok" 409 is.**

- [x] `src/lib/draft-intake.ts` — a mezőlista egy helyen, szerver és kliens is ezt nevezi meg
      (a kliens nem húzhatja be az entity modult a db-vel együtt).
- [x] `save.onSuccess`: ha a mentett sor draft ÉS a payload intake-mezőt érint → `["drafts"]`
      invalidate. A payloadra van kapuzva, hogy a sima gépelés ne indítson újratöltést.
- [x] Lokális build kihagyva az új szabály szerint; `tsc` + `eslint` tiszta, `npm test` 895/895.

### 2026-09-10 — apróság-kör: pill-kiírás + Custom-CSS chipek — 6.83.0

**User-döntések a NEXT/UI-apróságokról (M1, M7, M8, W3.g, W3.h):** „a color by strategy nem kell és
legend se kell a pixel magassághoz, M7 kell egyértelmű, M8-ból ami megvalósult jobb, W3.g nem kell,
W3.h most túl nagy" + **M12.1 most**: „ha max 2 van kijelölve, a szám helyett írja ki, mi van
kijelölve; a szám csak 3-nál többnél".

- [x] **M12.1** `MultiPill.describeSelection()` — 1–2 kijelölés = értékek, 3+ = szám. Alapviselkedés
      minden pillen, nem prop. Opció-lista sorrend (nem klikk-sorrend). 6 unit teszt.
- [x] **M7 teljes** (3 commit): `elementIds` + `elementClasses` a `TemplateInfo`-ba → `SelectorChips`
      a Styles fülön → a Classes sor a valós szókincs. Részletek a NEXT M7 szekciójában.
- [x] `MessageEditor`: a draft sablonjának keresése **egy** helyen (`currentTemplate`), nem harmadszor
      másolva — a Content-méretek, a chipek és a preview ugyanazt kérdezik.
- [x] M1 / M8 / W3.g kivezetve a roadmapről indoklással; W3.h átkeretezve saját, felméréssel induló
      szeletté.

**⚠️ Incidens — élő MC-n teszteltem, autosave-vel:** a chip-beszúrást az MC94a-n (`messages.id=31590`)
próbáltam ki; a takarításhoz használt `shift+Home` macOS textareában a **dokumentum elejéig** jelöl ki,
így a Backspace az egész `custom_css` mezőt törölte, az autosave pedig elmentette (`audit_log` 16349,
`after=null`). A visszagépelés karaktereket ejtett (`.sie-300x250`), ezért az `audit_log` 16346-os sor
`before` mezőjéből írtam vissza byte-pontosan (`EXACT MATCH` ellenőrizve). A `version` 5→7, az
`updated_at` 20:56 — tartalmilag ép. **Tanulság a fájlba: UI-t DRAFT-on kell próbálni, nem élő
kártyán** (a második kör már az MC402a drafton ment, azt is visszaürítettem).

### 2026-09-11 — szallashu demo tenant: megvalósíthatósági tanulmány (DÖNTÉSRE VÁR)
- Tanulmány: `docs/SZALLASHU_DEMO_STUDY.md`. Meta Ad Library (~32 aktív hirdetés) + 2 Gemius display-kreatív alapján; box + DB + kód ellenőrizve.
- Verdikt: Standard scope ~18–32 gépi óra + 4–7 user-óra, 3–5 munkanap. Kritikus út: `templates/szallashu` review-kör. Meta/Google feed nincs (W4 blokkolt) — csak roadmapként.
- Nyitott: a tanulmány §7 hét döntése (scope, hostname/DNS, topológia A/B, termékek, képforrás, logó, Meta-üzenet). Kód nem változott.

### 2026-09-12 — Ikonkészlet-tanulmány: lucide → kapcsolható Streamline Core (DÖNTVE, feladattá alakítandó)
- Tanulmány: `docs/ICON_SET_STUDY.md`. Kód-leltár (87 lucide ikon / 66 fájl / 1 custom `GoogleDriveIcon`) + Streamline Core free 8 stílus (Iconify `streamline` = Line+Solid+Remix, Pop csak GitHub) + 87 soros név-megfeleltetés, kirenderelve ellenőrizve.
- Verdikt: 51 ✅ / 24 🟡 / 12 ❌ — a Core free-ben **nincs chevron, spinner, grip, rács**; ezek 9 saját 14-grid path-tal pótolhatók vagy Pro Core Line ($19/hó/seat). Kapcsolhatósághoz szemantikus ikon-regiszter (`src/app/_icons/`) + build-time generált családok kellenek; a 66 fájl egyesével áll át (~2–3 nap). Pop nem `currentColor` (fix 5 szín), dark módban CSS-var csere kell.
- Döntve (user, ugyanaznap): tenantenkénti kapcsoló a Settings → Design tabon (`lookAndFeel.iconSet`), lucide+custom a default, a Core csak a lefedett 75 ikont cseréli (12 ❌ lucide marad), Core free, Pop bekerül, lucide 1.45-re. Lépések a tanulmány §5.7-ben — agent-feladattá alakítandó. Kód nem változott.

### 2026-09-12 — MCP `draft` token-scope — 6.84.0

**User:** „ok gyerünk" / „mehet" — a 6.73–6.83 draft-modell azért épült, hogy legyen egy tér, ahol az
agent hibája nem ér el élő kártyát; ez a szelet adja hozzá a kulcsot.

- [x] S1–S7 a NEXT szekció szerint. **Séma-migráció nincs**, a deploy sima build + restart.
- [x] `npm test` **911/911** (95 fájl), `tsc` + `eslint` tiszta (0 error). Lokális build kihagyva.
- [x] Böngészőben **nem** néztem meg a Settings › MCP fület (belépést igényel) — az új select-opció,
      az amber badge és a próza vizuális ellenőrzése a useré.

**Két dolog, ami menet közben derült ki:**
- Az `asset_upload` **nem tisztán additív**: `replace_existing=true` esetén a newest-first
  fájlnév-feloldás miatt egy **élő kártya** képét cseréli le. A terv „additív, mehet a draft
  scope-ba" indoklása eddig hiányos volt — ezért kapott saját őrt, nem csak a brief_attach.
- A `draft_promote` kiemelése külön regisztrációs függvénybe kellett, mert a `registerDraftWriteTools`
  egyben tartotta a négy draft-írót; így a scope-határ a kódban is látszik, nem egy `if`-ben bújik el.

**Nyitva:** az ismeretlen `scope` érték `full`-ra szélesedése (l. a NEXT szekció figyelmeztetését).

### 2026-09-12 — `draft_update`: az agent iterálni is tud — 6.85.0

A 6.84.0 `draft` scope-ja után ez a párja: az agent eddig **létrehozni** és **archiválni** tudott
draftot, **szerkeszteni** nem — az `mc_update` pmmid-del címez, a draftnak meg nincs pmmid-je.

- [x] `updateTestCreative` (`entities/drafts.ts`): csak a **jelen lévő** mezőket írja, üres string
      **töröl**, opcionális `expectedVersion`. Nem draft / archivált / sablon nélküli sorra nem megy.
- [x] `draft_update` MCP tool ugyanazzal a szókinccsel, mint a `generate_test_creative`;
      `render` (default true) fire-and-forget újrarajzolás, `sizes` szűkíthet.
- [x] **A validáció kiemelve** (`collectContentProblems`) — a create és az update *ugyanazokkal* a
      szabályokkal ítél. Fontos részlet: a patch a draftot **a végállapotában** validálja, nem
      önmagában; különben egy tag-eket nem érintő szerkesztés üres stringre bukna el.
- [x] ~~**A `background_images` egész érték**~~ → **HIBÁS DÖNTÉS VOLT, javítva 6.86.0-ban** (l. lent).
- [x] **A template NEM cserélhető** itt: az dönti el, mely méretek és tag-tokenek érvényesek, és a
      meglévő preview-sorok árván maradnának. A tool leírása kimondja. ⚠️ **Ára:** rossz sablonnal
      indított draftnál a szám elég (az archive megtartja) — ha ez zavaró lesz, külön szelet.
- [x] 8 új teszt (patch · üres string töröl · végállapot-validáció · hiányzó képfájl · 4 slot ·
      render lista + `render=false` · version_conflict · promotált kártyát elutasít). **919/919.**

**Nem teszteltem:** hogy a `render=false` tényleg nem indít chromiumot — a shooter mockolva van, és a
fire-and-forget promise-t determinisztikusan bevárni nem tudom. A visszaadott `rendering: []`
szerződést ellenőrzöm helyette; magát a `startDraftRender`-t a create-ág már fedi.

**Séma-migráció nincs.** Deploy: build + `pm2 restart` (a 6.84.0-val együtt).

### 2026-09-12 — a képslotok szerepek, nem pozíciók — 6.86.0

**User:** „nem jó döntés volt — background_image_1 háttérnek való (de tudod a templateből),
background_image_2 objectnek, és így tovább, brand_image_1 logónak; tehát nem jó mindent felülírni,
illetve variánsonként ezt külön kell kezelni."

**Igaza volt, és a sablon tényleg megmondja.** A `template.json` `placeholders`-ében minden slot
`type: "image"` + `binding-messagingmatrix: Image1..6`; a markupban a szerep is látszik
(`background_image_1` → `#imageWrapper`, `_2` → `#objectWrapper`, `_3` → `.cardImageWrapper`,
`brand_image_1` → `.logo`). A 6.85.0-s `background_images` tömb azt állította, hogy a négy slot
felcserélhető pozíció — emiatt a logó cseréje kitörölte volna a hátteret.

- [x] `imageSlots()` / `resolveImageSlots()` a `drafts.ts`-ben: a slot→oszlop leképezés a **sablon
      bindingjéből** jön, nem beégetve. Ismeretlen slotnál megmondja, mit deklarál a sablon.
- [x] Mindkét tool (`generate_test_creative`, `draft_update`) **slotonként egy argumentum**:
      `background_image_1..4`, `brand_image_1`, `sticker_image_1`. Üres string egyetlen slotot töröl.
      ⚠️ **Törő argumentum-változás** a `generate_test_creative`-en (a `background_images` /
      `brand_image` / `sticker_image` megszűnt) — a tool-leírás a szerepeket is kimondja.
- [x] **A teszt talált egy valódi hibát a 6.85.0-ban:** a végállapot-validáció a **képekre** is
      vonatkozott, tehát egy időközben eltűnt fájlnév megbénította volna a draft *minden* szerkesztését
      (headline-javítás sem megy, amíg a képek nincsenek rendben). Most a patch csak az **általa
      beállított** slotokat validálja; a tag-tokenek maradnak végállapot-alapon (az egy mező, ahol a
      hiány = „hagyd").
- [x] **Variánsonként külön — ez már igaz volt, ellenőriztem:** a képek nincsenek benne a
      `MC_LEVEL_DRAFT_FIELDS`-ben (`draft-intake.ts`), tehát a 6.82.0-s brief-fan-out **nem** viszi át
      őket a testvér-variánsokra. A `draft_update` a konkrét variáns-sorra hat. A tool-leírás most
      ezt ki is mondja.
- [x] 3 integrációs + 6 unit teszt (`tests/unit/draft-image-slots.test.ts`). **926/926.**

### 2026-09-12 — preview-generálás a Library toolbarjából — 6.87.0

A P1–P3 leszállítva a terv szerint. **A kérés fele nem igényelt munkát:** a chromium már fent volt a
boxon (smoke-teszt: 1164 ms alatt indult és lőtt), a `/api/previews/generate` route is élt — csak a UI
nem kínálta fel sehol, és a warning tooltipje még az `npm run gen:previews`-t tanácsolta.

- [x] **P1** `BroadcastEvent.detail` (opcionális, additív) + a route felvételenként broadcastol.
      **Az entity szándékosan `preview_progress`, NEM `previews`:** a kliens hook minden frame-re
      `invalidateQueries([entity])`-t hív, és a `["previews","status"]` kulcs létezik — ~290 felvétel
      ~290 refetch lett volna. Külön teszt őrzi ezt a nevet, indoklással.
- [x] **P2** `PreviewHealth` komponens a jobb toolbarban (a `DriveHealthCheck` collapsed/expanded
      mintája). Új `broadcast-bus.ts`: a tabnak **egy** EventSource-a van (a második presence-
      kapcsolatot is jelentene), így a hook továbbadja a frame-eket a feliratkozó komponenseknek.
      Hatókör = a szűrt nézet `kind:"matrix"` elemeinek **dedupált** message id-ja (a nézet
      MC×méretenként ad egy elemet, a route message id-t vár).
- [x] **P3** A régi `creative-library__preview-warning*` nyugdíjazva, `preview-health*` az inventoryban.
      2 új teszt (progress-frame MC+mérettel; az entity-név őrzése). **928/928.**

**Amit NEM teszteltem:** a hatókör-dedupe unit tesztje elmaradt — 5 soros inline `useMemo`, és csak
azért kiemelni egy helperbe, hogy tesztelhető legyen, épp az a fajta absztrakció, amit a szabály tilt.
A böngészős ellenőrzés (a toolbar-blokk kinézete, az élő sor futás közben) a useré.

**Séma-migráció nincs.**

### 2026-09-12 — platform struktúra-fájlok kutatás: DV360 SDF · Google Ads bulk · Meta bulk (DÖNTÉSRE VÁR)
- Doksi: `docs/PLATFORM_STRUCTURE_FILES.md`. Publikus dokumentációból: SDF v10.1 teljes oszloplista (7 fájltípus), Google Ads UI bulk-sablonok szó szerinti fejlécei (48 sablon letöltve) + Editor CSV-oszlopok, Meta import/export hivatalos (elavult) + valós-export oszlopok.
- Verdikt: DV360 bétázható most (Erste 68 DV360 LI id-vel bent → valós SDF-fel diffelhető); Google Display igen (Demand Gen/PMax nem publikált); **Meta csak egy valós „Export all" xlsx-szel**.
- Javasolt modell: `platform_specs` sidecar (audience × platform, spec a platform saját oszlopnevein, external_ids visszaimportból) + per-platform structure naming-pattern. W4.2/W4.4/W4.5 ezzel átfogalmazódik feedről struktúrára.
- Tőled: DV360 SDF-letöltés (Erste), Meta Export all xlsx, Google „Editable columns" riport; döntés B1 DV360 vs B4 Meta sorrend. Kód nem változott.

### 2026-09-12 — deploy 6.87.0 (a 6.84–6.87 egy passzban)

commit `d5d23ed`, box `c49d391`→`d5d23ed` (**rollback pont: `c49d391` = 6.83.0**), `npm run build` OK,
`pm2 restart mm6-erste --update-env` → **Ready 1332ms**, box `package.json` **6.87.0**.
**Séma-migráció nincs** (`git diff --name-only c49d391..d5d23ed -- db/migrations` üres), a
`package-lock.json` sem változott → `npm install` nem kellett.

Health: `/login` 200 · `/` 307 · `/matrix` 307 · `/drafts` 307 · `/creative-library` 307 ·
`/api/templates` 401 · `/api/previews/status` 401 · `/mcp` 401; publikus
`erste.messagingmatrix.ai/login` **200**. `error.log` a restart óta üres. Chromium a boxon indul
(`chromium OK`) — ez a 6.87.0 preview-gombjának előfeltétele.

**Ami kiment:** 6.84.0 MCP `draft` token-scope · 6.85.0 `draft_update` · 6.86.0 képslot-szerepek
javítása · 6.87.0 preview-generálás a Library jobb toolbarjából.

**Böngészőben még nem ellenőrizve** (belépést igényel): a Settings › MCP `draft` opció + amber badge,
és a Creative Library jobb toolbarjának `preview-health` blokkja élő futás közben.

### 2026-09-12 — Design tab kör: capsule ki · valódi fontok · ikonkészlet-váltó · brand a toolbarba — 6.88.0

**User (két üzenetben):** „a capsule design most nem csinál semmit… mm5-ból vegyük át a TeleNeo font
családot és tegyük lehullóssá a font választót… vegyük be a Poppinst… nézzük meg hogy a co brand most
működik-e… az icon választót is lehullóssá + preview sor a page title-lel és pár ikonnal" + „a Dashboard
menüpont költözzön legfelülre, az Erste felirat ne a sidebar logó mellett legyen hanem a top toolbarban
a lap neve előtt, és cserélődjön logóra ha a cobrand be van kapcsolva" + „publicba tettem Telekom és
erste svg-t így tudod színezni feketére light mode-hoz" + döntések: „Q3-at dobjuk el, az icon hatókör
legyen teljes".

**Három dolog másképp állt, mint amire a kérés utalt:**
- **A capsule nemcsak halott volt — be is volt kapcsolva.** Az élő `erste` `lookAndFeel`-jében
  `capsuleDesign: true`, nulla olvasóval. A kulcs mind a 4 tenant JSON-jából kiesett
  (`value::jsonb - 'capsuleDesign'`). A `laf.logo` mezőhöz **nem** nyúltam: van egy (SQLite-éra,
  amúgy törött) olvasója a `cleanup-unused-assets.ts`-ben, tehát nem tisztán halott — külön döntés.
- **A font-választó placebo volt.** `@font-face` sehol, `next/font` sehol, `public/fonts` nem létezett:
  az app a rendszerbetűvel ment, a mezőbe bármit be lehetett írni. Ezért a lenyíló **nem** az első
  lépés volt, hanem a betűk leszállítása (Inter variable + Poppins 400/500/600/700 + TeleNeo
  400/500/700, 356 KB, latin + latin-ext a magyar `ő`/`ű` miatt).
- **A cobrand egyetlen képernyőt ért el** (login), és **nem volt hova feltölteni a logót**. A user
  megoldotta (`public/erste.svg`, `public/telekom.svg`); a `Telekom.svg`-t **kisbetűsítettem** — macOS-en
  mindegy, a boxon 404 lett volna.

**A logó-színezés megoldása (user ötlete nyomán):** mindkét SVG fehérre festett, és CSS-sel egy `<img>`
belsejébe nem lehet benyúlni → **`filter: invert(1)` light módban**. A fehér feketére vált, az átlátszó
rész átlátszó marad (a filter az RGB-t forgatja, az alfát nem). Egy fájl elég tenantonként. A login
kártya **mindkét témában világos**, ezért ott feltétel nélkül invertál, a toolbarban `dark:invert-0`
(a `html.dark .bg-white` shim a toolbart sötétre viszi).

- [x] **6.88.0 / 5 commit.** `tsc` + `eslint` (0 error) + `npm run build` ✅ + `npm test`.
- [x] **Ikon-migráció teljes hatókörrel** (user: „az icon hatókör legyen teljes"): `src/app/_icons/`
      regiszter, **68 fájl** átvezetve, `lucide-react` már **egyetlen** fájlban van. Szemantikus nevek
      (`close`, `delete`, `spinner`), és két lucide-alias **egyesült** (`AlertTriangle`/`TriangleAlert`,
      `AlertCircle`/`CircleAlert` — mindkét írásmód használatban volt). `IconName` a lucide családból
      származtatva (`keyof`), így egy Core család **csak részhalmaz lehet**.
- [x] **8 fájl vitte értékként az ikont** (nav-itemek, dialógus-variánsok, view-switcherek,
      `const Icon = cond ? A : B`) — ezek most `IconName`-et tárolnak. Enélkül a kapcsoló rájuk nem hatna.
- [x] **`core-line` generálva** (75 ikon, 24 KB, commitolva → a box hálózat nélkül buildel). **12 név
      szándékosan lucide marad** (chevronok, spinner, grip, 3×3 rács…): a Core free nem szállítja őket,
      és épp ezek a leggyakoribbak (a chevronok 27 fájlban). Teszt őrzi a hiányukat, hogy senki ne
      „pótolja" találgatással.
- [x] **CC BY 4.0** forrásmegjelölés (`IconCredit`) a Settings › About-on és a **publikus share láblécben**
      — csak akkor renderel, ha a tenant tényleg Core-on van.
- [x] lucide-react **1.11.0 → 1.45.0**: a bump egyetlen fájlt érintett, mert a regiszter előbb készült el.

**Amit NEM néztem meg böngészőben** (belépést igényel, a useré): a Design tab preview sora, a toolbar
brand-tagje cobranddal, és a Core Line készlet valós látványa a mátrixon. **A dev szerver (6001) a
`public/`-ba tett SVG-ket csak újraindítás után szolgálja ki** — indulásakor még nem léteztek.

**Séma-migráció nincs** (`lookAndFeel` JSON, minden merge a defaultra épül). Új npm-függőség:
`@iconify-json/streamline` (devDependency).

**Nyitva maradt a körből:** a cobrand **bekapcsolása** (Settings › Design → Enable + `/erste.svg`) —
szándékosan nem kapcsoltam be, mert a dev a **közös** élő DB-re néz, tehát az `erste` tenanton
azonnal éles változás lenne.

### 2026-09-12 — Design tab átrendezés + a maradék ikoncsalád — 6.89.0

**User (képernyőképpel):** „legyen Page title mellett a cobranding, nem kell a pipa — ha üres akkor ki
van kapcsolva; az iconset és a font legyen egy sorban; a »shipped with app« egy info ikon mögött
kattintásra nyíljon fel, onnan kattintható legyen a URL és íródjon be az inputba, mellé kattintva
tűnjön el" + „az ikon sor elején jelenítsük meg a branding logót is" + „vegyük fel a többi ikont is
a dropdownba".

- [x] Cobranding **az Identity szekcióba**, a page title mellé; a `cobranding.enabled` **megszűnt** —
      üres URL = kikapcsolva. Ez nem kozmetika: a tárolt flag **el tudott térni** az URL-től (beállított,
      de némán nem mutatott logó), és ezt kizárólag a pipa tette láthatóvá. A `CheckboxField` vele ment
      (nem maradt hívója). Az élő configokból is kiesett a kulcs.
- [x] Font + Icon set egy sorban; a preview ikonsor **a logóval kezd**.
- [x] `LogoField` info-popover: a szállított útvonalak **kattintásra beíródnak** az inputba. Kívülre
      kattintás / Escape zár (a `MultiPill` szerződése).
- [x] **Core Solid + Core Remix + Core Pop** a dropdownban. A Remix nevei a rendetlenek (a Core 1000
      ikonjából 64 prefixet kap a `-remix` suffix helyett) → a generátor végigpróbálja a prefixeket, az
      utolsó hármat a `core-map.ts` dönti el. **A Pop nevei a Remixéit követik**, ezért a generátor a
      feloldott Remix-névből vezeti le, nem találgat másodszor.
- [x] **A Pop nem `currentColor`:** a fix navy `var(--icon-ink)`-re cserélve (dark módban felemelve),
      a négy kitöltő szín marad literál — tehát a Pop ikon **nem veszi fel a státuszszínezést**
      (elfogadott kompromisszum a tanulmányból). Az editor `id` attribútumai kiszedve: a lap több
      ikonján ismétlődő id **érvénytelen HTML**, és a fájl ötöde volt.

**Mért ár, nem becsült:** +47 kB First Load JS minden route-on (`/matrix` 270 → 317 kB), mert mind a
négy család statikusan importálódik — egy tenant a három nem használtat is leszállítja. A lazy-load
hidratálás utáni ikoncserét jelentene (rosszabb); ha a súly zavar, a Pop egyedül ~28 kB belőle.

`npm test` **937/937**, `tsc` + `eslint` 0 error, `next build` ✅.

**⚠️ Külön talált probléma, NEM ebben a körben javítva — a dev szerver kimeríti az éles DB-t.**
Build közben `FATAL: sorry, too many clients already`, és a psql sem jutott be. Mérés: a **dev szerver
egyetlen processze 100 Postgres-kapcsolatot tartott** (`lsof -nP -i :5433` → `node <pid>` 100 sor),
miközben a `src/db/index.ts` `postgres(url, { max: 10 })`-zel indul. Ok: Next **dev**-ben a modul-gráf
többször értékelődik ki (route handler / RSC / HMR), és **minden kiértékelés új klienst nyit** — a régit
nem zárja. 10 modul-példány × max 10 = 100. **Ez a DB közös az éles `mm6-erste`-vel**, tehát egy lokális
dev szerver el tudja venni a kapcsolatokat az éles app elől. A dev szerver újraindítása után
`pg_stat_activity` 100 → 6. Bevett javítás: a klienst `globalThis`-re tenni (Next dev singleton minta),
de ez a DB-réteget érinti minden lekérdezés útján — **saját szelet, teszttel**.

### 2026-09-12 — cobrand-lockup a share oldalon + a DB-kapcsolat szivárgás javítva — 6.89.1

**User:** „legyen nagyobb a cobranding logo a top toolbarban 1.7 rem de úgy hogy az utána jövő dolgok
ugyanúgy vertikálisan középen legyenek" + „nem kell a `/` utána" + „a share oldalon is: ha nincs
cobranding akkor tenant neve, ha van cobranding akkor itt `×` és a logó".

- [x] **1,7rem logó, `/` elvéve.** A méret miatt a tag **ki is került a cím `items-baseline`
      csoportjából**: egy baseline-csoport a legmagasabb tagjával nő, tehát a lap neve a sor tetejére
      csúszott volna. Most közvetlen toolbar-gyerek → a toolbar `items-center`-je tartja középen.
      Két wrapper (drafts, monitoring) egygyerekes maradványként megszűnt.
- [x] **Share fejléc = lockup:** `[mmatrix] × [kliens logó]`, ha van cobrand; különben a kliens neve.
      A `×` azért ott jó és a lap-toolbarokban nem, mert a share fejlécében a **termék jele is** ott van.

**⚠️ Menet közben elszállt a share oldal 500-zal: `FATAL: sorry, too many clients already`.**
A tegnapi jegyzetben még „megfigyelt kockázat" volt — ma **blokkolt**, és a mérés szerint az éles appot
is bármikor kinyomhatta volna.

- **Gyökérok (mérve, nem feltételezve):** a `src/db/index.ts` a Postgres-klienst **modul-lokálisban**
  tartotta. A Next **dev** ezt a modult **szerver-bundle-önként** (RSC-réteg, route-handler-réteg)
  és **minden HMR-passzban** újra kiértékeli — minden kiértékelés **saját, 10-es poolt** nyitott, a
  régit nem zárta. Mérés: **1 dev szerver = 100 kapcsolat**, a box `max_connections` = **100**.
- **Javítás:** a kliens `globalThis` slotra került (`Symbol.for("mm6.db.slot")`), így minden
  modul-példány **egy** poolt oszt. **Utána ugyanaz a három útvonal** (RSC lap + kliens lap + API
  route) **2 kapcsolatot** tart, nem 100-at. Produkcióban a modul egyszer értékelődik ki → ott no-op.
- A teszt-helperek változatlanul `_resetDbForTests`-tel inicializálnak újra, a vitest fájlonként külön
  processzt ad → a globális slot nem ragad be teszt-fájlok között. `npm test` **937/937**.

**Tanulság a jövőnek:** ez a DB **közös az éles `mm6-erste`-vel**. Bármi, ami lokálisan sok kapcsolatot
nyit (dev szerver, párhuzamos build, script), az **éles kiesés** kockázata, nem kényelmi kérdés.

### 2026-09-12 — user-kör: dialóg-fejléc, CL health-panelek, dashboard-drill-down, share brief+history

**User (8 pont, képernyőképekkel):** close gomb nincs egy vonalban a fejléc gombjaival · a Creative
Library Drive-check és preview-panel kerüljön a VIEW alá, a részletek Export-dialog-szerű dialogba ·
dashboard: SZA szűrőnél MARKET share látszik · „a feed export megvolt az elmúlt 30 napban, az nem
látszik" · az Activity 28 művelete legyen kibontható dialogban · share oldal: brief esetén Slides gomb
a Drive mellé (rövid feliratok), a creative nézetben is · a Comments fejléc legyen két tab
(Comments / History).

Döntések (user, AskUserQuestion): CL-panel = stat + fekete futtató gomb + körvonalas „Details" →
dialog · a History tab az **audit-változásnaplót** mutatja · a feed-export üres állapot **nevezze meg
a legutóbbi exportot** (a 30d ablak a DB szerint helyesen tartalmazza a 2026-08-31-i SZA feedet, tehát
ez nem query-bug, hanem hiányzó „mi volt legutóbb" jelzés — ugyanaz a minta, mint a Creatives panelé).

- [x] **U1 (✅ 6.90.0) — dialóg close-gomb egy vonalban (patch).** `AppDialog` abszolút close gombja ma `top-3`
      (közép 28px), a `settings__header` viszont `h-12` (közép 24px) → 4px csúszás. A close a
      fejlécsáv közepére kerül, és a `FeedExportDialog` fejléce is a ház `h-12` toolbar-magasságára áll.
- [x] **U2 (✅ 6.90.0) — Creative Library: health-panelek a VIEW alá + Details dialog (minor).** Sorrend:
      View → Drive links → Previews → (mt-auto) Archived → Upload. A panelekben csak **stat + fekete
      futtató gomb + körvonalas Details**; a hosszú offender-lista a panelből a dialogba költözik.
      A dialog `AppDialog`, a `FeedExportDialog` fejléc-mintájával (cím + elsődleges gomb, body = tábla).
- [x] **U3 (✅ 6.90.0) — dashboard Shares: product-szűrés (patch).** A `sharesInScope` ma **egyáltalán nem**
      szűr productra, ezért SZA-szűrőnél is jön a MARKET share. A share snapshot `creatives[].product`
      (és a matrixItems üzenetei) hordozzák a terméket → a metadatából számolt product-halmaz szűr,
      a kommentek pedig csak a megmaradt share-ekre.
- [x] **U4 (✅ 6.90.0) — dashboard Feed exports: üres állapot nevezze meg a legutóbbi exportot (patch).**
      A Creatives panel nyelvén: „none in this window — last export 2026-08-31 · SZA v1", kattintható.
      Product-szűrővel a legutóbbi is product-szűrt.
- [x] **U5 (✅ 6.90.0) — dashboard Activity drill-down (minor).** A digest-sor kattintható → dialog, ami az adott
      entity+action (+user) mögötti audit-sorokat listázza a nyitott ablakban: idő, action, entity,
      entity-azonosító/címke, user. Az `/api/audit-log` kap `products` + `entity`+`actions`+`since/until`
      szűrést (a `productScoped` újrahasználva, hogy a dialog ugyanazt a halmazt lássa, mint a digest).
      Lapozás a meglévő `limit/offset`-tel (1000-es cap ellen).
- [x] **U6 (✅ 6.90.0) — share oldal: Slides gomb a brief mellé (minor).** A share page szerver-oldalon feloldja a
      snapshot MC-ihez tartozó `messages.brief_slides_file_id`-t (+ `brief_slide_id`), és ha van,
      a fejlécben a Drive mellé kerül egy **Slides** gomb; a gombfeliratok **Drive** / **Slides**.
      Ugyanez a `ShareDetailDialog` fejlécében, a megnyitott creative saját briefjével.
- [x] **U7 (✅ 6.90.0) — share oldal: Comments / History tab (minor).** A `share-detail-dialog__side-tabs` két
      tabot kap; a History a tétel audit-naplóját mutatja egy **publikus, csak a share tételeire
      szűrt** route-ból (`/share/[id]/history`), user-e-mail nélkül (megjelenítő név).
- [x] **U8 — bump + CHANGELOG + commit + deploy** (user: „ha végeztél mehet egy full commit and deploy").

**Eredmény (6.90.0):** `npm test` **946/946** (+5 unit a `shareProducts`-ra, +4 integrációs a publikus
history route-ra), `tsc` + `eslint` 0 error. Böngészőben ellenőrizve a 6001-es dev szerveren: a Settings
X egy vonalban a Revert/Save-vel, a CL-panelek a VIEW alatt (261 without a file link / 14 MCs missing),
a Previews Details dialog táblája, a dashboard SZA-szűrőnél már **nem** hozza a MARKET share-t, a feed
panel kiírja a legutóbbi exportot (2026-08-31 · SZA), az Activity 28-as sora megnyílik 28 sorra, a share
fejlécben Drive + Slides, a lightboxban Comments/History tab.

**Két dolog, amit menet közben találtam, és NEM ebben a körben javítottam:**
- Az Activity drill-down **~8 másodperc** dev módban. A `productScoped` egy uncorrelated IN-subquery az
  egész kliens messages/topics/creatives/assets/audiences uniójára — a digest ugyanezt fizeti, csak
  szerver-oldalon nem látszik. Ha zavaró lesz: a union anyagot egy `messages_product` view vagy egy
  materializált segédtábla oldja meg, nem a route.
- A feed-export panel a 2026-08-31-i SZA exportot **`v0`**-ként írja ki (`feed_version = 0` a sorban).
  Vagy a verziószámozás kezdett 0-ról ennél a soron, vagy egy régi import hagyta így — külön szelet.

**DEPLOYOLVA 6.90.0 (2026-09-12):** commit `e359160`, box `d5d23ed`→`e359160`, `npm run build` OK,
`pm2 restart mm6-erste --update-env` → **Ready 1299ms**, box `package.json` **6.90.0**.
**Séma-migráció nincs** (`git diff --name-only 704c930..e359160 -- db/migrations` üres).
Health: `/` 307 · `/login` 200 · `/matrix` 307 · `/creative-library` 307 · `/shares` 307 ·
`/api/audit-log` 401 · `/mcp` 401; publikus `erste.messagingmatrix.ai/login` **200**.
Az új publikus route élesben ellenőrizve: `/share/WCuvHqTtflu_/history?itemKey=creative:17393` →
1 bejegyzés (`create · admin`), `itemKey=creative:1` → **404 `not_in_share`** (a snapshot-ellenőrzés
tehát tényleg zár). Az `error.log`-ban a restart óta nincs új sor.

### 2026-09-12 — share History: kártya és fájl külön szekcióban — 6.91.0

**User:** „a historyban ha külön van draft history és creative history akkor külön vonallal ellátott
szekcióban mindkettőt mutassuk meg."

- [x] A `/share/[id]/history` route **szekciókat** ad vissza egyetlen lista helyett. Egy megosztott
      tételnek két élete van, és külön naplózódnak: a **kártya** (a promotált draft + cellánként egy
      `messages` sor — mind ugyanaz a kártya, egy történetbe fésülve) és a **leszállított fájl**.
      Kreatívot nyitva: fájl, majd kártya; mátrix-cellát nyitva: kártya, majd a **share-ben lévő**
      kreatívok — a snapshot marad a határ, nem lesz elérhető semmi, amit a néző eddig sem látott.
- [x] A panel `share-detail-dialog__history-section` + `__history-label` (szürke sávfejléc), a
      szekciók közt vonal. Üres szekció ki sem íródik.
- [x] +2 integrációs teszt (kártya-szekció összefésülése két cellából; mátrix-cella → kártya + fájlok).

### 2026-09-12 — toolbar-dobozok + a preview-logó a toolbar szabálya szerint — 6.91.1

**User:** „a preview boxba is 1.7rem legyen a logó és váltson dark/light között" + „a Details gomb legyen
az action gomb felett" + „ezeknek a paneleknek nincs dobozuk, mint a matrix edit mode / export
doboznak — legyen".

- [x] `design-tab__preview-logo`: `h-4 invert` → `h-[1.7rem] invert dark:invert-0`, azaz pontosan az
      `AppBrandTag` szabálya. A szállított márkajel **fehér kitöltésű SVG**, ezért a fix `invert` sötét
      módban fekete logót mutatott — olyat, amit az app soha nem rajzol.
- [x] `drive-health` és `preview-health`: doboz (`rounded-md border border-slate-200 bg-white p-3`) +
      saját `__title` a dobozon belül — ugyanaz, amit az `edit-mode-panel` és az export-panel használ.
      A VIEW/DENSITY szekciók a mátrixban sem dobozosak, ezért a `LibraryViewSwitcher` változatlan.
- [x] A Details a fekete akció **fölé** került: így az elsődleges gomb a doboz alján van, mint az
      Exportnál.

**DEPLOYOLVA 6.91.0 + 6.91.1 (2026-09-12):** `e359160`→`0f30ea9`, build 55s / 36.7s,
`pm2 restart mm6-erste --update-env` → Ready 1252ms / 1316ms, box `package.json` **6.91.1**.
Séma-migráció nincs. Health: `/login` 200 · `/creative-library` 307 · `/matrix` 307.
Lokálisan (6001) ellenőrizve: a két health-panel dobozos, a Details a fekete gomb fölött; a Design
preview-logó light módban fekete, dark módban fehér, 1.7rem.

### 2026-09-12 — dark-mode kör + a mátrix product-tagek lecsendesítése — 6.92.0

**User (sorozatban, képernyőképekkel):** a draft product tag nem invertál · a mátrixban zavar a sok
product tag (legyen háttér nélküli, kisebb, nem bold) · az ellipsis menü sem invertál · az Activity
elválasztó vonala sem · a checker sem a kreatív-dialógusban · az „update" warning sem · a feeds `true`
sem · az activity tagek sem · a placeholder-bindings ikonok elszálltak · az editor tabok legyenek úgy
színezve, mint a settingsé · a CL action gombok legyenek a mátrix Export gombjának magasságával.

**A gyökérok egy helyen volt:** a `globals.css` dark-shim **csak a semleges rámpát** (white/slate)
képezte le. Minden más light-mode fényerőn maradt a sötét felületen. Amit most lefed:
- [x] **tone-tintek** (amber/rose/red/emerald/blue/violet/sky `-50`/`-100` háttér + `-600…-900` szöveg)
      — a háttér a **jelenlegi felületbe** keveredik (`color-mix(... var(--surface))`), a szöveg a
      `-400` fokra lép. Ez egyszerre javítja a „updates N other audiences" figyelmeztetést, a
      hibadobozokat, a badge-eket és a menük danger-sorát.
- [x] **status-badge-ek + a feeds Live cella**: eddig **literál `white`-ba** keverték a színt; most
      `var(--surface)`-be, és dark módban a felirat feljebb van emelve (egy tenant DEAD-je `#000000`).
- [x] **`divide-*` elválasztók**: a Tailwind gyerek-kombinátoron állítja a `border-color`-t, amire a
      `border-*` szabályok soha nem illeszkedtek.
- [x] **draft product chip** (`bg-slate-800` → `bg-slate-900`, ezt a párt a shim már fordítja) és az
      **ellipsis gomb** (`bg-white/90` — az alfa miatt **más osztály**, mint a `bg-white`).
- [x] **checker a kreatív-dialógusban**: inline stílusként volt megírva — a `preview-bg.ts` kommentje
      pontosan ezt tiltja, mert inline stílus nem tud témát követni. Most a `preview-viewport--*` osztály.
- [x] **mátrix product tagek**: háttér nélkül, `text-[8px]`, normál súly. Száz kitöltött chip a cellák
      elől vitte a figyelmet; saját felület nélkül dark módban sincs mit fordítani rajtuk.
- [x] **editor tabok** = `border-brand-primary text-brand-primary`, mint a Settings tab-bar.
- [x] **`TypeIcon`** (template placeholder-bindings): lucide `size`/`color` propokat adott át, amiket a
      registry **szándékosan eldob** (a generált Core-ikonnak nincs megfelelője) → a glyph a saját
      intrinsic méretén rajzolódott és kitöltötte a kártyát. Most className + `currentColor`.
- [x] **CL action gombok** a mátrix Export gombjának metrikájával (`px-3 py-1.5`, `text-sm`, `size-4`).

**Nyitva maradt (nem reprodukálható lokálisan):** a dashboard CREATIVES csíkban a html-render tileok
világos pereme. A dev szerver nem rendereli a bannereket (`</>` placeholder), az élesen viszont látszik;
a saját keretünk (`thumb-checker`, `creative-strip__mc bg-slate-100 dark:bg-black`, `border-slate-200`)
mind témafüggő, tehát a perem gyanúm szerint **a banner saját fehér vászna**. Kérdés a userhez.

**DEPLOYOLVA 6.92.0 (2026-09-12):** commit `1a37c0c`, build 43s, `pm2 restart mm6-erste --update-env`
→ Ready 1327ms, box `package.json` **6.92.0**. Séma-migráció nincs. Health: `/login` 200 · `/matrix`
307 · `/creative-library` 307 · `/templates` 307 · `/feeds` 307.

**DEPLOYOLVA 6.92.1 (2026-09-12):** commit `c8432cb` (a mátrix üres-állapot tenant-szivárgása, másik
agent munkája), box `23270f9`→`c8432cb`, `npm run build` **39.9s**, `pm2 restart mm6-erste --update-env`
→ **Ready 1252ms**, box `package.json` **6.92.1**. **Séma-migráció nincs**
(`git diff --name-only 4904cd9..c8432cb -- db/migrations` üres). Health: `/` 307 · `/login` 200 ·
`/matrix` 307 · `/creative-library` 307 · `/drafts` 307 · `/templates` 307 · `/feeds` 307 · `/shares`
307 · `/api/templates` 401 · `/mcp` 401; publikus `erste.messagingmatrix.ai/login` **200**. Az
`error.log`-ban a restart óta nincs új sor (a benne álló utolsó sorok a 19:04-es AWS SDK node>=22
figyelmeztetés, korábbról).

### 2026-09-12 — a halott Structure-mezők kivezetése + új Schema tab — 6.93.0

**User:** „elemezd le, hogy a Settings › Structure csinál-e még valamit, mi a különbség az itt látszó
structure és a valódi DB structure között" → majd: „ok kivenni a halott sorokat, legyen külön panelja a
feed structure-nek, és legyen egy külön tab Schema néven, ahol megmutatjuk hány táblánk van, mi a
relációjuk és mik a mezőik — read only."

**A felmérés eredménye (kód + élő DB):**
- **Él:** `feedStructure` (`FeedView.tsx:28,60` + `api/adform-snapshots/route.ts:150`), `treeStructure`
  (Tree/Sankey nézet), `creativeParsingRules` (`parse-filename.ts`, `mcp.ts`), `patterns` (pmmid + kulcs-
  generálás), `monitoringProductRules`.
- **Halott:** `audienceStructure`, `topicStructure`, `messagesStructure`, `creativeStructure` — **nulla
  olvasó** az egész `src/`-ben (csak a seed, a tab és a defaults-teszt említi), és `git log -S` szerint
  soha nem is volt. A tab fejléce közben azt állította, hogy „used by exports and the matrix UI": az
  export oszlopai a `lib/export-xlsx.ts`-ben, a feltöltőé a `CreativeLibrary.tsx:94`-ben vannak kódolva.
- **Séma-eltérés** (a 4 stringé vs. a valódi tábla, könyvelő-oszlopok nélkül): audiences 10/17 (hiányzik
  `tag`, `order_index`, 4 kampány/lineitem mező, `channel`), topics 10/12 **+ egy nem létező `strategy`**,
  messages 14/46, creatives 11/20. Mind a 4 tenantban byte-azonosak a defaulttal — soha senki nem nyúlt
  hozzájuk.

- [x] A négy mező kivezetve a tabból, a `defaults.ts` seedből és a `DEFAULT_STRUCTURES`-ből; a
      `defaults.test.ts` listája a valóban fogyasztott kulcsokra állítva (`feedStructure`+`treeStructure`).
- [x] **Élő DB-takarítás:** `delete from config where key in (…)` → **16 sor** (4 kulcs × 4 tenant),
      mentés előtte a scratchpadbe. Maradt: 4× `feedStructure`, 1× `treeStructure`.
- [x] A `feedStructure` saját szekciót kapott, a leírásában azzal, amit tényleg csinál.
- [x] **Új `Settings › Schema` tab** (`/api/schema`, `withAdmin`): a **DB saját katalógusát** olvassa
      (`pg_class`, `information_schema.columns`, `pg_constraint`, `pg_indexes`), nem a `schema.ts`-t —
      ezért meg tudja mondani, ha a kettő elcsúszott (oszlop csak a kódban / csak a DB-ben, tábla a
      kódban migráció nélkül). Táblánként: oszlopok (típus, null, default, PK, FK-cél + on delete),
      „referenced by" visszafelé, index-szám, becsült sorszám (`reltuples`, ezért „~"), és hogy
      tenant-scoped-e (`client_id`). Élesben: **23 tábla · 323 oszlop · 24 FK · 20/23 per-client**,
      drift nincs.

**Miért nem a `schema.ts`-ből rajzoljuk:** abból csak azt tudnánk meg, amit a kód hisz. A tab értéke
pont az, hogy a **DB-t** kérdezi — ez az a nézet, ami a mostani kérdést („mi a különbség?") megválaszolja.

**DEPLOYOLVA 6.93.0 (2026-09-12):** commit `5a637a4`, build 43s, `pm2 restart mm6-erste --update-env`
→ Ready 1300ms, box `package.json` **6.93.0**. **Séma-migráció nincs** (a config-sorok törlése SQL volt,
a deploy előtt, a közös DB-n — a régi kód sem olvasta őket, tehát nem volt átmeneti törés). Health:
`/login` 200 · `/matrix` 307 · `/feeds` 307 · `/api/schema` **401** (admin-only, ahogy kell) · `/mcp` 401.

---

## 2026-09-15 — Video preview a Creative Library-ban: root cause + stillek + hover-scrub (TERV)

**User:** „ha frissen feltöltöttem egy videót, akkor gondolom háttérfeldolgozás miatt sokára jelenik meg /
töltődik le a videó, tegyünk be valami magyarázatot a screenre amíg letöltődik vagy ready a lejátszásra,
ne üresen legyen a preview box; kéne valami háttértár cache a videók megjelenítéséhez, hogy mondjuk 5
másodpercenként legyen róla egy képünk, és hasonlóan a draft kártyákhoz a creative library ahogy hozzuk az
egeret a video preview boxa fölé, mutassa meg a stilleket a videóból."

**Root cause (nem háttérfeldolgozás — olyan nincs is):**
`src/app/api/files/[id]/route.ts:9` a **teljes fájlt beolvassa memóriába** (S3/MinIO-ból a tunnelen át),
és `Accept-Ranges` / 206 nélkül adja vissza. A grid-ben a videó `<video preload="metadata" src=...#t=0.1>`
(`CreativeLibrary.tsx:1016,1079,1133`) — Range nélkül a böngésző nem tud „csak az elejét" kérni, végig kell
töltenie a klipet, mire egy képkockát kirajzol. Innen az üres doboz. A `.thumbs` cache-t kiszolgáló
`thumbnail/route.ts:20` pedig videóra **415 `not_an_image`** — videónak ma egyáltalán nincs poster-képe.

**Külső előfeltétel:** `ffmpeg` **nincs a boxon** (`which ffmpeg` → NO_FFMPEG); lokálisan van
(`/opt/homebrew/bin/ffmpeg`). Deploy előtt `apt-get install -y ffmpeg` a Hetzner boxon (nem npm dep:
az `ffmpeg-static` ~80MB-ot tenne minden app `node_modules`-jába, és négy deploy fut a boxon).

### Lépések (mindegyik külön commit, `tsc` + vitest után)

- [x] **V1 — Range/streaming a file route-ban (root cause).** `storage.ts`: új `readFileStream(rel, range?)`
      — S3 ágon `GetObjectCommand({ Range })`, local-fs ágon `fs.createReadStream({start,end})`, mindkettő
      `Readable.toWeb()`-bel web streammé. `api/files/[id]/route.ts`: `Accept-Ranges: bytes` a 200-on,
      `Range:` fejlécre 206 + `Content-Range`, hibás range-re 416. Nincs többé teljes-fájl bufferelés.
      Ez önmagában javítja a detail-dialog lejátszást is (`MatrixDetailDialog`, `PreviewPane`).
- [x] **V2 — `src/lib/video-stills.ts`: still-strip generálás + lemez-cache.** `ensureStills(file)`:
      ha van `.thumbs/{clientKey}/{id}-stills.json` manifest → visszaadja; különben **egy** ffmpeg passz:
      forrás tmp-be (S3 mód), `ffprobe` duration, `ffmpeg -vf fps=1/5,scale=640:-1` → `{id}-still-{i}.jpg`
      a `.thumbs`-ba, majd manifest `{count, intervalSec: 5, durationSec}`. Cap **60 frame** (=5 perc);
      in-flight Promise-map, hogy 3 egyszerre hoverelt tile ne indítson 3 ffmpeget; max 2 párhuzamos ffmpeg.
      A cache ugyanott és ugyanúgy regenerálható, mint a kép-thumbok (`resolveStoragePath`, mindig local disk).
- [x] **V3 — `thumbnail/route.ts` videóra: a 0. still a poster.** A `not_an_image` 415 helyett videó
      mime-re `ensureStills` → 0. frame, `sharp`-pal az `ALLOWED_WIDTHS` tierre méretezve, ugyanabba a
      `.thumbs` cache-be. Így **minden meglévő hívó** (CL Card/Tile/Row, drafts cover, Assets, ShareGallery,
      `ScaledMediaPreview`) ingyen kap videó-postert — és a grid-ből kikerül a nehéz `<video>` elem.
- [x] **V4 — `api/files/[id]/still` route.** `?i=N&w=…` → az N. still JPEG-je (`.thumbs`-ból), `?i` nélkül
      a manifest JSON. Ez táplálja a hover-scrubot.
- [x] **V5 — CL tile-ok: `<video>` → poster `<img>` + „feldolgozás" állapot + hover-scrub.** Új
      `VideoThumb` komponens a `creative-library/`-ben, a három hívóhelyre (`Card:1016`, `ImageTile:1079`,
      `ListRow:1133`): poster `<img src=…/thumbnail?w=…>`; amíg az `onLoad` nem jött meg →
      `video-thumb__pending` skeleton **„Videó feldolgozása…"** felirattal (ez a user kérése: ne üres doboz);
      `onError` → `video-thumb__failed` „az előnézet nem készült el". Hover-scrub a `drafts-tile__scrub`
      mintájára (`DraftsView.tsx:677`): `count` db zóna abszolút a médián, `onMouseEnter` → frame-index,
      `<img>` src a `/still?i=N`-re vált, `new Image()` előtöltéssel; readout egy kis idő-badge (`0:15`).
      `onMouseLeave` → vissza a 0. frame-re. ListRow-ban (40px thumb) scrub nincs, csak poster.
      Új inventory-nevek: `video-thumb`, `video-thumb__pending`, `video-thumb__failed`,
      `video-thumb__scrub`, `video-thumb__scrub-zone`, `video-thumb__time` → `component-inventory.md`.
- [x] **V6 — teszt + inventory + bump.** Vitest: Range-fejléc parse (206/416/`Content-Range`), és a
      still-matematika (interval/count/cap) ffmpeg nélkül. Séma-migráció **nincs**. Bump: `6.94.2` → **`6.95.0`**
      (minor: új route + új user-látható viselkedés). CHANGELOG.

**Scope-on kívül (szándékosan):** a drafts/assets/share tile-ok `<video>`-ja marad, amíg a user nem kéri —
a V3 miatt a poster ott is elérhető lenne, de az külön commit. Videó-`fileDimensions` ffprobe-ból: nem most.

### Review (2026-09-15) — mi lett belőle

**Commitok (mind `main`-en, a user zöld jelzésére — az Erste is örül neki):**
- `c04d10c` V1 — Range/streaming a file route-ban. `readFileStream(rel, range?)` a `storage.ts`-ben
  (S3 `GetObjectCommand({Range})` / `fs.createReadStream({start,end})`, mindkettő `Readable.toWeb`),
  `parseRangeHeader` a `lib/http-range.ts`-ben (9 teszt: zárt / nyitott / suffix / túllógó / fordított
  range, üres objektum). 206 + `Content-Range`, 416 unsatisfiable-re, `Accept-Ranges` a 200-on is.
- `21c27ec` V2 — `lib/video-stills.ts`. **`select` filter, NEM `fps=1/5`:** az fps filternek teljes 5s
  slot kell egy frame kiadásához, így egy 17s-es klip elveszti a farkát (3 still 4 helyett). A
  `select='isnan(prev_selected_t)+gte(t-prev_selected_t,5)'` + `-fps_mode passthrough` adja a helyes 4-et
  (a flag nélkül 60-at ad, mert visszapaddingolja a forrás framerate-re). Első still `-ss 0.1`-nél, mert
  a 0-s kocka a legtöbb renderelt hirdetésen fekete leader. Cap 60 frame, in-flight dedup, max 2 ffmpeg.
- `2dccf62` V3+V4 — videó `thumbnail` = 0. still; `/api/files/[id]/still` (manifest + `?i=N&w=`).
- `827f4c9` V5 — `_components/VideoThumb.tsx` + a CL három hívóhelye.

**Élő ellenőrzés (dev:erste, 48 valódi Erste videó):** a pending felirat tényleg megjelenik, majd 10 mp
alatt mind a 48 poster kirajzolódik (2-es ffmpeg-throttle), masonry/grid/list mind jó, a hover-scrub a
0:00 → 0:05 kockát váltja (a második still a lilás branded végkép). Egy 1920x1080-as klip stilljei
MinIO-ból **1034 ms** alatt készültek el (letöltés + ffprobe + ffmpeg együtt).

**Amit NEM én törtem el:** a detail-dialog videólejátszója pörög és 0:00-nál áll. Ugyanez történik, ha
ugyanazokat a byte-okat egy sima `python3 -m http.server`-ről tölti be — tehát **ez a Chrome-példány nem
tud H.264-et dekódolni**, nem a route hibája. A route-ot curl-lel ellenőriztem: `206` helyes
`Content-Range: bytes 0-1023/1020584`-gyel, a teljes `200` byte-pontos (ffprobe 10.0s).

**Deploy-előfeltétel:** `apt-get install -y ffmpeg` a boxon (Ubuntu 24.04, candidate `7:6.1.1-3ubuntu5`).
Enélkül a videó-thumbnail `503 still_unavailable`, és a UI a „No preview for this video" ágat mutatja —
nem törik el semmi, csak nincs poster.

**Scope-on kívül maradt (szándékosan):** a drafts / assets / share tile-ok `<video>`-ja. A V3 miatt a
poster ott is egy `thumbnail?w=` hívásra elérhető lenne — külön commit, ha kell.

---

## 2026-09-15 — deploy 6.95.0 → 6.95.1 + a thumb-cache átköltöztetése a Hetzner volume-ra

**ffmpeg a boxra (a 6.95.0 előfeltétele).** `apt-get install -y --no-install-recommends ffmpeg` →
`6.1.1-3ubuntu5`, `/usr/bin/ffmpeg` + `/usr/bin/ffprobe`. **Recommends nélkül szándékosan:** 129 csomag
helyett 104, a kihagyott rész a mesa/VA-API/VDPAU GPU-driver-halmaz és a pocketsphinx — halott súly egy
headless boxon, és a diszk 85%-on állt. Így 200 MB lett (85% → 86%).
**A filter-lánc 6.1.1-en is ellenőrizve:** 17s-es teszt-klip → **4 still**, ugyanaz, mint lokálisan a
9.0.1-en (`select` + `-fps_mode passthrough`; a flag 5.0 óta létezik, tehát nincs verzió-kockázat).

**Thumb-cache → `/mnt/HC_Volume_104001329/mm6-storage` (user kérése).** A boxon van egy 10 G-s Hetzner
Cloud Volume (`/dev/sdb`), ami **érintetlenül állt 1%-on**, míg a fő diszk 86%-on. S3-módban a
`STORAGE_ROOT` **csak a derivált cache-t** jelöli ki (a forrás byte-ok MinIO-ban vannak), tehát egy
env-sor az egész. A két tenant közös gyökéren osztozik, mert minden útvonal `{root}/{clientKey}/...`.
- `cp -a` (NEM `mv`) mindkét `storage/`-ból → 460 M, **3488 + 94 fájl, számra egyezik**.
- `.env`-ben `STORAGE_ROOT=./storage` → abszolút volume-útvonal; a régi `.env` mentve
  `.env.pre-volume-storage-20260915` néven, a régi `storage/` könyvtárak **megvannak rollback-pontnak**.
- Diszk utána: `/` 86% (5,3 G szabad), volume **5%** (8,8 G szabad).

**Amit a költöztetés azonnal kibuktatott — `EXDEV` (6.95.1).** A stillek publikálása `fs.rename`-mel ment
az ffmpeg work-dirből, ami **csak egy fájlrendszeren belül működik**. Az `os.tmpdir()` az `sda1`-en van,
a cache már az `sdb`-n → `EXDEV: cross-device link not permitted`, minden extrakció elhalt. Lokálisan
sosem jött elő, mert ott egy eszközön volt minden. Javítás: `fs.copyFile` (`32005df`) — a work-dirt a
meglévő `finally` takarítja. **Tanulság:** a `STORAGE_ROOT` konfigurálható knob, tehát semmi sem
feltételezheti, hogy azonos eszközön van a temp-pel.

**Élő verifikáció a boxon** (az app saját kódútján, `npx tsx`-szel, valódi Erste videón):
`manifest { count: 2, intervalSec: 5, durationSec: 10 }` **2342 ms** alatt (MinIO-letöltés + ffprobe +
ffmpeg együtt). A 4 fájl a **volume-on** landolt, a régi könyvtárban **0** — ez a bizonyíték, hogy az új
`STORAGE_ROOT` tényleg él. Temp-könyvtár nem maradt hátra.

**DEPLOYOLVA 6.95.1 — mindkét tenant** (`mm6-erste` és `mm6-telekom`, build ~2,5 perc egyenként, a másik
app `pm2 stop`-olva a build idejére a 3,7 G RAM miatt). **Séma-migráció nincs.** Health mindkettőn:
`/login` 200 · `/matrix|/creative-library|/drafts` 307 · `/api/templates` 401 · `/mcp` 401 ·
`/api/files/*/still` **401** (létezik, auth mögött). `error.log`-ban új hiba nincs (a bennmaradó
Server-Action és AWS-SDK-node>=22 sorok korábbiak).

**Nyitott, szándékosan:** a régi `storage/` könyvtárak (457 M + 2,8 M a fő diszken) rollback-pontként
maradtak — csak akkor törlendők, ha a cache napokig bizonyítottan a volume-ról szolgál ki. Olcsó
mellékszál a diszk-nyomásra: `journalctl --vacuum-size=500M` ~3,3 G-t szabadítana fel.

---

## 2026-09-15 — 6.96.0: záró kocka, színhiba, minőség, cross-fade

**User három dolgot jelzett egy screenshoton** (a still a Creative Library-ban vs. ugyanaz a videó
macOS-lejátszóban): hiányzik a záró kocka, fakóbb a szín, és jó lenne alfa-átmenet a scrub közben.

### 1. Záró kocka (a strip lezárása)
Egy 10 mp-es hirdetés 0-nál és 5-nél tickelt, majd megállt — a **branded end card sosem került be**.
Mostantól a klip utolsó kockája külön stillt kap, **EOF felől seekelve** (`-sseof -0.5`), nem timestamp
szerint, hogy bárhova is kerekedik a hossz, a valóban utolsó dekódolható kockára essen. Kimarad, ha az
utolsó tick már 1 mp-en belül van a véghez (`wantsEndFrame`), különben két majdnem azonos kockán
végződne a strip. **10 mp → 3 still, 17 mp → 5.** Az idő-badge a záró stillre a valódi hosszt írja
(`stillTimestamp`), nem az intervallum többszörösét.

### 2. A színhiba — NEM a colorspace volt, és nem is a tömörítés
A user „colorspace is off"-ra tippelt; végigmértem, mert a tipp és az ok itt elvált egymástól.
- A **range és a mátrix a dekódolásnál rendben**: explicit `in_color_matrix=bt709:in_range=tv:out_range=pc`
  flagekkel a kimenet **byte-azonos** a flag nélkülivel. Nem ez volt.
- Kontrollált mérés: tiszta Telekom-magenta `#E20074` (rgb 226,0,116) videóba kódolva bt709/tv taggel.
  | kimenet | mért RGB |
  |---|---|
  | ffmpeg → PNG (skálázás nélkül) | 224, 0, 113 |
  | ffmpeg → PNG (skálázva) | 222, 0, 111 |
  | **ffmpeg → JPEG (a régi kód)** | **206, 0, 109** |
  | macOS QuickLook (független igazodási pont) | 228, 0, 123 |
- **Minden JPEG-variáns 206-ot adott** — `-q:v 2`, `-q:v 4`, `yuvj444p` subsampling nélkül is. Tehát nem
  kvantálási veszteség, hanem **szisztematikus mátrix-hiba**: a JPEG YCbCr-je definíció szerint BT.601-es,
  az ffmpeg mjpeg-enkódere viszont **nem konvertálja bele a BT.709 forrást**, csak átcímkézi.
- **Javítás:** az ffmpeg veszteségmentes **PNG**-t ad át, és **minden JPEG-kódolást a sharp végez**
  (`222,0,111` — pontosan a PNG értéke). Ez egyben **megszünteti a dupla veszteséges kódolást** is
  (eddig az ffmpeg kódolt egyszer, a sharp a derivatívánál még egyszer).
- Elvetve: `zscale` — **nincs a lokális homebrew ffmpeg-ben** (csak a boxon), tehát dev-en eltört volna.

### 3. Minőség + retina
Master **960px** (volt 640), q92 4:4:4; derivatíva q88 4:4:4 (volt q82). Így a legszélesebb tier (800)
valódi lekicsinyítés, nem felnagyítás — és a CL kártyák/tile-ok mostantól a 800-as tiert kérik: egy ~370
CSS px-es kártya 2x kijelzőn ~740 px-t igényel, a régi 240/320 kérés a 400-as tierre esett és lágy volt.

### 4. Cross-fade
A strip hover alatt **egymásra rétegzett `<img>`-ekként** mountolódik, `transition-opacity 200ms`.
Csak hover közben van a DOM-ban, és minden kocka addigra előtöltött, így a fade mindig dekódolt képről
indul — nincs villanás. Index 0-nál mind kihalványodik, alóla a poster látszik.

### Amit menet közben találtam (majdnem elrontottam)
A **méretezett derivatívák neve nem hordozta a cache-verziót**. A manifest-verzió csak a mastereket védi,
a `{id}-still-{i}-{w}.jpg` viszont örökre kiszolgálta volna a régi színű kivágatot, anélkül hogy bármi
jelezné. Mostantól `-v{VERSION}` a névben → verzióbumpnál egyszerűen nem talál és újraépít.
A boxon a 19 régi (v1) still-fájl törölve a deploy előtt — regenerálható cache.

**DEPLOYOLVA 6.96.0 — mindkét tenant.** Séma-migráció nincs. Élő verifikáció a telekom masteren:
`{"count":3,"endFrame":true,"version":3,"intervalSec":5,"durationSec":10}` **5122 ms** alatt, a fájlok a
volume-on, a derivatíva neve `...-still-2-800-v3.jpg`. A byte-méretek a lokálissal egyeznek → a box
ffmpeg 6.1.1-e ugyanazt adja, mint a lokális 9.0.1. Health mindkettőn zöld; volume 5% (8,8 G szabad).

## 2026-09-15 — 6.97.0: a badge `now / total`, és a scrub nem tekercsel vissza

**User:** „a timer azt kéne mutassa hogy melyik időpillanat van a preview boxban éppen, 0:00/0:10, és
amikor lehúzom az egeret akkor maradjon azon a timer amelyik pillanatban lehúztam, ne ugorjon nullára."

- **Badge `now / total`.** Eddig nyugalomban a hosszt, hover közben a pozíciót mutatta — vagyis sosem
  válaszolta meg azt az egy kérdést, amiért ott van. Most végig `0:00 / 0:10`.
- **A kihúzás nem tekercsel vissza.** Az `onMouseLeave` eddig `setIndex(0)`-t is csinált. Ez önmagában
  kevés lett volna: a strip rétegei `hovering`-re voltak kötve, tehát unmountoltak volna, és alóluk
  előbújik a poster. A mount-feltétel most `hovering || index > 0` — a csempe, amit sosem érintettél,
  továbbra sem visz rétegeket a DOM-ba, és a 0-nál hagyott sem (ott a poster amúgy is ugyanaz a kép).
- **A manifest a poster betöltésére jön, nem hoverre** — kell hozzá, mert a badge nyugalomban is írja a
  teljes hosszt. Ez nem drága: a poster kiszolgálása **már levágta a stripet**, tehát ez egy kis
  JSON-olvasás lemezről, sosem ffmpeg-futás. **A kockák előtöltése viszont hoverre maradt** — eagerrel
  minden csempe minden kockáját lehúznánk, az több tíz MB kéretlenül.

**Verzió — kettős olvasat:** a CLAUDE.md szerint „bármilyen user-látható viselkedésváltozás" = minor,
ezért **`6.97.0`**; aki ezt a 6.96.0 csiszolásának tekinti, annak `6.96.1` is védhető lett volna.

**DEPLOYOLVA 6.97.0 — mindkét tenant.** Séma-migráció nincs. Élő böngésző-ellenőrzés (erste dev):
nyugalomban `0:00 / 0:10`, a scrub végére húzva `0:10 / 0:10` az Erste end carddal, majd az egeret
levéve **mindkettő a helyén marad**. Health mindkét tenanton zöld.

## 2026-09-15 — 6.97.1: a scrub a kockát a byte-jai előtt mutatta meg

**User:** „a 0:10 frame-t miért nem mutatja meg?" majd „ha 10 mp a videó, akkor nem 2 scrub sávnak kéne
lennie, hanem (mp/5)+1-nek."

**A zónák száma már jó volt** (`Array.from({ length: count })`, 10 mp → 3), és a kockák is megvoltak a
boxon: mindhárom telekom videó `count:3, endFrame:true, v3`, a masterek byte-ban különböznek — a 0:10-es
az, amin rajta van a „12 340 Ft/hó" ár. A hiba a **megjelenítésben** volt.

**Root cause:** egy frissen mountolt `<img>`, aminek még nincsenek byte-jai, **átlátszó**. A réteget
`mouseenter`-re billentettük `opacity-100`-ra, így az első áthúzásnál (egy still ~230 KB a 800-as
tieren) alóla a poster látszott, miközben a badge már az új időt írta. **A záró kocka szenvedte meg a
legjobban:** az van a legtávolabb attól, ahol az egér belép a dobozba, tehát annak volt a legkevesebb
ideje megérkezni — úgy nézett ki, mintha soha nem is készült volna el. Nálam azért nem jött elő, mert a
korábbi tesztekből cache-ben voltak.

**Javítás:** egy kocka csak akkor válik láthatóvá, ha a **saját `onLoad`-ja** lefutott (`ready` lista);
addig a doboz azt tartja, amije ténylegesen van; a badge pedig a **látott** kockát írja (`shown`), nem
az egér alattit (`index`). Így a kép és az idő soha nem mondhat mást.

**Zónaszám-ellenőrzés a user képlete ellen** (`(mp/5)+1`): 5→2, 10→3, 15→4, 20→5, 25→6, 30→7, 60→13 —
mind **egyezik**. Nem 5 többszöröseinél a ceil-alapú általánosítás jön (12→4, 17→5). Egy megjegyzendő
kivétel: **6 mp → 2 zóna**, mert az 5,1 mp-es tick már 0,9 mp-re van a végtől, és az 1 mp-es
`END_FRAME_MIN_GAP_SEC` alatt a záró kocka kimarad — egy end card ilyenkor amúgy is ugyanaz a kép.

**DEPLOYOLVA 6.97.1 — mindkét tenant.** Séma-migráció nincs. Health zöld.

## 2026-09-15 — 6.97.2: egy napos böngésző-cache tartotta a scrubot 2 sávon

**User:** „nem mutatja meg a 10/10-et" — a képernyőn `0:00/0:10` és `0:05/0:10`, harmadik sáv sehol,
v6.97.1-en.

**Root cause — nem a szerveren, a böngészőben.** A manifestet
`Cache-Control: private, max-age=86400`-gyel szolgáltuk ki, és **nincs verzió az URL-jében**. Aki a
6.95.x idején már megnézte a könyvtárat, annak a böngészője eltette a régi, végkocka nélküli
`{"count":2,...}`-t — és **egy napig meg sem kérdezte a szervert**. `count:2` → két zóna, `0:00` és
`0:05`, és semmi a képernyőn, ami elárulná, miért. A lemezen a stillek végig helyesek voltak
(`count:3, endFrame:true, v3` mindhárom telekom videón, a 0:10-esen rajta a „12 340 Ft/hó" ár).
A `durationSec` mindkét manifest-verzióban 10 — ezért mutatta a badge helyesen a **teljes** hosszt,
miközben a pozíció sosem ért el 0:10-ig. Ez volt a megtévesztő rész.

**Javítás, három rétegben:**
- A **manifest az az egyetlen erőforrás, amit nem lehet a saját URL-jében verziózni** — ő maga jelenti be
  a verziót. Ezért mostantól **revalidál** (`private, no-cache`); pár tíz bájt.
- A **kocka-URL-ek viszik a strip verzióját** (`&v=`), így egy újravágott strip új URL, nem elavult
  találat. Enélkül ugyanez az osztály elrejtette volna a **színjavítást** is mindenki elől, aki a 6.96.0
  előtt már megnézett egy videót.
- A manifest-kérés `?manifest=1` lett — **más cache-kulcs**, mint a korábbi csupasz URL, így akinek már
  benne ül a régi válasz, a következő látogatáskor magától a jóra vált. Nem kell hard reload, és nem kell
  kivárni a napot.

**Verifikáció:** a HTTP-réteg curl-lel ellenőrizve (`manifest → private, no-cache` + `count:3`;
`?manifest=1` ugyanaz frissen; `still?i=2&w=800&v=3` → 200, `max-age=86400`). Az nginx nem ír felül
cache-fejlécet (a vhostokban nincs `add_header Cache-Control` / `proxy_cache`). **Böngészőből ezt a kört
nem tudtam leellenőrizni** — a lokális dev-session lejárt, jelszót pedig nem írok be.

**DEPLOYOLVA 6.97.2 — mindkét tenant.** Séma-migráció nincs. Health zöld.

## 2026-09-15 — 6.98.0: videó-poszter + scrub a publikus share oldalon

**User:** „csináld meg a share oldalon is videókra ugyanezt."

A share néző **nincs hitelesítve**, tehát az `/api/files/...` still-végpontokat nem érheti el. A strip a
share saját publikus proxyján jön: `?stills=1` = manifest, `?still=N` = egy kocka, és **egy `?thumb=`
videóra a 0. kockára oldódik** — így a galéria meglévő poszter-URL-je változtatás nélkül működik videóra
is. A `VideoThumb` kapott egy `shareId` propot; abból építi a publikus URL-alakot.

**Két dolog esett ki abból, hogy a csempéről eltűnt a `<video>`:**
- **Egy share puszta megnyitása letöltésnek számított** minden benne lévő videóra: a csempe `<video>`-ja
  lehúzta a teljes fájlt, a proxy pedig **minden teljes kiszolgálásra** növeli a `downloadCount`-ot. A
  csempe már nem kéri le a fájlt, és mostantól csak a teljes fájlos kérés számít — egy lejátszó videó
  Range-kérések sorozatát küldi, azokat számolva egy nézőből tucatnyi „letöltés" lett volna.
- **Range-támogatás a proxyn** (206 / `Content-Range`, 416), hogy a detail-nézetben a videó lejátszható
  legyen, ne kelljen előbb az egészet lehúzni.

**Amit menet közben elrontottam és a dev server kapott el:** a `VideoThumb`-ban `useQuery` volt, a share
oldal viszont **publikus és nincs benne `QueryClientProvider`** → az egész oldal **500**-zal elszállt.
Kivettem belőle a react-queryt (egy kis JSON-kérésért nem éri meg provider-függés egy megosztott
komponensben); sima `fetch` lett.

**Verifikáció — és egy tanulság az eszközről.** A böngésző-screenshot **kétszer is elavult képet mutatott**
(a badge 0:10-et írt, a képen a nyitókocka), ezért a DOM-ot kérdeztem meg: a látható réteg a **2-es indexű**,
`opacity: 1`, betöltve, és az alsó harmadából vett pixel **rgb(197,1,101)** = Telekom magenta. A záró kocka
tehát végig ott volt. **Screenshotra ne alapozz állítást, ha a DOM megkérdezhető.**
Élesben (publikus URL, auth nélkül): share oldal 200 · manifest `{"count":3,"endFrame":true,"version":3}` ·
`still=2&w=800&v=3` → 200, 232737 B · `Range: bytes=0-1023` → **206** `bytes 0-1023/18577763` nginxen át.

**DEPLOYOLVA 6.98.0 — mindkét tenant.** Séma-migráció nincs.

### Nyitott: a Drive-link nem jelenik meg a share-en (user, 2026-09-15)
**Nem hiba, hanem tudatos snapshot-viselkedés** — a `ShareGallery.tsx:143` kommentje ki is mondja:
„The snapshot froze the links at share time, so a folder resolved later will not appear on an older share."
A share `metadata.creatives`-ben a **rögzítéskori** creative-sorokat tárolja; a Drive-link utólag került a
creative-re, ezért nincs benne. **Frissítő/újrarögzítő végpont nincs** (`share-galleries/[id]` csak
`DELETE`-et és `restore`-t ismer). Döntés a usernél — lásd a beszélgetést.

## 2026-09-15 — 6.99.0 + 6.100.0: élő Drive-link, másodpercenkénti strip, playhead

### 6.99.0 — a share Drive-mappája élőben
A user döntése a felkínált három közül: **élő feloldás**. A delivery-mappa nem a megosztott TARTALOM
része, hanem mutató arra, hol vannak most a fájlok — a befagyasztása csak egy linket vett el az olvasótól.
Az `resolveDriveFolders` a `resolveBriefs` mintáját követi (az már eleve „resolved live"), a share saját
kliensére és a benne lévő creative-id-kra szűkítve; a snapshot-érték marad a fallback. **Minden más a
kártyán snapshot marad** — az továbbra is az, amit megosztottál. Ellenőrizve: a creative (id 17413)
`drive_folder_id = 1awbYb7X-…`, és a share oldalon megjelent a **Drive** gomb a helyes mappára.

### 6.100.0 — másodpercenkénti kockák + playhead vonal (Frame.io-minta)
- **1 still / másodperc** az 5 helyett: 10 mp → **11 kocka** (3 helyett). A 60-as cap fölött az
  **intervallum nyúlik, nem csonkol**: 90 mp → 2 mp, 10 perc → 10 mp. Így a strip mindig a **teljes**
  klipet fedi, nem áll meg félúton úgy, hogy semmi nem árulja el. Az intervallum klipenkénti, és a
  manifestben utazik, ezért az idő-kiírás magától követi.
- **Playhead vonal**: 1px `bg-white/50` + 1px `rgba(0,0,0,.5)` gyűrű — világos és sötét kockán is látszik.
  Folyamatosan követi az egeret, miközben a kép a legközelebbi stillre ugrik.
- **A scrub egy pointer-követő overlay lett** a stillenkénti zónák helyett: egy zóna csak azt tudja
  jelenteni, hogy beléptek — a vonalnak folytonos x kell.
- **A rétegek ablakban mountolódnak** (pointer ±2 + a már megérkezettek), a „töltsd elő az egész stripet"
  helyett. 1 mp-es osztásnál egy teljes strip több tíz MB, és a régi kód az egészet lehúzta abban a
  pillanatban, ahogy az egér hozzáért a csempéhez.

**Disk:** egy 10 mp-es 1080×1920 klip **3,5 MB** master (11 × ~320 KB). Egy 30 mp-es hirdetés ~10 MB.
A volume 8,8 G szabad, tehát bőven elég — de ha sok hosszú videó jön, a master 960px/q92 lejjebb vehető.

**Verifikáció — és megint az eszközről.** A böngésző-ellenőrzés sokáig félrevitt: **háttérfülön a Chrome
nem tölti a `loading="lazy"` képeket és nem futtatja a CSS-átmeneteket**, ezért a poszter „töltésben"
ragadt és a réteg `opacity`-je 0-t mutatott, pedig az osztálya `opacity-100` volt. A DOM-ból derült ki:
a matched CSS rule `.opacity-100 { opacity: 1 }`, inline style nincs, szülő opacity 1 — tehát nem kódhiba.
Élesben: manifest `{"count":11,"intervalSec":1,"version":4}`, playhead `left: 91.3%` (pontosan a
kurzornál), badge `0:10 / 0:10`, **3 réteg mountolva 10 helyett**, a látható kockából vett pixel
`rgb(197,1,101)` = Telekom magenta. A régi (v3) still-fájlok a deploy előtt törölve.

**DEPLOYOLVA 6.100.0 — mindkét tenant.** Séma-migráció nincs. Health zöld, volume 5%.

## 2026-09-15 — 6.100.1 + 6.100.2: a tranzíció a 0. kockán ment át, playhead-finomítás

### 6.100.1 — a scrub minden lépése a poszteren keresztül oldott
**User:** „mindig a 0. frame-hez megy vissza tranzition és nem az előzőhöz."
**Root cause:** a kimenő kockát `opacity-0`-ra állítottuk (kifakult), a bejövőt 0→1-re — abban a 200 ms-os
átfedésben **mindkettő félig átlátszó volt, alattuk pedig a poszter**, ami épp a 0. kocka. Innen a
„visszaugrik a nullára" érzet. **Javítás:** a kimenő kocka **nem fakul ki**, hanem átlátszatlanul tartja
magát `z-0`-n, a bejövő `z-10`-en fadel be fölötte — a pár alatt semmi nem üt át. Az egyetlen fade, ami
még eléri a posztert, a 0:00-ra visszalépés, ahol a poszter maga a célállomás.
**Bizonyíték a DOM-ból:** 4→8 lépésnél a `4`-es `z-0 / opacity-100 / transition:false`, a `8`-as
`z-10 / opacity-100 / transition:true`.

### 6.100.1 — és a „hard refresh kellett"
**User:** a share oldal semmit nem mutatott, csak hard refresh után. A **poszter URL-je nem hordoz
strip-verziót** — nem is tud, mert a hívó még nem olvasta a manifestet. Egy napos cache-sel túlélte az
újravágást. **Javítás: `ETag` a strip-verzióból + `no-cache`** a videó-posztereken és -stilleken mindkét
route-on: a változatlan kocka **304**-gyel jön (törzs nélkül), a változott magától megérkezik.
Élesben ellenőrizve: `"s4-efvRewGv1OS7CY_IdcrL4-0-800"` → második kérés **304**.

### 6.100.2 — playhead: szaggatott, váltakozó, és az egérrel távozik
Tömör fehér vonal fekete gyűrűben középtónusokon rosszul olvasott. Most **1px széles, hosszában
váltakozó fehér/fekete 50%** (`repeating-linear-gradient` a `globals.css`-ben, `.video-thumb__playhead`)
— **egy** gradiens, nem két eltolt vonal: két elemet csak fix értékkel lehet eltolni, a gradiens bármilyen
magasságnál helyes marad. **Egérlevételkor eltűnik** (a kocka és az idő marad) — a vonal a kurzor
jelölője, tehát vele megy.

**DEPLOYOLVA 6.100.2 — mindkét tenant.** Séma-migráció nincs. Health zöld.

**Eszköz-tanulság (harmadszor):** a böngésző-automatizálás kurzora elcsúszik a CSS-viewporthoz képest, és
a `hover` nem mindig generál `mousemove`-ot. Ami bevált: egyszer valódi hoverrel beállítani a `hovering`-et,
utána **szintetikus `mousemove`-okkal** léptetni a scrubot, és **osztálynevekből** olvasni az állapotot
(a `getComputedStyle().opacity` háttérfülön 0-t mutat futó átmenetnél).

## 2026-09-15 — 6.100.3: az átmenet kivezetve, a scrub vág

**User:** „ez a transition még mindig, ha gyorsan húzom az egeret, akkor a frame 0 visszaugrál — lehet
elhagyhatjuk a transition, mert az bonyolít nagyon." **Igaza volt, és a javaslata is jó.**

**Miért maradt hibás a 6.100.1 után is:** a `shown` csak akkor lép, ha a kocka byte-jai megérkeztek, ezért
gyors mozgásnál többet ugrik egyszerre — és ahol az előző állapot még a poszter (0. kocka) volt, ott azon
keresztül oldott. Két kocka **kizárólag fade közben** félig átlátszó egyszerre, alattuk pedig a poszter:
minden átmenet egy esély volt a 0. kocka felvillantására, és a gyors söprés minden eséllyel élt.

**Döntés: nincs átmenet, a scrub vág.** Ez amúgy is az, amit egy scrub akar (a Frame.io is vág). A
„várd meg a kocka byte-jait" szabály marad — az tartja tisztán a vágást. Az átmenettel **elment az a
réteg is, ami csak azért létezett, hogy legyen mi fölött fadelni**, és a hozzá tartozó z-index sorrend.
Nettó: −27 sor a komponensben.

**Verifikáció:** `anyTransition: false` sehol; gyors végigsöprésnél **minden mintavételnél pontosan egy**
réteg átlátszatlan — sosem nulla (az mutatná a posztert), sosem kettő.

**DEPLOYOLVA 6.100.3 — mindkét tenant.** Health zöld.

**Tanulság:** három kör ment el egy 200 ms-os kozmetikai effekt megszelídítésére, mindegyik talált egy új
utat a hibához. A user javasolta az egyszerűsítést, és az lett a helyes — érdemes lett volna a második kör
után magamtól felvetni, hogy az effekt nem éri meg.

## 2026-09-15 — 6.101.0: fél felbontású preview + „soha ne essen vissza a poszterre"

**User:** „ugy legyen a preview hogy fél felbontású elég, úgy talán gyorsabb lesz, és ha új frame-re ugrok
ami még nincs betöltve akkor ne 0-ra essen vissza, hanem tartsa ki a legutóbbi betöltöttet."

### Fél felbontás
Master **960 → 480**, a csempék a **400-as** tiert kérik (volt 800). Mért hatás egy 10 mp-es klipen:
generálás **2829 → 1335 ms**, cache **3,5 → 1,4 MB**, egy scrub közben letöltött kocka **~230 → 85 KB**.
Cache-verzió **v5**, a boxon a v4 fájlok a deploy előtt törölve.

### „Ne essen vissza 0-ra" — a szabály nem az volt, aminek látszott
A `shown` eddig **csak pontos találatra** lépett, és ezért tartotta a legutóbbi *betöltött* kockát —
**kivéve, ha az éppen a 0. volt**. Márpedig a doboz bal szélén belépve pont az: onnan jobbra ugorva a
poszteren ült, amíg a kocha meg nem jött. Ezért nem „tartsd a legutóbbit", hanem **„állj a legközelebbi
megvolt kockára"** lett a szabály — a reduce a *jelenlegi* `shown`-nal indul, tehát a legutóbbi betöltött
akkor is nyer, ha nincs nála közelebbi. A 0. kocka már csak akkor jöhet szóba, ha tényleg az a legközelebbi.
**Mérve:** 0:04 → 0:10 ugrás **120 ms-on belül** a 10-es kockán áll, közte semmi.

**DEPLOYOLVA 6.101.0 — mindkét tenant.** Élesben: manifest `v5`, poszter `400` tier, `etag s5-…-0-400`,
63 553 B. Health zöld.

## 2026-09-15 — 6.102.x: a share megosztáskor vágja a stripet, nem megnyitáskor

**User:** „új embernek generating preview jelenik meg a share-en, ez nem jó, nem kéne újragenerálni
emberenként ez marhaság, és megosztáskor le kéne generálódjon mindenképp egy server cache-be."

**Pontosítás a diagnózishoz:** **nem generálódik újra emberenként** — a strip lemezen közös cache
(`{STORAGE_ROOT}/{clientKey}/.thumbs/`), és csak akkor készül, ha még soha nem készült el, vagy a
`STILLS_CACHE_VERSION` lépett. Amit az „új ember" látott, az az **első** generálás volt, és azért esett
rá, mert a link elküldése után ő ért oda elsőként. A javasolt megoldás viszont pontosan a helyes.

- **`warmStills` a share létrehozásakor** (`POST /api/share-galleries`). **Nem await-elve**: sok klipes
  share addig tartaná nyitva a választ, ameddig az ffmpeg tart, a link elküldése és a megnyitás közti rés
  pedig nagyságrendekkel hosszabb a bemelegítésnél. A kétszálas ffmpeg-kapu tartja kordában.
- A `storagePath` **külön lekérdezésből** jön és **nem kerül a snapshotba** — azt a metadatát
  hitelesítetlen néző kapja meg, belső tárolókulcsnak nincs benne helye.
- **6.102.2:** a warm-blokk `db.select`-je await-elt volt a request-útvonalon, tehát egy adatbázis-hiba
  ott **a már megírt share létrehozását buktatta volna el**. Az egész blokk bekerítve — egy cache
  előtöltése soha nem kerülhet a user share-jébe.
- **`scripts/warm-share-stills.ts`**: azt az egy esetet fedi, amit a megosztáskori melegítés nem tud —
  egy `STILLS_CACHE_VERSION` bump **egyszerre** érvényteleníti az összes meglévő stripet. Verzióbumpot
  tartalmazó deploy után futtatandó a boxon. (**6.102.1:** először env nélkül futott, tehát semmilyen
  DB-hez nem ért el — `dotenv` + relatív importok, a `scripts/` házi mintája szerint.)

**Lefuttatva a boxon:** telekom 1 share / 1 videó → meleg (3 ms, manifest-olvasás); erste 6 share /
40 fájl / **0 videó**. **Egy vadonatúj néző mérve** (cache és auth nélkül, élesben): share oldal 200 /
0,45 s · poszter 200 / 63 553 B / **0,14 s** · manifest 0,11 s · 7. kocka 88 336 B / 0,13 s.
Nincs többé „preparing the video preview".

**DEPLOYOLVA 6.102.2 — mindkét tenant.** Health zöld.

**Amit NEM ellenőriztem:** a megosztáskori melegítést élő POST-tal nem futtattam — ahhoz session kell,
jelszót pedig nem írok be, és nem akartam éles adatba teszt-share-t létrehozni. Ugyanazt az
`ensureStills` útvonalat hívja, amit a script bizonyítottan végigfuttat.

---

## 2026-09-15 — Deploy-ablak elfedése (nginx maintenance page) + build-disk / swap vizsgálat

**Kiindulás (a boxon mérve, nem feltételezve):** az `messagingmatrix_error.log`-ban
`connect() failed (111: Connection refused)` — a Node process a deploy-ablakban **tényleg halott**,
nem csak lassú. A vhostokban **nincs `error_page`**, ezért nyers nginx 502 megy ki.
Gyökérok: a `next build` helyben írja felül a `.next`-et, amiből a futó `next start` épp kiszolgál,
plusz 3,8G RAM / 907M swap már használatban. Ezért nem csak a `pm2 restart` 1,3 másodperce törik,
hanem a teljes build ideje.

### A) Elfedés — 503 + statikus oldal a nyers 502 helyett — **✅ ÉL (2026-09-15)**
- [x] **A1** `deploy/maintenance/index.html` — login design-nyelv (slate-100→200 alap, `white/70` kártya,
      `rounded-2xl`, `shadow-xl`, `backdrop-blur`, `mmatrix.svg`), `status-badge` újrahasznosítva.
      **A-változat:** nincs visszaszámláló; valódi eltelt idő + 10 mp-enkénti próba + automatikus újratöltés.
- [x] **A2** `deploy/nginx/mm6-maintenance.conf` (`@mm6_maintenance` HTML + `@mm6_maintenance_json` a `/mcp`-nek,
      `error_page 502 503 504 =503`, sosem gate-elt `/__deploy-status.json` és `/__maintenance/`)
      + `deploy/nginx/mm6-maintenance-gate.conf` (a `location`-ökbe kerülő egysoros gate).
- [x] **A3** A gate **nem** server-level: az `if` ott a `/__deploy-status.json`-t és a logót is elnyelné,
      épp amikor kellenek. Ezért a `location /` és a `location /mcp` első sora.
- [x] **A4** Kitelepítve: `/var/www/mm6-maintenance/` (oldal + logó), `/etc/nginx/snippets/` (2 snippet),
      `/usr/local/bin/mm6-maint`, és az `erste` + `telekom` vhost. Proficio kimaradt (még v5).
      Valódi változás előtti mentés: `/var/backups/nginx-vhosts-20260915/*.pre-maintenance`.
      ⚠️ Az első mentés a **már módosított** fájlokat fogta meg (egy félresikerült parancs `scp`-jei
      már lefutottak) — újragyártva a bizonyítottan azonos visszaalakítással.
- [x] **A5** Élő ellenőrzés. Gate ON (csak erste): `/login` és `/matrix` → **503 text/html** a maintenance
      oldallal, `/api/*` → 503, `/mcp` → **503 application/json** (nem HTML), `/__deploy-status.json` → 200
      `{"active":true,"startedAt":…}`, `/__maintenance/mmatrix.svg` → 200, `Retry-After: 60`,
      `Cache-Control: no-store`. **Telekom közben végig 200** (per-tenant izoláció bizonyítva).
      Gate OFF → `/login` 200 · `/` 307 · `/mcp` 401 · status.json 404.
      **Crash-ág külön bizonyítva** eldobható vhosttal halott upstreamre (`:6099`→`:6999`), éles app
      megzavarása nélkül: flag **nélkül** is 502 → **503 + oldal**, `/mcp` → JSON. Utána törölve.
      **Böngészőben végigmérve:** az oldal renderel, a timer a status.json-ből számol, és a gate
      lekapcsolása után a fül **magától visszatöltött** (`/matrix` → app → `/login`) — kézi frissítés nélkül.
- [x] **A6** `mm6-maint on|off|status <tenant>` a boxon.

**Új deploy-recept (a flag az egyetlen igazság arról, hogy fut-e deploy):**
```
mm6-maint on erste
cd /var/www/mm6-erste && git pull && npm run build && pm2 restart mm6-erste --update-env
mm6-maint off erste
```

### B) Vizsgálat — extra disk buildre, swap a volume-ra — **✅ KIVIZSGÁLVA (2026-09-15)**

**A gyökérok megvan, és se a diszk, se a swap nem az** — az app saját logja mondja ki
(`/var/www/mm6-erste/logs/error.log`, 2026-09-15 14:52:21, ismétlődve):

```
ENOENT: no such file or directory, open '/var/www/mm6-erste/.next/required-server-files.json'
```

Ez pontosan a „`next build` kitörölte a `.next`-et a futó `next start` alól" aláírás. Nem OOM, nem
lassú I/O: **0 OOM-kill a kernel logban 30 napra visszamenőleg**, `available` RAM 2,2G, a 907M
swap-használat sima tétlen lapkisöprés, nem nyomás. A 167 restart és a 10-15 perces 502 ebből jön.

- [x] **B1 — az extra disk használható, de nem ez kell.** `/dev/sdb` **Hetzner Cloud Volume**
      (`scsi-0HC_Volume_104001329`), azaz **hálózati blokk-eszköz**. Egy build több tízezer apró fájl —
      pont az a profil, amin a hálózati volume lassú. Buildet odatenni **lassítana**.
      A valódi baj a root diszken van: **87%, 4,8G szabad**.
      ⚠️ **Két korábbi állításom tételes ellenőrzésre megdőlt:** a `docker system df` „3,4G reclaimable"-je
      félrevezet — **0 dangling image, mind a 6 futó containerhez tartozik**, ott nincs mit takarítani;
      a `/root/.cache/ms-playwright` 646M pedig **nem szemét**, azt használja a `preview-shooter.ts`.
      Valóban szemét: `journal` 3,6G (sapka nélkül) · `/root/.npm` 1,3G · régi pm2-logok 141M.
      A `/var/backups/mm5-legacy` (756M) marad — az a v5 adatmentés.
- [x] **B2 — a cross-disk swap technikailag megy, de itt értelmetlen és kockázatos.** Linux több
      swap-területet kezel, prioritás szerint (azonos prioritás = körkörös csíkozás), szóval egy második
      swapfile a volume-ra `swapon`-olható. De: **hálózati** eszközre swapelni azt jelenti, hogy a kernel
      memórianyomás alatt hálózati I/O-ra vár — ha a volume megbicsaklik, az egész box befagyhat.
      És nincs mit megoldani vele: **nincs memórianyomás** (0 OOM-kill, 2,2G available).

**Javasolt valódi fix (külön szelet, még nincs megcsinálva):** `next.config.ts` `distDir`-je olvasson
`process.env.NEXT_DIST_DIR`-t, a deploy `NEXT_DIST_DIR=.next-build`-be építsen, aztán `mv` + `pm2 restart`.
Így a futó app `.next`-jéhez hozzá sem ér a build → a leállás a `mv` + restart ≈ **1,5 másodperc**,
a maintenance oldal pedig visszalép annak, aminek való: **hálónak**, nem a fő mechanizmusnak.
Előfeltétel: a disk-takarítás, mert a `.next-build` még ~1,3G-t kér a jelenlegi 4,8G szabadból.

### C) Disk-takarítás + a valódi fix — **✅ KÉSZ (2026-09-15)**

- [x] **C1 Takarítás a boxon** — **4,8G → 9,4G szabad (87% → 74%)**, éles adathoz nem nyúltam.
      `journalctl --vacuum-size=500M` (3,2G) + **állandó sapka** `SystemMaxUse=500M` a
      `journald.conf`-ban, hogy ne nőjön vissza · `npm cache clean --force` (1,3G → 3,2M) ·
      7 napnál régebbi pm2-logok (141M → 108K; a legnagyobb egy áprilisi 68M-es `mm-server-telekom-out`).
      **Nem töröltem:** docker (nincs mit), `ms-playwright` (kell), `mm5-legacy` (v5 mentés),
      és a futó appok `.next/cache`-ét sem — egy futó szerver alól kacsintás nélkül nem rántok cache-t,
      és a headroom így is bőven megvan.
- [x] **C2 `next.config.ts`: `distDir: process.env.NEXT_DIST_DIR || ".next"`** — a build ezentúl
      máshova ír, mint amiből a futó szerver olvas. `npm run typecheck` tiszta.
      A `.gitignore` kiegészítve (`.next-build`, `.next-old`).
- [x] **C3 `deploy/bin/mm6-deploy <tenant>`** — a deploy egy paranccsá vonva:
      `git pull` → build `.next-build`-be (**az app közben végig szolgál ki**) → gate fel → `mv` swap →
      `pm2 restart` → **readiness-poll a tenant portján** → gate le → `.next-old` törlés.
      A cache-t átmásolja a `.next-build`-be, hogy a deploy ne legyen minden alkalommal hideg build.
      **Bukott build az `set -e` miatt a gate felkapcsolása ELŐTT áll meg** — az éles apphoz hozzá sem ér.
      Ha az app nem jön fel 60 mp alatt: a **maintenance oldal fent marad**, a `.next-old` a helyén,
      exit 1 — nem hallgat el egy fél-deployt.

**A deploy-recept mostantól:**
```
mm6-deploy erste
mm6-deploy telekom
```

### D) Az első deploy az új úton — és amit közben kirántott a szőnyeg alól

**DEPLOYOLVA 6.103.0 — mindkét tenant**, commit `092015a`.

**Mért kiesés (fél másodperces kopogtatás az éles URL-en, végig a deploy alatt):**

| | deploy hossza | nem-200 válasz | ebből 502 | kiesés |
|---|---|---|---|---|
| erste | 4m 08s | 15 × 503 | **0** | **8,4 mp** |
| telekom | 3m 09s | 7 × 503 | **0** | **3,7 mp** |

A korábbi ~10-15 perc nyers 502 helyett néhány másodperc maintenance oldal. Az app a **teljes build
alatt végig kiszolgált** — a gate csak a `mv` swapre és a restartra megy fel.

**A bukott első próba a bizonyíték a sorrendre:** az első `mm6-deploy erste` 2m18s után elszállt egy
típushibán — és a prober **egyetlen nem-200-at sem** rögzített. A `set -e` a gate felkapcsolása előtt
állt meg, az éles app hozzá sem ért a hibához. Pontosan ezért van ebben a sorrendben.

**A típushiba viszont valódi lelet volt — `src/lib/scoped.ts`:**
```
Route "src/app/api/adform-snapshots/route.ts" has an invalid "GET" export:
  Expected "Promise<any>", got "Promise<Record<string, never>> | undefined"
```
A `withSession`/`withAdmin` a route-kontextust `{ params?: Promise<T> }`-ként hirdette, **opcionális**
`params`-szal. A Next viszont **mindig** ad `params`-t (dinamikus szegmens nélküli route-nál üres
promise-t), és a route-export-validációja a nem kötelező formát elutasítja. **47 route** örökölte.

**Miért nem derült ki eddig:** az inkrementális típusellenőrzés hónapok óta nem nézte újra ezeket a
fájlokat. A distDir-váltás érvénytelenítette a `tsbuildinfo`-t → **első teljes ellenőrzés → azonnal
elhasalt**. Tételes teszttel zártam ki a másik gyanúsítottat (duplikált `types` könyvtár a
tsconfig `include`-ban): az sem `.next/types` nélkül nem múlt el → nem az volt.

- [x] **D1** `scoped.ts`: `params` kötelező és közvetlenül `await`-elt. A `?? ({} as T)` **elhagyva** —
      épp azt az alakot fedte le, amit a Next soha nem ad át.
- [x] **D2** 22 teszt-hívás 5 fájlban a valódi kontextust adja át (`{ params: Promise.resolve({}) }`),
      nem vak cserével: a `tsc` által jelentett pontos sor/oszlop pozíciókon.
- [x] **D3** `npm test` **969 teszt / 102 fájl zöld**, tiszta `tsc` (tsbuildinfo nélkül) hibátlan.
- [x] **D4** `.next-build/types/**/*.ts` bekerült a repó `tsconfig.json`-jába — különben a `next build`
      minden deploynál átírja a fájlt a boxon, és a következő `git pull --ff-only` beleakad.
      (A boxon a Next által okozott drift `git checkout`-tal törölve — kozmetikai újraformázás volt.)

**Nyitott, amit ez felvet:** ha ez a hiba 47 route-on hónapokig láthatatlan volt, akkor az
inkrementális típusellenőrzés **más** lappangó hibákat is takarhat. Egy CI-szerű „tiszta
`tsbuildinfo` + teljes `tsc`" lépés olcsón kiszűrné — most a deploy az egyetlen hely, ahol teljes
ellenőrzés fut.

---

## 2026-09-16 — Creative Library: `date:`/`time:` szűrő + „Filter to these" a feltöltés után

**Döntés (user):** `upload:last`, **séma-migráció nélkül**. A batch-oszlop (`batch:<id>`) elvetve —
ha később kell a régi feltöltésekre visszakeresni, az külön szelet.

**Miért nem a dátumszűrő a „filter to these" motorja:** 125 kreatív mentése átlóghat percen/órán, és
bármelyik másik feltöltés ugyanabból az ablakból belesöprődik. A feltöltés viszont pontosan tudja,
melyik sorokat hozta létre — csak most eldobja (`commitItem: (item) => Promise<void>`).

### 1. `src/lib/search-query.ts` — `date:` és `time:`
- [x] **F1** `SearchFields` két új mezővel: `createdDate` (`2026-09-16`) és `createdTime` (`12:34:56`),
      **helyi időben** — a lista is `toLocaleString`-gel mutat, és `date:today` UTC-ben éjfél körül hazudna.
      `emptySearchFields()` is megkapja őket.
- [x] **F2** `PREFIX_MAP`: `date` → `createdDate`, `time` → `createdTime`.
- [x] **F3** `date:today` / `date:yesterday` feloldása a **helyi** naptári napra, parse-időben.
- [x] **F4** `*` joker a mezőértékben: `time:12:*`, `date:2026-09-*`, `time:*:30`. (A `time:12:*` a
      tokenizáláson átmegy: a `classifyToken` az ELSŐ kettőspontnál vág, tehát prefix=`time`, érték=`12:*`.)
- [x] **F5** `NARROWING_PREFIXES`/`narrowingAxes` **változatlan**: a dátum se audience-t, se topicot nem ír
      le, tehát nem nyeshet grid-tengelyt — ugyanaz az érv, mint a szabad szövegnél.
- [x] **F6** Unit tesztek a `tests/unit/`-ba (a `search-query` mintájára): nap, óra-joker, `today`,
      és hogy a `mc:` horgonyzott viselkedése nem sérül.

### 2. A három teljes literál feltöltése
- [x] **F7** Creative Library: `createdAt` → helyi dátum/idő. ⚠️ Mátrix-sornál a `createdAt` valójában
      a `message.updatedAt` (CreativeLibrary.tsx:439) — a **kijelzett oszlop is ezt mutatja**, tehát a
      szűrő konzisztens marad vele; ezt kiírom a súgóba.
- [x] **F8** `assets/AssetsLibrary.tsx` és `matrix/MatrixGrid.tsx`: üres stringet adnak (a `date:` ott
      egyszerűen nem talál). Nem bővítem őket — nem ezt kérted.
- [x] **F9** Placeholder + `title` súgó a kereső mezőn: `date:` `time:` felvétele.

### 3. „Filter to these" — `upload:last`
- [x] **F10** `UploadQueue`: a `commitItem` visszaadja a létrehozott id-t, a `QueueItem` megjegyzi.
- [x] **F11** A queue kiadja a session `done` id-jait; eltárolva `mm6_creative_library_last_upload`
      kulcson (a házi `mm6_<page>_<thing>` konvenció szerint), hogy reload után is megvan.
- [x] **F12** Gomb a **nagy** dialógus fejlécében a Close mellé **és** a **kicsi** lebegő panelre:
      `Filter to these N` — csak ha `done > 0`. Új opcionális prop, a `BatchUploadDialog` marad általános.
- [x] **F13** A library `upload:last`-ot ír a keresőbe és bezárja a dialógust.
- [x] **F14** A feloldás a **libraryben**, nem a parserben: az `upload:last` tokent kiemeli a
      keresőstringből, a maradékot adja a `parseSearchQuery`-nek, és metszi a tárolt id-halmazzal.
      Így a generikus parser nem tud egy library-specifikus fogalomról, és a token **kombinálható**
      a többivel (`upload:last mc:328`).
- [x] **F15** Ellenőrzés böngészőben éles adaton (erste dev), és `npm test`.

---

## 2026-09-16 — Ügynökségi riportok (AO_Meta / AO_PRG / AO_PMAX) vs. a mi monitoringunk — FELMÉRÉS

Forrás: `~/GoogleDrive/Data/ERSTE HU/_riports/` (2026-09-16), mindhárom **2026-01-01 → 08-31**.
A mi `monitoring` táblánk: 4 AdForm „Creative rep" (május–augusztus), 15 646 sor.

### Tények

**T1 — PRG (programmatic) MC-egyezés: a DCO rendben van, ahogy gondoltad.**
- PRG = **PBU** (nálunk `platform=adform`) + **Flex** (nálunk `platform=dv360`). Semmi más vendor
  (adaptivemedia, telex, centralmedia, wppnexus…) **nincs benne** — ezért van, hogy nálunk 294a és 302a
  *több* impressziót mutat, mint a PRG.
- Ahol a periódus egyezik (Q3-as MC-k, 314+), a mi impresszió / PRG impresszió = **0,96–0,97** minden
  MC-nél — a különbség a „Rendered Impressions" (mi) vs „Impressions" (ők). Régebbi MC-knél 0,4–0,6, mert
  a PRG jan–aug, mi máj–aug. **Az MC-szintű egyeztetés tehát jó.**
- PRG-ben van, nálunk nincs: `MC00*` (Cseperedő Q1, OtthonStart, Future — nem mátrixos statikus kreák,
  35,4M impr a 103M-ból), `MC165a–169e` (Flex calculatorMockup — régi számozás, ma 316–320), `MC110`/`MC117`
  variáns nélkül (ügynökségi címke), `MC114NA`/`MC116NA`.
- PRG Topic oszlop: 109-ből **58** azonos a mi topic-kulcsunkkal, a többi ügynökségi címke
  (`a_fuvarozo - Native`, `400e_a_sajat_tered`…) — MC+topic párra nem szabad kulcsolni, csak MC-re.

**T2 — A konverziószám a nagy gond, nem az MC.** A mi AdForm riportunk `Conversions` oszlopa **120**
augusztusra az egész accountra; a PRG ugyanezekre az MC-kre **13 269** jan–aug (SZK e2e+vhk 1 225,
Max HK 538, VAL „számlacsomag visit" 11 242). Q3 példa: 321a nálunk **0**, PRG **7**; 110b nálunk 3,
PRG 72. Ez nem periódus-különbség (100×), hanem **más metrika**: a „Creative rep" egyetlen
`Conversions` oszlopa (a riport-builder 13 fix mezője, `adform-report-skill-spec.md`) nem tartalmazza
azt, amit az ügynökség számol (valószínűleg post-view/„all conversions", tracking pontonként bontva:
e2e / vhk / számlacsomag visit / javaslatok). **Amíg ez nincs tisztázva, a mi CPA-nk nem hasonlítható
össze az övékével** — a nevező hiányzik.
- Költség: nálunk csak `adform` soron van cost (26,2M HUF máj–aug); `dv360` sorokon **0** (67 HUF).
  A PRG-ben **egyáltalán nincs cost oszlop**. Flex/DV360 CPA tehát a mi adatunkból nem számolható.

**T3 — Meta: 97 hirdetés a Raw Data lapon, ebből egyetlenegy sem kerülhet be ma a monitoringba.**
A mi Meta-adatunk csak az AdForm-tracking `m_00` kampányszintű sora (`p_meta_facebook…-m_00-t_szk_q1-q4`),
kreatív szint nincs. Az ügynökségi Meta-riportban a hirdetésnév hordozza a kulcsot:
`native!newsfeedad!<kreatívszám><variáns>!1080x1080!pmmid=<pmmid>!v11`. Költés szerint:
| kategória | hirdetés | költés | |
|---|---|---|---|
| A — konzisztens pmmid (hirdetésnév-szám = `m_`) | 15 | 1,05M (12,8%) | ma is parse-olható |
| B — **hirdetésnév-szám ≠ pmmid `m_`** (28 db: 131→m_129, 318→m_301, 323→m_293, 320→m_127, 316/319/331→m_303, 332→m_317…) | 28 | 2,49M (30,4%) | a pmmid a *klónozott eredeti* MC-jét viszi, a név az újat |
| C — pmmid **üres audience-szel** (`-a_-m_312`) | 22 | 1,81M (22,1%) | `parsePmmid` eldobja (`!audienceKey`) |
| D — nincs MM-pmmid (`marketgo_pro`, `hajo`, `future_ret`, `felreteszek_pro`, `otthonstart-lakashitel_pro`) | 32 | 2,84M (34,6%) | nem mátrixos kreák |
- **Számütközés a mátrixszal (régi/ügynökségi számozás):** Meta `312` = onlineSzamla_150e pro
  (mátrix 312 = MARKET genZ; a mátrixban a 150e-s online számla = **296**), Meta `111` = cseperedoSzamla_20e
  (mátrix 111 = SZK Pénztárca), Meta `41c` = instantkartya (mátrix 41 = HITEL yes2loans; instantkártya =
  39/43), Meta pmmid `m_129` (mátrix 129 = SZA switchon; a Szelfi = **131 f/g**, amit a hirdetésnév mond).
- Meta „Results" kampányonként **más esemény** (Online számla Action / SZK VHK+e2e / Max HK e2e begin /
  Landing page views / Hitel Tinder lead / SoftConversion) — a CPA-nak kampány-szintű definíciója van,
  nem account-szintű.
- Facebook preview-ellenőrzés (Opus subagent, ~30 link): eredmény lentebb, T4.

**T4 — Preview-ellenőrzés: NEM SIKERÜLT, környezeti ok (2026-09-16).** Az Opus subagent 0/27 preview-t
tudott elolvasni: a Chrome-ablak takarásban/minimalizálva volt (`document.visibilityState === "hidden"`,
`requestAnimationFrame` és `IntersectionObserver` soha nem tüzelt), a Facebook feed pedig virtualizált —
az 1. poszt után csak skeleton marad, görgetni sem lehet. Nem a linkek hibásak (a sima facebook.com
ugyanígy viselkedett). **Újrafuttatás:** Chrome előtérben, nem takarva — a 27 prioritizált sor kész:
`scratchpad/preview_check.csv`. Megjegyzés: az egyetlen rövid szakaszban, ahol ~10 poszt renderelt, Erste
hirdetés nem jelent meg — az első linknél ellenőrizni kell, hogy a demo-ad egyáltalán injektálódik-e a
bejelentkezett fiókkal.

### Javasolt terv — CPA-szintű hozzárendelés (DÖNTÉSRE VÁR, nem indult el)

**Push-back először:** a T2 nem kód, hanem riport-definíció. A leggyorsabb 80%: az ügynökségtől (vagy az
AdForm riport-builderben) **egy** módosítás — a „Creative rep" kapjon `Conversions` bontást tracking
pontonként (+ post-click/post-view), és a PRG kapjon `Cost` oszlopot + hónap-bontást. Ha ez megvan, a
mostani importer **változatlanul** hozza az MC-szintű CPA-t PBU-ra; DV360-ra a cost külön forrás.

- [ ] **R1 (0 kód)** Kérés az ügynökségnek / AdForm builder: (a) Creative rep: `Conversions` tracking
      pontonként és attribúció szerint; (b) PRG: `Cost` + `Month` oszlop; (c) Meta: **havi** bontás
      (`Reporting starts/ends` már ott van, csak a breakdown hiányzik) + `Ad ID` oszlop.
- [ ] **R2 (minor)** `parsePmmid`: üres `-a_` **nem eldobás** — Meta-nál az audience az ad set
      (`…!con!bro!…` / `…!con!ret!…` → pro/rem) és nem a pmmid hordozza. Csak a `-m_` + `-v_` legyen kötelező.
- [ ] **R3 (minor)** Meta-importer (`AO_Meta.xlsx` „Raw Data Report" lap): sor = hirdetés; kulcs =
      **hirdetésnév-szám+variáns** (T4 dönti el, hogy ez vagy a pmmid `m_` a valós kreatív); `platform=meta`,
      `scope=p_meta`, cost = `Amount spent`, conversions = `Results`, + **új oszlop `result_type`**
      (kampányonként más esemény, CPA csak azonos típuson belül összegezhető). Periódus a Reporting starts/ends-ből.
      A meglévő `monitoring` sémába illik; egy új oszlop → migráció.
- [ ] **R4 (patch)** Resolver: a Meta-sorok a nem-DCO tengelyre illeszkedjenek (`family` szint elég, mert a
      Meta-nak nincs audience-kulcsa); a régi-számozású ütközések (312/111/41/129) **kézi override-tábla**
      helyett R1(c) `Ad ID`-val + a W3.h override-mintával — külön szelet, nem most.
- [ ] **R5 (UI, minor)** Monitoring tábla: `CPA = cost / conversions` oszlop + `result_type` szűrő;
      csak akkor, ha R1(a) után a nevező értelmes.
- [ ] **R6** PMAX (`AO_PMAX.xlsx`, asset-group szint, van Cost + Conversions): nincs MC-kulcs, csak
      kampány/asset group → **nem MC-szintű**, LATER.

**LESZÁLLÍTVA 6.104.0 (2026-09-16).** `tsc` tiszta, lint 0 hiba, **978 teszt zöld** (9 új a
`date:`/`time:`-ra: nap, részleges dátum, óra-joker, joker az érték bármely pontján, `today`/`yesterday`
hamis órával, „dátum nem érhető el szabad szövegből", és hogy a horgonyzott `mc:` nem sérült).

**Két dolog másképp lett, mint a terv — mindkettő menet közbeni lelet:**
- **Verzió-családok:** a feltöltött sorok családonként csoportosulnak, és a látható sor a `latest`.
  Ha a feltöltés egy meglévő család új verzióját hozta létre, a megjelenő id **más**, mint a most
  létrejött id. Ezért a család **bármelyik** verziójára illesztek — enélkül a „filter to these"
  némán kihagyott volna sorokat.
- **Időzóna:** a tárolt bélyeg UTC, jelölés nélkül (`2026-09-16 10:35:03`), a kijelzés `new Date(iso)`-val
  olvassa, amit a JS **helyi időként** ért. A Created oszlop tehát **ma is 2 órával elcsúszva mutat**.
  A szűrőt szándékosan **ugyanarra az értékre** építettem (`listDateParts`, a `formatListDate` mellett,
  hogy ne tudjanak elcsúszni) — az ára, hogy a 12:35-kor (helyi) feltöltött anyagot `time:10:*` találja.
  **Meglévő hiba, nem most keletkezett; app-szintű javítás lenne. Nyitott.**

**Amit a user bejelentett és NEM hiba volt:** „upload:last does not seem to work" — a funkció akkor még
nem volt kint, a live app 6.103.0-n állt, ahol az `upload:last` csak szabad szöveg. Viszont rávilágított
egy valódi hiányra: üres tárolt halmaznál a szűrő ugyanúgy „semmi nem illik"-et mutat, mint egy törött
szűrő. Ezért **saját üres állapot**: „No upload recorded in this browser" + magyarázat, hogy a funkció
előtti feltöltések nem lettek rögzítve.

---

## 2026-09-16 — A sorrend, ami sehol nem volt megadva (6.105.0)

**A bejelentés:** „össze-vissza van a sorrend, mert egyszerre történt sok feltöltés" — és a javaslat,
hogy toljuk el az időbélyegeket MC-csoportonként pár másodperccel.

**Először tévesen azt mondtam, hogy a tárolt sorrend hibátlan** — csak az első 12 sort néztem.
A teljes 104-en mérve a 17 MC **75 külön blokkra** esett szét. A user-nek igaza volt.

**A valódi ok kettő volt, egymás után:**
1. `CreativeLibrary.tsx` — `selectedCreativeIds` a **nyers `items`** listán ment végig, nem a
   `sorted`-on. A képernyőn látott rendezés már itt elveszett.
2. `api/share-galleries/route.ts` — `where id in (...)` **`ORDER BY` nélkül**. A Postgres a tervből
   adódó sorrendet adta: növekvő futamok, amik visszaugranak. Ez volt a „random".

**A harmadik, külön hiba:** `sortListRows` döntetlennél `b.id - a.id` — **a `sort.dir`-t figyelmen
kívül hagyva**, tehát növekvő rendezésnél minden azonos értékű csoport fordítva jött ki. És az `id`
amúgy sem mond semmit a szemnek.

**A negyedik:** a Creative Library masonry-ja **nem adott át `estimateHeight`-et**, ezért körbeosztásra
(`i % colCount`) esett vissza — meg sem próbálta a legalacsonyabb oszlopba tenni a következő csempét.

- [x] Kliens a **látott** sorrendet küldi (`sorted` előre, `items` utána, hogy a szűrőváltás előtt
      kijelölt elem ne tűnjön el némán).
- [x] Szerver **megőrzi a kapott sorrendet** (`creativeIds` pozíció szerint).
- [x] Döntetlen = **fájlnév** (numerikus összehasonlítással, hogy MC99 < MC1000), majd id; iránykövető.
- [x] Masonry becslés a libraryben is; a becslő `aspectEstimate`-ként a `Masonry` mellé került, mert
      innentől két hívója van (a share eddig saját másolatot használt).
- [x] 4 új teszt a döntetlenre. **982 teszt zöld**, `tsc` tiszta, lint 0 hiba.

**Elvetve:** az időbélyeg-eltolás (nem kellett, a sorrend sehol nem volt megadva — nem a bélyegek voltak
rosszak) és az MC-csoportonkénti külön feltöltés (104 fájl 22 csomagban = szopás).

**Nem javul visszamenőleg:** a meglévő share-ek snapshotja már rögzült. Új share már jól jön ki.

### Törlések (kérésre, mentéssel)
- 10:34-es **125 SZK** → törölve (sorok + fájlok + 2 cella + 124 thumbnail).
  Mentés: `~/mm6-backups/erste-szk-20260916/` (42,9 MB).
- 16:21-es **104 SZK** → törölve (sorok + fájlok + 2 cella + 233 thumbnail).
  Mentés: `~/mm6-backups/erste-szk-1621-20260916/` (33,4 MB).
- Mindkettőnél ellenőrizve: **0 osztott `storage_path`** (a sha-dedup miatt ez nem elhanyagolható),
  0 FK-hivatkozás, 0 tört fájl-hivatkozás utána. A **639 korábbi SZK** és a MARKET érintetlen.
- ⚠️ **Nyitott:** a `izsndLWqS4We` és `JgDhExMgmYlX` share a 104-re hivatkozik → **törött képek**.
  A user döntése, hogy törli-e őket.

---

## 2026-09-16 — Feltöltő UI + share szűrő (terv)

### A) Nagy feltöltő tábla — verzió és verzió-ugrás
- [x] **A1** Új **`V`** oszlop: a fájlnévből kiolvasott verzió (`_nN_` → `parseCreativeFilename().version`).
- [x] **A2** **Match-jelzés**: ha a `familyKey|declaredDimensions` kulcs már létezik a libraryben lévő
      kreatívok között, a sor jelzi, hogy ez **verzió-ugrás** (pl. `v3 → v4`), nem új kreatív.
      Minden kliensoldalon: a `creatives` lista már be van töltve, nincs szükség új lekérésre.
      A kulcs pontosan az, amit a `groupCreativeVersions` használ — egy helyen definiálva, hogy a
      jelzés és a tényleges csoportosítás ne tudjon elcsúszni.
- [x] **A3** Ami **nem** derül ki a fájlnévből (a `_nN_` hiányzik → v1), az is látszódjon, hogy ne
      tűnjön véletlen ütközésnek.

### B) Kis lebegő panel — átrendezés
- [x] **B1** 1. sor: **`Upload queue` cím teljes szélességben**, mellette **csak** maximize + close.
- [x] **B2** 2. sor: `Save N` · `Filter to these N` · `Clear done` gombok.
- [x] **B3** 3. sor: Drive parent folder link **ikonnal**, az „Optional — the direct file link…"
      segédszöveg **elhagyva** (a nagy nézetben marad).
- [x] **B4** Sorok: fájlnév **rövidítve** (a lényeg a vége: MC + méret — tehát elöl csonkolva),
      és a kinyert metaadatok (brand/product/type/MC/variant) **nem** jelennek meg itt —
      az a nagy táblára való.

### C) Share oldal — szűrő felülre
- [x] **C1** Szövegszűrő a `share-gallery__controls` sorba, a Size és a Commented only mellé:
      MC-re és kreatív-kulcsszavakra. **A meglévő `parseSearchQuery`-t használja** (`src/lib/`,
      nem app-specifikus), így `mc:141`, `mc:141c`, szabad szöveg, `OR` és idézőjeles kifejezés
      mind ingyen jön, és ugyanúgy viselkedik, mint a libraryben.
- [x] **C2** A szűrő a Download all / Drive gombok darabszámát is kövesse (ami látszik, az töltődik).
- [x] **C3** Üres találat: a meglévő `empty-state` mintát használja.

**LESZÁLLÍTVA 6.106.0 (2026-09-16).** 982 teszt zöld, `tsc` tiszta, lint 0 hiba.

- A verzió-kulcs `versionFamilyKey`-ként kiemelve a `group-creative-versions.ts`-be, és a csoportosítás
  is azt használja — két külön levezetés a „ugyanaz a család"-ra előbb-utóbb szétcsúszna, és az úgy
  jelenne meg, hogy egy fájl verziót ígért, aztán a régi mellé állt be.
- A `BatchUploadDialog` generikus maradt: a verzió-jelzést `fileNote` propon át a **library** adja,
  mert a verzió-fogalom kreatív-specifikus (az assets nem tud róla).
- A kis panelről kikerült a `renderForm`, ezért a `QueueItemForm` halott kóddá vált — **törölve**,
  nem hagytam bent.
- **C2 nem igényelt változtatást:** a `downloadTargets` már a `filtered`-ből jött, tehát a
  `Download all (N)` magától követi az új szűrőt.
- A share szűrő a **típusos propokból** építi a mezőket, nem a megjelenített elemből: a dialógus
  item-típusa szűkebb nézet ugyanarra a sorra, és épp a `pmmid`-et meg a kulcsszó-oszlopokat nem
  deklarálja — vagyis pont azokat, amikre egy share-t szűrve rákeres az ember.

---

## 2026-09-16 (2) — Riport-egyeztetés: mérőkeret + kvantitatív elemzés — **a fenti R1–R6-ot felváltja**

**Teljes tanulmány: `docs/REPORT_RECONCILIATION_STUDY.md`. Mérőkeret: `scripts/recon/` (olvasás-only,
újrafuttatható, saját README).** A fenti (első) szekció kvalitatív becslései közül kettő **tévesnek
bizonyult** a mérésen — az ott írt R1–R6 helyett az alábbi H1–H12 érvényes.

### A módszer, amit a user kért: minta → kvalitatív ítélet → kvantitatív szabály → mérés → újabb minta
27 kézzel ítélt vitás Meta-eset + 32 negatív minta = **gold címkék** (`scripts/recon/labels.py`).
A hurok **háromszor javított és kétszer rontott**; mindkét rontás önálló lelet:

| lépés | gold | költés-súly | tanulság |
|---|---|---|---|
| v1 szózsák | 70% | 58% | a token-átfedés összemossa a rokon kártyákat |
| v2 laza topic-bővítés | **41%** ↓ | **30%** ↓ | **a topic cáfolni tud, jelölni nem** (289 topicból 37 több MC-t nevez meg) |
| v3 szekvencia-hasonlóság | 85% | 89% | a `t_` szó szerint a topic-kulcs, nem szózsák kell |
| v4 „minden szám nyer" | 99,9% ✗ | — | **hamis pozitív gyár**: ügynökségi `01a/02a` ráül MC1/MC2-re |
| **v5 bizonyíték-kapu** | **85%** | **89%** | 0 hamis pozitív **kézi tiltólista nélkül** |

### Az elvi hiba (mérve)
**Három, egymástól függetlenül mozgó azonosítótér; az MC szám nem kulcs, hanem címke.**
A mátrix él és átszámozódik, a pmmid a trafficking pillanatában befagy, a Meta-klón örökli a régi
linket, az ügynökség pedig saját címkét használ.

1. **A méret identitásként viselkedik, pedig attribútum.** Többértelműség:
   `(szám,variáns)` **40,3%** → `(tengely,szám,variáns)` 37,7% → **méret nélkül 4,6%**.
   A 258 ütköző csoportból **201 csak méret-fan-out** — a káosz 78%-a modellezési műtermék.
2. **A klónozás szétcsúsztat.** 97 Meta hirdetésből 28-ban tér el a név és a pmmid (költés 30,4%).
   A hirdetésnév-prior monoton javít és 1,2-nél telítődik (0,0→74% · 0,8→81% · **1,2→85%** · 2,0→85%);
   a 27 vitás eset **23:4 arányban a hirdetésnévnek ad igazat**.
3. **A tárolt egyezés befagy.** `match_level` importkori: exact 25,2%. **Ma újraszámolva: 48,7%**,
   ugyanaz a kód, csak friss mátrix (+26,9M megjelenés). A `-n_` a sorok 12%-ában már driftelt.
4. **Ami nem a mátrixból indul, nem csatolható vissza.** `m_00` = 24,1% megjelenés, **42,7M Ft**.
   Megmértem a visszanyerhetőséget: **0,0%**. A legnagyobb tétel `t_diak_q3` (8,1M megj., 38,1M Ft),
   miközben a kártya **létezik** (MC324/325) — csak a forgalom nem hordozza.

### Mért lefedettség
- **PRG azonosság: 66,9%** (a hiány 27,7% MC00 + 2,9% ismeretlen + 2,5% értelmezhetetlen címke).
- **PRG volumen, periódus-igazított 43 MC-n: megjelenés arány 1,021** (MC-medián 0,963) —
  **a megjelenés 4%-on belül egyezik**. **Konverzió arány 0,093** — tízszeres eltérés, és ez már
  NEM periódus-műtermék. A PRG-ben nincs cost; a `dv360` sorainkon nincs költség.
- **Meta: ma 0% → a javasolt eljárással 65,4% költés-lefedettség**; a maradék 34,6% ügynökségi saját
  számozás, szerkezetileg csatolhatatlan.
- **Eldobott, meglévő dimenzió:** a pmmid `-s_` (pro/rem) a sorok **100%-ában** kitöltött, de nincs
  oszlopa; a `-l_<lineitem>` 47,4%-ban ott van, szintén kihasználatlanul.

### H1–H12 — teendők (sorrend: H11 → H6 → H7+H8 → H1–H4 → H9+H10 → H12)

**Nulla kód, ügynökségi/trafficking oldal (itt van a legnagyobb hozam):**
- [ ] **H1** Az MC kerüljön bele MINDEN trafficking-névbe (`-m_` soha ne `00`, `-t_` a mátrix
      topic-kulcsa legyen, ne kampány-slug). Ez a `m_00` blokk **egyetlen** megoldása: 42,7M Ft.
- [ ] **H2** „Creative rep": `Conversions` bontás tracking pontonként (e2e / vhk / számlacsomag
      visit / javaslatok) + post-click vs post-view. Enélkül nincs CPA-nevező (arány ma 0,093).
- [ ] **H3** PRG: `Cost` + `Month` oszlop. Cost nélkül Flex/DV360 CPA nem létezik.
- [ ] **H4** Meta: **`Ad ID` oszlop** + havi bontás. Az `Ad ID` stabil, a név nem — ez egy csapásra
      megszüntetné a klón-drift problémakört.
- [ ] **H5** Meta ad-elnevezési szabály: klón után a landing URL pmmid-jét is frissíteni, VAGY a
      nevet nem átírni. A kettő együtt hazudik.

**mm6 kód:**
- [ ] **H11 (patch, ELSŐ)** Újraimport a 4 meglévő AdForm fájlból (a korábbi `W3.j-6`). Önmagában
      **25,2% → 48,7% exact**, új szabály nélkül, csak a mai mátrixszal. Migráció nem kell.
- [ ] **H6 (patch)** `buildMessageResolver` (`src/lib/adform-report.ts`): a `family` teszt
      **üzenet-azonosságon**, ne sor-azonosságon — `(tengely, szám, variáns, koncepció)`, a méret
      attribútum. Többértelműség **40,3% → 4,6%**. A lista legolcsóbb egyetlen javítása.
- [ ] **H7 (minor)** `monitoring.strategy` oszlop — a `-s_` már 100%-ban kitöltött, csak eldobjuk.
      Ezzel lesz prospecting/remarketing bontás, ami az ügynökségi riport alapbontása.
- [ ] **H8 (minor)** `parsePmmid` fogadja el az üres `-a_`-t (Metánál az audience az ad set).
      Ma a `!audienceKey` ág 22 hirdetést dob el = a Meta-költés 22,1%-a.
- [ ] **H9 (minor)** Meta importer: kulcs a **hirdetésnév-szám+variáns**, a pmmid `m_` csak ellenőrző
      tanú; `platform=meta`, cost=`Amount spent`, conv=`Results`, **+ új `result_type` oszlop**
      (kampányonként más az esemény → CPA csak azonos típuson belül összegezhető).
- [ ] **H10 (minor)** Az öt tanú + a bizonyíték-kapu portolása TS-be a `scripts/recon/score.py`
      súlyaival; a gold címkék mennek vele tesztként (regressziós korlát: 85% / 89% / 0 FP).
- [ ] **H12 (minor)** `-l_<lineitem_id>` eltárolása negyedik egyeztetési tengelynek.

### Amit NE csináljunk (mérve, nem vélemény)
- **Ne építsünk fuzzy visszanyerést a `m_00` blokkra** — 0,0% csatolható, minden lazítás hamis
  pozitívot gyárt. A helye a trafficking, nem a resolver.
- **Ne kulcsoljunk MC+topic párra** az ügynökségi riportoknál — a PRG 109 topicjából 58 a mi
  kulcsunk, a többi kampány-slug. Csak MC-re.
- **Ne javítsuk a `match_level`-t sorszinten** — az import periódusonként töröl+újratölt.

**Plafon H1–H4 nélkül:** AdForm/DV360 66,9% azonosság, Meta 65,4% költés-lefedettség, **és CPA
továbbra sem** — mert a konverzió-nevező az ügynökségnél van, nem nálunk.

**Kód nem változott** (csak `scripts/recon/` + `.gitignore` + `docs/`). Verzió-bump nem indokolt.

---

## 2026-09-23 — Videó-kreatívok képi elemzése, és a teendő-terv lezárása

A round 2 leltár (50 sor) bekerült a DB-be: **930 → 980** kreatívnak van `image_text` +
`image_description`. MC311 80/80, MC348 10/10 kész. Ami nyitva maradt: **97 videó, 0 elolvasva**
(19 MC, 25 külön (MC, betű) design) — köztük az MC33 20 mp4-e, ami a teendő-tábla 16 ELLENŐRIZ sora.

**Mérés (MC33, 10 mp, 60 fps), ami a módszert eldöntötte:**
- A klip 0–4 mp-ben néma fotó, nulla szöveggel; az end card ~5 mp-től épül fel és a legutolsó
  kockáig sértetlen — nincs fade-out. A teljes szöveg EGY kockán van, és az az utolsó.
- Mind a négy betű záró kártyája **karakterre ugyanazt mondja** („Kalkulálj velünk!", azonos THM).
  A négy videót **kizárólag a kép** különbözteti meg (lila/pink/türkiz/kék + más fotó).
  Vagyis videónál a szövegtanú önmagában nem dönt — a képleírás a döntő mező.
- Az mp4 `a` ≠ a png `a`: egy MC, egy betű, egy méret, két különböző design — csak a kiterjesztés
  választja el őket (a 6baa7a4-ben bevezetett kiterjesztés-identitás szabály helyes volt).

**A kockakivágás valódi hozama nem a szöveg, hanem a pixeltanú.** A `gen-variant-actions.ts`
`diff()`-je `sharp()`-pal nyit, ami mp4-en dob → `null` → a logika a záró `else`-re esik, és
„MARAD (külön kreatív) — azonos szöveg, de nagy felületen tér el" indoklást ír **mérés nélkül**.
Kivágott JPEG-en a diff működik, tehát a harmadik tanú visszatér.

### Lépések
- [x] **V1** `scripts/export-video-frames-for-reading.ts` — záró kártya (az utolsó kocka, amin még
      rajta van a kreatív: hátralépés, amíg a kocka majdnem egyszínű) + (MC, betű)-nként EGY
      idősáv-kontaktlap (20/40/60/80% próbakockák 2×2-ben), hogy látszódjon, ha a klip lépcsőzi a
      szöveget. 97 záró kártya + 25 kontaktlap.
- [x] **V2** A kockák elolvasása és a leltár-xlsx kitöltése (ugyanaz a két oszlop, videó-prompttal).
- [x] **V3** Import `import-image-readings.ts`-szel → **1077 olvasott kreatív** (97/97 videó).
- [x] **V4** `gen-variant-actions.ts` javítás: (a) `scanExport()` ismerje az `idNNNN__` nevet, mint
      az importer már; (b) videó-ág — a kivágott záró kártyát diffelje, ne az mp4-et; (c) dedup:
      ha egy slotot már lefed egy id-vel párosított sor, a régi ütköző sor essen ki.
- [x] **V5** Újrafuttatás → **NINCS PÁROSÍTVA: 0**, a 16 MC33-as ELLENŐRIZ lezárva.
- [x] **V6** VÉGREHAJTÁS — `scripts/apply-variant-actions.ts`, száraz futás, user jóváhagyás,
      majd éles írás: **35 átnevezve, 40 archiválva**.

### V1–V3 LESZÁLLÍTVA (2026-09-23). Amit a munka közben MÉRTÜNK

**A záró kocka nem elég őrszem nélkül.** Az első szabály (lépj hátra, amíg a kocka majdnem
egyszínű) az MC377-en elbukott: a klip utolsó négy másodperce **csupasz Erste logó kék mezőn**,
ami nem egyszínű, tehát átment a teszten — és négy kreatív üres kártyát kapott volna.
A javítás mért küszöb, nem tipp: a "festék-arány" (a domináns színtől távol eső pixelek aránya)
a 97 kártyán **4,3–5,1% a négy logókártyán és 26,0% a legszegényebb tartalmi kártyán** — a 15%
széles résben ül. Ha a teljes farok üres, a script végigpásztázza a klipet és a LEGKÉSŐBBI
tartalmas kockát veszi (MC377-nél a ~25%-nál lévőt).

**97 kártya → 31 design.** A panelszín-ujjlenyomat (RGB-távolság, 25-ös tűrés) csoportosít:
egy design méretváltozatai 10 egységen belül maradnak, két külön design 60+ egységre van.
Ez 97 helyett 50 tényleges olvasást jelentett, **bizonyítékkal**, nem feltételezéssel — és ahol
egy klaszterben ugyanaz a méret többször szerepelt (verziók), ott minden fájl külön el lett olvasva.

**A Babaváró-család: MC3 és MC33 UGYANAZ a négy design, két kamattal.**
MC33 = 0,49%-10,20%, betűk a/b/c/d. MC3 = 0,50%-10,18%, **mind a négy az `a` betű alatt**.
A panelszín keresztbe igazolja (`#4c6aac`, `#ce6680` pontosan egyezik). Két hiba egyszerre:
az MC3-ban négy külön kreatív ül egy betűn, az MC3↔MC33 pár pedig kamatfrissítés — vagyis
VERZIÓ —, csak épp két külön MC-szám alatt. A generátor ezt nem látja: MC-n belül dolgozik.

**Ugyanez MC386-on:** öt külön persona-design (borbély / varrónő / kötényes férfi / halas /
autószerelő), **karakterre azonos szöveggel**, mind az `a` betű alatt. A szövegtanú itt nulla
értékű — csak a kép választ el.

**MC35: verziólétra verziószám nélkül.** Három 1080x1080 fájl fut 9,01% / 9,04% / 9,14% THM-mel,
de csak az egyik visel `_n2` jelölést, a másik kettő csupasz `a`. (MC289 ezzel szemben helyesen
számoz: n3 = 8,98%, n4 = 8,92%.)

**MC180: fél-képernyős placement pár**, nem duplikátum — id15900 a BAL, id15901 a JOBB térfelén
hordozza ugyanazt a kreatívot, a másik fele fekete.

**Sortörés-normalizálás.** Ugyanaz a mondat a négyzetes kiírásban két sorba, a portréban négybe
törik. A tördelés elrendezés, nem tartalom, és a feldolgozás karakterre hasonlít — ezért a
leltárban a MONDATHATÁR a sortörés, a tipográfiai tördelés nem.

**Egy hiba, amit a saját scriptünk okozott:** a `_TARTALOM.txt`-et egy részfutás (`--mc 377`)
felülírta, így az index négy kreatívot állított a 97 helyett, és az első leltár-kiegészítés
ennek megfelelően 4 sort írt. Javítva: az index MOST összefésül, nem felülír. A tanulság a
szokásos — egy részhalmazon futó írás a teljes állapotot csonkította, csendben.

### V4–V5 LESZÁLLÍTVA (2026-09-23)

`gen-variant-actions.ts` három javítása, majd újrafuttatás. **1077 sor** (= pontosan annyi,
ahány kreatívnak van képolvasata), és a korábbi 974-es terv szétesett kategóriái helyett:

| teendő | volt | most |
|---|---|---|
| MARAD (külön kreatív) | 543 | 626 |
| MARAD | 322 | 357 |
| ÁTNEVEZ | 53 | 54 |
| ARCHIVÁL | 20 | 25 |
| ELLENŐRIZ | 16 | 15 |
| **NINCS PÁROSÍTVA** | **20** | **0** |

1. **id-név a `scanExport()`-ban.** A `(?:id(\d+)__)?` előtag opcionális, így a round1 nevek
   változatlanul mennek. A kontaktlapok maguktól kiesnek: a betű-csoport EGY karaktert illeszt,
   az `idosav` hat.
2. **Dedup — egy kreatív, egy sor.** Ugyanaz a fájl három körben is exportálva van (MC33: round1
   osztályozó mappa, round2 id-vel, round3 záró kártya), és három sor esetén a kreatív önmagával
   versenyzett volna a referencia-helyért. A győztes az, amit MÉRNI lehet: sharp által nyitható
   fájl > mp4, id-név > visszafejtett név. A párosítatlan sor pedig csak akkor marad a jelentésben,
   ha a slotját semmi nem fedi — ez oldotta fel a 20 NINCS PÁROSÍTVA sort.
3. **A hamis indoklás megszűnt.** Ha `sameWords` igaz, de nincs diff, a logika eddig a záró
   `else`-re esett és „nagy felületen tér el"-t írt **mérés nélkül**. Most külön ág: ELLENŐRIZ,
   és megnevezi az okot.

### A maradék 15 ELLENŐRIZ — megnéztem, és NEM tizenöt külön eset

Mind a 15 sor ugyanaz: MC97/99/101/103/115 × 160x600 / 468x120 / 970x90, és az `a` fájl **pontosan
1 pixellel nagyobb** az egyik irányban (161x600, 468x121, 970x91), mind a tizenötben azonos mintával
— tehát egyetlen renderelési job műterméke, nem tizenöt döntés.

A pixeltanú azért nem tud dönteni, mert a nagyobb render a design NYÚJTÁSA: minden vízszintes él
pixelek közé esik, és semmilyen egész eltolás nem rakja helyre. Mérve: vágás és ±2px keresés is
~26%-on hagyja az MC97 468x120 párt, miközben az azonos méretű testvére 2,7%-on ül. Átméretezés
rosszabb (32%).

**Szemrevételezve (MC97 468x120, MC97 970x90, MC101 160x600 — mindhárom alak, két MC):
azonos design, azonos szöveg, azonos THM.** Emberi ítélet: mind a 15 **ARCHIVÁL**.
A generátorban szándékosan ELLENŐRIZ marad — nem mértük, csak megnéztük.

### V6 LESZÁLLÍTVA (2026-09-23) — éles írás megtörtént

`scripts/apply-variant-actions.ts` (új). Száraz futás az alapértelmezett; `--apply` ír,
`--with-ellenoriz` veszi be a 15 ELLENŐRIZ sort (emberi döntés, ezért gépelni kell),
`--skip <id>` zár ki egy sort (a kizárás a parancsban látszik, nem szűrőben rejtve).

**Eredmény: 35 átnevezés, 40 archiválás, 18 kihagyva, 1 kizárva.** Ellenőrizve: az MC97
160x600/970x90 létra most `n1` = THM 14,3%, `n2` = 12,1% — azonos betű és méret alatt,
ami az egész szál célja volt. Írás előtt CSV-pillanatkép készült a 94 érintett sorról.

**Az átnevezés három mezőt visz együtt** — `file_name`, `mc_variant`, `family_key` —, mert a
`family_key` a fájlnév-tőből származik és TARTALMAZZA a betűt, a `promote.ts` pedig ezen
egyeztet prodlist-szállítandóval; elavulva a régi betűre mutatna. A `banner_version` CSAK ott
mozdul, ahol ma szinkronban van a fájlnévvel (a `Version` xlsx-oszlopból jön, UI-feltöltésnél
null — üres mezőbe számot írni adatkitalálás volna).

### Két dolog, amit csak a száraz futás mutatott meg

1. **Az 54 ÁTNEVEZ valójában 36.** Tizennyolc sor (MC330/331/332) már pontosan így hívta magát:
   a generátor a VISZONYT írja le („ez a fájl a referencia-betű n2-je"), és ezek már helyes
   néven érkeztek. Az apply ezeket kihagyja, nem „alkalmazza".
2. **Egy sor élesben csendben rontott volna.** MC130 `b_n5` → `a_…_n2`: az `a` család már tart
   n3-at és n4-et, tehát a LEGÚJABB fájl két régebbi alá került volna, és a `versionLadder` az
   n4-et adta volna a mátrixnak aktuálisként. Gyökérok: a generátor a verziószámot az exportált
   méretcsoportban látott THM-ekből indexeli, és nem tudja, mit tart már a célcsalád.
   **Állandó őrszem került az apply-ba:** átnevezés nem landolhat meglévő verzión vagy alatta,
   ugyanazzal a `versionFamilyKey`-jel, amit az app használ.

**Nyitva maradt — MC130 (id17830).** Három különböző kulcsszó-készlet fut egy MC alatt
(`SZK_fuggoagy`, `fuggoagy_videoAndColor`, `fuggoagy_fullVideoSurface`), és a 17829 neve törött
(`_1080x1080_1.mp4`, ezért üres a `file_dimensions` és a `family_key`; a 14980/14981 tárolt
`family_key`-e ráadásul `MC0`-t mond). Döntés kell rá, nem átnevezés.

**Nyitva maradt — cross-MC.** Az MC3↔MC33 (ugyanaz a négy Babaváró-design két kamattal) és az
MC386 (öt persona egy betűn) nem oldódik meg ettől: a generátor MC-n belül dolgozik.

**Közben, 15:47 UTC-kor valaki 18 kreatívot töltött fel az élő appon** (MC406, Társasház/
MediaMarkt). Az egyenleg ezzel jön ki pontosan: 3361 + 18 − 40 = 3339 élő.

## 2026-09-24 — Settings → API tab + `/publicshortcut` aláírt kép-URL (TERV, jóváhagyásra vár)

Két összefüggő szelet: egy API-dokumentációs tab a Settingsben, és benne a HMAC-titok
beállítása, amivel az agenteknek szánt widget aláírt publikus kép-linkeket tud gyártani.

### Mért kiindulás
- **96 `route.ts` az `/api` alatt + 5 publikus** (`/share`, `/mcp`) → 95 handler:
  40 GET, 37 POST, 11 DELETE, 5 PATCH, 2 PUT.
- **25 `withAdmin`, 47 `withSession`, 24 egyik wrappert sem használja.** Ez utóbbi a tab
  legértékesebb generált oszlopa — fejben senki nem tartja.
- **Csak 4 route használ zod-ot**, tehát az input-séma NEM introspektálható (a McpTab azért
  tudja, mert a `mcp.ts` zod-dal regisztrál). A „mit fogad / mit ad" ezért kézi, egy soros,
  **egyetlen registry-fájlban** — nem 95 helyre szórva.
- `previewUrl()` (`src/lib/mcp.ts:295`) ma `${origin}/api/previews/${id}?v=…` alakú, aláíratlan
  publikus URL-t ad ki a `list_mc` / `get_mc` / `show_mc_previews` kimenetében.
- A kreatív-azonosítás **nem** mehet `MC+variáns+méret`-en: 2279 hármasból 616 (27%) többértelmű
  (`MC311a`@480x480 = 7 kép). A `creatives.id` egyedi — ugyanaz a lecke, mint az
  `export-creatives-for-reading.ts` 2. körében.

### A) Settings → API tab  (user: teljes lista, generált + 1 soros leírások)

- [x] **A1** `GET /api/routes` (`withAdmin`, a `/api/schema` és `/api/mcp/tools` mintájára):
      bejárja az `src/app/api` (+ `share`, `mcp`) route-fákat, és visszaadja útvonalanként a
      metódusokat, a dinamikus szegmenseket, és az auth-wrappert (`withAdmin` / `withSession` /
      egyik sem). A wrapper a forrásból olvasva, nem kézzel karbantartva.
- [x] **A2** `src/lib/api-docs.ts` — **egyetlen** registry: útvonal → egy soros leírás + csoport.
      Ami nincs benne, az „—" leírással, de **ott van a listában** (a generált lista a teljesség
      garanciája, a próza csak dísz rajta).
- [x] **A3** `settings/_api/ApiTab.tsx` — a `McpTab` design-tokenjeivel (`mcp-tab__section` →
      `api-tab__section`, `__section-title`, `__group-title`, `text-xs uppercase tracking-wide`
      fejlécek, `empty-state`, `error-alert`). Csoportosítás + kereső. A 24 wrapper nélküli
      útvonal kiemelve figyelmeztetésként.
- [x] **A4** `SettingsView.tsx`: `TABS`-ba `{ key: "api", label: "API" }` az `mcp` mellé.
- [x] **A5** `tasks/component-inventory.md` — az `api-tab__*` blokknevek felvétele.

### B) `/publicshortcut` — aláírt, agent által generálható kép-URL  (user: B változat)

**User-döntés 2026-09-24 (2):** a régi `/api/previews/[id]` se maradjon aláíratlanul publikus, és
**nincs `DRAFT`/`PREVIEW` kapu** — épp az a lényeg, hogy az ügyfél-agent aláírt linkeken tudja
követni, hogyan haladnak a draftok. Az aláírás VÁLTJA KI a státusz-kaput, nem kiegészíti.

A token **aláírás, nem titkosítás**: az id nyíltan látszik, mellette a pecsét.

```
<kind><id>.<hmac16>      kind: m = message (DCO preview), c = creative (agentic fájl)
hmac16 = HMAC-SHA256(titok, "<kind><id>") hex első 16 karaktere
```

| | |
|---|---|
| `GET /publicshortcut/m<id>.<sig>/<size>` | a DCO preview PNG (`300x250`, `970x250`, `640x360`, `300x600`) |
| `GET /publicshortcut/c<id>.<sig>` | az agentic kreatív fájlja, ahogy van (png/jpg/mp4, range-gel) |
| `…?html=1` | csupasz HTML lap, a kép a bal felső sarokban, pontos px méretre igazítva |
| `…?v=<updated_at>` | a mai cache-buster, aláíráson kívül, változatlanul |

Rossz aláírás / archivált sor / ismeretlen méret / nincs ilyen preview → **404**, megkülönböztetés
nélkül. Státusz **nem** számít: `ACTIVE`, `INACTIVE`, `DEAD`, `DRAFT`, `PREVIEW` mind kiszolgálva.

**A címzés `message_id` + méret, nem `preview_id`** — mert az agent a `list_mc`-ből az üzenet
id-jét kapja, abból ki tudja számolni a linket; a `message_previews.id` belső marad.

- [x] **B1** `src/lib/public-shortcut.ts` — `signToken(kind, id)` / `verifyToken(token)`.
      Titok: `system_config.public_shortcut_secret` (deploy-szintű, mint a route maga).
      Nincs titok → minden kérés 404 (fail-closed). Fájlba nem kerül: a boxon hat app-user
      osztozik a filesystemen.
- [x] **B2** `src/app/publicshortcut/[...parts]/route.ts` — a `/share/[id]/file/[fileId]` mintájára:
      publikus route az `/api`-n kívül, `readFileBytes`/`readFileStream`, range-támogatás videóra,
      kliens-scope `activeClientId()`.
- [x] **B3** `?html=1` — `margin:0`, `<img>` bal felső sarokban, pontos px méret.
- [x] **B4** **Titok-kezelés a Settings → API tabon**: felfedés/rotálás az `mcp_tokens` `reveal`
      mintáját követve (admin-only, külön kattintás). A rotálás figyelmeztet: **minden korábban
      kiadott link azonnal érvénytelen**.
- [x] **B5** **`/api/previews/[id]` már nem publikus → `withSession`.** Az appon belüli
      `<img src="/api/previews/…">` (MessageEditor) a session-sütivel megy tovább, tehát a titok
      **soha nem kerül a böngészőbe**. Aki kívülről néz, az a `/publicshortcut` aláírt URL-t kapja.
- [x] **B6** **A link-kibocsátók átírása.** Ma négy helyen készül preview-URL:
      - `previewUrl()` (`src/lib/mcp.ts:295`) → aláírt `/publicshortcut/m<id>.<sig>/<size>`.
        Ezzel egy csapásra a `list_mc`, a `get_mc`, a `preview_generate` és a `show_mc_previews`
        widget is aláírt linket ad — **innen ismerték eddig az agentek a preview-linkeket**.
      - `/share/[id]/previews` (a nyilvános share-nézegető, nincs sütije) → `previewId` helyett
        kész aláírt `url` a válaszban; `ShareGallery.tsx:308` azt használja.
      - `MessageEditor.tsx:2459` → marad `/api/previews/<id>`, most már session mögött.
      - `scripts/gen-mc-export.ts:162` → helyben aláír (DB-hozzáférése van a titokhoz).
      - Új: `c<creative_id>` irány az agentic fájlokra, hogy azokra is legyen agent-linkje.
- [x] **B7** Vitest: aláírás-kör, rossz aláírás → 404, archivált → 404, `DRAFT` → **200**,
      ismeretlen méret → 404, hiányzó titok → 404, `/api/previews/[id]` süti nélkül → 401.
- [x] **B8 (a DCO URL-ek kiadása ELŐTT)** A 8176 tárolt preview-ból **1416 elavult**
      (`message_version` ≠ `messages.version`). Újragenerálás `gen:previews`-zel, **prod buildben** —
      `next dev` alatt néma törött képeket ír (memória: `project_preview_gen_needs_prod_build`).

**Törő változás, tudatosan:** minden eddig kiadott `/api/previews/<id>` link megszűnik publikusan
működni. A user ezt választotta, amikor az aláírást kérte a régi útvonalra is.

### Amit tudatosan nem csinálunk
- Nincs visszavonás egyetlen URL-re; csak a titok rotálható, az meg az összeset megöli.
- Nincs `MC+variáns+méret` címzés (27% többértelmű). Ha kell ilyen belépő, az külön feloldó
  végpont legyen, ami a jelölteket **listázza**, nem választ közülük.
- Nem írunk kézi input/output dokumentációt 95 handlerhez — csak egysorosat, egy helyen.

### LESZÁLLÍTVA 2026-09-24 — `A1`–`A5`, `B1`–`B8`

- **`/publicshortcut`** él: aláírt `m<message_id>.<sig>/<size>` és `c<creative_id>.<sig>`, `?html=1`
  csupasz lappal. Prod buildben, éles DB-vel és object store-ral végigmérve: valid → 200 PNG
  300×250, elrontott aláírás → 404, nem generált méret → 404, régi `/api/previews/6390` → **401**.
- **`/api/previews/[id]` → `withSession`.** Nem aláírást kapott: az appon belüli `<img src>` a
  sütivel megy, így a titok soha nem kerül böngészőbe. Kívülről az aláírt URL az egyetlen út.
- **Nyolc link-kibocsátó** állt át (`list_mc`, `mc_get`, `preview_generate`, `show_mc_previews`,
  `draft_get`, `draft_status`, `show_draft_previews`, `gen-mc-export`), plusz a share-nézegető
  index-route-ja, ami most kész aláírt `url`-t ad — a nézegetőnek nincs sütije és titka sem.
- **Settings → API tab**: a lista és az auth-oszlop generált (`/api/routes` → `src/lib/api-docs.ts`),
  103 kézi egysoros leírás egy helyen. A HMAC-titok kezelése (maszk / reveal / rotate) itt ül.
- **Korrekció a korábbi méréshez:** nem 24 útvonal van auth-wrapper nélkül, hanem **10**, és mind
  szándékos. A naiv grep nem látta az `entity-route.ts` factory-jait, amik belül `withSession`-t
  használnak. Valós kép: 25 admin, 65 session, 2 bearer/signed, 10 nyitott.
- **`B8`:** 1568 preview újralőve (1416 elavult + 152 sosem volt), **0 hiba**, elavult preview most
  **0**. Külön `.next-preview-build` buildből, a 6011-es porton — a futó dev szerver érintetlen.
- **`docs/mc-export.xlsx` újragenerálva**, két lappal: `MC export` (222 MC, 0 preview nélkül) és az
  új `Creative export` (3339 élő kreatív, ebből **2302 még olvasás nélkül**), aláírt linkekkel és az
  `image_text` / `image_description` oszlopokkal.

**A Drive-fájl frissítve** (`1XhcbKyFCzM8xg0yo83g4pknayIfwO3OT`, 2026-09-24 14:10 UTC, 3 894 336 B
— a lokális fájllal bájtra egyező). Ugyanaz az id, mappa és megosztás; a régi verzió a *Verziók
kezelése* alatt maradt. A Drive MCP nem tud meglévő fájlt felülírni, a „Verziók kezelése" gombja
pedig natív fájlválasztót nyit, amit nem lehet vezérelni — a járható út a **mappára ejtés** volt
(`file_upload` egy injektált inputra → valódi `File` → szintetikus `drop` a fájllistára), amire a
Drive felajánlja az „Upload options → Replace existing file"-t. Ez tartja meg a linket.

**Amit a régi fájlban találtam:** két kézzel hozzáadott oszlop (`preview` + egy névtelen) kép-
képletekkel, amik a régi `/api/previews/<id>` URL-ekre mutattak — azok most 401-et adnak, tehát már
nem rendereltek volna. Az új verzióban nincsenek benne. Ha kell inline kép-oszlop, azt a scriptnek
kell kiírnia, a mostani aláírt linkekkel.

**Verzió:** `6.114.0` → `6.115.0`, `CHANGELOG.md` megírva.

### DEPLOYOLVA 6.115.0 — mindkét tenant (2026-09-24)

Commit `44294b2` (három szeletben: `aa6c72a` aláírt URL-ek · `a7fc54c` API tab · `44294b2` export +
bump). Séma-migráció **nincs** — a titok a már létező `system_config`-ban ül.

`mm6-deploy erste` és `mm6-deploy telekom`, mindkettő **„up after 1s behind the page"**. Box
`package.json` mindkét tenantnál **6.115.0**, disk 9,2G szabad, `mm6-erste-error.log` a restart óta
üres.

**Élő ellenőrzés (`erste.messagingmatrix.ai`):**

| | |
|---|---|
| `/login` | 200 |
| `/matrix`, `/mcp`, `/api/previews/6390` | 307 · 401 · **401** |
| `…/publicshortcut/m31385.4a6371c2752c6b40/300x250` | **200**, PNG 300×250, 82 KB |
| ugyanaz `c<id>` kreatív-tokennel | **200**, JPEG 464 KB |
| aláírás első / utolsó karaktere átírva | 404 · 404 |
| más message-id ugyanazzal az aláírással | 404 |
| `c` típus `m` id-vel | 404 |
| nem generált méret (`160x600`) | 404 |
| `?html=1` | 200, `text/html` |

**Egy hamis riasztás, amit magamnak kell felírni:** az első „aláírás elrontva" próbám 200-at adott —
a `sed` az utolsó karaktert `0`-ra írta, az pedig **már `0` volt**, tehát ugyanazt az URL-t kértem le.
A route rendben volt; a teszt nem. Nem elég elrontani akarni a bemenetet, ellenőrizni kell, hogy
tényleg más lett-e.

### FIX — promote után visszajövő draftok (MC407, 2026-09-24)

**Tünet:** az MC407 a/b/c bulk promote után a/b/c újra megjelent draftként a falon, és a három élő
DISP cella `image1`-e üres maradt.

**Gyökérok:** a bulk route minden betű után futtatja a `placeAgenticSiblings`-t. Amikor `a` a helyére
került, `b` és `c` még nyitott draft volt és tartotta a számot, `a`-nak pedig már nem volt saját
draftja — így az `ensureAgenticMc` „a brief által meg nem nevezett betűnek" nézte és **újradraftolta**
(`draft-open`, tehát a fájl sem került a cellába). Ugyanez `b`-re és `c`-re.

**Javítás** (`src/lib/entities/promote.ts`, `ensureAgenticMc`): a kapu külön kezeli a három esetet —
saját nyitott draft → vár (MC404/405 változatlan); **már élő cella az Agentic tengelyen** → átmegy a
rendes elhelyezésre (a topic az élő testvértől jön, így az MC406-os eset nem jöhet vissza); sem draft,
sem cella → új draft-variáns. Teszt: `creative-mirror.test.ts` „a bulk promote leaves no draft
behind…" — a javítás nélkül bukik, vele zöld. Teljes suite 1032/1032, `tsc` tiszta.

**Élő adat rendbetéve** (`scripts/fix-mc407-redrafts.ts`, auditálva): 36118–36120 archiválva; a
sibling pass újrafuttatva → a/b/c DISP cellák `image1`-et kaptak, és létrejött a/b/c SOC cella
(36121–36123, 1080x1080) ugyanabban a topicban.

- [x] commit + deploy (erste, telekom) — 6.115.1
