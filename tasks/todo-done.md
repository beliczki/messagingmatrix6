# MessagingMatrix v6 — kész

Kész, élesben lévő munka és lezárt vagy felülírt tervek, szó szerint áthelyezve a `todo.md`-ből (2026-11-23).
A fejlécek státusza (pl. „TERV, Robi jóváhagyására vár”) a megírás napjáé, nem a mai állapot.
Újabb kész szakasz a fájl tetejére kerül. Lásd még: `todo.md` (aktuális), `todo-archive.md` (a 2026-11-11 előtti történet).

## Lezárt roadmap-tételek (a `todo.md` NOW és NEXT részéből, áthelyezve 2026-11-23)

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

### M12 — Mátrix szűrő-pillek: kijelölt érték a pillben + product tag a sor/oszlop-fejléceken (user, 2026-09-10)
Apróságok, screenshotból (`/matrix`, Product + Status `multi-pill`):
- [x] **M12.1 (✅ KÉSZ, 6.83.0, 2026-09-10)** 1–2 kijelölésnél a `multi-pill__badge` a **kijelölt értékeket** írja ki (`HK, SZK`), 3+-nál marad a szám (tooltipben az értékek). Nem prop, hanem **alapviselkedés** minden `MultiPill`-en (Product, Status, Size, Platform, Type, DimensionGrid) — egy `describeSelection()` dönt, nincs call-site logika. Sorrend az **opció-lista** szerint, nem a Set (=klikk-)sorrend szerint; az opciók közül eltűnt, de kijelölt érték a végére kerül és **számít** (perzisztált szűrő, ami tényleg rejt sorokat). 6 unit teszt.
- [x] **M12.2 (✅ KÉSZ, 6.88.0, 2026-09-12 — a D6-ban)** Ha **több product** van kijelölve, az **audience oszlop-fejléc** és a **topic sor-fejléc** elejére (a név elé) **product tag** kerül, hogy látsszon melyik termékhez tartozik. Vizuál = a draft-kártya `tag-chip drafts-tile__product` pillje (sötét `bg-slate-800 text-white`, `text-[10px]`) — reuse, ne új család. **Minden density-ben ott legyen, a dense-ben is.** Egy product kijelölésnél (vagy szűrő nélkül, ha egy termék látszik) nem kell.

### ~~D — Design tab kör: capsule · fontok · ikonkészlet · cobrand · navigáció~~ — **✅ LESZÁLLÍTVA (6.88.0, 2026-09-12)** — törzs: `todo-archive.md` „Archivált 2026-11-22” A)



### ~~D6–D8 — a második kör (user, 2026-09-12): fejléc-product-tag · navigáció + brand-hely · mátrix Type-szűrő~~ — **✅ D6 + D7 KÉSZ, D8 ELVETVE** — törzs: `todo-archive.md` „Archivált 2026-11-22” A)


### ~~D8 — Mátrix „Type" szűrő a Creative Library mintájára~~ — **ELVETVE (user, 2026-09-12: „Q3-at dobjuk el")** — törzs: `todo-archive.md` „Archivált 2026-11-22” A)



### ~~P — Preview-generálás a Creative Library jobb toolbarjából~~ — **✅ KÉSZ (6.87.0, 2026-09-12)** — törzs: `todo-archive.md` „Archivált 2026-11-22” A)




### ~~M1 — Matrix „Color by"~~ — **KIVEZETVE (user, 2026-09-10)** — törzs: `todo-archive.md` „Archivált 2026-11-22” A)

### M7 — Custom-CSS beszúró chipek az MC-editorban — **✅ KÉSZ (6.83.0, 2026-09-10)** — törzs: `todo-archive.md` „Archivált 2026-11-22” A) (a Classes-sor összecsukásának kis ötlete is ott)

### ~~M8 — Creative Library size filter csoportosított dropdown~~ — **KIVEZETVE (user, 2026-09-10)** — törzs: `todo-archive.md` „Archivált 2026-11-22” A)

### ~~MCP token-scope #3: `draft`~~ — **✅ KÉSZ (6.84.0, 2026-09-12)** — törzs: `todo-archive.md` „Archivált 2026-11-22” A) (a nyitott `scope`-döntés: TECH-ADÓSSÁG)

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

