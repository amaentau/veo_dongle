<script>
  let { activeView = $bindable(), isAdmin, userGroup } = $props();

  const menuItems = [
    { 
      id: 'tv', 
      label: 'Espa TV', 
      img: '/images/menu/tv_small.png', 
      imgBW: '/images/menu/tv_small.png', 
      roles: [] 
    },
    { 
      id: 'music', 
      label: 'Musiikki', 
      img: '/images/menu/music_small.png', 
      imgBW: '/images/menu/music_small.png', 
      roles: [] 
    },
    { 
      id: 'videot', 
      label: 'Videot', 
      img: '/images/menu/highlights_small.png', 
      imgBW: '/images/menu/highlights_small.png', 
      roles: [] 
    },
    { 
      id: 'settings', 
      label: 'Asetukset', 
      img: '/images/menu/settings_small.png', 
      imgBW: '/images/menu/settings_small.png', 
      roles: [] 
    },
    { 
      id: 'producer', 
      label: 'Tuotanto', 
      img: '/images/menu/producer_small.png', 
      imgBW: '/images/menu/producer_small_BW.png',
      roles: ['ADMIN', 'Veo Ylläpitäjä'] 
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
        <div class="img-container">
          <img 
            src={enabled ? item.img : item.imgBW} 
            alt={item.label} 
          />
          {#if activeView === item.id}
            <div class="selection-halo"></div>
          {/if}
        </div>
      </button>
    {/each}
  </div>
</div>

<style>
  .spinner-container {
    width: 100%;
    overflow-x: auto;
    overflow-y: visible;
    padding: 20px 0 30px 0;
    scrollbar-width: none; 
    -ms-overflow-style: none;
    display: block;
    -webkit-overflow-scrolling: touch;
    scroll-snap-type: x mandatory;
  }

  .spinner-container::-webkit-scrollbar {
    display: none;
  }

  .ribbon {
    display: flex;
    gap: 16px; /* Increased gap */
    padding: 0 40px;
    align-items: center;
    width: max-content;
    min-width: 100%;
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
    transition: all 0.5s cubic-bezier(0.23, 1, 0.32, 1);
    width: 132px; /* Increased 10% from 120px */
    flex-shrink: 0;
    outline: none;
    scroll-snap-align: center;
    position: relative;
    filter: drop-shadow(0 4px 6px rgba(0,0,0,0.05));
  }

  .img-container {
    width: 110px; /* Increased 10% from 100px */
    height: 110px; /* Increased 10% from 100px */
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    transition: transform 0.4s ease;
  }

  .menu-item img {
    width: 100%;
    height: 100%;
    object-fit: contain; /* Respect transparency and aspect ratio */
    transition: all 0.4s ease;
  }

  /* Selection Halo - The new "Flagship" alternative */
  .selection-halo {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 140%;
    height: 140%;
    background: radial-gradient(circle, rgba(252, 227, 84, 0.25) 0%, rgba(21, 112, 57, 0.1) 40%, transparent 70%);
    z-index: -1;
    border-radius: 50%;
    animation: aura-pulse 3s infinite ease-in-out;
  }

  @keyframes aura-pulse {
    0% { transform: translate(-50%, -50%) scale(0.9); opacity: 0.5; }
    50% { transform: translate(-50%, -50%) scale(1.1); opacity: 0.8; }
    100% { transform: translate(-50%, -50%) scale(0.9); opacity: 0.5; }
  }

  /* Active State */
  .menu-item.active {
    transform: scale(1.3); /* Dramatic zoom to read text on image */
    z-index: 10;
    filter: drop-shadow(0 12px 20px rgba(0,0,0,0.12));
  }

  .menu-item.active img {
    filter: brightness(1.05) saturate(1.1);
  }

  /* Disabled State */
  .menu-item.disabled {
    cursor: not-allowed;
    opacity: 0.4;
    filter: grayscale(1) contrast(0.8);
  }

  /* Hover (Desktop only) */
  @media (hover: hover) {
    .menu-item:not(.disabled):hover {
      transform: translateY(-8px) scale(1.1);
    }
  }
</style>

