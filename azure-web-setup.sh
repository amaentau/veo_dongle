#!/bin/bash

# Azure Setup Script for Espa-TV (BBS + IoT Hub)
echo "Setting up Azure services for Espa-TV..."

# 1. Login to Azure
echo "Step 1: Logging into Azure..."
az login

# 2. Variables (Edit these if needed)
RG="EspaTvResourceGroup"
LOC="eastus"
STORAGE_NAME="espatvstorage$(date +%s | cut -c1-6)" # Ensure uniqueness
IOT_HUB_NAME="espa-tv-iot-hub-$(date +%s | cut -c1-6)"
APP_NAME="espa-tv-app-$(date +%s | cut -c1-6)"

echo "Using Resource Group: $RG"
echo "Using Location: $LOC"

# 2. Create Resource Group
echo "Step 2: Creating Resource Group..."
az group create --name "$RG" --location "$LOC"

# 3. Create Storage Account (for Table Storage)
echo "Step 3: Creating Storage Account..."
az storage account create \
  --name "$STORAGE_NAME" \
  --resource-group "$RG" \
  --location "$LOC" \
  --sku Standard_LRS \
  --kind StorageV2

STORAGE_CONN=$(az storage account show-connection-string -g "$RG" -n "$STORAGE_NAME" --query connectionString -o tsv)

# 4. Create IoT Hub (Free Tier)
echo "Step 4: Creating IoT Hub (Free F1)..."
az iot hub create \
  --name "$IOT_HUB_NAME" \
  --resource-group "$RG" \
  --sku F1 \
  --partition-count 2

IOT_HUB_CONN=$(az iot hub connection-string show --hub-name "$IOT_HUB_NAME" --policy-name iothubowner --query connectionString -o tsv)
SUBSCRIPTION_ID=$(az account show --query id -o tsv)

# 5. Create App Service Plan (Free F1)
echo "Step 5: Creating App Service Plan..."
az appservice plan create \
  --name espa-tv-plan \
  --resource-group "$RG" \
  --location "$LOC" \
  --sku F1 \
  --is-linux

# 6. Create Web App (Node 22)
echo "Step 6: Creating Web App..."
az webapp create \
  --name "$APP_NAME" \
  --resource-group "$RG" \
  --plan espa-tv-plan \
  --runtime "NODE|22-lts"

# 7. Configure App Settings
echo "Step 7: Configuring App Settings..."
az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RG" \
  --settings \
    STORAGE_CONNECTION_STRING="$STORAGE_CONN" \
    IOT_HUB_NAME="$IOT_HUB_NAME" \
    IOT_HUB_RESOURCE_GROUP="$RG" \
    IOT_HUB_SUBSCRIPTION_ID="$SUBSCRIPTION_ID" \
    SCM_DO_BUILD_DURING_DEPLOYMENT=true \
    SCM_COMMAND_IDLE_TIMEOUT=600

# 8. Save local .env for reference
echo "Step 8: Saving local config to bbs/config.env..."
cat > bbs/config.env << EOF
STORAGE_CONNECTION_STRING="$STORAGE_CONN"
IOT_HUB_NAME="$IOT_HUB_NAME"
IOT_HUB_RESOURCE_GROUP="$RG"
IOT_HUB_SUBSCRIPTION_ID="$SUBSCRIPTION_ID"
EOF

echo "--------------------------------------------------"
echo "Setup complete!"
echo "Web App URL: https://$APP_NAME.azurewebsites.net"
echo "IoT Hub: $IOT_HUB_NAME"
echo "Storage Account: $STORAGE_NAME"
echo "--------------------------------------------------"
echo "Next: Go to bbs/ and run deploy-azure.sh or use 'az webapp deploy'"
