(async function () {
  // Route guard: real Supabase session + users.user_role must be 'coastguard'.
  // Loads config + client on demand (same dynamic-script pattern as the
  // theme loader below); anything but a coastguard bounces to the access portal.
  async function guard(roles) {
    function load(src) {
      return new Promise(function (resolve) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = resolve; // failed load -> role() returns null -> redirect
        document.head.appendChild(s);
      });
    }
    await load('../../config.js');
    await load('../../assets/js/supabase.js'); // vendored UMD — no CDN
    await load('../../supabase-client.js');
    var role = window.bangkago ? await window.bangkago.role() : null;
    if (roles.indexOf(role) === -1) location.replace('../../bangkaGo-access.html');
  }
  await guard(['coastguard']);

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

  // Scroll restoration handled by CoastguardTheme.setupNavScroll — no duplicate here

  if (window.CoastguardTheme && typeof window.CoastguardTheme.init === 'function'){
    window.CoastguardTheme.init();
  }
  if (!document.querySelector('script[src="assets/js/coastguard-theme.js"]')) {
    const script = document.createElement('script');
    script.src = 'assets/js/coastguard-theme.js';
    script.onload = function(){ if(window.CoastguardTheme) window.CoastguardTheme.init(); };
    document.body.appendChild(script);
  }
})();
