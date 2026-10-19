(async function () {
  // Route guard: real Supabase session + users.user_role must be 'admin'.
  // Loads config + client on demand (same dynamic-script pattern as the
  // theme loader below); anything but an admin bounces to the access portal.
  // Exposes window.bangkagoAuthReady promise that resolves when auth is verified.
  window.bangkagoAuthReady = (async function () {
    async function guard(roles) {
      function load(src) {
        return new Promise(function (resolve) {
          var s = document.createElement('script');
          s.src = src;
          s.onload = resolve;
          s.onerror = resolve;
          document.head.appendChild(s);
        });
      }
      // config + vendored UMD have no dependency on each other,
      // so fetch them together; supabase-client needs both.
      await Promise.all([
        load('../../config.js'),
        load('../../assets/js/supabase.js'), // vendored UMD — no CDN
      ]);
      await load('../../supabase-client.js');
      // role() restores the session itself; 'unverified' means the
      // session exists but the network refused to confirm it — that
      // is a connection problem, NOT a logout, so retry before deciding.
      // A missing window.bangkago = the client file failed to load —
      // also a connection problem, not "signed out".
      var role = window.bangkago ? await window.bangkago.role() : 'unverified';
      if (role === 'unverified') {
        for (var i = 0; i < 4 && role === 'unverified'; i++) {
          await new Promise(function (r) { setTimeout(r, 1500 * (i + 1)); });
          role = window.bangkago ? await window.bangkago.role() : 'unverified';
        }
      }
      if (role === 'unverified') {
        showConnectionBanner();
        return role;
      }
      if (roles.indexOf(role) === -1) location.replace('../../bangkaGo-access.html');
      return role;
    }

    // Signed in but unreachable: stay on the page and say so, instead
    // of the old behaviour (bounce to the login portal over any blip).
    function showConnectionBanner() {
      if (document.getElementById('bgConnectionBanner')) return;
      var el = document.createElement('div');
      el.id = 'bgConnectionBanner';
      el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2000;' +
        'background:#b45309;color:#fff;padding:10px 16px;text-align:center;' +
        'font:600 14px/1.4 Sora,system-ui,sans-serif;';
      el.textContent =
        'Connection problem — could not verify your session. ' +
        'Check your internet; the page will keep retrying.';
      document.body.appendChild(el);
      setInterval(function () {
        if (!window.bangkago) return;
        window.bangkago.role().then(function (r) {
          if (r && r !== 'unverified') location.reload();
        });
      }, 10000);
    }
    const isCoastguardPage = location.pathname.indexOf('/coastguard-dashboard/') !== -1;
    const verifiedRole = await guard(isCoastguardPage ? ['coastguard'] : ['admin']);
    // Let realtime.js attach queued subscriptions now that the client exists.
    window.dispatchEvent(new CustomEvent('bangkago-auth-ready', { detail: { role: verifiedRole } }));
    return verifiedRole;
  })();

  const sidebarMount = document.getElementById('sidebarMount');
  const topbarMount = document.getElementById('topbarMount');

  async function loadPartial(path, mountEl) {
    if(!mountEl) return;
    try{
      const res = await fetch(path);
      const html = await res.text();
      mountEl.innerHTML = html;
    }catch(e){ console.warn('partial load failed', path, e); }
  }

  await Promise.all([
    loadPartial('partials/sidebar.html', sidebarMount),
    loadPartial('partials/topbar.html', topbarMount),
  ]);

  const main = document.querySelector('.cg-main');
  if (main && !main.querySelector('.cg-footer')) {
    const footer = document.createElement('footer');
    footer.className = 'cg-footer';
    footer.innerHTML = '<span class="cg-footer-note">Mactan - Olango</span>';
    main.appendChild(footer);
  }

  const topbarMeta = {
    'admin-dashboard': { title: 'Dashboard', subtitle: 'Admin operations overview and live system snapshot' },
    'manage-users': { title: 'Manage Users', subtitle: 'Create, update, and monitor user access' },
    'manage-bangkeros': { title: 'Manage Bangkeros', subtitle: 'Maintain bangkero records and status' },
    'manage-bangka': { title: 'Manage Bangka', subtitle: 'Maintain vessel master list and availability' },
    'manage-routes': { title: 'Manage Routes', subtitle: 'Configure official routes and travel corridors' },
    'manage-bookings': { title: 'Manage Bookings', subtitle: 'Review booking flow, assignments, and status' },
    'downpayments': { title: 'Downpayments', subtitle: 'Confirm GCash escrow before trips are released' },
    'monitor-fleet': { title: 'Monitor Fleet', subtitle: 'Live fleet monitoring and real-time vessel tracking' },
    'track-vessel': { title: 'Track Vessel', subtitle: 'Merged fleet monitoring and real-time vessel tracking' },
    'manage-payments': { title: 'Manage Payments', subtitle: 'Track transactions, verification, and settlements' },
    'manage-alerts': { title: 'Manage Alerts', subtitle: 'Create and monitor operational alert rules' },
    'view-reports': { title: 'View Reports', subtitle: 'Operations, compliance, and system reports' },
    'analyze-demand': { title: 'Analyze Demand', subtitle: 'Demand trends, peak windows, and forecast insights' },
    'ratings': { title: 'Bangkero Ratings', subtitle: 'Effective ratings, penalties, and accept-gate locks' },
    'audit-log': { title: 'Audit Log', subtitle: 'Every admin change, who made it, and what it was before' },
    'view-manifest': { title: 'View Manifest', subtitle: 'Search manifests, view passenger list, and export' },
    'view-manifests': { title: 'View Manifests', subtitle: 'Search manifests, view passenger list, and export' },
    'view-weather': { title: 'View Weather', subtitle: 'Weather data and route safety status' },
    'report-compliance': { title: 'Report Compliance Issue', subtitle: 'File compliance incidents with evidence' },
    'suspend-user': { title: 'Suspend User', subtitle: 'Confirm user suspension' },
    'document-review': { title: 'Document Review', subtitle: 'Review bangkero verification documents' },
    'boat-rentals': { title: 'Boat Rentals', subtitle: 'View all boat charter bookings' },
    'system-alerts': { title: 'System Alerts', subtitle: 'System-wide alerts and notifications' }
  };

  const currentFile = location.pathname.split('/').pop() || 'admin-dashboard.html';
  const currentKey = currentFile.replace('.html', '');

  const titleEl = document.getElementById('topbarTitle');
  const subtitleEl = document.getElementById('topbarSubtitle');
  const meta = topbarMeta[currentKey] || topbarMeta['admin-dashboard'];
  if (titleEl) titleEl.textContent = meta.title;
  if (subtitleEl) subtitleEl.textContent = meta.subtitle;

  document.querySelectorAll('#cgNav a[data-page]').forEach(function(a){
    if (a.dataset.page === currentFile) a.classList.add('active');
  });

  // Restore sidebar scroll for ALL tabs BEFORE theme init so position persists
  (function(){
    try{
      const nav = document.getElementById('cgNav');
      if(!nav) return;
      const key = 'bangkago_admin_nav_scroll';
      const saved = sessionStorage.getItem(key);
      if(saved !== null){
        const top = parseInt(saved,10);
        if(!isNaN(top)) nav.scrollTop = top;
      }
      const active = nav.querySelector('a.active');
      if(active){
        const r = active.getBoundingClientRect();
        const nr = nav.getBoundingClientRect();
        if(r.top < nr.top || r.bottom > nr.bottom) active.scrollIntoView({ block:'nearest', inline:'nearest' });
      }
    }catch(e){}
  })();

  // init theme after partials injected
  if (window.AdminTheme && typeof window.AdminTheme.init === 'function'){
    window.AdminTheme.init();
  }
  // ensure script present for direct loads without prior include
  if (!document.querySelector('script[src$="/assets/js/admin-theme.js"]')){
    const script = document.createElement('script');
    script.src = '../assets/js/admin-theme.js';
    script.onload = function(){ if(window.AdminTheme) window.AdminTheme.init(); };
    document.body.appendChild(script);
  }
})();
