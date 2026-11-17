import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { NotificationInbox } from '@/components/NotificationInbox';

export default function AdminNotificationsScreen() {
  return (
    <NotificationInbox
      header={<AdminScreenHeader role="admin" title="Notifications" />}
    />
  );
}
