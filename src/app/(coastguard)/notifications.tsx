import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { NotificationInbox } from '@/components/NotificationInbox';

export default function CoastguardNotificationsScreen() {
  return (
    <NotificationInbox
      header={<AdminScreenHeader role="coastguard" title="Notifications" showBack={false} />}
    />
  );
}
