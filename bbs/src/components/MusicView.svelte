<script>
  import { onMount } from 'svelte';
  import { deviceState, playMedia } from '../lib/deviceState.svelte.js';
  import SocialSection from './SocialSection.svelte';
  
  let { token, authState } = $props();

  let tracks = $state([]);
  let loading = $state(false);
  let showSocial = $state(false);
  let socialTargetId = $state(null);

  async function loadLibrary() {
    loading = true;
    try {
      // Fetch both Table Storage library AND Blob Storage files
      const [tableRes, blobRes] = await Promise.all([
        fetch('/library/SONG', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/library/blob/song', {
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

  function handlePlay(track, forceLocal = false) {
    playMedia({
      title: track.title,
      url: track.url,
      type: 'SONG',
      rowKey: track.rowKey
    }, forceLocal);
  }

  function openSocial(track) {
    socialTargetId = track.rowKey;
    showSocial = true;
  }
</script>

<div class="music-view fade-in">
  <div class="tracks-container">
    <h3 style="margin-bottom: 16px; color: var(--primary-color);">Kirjaston Kappaleet</h3>
    
    {#if loading}
      <div class="loader"></div>
    {:else}
      <div class="track-list">
        {#each tracks as track}
          <div class="track-item {deviceState.currentMedia?.rowKey === track.rowKey ? 'active' : ''}">
            <div class="track-info">
              <span class="track-title">{track.title}</span>
              <span class="track-artist">Lähde: {track.creatorEmail}</span>
            </div>
            <div class="track-actions">
              <button 
                class="icon-btn social-btn" 
                onclick={() => openSocial(track)} 
                title="Kommentit ja reaktiot"
              >
                💬
              </button>

              <button 
                class="icon-btn local" 
                onclick={() => handlePlay(track, true)} 
                title="Kuuntele tässä"
              >
                📱
              </button>
              
              {#if deviceState.devices.length > 0}
                <button 
                  class="icon-btn {deviceState.isPiActive ? 'remote' : 'offline'}" 
                  onclick={() => handlePlay(track, false)} 
                  disabled={!deviceState.isPiActive}
                  title={deviceState.isPiActive ? 'Toista soittimelle' : 'Soitin ei ole linjoilla'}
                >
                  ▶️
                </button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="empty-state">Kirjastossa ei ole vielä musiikkia.</div>
        {/each}
      </div>
    {/if}
  </div>

  {#if showSocial}
    <SocialSection 
      targetId={socialTargetId} 
      token={token} 
      username={authState.username} 
      userEmail={authState.userEmail}
      onClose={() => showSocial = false} 
    />
  {/if}
</div>

<style>
  .music-view {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    padding-bottom: 80px; /* Space for global control bar */
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
    padding: 12px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    transition: all 0.2s ease;
    width: 100%;
    min-width: 0;
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
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .track-title {
    font-weight: 700;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-artist {
    font-size: 11px;
    color: var(--text-sub);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-actions {
    display: flex;
    gap: 8px;
  }

  @media (max-width: 380px) {
    .track-item {
      padding: 10px 12px;
    }
    
    .icon-btn {
      width: 36px;
      height: 36px;
      font-size: 16px;
    }
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

  .icon-btn.local {
    background-color: #f0f0f0;
    font-size: 16px;
  }

  .icon-btn.remote {
    background-color: var(--primary-color);
    color: white;
    border-color: var(--primary-color);
  }

  .icon-btn.offline {
    background-color: #eee;
    color: #ccc;
    cursor: not-allowed;
    border-color: #eee;
  }
</style>
