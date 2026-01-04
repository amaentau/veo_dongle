'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const baseUrl = (window.APP_CONFIG && window.APP_CONFIG.baseUrl) || '';

  // --- STATE ---
  let authState = {
    email: '',
    setupToken: null,
    token: localStorage.getItem('espa_token'),
    userEmail: localStorage.getItem('espa_email'),
    isAdmin: localStorage.getItem('espa_is_admin') === 'true',
    devices: []
  };

  // --- ELEMENTS ---
  const views = {
    auth: $('authContainer'),
    app: $('appContainer'),
    stepLookup: $('stepLookup'),
    stepOtp: $('stepOtp'),
    stepSetPin: $('stepSetPin'),
    stepLogin: $('stepLogin'),
    adminModal: $('adminModal'),
    claimModal: $('claimModal'),
    shareModal: $('shareModal'),
    renameModal: $('renameModal'),
    iotControls: $('iotControlsContainer'),
    iotNotRegistered: $('iotNotRegistered'),
    iotButtons: $('iotButtons')
  };

  const inputs = {
    authEmail: $('authEmail'),
    authOtp: $('authOtp'),
    authSetPin: $('authSetPin'),
    authLoginPin: $('authLoginPin'),
    deviceSelect: $('deviceSelect'),
    deviceCheckboxList: $('deviceCheckboxList'),
    videoUrl: $('videoUrl'),
    videoTitle: $('videoTitle'),
    sendBtn: $('sendBtn'),
    claimDeviceId: $('claimDeviceId'),
    claimFriendlyName: $('claimFriendlyName'),
    shareEmail: $('shareEmailInput'),
    renameFriendlyName: $('renameFriendlyName')
  };

  const displays = {
    otpEmail: $('displayEmailOtp'),
    loginEmail: $('displayEmailLogin'),
    authStatus: $('authStatus'),
    currentUser: $('currentUserEmail'),
    appStatus: $('statusMsg'),
    historyList: $('historyList'),
    loader: $('loader'),
    emptyState: $('emptyState'),
    adminControls: $('adminControls'),
    adminForm: $('adminConfigForm'),
    adminStatus: $('adminStatus'),
    iotStatusBadge: $('iotStatusBadge'),
    iotStatusMsg: $('iotStatusMsg')
  };

  // --- AUTH FLOW ---

  function showView(viewId) {
    ['stepLookup', 'stepOtp', 'stepSetPin', 'stepLogin'].forEach(id => {
      if (id === viewId) views[id].classList.remove('hidden');
      else views[id].classList.add('hidden');
    });
    displays.authStatus.textContent = '';
  }

  function setAuthStatus(msg, type = 'error') {
    displays.authStatus.textContent = msg;
    displays.authStatus.className = `status-msg ${type}`;
  }

  function switchToApp() {
    views.auth.classList.add('hidden');
    views.app.classList.remove('hidden');
    views.app.classList.add('fade-in');
    
    displays.currentUser.textContent = authState.userEmail;
    
    // Show Admin Button if Admin
    if (authState.isAdmin) {
      displays.adminControls.style.display = 'block';
    } else {
      displays.adminControls.style.display = 'none';
    }
    
    loadDevices();
  }

  function logout() {
    authState.token = null;
    authState.userEmail = null;
    authState.isAdmin = false;
    localStorage.removeItem('espa_token');
    localStorage.removeItem('espa_email');
    localStorage.removeItem('espa_is_admin');
    
    views.app.classList.add('hidden');
    views.auth.classList.remove('hidden');
    
    inputs.authEmail.value = '';
    inputs.authLoginPin.value = '';
    showView('stepLookup');
  }

  // 1. LOOKUP
  $('btnLookup').addEventListener('click', async () => {
    const email = inputs.authEmail.value.trim();
    if (!email || !email.includes('@')) {
      return setAuthStatus('Anna kelvollinen sähköposti');
    }

    setAuthStatus('Tarkistetaan...', 'info');
    
    try {
      const res = await fetch(`${baseUrl}/auth/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      
      authState.email = email;

      if (data.exists) {
        displays.loginEmail.textContent = email;
        showView('stepLogin');
        inputs.authLoginPin.focus();
      } else {
        await sendOtp(email);
      }
    } catch (err) {
      setAuthStatus('Palvelimeen ei saada yhteyttä. Yritä hetken kuluttua uudelleen.');
      console.error(err);
    }
  });

  async function sendOtp(email) {
    setAuthStatus('Lähetetään koodia...', 'info');
    try {
      const res = await fetch(`${baseUrl}/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      if (!res.ok) throw new Error();
      
      displays.otpEmail.textContent = email;
      showView('stepOtp');
      inputs.authOtp.value = '';
      inputs.authOtp.focus();
    } catch (err) {
      setAuthStatus('Virhe koodin lähetyksessä. Yritä uudelleen.');
    }
  }

  // 2. VERIFY OTP
  $('btnVerifyOtp').addEventListener('click', async () => {
    const code = inputs.authOtp.value.trim();
    if (code.length !== 6) return setAuthStatus('Koodin on oltava 6 numeroa');

    try {
      const res = await fetch(`${baseUrl}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authState.email, code })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error);

      authState.setupToken = data.setupToken;
      showView('stepSetPin');
      inputs.authSetPin.focus();
    } catch (err) {
      setAuthStatus(err.message || 'Väärä koodi');
    }
  });

  // 3. SET PIN
  $('btnSetPin').addEventListener('click', async () => {
    const pin = inputs.authSetPin.value.trim();
    if (pin.length !== 4) return setAuthStatus('PIN-koodin on oltava 4 numeroa');

    try {
      const res = await fetch(`${baseUrl}/auth/set-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          pin, 
          setupToken: authState.setupToken 
        })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error);

      handleLoginSuccess(data);
    } catch (err) {
      setAuthStatus(err.message || 'Virhe tallennuksessa');
    }
  });

  // 4. LOGIN
  $('btnLogin').addEventListener('click', async () => {
    const pin = inputs.authLoginPin.value.trim();
    if (pin.length !== 4) return setAuthStatus('Syötä 4-numeroinen PIN');

    try {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authState.email, pin })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error);

      handleLoginSuccess(data);
    } catch (err) {
      setAuthStatus(err.message || 'Kirjautuminen epäonnistui');
      inputs.authLoginPin.value = '';
    }
  });

  function handleLoginSuccess(data) {
    authState.token = data.token;
    authState.userEmail = data.email;
    authState.isAdmin = data.isAdmin;
    
    localStorage.setItem('espa_token', data.token);
    localStorage.setItem('espa_email', data.email);
    localStorage.setItem('espa_is_admin', data.isAdmin);
    
    switchToApp();
  }

  // Back / Forgot Buttons
  $('btnBackToLookup').addEventListener('click', () => showView('stepLookup'));
  $('btnBackToLookup2').addEventListener('click', () => {
    inputs.authEmail.value = '';
    showView('stepLookup');
  });
  
  $('btnForgotPin').addEventListener('click', () => {
    sendOtp(authState.email);
  });

  $('btnLogout').addEventListener('click', logout);


  // --- APP LOGIC (Protected) ---

  async function loadDevices() {
    try {
      const res = await fetch(`${baseUrl}/devices`, {
        headers: { 'Authorization': `Bearer ${authState.token}` }
      });
      if (res.status === 401 || res.status === 403) { logout(); return; }
      const devices = await res.json();
      authState.devices = devices;
      renderDeviceSelect();
      if (devices.length > 0) {
        loadHistory();
      }
    } catch (err) {
      console.error('Failed to load devices:', err);
    }
  }

  function renderDeviceSelect() {
    const select = inputs.deviceSelect;
    const checkboxList = inputs.deviceCheckboxList;
    
    select.innerHTML = '';
    checkboxList.innerHTML = '';
    
    if (authState.devices.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Ei laitteita - lisää uusi';
      select.appendChild(opt);
      
      checkboxList.innerHTML = '<div style="font-size:12px; color:var(--text-sub);">Ei laitteita.</div>';
      return;
    }

    authState.devices.forEach(dev => {
      // 1. Add to Dropdown
      const opt = document.createElement('option');
      opt.value = dev.id;
      opt.textContent = dev.friendlyName || dev.id;
      select.appendChild(opt);

      // 2. Add to Checkbox List
      const label = document.createElement('label');
      label.style.cssText = 'display:flex; align-items:center; gap:8px; font-weight:normal; font-size:14px; cursor:pointer;';
      label.innerHTML = `
        <input type="checkbox" class="device-target-checkbox" value="${dev.id}" data-name="${dev.friendlyName || dev.id}">
        <span>${escapeHtml(dev.friendlyName || dev.id)}</span>
      `;
      checkboxList.appendChild(label);
    });

    // Default: Check the currently selected device in the list
    syncCheckboxesWithDropdown();

    updateDeviceButtonsVisibility();
  }

  function syncCheckboxesWithDropdown() {
    const activeId = inputs.deviceSelect.value;
    document.querySelectorAll('.device-target-checkbox').forEach(cb => {
      if (cb.value === activeId) cb.checked = true;
    });
  }

  function updateDeviceButtonsVisibility() {
    const deviceId = inputs.deviceSelect.value;
    const currentDevice = authState.devices.find(d => d.id === deviceId);
    if (currentDevice && currentDevice.role === 'master') {
      $('btnOpenShare').style.display = 'flex';
      $('btnOpenRename').style.display = 'flex';
    } else {
      $('btnOpenShare').style.display = 'none';
      $('btnOpenRename').style.display = 'none';
    }
  }

  async function loadHistory() {
    const deviceId = inputs.deviceSelect.value;
    if (!deviceId) return;
    
    syncCheckboxesWithDropdown();
    updateDeviceButtonsVisibility();

    displays.loader.style.display = 'block';
    displays.historyList.innerHTML = '';
    displays.emptyState.style.display = 'none';

    try {
      const res = await fetch(`${baseUrl}/entries/${encodeURIComponent(deviceId)}`, {
        headers: { 'Authorization': `Bearer ${authState.token}` }
      });
      
      if (res.status === 401 || res.status === 403) { logout(); return; }
      if (!res.ok) throw new Error('Historiaa ei voitu hakea');
      
      const data = await res.json();
      renderHistory(data);
      
      // Load IoT Status
      loadIotStatus();
    } catch (err) {
      console.error(err);
    } finally {
      displays.loader.style.display = 'none';
    }
  }

  function renderHistory(items) {
    displays.historyList.innerHTML = '';
    if (!items || items.length === 0) {
      displays.emptyState.style.display = 'block';
      return;
    }
    items.forEach(item => {
      const url = item.value1;
      const title = item.value2 || url;
      const timestamp = item.timestamp;
      const li = document.createElement('li');
      li.className = 'history-item';
      li.innerHTML = `
        <div class="item-header">
          <span class="item-title">${escapeHtml(title)}</span>
          <span class="item-time">${timeAgo(timestamp)}</span>
        </div>
        <a href="${escapeHtml(url)}" target="_blank" class="item-url">${escapeHtml(url)}</a>
      `;
      displays.historyList.appendChild(li);
    });
  }

  $('sendBtn').addEventListener('click', async () => {
    const videoUrl = inputs.videoUrl.value.trim();
    const videoTitle = inputs.videoTitle.value.trim();

    // Get all checked devices
    const targetCheckboxes = document.querySelectorAll('.device-target-checkbox:checked');
    const targetIds = Array.from(targetCheckboxes).map(cb => cb.value);

    if (targetIds.length === 0) return setAppStatus('Valitse vähintään yksi laite', 'error');
    if (!videoUrl) return setAppStatus('Syötä videon osoite', 'error');

    inputs.sendBtn.disabled = true;
    setAppStatus('Lähetetään...', '');

    let successCount = 0;
    let errors = [];

    // Send to each selected device
    for (const deviceId of targetIds) {
      try {
        const res = await fetch(`${baseUrl}/entry`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authState.token}`
          },
          body: JSON.stringify({ key: deviceId, value1: videoUrl, value2: videoTitle })
        });

        if (res.status === 401 || res.status === 403) { logout(); return; }
        if (!res.ok) throw new Error((await res.json()).error || 'Virhe');
        
        successCount++;
      } catch (err) {
        const devName = Array.from(targetCheckboxes).find(cb => cb.value === deviceId)?.dataset.name || deviceId;
        errors.push(`${devName}: ${err.message}`);
      }
    }

    if (successCount > 0) {
      setAppStatus(`Lisätty onnistuneesti ${successCount} laitteelle!`, 'success');
      inputs.videoUrl.value = '';
      inputs.videoTitle.value = '';
      await loadHistory(); // Refresh history for the current context
    }

    if (errors.length > 0) {
      alert("Joitakin virheitä tapahtui:\n" + errors.join("\n"));
    }

    inputs.sendBtn.disabled = false;
  });

  $('btnSelectAllDevices').addEventListener('click', (e) => {
    e.preventDefault();
    const checkboxes = document.querySelectorAll('.device-target-checkbox');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
    $('btnSelectAllDevices').textContent = allChecked ? 'Valitse kaikki' : 'Poista valinnat';
  });

  $('refreshBtn').addEventListener('click', loadHistory);
  inputs.deviceSelect.addEventListener('change', loadHistory);


  // --- ADMIN LOGIC ---
  $('btnOpenAdmin').addEventListener('click', async () => {
    views.adminModal.style.display = 'flex';
    displays.adminStatus.textContent = 'Ladataan...';
    
    try {
      const res = await fetch(`${baseUrl}/config/coordinates`);
      const config = await res.json();
      renderAdminForm(config);
      displays.adminStatus.textContent = '';
    } catch (err) {
      displays.adminStatus.textContent = 'Virhe asetusten latauksessa';
    }
  });

  $('btnCloseAdmin').addEventListener('click', () => {
    views.adminModal.style.display = 'none';
  });

  function renderAdminForm(config) {
    let html = '';
    for (const [res, coords] of Object.entries(config)) {
      html += `
        <div style="border-bottom:1px solid #eee; padding-bottom:12px; margin-bottom:12px;">
          <h3 style="margin-bottom:8px;">${res}p</h3>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
            <label>Play X <input type="number" class="admin-input" data-res="${res}" data-key="play.x" value="${coords.play.x}"></label>
            <label>Play Y <input type="number" class="admin-input" data-res="${res}" data-key="play.y" value="${coords.play.y}"></label>
            <label>Full X <input type="number" class="admin-input" data-res="${res}" data-key="fullscreen.x" value="${coords.fullscreen.x}"></label>
            <label>Full Y <input type="number" class="admin-input" data-res="${res}" data-key="fullscreen.y" value="${coords.fullscreen.y}"></label>
          </div>
        </div>
      `;
    }
    displays.adminForm.innerHTML = html;
  }

  $('btnSaveAdmin').addEventListener('click', async () => {
    const newConfig = { 1280: { play:{}, fullscreen:{} }, 1920: { play:{}, fullscreen:{} }, 3840: { play:{}, fullscreen:{} } };
    
    document.querySelectorAll('.admin-input').forEach(input => {
      const res = input.dataset.res;
      const [group, axis] = input.dataset.key.split('.');
      newConfig[res][group][axis] = parseInt(input.value, 10);
    });

    displays.adminStatus.textContent = 'Tallennetaan...';
    try {
      const res = await fetch(`${baseUrl}/config/coordinates`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authState.token}`
        },
        body: JSON.stringify(newConfig)
      });
      
      if (!res.ok) throw new Error();
      displays.adminStatus.textContent = 'Tallennettu onnistuneesti!';
      setTimeout(() => views.adminModal.style.display = 'none', 1000);
    } catch (err) {
      displays.adminStatus.textContent = 'Virhe tallennuksessa';
    }
  });

  // --- CLAIM DEVICE LOGIC ---
  $('btnOpenClaim').addEventListener('click', () => {
    views.claimModal.style.display = 'flex';
    inputs.claimDeviceId.value = '';
    inputs.claimFriendlyName.value = '';
    $('claimStatus').textContent = '';
  });

  $('btnCloseClaim').addEventListener('click', () => {
    views.claimModal.style.display = 'none';
  });

  $('btnSaveClaim').addEventListener('click', async () => {
    const deviceId = inputs.claimDeviceId.value.trim();
    const friendlyName = inputs.claimFriendlyName.value.trim();
    const status = $('claimStatus');

    if (!deviceId) {
      status.textContent = 'Syötä laitteen ID';
      status.className = 'status-msg error';
      return;
    }

    status.textContent = 'Tallennetaan...';
    status.className = 'status-msg info';

    try {
      const res = await fetch(`${baseUrl}/devices/claim`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authState.token}`
        },
        body: JSON.stringify({ deviceId, friendlyName })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Virhe tallennuksessa');

      status.textContent = 'Laite lisätty!';
      status.className = 'status-msg success';
      
      await loadDevices(); // Refresh list
      setTimeout(() => views.claimModal.style.display = 'none', 1000);
    } catch (err) {
      status.textContent = err.message;
      status.className = 'status-msg error';
    }
  });

  // --- SHARING LOGIC ---
  $('btnOpenShare').addEventListener('click', async () => {
    const deviceId = inputs.deviceSelect.value;
    const device = authState.devices.find(d => d.id === deviceId);
    if (!device) return;

    $('shareDeviceName').textContent = device.friendlyName || deviceId;
    views.shareModal.style.display = 'flex';
    $('shareStatus').textContent = '';
    inputs.shareEmail.value = '';
    
    loadShares(deviceId);
  });

  $('btnCloseShare').addEventListener('click', () => {
    views.shareModal.style.display = 'none';
  });

  async function loadShares(deviceId) {
    const list = $('shareList');
    list.innerHTML = '<li style="padding:12px; font-size:13px; color:var(--text-sub);">Ladataan...</li>';

    try {
      const res = await fetch(`${baseUrl}/devices/${encodeURIComponent(deviceId)}/shares`, {
        headers: { 'Authorization': `Bearer ${authState.token}` }
      });
      if (!res.ok) throw new Error();
      const shares = await res.json();
      
      list.innerHTML = '';
      if (shares.length === 0) {
        list.innerHTML = '<li style="padding:12px; font-size:13px; color:var(--text-sub);">Ei jaettuja käyttöoikeuksia.</li>';
        return;
      }

      shares.forEach(share => {
        const li = document.createElement('li');
        li.style.cssText = 'padding:8px 12px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; font-size:14px;';
        
        const isMaster = share.role === 'master';
        li.innerHTML = `
          <span>
            ${escapeHtml(share.email)} 
            <small style="color:var(--text-sub); font-size:11px;">(${isMaster ? 'Omistaja' : 'Käyttäjä'})</small>
          </span>
          ${!isMaster ? `<button class="remove-share" data-email="${share.email}" style="width:auto; margin:0; padding:4px 8px; background-color:#d13438; font-size:12px;">Poista</button>` : ''}
        `;
        list.appendChild(li);
      });

      // Add delete listeners
      list.querySelectorAll('.remove-share').forEach(btn => {
        btn.addEventListener('click', () => removeShare(deviceId, btn.dataset.email));
      });

    } catch (err) {
      list.innerHTML = '<li style="padding:12px; font-size:13px; color:#d13438;">Virhe latauksessa.</li>';
    }
  }

  $('btnDoShare').addEventListener('click', async () => {
    const deviceId = inputs.deviceSelect.value;
    const email = inputs.shareEmail.value.trim();
    const status = $('shareStatus');

    if (!email) return;

    status.textContent = 'Lisätään...';
    status.className = 'status-msg info';

    try {
      const res = await fetch(`${baseUrl}/devices/${encodeURIComponent(deviceId)}/share`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authState.token}`
        },
        body: JSON.stringify({ email })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Virhe');

      status.textContent = 'Käyttäjä lisätty!';
      status.className = 'status-msg success';
      inputs.shareEmail.value = '';
      loadShares(deviceId);
    } catch (err) {
      status.textContent = err.message;
      status.className = 'status-msg error';
    }
  });

  async function removeShare(deviceId, targetEmail) {
    if (!confirm(`Poistetaanko käyttäjän ${targetEmail} käyttöoikeus?`)) return;

    try {
      const res = await fetch(`${baseUrl}/devices/${encodeURIComponent(deviceId)}/share/${encodeURIComponent(targetEmail)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authState.token}` }
      });
      if (!res.ok) throw new Error();
      loadShares(deviceId);
    } catch (err) {
      alert('Poisto epäonnistui');
    }
  }

  $('btnReleaseDevice').addEventListener('click', async () => {
    const deviceId = inputs.deviceSelect.value;
    const device = authState.devices.find(d => d.id === deviceId);
    if (!device) return;

    const confirmed = confirm(
      `HALUATKO VARMASTI VAPAUTTAA LAITTEEN?\n\n` +
      `Tämä poistaa laitteen "${device.friendlyName || deviceId}" tililtäsi ja kaikilta muilta käyttäjiltä.\n\n` +
      `Laite on tämän jälkeen provisionoitava uudelleen tai "claimattava" uudelleen.`
    );

    if (!confirmed) return;

    try {
      const res = await fetch(`${baseUrl}/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authState.token}` }
      });
      
      if (!res.ok) throw new Error();
      
      views.shareModal.style.display = 'none';
      await loadDevices(); // Refresh list and history
      setAppStatus('Laite vapautettu onnistuneesti', 'success');
    } catch (err) {
      alert('Laitteen vapauttaminen epäonnistui');
    }
  });

  // --- RENAME LOGIC ---
  $('btnOpenRename').addEventListener('click', () => {
    const deviceId = inputs.deviceSelect.value;
    const device = authState.devices.find(d => d.id === deviceId);
    if (!device) return;

    inputs.renameFriendlyName.value = device.friendlyName || '';
    views.renameModal.style.display = 'flex';
    $('renameStatus').textContent = '';
  });

  $('btnCloseRename').addEventListener('click', () => {
    views.renameModal.style.display = 'none';
  });

  $('btnSaveRename').addEventListener('click', async () => {
    const deviceId = inputs.deviceSelect.value;
    const friendlyName = inputs.renameFriendlyName.value.trim();
    const status = $('renameStatus');

    if (!friendlyName) return;

    status.textContent = 'Tallennetaan...';
    status.className = 'status-msg info';

    try {
      const res = await fetch(`${baseUrl}/devices/${encodeURIComponent(deviceId)}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authState.token}`
        },
        body: JSON.stringify({ friendlyName })
      });
      
      if (!res.ok) throw new Error();

      status.textContent = 'Nimi päivitetty!';
      status.className = 'status-msg success';
      
      // Update local state to avoid full reload
      const dev = authState.devices.find(d => d.id === deviceId);
      if (dev) dev.friendlyName = friendlyName;
      
      renderDeviceSelect(); // Refresh labels in UI
      setTimeout(() => views.renameModal.style.display = 'none', 1000);
    } catch (err) {
      status.textContent = 'Virhe tallennuksessa';
      status.className = 'status-msg error';
    }
  });


  // --- IOT LOGIC ---
  async function loadIotStatus() {
    const deviceId = inputs.deviceSelect.value;
    if (!deviceId) {
      views.iotControls.classList.add('hidden');
      return;
    }

    const badge = displays.iotStatusBadge;
    const msg = displays.iotStatusMsg;
    const controls = views.iotControls;
    const notReg = views.iotNotRegistered;
    const buttons = views.iotButtons;

    badge.textContent = 'Ladataan...';
    badge.style.background = '#eee';
    badge.style.color = '#666';
    msg.textContent = '';
    
    controls.classList.remove('hidden');

    try {
      const res = await fetch(`${baseUrl}/devices/${encodeURIComponent(deviceId)}/iot-status`, {
        headers: { 'Authorization': `Bearer ${authState.token}` }
      });
      
      if (res.status === 404) {
        badge.textContent = 'Ei rekisteröity';
        notReg.classList.remove('hidden');
        buttons.classList.add('hidden');
        return;
      }

      if (!res.ok) throw new Error();

      const status = await res.json();
      
      notReg.classList.add('hidden');
      buttons.classList.remove('hidden');

      if (status.connectionState === 'Connected') {
        badge.textContent = 'Online';
        badge.style.background = '#d4edda';
        badge.style.color = '#155724';
      } else {
        badge.textContent = 'Offline';
        badge.style.background = '#f8d7da';
        badge.style.color = '#721c24';
      }
      
      if (status.mock) {
        badge.textContent += ' (MOCK)';
      }
    } catch (err) {
      badge.textContent = 'Virhe';
      badge.style.background = '#f8d7da';
      badge.style.color = '#721c24';
      notReg.classList.add('hidden');
      buttons.classList.add('hidden');
    }
  }

  async function sendIotCommand(command, payload = {}) {
    const deviceId = inputs.deviceSelect.value;
    if (!deviceId) return;

    const msg = displays.iotStatusMsg;
    const buttons = views.iotButtons.querySelectorAll('button');
    
    // Disable buttons and show loading state
    buttons.forEach(btn => btn.disabled = true);
    msg.textContent = 'Suoritetaan laitteella...';
    msg.className = 'status-msg info';

    try {
      const res = await fetch(`${baseUrl}/devices/${encodeURIComponent(deviceId)}/commands/${command}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authState.token}`
        },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Virhe');

      if (data.mode === 'direct') {
        msg.textContent = `✅ Suoritettu välittömästi (Status: ${data.methodStatus})`;
        msg.className = 'status-msg success';
      } else {
        msg.textContent = `📨 Komento jonossa (Laite offline tai hidas)`;
        msg.className = 'status-msg info';
      }
      
      setTimeout(() => { if (msg.className.includes('success')) msg.textContent = ''; }, 4000);
    } catch (err) {
      msg.textContent = `❌ Virhe: ${err.message}`;
      msg.className = 'status-msg error';
    } finally {
      buttons.forEach(btn => btn.disabled = false);
    }
  }

  async function registerIot() {
    const deviceId = inputs.deviceSelect.value;
    if (!deviceId) return;

    const btn = $('btnRegisterIoT');
    const msg = displays.iotStatusMsg;

    btn.disabled = true;
    msg.textContent = 'Rekisteröidään laitetta IoT Hubiin...';
    msg.className = 'status-msg info';

    try {
      const res = await fetch(`${baseUrl}/devices/${encodeURIComponent(deviceId)}/register-iot`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authState.token}` }
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rekisteröinti epäonnistui');

      msg.textContent = 'Laite rekisteröity onnistuneesti!';
      msg.className = 'status-msg success';
      await loadIotStatus();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'status-msg error';
    } finally {
      btn.disabled = false;
    }
  }

  // IoT Event Listeners
  $('btnRegisterIoT').addEventListener('click', registerIot);
  $('btnIotPlay').addEventListener('click', () => sendIotCommand('play'));
  $('btnIotPause').addEventListener('click', () => sendIotCommand('pause'));
  $('btnIotFullscreen').addEventListener('click', () => sendIotCommand('fullscreen'));
  $('btnIotRestart').addEventListener('click', () => {
    if (confirm('Haluatko varmasti käynnistää laitteen uudelleen?')) {
      sendIotCommand('restart');
    }
  });
  $('btnIotStatus').addEventListener('click', loadIotStatus);


  // Helpers
  function setAppStatus(msg, type) {
    displays.appStatus.textContent = msg;
    displays.appStatus.className = `status-msg ${type}`;
    if (type === 'success') setTimeout(() => { if (displays.appStatus.className.includes('success')) displays.appStatus.textContent = ''; }, 3000);
  }
  function escapeHtml(text) { if (!text) return ''; return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
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

  // --- INIT ---
  if (authState.token && authState.userEmail) { switchToApp(); }
  else { showView('stepLookup'); }

})();
