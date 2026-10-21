(async function () {
  // Route guard: real Supabase session + users.user_role must be 'admin'.
  // Loads config + client on demand (same dynamic-script pattern as the
  // theme loader below); anything but an admin bounces to the access portal.
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
    var role = window.bangkago ? await window.bangkago.role() : null;
    console.log('User role:', role);
    if (roles.indexOf(role) === -1) {
      console.warn('Access denied: user role', role, 'not in allowed roles', roles);
      location.replace('../../bangkaGo-access.html');
    }
  }
  try {
    await guard(['admin']);
  } catch (e) {
    console.error('Guard failed:', e);
    location.replace('../../bangkaGo-access.html');
    return;
  }

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
    'admin-dashboard': { title: 'Dashboard', subtitle: 'Admin operations overview and live system snapshot' },
    'manage-users': { title: 'Manage Users', subtitle: 'Create, update, and monitor user access' },
    'manage-bangkeros': { title: 'Manage Bangkeros', subtitle: 'Maintain bangkero records and status' },
    'manage-bangka': { title: 'Manage Bangka', subtitle: 'Maintain vessel master list and availability' },
    'manage-routes': { title: 'Manage Routes', subtitle: 'Configure official routes and travel corridors' },
    'manage-bookings': { title: 'Manage Bookings', subtitle: 'Review booking flow, assignments, and status' },
    'monitor-fleet': { title: 'Monitor Fleet', subtitle: 'Live fleet monitoring and real-time vessel tracking' },
    'track-vessel': { title: 'Track Vessel', subtitle: 'Merged fleet monitoring and real-time vessel tracking' },
    'manage-payments': { title: 'Manage Payments', subtitle: 'Track transactions, verification, and settlements' },
    'manage-alerts': { title: 'Manage Alerts', subtitle: 'Create and monitor operational alert rules' },
    'view-reports': { title: 'View Reports', subtitle: 'Operations, compliance, and system reports' },
    'analyze-demand': { title: 'Analyze Demand', subtitle: 'Demand trends, peak windows, and forecast insights' },
    'view-manifest': { title: 'View Manifest', subtitle: 'Search manifests, view passenger list, and export' },
    'view-manifests': { title: 'View Manifests', subtitle: 'Search manifests, view passenger list, and export' },
    'view-weather': { title: 'View Weather', subtitle: 'Weather data and route safety status' },
    'report-compliance': { title: 'Report Compliance Issue', subtitle: 'File compliance incidents and review contact feedback' },
    'suspend-user': { title: 'Suspend User', subtitle: 'Confirm user suspension' },
    'document-review': { title: 'Document Review', subtitle: 'Review bangkero verification documents' },
    'boat-rentals': { title: 'Boat Rentals', subtitle: 'View all boat charter bookings' },
    'system-alerts': { title: 'System Alerts', subtitle: 'System-wide alerts and notifications' },
    'profile': { title: 'Profile', subtitle: 'Admin account settings' }
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
    }catch(e){ console.warn('Sidebar scroll restore failed:', e); }
  })();

  // init theme after partials injected
  if (window.AdminTheme && typeof window.AdminTheme.init === 'function'){
    window.AdminTheme.init();
  }
  // ensure script present for direct loads without prior include
  if (!document.querySelector('script[src="../../assets/js/admin-theme.js"]')){
    var script = document.createElement('script');
    script.src = '../../assets/js/admin-theme.js';
    script.onload = function(){ if(window.AdminTheme) window.AdminTheme.init(); };
    document.body.appendChild(script);
  }
})();