# Kademeli Şaft Balans Hesabı

Kademeli (montaj adımlı) şaft / rotor balansı için **ISO 21940-11** tolerans hesabı yapan,
rotor tipini **otomatik tespit eden** ve her proses için **tam 1 sayfalık PDF raporu** üreten
statik web uygulaması. Sunucu, veri tabanı veya derleme adımı gerektirmez; tüm hesap,
görselleştirme ve PDF üretimi tarayıcıda yapılır.

## Yayınlama (GitHub Pages)

1. Depo ayarlarında **Settings → Pages → Build and deployment → Deploy from a branch** seçin.
2. Dalı ve kök klasörü (`/ (root)`) seçin. `index.html` kökte olduğu için ek ayar gerekmez.

Yerelde denemek için herhangi bir statik sunucu yeterlidir:

```bash
python3 -m http.server 8000   # → http://localhost:8000
```

(`index.html` doğrudan dosya olarak da açılabilir; tüm görseller ve fontlar JS içine gömülüdür.)

## Kullanım

| Sekme | İçerik |
|---|---|
| **Rotor Tanımı** | Rapor bilgileri, genel hız / G parametreleri, parçalar (ad, kütle *m*, ağırlık merkezi *x*), her parçanın balans noktaları (*x*, *r*), yatak bölgeleri (*x*) ve canlı şema |
| **Balans Prosesleri** | Montaj adımları. Her adım için parçalar, 2 referans yatak, 1 / 2 düzlem ve düzeltme noktaları seçilir |

Her proses kartı iki katmanlıdır:

* **Operatör paneli (ilk bakış):** otomatik rotor tipi + temsil görseli, tespit gerekçesi,
  her düzlem için büyük **gram (g)** ve **g·mm** tolerans kutuları, hızlar ve canlı şema.
* **Mühendislik detayları (akordeon):** kütle merkezi entegrasyon tablosu, eksenel moment
  dengesi / yatak yükleri, ISO 21940-11 formül adımları, yatak payları, düzlem transferi ve
  ham parametreler.

### Hız ve G mirası

Proses alanları boş bırakıldığında **balans hızı**, **servis hızı** ve **G** genel
parametrelerden devralınır ("genel" etiketi). Değer girilirse "prosese özel" olur; *Genel*
düğmesi mirası geri getirir. Genel değer değiştiğinde miras alan tüm prosesler anında yenilenir.

### JSON

*JSON dışa aktar* tüm tanımları, prosesleri, hız/G değerlerini ve arayüz durumunu tek dosyaya
kaydeder (bilgi amaçlı hesap sonuçları `computed` alanında yer alır, içe aktarmada yeniden
hesaplanır). *JSON içe aktar* projeyi eksiksiz geri yükler. Örnek: [`examples/ornek-pompa-rotoru.json`](examples/ornek-pompa-rotoru.json).
Çalışma ayrıca tarayıcının yerel deposunda otomatik saklanır.

### PDF

*PDF raporu* (tek proses) veya *Tüm raporlar* (her proses bir sayfa). Sayfa düzeni referans
"Balancing report" şablonunu izler: başlık bilgileri → tip verisi ve hızlı bakış (temsil görseli,
şema) → g / g·mm tolerans kutuları → hız şeridi → **ABC geometrisi** ve **DIN ISO 21940-11
hesabı** → kompakt parça / yatak tablosu. Tablo kalan alana sığdırılır (gerekirse yazı küçültülür,
taşan satırlar "… ve N parça daha" olarak özetlenir); böylece her proses daima **tam 1 sayfadır**.

## Hesap yöntemi

Birimler: kütle g, uzunluk mm, hız rpm, G mm/s.

1. **Kütle merkezi:** `X_cg = Σ(mᵢ·xᵢ) / Σmᵢ` (yalnızca prosese seçili parçalar).
2. **İzin verilen dengesizlik:** `Ω = 2π·n_servis/60`, `U_per = G·m/Ω` [g·mm]
   (= 1000·G·M[kg]/Ω).
3. **Yatak düzlemlerine dağıtım:** `U_per,A = U_per·L_B/L`, `U_per,B = U_per·L_A/L`;
   her pay ISO 21940-11'e göre %30…%70 aralığına sınırlandırılır.
4. **Düzeltme düzlemlerine transfer (2 düzlem):**
   * Düzlemler yataklar arasında ve `b ≥ L/3` → yatak toleransları doğrudan alınır.
   * Diğer durumlarda (çıkıntılı, polar, dar düzlem) kaldıraç katsayılarıyla en kötü faz
     kontrolü yapılır: `|c_A1|·U₁ + |c_A2|·U₂ ≤ U_per,A`, `|c_B1|·U₁ + |c_B2|·U₂ ≤ U_per,B`,
     `U₁ = s·U_per,A`, `U₂ = s·U_per,B`, `s = min(1, s_A, s_B)`.
   * 1 düzlem (statik): `U = U_per`.
5. **Doğrudan kütle:** `m_per = U / r` [g] — operatörün tezgâhta okuyacağı değer.

Referans rapordaki örnek (G 1,6 · 1315 g · 7200 rpm, a = 23 / b = 80,5 / c = 31,5 mm,
r = 20 mm) uygulamada 2 × 1,40 g·mm ve 2 × 0,0698 g verir (örnek projenin 3. adımı).

### Otomatik rotor tipi

Düzlem konumları yataklara göre *sol dış / arası / sağ dış* olarak sınıflandırılır
(tolerans: L'nin %0,5'i). Kütle merkezinin yatak açıklığındaki konumu gerekçe metnine eklenir.

| Düzlem sayısı | Düzlem 1 | Düzlem 2 | Tip |
|---|---|---|---|
| 1 | – | – | Statik (Static) |
| 2 | arası | arası | Yataklar Arası (Centered) |
| 2 | arası | sağ dış | Orta + Sağ (Center + Right) |
| 2 | sağ dış | sağ dış | Sağ Çıkıntılı (Overhung Right) |
| 2 | sol dış | sağ dış | Polar |
| 2 | sol dış | arası | Orta + Sol (Center + Left) |
| 2 | sol dış | sol dış | Sol Çıkıntılı (Overhung Left) |

## Dosya yapısı

```
index.html            uygulama
css/style.css         stiller
js/calc.js            hesap motoru (saf fonksiyonlar, Node'da da çalışır)
js/schematic.js       şema geometrisi → SVG (ekran) ve jsPDF (rapor)
js/report.js          1 sayfalık PDF rapor
js/app.js             arayüz, durum, JSON içe/dışa aktarma
js/type-images.js     temsil görselleri (assets/types/*.jpg, base64)
js/vendor/            jsPDF 4.2.1 (MIT), Liberation Sans alt kümesi (OFL) – Türkçe karakterler için
tests/calc.test.js    hesap motoru testleri
```

Testler: `node --test tests/calc.test.js`
