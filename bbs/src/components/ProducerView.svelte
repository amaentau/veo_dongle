<script>
  import DeviceSelector from './DeviceSelector.svelte';
  import EntryForm from './EntryForm.svelte';
  import IotControls from './IotControls.svelte';
  import History from './History.svelte';

  let { authState, onLogout, devices, selectedDeviceId = $bindable(), targetDeviceIds = $bindable(), metadata, onDevicesChanged, historyRefreshTrigger, refreshHistory } = $props();
</script>

<div class="producer-view fade-in">
  <div class="card">
    <DeviceSelector 
      {devices} 
      bind:selectedDeviceId 
      bind:targetDeviceIds 
      token={authState.token}
      onDevicesChanged={onDevicesChanged}
    />

    <EntryForm 
      {metadata} 
      {targetDeviceIds} 
      token={authState.token} 
      onEntryAdded={refreshHistory}
    />
  </div>

  <IotControls 
    deviceId={selectedDeviceId} 
    token={authState.token} 
  />

  <History 
    deviceId={selectedDeviceId} 
    token={authState.token} 
    isAdmin={authState.isAdmin}
    userGroup={authState.userGroup}
    username={authState.username}
    refreshTrigger={historyRefreshTrigger}
  />
</div>

<style>
  .producer-view {
    display: flex;
    flex-direction: column;
    gap: 24px;
    width: 100%;
  }
</style>

