# bitkurus-ledger-verifier

Hızlı, bağımsız **BitKuruş defter doğrulayıcı** — Laravel veya node kurulumu gerektirmez.  
Herkes federasyon düğümlerini indirip denetleyebilir.

## Ne doğrular?

| Kontrol | Açıklama |
|---------|----------|
| `canonical_hash` | Export içeriğinin SHA-256 özeti (dört bölüm: events, parents, tokens, transactions) |
| `meta.state_hash` | Aktif token kümesi ile uyum |
| İmza | Her `committed` işlemde Ed25519 (canonical signing payload) |
| Şekil | `transfer` 1→1, `split` 1→2+, `merge` N→1 |
| Değer | `sum(girdiler) = sum(çıktılar) + fee` |

## Gereksinim

- **Node.js 18+** (yerleşik `fetch` ve Ed25519)

## Kurulum

```bash
cd tools/bitkurus-ledger-verifier
# global (isteğe bağlı)
npm link

# veya doğrudan
node bin/bitkurus-verify.js audit https://bitkurus.org/api/ledger/export
```

GitHub’dan klon:

```bash
git clone https://github.com/sencerhan/bitkurus-ledger-verifier.git
cd bitkurus-ledger-verifier
node bin/bitkurus-verify.js compare \
  https://bitkurus.org/api/ledger/export \
  https://bitkurush.org/api/ledger/export
```

## Komutlar

### `audit` — tam denetim

```bash
bitkurus-verify audit https://bitkurus.org/api/ledger/export
bitkurus-verify audit ./export.json --no-signatures   # sadece hash (daha hızlı)
bitkurus-verify audit export.json --json
```

Çıkış kodu: `0` = geçti, `1` = hata bulundu.

### `compare` — düğümler mutabık mı?

```bash
bitkurus-verify compare \
  https://bitkurus.org/api/ledger/export \
  https://bitlira.tr/api/ledger/export
```

Tüm kaynaklarda `canonical_hash` aynıysa **CONVERGED** yazdırır.

### `hash` — sadece hash hesapla

```bash
bitkurus-verify hash export.json
```

### `fetch` — export indir

```bash
bitkurus-verify fetch https://bitkurus.org -o ledger.json
```

## Örnek çıktı (canlı ağ)

```text
$ bitkurus-verify compare https://bitkurus.org/api/ledger/export https://bitkurush.org/api/ledger/export
DIVERGED — hashes differ
```

Bu, aracın çalıştığını gösterir: düğümler senkron değilse kamuya açık olarak görünür. Tek düğüm denetimi için yalnızca `audit` yeterlidir.

## Tipik denetim akışı

1. İki veya daha fazla düğümden export alın (`compare` veya `fetch`).
2. Her dosyada `audit` çalıştırın (imza + ekonomi kuralları).
3. `canonical_hash` farklıysa → federasyon ayrışmış; operatör uyarısı gerekir.
4. Hash aynı ama `audit` fail → veri bütünlüğü veya imza sorunu (daha nadir).

## Performans

- Tek dosya: genelde **saniyenin altında** (ağ gecikmesi hariç).
- `--no-signatures`: büyük defterlerde imza doğrulamasını atlar.
- Bellek: tüm JSON belleğe alınır (çok büyük defterler için ileride streaming eklenebilir).

## Protokol referansı

- Export format: `GET /api/ledger/export` — `app/Http/Controllers/Api/LedgerController.php`
- Canonical JSON: `App\Services\Crypto\CanonicalJson` / `public/bitkurus/wallet.js`
- Web doküman: [bitkurus.org/docs](https://bitkurus.org/docs)

## Test

```bash
npm test
```

## Lisans

MIT — BitKuruş projesi ile aynı repo.

## İlgili projeler

- [notarynode](https://github.com/sencerhan/notarynode) — BitKuruş node ve web arayüzü
- [bitkurus.org/docs](https://bitkurus.org/docs) — cüzdan entegrasyonu
