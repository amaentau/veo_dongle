<script>
  let { activeView = $bindable(), isAdmin, userGroup } = $props();

  const menuItems = [
    { 
      id: 'settings', 
      label: 'Asetukset', 
      img: '/images/menu/settings.png', 
      imgBW: '/images/menu/settings.png', // Fallback
      roles: [] // Everyone
    },
    { 
      id: 'tv', 
      label: 'Espa TV', 
      img: '/images/menu/tv_large.png', 
      imgBW: '/images/menu/tv_large.png', // Fallback
      roles: [] // Everyone
    },
    { 
      id: 'producer', 
      label: 'Tuotanto', 
      img: '/images/menu/producer_large.png', 
      imgBW: '/images/menu/producer_large_BW.png',
      roles: ['ADMIN', 'Veo Ylläpitäjä'] 
    },
    { 
      id: 'music', 
      label: 'Musiikki', 
      img: '/images/menu/music_large.png', 
      imgBW: '/images/menu/music_large.png', // Fallback
      roles: [] // Everyone
    }
  ];

  function hasAccess(item) {
    if (item.roles.length === 0) return true;
    if (isAdmin) return true;
    return item.roles.includes(userGroup);
  }

  function handleSelect(item) {
    if (hasAccess(item)) {
      activeView = item.id;
    }
  }
</script>

<div class="spinner-container">
  <div class="ribbon">
    {#each menuItems as item}
      {@const enabled = hasAccess(item)}
      <button 
        class="menu-item {activeView === item.id ? 'active' : ''} {!enabled ? 'disabled' : ''}"
        onclick={() => handleSelect(item)}
        title={item.label}
      >
        <div class="img-wrapper">
          <img 
            src={enabled ? item.img : item.imgBW} 
            alt={item.label} 
          />
        </div>
        <span class="label">{item.label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .spinner-container {
    width: 100vw;
    margin-left: calc(-50vw + 50%); /* Center edge-to-edge if parent is narrow */
    overflow-x: auto;
    padding: 20px 0;
    scrollbar-width: none; /* Hide scrollbar Firefox */
    -ms-overflow-style: none; /* Hide scrollbar IE/Edge */
    display: flex;
    justify-content: center;
  }

  .spinner-container::-webkit-scrollbar {
    display: none; /* Hide scrollbar Chrome/Safari */
  }

  .ribbon {
    display: flex;
    gap: 20px;
    padding: 0 40px;
    align-items: center;
  }

  .menu-item {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    width: 80px;
    flex-shrink: 0;
    outline: none;
  }

  .img-wrapper {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: white;
    box-shadow: var(--shadow);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 2px solid transparent;
    transition: all 0.3s ease;
  }

  .menu-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s ease;
  }

  .label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-sub);
    opacity: 0.7;
    white-space: nowrap;
    transition: all 0.3s ease;
  }

  /* Active State */
  .menu-item.active {
    transform: scale(1.25);
    z-index: 10;
  }

  .menu-item.active .img-wrapper {
    border-color: var(--primary-color);
    box-shadow: 0 8px 20px rgba(21, 112, 57, 0.3);
  }

  .menu-item.active .label {
    color: var(--primary-color);
    opacity: 1;
    transform: translateY(2px);
  }

  /* Disabled State */
  .menu-item.disabled {
    cursor: not-allowed;
  }

  .menu-item.disabled .img-wrapper {
    background: #f0f0f0;
    box-shadow: none;
  }

  .menu-item.disabled img {
    filter: grayscale(1);
    opacity: 0.6;
  }

  /* Hover (Desktop only) */
  @media (hover: hover) {
    .menu-item:not(.disabled):hover .img-wrapper {
      transform: translateY(-5px);
      box-shadow: 0 10px 15px rgba(0,0,0,0.1);
    }
  }
</style>

