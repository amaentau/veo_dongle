'use strict';

(function () {
  function $(id) { return document.getElementById(id); }
  function show(el, obj) { el.textContent = JSON.stringify(obj, null, 2); }

  const baseUrl = (window.BBS_CONFIG && window.BBS_CONFIG.baseUrl) || '';

  $('post-btn').addEventListener('click', async () => {
    const key = $('post-key').value.trim();
    const value1 = $('post-value1').value.trim();
    const value2 = $('post-value2').value.trim();
    $('post-out').textContent = 'Working...';
    try {
      const resp = await fetch(baseUrl + '/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value1, value2 })
      });
      const data = await resp.json();
      show($('post-out'), data);
    } catch (err) {
      show($('post-out'), { error: String(err) });
    }
  });

  $('get-btn').addEventListener('click', async () => {
    const key = $('get-key').value.trim();
    $('get-out').textContent = 'Working...';
    try {
      const resp = await fetch(baseUrl + '/entries/' + encodeURIComponent(key));
      const data = await resp.json();
      show($('get-out'), data);
    } catch (err) {
      show($('get-out'), { error: String(err) });
    }
  });
})();































