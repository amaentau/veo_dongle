# Azure Setup Script for Espa-TV (BBS + IoT Hub) - PowerShell
Write-Host "Setting up Azure services for Espa-TV..." -ForegroundColor Green

# 1. Login to Azure
Write-Host "Step 1: Logging into Azure..." -ForegroundColor Yellow
az login

# 2. Variables
$timestamp = Get-Date -UFormat "%S%M%H"
$RG = "EspaTvResourceGroup"
$LOC = "eastus"
$STORAGE_NAME = "espatvstorage$timestamp"
$IOT_HUB_NAME = "espa-tv-iot-hub-$timestamp"
$APP_NAME = "espa-tv-app-$timestamp"

Write-Host "Using Resource Group: $RG"
Write-Host "Using Location: $LOC"

# 2. Create Resource Group
Write-Host "Step 2: Creating Resource Group..." -ForegroundColor Yellow
az group create --name $RG --location $LOC

# 3. Create Storage Account
Write-Host "Step 3: Creating Storage Account..." -ForegroundColor Yellow
az storage account create `
  --name $STORAGE_NAME `
  --resource-group $RG `
  --location $LOC `
  --sku Standard_LRS `
  --kind StorageV2

$STORAGE_CONN = az storage account show-connection-string -g $RG -n $STORAGE_NAME --query connectionString -o tsv

# 4. Create IoT Hub (Free Tier)
Write-Host "Step 4: Creating IoT Hub (Free F1)..." -ForegroundColor Yellow
az iot hub create `
  --name $IOT_HUB_NAME `
  --resource-group $RG `
  --sku F1 `
  --partition-count 2

$IOT_HUB_CONN = az iot hub connection-string show --hub-name $IOT_HUB_NAME --policy-name iothubowner --query connectionString -o tsv
$SUBSCRIPTION_ID = az account show --query id -o tsv

# 5. Create App Service Plan (Free F1)
Write-Host "Step 5: Creating App Service Plan..." -ForegroundColor Yellow
az appservice plan create `
  --name espa-tv-plan `
  --resource-group $RG `
  --location $LOC `
  --sku F1 `
  --is-linux

# 6. Create Web App (Node 22)
Write-Host "Step 6: Creating Web App..." -ForegroundColor Yellow
az webapp create `
  --name $APP_NAME `
  --resource-group $RG `
  --plan espa-tv-plan `
  --runtime "NODE|22-lts"

# 7. Configure App Settings
Write-Host "Step 7: Configuring App Settings..." -ForegroundColor Yellow
az webapp config appsettings set `
  --name $APP_NAME `
  --resource-group $RG `
  --settings `
    STORAGE_CONNECTION_STRING="$STORAGE_CONN" `
    IOT_HUB_NAME="$IOT_HUB_NAME" `
    IOT_HUB_RESOURCE_GROUP="$RG" `
    IOT_HUB_SUBSCRIPTION_ID="$SUBSCRIPTION_ID" `
    SCM_DO_BUILD_DURING_DEPLOYMENT=true `
    SCM_COMMAND_IDLE_TIMEOUT=600

# 8. Save local config
Write-Host "Step 8: Saving local config to bbs/config.env..." -ForegroundColor Yellow
$configContent = @"
STORAGE_CONNECTION_STRING="$STORAGE_CONN"
IOT_HUB_NAME="$IOT_HUB_NAME"
IOT_HUB_RESOURCE_GROUP="$RG"
IOT_HUB_SUBSCRIPTION_ID="$SUBSCRIPTION_ID"
"@
$configContent | Out-File -FilePath "bbs/config.env" -Encoding utf8

Write-Host "--------------------------------------------------" -ForegroundColor Cyan
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host "Web App URL: https://$APP_NAME.azurewebsites.net" -ForegroundColor White
Write-Host "IoT Hub: $IOT_HUB_NAME" -ForegroundColor White
Write-Host "Storage Account: $STORAGE_NAME" -ForegroundColor White
Write-Host "--------------------------------------------------" -ForegroundColor Cyan
