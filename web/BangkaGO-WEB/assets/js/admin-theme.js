window.AdminTheme = (function () {
  const SIDEBAR_STATE_KEY = 'bangkago_admin_sidebar_collapsed';

  function getElements(){
    const sidebar = document.getElementById('cgSidebar') || document.getElementById('adminSidebar');
    // main can be #cgMain (current) or #adminMain (legacy)
    const main = document.getElementById('cgMain') || document.getElementById('adminMain') || document.querySelector('.cg-main');
    const mobileToggle = document.getElementById('sidebarMobileToggle');
    const desktopToggle = document.getElementById('sidebarDesktopToggle');
    const nav = document.getElementById('cgNav') || document.getElementById('adminNav');
    return { sidebar, main, mobileToggle, desktopToggle, nav };
  }

  function init() {
    const { sidebar, main, mobileToggle, desktopToggle, nav } = getElements();
    if (!sidebar || !main) return;
    if (sidebar.dataset.initialized === '1') return;
    sidebar.dataset.initialized = '1';

    function setActiveLink() {
      if (!nav) return;
      const current = window.location.pathname.split('/').pop() || 'admin-dashboard.html';
      nav.querySelectorAll('a[data-page]').forEach(function(link){
        link.classList.toggle('active', link.getAttribute('data-page') === current);
      });
    }

    function applyDesktopCollapsed(collapsed) {
      if (window.innerWidth < 992) return;
      sidebar.classList.toggle('collapsed', collapsed);
      main.classList.toggle('expanded', collapsed);
      try{ localStorage.setItem(SIDEBAR_STATE_KEY, collapsed ? '1' : '0'); }catch(e){}
    }

    function initDesktopState() {
      if (window.innerWidth < 992) return;
      try{
        const saved = localStorage.getItem(SIDEBAR_STATE_KEY);
        applyDesktopCollapsed(saved === '1');
      }catch(e){}
    }

    if (mobileToggle) {
      mobileToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        if (window.innerWidth < 992) {
          sidebar.classList.toggle('show');
        } else {
          // fallback for larger screens if needed
          sidebar.classList.toggle('show');
        }
      });
    }

    if (desktopToggle) {
      desktopToggle.addEventListener('click', function () {
        applyDesktopCollapsed(!sidebar.classList.contains('collapsed'));
      });
    }

    document.addEventListener('click', function (e) {
      if (window.innerWidth >= 992) return;
      const clickedInsideSidebar = sidebar.contains(e.target);
      const clickedToggle = mobileToggle && mobileToggle.contains(e.target);
      if (!clickedInsideSidebar && !clickedToggle) {
        sidebar.classList.remove('show');
      }
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth >= 992) {
        sidebar.classList.remove('show');
        initDesktopState();
      } else {
        sidebar.classList.remove('collapsed');
        main.classList.remove('expanded');
      }
    });

    setActiveLink();
    initDesktopState();
    setupNavScroll();
  }

  const NAV_SCROLL_KEY = 'bangkago_admin_nav_scroll';
  function setupNavScroll(){
    const nav = document.getElementById('cgNav') || document.getElementById('adminNav');
    if(!nav) return;
    if(nav.dataset.scrollInit === '1') return;
    nav.dataset.scrollInit = '1';

    // Restore scroll for ALL tabs (session-scoped)
    try{
      const saved = sessionStorage.getItem(NAV_SCROLL_KEY);
      if(saved !== null){
        const top = parseInt(saved, 10);
        if(!isNaN(top)) nav.scrollTop = top;
      }
      // Ensure active link is visible without jumping to top
      const active = nav.querySelector('a.active');
      if(active){
        const r = active.getBoundingClientRect();
        const nr = nav.getBoundingClientRect();
        if(r.top < nr.top || r.bottom > nr.bottom){
          active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }
    }catch(e){}

    let raf = false;
    let hideTimer = null;
    function persist(){
      try{ sessionStorage.setItem(NAV_SCROLL_KEY, String(nav.scrollTop)); }catch(e){}
    }
    function showWhileScrolling(){
      nav.classList.add('is-scrolling');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function(){ nav.classList.remove('is-scrolling'); }, 900);
    }
    nav.addEventListener('scroll', function(){
      if(raf) return;
      raf = true;
      requestAnimationFrame(function(){
        persist();
        showWhileScrolling();
        raf = false;
      });
    }, { passive: true });
    nav.addEventListener('wheel', function(){ showWhileScrolling(); }, { passive: true });
    nav.addEventListener('touchmove', function(){ showWhileScrolling(); }, { passive: true });
    nav.querySelectorAll('a[data-page]').forEach(function(a){
      a.addEventListener('click', function(){ persist(); });
    });
  }

  // Auto-init if DOM already has sidebar (for direct loads), else expose init for layout-loader
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // defer to allow partials to mount
    setTimeout(init, 0);
  }

  return { init };
})();
