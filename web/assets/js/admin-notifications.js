(function () {
  'use strict';

  const KIND_LABEL = {
    booking: 'Booking',
    payment: 'Payment',
    cargo: 'Cargo',
    safety: 'Safety',
    account: 'Account',
    system: 'System',
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function relativeTime(iso) {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '';
    const minutes = Math.floor((Date.now() - then) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days < 7) return days + 'd ago';
    return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  }

  function init() {
    const root = document.getElementById('topbarNotifications');
    if (!root || root.dataset.initialized === '1') return;
    root.dataset.initialized = '1';

    const toggle = document.getElementById('notificationsToggle');
    const panel = document.getElementById('notificationsPanel');
    const badge = document.getElementById('notificationsBadge');
    const summary = document.getElementById('notificationsSummary');
    const list = document.getElementById('notificationsList');
    const refresh = document.getElementById('notificationsRefresh');
    const markAll = document.getElementById('notificationsMarkAll');
    const clearOld = document.getElementById('notificationsClearOld');
    let rows = [];
    let loaded = false;
    let busy = false;
    let reloadPending = false;

    function updateToggleLabel() {
      const unread = rows.filter(function (row) { return !row.isRead; }).length;
      const label = toggle.classList.contains('has-new') ? 'New notification' : 'Notifications';
      toggle.setAttribute('aria-label', label + (unread ? ', ' + unread + ' unread' : ''));
    }

    function render() {
      const unread = rows.filter(function (row) { return !row.isRead; }).length;
      summary.textContent = unread ? unread + ' unread' : 'All caught up';
      badge.hidden = unread === 0;
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.setAttribute('aria-label', unread + ' unread notifications');
      updateToggleLabel();
      markAll.disabled = unread === 0 || busy;

      if (!rows.length) {
        list.innerHTML = '<div class="topbar-notifications-state">You are all caught up.</div>';
        return;
      }

      list.innerHTML = rows.map(function (row) {
        const kind = KIND_LABEL[row.category] ? row.category : 'system';
        const title = row.title || 'Notification';
        return '<button class="topbar-notification-item' + (row.isRead ? '' : ' is-unread') + '" type="button" data-id="' + esc(row.id) + '" aria-label="Notification: ' + esc(title) + (row.isRead ? ', read' : ', unread. Select to mark as read') + '">'
          + '<span class="topbar-notification-dot" aria-hidden="true"></span>'
          + '<span class="topbar-notification-main">'
          + '<span class="topbar-notification-title">' + esc(title) + '</span>'
          + '<span class="topbar-notification-message">' + esc(row.message || '') + '</span>'
          + '<span class="topbar-notification-meta"><span class="topbar-notification-kind">' + esc(KIND_LABEL[kind]) + '</span>'
          + '<time datetime="' + esc(row.createdAt) + '">' + esc(relativeTime(row.createdAt)) + '</time></span>'
          + '</span></button>';
      }).join('');
    }

    function showError(error) {
      summary.textContent = 'Could not refresh';
      if (!loaded) {
        list.innerHTML = '<div class="topbar-notifications-state topbar-notifications-error">Notifications could not be loaded. Check your connection and try again.</div>';
      } else {
        console.error('Notification request failed:', error);
      }
    }

    async function load() {
      if (busy) {
        reloadPending = true;
        return;
      }
      busy = true;
      refresh.disabled = true;
      markAll.disabled = true;
      try {
        rows = await window.bangkagoNotifications.list(100);
        loaded = true;
        render();
      } catch (error) {
        showError(error);
      } finally {
        busy = false;
        refresh.disabled = false;
        markAll.disabled = !rows.some(function (row) { return !row.isRead; });
        if (reloadPending) {
          reloadPending = false;
          load();
        }
      }
    }

    toggle.addEventListener('click', function () {
      const isOpen = !panel.hidden;
      panel.hidden = isOpen;
      toggle.setAttribute('aria-expanded', String(!isOpen));
      if (!isOpen) {
        toggle.classList.remove('has-new');
        updateToggleLabel();
        if (!loaded) load();
      }
    });

    document.addEventListener('click', function (event) {
      const path = event.composedPath ? event.composedPath() : [];
      if (path.indexOf(root) === -1 && !root.contains(event.target)) {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !panel.hidden) {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });

    refresh.addEventListener('click', load);

    list.addEventListener('click', async function (event) {
      const rowEl = event.target.closest('.topbar-notification-item[data-id]');
      if (!rowEl) return;
      const row = rows.find(function (item) { return item.id === rowEl.dataset.id; });
      if (!row || row.isRead) return;
      rowEl.disabled = true;
      try {
        await window.bangkagoNotifications.markRead(row.id);
        row.isRead = true;
        render();
      } catch (error) {
        rowEl.disabled = false;
        console.error('Failed to mark notification read:', error);
        summary.textContent = 'Could not mark as read';
      }
    });

    markAll.addEventListener('click', async function () {
      if (busy || !rows.some(function (row) { return !row.isRead; })) return;
      busy = true;
      markAll.disabled = true;
      try {
        await window.bangkagoNotifications.markAllRead();
        rows.forEach(function (row) { row.isRead = true; });
        render();
      } catch (error) {
        console.error('Failed to mark all notifications read:', error);
        summary.textContent = 'Could not mark all read';
      } finally {
        busy = false;
        markAll.disabled = !rows.some(function (row) { return !row.isRead; });
        if (reloadPending) {
          reloadPending = false;
          load();
        }
      }
    });

    clearOld.addEventListener('click', async function () {
      if (!window.confirm('Delete notifications older than 24 hours?')) return;
      clearOld.disabled = true;
      try {
        await window.bangkagoNotifications.clearOld();
        await load();
      } catch (error) {
        console.error('Failed to clear old notifications:', error);
        summary.textContent = 'Could not clear old notifications';
      } finally {
        clearOld.disabled = false;
      }
    });

    window.bangkagoRealtime.subscribe('notifications', null, function (payload) {
      if (payload && payload.eventType === 'INSERT') {
        toggle.classList.add('has-new');
        updateToggleLabel();
      }
      load();
    });
    load();
  }

  window.AdminNotifications = { init: init };
})();
