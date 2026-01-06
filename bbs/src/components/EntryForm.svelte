<script>
  let { metadata, targetDeviceIds, token, onEntryAdded } = $props();

  let contentType = $state('veo'); // veo, song, video, image
  let videoUrl = $state('');
  let videoTitle = $state('');
  let gameGroup = $state('');
  let eventType = $state('');
  let opponent = $state('');
  let scoreHome = $state('');
  let scoreAway = $state('');
  let isHome = $state(true);
  
  let status = $state({ msg: '', type: '' });
  let loading = $state(false);
  let isDragging = $state(false);
  let fileInput = $state(null);

  const contentTypes = [
    { id: 'veo', label: 'Veo Linkki', icon: '⚽' },
    { id: 'song', label: 'Kappale', icon: '🎵' },
    { id: 'video', label: 'Video', icon: '🎬' },
    { id: 'image', label: 'Kuva', icon: '🖼️' }
  ];

  // Set defaults from metadata or localStorage
  $effect(() => {
    if (metadata.gameGroups.length > 0 && !gameGroup) {
      const lastGroup = localStorage.getItem('espa_last_group');
      gameGroup = (lastGroup && metadata.gameGroups.includes(lastGroup)) ? lastGroup : metadata.gameGroups[0];
    }
    if (metadata.eventTypes.length > 0 && !eventType) {
      eventType = metadata.eventTypes[0];
    }
  });

  const setStatus = (msg, type = 'error') => {
    status = { msg, type };
    if (type === 'success') {
      setTimeout(() => { if (status.msg === msg) status.msg = ''; }, 3000);
    }
  };

  async function handleSend() {
    if (targetDeviceIds.length === 0) return setStatus('Valitse vähintään yksi laite');
    if (!videoUrl) return setStatus('Syötä osoite (URL)');

    loading = true;
    setStatus('Lähetetään...', 'info');

    let successCount = 0;
    let errors = [];

    let finalTitle = videoTitle.trim();
    if (contentType === 'veo') {
      finalTitle = finalTitle || `${gameGroup} vs ${opponent || '???'}`;
    } else {
      const typeLabel = contentTypes.find(t => t.id === contentType).label;
      finalTitle = finalTitle || `${typeLabel}: ${videoUrl.split('/').pop()}`;
    }

    for (const deviceId of targetDeviceIds) {
      try {
        // 1. Save to Global Library (only once)
        if (deviceId === targetDeviceIds[0]) {
          const libPayload = {
            type: contentType === 'veo' ? 'VEO' : contentType.toUpperCase(),
            url: videoUrl,
            title: finalTitle,
            metadata: contentType === 'veo' ? {
              gameGroup,
              opponent,
              isHome,
              scoreHome,
              scoreAway,
              eventType
            } : {}
          };

          await fetch('/library', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(libPayload)
          });
        }

        // 2. Play on Device(s)
        const payload = { 
          key: deviceId, 
          value1: videoUrl, 
          value2: finalTitle,
          eventType: contentType === 'veo' ? eventType : contentType.toUpperCase()
        };

        if (contentType === 'veo') {
          Object.assign(payload, {
            gameGroup,
            opponent,
            isHome,
            scoreHome,
            scoreAway
          });
        }

        const res = await fetch('/entry', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error((await res.json()).error || 'Virhe');
        successCount++;
      } catch (err) {
        errors.push(`${deviceId}: ${err.message}`);
      }
    }

    if (successCount > 0) {
      setStatus(`Lisätty onnistuneesti ${successCount} laitteelle!`, 'success');
      videoUrl = '';
      videoTitle = '';
      opponent = '';
      scoreHome = '';
      scoreAway = '';
      onEntryAdded();
    }

    if (errors.length > 0) {
      alert("Joitakin virheitä tapahtui:\n" + errors.join("\n"));
    }
    loading = false;
  }

  async function handleFileUpload(files) {
    if (!files || files.length === 0) return;
    const file = files[0];
    
    // Check if it's an audio file for the song type
    if (contentType === 'song' && !file.type.startsWith('audio/')) {
      return setStatus('Vain äänitiedostot ovat sallittuja tässä.', 'error');
    }

    loading = true;
    setStatus(`Ladataan tiedostoa: ${file.name}...`, 'info');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/library/blob/upload', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (!res.ok) throw new Error('Lataus epäonnistui');
      
      const data = await res.json();
      setStatus(`Tiedosto "${file.name}" ladattu onnistuneesti!`, 'success');
      
      // If it was a song, we can clear the URL field or trigger a refresh
      if (contentType === 'song') {
        videoUrl = ''; // Clear URL if they were typing one
      }
      
      onEntryAdded(); // Refresh history/library
    } catch (err) {
      setStatus(`Latausvirhe: ${err.message}`, 'error');
    } finally {
      loading = false;
      if (fileInput) fileInput.value = ''; // Reset input
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    isDragging = false;
    if (contentType === 'song' || contentType === 'image' || contentType === 'video') {
      handleFileUpload(e.dataTransfer.files);
    }
  }

  const teamLeft = $derived(isHome ? gameGroup : (opponent || 'Vastustaja'));
  const teamRight = $derived(isHome ? (opponent || 'Vastustaja') : gameGroup);

  $effect(() => {
    if (gameGroup) localStorage.setItem('espa_last_group', gameGroup);
  });
</script>

<div>
  <!-- Content Type Selector -->
  <div class="type-selector">
    {#each contentTypes as type}
      <button 
        class="type-btn {contentType === type.id ? 'active' : ''}" 
        onclick={() => contentType = type.id}
      >
        <span class="type-icon">{type.icon}</span>
        <span class="type-label">{type.label}</span>
      </button>
    {/each}
  </div>

  <div class="form-group">
    <label for="videoUrl">
      {#if contentType === 'veo'}Videon osoite (URL){:else if contentType === 'song'}Kappaleen osoite (URL) tai lataa tiedosto{:else if contentType === 'image'}Kuvan osoite (URL){:else}Videon osoite (URL){/if}
    </label>
    
    {#if contentType === 'song' || contentType === 'image' || contentType === 'video'}
      <div 
        class="upload-zone {isDragging ? 'dragging' : ''}"
        onragover={(e) => { e.preventDefault(); isDragging = true; }}
        onragleave={() => isDragging = false}
        ondrop={handleDrop}
      >
        <input 
          id="videoUrl" 
          type="url" 
          bind:value={videoUrl} 
          placeholder="https://..."
          style="border:none; background:transparent; margin-bottom:0;"
        >
        <div class="upload-divider">tai</div>
        <button 
          type="button" 
          class="upload-btn"
          onclick={() => fileInput.click()}
          disabled={loading}
        >
          📁 Valitse tiedosto
        </button>
        <input 
          type="file" 
          bind:this={fileInput} 
          onchange={(e) => handleFileUpload(e.target.files)} 
          style="display:none;"
          accept={contentType === 'song' ? 'audio/*' : contentType === 'image' ? 'image/*' : 'video/*'}
        >
        <p class="upload-hint">Voit myös raahata tiedoston tähän</p>
      </div>
    {:else}
      <input id="videoUrl" type="url" bind:value={videoUrl} placeholder="https://...">
    {/if}
  </div>

  {#if contentType !== 'veo'}
    <div class="form-group">
      <label for="videoTitle">Otsikko (valinnainen)</label>
      <input id="videoTitle" type="text" bind:value={videoTitle} placeholder="esim. Taukomusiikki">
    </div>
  {/if}

  {#if contentType === 'veo'}
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
      <div class="form-group">
        <label for="gameGroup">Peliryhmä</label>
        <select id="gameGroup" bind:value={gameGroup}>
          {#each metadata.gameGroups as g}
            <option value={g}>{g}</option>
          {/each}
        </select>
      </div>
      <div class="form-group">
        <label for="eventType">Tapahtuma</label>
        <select id="eventType" bind:value={eventType}>
          {#each metadata.eventTypes as e}
            <option value={e}>{e}</option>
          {/each}
        </select>
      </div>
    </div>

    <div class="form-group">
      <label for="opponent">Vastustaja</label>
      <input id="opponent" type="text" bind:value={opponent} placeholder="esim. Kirkkonummi">
    </div>

    <div class="form-group">
      <label>Tulos & Paikka</label>
      <div style="display:flex; flex-direction:column; gap:12px; padding:12px; background:#f5f5f5; border-radius:8px; border:1px solid var(--border-color);">
        <div style="display:flex; justify-content:center; gap:8px;">
          <button 
            class="toggle-btn {isHome ? 'active' : ''}" 
            style="width:auto; padding:6px 16px; margin:0; font-size:14px; background-color: {isHome ? '' : 'var(--text-sub)'}"
            onclick={() => isHome = true}
          >Koti</button>
          <button 
            class="toggle-btn {!isHome ? 'active' : ''}" 
            style="width:auto; padding:6px 16px; margin:0; font-size:14px; background-color: {!isHome ? '' : 'var(--text-sub)'}"
            onclick={() => isHome = false}
          >Vieras</button>
        </div>
        
        <div style="display:flex; align-items:center; justify-content:center; gap:12px; font-weight:bold;">
          <div style="flex:1; text-align:right; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{teamLeft}</div>
          <input type="number" bind:value={scoreHome} placeholder="-" style="width:50px; text-align:center; padding:8px;">
          <span>—</span>
          <input type="number" bind:value={scoreAway} placeholder="-" style="width:50px; text-align:center; padding:8px;">
          <div style="flex:1; text-align:left; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{teamRight}</div>
        </div>
      </div>
    </div>
  {/if}

  <button onclick={handleSend} disabled={loading}>Lisää soittolistalle</button>
  {#if status.msg}
    <div class="status-msg {status.type}">{status.msg}</div>
  {/if}
</div>

<style>
  .type-selector {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 20px;
  }

  .type-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px;
    background: #f8f9fa;
    border: 1px solid var(--border-color);
    color: var(--text-sub);
    font-size: 10px;
    font-weight: 600;
    transition: all 0.2s ease;
    margin-top: 0;
  }

  .type-btn.active {
    background: var(--primary-color);
    color: white;
    border-color: var(--primary-color);
    box-shadow: 0 4px 8px rgba(21, 112, 57, 0.2);
  }

  .type-icon {
    font-size: 18px;
  }

  .type-label {
    text-align: center;
  }

  .upload-zone {
    border: 2px dashed var(--border-color);
    border-radius: var(--radius);
    padding: 16px;
    background: #fcfcfc;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    transition: all 0.2s ease;
  }

  .upload-zone.dragging {
    border-color: var(--primary-color);
    background: rgba(21, 112, 57, 0.05);
  }

  .upload-divider {
    font-size: 11px;
    color: var(--text-sub);
    text-transform: uppercase;
    font-weight: 700;
  }

  .upload-btn {
    margin-top: 0;
    padding: 8px 16px;
    font-size: 13px;
    background-color: white;
    color: var(--text-main);
    border: 1px solid var(--border-color);
    width: auto;
  }

  .upload-btn:hover {
    background-color: #f0f0f0;
    border-color: var(--primary-color);
  }

  .upload-hint {
    font-size: 11px;
    color: var(--text-sub);
    margin: 0;
  }
</style>

