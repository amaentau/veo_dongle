<script>
  import { onMount } from 'svelte';
  import Auth from './components/Auth.svelte';
  import MainApp from './components/MainApp.svelte';

  let authState = $state({
    token: localStorage.getItem('espa_token'),
    userEmail: localStorage.getItem('espa_email'),
    username: localStorage.getItem('espa_username'),
    isAdmin: localStorage.getItem('espa_is_admin') === 'true',
    userGroup: localStorage.getItem('espa_user_group'),
    metadata: { gameGroups: [], eventTypes: [] }
  });

  const handleLoginSuccess = (data) => {
    authState.token = data.token;
    authState.userEmail = data.email;
    authState.username = data.username;
    authState.isAdmin = data.isAdmin;
    authState.userGroup = data.userGroup;
    
    localStorage.setItem('espa_token', data.token);
    localStorage.setItem('espa_email', data.email);
    localStorage.setItem('espa_username', data.username || '');
    localStorage.setItem('espa_is_admin', data.isAdmin);
    if (data.userGroup) localStorage.setItem('espa_user_group', data.userGroup);
    else localStorage.removeItem('espa_user_group');
  };

  const logout = () => {
    authState.token = null;
    authState.userEmail = null;
    authState.username = null;
    authState.isAdmin = false;
    authState.userGroup = null;
    localStorage.removeItem('espa_token');
    localStorage.removeItem('espa_email');
    localStorage.removeItem('espa_username');
    localStorage.removeItem('espa_is_admin');
    localStorage.removeItem('espa_user_group');
  };
</script>

<main>
  {#if !authState.token}
    <Auth onLoginSuccess={handleLoginSuccess} />
  {:else}
    <MainApp {authState} onLogout={logout} />
  {/if}
</main>

<style>
  main {
    width: 100%;
    min-height: 100vh;
    margin: 0;
    padding: 0;
  }
</style>

