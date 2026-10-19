# Google Cloud'da canlı kurulum

Bu kurulum **Compute Engine** üzerinde tek sunucu kullanır. Uygulamanın SQLite veritabanı ve fotoğrafları Docker'ın `ed_ed_data` adlı kalıcı disk bölümünde tutulur. Cloud Run'a uygun değildir; Cloud Run'ın geçici dosya sisteminde SQLite/fotoğraf saklamayın.

## Gerekenler

- Faturalandırması açık Google Cloud projesi ve Project ID.
- Kalıcı yayın için DNS A kaydını değiştirebildiğiniz bir alan adı. İlk testte alan adı parametresi verilmezse IP tabanlı `sslip.io` adresi kullanılır; bu adres üçüncü taraf DNS hizmetine bağlıdır, kalıcı yayın için kendi alan adınızı kullanın.
- Google Cloud Shell'de kendi yetkili hesabınızla oturum.
- Projede API etkinleştirme, ağ/firewall/statik IP ve Compute Engine VM oluşturma izinleri; IAP üzerinden SSH için IAP tunnel ve OS Admin Login izinleri. Kurumsal projelerde yöneticiniz bu izinleri vermelidir. Betik kendisine IAM yetkisi vermez.

VM, disk ve statik IPv4 **ücretlidir**. İlk hedef `e2-small`, 30 GB kalıcı disk ve Frankfurt (`europe-west3-a`). Fiyat ve kota için kendi Google Cloud konsolunuzu kontrol edin. Otomatik disk/veri silme yapılmaz; durdurulmuş VM'nin diski ve rezerve IP'si de ücret oluşturabilir.

## İlk kurulum

Kaynak dosyaları Google Cloud Shell'e yükleyin ve uygulama dizinine girin. Henüz uzak Git deposuna gönderilmemiş yerel değişiklikler varsa yalnızca `git clone` yeterli değildir; hazırlanan kaynak paketini yükleyin.

```sh
tar -xzf ed-cloud-source.tar.gz
cd ed-cloud-source
bash deploy/google-cloud.sh sinavmatikkocgpt
# Kendi alan adınız varsa:
# bash deploy/google-cloud.sh sinavmatikkocgpt kocluk.sizin-alaniniz.com
```

Betik yalnızca çalıştırıldığında kaynak oluşturur. Frankfurt dışında kuracaksanız aynı bölgeye ait `REGION` ve `ZONE` verin. Kaynak adları `APP_NAME` ile değiştirilebilir. Aynı isimde VM varsa betik durur; otomatik olarak mevcut uygulamanın/verinin üzerine yazmaz.

Alan adı parametresi verilmezse betik IP tabanlı geçici `sslip.io` adresini yazar; bu seçenek için DNS kaydı oluşturmanız gerekmez. Kendi alan adınızı verdiyseniz kurulum sonucunda gösterilen IP'ye alan adınızın DNS **A** kaydını yönlendirin. Alan adı Google Domains'den alınmış olmak zorunda değildir. Başka bir sağlayıcıdaki alan adı da olur. Çakışan eski A/AAAA kayıtlarını kontrol edin; yanlış IPv6 kaydı sertifika doğrulamasını bozabilir. Caddy, DNS doğru sunucuyu gösterdiğinde HTTPS sertifikasını otomatik alır. 80 ve 443 portları açıktır; 3001 dışarıya açılmaz. SSH yalnızca Google IAP kaynak aralığına açıktır.

DNS yayıldıktan sonra betiğin gösterdiği gerçek adresle (örnekteki alan adını kullanmayın):

```sh
curl --fail --show-error https://kocluk.sizin-alaniniz.com/
```

Tarayıcıdan HTTPS adresini açın. İlk süper admini, betiğin yazdığı IAP SSH komutuyla sunucuya bağlanıp oluşturun:

```sh
sudo bash -c 'cd /srv/ed/deploy && docker-compose -p ed --env-file .env -f compose.yaml exec app npm run create-super-admin'
```

Parola terminalde gizlenerek alınır; chat'e, shell argümanına veya `.env` dosyasına parola yazmayın. Yönetim panelinden koordinatör, koç, öğrenci ve veli hesaplarını oluşturabilirsiniz.

Kaynak paketi mevcut veritabanını, fotoğrafları veya parolaları içermez. Yeni sunucu boş veritabanıyla başlar. Mevcut veriyi taşımak gerekiyorsa uygulamayı durdurup veritabanını WAL dosyalarıyla birlikte güvenli IAP kanalı üzerinden ayrıca taşıyın; çalışan SQLite dosyasını tek başına kopyalamayın.

## Kontrol ve güncelleme

Sunucuda:

```sh
cd /srv/ed/deploy
sudo docker-compose -p ed --env-file .env -f compose.yaml ps
sudo docker-compose -p ed --env-file .env -f compose.yaml logs --tail=80 app web
```

Yeni kaynakları `/srv/ed` altına aktarın; `deploy/.env` ve Docker volume'lerini koruyun. Güncellemeden önce yedek alın:

```sh
cd /srv/ed/deploy
sudo docker-compose -p ed --env-file .env -f compose.yaml up -d --build
```

`docker-compose down -v`, `docker volume rm` veya `docker system prune --volumes` kullanmayın; bunlar veriyi silebilir. Veriler uygulama container'ı yeniden oluşturulduğunda kalır; VM/disk silinmesine karşı ayrıca yedek gerekir.

## Yedekleme

Bu ilk sürüm otomatik yedekleme kurmaz. Gerçek öğrenci verisiyle kullanmadan önce düzenli yedekleme ve geri yükleme denemesi yapın. Basit, tutarlı bir disk kopyası için kısa bakım aralığında uygulamayı durdurun, volume'ün tamamını alın, sonra tekrar başlatın:

```sh
cd /srv/ed/deploy
sudo mkdir -p /srv/ed-backups
sudo chmod 700 /srv/ed-backups
sudo docker-compose -p ed --env-file .env -f compose.yaml stop app
sudo docker run --rm -v ed_ed_data:/data:ro -v /srv/ed-backups:/backups alpine:3.22 sh -c 'umask 077; tar -czf /backups/ed-$(date -u +%Y%m%d-%H%M%S).tar.gz -C /data .'
sudo docker-compose -p ed --env-file .env -f compose.yaml start app
```

Yedek komutu başarısız olsa da uygulamayı tekrar başlatın. Aynı VM'deki yedek, disk kaybına karşı koruma sağlamaz; Google Cloud disk snapshot'larını ve ayrı korumalı depolamayı da planlayın. Yedekler fotoğraf ve parola özetleri içerir; herkese açık depoya koymayın.

## Kısıtlar

Bu düzen tek sunuculudur; otomatik ölçekleme veya yüksek erişilebilirlik sağlamaz. Google Cloud projesine bağlanmadan, VM'yi oluşturmadan, DNS/HTTPS'yi ve gerçek giriş/teslim akışını o adreste doğrulamadan uygulama yayına alınmış sayılmaz. Hesap kapatma, parola sıfırlama, süper admin MFA ve veri saklama/silme politikası hâlâ ayrıca tamamlanmalıdır.

## İlk kontrolde sessizce bekleme

Güncel betik önce Compute Engine/IAP API'lerini etkinleştirir, ardından kaynakları `list` ile kontrol eder. Bütün Google hataları görünürdür; erişim reddi, kaynak yokmuş gibi değerlendirilmez. `[1/7]`–`[7/7]` mesajları aşamayı gösterir. API/faturalandırma/yetki hatası varsa bu aşamada durur; görünmeyen API etkinleştirme sorusu beklemez. Cloud Shell'in kendi **Authorize / Yetkilendir** penceresi açılırsa kendi Google hesabınızla onaylayın.

Önceki sürüm `compute instances describe` kontrolünde bekliyorsa eski kurulumu durdurun, ardından `git pull --ff-only` ile güncelleyip tekrar çalıştırın. Mevcut bir VM tespit edilirse güncel betik onu/verilerini değiştirmeden durur. Silme veya sıfırlama yapmayın.

Betik akışını Google'a bağlanmadan sınamak için: `python3 -m unittest discover -s deploy -p 'test_google_cloud.py'`. Bu testler sahte CLI ile API sırası, görünür hata ve hata sonrası kaynak oluşturulmamasını doğrular; gerçek Google Cloud kurulumunun doğrulandığı anlamına gelmez.

## VM çalışıyor, IAP aktarımı başarısız

VM `RUNNING` durumunda olduğu halde IAP `Failed to lookup instance` hatası veriyorsa, önce bağlantıyı Google'ın teşhis aracıyla kontrol edin:

```sh
gcloud compute ssh ed-kocluk --project=sinavmatikkocgpt --zone=europe-west3-a --tunnel-through-iap --troubleshoot
```

Bu hata tek başına VM'nin silindiğini veya belirli bir IAM rolünün eksik olduğunu kanıtlamaz. Teşhis çıktısına göre IAP yetkisi, Google Cloud erişimi ve ağ erişimi kontrol edilmelidir. SSH'yi herkese açmayın veya hatayı aşmak için yeni VM oluşturmayın.

Bağlantı düzeldikten sonra kaynakları oluşturmadan yarım kalan kuruluma devam edilebilir:

```sh
RESUME=1 bash deploy/google-cloud.sh sinavmatikkocgpt
```

Devam modu yalnızca beklenen uygulama ağı ve `ed-kocluk-web`/`ed-kocluk-iap` etiketleri bulunan RUNNING VM'yi kabul eder; mevcut IP ve diski korur. Önce IAP/SSH bağlantısını sınar; başarısızsa dosya aktarımı yapmadan durur. Varsa `deploy/.env` dosyasını ve Docker veri volume'lerini korur. Bu seçenek sunucu silme veya otomatik IAM yetkisi genişletme işlemi yapmaz.
