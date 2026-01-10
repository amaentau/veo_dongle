<script>
  import { onMount } from 'svelte';
  import { fade, slide } from 'svelte/transition';

  let { targetId, token, username, userEmail, onClose } = $props();

  let comments = $state([]);
  let reactions = $state({});
  let newComment = $state('');
  let loading = $state(false);
  let error = $state('');
  let posting = $state(false);
  
  // Fallback for display name
  const displayName = $derived(username || (userEmail ? userEmail.split('@')[0] : 'Käyttäjä'));

  async function loadSocial() {
    loading = true;
    try {
      const res = await fetch(`/social/${targetId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Datan haku epäonnistui');
      const data = await res.json();
      comments = data.comments || [];
      reactions = data.reactions || {};
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function handleComment() {
    if (!newComment.trim() || posting) return;
    posting = true;
    try {
      const res = await fetch(`/social/${targetId}/comment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ text: newComment })
      });
      if (!res.ok) throw new Error('Kommentointi epäonnistui');
      
      // Optimistic update
      const tempId = `temp-${Date.now()}`;
      comments = [{
        id: tempId,
        username: displayName,
        text: newComment,
        timestamp: new Date().toISOString()
      }, ...comments];
      
      newComment = '';
      await loadSocial(); // Refresh to get real ID
    } catch (err) {
      alert(err.message);
    } finally {
      posting = false;
    }
  }

  async function handleReaction(type) {
    try {
      const res = await fetch(`/social/${targetId}/reaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ reactionType: type })
      });
      if (!res.ok) throw new Error('Reaktio epäonnistui');
      await loadSocial();
    } catch (err) {
      console.error(err);
    }
  }

  onMount(loadSocial);
</script>

<div class="social-backdrop" onclick={onClose} transition:fade={{ duration: 200 }}>
  <div class="social-drawer" onclick={(e) => e.stopPropagation()} transition:slide={{ axis: 'y', duration: 300 }}>
    <div class="drawer-header">
      <div class="handle"></div>
      <button class="close-btn" onclick={onClose}>✕</button>
    </div>

    <div class="drawer-content">
      <!-- Reactions -->
      <div class="reactions-bar">
        {#each ['👍', '❤️', '🔥', '👏'] as emoji}
          <button class="reaction-btn" onclick={() => handleReaction(emoji)}>
            <span class="emoji">{emoji}</span>
            <span class="count">{reactions[emoji] || 0}</span>
          </button>
        {/each}
      </div>

      <!-- Comments List -->
      <div class="comments-section">
        <h5>Kommentit ({comments.length})</h5>
        
        {#if loading && comments.length === 0}
          <div class="loader-small"></div>
        {:else if comments.length === 0}
          <p class="empty-msg">Ei vielä kommentteja. Ole ensimmäinen!</p>
        {:else}
          <div class="comment-list">
            {#each comments as comment (comment.id)}
              <div class="comment-item" in:fade>
                <div class="comment-meta">
                  <span class="username">{comment.username || 'Käyttäjä'}</span>
                  <span class="time">{new Date(comment.timestamp).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p class="comment-text">{comment.text}</p>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Sticky Input Area -->
    <div class="comment-input-area">
      <div class="input-container">
        <textarea 
          bind:value={newComment} 
          placeholder="Lisää kommentti..." 
          onkeydown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleComment();
            }
          }}
          rows="1"
        ></textarea>
        <button class="send-btn" onclick={handleComment} disabled={!newComment.trim() || posting} title="Lähetä">
          {#if posting}
            <div class="btn-loader"></div>
          {:else}
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
            </svg>
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .social-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 3000;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .social-drawer {
    background: white;
    width: 100%;
    max-width: 480px;
    border-radius: 24px 24px 0 0;
    display: flex;
    flex-direction: column;
    max-height: 85vh;
    box-shadow: 0 -10px 25px rgba(0, 0, 0, 0.1);
    direction: ltr;
    text-align: left;
  }

  .drawer-header {
    padding: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
  }

  .handle {
    width: 40px;
    height: 4px;
    background: #e0e0e0;
    border-radius: 2px;
    margin-bottom: 8px;
  }

  .close-btn {
    position: absolute;
    right: 16px;
    top: 16px;
    background: none;
    border: none;
    font-size: 18px;
    color: var(--text-sub);
    cursor: pointer;
    padding: 4px;
  }

  .drawer-content {
    flex: 1;
    overflow-y: auto;
    padding: 0 20px 20px 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .reactions-bar {
    display: flex;
    gap: 12px;
    padding: 12px;
    background: #f8f9fa;
    border-radius: 16px;
    justify-content: space-around;
  }

  .reaction-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: none;
    border: none;
    cursor: pointer;
    transition: transform 0.1s;
    gap: 4px;
  }

  .reaction-btn:active { transform: scale(1.2); }

  .emoji { font-size: 24px; }
  .count { font-size: 12px; font-weight: bold; color: var(--text-sub); }

  .comments-section h5 {
    margin: 0 0 12px 0;
    color: var(--primary-color);
  }

  .comment-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .comment-item {
    border-bottom: 1px solid #f0f0f0;
    padding-bottom: 12px;
  }

  .comment-meta {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .username { font-weight: 700; font-size: 13px; color: var(--primary-color); }
  .time { font-size: 11px; color: var(--text-sub); }
  
  .comment-text { 
    font-size: 14px; 
    margin: 0; 
    line-height: 1.4; 
    color: #1a1a1a;
    word-break: break-word;
    white-space: pre-wrap;
    unicode-bidi: plaintext;
    text-align: left;
  }

  .comment-input-area {
    padding: 10px 12px;
    padding-bottom: max(10px, env(safe-area-inset-bottom));
    border-top: 1px solid #f0f0f0;
    background: white;
  }

  .input-container {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    background: #f0f2f5;
    border-radius: 24px;
    padding: 4px 4px 4px 16px;
    border: 1px solid transparent;
    transition: all 0.2s ease;
  }

  .input-container:focus-within {
    background: white;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 2px rgba(21, 112, 57, 0.05);
  }

  .input-container textarea {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    padding: 8px 0;
    margin: 0;
    font-size: 15px;
    line-height: 20px;
    color: #1c1e21;
    resize: none;
    font-family: inherit;
    unicode-bidi: plaintext;
    text-align: left;
    min-height: 36px;
    max-height: 150px;
    field-sizing: content;
    width: 100%; /* Force width expansion */
  }

  .input-container textarea::placeholder {
    color: #65676b;
  }

  .send-btn {
    width: 32px;
    height: 32px;
    background: var(--primary-color);
    color: white;
    border: none;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: transform 0.2s, opacity 0.2s;
    margin-bottom: 2px;
    padding: 0;
  }

  .send-btn svg {
    width: 18px;
    height: 18px;
    margin-left: 2px; /* Optical centering for the arrow */
  }

  .send-btn:disabled {
    background: #e4e6eb;
    color: #bcc0c4;
    cursor: not-allowed;
  }

  .send-btn:active:not(:disabled) {
    transform: scale(0.9);
  }

  .btn-loader {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .empty-msg { text-align: center; color: var(--text-sub); margin-top: 20px; font-size: 14px; }

  .loader-small {
    border: 2px solid #f3f3f3;
    border-top: 2px solid var(--primary-color);
    border-radius: 50%;
    width: 20px;
    height: 20px;
    animation: spin 1s linear infinite;
    margin: 20px auto;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
</style>
