# 🚀 Azure Deployment Guide for Veo Dongle Web App

## Prerequisites

- Azure subscription (free tier available)
- GitHub account (for deployment)
- Your web app files ready

## Option 1: Automated Deployment (Recommended)

### Step 1: Install Azure CLI
```powershell
# Download and install Azure CLI
Invoke-WebRequest -Uri "https://aka.ms/installazurecliwindows" -OutFile "AzureCLI.msi"
Start-Process "AzureCLI.msi" -Wait
```

### Step 2: Run Setup Script
```powershell
# Run the PowerShell setup script
.\azure-web-setup.ps1
```

### Step 3: Deploy to Azure Static Web Apps
```powershell
# Create Static Web App
az staticwebapp create `
  --name veo-dongle-web `
  --resource-group veo-dongle-rg `
  --location eastus `
  --source https://github.com/YOUR_USERNAME/YOUR_REPO `
  --build-properties appLocation="/web-app" apiLocation="" outputLocation="" `
  --sku Free

# Get the deployment URL
az staticwebapp show --name veo-dongle-web --resource-group veo-dongle-rg --query defaultHostname
```

## Option 2: Manual Azure Portal Deployment

### Step 1: Create Azure Static Web App
1. Go to [Azure Portal](https://portal.azure.com)
2. Click "Create a resource"
3. Search for "Static Web App"
4. Click "Create"
5. Fill in details:
   - **Subscription**: Your subscription
   - **Resource Group**: `veo-dongle-rg` (or create new)
   - **Name**: `veo-dongle-web`
   - **Plan**: Free
   - **Region**: East US
   - **Deployment Source**: GitHub
6. Connect to your GitHub repository
7. Configure build settings:
   - **App location**: `/web-app`
   - **API location**: (leave empty)
   - **Output location**: (leave empty)

### Step 2: Create Azure SignalR Service
1. In Azure Portal, search for "SignalR"
2. Click "Create"
3. Fill in details:
   - **Resource Group**: `veo-dongle-rg`
   - **Name**: `veo-dongle-signalr`
   - **Location**: East US
   - **Pricing tier**: Free (F1)
4. Click "Create"

### Step 3: Create Cosmos DB
1. Search for "Azure Cosmos DB"
2. Click "Create"
3. Choose "Azure Cosmos DB for NoSQL"
4. Fill in details:
   - **Resource Group**: `veo-dongle-rg`
   - **Account Name**: `veo-dongle-cosmos`
   - **Location**: East US
   - **Capacity mode**: Serverless (free tier)
5. Create database: `veo-dongle-db`
6. Create container: `devices` with partition key `/id`

## Option 3: Quick GitHub Pages Deployment (No Azure Required)

### Step 1: Create GitHub Repository
1. Go to GitHub.com
2. Create new repository: `veo-dongle-web`
3. Upload all files from `web-app/` folder

### Step 2: Enable GitHub Pages
1. Go to repository Settings
2. Scroll to "Pages" section
3. Select "Deploy from a branch"
4. Choose `main` branch and `/ (root)` folder
5. Save

### Step 3: Access Your Site
- URL: `https://YOUR_USERNAME.github.io/veo-dongle-web`
- No cost, instant deployment!

## Configuration

### Update API Settings in Web App

After deployment, update the API URL in your web app:

1. Open the deployed web app
2. Go to Settings
3. Set API Base URL to your backend URL:
   - Local development: `http://localhost:4000`
   - Azure Functions: `https://veo-dongle-api.azurewebsites.net`
   - Your server: `https://your-server.com`

### Environment Variables (for Azure Functions)

If using Azure Functions, set these environment variables:

```bash
SIGNALR_CONNECTION_STRING=your-signalr-connection-string
COSMOS_DB_CONNECTION_STRING=your-cosmos-connection-string
```

## Testing Your Deployment

1. **Open the web app** in your browser
2. **Check Settings** - Update API URL
3. **Test device discovery** - Should show connected devices
4. **Test device control** - Try play/pause commands
5. **Test stream URL** - Send a Veo URL to test

## Troubleshooting

### Web App Not Loading
- Check browser console for errors
- Verify API URL is correct in Settings
- Ensure backend server is running

### Devices Not Showing
- Check backend server logs
- Verify network connectivity
- Ensure devices are registered

### Commands Not Working
- Check browser developer tools (F12)
- Verify API endpoints are accessible
- Check backend server for errors

## Cost Optimization

- **Free Tier Limits**:
  - Azure Static Web Apps: 100GB bandwidth/month
  - Azure SignalR: 20 concurrent connections
  - Azure Functions: 1M executions/month
  - Cosmos DB: 5GB storage

- **Monitor Usage**: Check Azure Portal for usage metrics

## Next Steps

1. **Deploy your backend** to Azure Functions or your server
2. **Test with real devices** (Raspberry Pi)
3. **Share the web app URL** with your users
4. **Monitor usage** in Azure Portal

## Support

- Azure Documentation: https://docs.microsoft.com/azure
- Static Web Apps: https://docs.microsoft.com/azure/static-web-apps
- SignalR: https://docs.microsoft.com/azure/azure-signalr

---

🎉 **Congratulations! Your Veo Dongle web app is now deployed and ready to use!**



























