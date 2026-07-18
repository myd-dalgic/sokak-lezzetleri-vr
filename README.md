# 🌭 Sokak Lezzetleri Arabası (VR)

Küçük bir köfte-ekmek standı yönettiğin basit WebXR simülasyonu. Three.js ile yazıldı, Meta Quest 3 ve masaüstü tarayıcıda (mouse ile test) çalışır.

## Oynanış
- Ekranın sağ üstünde güncel **sipariş** görünür (örn: "Köfte-Ekmek: Ekmek, Köfte, Domates").
- **Kırmızı halkadaki** köfte paketinden çiğ köfte al (paket tükenmez, her alışta yenisi belirir).
- Köfteyi **ızgaraya** koy — zamanla **pişer**, uzun bırakılırsa **yanar** (rengi kararır).
- Ekmeği al, pişmiş köfteyi ekmeğin üzerine bırak, istenirse domates/soğan ekle.
- Hazırlanan ekmeği (tabağı) tezgahın solundaki **yeşil servis halkasına** bırak → sipariş kontrol edilir.
- Doğru, çiğ olmayan ve yanık olmayan siparişler için para kazanılır (üstte gösterilir).

## Sos ve Temizlik
- Tezgahın solundaki **ketçap (kırmızı)** ve **mayonez (krem)** şişelerini tutup ekmeğin üzerine götür, **Boşluk** tuşuna (VR'de grip/sıkma tuşuna) basarak sık.
- Her sıkışta tezgaha da azıcık sos sıçrar ve **leke** birikir.
- Sağdaki **mavi su şişesini** tutup lekenin üzerinde sık → leke ıslanır (parlar).
- Ardından **bezi** tutup ıslak lekenin üzerinden geçir → leke temizlenir. Kuru lekeyi bez tek başına temizlemez, önce ıslatman gerekir.

## Hissiyat / Dinamik İyileştirmeler
- **Ses efektleri**: tutma, bırakma, sıkma, cızırtı, "pişti" sesi, yanık uyarısı, servis başarı/başarısız, bez silme sesi (hepsi kod içinde üretiliyor, dosya yok).
- **Vurgu (highlight)**: fareyle veya VR kontrolcüsüyle bir nesnenin üzerine gelince hafif mavi parlama ile "bunu tutabilirsin" ipucu verir.
- **Yumuşak sürükleme**: fare ile taşırken nesne hedefe doğru yumuşakça süzülür (ani zıplama yok).
- **Sıkma animasyonu**: şişeyi sıkınca kısa bir "sıkışma" (squish) animasyonu oynar.
- **VR titreşimi**: nesne tutulduğunda ve sıkıldığında kontrolcü hafifçe titrer (tarayıcı/cihaz destekliyorsa).
- **Pişirme göstergesi**: ızgaradaki köftenin üzerinde durumu gösteren küçük bir ışık — turuncu (pişiyor), yeşil yanıp sönen (hazır), kırmızı (yanmış).

## Kontroller
- **Masaüstü:** Fare ile nesneye tıkla-sürükle-bırak.
- **VR (Meta Quest 3):** Tetik (trigger) ile nesneye yaklaşıp tut/bırak.

## Neden basit tutuldu?
- Sadece birkaç nesne arasında **mesafe/collision kontrolü** var (karmaşık fizik motoru yok).
- Karakter animasyonu veya yapay zekaya ihtiyaç yok — müşteri "sipariş metni" olarak simüle edildi.
- Tüm mantık tek bir `main.js` dosyasında, üç.js primitive geometrilerinden (capsule, cylinder, torus) oluşan basit modellerle.

## GitHub Pages ile Yayınlama (CLI'siz)
1. GitHub'da yeni bir repo oluştur (örn. `sokak-lezzetleri-vr`).
2. Bu klasördeki `index.html`, `main.js`, **`README.md`** dosyalarını VE **`assets/` klasörünü (Tongs.glb + Barbeque.glb içinde)** repoya **drag & drop** ile yükle (Add file → Upload files). `assets` klasörünü de sürükleyip bırakman yeterli, GitHub alt klasörü otomatik oluşturur.
3. Repo **Settings → Pages** kısmından `main` branch / root klasörü seç, Save.
4. Birkaç dakika sonra `https://KULLANICI_ADIN.github.io/sokak-lezzetleri-vr/` adresinde canlı olur.
5. Meta Quest 3 tarayıcısından bu linki aç → "VR'a Gir" butonuna bas.

⚠️ **Önemli:** `assets/Tongs.glb` ve `assets/Barbeque.glb` dosyaları repoda olmazsa ızgara ve maşa görünmez (sadece ışık/duman kalır), konsolda "yüklenemedi" uyarısı çıkar — oyun çökmez, sadece o iki model eksik kalır.

## Gerçek 3D Modeller (Tongs.glb / Barbeque.glb / Glove.glb)
- **Barbeque.glb**: Eski kutu-ızgara yerine gerçek model kullanılıyor. Sahneye asenkron yükleniyor, otomatik ölçeklenip ızgara noktasına (`grillCenter`) oturtuluyor. Konumu biraz kaymış görünürse `main.js` içinde `loadBarbeque()` fonksiyonundaki `model.position.y += 1.0` satırındaki sayıyı oynayarak ince ayar yapabilirsin.
- **Tongs.glb**: Gerçek **açılıp kapanan maşa**. Model içindeki parçalar isimlerine göre (`Box006`/`Box007` = bir kol, `Box008`/`Box009` = diğer kol, `Box010`/`Cylinder002` = pim/rivet) otomatik olarak tespit edilip pim noktasından menteşeli iki gruba ayrılıyor.
  - **Açıkken** (bırakılmış): kollar rahat pozisyonda, hiçbir şeyi tutmaz.
  - **Kapatınca** (Boşluk tuşu basılı / VR grip basılı): kollar birbirine yaklaşır, yakındaki (ızgaradaki) bir köfteyi yakalar ve maşayla taşınır.
  - **Tekrar açınca**: köfte, o an neredeyse oraya bırakılır (ızgaradaysa pişmeye devam eder, ekmeğin üstündeyse sandviçe eklenir).
  - Kolların açılma yönü ters görünürse `main.js` içindeki `TONG_CLOSE_ANGLE` sabitinin işaretini (+/-) değiştirmen yeterli.
  - Model içindeki parça isimleri beklenenden farklı çıkarsa (ör. Blender'da yeniden export edilirse), kod otomatik olarak "tek parça sabit obje" moduna düşer — oyun kırılmaz, sadece açılıp kapanma animasyonu olmaz.
- **Glove.glb**: İki adet **eldiven** (sol + sağ), VR kontrolcülerine otomatik takılır. Her parmak (`Index`/`Middle`/`Ring`/`Pinky`/`Thumb`) pivot node olarak ayrılmış — bir şey tuttuğunda ya da grip'e bastığında parmaklar **kıvrılır** (yumruk pozu). Görünüm: beyaz lateks eldiven + mor manşet. Model yüklenemezse eldivenler görünmez ama oyun çalışmaya devam eder.

## Genişletme Fikirleri
- Zamanlayıcılı müşteri kuyruğu (sabırsız müşteri süresi dolarsa siparişi iptal eder) — ✅ eklendi (sipariş zaman çubuğu + zil).
- Ses efektleri (ızgara cızırtısı, sipariş zili) — ✅ eklendi.
- Farklı ürünler: sosisli sandviç, ayran, patates.
- Günlük hedef / seviye sistemi.
- Diğer aletler için de gerçek 3D modeller (ekmek, bıçak, tabak vs.).
