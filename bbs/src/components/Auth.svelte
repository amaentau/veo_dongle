<script>
  let { onLoginSuccess } = $props();

  let email = $state('');
  let otp = $state('');
  let pin = $state('');
  let username = $state('');
  let setupToken = $state(null);
  let currentStep = $state('lookup'); // lookup, otp, setPin, login
  let status = $state({ msg: '', type: '' });
  let loading = $state(false);

  const setStatus = (msg, type = 'error') => {
    status = { msg, type };
  };

  async function handleLookup() {
    if (!email || !email.includes('@')) {
      return setStatus('Anna kelvollinen sähköposti');
    }
    loading = true;
    setStatus('Tarkistetaan...', 'info');
    try {
      const res = await fetch('/auth/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (data.exists) {
        currentStep = 'login';
        setStatus('');
      } else {
        await sendOtp();
      }
    } catch (err) {
      setStatus('Palvelimeen ei saada yhteyttä.');
    } finally {
      loading = false;
    }
  }

  async function sendOtp() {
    setStatus('Lähetetään koodia...', 'info');
    try {
      const res = await fetch('/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      if (!res.ok) throw new Error();
      currentStep = 'otp';
      setStatus('');
    } catch (err) {
      setStatus('Virhe koodin lähetyksessä.');
    }
  }

  async function handleVerifyOtp() {
    if (otp.length !== 6) return setStatus('Koodin on oltava 6 numeroa');
    loading = true;
    try {
      const res = await fetch('/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: otp })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setupToken = data.setupToken;
      currentStep = 'setPin';
      setStatus('');
    } catch (err) {
      setStatus(err.message || 'Väärä koodi');
    } finally {
      loading = false;
    }
  }

  async function handleSetPin() {
    if (username.length < 3) return setStatus('Käyttäjänimen on oltava vähintään 3 merkkiä');
    if (pin.length !== 4) return setStatus('PIN-koodin on oltava 4 numeroa');
    loading = true;
    try {
      const res = await fetch('/auth/set-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, setupToken, username })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onLoginSuccess(data);
    } catch (err) {
      setStatus(err.message || 'Virhe tallennuksessa');
    } finally {
      loading = false;
    }
  }

  async function handleLogin() {
    if (pin.length !== 4) return setStatus('Syötä 4-numeroinen PIN');
    loading = true;
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pin })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onLoginSuccess(data);
    } catch (err) {
      setStatus(err.message || 'Kirjautuminen epäonnistui');
      pin = '';
    } finally {
      loading = false;
    }
  }
</script>

<div class="container fade-in">
  <header class="auth-header">
    <img src="/logo.png" alt="EsPa Logo" class="auth-logo">
    <h1 class="brand-name">ESPA <span class="brand-accent">TV</span></h1>
  </header>

<style>
  .auth-header {
    text-align: center;
    margin-bottom: 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .auth-logo {
    height: 100px;
    width: auto;
    object-fit: contain;
  }

  .brand-name {
    font-size: 36px;
    font-weight: 900;
    letter-spacing: -1px;
    color: var(--primary-color);
    text-transform: uppercase;
    margin: 0;
  }

  .brand-accent {
    color: var(--accent-color);
    text-shadow: 0 1px 2px rgba(0,0,0,0.1);
  }
</style>

  <div class="card">
    {#if currentStep === 'lookup'}
      <div>
        <div class="form-group">
          <label for="authEmail">Sähköposti</label>
          <input id="authEmail" type="email" bind:value={email} placeholder="nimi@espa.fi" autofocus>
        </div>
        <button onclick={handleLookup} disabled={loading}>Jatka</button>
      </div>

    {:else}
      <p style="text-align:center; margin-bottom:16px;">
        {#if currentStep === 'otp'}
          Lähetimme vahvistuskoodin osoitteeseen <strong>{email}</strong>
        {:else if currentStep === 'login'}
          Tervetuloa takaisin, <strong>{email}</strong>
        {:else if currentStep === 'setPin'}
          Luo uusi 4-numeroinen PIN-koodi.
        {/if}
      </p>

      {#if currentStep === 'otp'}
        <div class="form-group">
          <label for="authOtp">Vahvistuskoodi (6 numeroa)</label>
          <input id="authOtp" type="text" class="pin-input" bind:value={otp} placeholder="123456" maxlength="6">
        </div>
        <button onclick={handleVerifyOtp} disabled={loading}>Vahvista</button>
        <button class="link-btn" onclick={() => currentStep = 'lookup'}>Vaihda sähköposti</button>

      {:else if currentStep === 'setPin'}
        <div class="form-group">
          <label for="authUsername">Käyttäjänimi</label>
          <input id="authUsername" type="text" bind:value={username} placeholder="nimimerkki" minlength="3">
        </div>
        <div class="form-group">
          <label for="authSetPin">Uusi PIN</label>
          <input id="authSetPin" type="password" class="pin-input" bind:value={pin} placeholder="****" maxlength="4">
        </div>
        <button onclick={handleSetPin} disabled={loading}>Tallenna ja kirjaudu</button>

      {:else if currentStep === 'login'}
        <div class="form-group">
          <label for="authLoginPin">Syötä PIN-koodi</label>
          <input id="authLoginPin" type="password" class="pin-input" bind:value={pin} placeholder="****" maxlength="4" autofocus>
        </div>
        <button onclick={handleLogin} disabled={loading}>Kirjaudu</button>
        <button class="link-btn" onclick={sendOtp}>Unohdin PIN-koodin</button>
        <button class="link-btn" onclick={() => currentStep = 'lookup'}>Vaihda käyttäjää</button>
      {/if}
    {/if}

    {#if status.msg}
      <div class="status-msg {status.type}">{status.msg}</div>
    {/if}
  </div>
</div>

