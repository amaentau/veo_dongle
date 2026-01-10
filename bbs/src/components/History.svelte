<script>
  import { onMount } from 'svelte';
  import SocialSection from './SocialSection.svelte';

  let { deviceId, token, isAdmin, userGroup, refreshTrigger, username } = $props();

  let historyItems = $state([]);
  let loading = $state(false);
  let error = $state('');
  let showSocial = $state(false);
  let socialTargetId = $state(null);

  const canEdit = $derived(isAdmin || userGroup === 'Veo Ylläpitäjä');

  async function loadHistory() {
    if (!deviceId) return;
    loading = true;
    error = '';
    try {
      const res = await fetch(`/entries/${encodeURIComponent(deviceId)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Historiaa ei voitu hakea');
      historyItems = await res.json();
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (deviceId || refreshTrigger) loadHistory();
  });

  function timeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    if (seconds < 60) return 'Juuri nyt';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m sitten`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}t sitten`;
    return date.toLocaleDateString('fi-FI');
  }

  function getBadgeClass(eventType) {
    return `badge-${(eventType || '').toLowerCase().replace(/\s+/g, '')}`;
  }

  async function openScoreEdit(item) {
    const newSHome = prompt("Koti-tulos (jätä tyhjäksi jos ei tiedossa):", item.scoreHome ?? '');
    if (newSHome === null) return;
    const newSAway = prompt("Vieras-tulos (jätä tyhjäksi jos ei tiedossa):", item.scoreAway ?? '');
    if (newSAway === null) return;

    try {
      const res = await fetch(`/entries/${encodeURIComponent(deviceId)}/${encodeURIComponent(item.rowKey)}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ scoreHome: newSHome, scoreAway: newSAway })
      });
      if (!res.ok) throw new Error();
      loadHistory();
    } catch (err) {
      alert('Tuloksen päivitys epäonnistui');
    }
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function openSocial(item) {
    socialTargetId = item.rowKey;
    showSocial = true;
  }
</script>

<div class="history-section">
  <div class="history-header">
    <h3>Viimeisimmät</h3>
    <button class="refresh-btn" onclick={loadHistory}>Päivitä</button>
  </div>

  {#if loading}
    <div class="loader"></div>
  {:else if error}
    <div class="status-msg error">{error}</div>
  {:else if historyItems.length === 0}
    <div class="empty-state">Ei viimeaikaisia kohteita.</div>
  {:else}
    <ul class="history-list">
      {#each historyItems as item}
        <li class="history-item">
          <div class="item-header">
            <span class="item-title">
              {#if item.eventType}
                <span class="badge {getBadgeClass(item.eventType)}">{item.eventType}</span>
              {/if}
              {#if item.isHome !== false}
                {item.gameGroup || 'EsPa'} <strong>{item.scoreHome !== undefined && item.scoreAway !== undefined ? `${item.scoreHome} - ${item.scoreAway}` : 'vs'}</strong> {item.opponent || 'Vastustaja'}
              {:else}
                {item.opponent || 'Vastustaja'} <strong>{item.scoreHome !== undefined && item.scoreAway !== undefined ? `${item.scoreHome} - ${item.scoreAway}` : 'vs'}</strong> {item.gameGroup || 'EsPa'}
              {/if}
            </span>
            <span class="item-time">{timeAgo(item.timestamp)}</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <a href={item.value1} target="_blank" class="item-url">{item.value1}</a>
            <div style="display:flex; gap:8px;">
              <button 
                class="icon-btn-small" 
                onclick={() => openSocial(item)} 
                title="Kommentit ja reaktiot"
              >
                💬
              </button>
              {#if canEdit}
                <button class="score-edit-btn" onclick={() => openScoreEdit(item)} title="Muokkaa tulosta">✏️</button>
              {/if}
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if showSocial}
    <SocialSection 
      targetId={socialTargetId} 
      token={token} 
      username={username} 
      userEmail={null} 
      onClose={() => showSocial = false} 
    />
  {/if}
</div>

<style>
  .icon-btn-small {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  }
  .icon-btn-small:hover { background: rgba(0,0,0,0.05); }
</style>

