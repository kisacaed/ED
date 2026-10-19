# ED Öğrenci Koçluğu

LGS ve YKS öğrencileri için günlük ödev, fotoğraflı teslim ve koç onayı.

## Kurulum ve geliştirme

Node.js **22.13 veya üzeri** gerekir (node:sqlite kullanılır).

```sh
npm ci --cache /tmp/ed-npm-cache
npm run create-coach
```

İlk koç hesabını terminalde ad, e-posta ve en az 12 karakterli parola girerek oluşturun. Parola ekranda gösterilmez; hazır veya ortak giriş parolası yoktur. Her koç kendi hesabıyla giriş yapar ve **Öğrenci ekle** ile kendisine bağlı öğrenci hesaplarını oluşturur. İlk öğrenci parolasını öğrenciyle güvenli bir kanaldan paylaşın.

İki terminalde:

```sh
npm run server
npm run dev
```

Vite, `/api` isteklerini 3001 portundaki sunucuya yönlendirir. Koç ve öğrenci akışını denemek için ayrı tarayıcı profilleri veya gizli pencereler kullanın. `Yenile` düğmesi diğer oturumdaki değişiklikleri getirir.

## Derleme ve çalıştırma

```sh
npm run build
npm start
```

Sunucu derlenmiş arayüzü ve API'yi 3001 portunda sunar. `PORT` ile değiştirilebilir. `npm run preview` yalnızca arayüz derlemesi içindir; tam uygulama için `npm start` kullanın.

İnternete açmadan önce HTTPS ters vekili kurun. `NODE_ENV=production` güvenli oturum çerezini etkinleştirir; `PUBLIC_ORIGIN` değerini kullanıcıların eriştiği tam HTTPS kökenine ayarlayın (örneğin `https://kocluk.example.com`, sonunda `/` olmadan). HTTP üzerinden production oturumu kullanmayın.

## İş akışı

1. Koç öğrenciye ders, yönerge, soru hedefi ve tarih içeren ödev verir.
2. Öğrenci kendi hesabından ödevi açıp 1–4 fotoğraf ve isteğe bağlı not ile teslim eder.
3. Koç fotoğrafları inceleyip onaylar veya açıklama yazarak düzeltme ister.
4. Öğrenci düzeltip tekrar teslim eder. Onaylanan ödev değiştirilemez.

Parolalar scrypt ile özetlenir. Oturumlar HttpOnly/SameSite çerezleriyle yönetilir ve 24 saatte sona erer. Öğrenci başka öğrencinin ödev veya fotoğrafına erişemez; koç yalnızca kendisine bağlı öğrencileri görür. Eşzamanlı değişiklikler sürüm kontrolüyle reddedilir. Sunucu fotoğrafları doğrular, yeniden JPEG olarak kodlar ve metadata bilgilerini kaldırır.

## Veri ve sınırlar

Veriler, fotoğraflar ve oturumlar `data/ed.sqlite` içinde tutulur; bu dizin Git'e dahil değildir. Kalıcı disk kullanın, erişimini kısıtlayın ve düzenli yedekleyin. Çalışan veritabanını yedeklerken SQLite backup yöntemini kullanın veya sunucuyu durdurup `data/` dizininin tamamını kopyalayın. Sunucuyu yeniden başlatmak verileri silmez. Eski yerel demonun localStorage verileri otomatik aktarılmaz.

Bu sürümde e-posta doğrulama, parola değiştirme/sıfırlama, bildirim, dosya kotası yönetimi ve yedekleme otomasyonu henüz yoktur. Gerçek öğrenci verileriyle yayına geçmeden önce bunları ve veri saklama/silme politikasını tamamlayın. Sistem şu an tek Node sunucusu ve yerel SQLite diskiyle çalışır; çoklu sunucu dağıtımı için ayrıca tasarım gerekir.

## Doğrulama

`npm test`: gerçek geçici SQLite veritabanı ve HTTP sunucusuyla giriş, yetki sınırları, kanıt doğrulama, fotoğraf erişimi, düzeltme, yeniden teslim, onay, eşzamanlı güncelleme, yeniden başlatma sonrası kalıcılık ve çıkış kontrol edilir.

`npm run build`: üretim arayüzünü derler.

## Veli erişimi

Koç panelindeki **Veliler** düğmesiyle veli hesabı oluşturup kendi öğrencilerinizden birini veya birkaçını bağlayın. Aynı öğrenciye birden fazla veli hesabı bağlanabilir. Veli kendi e-posta ve parolasıyla giriş yapar; öğrenci seçerek tarihe göre günlük ödevleri, soru hedeflerini, teslim fotoğraflarını ve koç geri bildirimlerini salt okunur görüntüler. **Teslim edildi** ve **onaylandı** farklı durumlardır; tamamlanma oranı koçun onayladığı ödevleri sayar.

**Bağlantıları düzenle** ile öğrenci ekleyebilir/çıkarabilirsiniz. Tüm bağlantılar kaldırılabilir; veli hesabı kalır, ancak öğrenci verisine erişimi sona erer. Bağlantı kaldırma, velinin açık oturumunda da sonraki veri ve fotoğraf isteklerine uygulanır. Daha önce görüntülenmiş veya indirilmiş bir görsel geri alınamaz.

Veli; ödev oluşturamaz, öğrenci adına teslim yapamaz, onay veremez veya kullanıcı/bağlantı yönetemez. Koç başka koçun öğrencisini veliye bağlayamaz. Bağlantılar SQLite içinde kalıcıdır; mevcut veritabanına gerekli tablo başlangıçta otomatik eklenir.

## Süper admin ve koordinatör

İlk süper admin hesabı: `npm run create-super-admin`. Terminalde ad, e-posta ve en az 12 karakterli parola girin; parola ekranda gösterilmez. Mevcut koç hesapları otomatik yükseltilmez.

- **Süper admin** tüm kullanıcıları ve öğrenci verilerini görür; koordinatör ve koç hesabı açar; koçları koordinatöre, öğrencileri koça atar. Atanmamış eski koçlar yönetim listesinde görünür ve koordinatöre bağlanabilir.
- **Koordinatör** yalnızca kendi koçlarını ve onların öğrencilerini görür; kendi ekibine koç/öğrenci ekler ve öğrenciyi kendi koçları arasında aktarır. Başka ekibin koçunu kendisine bağlayamaz, süper admin veya koordinatör hesabı açamaz.
- **Koç** kendi öğrencisine ödev verir ve teslimini onaylar. Koordinatör ve süper admin, denetim amacıyla planları/fotoğrafları görür; ödev onayını öğrencinin koçu yapar.
- **Öğrenci** yalnızca kendi ödevini teslim eder; **veli** yalnızca bağlı öğrencilerini takip eder.

Yöneticiler girişte **Ekip yönetimi** sayfasına yönelir. **Öğrenci takibi** sayfasında yetkili oldukları öğrencileri izleyebilirler. URL değişikliği yetki kazandırmaz; API her istekte güncel ilişkiyi kontrol eder.

Atamalar sürüm kontrolüyle kaydedilir; eski bir formdan yapılan eşzamanlı atama reddedilir. Koçun koordinatörü değiştiğinde tüm öğrencilerinin ekip erişimi yeni koordinatöre geçer. Öğrencinin koçu değiştiğinde geçmiş ödevler ve veli bağlantıları korunur; eski koç verileri göremez. Bu, mevcut oturumlara da sonraki istekten itibaren uygulanır.

Veli yönetimi, bağlı öğrencilerin tamamına erişebilen koç veya koordinatöre açıktır. Farklı ekiplerde öğrencileri olan ortak veli hesabının bağlantılarını süper admin yönetir. Bağlantısı olmayan veli hesabını, hesabı açan koç/koordinatör veya süper admin yönetebilir.

Hesap açma ve atama işlemleri `management_events` tablosuna kaydedilir. Mevcut veritabanı başlangıçta veri silmeden güncellenir. Yönetim ekranında şu an hesap açma ve atama işlemleri bulunur; hesap kapatma, rol değiştirme ve parola sıfırlama henüz yoktur.

## Kullanıcının gözünden bak

Süper admin, **Ekip yönetimi** listesindeki bir hesabın **Gözünden bak** düğmesine tıklayarak o kullanıcının sistemini açabilir. Kullanıcının parolası gerekmez; özelliği başlatmak için süper adminin kendi hesabında oturum açmış olması gerekir. Koordinatör, koç, öğrenci, veli ve başka süper admin hesapları açılabilir. Kendi hesabında düğme gösterilmez.

Bu bir salt okunur önizleme değildir: işlemler seçilen hesabın gerçek yetkileriyle gerçek verilere uygulanır. Örneğin koç olarak ödev verilebilir ve teslim onaylanabilir; öğrenci olarak fotoğraflı teslim yapılabilir. Veli olarak yalnızca bağlı öğrenciler izlenebilir. Yetkiler seçilen hesaba aittir; süper admin yetkileri o hesabın yetkilerine eklenmez. Test için ayrı test kullanıcıları ve ödevler kullanın.

Üstte görünen kullanıcı/rol şeridindeki **Süper admine dön** düğmesi kendi hesabınıza döndürür. İç içe başka hesaba geçiş engellenir; önce kendi hesabınıza dönmelisiniz. Sayfa yenilendiğinde veya sunucu yeniden başladığında aktif görünüm ve dönüş imkânı korunur. Çıkış yapıldığında süper admin oturumu da sonlanır. Oturumun mevcut son kullanma tarihi uzatılmaz; başlangıç ve dönüşte oturum anahtarı değiştirilir. Kullanıcının kendi açık oturumları etkilenmez.

Aynı tarayıcı profilindeki sekmeler aynı oturumu paylaşır. Diğer sekme eski hesabı gösterirken veri değiştirmeye çalışırsa arayüzün gönderdiği aktif hesap kontrolü isteği reddeder; sayfa yenilenmelidir. Tamamen ayrı bir oturum için farklı tarayıcı profili kullanın.

Geçiş başlangıcı/dönüşü/çıkışı `management_events` içinde kaydedilir. Veri değiştiren ödev ve yönetim işlemleri `events`/`management_events` tablolarında etkin kullanıcı (`actor`) ve gerçek süper admin (`original_actor`) ile ayırt edilir. Eski kayıtların `original_actor` alanı boş kalır. Süper adminin rolü kaldırılırsa onun adına açılan kullanıcı görünümü bir sonraki istekte iptal edilir. İşlem kayıtları şu an veritabanındadır; arayüzde kayıt görüntüleme ekranı henüz yoktur.

### Özelliğin yalnızca süper admine açılması

“Gözünden bak” yetkisi yalnızca süper admin rolüyle başarılı giriş yapıldığında sunucudaki oturuma verilir. İstek gövdesi, tarayıcıdaki rol bilgisi veya HTTP başlıkları bu yetkiyi veremez. Normal kullanıcı oturumu sonradan süper admin rolüne yükseltilse bile özelliği kullanmak için yeniden giriş gerekir. Kullanıcı görünümündeki oturumda bu yetki bulunmaz; önce süper admin hesabına dönülmelidir. Süper admin hesabı açmak için yönetim API'si kullanılamaz; mevcut güvenilir terminal komutu gerekir.

Bu güvenlik güncellemesinden önce açılmış süper admin oturumlarında da özellik başlangıçta kapalıdır; çıkış yapıp yeniden giriş yapın. Oturumu başlatanın süper admin rolü her istekte yeniden kontrol edilir. Bu kontrol hesap kimliğine dayanır: süper admin hesabının parolasını veya geçerli oturumunu paylaşmayın. İki aşamalı doğrulama henüz uygulanmamıştır.

## Koç günlük takip ve haftalık plan

Koç girişte **Günlük takip** ekranını görür. Özetler tüm kendi öğrencilerini kapsar; takip listesini öğrenciye göre daraltabilirsiniz.

- **Bugün teslim edilmemiş:** İstanbul tarihine göre bugün yapılması gereken, henüz teslim edilmemiş veya düzeltme istenmiş ödevler.
- **Gecikenler:** Önceki tarihlerde kalmış, yapılmamış/düzeltmesi teslim edilmemiş ödevler. Teslim edilmiş veya onaylanmış ödevler bu sayıya dahil edilmez.
- **İnceleme bekleyen:** Tarihten bağımsız bütün teslimler; doğrudan buradan fotoğraf inceleme ve onay/düzeltme ekranına gidilir.
- **Düzeltme bekleyen:** Tekrar teslim edilmesi gereken ödevler.

Ödevi olmayan öğrenci “teslim etmedi” diye gösterilmez; bugün planı olmayan öğrenciler ayrıca belirtilir. **Günlük plan** düğmesi ilgili öğrencinin doğru tarihteki planını açar.

**Haftalık plan** ekranı pazartesi–pazar düzenindedir. Öğrenciyi seçerek farklı haftalara geçebilir, dersleri, soru yükünü ve onay durumlarını görebilirsiniz. **Haftayı planla** ile seçili hafta için ödev satırları ekleyin; gün, ders, soru hedefi, başlık ve yönergeyi düzenleyin. Bir veya daha fazla öğrenciyi seçin. Kayıttan önce toplam ödev ve öğrenci başına soru sayısı gösterilir. Her öğrenciye bağımsız ödevler atanır; teslim ve onaylar birbirini etkilemez.

**Önceki haftayı kopyala**, seçilen öğrencinin bir önceki haftasındaki ödev tanımlarını yeni haftaya taslak olarak taşır. Göndermeden önce düzenleme, satır kaldırma ve hedef öğrenci seçimi yapılabilir. Kaynak ödevler, teslim fotoğrafları ve onaylar değiştirilmez; kopyalar yapılacak durumunda yeni ödev olarak açılır. Aynı haftaya ayrıca yeniden plan atamak ilave ödevler oluşturur.

Tek kayıt en fazla 50 plan satırı, 100 öğrenci ve toplam 500 ödev içerebilir. Sunucu bütün öğrencileri ve satırları doğrular; toplu işlemin tamamı kaydedilir veya tamamı geri alınır. Aynı işlem kimliğiyle bağlantı hatası sonrası tekrarlanan istek yeniden ödev üretmez; farklı içerikle tekrar kullanılırsa reddedilir. İşlem kayıtlarında gerçek süper admin kimliği de korunur.

Bu ekranlar koçun iş akışıdır. Öğrenci ve veli yeni ödevleri kendi günlük planlarında görür; koordinatör ve süper admin yalnızca kendi kapsamlarında öğrenci takibini sürdürür. Süper admin, koç adına plan oluşturmayı “Gözünden bak” üzerinden yapabilir. Otomatik mesaj/bildirim gönderimi bu geliştirmeye dahil değildir.

## Öğrenci kaynak kütüphanesi

Her ekrandaki **Kaynaklar** düğmesi öğrencinin **aktif** ve **bitirilen** kitaplarını ayrı gösterir. Her kitap öğrencinin kendisine aittir; yayınevi, kitap adı, ders ve toplam sayfa sayısı kaydedilir. Koç yalnızca kendi öğrencisinin kitabını ekleyebilir, bitti olarak işaretleyebilir veya yanlışlıkla bitirilen kitabı yeniden aktif edebilir. Öğrenci, veli, koordinatör ve süper admin kendi veri kapsamlarında kaynakları görüntüler; değiştirme işlemi öğrencinin koçuna aittir. Süper admin koç adına işlem yapacaksa “Gözünden bak” kullanabilir; gerçek işlem sahibi kaydedilir.

Aktif kitaptaki **Bu kitaptan ödev ver** düğmesi kaynağı seçilmiş bir ödev formu açar. Kitap ve sayfa aralığı ayrıca standart ödev formunda da seçilebilir. Aynı derste aktif kitap varsa yeni ödev için bu kaynaklardan biri seçilmelidir. O derste aktif kitap yoksa kitap bağlantısız genel çalışma verilebilir. Önceden oluşturulan genel çalışmalar olduğu gibi kalır. Başka öğrencinin kitabı, bitmiş kitap, farklı dersin kitabı ve kitabın dışındaki sayfa aralıkları sunucuda reddedilir.

Haftalık toplu planda her satır için **her öğrencinin kitabı ve sayfa aralığı ayrı** seçilir; farklı yayınevlerine sahip öğrenciler aynı plan içinde çalışabilir. Öğrenci seçimi ve ders değiştiğinde kaynak seçenekleri güncellenir. Önceki haftayı kopyalamak, aynı öğrencinin kaynak/sayfa bilgisini de taslağa taşır. Bitmiş kaynaktan yeni ödev oluşturulmaz; başka öğrenciye kopyalarken onun kendi kitabı seçilmelidir.

Ödev detayında, günlük tabloda, takip ekranında ve haftalık kartlarda yayınevi, kitap adı ve sayfa aralığı görünür. Geçmiş ödevlerin kitap bağlantıları kaynak tamamlandıktan sonra da korunur.

İlerleme, koçun onayladığı ödevlerin kapsadığı **farklı sayfaları** sayar; üst üste binen aralıklar iki kez sayılmaz. Bu ölçüm bütün kitabın fiziksel olarak bitirildiğini otomatik varsaymaz. **Bitti olarak işaretle** kararını koç verir; kitaba bağlı yapılacak, düzeltilecek veya incelenecek ödev varken tamamlama engellenir. Bitirilen kitaplar yeni ödev seçeneklerinden çıkar. Kitaplar ve durumları SQLite içinde saklanır; mevcut veritabanına kitap tablosu ve ödev bağlantı alanları veri silmeden eklenir.

Bu sürüm öğrencinin elindeki kitapları ayrı ayrı kaydeder; ortak yayınevi/katalog yönetimi, kitap metaverisi düzenleme ve PDF içerik barındırma henüz yoktur.

## Google Cloud'a yayın

Kalıcı disk kullanan tek sunuculu Compute Engine kurulumu için [Google Cloud kurulum rehberi](deploy/GOOGLE-CLOUD.md), `Dockerfile` ve `deploy/google-cloud.sh` hazırdır. Kurulum Cloud Shell'de kendi yetkili hesabınızla, proje kimliği ve alan adı verilerek yapılır. Hazırlanan dosyalar tek başına Google Cloud'da kaynak oluşturmaz veya uygulamayı yayımlamaz.
