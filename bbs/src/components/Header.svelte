<script>
  let { email, username, onLogout } = $props();
</script>

<header class="top-bar">
  <div class="brand-section">
    <div class="logo-container">
      <img src="/logo.png" alt="EsPa Logo" class="mini-logo">
    </div>
    <div class="brand-text">
      <span class="brand-name">ESPA <span class="brand-accent">TV</span></span>
    </div>
  </div>
  
  <div class="user-section">
    <div class="user-badge truncate">
      <span class="email-text">{username || email.split('@')[0]}</span>
    </div>

    <button class="icon-btn logout-btn" onclick={onLogout} title="Kirjaudu ulos">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
        <polyline points="16 17 21 12 16 7"></polyline>
        <line x1="21" y1="12" x2="9" y2="12"></line>
      </svg>
    </button>
  </div>
</header>

<style>
  .top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    background: rgba(248, 249, 247, 0.85); /* Matches --bg-color */
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    position: sticky;
    top: 0;
    z-index: 1000;
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
    height: 72px;
    width: 100%;
  }

  .brand-section {
    display: flex;
    align-items: center;
    gap: 12px;
    transition: transform 0.3s ease;
  }

  .logo-container {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background: transparent;
    box-shadow: none;
  }

  .mini-logo {
    height: 40px; /* Increased by 10px from 30px */
    width: auto;
    object-fit: contain;
  }

  .brand-name {
    font-size: 20px;
    font-weight: 900;
    letter-spacing: -0.5px;
    color: var(--primary-color);
    text-transform: uppercase;
  }

  .brand-accent {
    color: var(--accent-color);
    text-shadow: 0 1px 2px rgba(0,0,0,0.1);
  }

  .user-section {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .user-badge {
    background: rgba(21, 112, 57, 0.08);
    padding: 6px 12px;
    border-radius: 20px;
    max-width: 90px;
    min-width: 0;
  }

  .email-text {
    font-size: 12px;
    font-weight: 700;
    color: var(--primary-color);
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-btn {
    background: none;
    border: none;
    padding: 8px;
    cursor: pointer;
    color: var(--text-sub);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    border-radius: 12px;
    width: 40px;
    height: 40px;
    margin: 0;
  }

  .icon-btn:hover {
    background: rgba(0, 0, 0, 0.04);
    color: var(--primary-color);
  }

  .logout-btn:hover {
    background: rgba(209, 52, 56, 0.1);
    color: #d13438;
  }

  @media (max-width: 380px) {
    .brand-name { font-size: 16px; }
    .user-badge { display: none; }
  }
</style>

