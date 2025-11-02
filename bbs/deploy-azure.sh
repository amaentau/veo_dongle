#!/usr/bin/env bash
set -euo pipefail

# Minimal, free-tier Azure deployment for the BBS app (Node.js + Azure Table Storage)
# Requirements: az CLI logged in, Bash (WSL ok), zip, jq (optional), Node 18+ locally

# Usage:
#   ./deploy-azure.sh <resource-group> <region> <storage-name> <app-name>
# Example:
#   ./deploy-azure.sh bbs-rg eastus bbsstor1234 bbs-web-1234

if [ $# -lt 4 ]; then
  echo "Usage: $0 <resource-group> <region> <storage-name> <app-name>"
  exit 1
fi

# Preflight: ensure zip is available (required by config-zip)
if ! command -v zip >/dev/null 2>&1; then
  echo "ERROR: 'zip' is not installed. Install it in WSL with:"
  echo "  sudo apt update && sudo apt install -y zip"
  exit 1
fi

RG="$1"
LOC="$2"
STORAGE_NAME="$3"   # must be globally unique, lower-case, 3-24 alphanumeric
APP_NAME="$4"       # must be globally unique within Azure Web Apps

echo "Creating resource group: $RG ($LOC)"
az group create --name "$RG" --location "$LOC" 1>/dev/null

echo "Creating Storage Account: $STORAGE_NAME (Standard_LRS)"
az storage account create \
  --name "$STORAGE_NAME" \
  --resource-group "$RG" \
  --location "$LOC" \
  --sku Standard_LRS \
  --kind StorageV2 1>/dev/null

CONN_STR=$(az storage account show-connection-string -g "$RG" -n "$STORAGE_NAME" --query connectionString -o tsv)

echo "Ensuring table: bbsEntries"
az storage table create \
  --account-name "$STORAGE_NAME" \
  --name bbsEntries \
  --auth-mode key 1>/dev/null || true

echo "Creating App Service Plan (Free F1)"
az appservice plan create \
  --name bbs-plan \
  --resource-group "$RG" \
  --location "$LOC" \
  --sku F1 \
  --is-linux 1>/dev/null

echo "Creating Web App: $APP_NAME (Node 22)"
az webapp create \
  --name "$APP_NAME" \
  --resource-group "$RG" \
  --plan bbs-plan \
  --runtime "NODE|22-lts" 1>/dev/null

echo "Configuring app settings"
az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RG" \
  --settings \
    STORAGE_CONNECTION_STRING="$CONN_STR" \
    TABLE_NAME="bbsEntries" 1>/dev/null

echo "Configuring build during deployment"
az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RG" \
  --settings SCM_DO_BUILD_DURING_DEPLOYMENT=true 1>/dev/null

echo "Deploying app (zip)"
pushd "$(dirname "$0")" >/dev/null
TMP_ZIP="bbs.zip"
rm -f "$TMP_ZIP"
# Exclude common dev artifacts; Oryx will run npm install on Azure
zip -qr "$TMP_ZIP" . -x "node_modules/*" ".git/*" "*.zip"
popd >/dev/null

az webapp deployment source config-zip \
  --resource-group "$RG" \
  --name "$APP_NAME" \
  --src "$(dirname "$0")/bbs.zip" 1>/dev/null

URL="https://$APP_NAME.azurewebsites.net"
echo "Deployment complete. App URL: $URL"
echo "Try opening: $URL"


