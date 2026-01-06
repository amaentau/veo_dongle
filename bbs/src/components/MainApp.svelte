<script>
  import { onMount } from 'svelte';
  import Header from './Header.svelte';
  import MenuSpinner from './MenuSpinner.svelte';
  import ProducerView from './ProducerView.svelte';
  import EspaTvView from './EspaTvView.svelte';
  import MusicView from './MusicView.svelte';
  import SettingsView from './SettingsView.svelte';
  import AdminModal from './modals/AdminModal.svelte';

  let { authState, onLogout } = $props();
  
  let devices = $state([]);
  let selectedDeviceId = $state('');
  let targetDeviceIds = $state([]);
  let metadata = $state({ gameGroups: [], eventTypes: [] });
  let showAdminModal = $state(false);
  let historyRefreshTrigger = $state(0);
  let activeView = $state('producer'); // Default to producer view for now

  async function loadMetadata() {
    try {
      const res = await fetch('/config/metadata');
      metadata = await res.json();
    } catch (err) {
      console.error('Failed to load metadata:', err);
    }
  }

  async function loadDevices() {
    try {
      const res = await fetch('/devices', {
        headers: { 'Authorization': `Bearer ${authState.token}` }
      });
      if (res.status === 401 || res.status === 403) { onLogout(); return; }
      devices = await res.json();
      if (devices.length > 0 && !selectedDeviceId) {
        selectedDeviceId = devices[0].id;
        targetDeviceIds = [selectedDeviceId];
      }
    } catch (err) {
      console.error('Failed to load devices:', err);
    }
  }

  onMount(() => {
    loadMetadata();
    loadDevices();
  });

  const refreshHistory = () => historyRefreshTrigger++;
  const onDevicesChanged = () => loadDevices();
</script>

<div class="app-layout fade-in">
  <Header email={authState.userEmail} {onLogout} />

  {#if authState.isAdmin}
    <div style="text-align:center; margin-bottom:8px;">
      <button onclick={() => showAdminModal = true} class="admin-link-btn">
        🔧 Hallinta
      </button>
    </div>
  {/if}

  <MenuSpinner 
    bind:activeView 
    isAdmin={authState.isAdmin} 
    userGroup={authState.userGroup} 
  />

  <div class="view-content">
    {#if activeView === 'producer'}
      <ProducerView 
        {authState} 
        {onLogout} 
        {devices} 
        bind:selectedDeviceId 
        bind:targetDeviceIds 
        {metadata}
        {onDevicesChanged}
        {historyRefreshTrigger}
        {refreshHistory}
      />
    {:else if activeView === 'settings'}
      <SettingsView 
        {authState} 
        onLogout={onLogout} 
        onOpenAdmin={() => showAdminModal = true}
      />
    {:else if activeView === 'tv'}
      <EspaTvView 
        {authState} 
        {devices} 
        bind:selectedDeviceId 
        token={authState.token}
      />
    {:else if activeView === 'music'}
      <MusicView 
        {devices} 
        bind:selectedDeviceId 
        token={authState.token}
      />
    {/if}
  </div>
</div>

{#if showAdminModal}
  <AdminModal 
    token={authState.token} 
    userEmail={authState.userEmail}
    onClose={() => showAdminModal = false} 
    onMetadataChanged={loadMetadata}
  />
{/if}

<style>
  .app-layout {
    width: 100%;
    max-width: 480px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    padding-bottom: 40px;
  }

  .view-content {
    padding: 0 20px;
    flex: 1;
  }

  .admin-link-btn {
    width: auto; 
    padding: 4px 12px; 
    font-size: 12px; 
    background-color: transparent; 
    color: var(--text-sub);
    border: 1px solid var(--border-color);
    margin: 0;
  }
  .admin-link-btn:hover {
    background-color: #f0f0f0;
    color: var(--primary-color);
  }
</style>
