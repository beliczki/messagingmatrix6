# Kreatív-manifest — utasítás a Codexnek a leadáshoz

A szerződés a `creative-manifest.ts` zod-sémája (`creativeManifestSchema`); ez a fájl a rövid utasítás hozzá. Amikor a leadást gyártod, ezt add a leadás-prompthoz, vagy mutass erre a fájlra.

## Az utasítás

> A leadott fájlok mellé írj egy `manifest.json`-t a leadás gyökerébe. Minden MC + variáns kap egy csoportot. Egy csoportba azok a fájlok kerülnek, amelyeken ugyanaz a szöveg áll (jellemzően ugyanannak a verziónak a méretei). Ha egy méreten más a szöveg (pl. plusz egy `Érdekel` gomb), az külön csoport.
>
> - `image_text`: a képen álló szöveg betűhíven, sorokra tördelve (`\n`), a logóval (`ERSTE`), a THM-mel és a gombfelirattal együtt. Ha nincs szöveg: `Nincs szöveg a képen.`
> - `image_description`: egy-két mondat arról, mi látszik a képen (szereplő, helyszín, tárgyak, elrendezés).
> - `copy_keyword`: a headline és a copy kulcsszavai.
> - `visual_keyword`: a vizuális leírás kulcsszavai.
> - Kulcsszó-forma: 3–6 kulcsszó, kisbetűvel, magyarul, vesszővel elválasztva, pl. `személyi kölcsön, fix kamat, karrierváltás`.
> - `files`: a fájlnevek pontosan úgy, ahogy feltöltésre kerülnek (kiterjesztéssel). Egy fájl csak egy csoportban szerepelhet.
> - Más kulcsot ne írj; a betöltő az ismeretlen kulcsot is elutasítja.

```json
{
  "version": 1,
  "client": "erste",
  "source": "codex",
  "groups": [
    {
      "mc": 101,
      "variant": "c",
      "image_text": "ERSTE\nSzemélyi kölcsön\nTHM 8,92%",
      "image_description": "Szemüveges férfi laptoppal egy kávézóban, jobbra a szöveg.",
      "copy_keyword": "személyi kölcsön, fix kamat, karrierváltás",
      "visual_keyword": "férfi, kávézó, szemüveg, laptop",
      "files": [
        "ERSTE_SZK_MC101_c_karrier_n1_1080x1080.png",
        "ERSTE_SZK_MC101_c_karrier_n1_300x250.png"
      ]
    }
  ]
}
```

## Mi történik vele

`scripts/import-creative-manifest.ts <manifest.json> [--client erste] [--dry]` tölti be, előbb mindig `--dry`-jal.

- Párosítás a pontos `file_name`-mel, a kliens aktív kreatívjai között. Ha nincs találat, ha több is van, vagy ha a kreatív MC-je vagy variánsa más, mint a csoporté, a betöltő jelzi, és nem ír.
- Csak üres mezőt tölt. A már kitöltött `image_text`, `image_description`, `copy_keyword` és `visual_keyword` marad. A régi sorokon a `visual_keyword` fájlnév-szelet (pl. `BeErste3Q2_personas`), azt nem írja felül.
- Ahol a szöveget vagy a leírást ez tölti, ott `image_read_model = codex-manifest`: a szöveget a leadó adta meg, nem a képről olvasták le.
- Az éles futás egy tranzakció, minden írás auditált. A manifest mellé rollback-listát hagy (`<manifest>.import-<kezdés>.id-lista.txt`, vesszővel elválasztott id-k).
