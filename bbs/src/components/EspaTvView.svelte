<script>
  import { onMount } from 'svelte';

  let { authState, devices, selectedDeviceId = $bindable(), token } = $props();

  let streams = $state([]);
  let loading = $state(false);
  let error = $state('');
  let selectedStream = $state(null);

  async function loadStreams() {
    if (!selectedDeviceId) return;
    loading = true;
    error = '';
    try {
      // Reuse the existing entries endpoint to get the history for the selected device
      const res = await fetch(`/entries/${encodeURIComponent(selectedDeviceId)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Striimejä ei voitu hakea');
      streams = await res.json();
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  onMount(loadStreams);

  $effect(() => {
    if (selectedDeviceId) loadStreams();
  });

  async function playRemote(stream) {
    if (!selectedDeviceId) return;
    try {
      const res = await fetch('/entry', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          key: selectedDeviceId, 
          value1: stream.value1, 
          value2: stream.value2,
          gameGroup: stream.gameGroup,
          eventType: stream.eventType,
          opponent: stream.opponent,
          isHome: stream.isHome,
          scoreHome: stream.scoreHome,
          scoreAway: stream.scoreAway
        })
      });
      if (!res.ok) throw new Error('Toisto epäonnistui');
      alert(`Striimi lähetetty laitteelle!`);
    } catch (err) {
      alert(err.message);
    }
  }

  function playLocal(stream) {
    window.open(stream.value1, '_blank');
  }

  function formatTitle(stream) {
    if (stream.isHome !== false) {
      return `${stream.gameGroup || 'EsPa'} vs ${stream.opponent || '???'}`;
    } else {
      return `${stream.opponent || '???'} vs ${stream.gameGroup || 'EsPa'}`;
    }
  }
</script>

<div class="espatv-view fade-in">
  <div class="card header-card">
    <div class="form-group">
      <label for="deviceSelect">Katseltava laite (Pi)</label>
      <select id="deviceSelect" bind:value={selectedDeviceId}>
        {#each devices as dev}
          <option value={dev.id}>{dev.friendlyName || dev.id}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="streams-container">
    <h3 style="margin-bottom: 16px; color: var(--primary-color);">Valitse Striimi</h3>
    
    {#if loading}
      <div class="loader"></div>
    {:else if error}
      <div class="status-msg error">{error}</div>
    {:else if streams.length === 0}
      <div class="empty-state">Ei striimejä saatavilla.</div>
    {:else}
      <div class="stream-grid">
        {#each streams as stream}
          <button 
            class="stream-card {selectedStream?.rowKey === stream.rowKey ? 'active' : ''}"
            onclick={() => selectedStream = stream}
          >
            <div class="stream-info">
              <span class="badge badge-{stream.eventType?.toLowerCase().replace(/\s+/g, '') || 'default'}">{stream.eventType || 'Video'}</span>
              <div class="title">{formatTitle(stream)}</div>
              <div class="date">{new Date(stream.timestamp).toLocaleDateString('fi-FI')}</div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if selectedStream}
    <div class="action-panel fade-in">
      <div class="card">
        <h4>{formatTitle(selectedStream)}</h4>
        <div class="actions">
          <button class="action-btn local" onclick={() => playLocal(selectedStream)}>
            <span class="icon">📱</span> Katso tässä
          </button>
          <button class="action-btn remote" onclick={() => playRemote(selectedStream)}>
            <span class="icon">📺</span> Toista soittimella
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .espatv-view {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
  }

  .header-card {
    padding: 16px 24px;
  }

  .stream-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .stream-card {
    background: white;
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    padding: 16px;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
  }

  .stream-card:hover {
    border-color: var(--primary-color);
    transform: translateY(-2px);
  }

  .stream-card.active {
    border-color: var(--primary-color);
    background: rgba(21, 112, 57, 0.05);
    box-shadow: 0 4px 12px rgba(21, 112, 57, 0.1);
  }

  .title {
    font-weight: 700;
    font-size: 16px;
    color: var(--text-main);
  }

  .date {
    font-size: 12px;
    color: var(--text-sub);
  }

  .action-panel {
    position: sticky;
    bottom: 0;
    margin-top: 10px;
    z-index: 20;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 16px;
  }

  .action-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px;
    font-size: 14px;
    border-radius: var(--radius);
  }

  .action-btn.local {
    background: #f0f0f0;
    color: var(--text-main);
  }

  .action-btn.remote {
    background: var(--primary-color);
  }

  .action-btn .icon {
    font-size: 24px;
  }

  .badge-default { background: var(--text-sub); }
</style>

