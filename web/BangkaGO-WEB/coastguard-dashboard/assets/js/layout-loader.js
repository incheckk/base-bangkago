(async function () {
  // Route guard: real Supabase session + users.user_role must be 'coastguard'.
  // Loads config + client on demand (same dynamic-script pattern as the
  // theme loader below); anything but a coastguard bounces to the access portal.
  // Exposes window.bangkagoAuthReady promise that resolves when auth is verified.
  window.bangkagoAuthReady = (async function () {
    async function guard(roles) {
      function load(src) {
        return new Promise(function (resolve) {
          var s = document.createElement('script');
          s.src = src;
          s.onload = resolve;
          s.onerror = function () {
            console.error('Failed to load script:', src);
            resolve(); // failed load -> role() returns null -> redirect
          };
          document.head.appendChild(s);
        });
      }
      try {
        await load('../../config.js');
        await load('../../assets/js/supabase.js'); // vendored UMD — no CDN
        await load('../../supabase-client.js');
      } catch (e) {
        console.error('Failed to load guard scripts:', e);
      }
      // Wait for Supabase client to restore session from localStorage
      if (window.bangkago && window.bangkago.client) {
        await window.bangkago.client.auth.getSession();
      }
      var role = window.bangkago ? await window.bangkago.role() : null;
      console.log('User role:', role);
      if (roles.indexOf(role) === -1) {
        console.warn('Access denied: user role', role, 'not in allowed roles', roles);
        location.replace('../../bangkaGo-access.html');
      }
      return role;
    }
    try {
      await guard(['coastguard']);
    } catch (e) {
      console.error('Guard failed:', e);
      location.replace('../../bangkaGo-access.html');
      return;
    }
  })();

  const sidebarMount = document.getElementById('sidebarMount');
  const topbarMount = document.getElementById('topbarMount');

  if (!sidebarMount) {
    console.error('sidebarMount element not found');
  }
  if (!topbarMount) {
    console.error('topbarMount element not found');
  }

  async function loadPartial(path, mountEl) {
    if (!mountEl) {
      console.warn('Mount element not provided for', path);
      return;
    }
    try {
      console.log('Loading partial:', path);
      const res = await fetch(path);
      if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' ' + res.statusText);
      }
      const html = await res.text();
      mountEl.innerHTML = html;
      console.log('Loaded partial:', path);
    } catch (e) {
      console.error('Partial load failed:', path, e);
    }
  }

  try {
    await Promise.all([
      loadPartial('partials/sidebar.html', sidebarMount),
      loadPartial('partials/topbar.html', topbarMount),
    ]);
    console.log('All partials loaded successfully');
  } catch (e) {
    console.error('Failed to load partials:', e);
  }

  const topbarMeta = {
    'index': { title: 'Dashboard', subtitle: 'LGU / Coast Guard monitoring overview' },
    'monitor-fleet': { title: 'Monitor Fleet', subtitle: 'Live fleet movement, route watch, and position history' },
    'view-manifests': { title: 'View Manifests', subtitle: 'Read-only passenger/cargo manifests with quick export' },
    'view-weather': { title: 'View Weather', subtitle: 'Marine weather, sea conditions, and advisories' },
    'view-bangkeros': { title: 'View Bangkeros', subtitle: 'Read-only list of registered bangkero records' },
    'report-compliance': { title: 'Report Compliance Issue', subtitle: 'Submit compliance concerns for admin review' },
    'alerts': { title: 'View Active Alerts', subtitle: 'Alert feed with vessel, severity, and response status' },
    'reports': { title: 'View Operator Records', subtitle: 'Operator activity logs and compliance-related records' },
    'verify-departure': { title: 'Verify Departure', subtitle: 'Confirm vessel departure readiness' },
    'search-vessel': { title: 'Search Vessel', subtitle: 'Lookup vessel records and compliance' },
    'port-history': { title: 'Port History', subtitle: 'Historical port activity and movements' },
    'export-manifest': { title: 'Export Manifest', subtitle: 'Generate manifest exports for records' }
  };

  const currentFile = location.pathname.split('/').pop() || 'index.html';
  const currentKey = currentFile.replace('.html', '');

  const titleEl = document.getElementById('topbarTitle');
  const subtitleEl = document.getElementById('topbarSubtitle');
  const meta = topbarMeta[currentKey] || topbarMeta['index'];
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
    }catch(e){ console.warn('Sidebar scroll restore failed:', e); }
  })();

  // init theme after partials injected
  if (window.CoastguardTheme && typeof window.CoastguardTheme.init === 'function'){
    window.CoastguardTheme.init();
  }
  // ensure script present for direct loads without prior include
  if (!document.querySelector('script[src="../../../assets/js/coastguard-theme.js"]')){
    var script = document.createElement('script');
    script.src = '../../../assets/js/coastguard-theme.js';
    script.onload = function(){ if(window.CoastguardTheme) window.CoastguardTheme.init(); };
    document.body.appendChild(script);
  }
})();