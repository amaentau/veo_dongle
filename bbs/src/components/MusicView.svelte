<script>
  import { onMount } from 'svelte';
  let { devices, selectedDeviceId = $bindable(), token } = $props();

  let tracks = $state([]);
  let loading = $state(false);
  let currentTrack = $state(null);
  let audioPlayer = $state(null);
  let isPlayingLocal = $state(false);

  async function loadLibrary() {
    loading = true;
    try {
      // Fetch both Table Storage library AND Blob Storage files
      const [tableRes, blobRes] = await Promise.all([
        fetch('/library/SONG', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/library/blob/music', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const tableTracks = await tableRes.json();
      const blobTracks = await blobRes.json();

      // Combine and sort by timestamp (newest first)
      tracks = [...blobTracks, ...tableTracks].sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
      );
    } catch (err) {
      console.error('Failed to load music library:', err);
    } finally {
      loading = false;
    }
  }

  onMount(loadLibrary);

  function playLocal(track) {
    currentTrack = track;
    isPlayingLocal = true;
    
    setTimeout(() => {
      if (audioPlayer) {
        audioPlayer.src = track.url;
        audioPlayer.load();
        audioPlayer.play().catch(e => console.error('Toisto epäonnistui:', e));
      }
    }, 0);
  }

  async function playRemote(track) {
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
          value1: track.url, 
          value2: track.title,
          eventType: 'SONG'
        })
      });
      if (!res.ok) throw new Error('Toisto epäonnistui');
      alert(`Musiikki "${track.title}" lähetetty soittimelle!`);
    } catch (err) {
      alert(err.message);
    }
  }
</script>

<div class="music-view fade-in">
  {#if devices && devices.length > 0}
    <div class="card header-card">
      <div class="form-group">
        <label for="deviceSelect">Toistava laite (Pi)</label>
        <select id="deviceSelect" bind:value={selectedDeviceId}>
          {#each devices as dev}
            <option value={dev.id}>{dev.friendlyName || dev.id}</option>
          {/each}
        </select>
      </div>
    </div>
  {/if}

  <div class="tracks-container">
    <h3 style="margin-bottom: 16px; color: var(--primary-color);">Kirjaston Kappaleet</h3>
    
    {#if loading}
      <div class="loader"></div>
    {:else}
      <div class="track-list">
        {#each tracks as track}
          <div class="track-item {currentTrack?.rowKey === track.rowKey ? 'active' : ''}">
            <div class="track-info">
              <span class="track-title">{track.title}</span>
              <span class="track-artist">Lähettäjä: {track.creatorEmail}</span>
            </div>
            <div class="track-actions">
              <button class="icon-btn" onclick={() => playLocal(track)} title="Toista tässä">▶️</button>
              {#if selectedDeviceId}
                <button class="icon-btn" onclick={() => playRemote(track)} title="Toista soittimella">📺</button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="empty-state">Kirjastossa ei ole vielä musiikkia.</div>
        {/each}
      </div>
    {/if}
  </div>

  {#if currentTrack && isPlayingLocal}
    <div class="local-player-bar fade-in">
      <div class="card player-card">
        <div class="now-playing">
          <strong>Nyt soi:</strong> {currentTrack.title}
          <button class="close-btn" onclick={() => isPlayingLocal = false}>✕</button>
        </div>
        <audio 
          bind:this={audioPlayer} 
          src={currentTrack.url} 
          controls 
          style="width: 100%; margin-top: 10px;"
        ></audio>
      </div>
    </div>
  {/if}
</div>

<style>
  .music-view {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
  }

  .header-card {
    padding: 16px 24px;
  }

  .track-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .track-item {
    background: white;
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    padding: 12px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: all 0.2s ease;
  }

  .track-item:hover {
    border-color: var(--primary-color);
  }

  .track-item.active {
    border-color: var(--primary-color);
    background: rgba(21, 112, 57, 0.05);
  }

  .track-info {
    display: flex;
    flex-direction: column;
  }

  .track-title {
    font-weight: 700;
    font-size: 15px;
  }

  .track-artist {
    font-size: 12px;
    color: var(--text-sub);
  }

  .track-actions {
    display: flex;
    gap: 8px;
  }

  .icon-btn {
    background: none;
    border: 1px solid var(--border-color);
    padding: 8px;
    border-radius: 50%;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    transition: all 0.2s ease;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn:hover {
    background: #f0f0f0;
    transform: scale(1.1);
  }

  .local-player-bar {
    position: sticky;
    bottom: 0;
    margin-top: 20px;
    z-index: 30;
  }

  .player-card {
    padding: 12px 16px;
    background: white;
    box-shadow: 0 -4px 12px rgba(0,0,0,0.1);
  }

  .now-playing {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
    align-items: center;
  }

  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 18px;
    padding: 0 5px;
  }
</style>

