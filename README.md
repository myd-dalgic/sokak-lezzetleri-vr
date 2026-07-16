# 🌭 Sokak Lezzetleri Arabası (VR)

Küçük bir köfte-ekmek standı yönettiğin basit WebXR simülasyonu. Three.js ile yazıldı, Meta Quest 3 ve masaüstü tarayıcıda (mouse ile test) çalışır.

## Oynanış
- Ekranın sağ üstünde güncel **sipariş** görünür (örn: "Köfte-Ekmek: Ekmek, Köfte, Domates").
- Izgaradaki köfteler zamanla **pişer**, uzun bırakılırsa **yanar** (rengi kararır).
- Ekmeği al, ızgaradan köfteyi çekip ekmeğin üzerine bırak, istenirse domates/soğan ekle.
- Hazırlanan ekmeği (tabağı) tezgahın solundaki **yeşil servis halkasına** bırak → sipariş kontrol edilir.
- Doğru ve yanık olmayan siparişler için para kazanılır (üstte gösterilir).

## Kontroller
- **Masaüstü:** Fare ile nesneye tıkla-sürükle-bırak.
- **VR (Meta Quest 3):** Tetik (trigger) ile nesneye yaklaşıp tut/bırak.

## Neden basit tutuldu?
- Sadece birkaç nesne arasında **mesafe/collision kontrolü** var (karmaşık fizik motoru yok).
- Karakter animasyonu veya yapay zekaya ihtiyaç yok — müşteri "sipariş metni" olarak simüle edildi.
- Tüm mantık tek bir `main.js` dosyasında, üç.js primitive geometrilerinden (capsule, cylinder, torus) oluşan basit modellerle.

## GitHub Pages ile Yayınlama (CLI'siz)
1. GitHub'da yeni bir repo oluştur (örn. `sokak-lezzetleri-vr`).
2. Bu klasördeki `index.html` ve `main.js` dosyalarını repoya **drag & drop** ile yükle (Add file → Upload files).
3. Repo **Settings → Pages** kısmından `main` branch / root klasörü seç, Save.
4. Birkaç dakika sonra `https://KULLANICI_ADIN.github.io/sokak-lezzetleri-vr/` adresinde canlı olur.
5. Meta Quest 3 tarayıcısından bu linki aç → "VR'a Gir" butonuna bas.

## Genişletme Fikirleri
- Zamanlayıcılı müşteri kuyruğu (sabırsız müşteri süresi dolarsa siparişi iptal eder).
- Ses efektleri (ızgara cızırtısı, sipariş zili).
- Farklı ürünler: sosisli sandviç, ayran, patates.
- Günlük hedef / seviye sistemi.
