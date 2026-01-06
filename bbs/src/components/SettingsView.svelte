<script>
  let { authState, onLogout, onOpenAdmin } = $props();
</script>

<div class="settings-view fade-in">
  <div class="card profile-card">
    <div class="avatar-circle">
      {authState.userEmail.charAt(0).toUpperCase()}
    </div>
    <div class="user-details">
      <h3>{authState.userEmail}</h3>
      <span class="role-badge">{authState.isAdmin ? 'Super Admin' : (authState.userGroup || 'Käyttäjä')}</span>
    </div>
  </div>

  <div class="settings-list">
    <div class="card">
      <h4 style="margin-top: 0;">Sovelluksen asetukset</h4>
      <div class="setting-item">
        <span>Kieli</span>
        <strong>Suomi</strong>
      </div>
      <div class="setting-item">
        <span>Teema</span>
        <strong>Vaalea</strong>
      </div>
    </div>

    {#if authState.isAdmin}
      <div class="card admin-section">
        <h4 style="margin-top: 0; color: #d13438;">Ylläpito</h4>
        <button class="admin-btn" onclick={onOpenAdmin}>
          🔧 Avaa Järjestelmän Hallinta
        </button>
      </div>
    {/if}

    <button class="logout-btn-large" onclick={onLogout}>
      Kirjaudu ulos
    </button>
  </div>
</div>

<style>
  .settings-view {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
  }

  .profile-card {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 30px 24px;
    background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-hover) 100%);
    color: white;
  }

  .avatar-circle {
    width: 60px;
    height: 60px;
    background: white;
    color: var(--primary-color);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    font-weight: 800;
  }

  .user-details h3 {
    margin: 0;
    font-size: 18px;
  }

  .role-badge {
    font-size: 12px;
    background: rgba(255,255,255,0.2);
    padding: 2px 8px;
    border-radius: 10px;
  }

  .settings-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .setting-item {
    display: flex;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid var(--border-color);
    font-size: 14px;
  }

  .setting-item:last-child {
    border-bottom: none;
  }

  .admin-btn {
    width: 100%;
    background: #fdf2f2;
    color: #d13438;
    border: 1px solid #fad7d7;
    padding: 12px;
    font-weight: 600;
    margin-top: 8px;
  }

  .logout-btn-large {
    background: white;
    color: #d13438;
    border: 1px solid #d13438;
    padding: 14px;
    font-weight: 700;
    margin-top: 10px;
  }

  .logout-btn-large:hover {
    background: #fff5f5;
  }
</style>

