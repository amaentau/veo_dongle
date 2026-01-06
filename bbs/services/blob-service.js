const { 
  BlobServiceClient, 
  generateBlobSASQueryParameters, 
  BlobSASPermissions, 
  SASProtocol 
} = require("@azure/storage-blob");
const { DefaultAzureCredential } = require("@azure/identity");

// Configuration
const accountName = process.env.STORAGE_ACCOUNT_NAME || "espatvstorage";
const containerName = "music";

let blobServiceClient = null;
let userDelegationKey = null;
let keyExpiry = null;

function getBlobServiceClient() {
  if (!blobServiceClient) {
    const accountUrl = `https://${accountName}.blob.core.windows.net`;
    blobServiceClient = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
  }
  return blobServiceClient;
}

/**
 * Gets a User Delegation Key for SAS token generation using Managed Identity.
 * The key is valid for up to 6 days (Azure limit is 7).
 */
async function getUserDelegationKey() {
  const now = new Date();
  if (userDelegationKey && keyExpiry && now < keyExpiry) {
    return userDelegationKey;
  }

  const client = getBlobServiceClient();
  const startTime = new Date(now.getTime() - 5 * 60 * 1000); // 5 mins ago for clock skew
  const endTime = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000); // 6 days from now

  const response = await client.getUserDelegationKey(startTime, endTime);
  userDelegationKey = response;
  keyExpiry = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // Refresh after 5 days
  return userDelegationKey;
}

/**
 * Lists blobs in the music container and generates a SAS token for each.
 */
async function listMusicBlobs() {
  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(containerName);
  const delegationKey = await getUserDelegationKey();

  const blobs = [];
  const now = new Date();
  const expiryTime = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours expiry for individual links

  for await (const blob of containerClient.listBlobsFlat()) {
    const blobClient = containerClient.getBlobClient(blob.name);
    
    const sasOptions = {
      containerName,
      blobName: blob.name,
      permissions: BlobSASPermissions.parse("r"), // Read only
      protocol: SASProtocol.HttpsAndHttp,
      startsOn: now,
      expiresOn: expiryTime,
    };

    const sasToken = generateBlobSASQueryParameters(
      sasOptions,
      delegationKey,
      accountName
    ).toString();

    blobs.push({
      rowKey: `blob-${blob.name}`, // Compatible with track object
      title: blob.name,           // Use filename as title
      url: `${blobClient.url}?${sasToken}`,
      creatorEmail: 'System (Blob Storage)',
      timestamp: blob.properties.lastModified
    });
  }

  return blobs;
}

/**
 * Uploads a file to the music container.
 */
async function uploadMusicBlob(fileName, buffer, contentType, creatorEmail) {
  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(fileName);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
    metadata: {
      creatorEmail: creatorEmail,
      uploadedAt: new Date().toISOString()
    }
  });

  return blockBlobClient.url;
}

module.exports = {
  listMusicBlobs,
  uploadMusicBlob
};

