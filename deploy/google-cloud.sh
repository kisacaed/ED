#!/usr/bin/env bash
# Run from a checkout in Google Cloud Shell after selecting an authorized account.
set -Eeuo pipefail
PROJECT_ID=${1:?Usage: bash deploy/google-cloud.sh PROJECT_ID [APP_DOMAIN]}
APP_DOMAIN=${2:-}
REGION=${REGION:-europe-west3}
ZONE=${ZONE:-europe-west3-a}
APP_NAME=${APP_NAME:-ed-kocluk}
[[ "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo 'Invalid Project ID'; exit 1; }
[[ -z "$APP_DOMAIN" || "$APP_DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$ ]] || { echo 'Use a DNS hostname without scheme, port or path'; exit 1; }
[[ "$REGION" =~ ^[a-z]+-[a-z]+[0-9]$ && "$ZONE" == "$REGION"-[a-z] ]] || { echo 'Region/zone mismatch'; exit 1; }
[[ "$APP_NAME" =~ ^[a-z][a-z0-9-]{0,40}[a-z0-9]$ ]] || { echo 'Invalid APP_NAME'; exit 1; }
trap 'printf "Kurulum durdu (satır %s). Yukarıdaki hata mesajını kontrol edin.\n" "$LINENO" >&2' ERR
command -v gcloud >/dev/null || { echo 'Run this script in Google Cloud Shell'; exit 1; }
[[ -n "$(gcloud auth list --filter=status:ACTIVE --format='value(account)' --limit=1)" ]] || { echo 'Sign in to Google Cloud Shell first'; exit 1; }
TASK_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$TASK_ROOT"
GCLOUD=(gcloud --project="$PROJECT_ID" --quiet)
# Enable APIs before any Compute call; --quiet prevents invisible enable prompts.
echo '[1/7] Google Compute Engine ve IAP API erişimi hazırlanıyor...'
"${GCLOUD[@]}" services enable compute.googleapis.com iap.googleapis.com
list_resources() { "${GCLOUD[@]}" "$@" --format='value(name)'; }
echo '[2/7] Mevcut sunucu kontrol ediliyor...'
EXISTING_INSTANCE=$(list_resources compute instances list --zones="$ZONE" --filter="name=$APP_NAME")
if [[ -n "$EXISTING_INSTANCE" ]]; then
  echo "Instance $APP_NAME already exists. Existing VM and data preserved; use the update instructions."
  exit 1
fi
# List errors are fatal; an access denial must never be treated as a missing resource.
echo '[3/7] Ağ, güvenlik duvarı ve sabit IP hazırlanıyor...'
EXISTING_NETWORK=$(list_resources compute networks list --filter="name=$APP_NAME-net")
if [[ -z "$EXISTING_NETWORK" ]]; then
  "${GCLOUD[@]}" compute networks create "$APP_NAME-net" --subnet-mode=custom
fi
EXISTING_SUBNET=$(list_resources compute networks subnets list --regions="$REGION" --filter="name=$APP_NAME-subnet")
if [[ -z "$EXISTING_SUBNET" ]]; then
  "${GCLOUD[@]}" compute networks subnets create "$APP_NAME-subnet" --network="$APP_NAME-net" --region="$REGION" --range=10.78.0.0/24
fi
EXISTING_WEB_RULE=$(list_resources compute firewall-rules list --filter="name=$APP_NAME-web")
if [[ -z "$EXISTING_WEB_RULE" ]]; then
  "${GCLOUD[@]}" compute firewall-rules create "$APP_NAME-web" --network="$APP_NAME-net" --direction=INGRESS --allow=tcp:80,tcp:443 --source-ranges=0.0.0.0/0 --target-tags="$APP_NAME-web"
fi
EXISTING_IAP_RULE=$(list_resources compute firewall-rules list --filter="name=$APP_NAME-iap")
if [[ -z "$EXISTING_IAP_RULE" ]]; then
  "${GCLOUD[@]}" compute firewall-rules create "$APP_NAME-iap" --network="$APP_NAME-net" --direction=INGRESS --allow=tcp:22 --source-ranges=35.235.240.0/20 --target-tags="$APP_NAME-iap"
fi
EXISTING_ADDRESS=$(list_resources compute addresses list --regions="$REGION" --filter="name=$APP_NAME-ip")
if [[ -z "$EXISTING_ADDRESS" ]]; then
  "${GCLOUD[@]}" compute addresses create "$APP_NAME-ip" --region="$REGION" --network-tier=STANDARD
fi
APP_IP=$("${GCLOUD[@]}" compute addresses describe "$APP_NAME-ip" --region="$REGION" --format='value(address)')
if [[ -z "$APP_DOMAIN" ]]; then
  APP_DOMAIN="${APP_IP}.sslip.io"
  AUTO_DOMAIN=1
else
  AUTO_DOMAIN=0
fi
echo '[4/7] Uygulama sunucusu oluşturuluyor...'
"${GCLOUD[@]}" compute instances create "$APP_NAME" --zone="$ZONE" --machine-type=e2-small --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=30GB --boot-disk-type=pd-balanced --no-boot-disk-auto-delete --network="$APP_NAME-net" --subnet="$APP_NAME-subnet" --address="$APP_IP" --network-tier=STANDARD --tags="$APP_NAME-web,$APP_NAME-iap" --no-service-account --no-scopes --metadata=enable-oslogin=TRUE
ARCHIVE=$(mktemp /tmp/ed-deploy.XXXXXX.tar.gz)
trap 'rm -f "$ARCHIVE"' EXIT
tar -czf "$ARCHIVE" Dockerfile .dockerignore package.json package-lock.json index.html vite.config.js src server deploy/compose.yaml deploy/Caddyfile
echo '[5/7] Kaynak dosyaları IAP üzerinden aktarılıyor...'
"${GCLOUD[@]}" compute scp "$ARCHIVE" "$APP_NAME:/tmp/ed-source.tar.gz" --zone="$ZONE" --tunnel-through-iap --quiet
echo '[6/7] Docker kurulumu ve uygulama derlemesi başlıyor...'
"${GCLOUD[@]}" compute ssh "$APP_NAME" --zone="$ZONE" --tunnel-through-iap --quiet --command="sudo bash -se" <<REMOTE
set -euo pipefail
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose curl
systemctl enable --now docker
mkdir -p /srv/ed
chmod 750 /srv/ed
tar -xzf /tmp/ed-source.tar.gz -C /srv/ed
rm /tmp/ed-source.tar.gz
printf 'APP_DOMAIN=%s\n' '$APP_DOMAIN' > /srv/ed/deploy/.env
cd /srv/ed/deploy
docker-compose -p ed --env-file .env -f compose.yaml up -d --build
REMOTE
echo '[7/7] Sunucu kurulumu tamamlandı; HTTPS ve kullanıcı hesabı kontrolüne geçin.'
if [[ "$AUTO_DOMAIN" == 1 ]]; then
  printf '\nTemporary HTTPS address: https://%s (depends on public sslip.io DNS).\n' "$APP_DOMAIN"
else
  printf '\nDNS: create an A record for %s pointing to %s.\n' "$APP_DOMAIN" "$APP_IP"
fi
printf 'After DNS propagation, check HTTPS at https://%s\n' "$APP_DOMAIN"
printf 'Create the super admin interactively (never put its password in a command):\n'
printf 'gcloud --project=%s compute ssh %s --zone=%s --tunnel-through-iap\n' "$PROJECT_ID" "$APP_NAME" "$ZONE"
printf 'Then: sudo bash -c '\''cd /srv/ed/deploy && docker-compose -p ed --env-file .env -f compose.yaml exec app npm run create-super-admin'\''\n'
