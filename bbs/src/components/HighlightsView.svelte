<script>
  import { onMount } from 'svelte';
  import { deviceState, playMedia } from '../lib/deviceState.svelte.js';
  import { isMediaCached, preCacheMedia, removeFromCache } from '../lib/cacheUtils.js';
  import SocialSection from './SocialSection.svelte';

  let { authState, token } = $props();

  let streams = $state([]);
  let loading = $state(false);
  let error = $state('');
  let selectedStream = $state(null);
  let showLocalPlayer = $state(false);
  let showSocial = $state(false);
  let socialTargetId = $state(null);
  let cacheStatus = $state({}); // rowKey -> boolean
  let videoElement = $state(null);

  async function checkCacheStatus() {
    const status = {};
    for (const stream of streams) {
      status[stream.rowKey] = await isMediaCached(stream.url);
    }
    cacheStatus = status;
  }

  async function toggleCache(stream) {
    if (cacheStatus[stream.rowKey]) {
      await removeFromCache(stream.url);
    } else {
      await preCacheMedia(stream.url);
    }
    setTimeout(checkCacheStatus, 500);
  }

  async function handleOrientationChange() {
    if (!showLocalPlayer || !videoElement) return;
    const isLandscape = window.innerWidth > window.innerHeight;
    
    try {
      if (isLandscape) {
        if (!document.fullscreenElement) {
          if (videoElement.requestFullscreen) {
            await videoElement.requestFullscreen();
          } else if (videoElement.webkitRequestFullscreen) {
            await videoElement.webkitRequestFullscreen();
          }
        }
      } else {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen transition failed:', err);
    }
  }

  async function loadLibrary() {
    loading = true;
    error = '';
    try {
      const res = await fetch('/library/blob/video', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) throw new Error('Videoita ei voitu hakea');
      
      const data = await res.json();
      streams = data.sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
      );
      
      await checkCacheStatus();
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadLibrary();
    window.addEventListener('resize', handleOrientationChange);
    return () => {
      window.removeEventListener('resize', handleOrientationChange);
    };
  });

  function handlePlayRemote(stream) {
    playMedia({
      title: stream.title,
      url: stream.url,
      type: 'VEO',
      metadata: stream.metadata
    });
  }

  function handlePlayLocal(stream) {
    showLocalPlayer = true;
    setTimeout(() => {
      const panel = document.querySelector('.action-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }

  function toggleFullscreen() {
    if (!videoElement) return;
    if (!document.fullscreenElement) {
      if (videoElement.requestFullscreen) videoElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  function closeLocalPlayer() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    }
    showLocalPlayer = false;
  }

  function openSocial(stream) {
    socialTargetId = stream.rowKey;
    showSocial = true;
  }
</script>

<div class="highlights-view fade-in">
  <div class="streams-container">
    <h3 style="margin-bottom: 16px; color: var(--primary-color);">Videot</h3>
    
    {#if loading}
      <div class="loader"></div>
    {:else if error}
      <div class="status-msg error">{error}</div>
    {:else}
      <div class="stream-list">
        {#each streams as stream}
          <div class="stream-item {selectedStream?.rowKey === stream.rowKey ? 'active' : ''}">
            <div class="stream-info" onclick={() => selectedStream = stream} onkeydown={(e) => e.key === 'Enter' && (selectedStream = stream)} role="button" tabindex="0">
              <div class="stream-main-info">
                <span class="title">{stream.title}</span>
                <span class="date">{new Date(stream.timestamp).toLocaleDateString('fi-FI')}</span>
              </div>
              <div class="stream-sub-info">
                <span class="badge badge-{stream.metadata?.eventType?.toLowerCase().replace(/\s+/g, '') || 'default'}">{stream.metadata?.eventType || 'Video'}</span>
                <span class="creator">Lähde: {stream.creatorEmail}</span>
              </div>
            </div>
            
            <div class="stream-actions">
              <button 
                class="icon-btn social-btn" 
                onclick={(e) => { e.stopPropagation(); openSocial(stream); }} 
                title="Kommentit ja reaktiot"
              >
                💬
              </button>

              <button 
                class="icon-btn cache {cacheStatus[stream.rowKey] ? 'cached' : ''}" 
                onclick={() => toggleCache(stream)}
                title={cacheStatus[stream.rowKey] ? 'Poista muistista' : 'Lataa muistiin'}
              >
                {cacheStatus[stream.rowKey] ? '💾' : '📥'}
              </button>

              <button 
                class="icon-btn local" 
                onclick={() => { selectedStream = stream; handlePlayLocal(stream); }} 
                title="Katso tässä"
              >
                📱
              </button>
              
              {#if deviceState.devices.length > 0}
                <button 
                  class="icon-btn {deviceState.isPiActive ? 'remote' : 'offline'}" 
                  onclick={() => handlePlayRemote(stream)} 
                  disabled={!deviceState.isPiActive}
                  title={deviceState.isPiActive ? 'Toista soittimelle' : 'Soitin ei ole linjoilla'}
                >
                  ▶️
                </button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="empty-state">Kirjastossa ei ole vielä videoita.</div>
        {/each}
      </div>
    {/if}
  </div>

  {#if selectedStream && showLocalPlayer}
    <div class="action-panel fade-in">
      <div class="card">
        <div class="card-header">
          <h4>{selectedStream.title}</h4>
          <button class="close-btn" onclick={closeLocalPlayer}>✕</button>
        </div>

        <div class="local-player-container">
          <video 
            bind:this={videoElement}
            src={selectedStream.url} 
            controls 
            autoplay 
            class="local-video"
          >
            <track kind="captions" />
            Selaimesi ei tue videotoistoa.
          </video>
          <button class="fullscreen-overlay-btn" onclick={toggleFullscreen} title="Koko näyttö">
            ⛶
          </button>
        </div>
      </div>
    </div>
  {/if}

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
  .highlights-view {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    padding-bottom: 80px;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    color: var(--text-sub);
  }

  .local-player-container {
    position: relative;
    width: 100%;
    background: black;
    border-radius: var(--radius);
    overflow: hidden;
    aspect-ratio: 16 / 9;
  }

  .fullscreen-overlay-btn {
    position: absolute;
    bottom: 10px;
    right: 10px;
    background: rgba(0, 0, 0, 0.5);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 18px;
    cursor: pointer;
    z-index: 10;
    transition: background 0.2s;
    display: none;
  }

  @media (hover: hover) {
    .fullscreen-overlay-btn { display: block; }
    .fullscreen-overlay-btn:hover { background: rgba(0, 0, 0, 0.8); }
  }

  .local-video {
    width: 100%;
    height: 100%;
  }

  .local-video:fullscreen { object-fit: contain; }

  .stream-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .stream-item {
    background: white;
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    padding: 12px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: all 0.2s ease;
  }

  .stream-item:hover { border-color: var(--primary-color); }
  .stream-item.active {
    border-color: var(--primary-color);
    background: rgba(21, 112, 57, 0.05);
  }

  .stream-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }

  .stream-main-info {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 2px;
  }

  .title {
    font-weight: 700;
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .date {
    font-size: 11px;
    color: var(--text-sub);
    white-space: nowrap;
  }

  .stream-sub-info {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .creator {
    font-size: 12px;
    color: var(--text-sub);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stream-actions {
    display: flex;
    gap: 8px;
    margin-left: 12px;
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

  .icon-btn.local { background-color: #f0f0f0; font-size: 16px; }
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
  .icon-btn.cache.cached {
    background-color: rgba(21, 112, 57, 0.1);
    border-color: var(--primary-color);
  }

  .action-panel {
    position: sticky;
    bottom: 0;
    margin-top: 10px;
    z-index: 2000;
  }

  .badge {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: bold;
    color: white;
    text-transform: uppercase;
  }

  .badge-default { background: #888; }
  .badge-highlights { background: #f39c12; }
  .badge-peli { background: #3498db; }
  .badge-haastattelu { background: #9b59b6; }
</style>

