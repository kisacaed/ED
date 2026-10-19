#!/usr/bin/env bash
# Run from a checkout in Google Cloud Shell after selecting an authorized account.
set -euo pipefail
PROJECT_ID=${1:?Usage: bash deploy/google-cloud.sh PROJECT_ID [APP_DOMAIN]}
APP_DOMAIN=${2:-}
REGION=${REGION:-europe-west3}
ZONE=${ZONE:-europe-west3-a}
APP_NAME=${APP_NAME:-ed-kocluk}
[[ "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo 'Invalid Project ID'; exit 1; }
[[ -z "$APP_DOMAIN" || "$APP_DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$ ]] || { echo 'Use a DNS hostname without scheme, port or path'; exit 1; }
[[ "$REGION" =~ ^[a-z]+-[a-z]+[0-9]$ && "$ZONE" == "$REGION"-[a-z] ]] || { echo 'Region/zone mismatch'; exit 1; }
[[ "$APP_NAME" =~ ^[a-z][a-z0-9-]{0,40}[a-z0-9]$ ]] || { echo 'Invalid APP_NAME'; exit 1; }
command -v gcloud >/dev/null || { echo 'Run this script in Google Cloud Shell'; exit 1; }
[[ -n "$(gcloud auth list --filter=status:ACTIVE --format='value(account)' --limit=1)" ]] || { echo 'Sign in to Google Cloud Shell first'; exit 1; }
TASK_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$TASK_ROOT"
GCLOUD=(gcloud --project="$PROJECT_ID")
if "${GCLOUD[@]}" compute instances describe "$APP_NAME" --zone="$ZONE" >/dev/null 2>&1; then
  echo "Instance $APP_NAME already exists. Use the update instructions; no changes made."
  exit 1
fi
# These resources incur Google Cloud charges. No automatic deletion of data/disks.
"${GCLOUD[@]}" services enable compute.googleapis.com iap.googleapis.com
if ! "${GCLOUD[@]}" compute networks describe "$APP_NAME-net" >/dev/null 2>&1; then
  "${GCLOUD[@]}" compute networks create "$APP_NAME-net" --subnet-mode=custom
fi
if ! "${GCLOUD[@]}" compute networks subnets describe "$APP_NAME-subnet" --region="$REGION" >/dev/null 2>&1; then
  "${GCLOUD[@]}" compute networks subnets create "$APP_NAME-subnet" --network="$APP_NAME-net" --region="$REGION" --range=10.78.0.0/24
fi
if ! "${GCLOUD[@]}" compute firewall-rules describe "$APP_NAME-web" >/dev/null 2>&1; then
  "${GCLOUD[@]}" compute firewall-rules create "$APP_NAME-web" --network="$APP_NAME-net" --direction=INGRESS --allow=tcp:80,tcp:443 --source-ranges=0.0.0.0/0 --target-tags="$APP_NAME-web"
fi
if ! "${GCLOUD[@]}" compute firewall-rules describe "$APP_NAME-iap" >/dev/null 2>&1; then
  "${GCLOUD[@]}" compute firewall-rules create "$APP_NAME-iap" --network="$APP_NAME-net" --direction=INGRESS --allow=tcp:22 --source-ranges=35.235.240.0/20 --target-tags="$APP_NAME-iap"
fi
if ! "${GCLOUD[@]}" compute addresses describe "$APP_NAME-ip" --region="$REGION" >/dev/null 2>&1; then
  "${GCLOUD[@]}" compute addresses create "$APP_NAME-ip" --region="$REGION" --network-tier=STANDARD
fi
APP_IP=$("${GCLOUD[@]}" compute addresses describe "$APP_NAME-ip" --region="$REGION" --format='value(address)')
if [[ -z "$APP_DOMAIN" ]]; then
  APP_DOMAIN="${APP_IP}.sslip.io"
  AUTO_DOMAIN=1
else
  AUTO_DOMAIN=0
fi
"${GCLOUD[@]}" compute instances create "$APP_NAME" --zone="$ZONE" --machine-type=e2-small --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=30GB --boot-disk-type=pd-balanced --no-boot-disk-auto-delete --network="$APP_NAME-net" --subnet="$APP_NAME-subnet" --address="$APP_IP" --network-tier=STANDARD --tags="$APP_NAME-web,$APP_NAME-iap" --no-service-account --no-scopes --metadata=enable-oslogin=TRUE
ARCHIVE=$(mktemp /tmp/ed-deploy.XXXXXX.tar.gz)
trap 'rm -f "$ARCHIVE"' EXIT
tar -czf "$ARCHIVE" Dockerfile .dockerignore package.json package-lock.json index.html vite.config.js src server deploy/compose.yaml deploy/Caddyfile
"${GCLOUD[@]}" compute scp "$ARCHIVE" "$APP_NAME:/tmp/ed-source.tar.gz" --zone="$ZONE" --tunnel-through-iap --quiet
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
if [[ "$AUTO_DOMAIN" == 1 ]]; then
  printf '\nTemporary HTTPS address: https://%s (depends on public sslip.io DNS).\n' "$APP_DOMAIN"
else
  printf '\nDNS: create an A record for %s pointing to %s.\n' "$APP_DOMAIN" "$APP_IP"
fi
printf 'After DNS propagation, check HTTPS at https://%s\n' "$APP_DOMAIN"
printf 'Create the super admin interactively (never put its password in a command):\n'
printf 'gcloud --project=%s compute ssh %s --zone=%s --tunnel-through-iap\n' "$PROJECT_ID" "$APP_NAME" "$ZONE"
printf 'Then: sudo bash -c '\''cd /srv/ed/deploy && docker-compose -p ed --env-file .env -f compose.yaml exec app npm run create-super-admin'\''\n'
