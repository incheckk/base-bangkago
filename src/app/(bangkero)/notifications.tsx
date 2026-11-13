import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { NotificationInbox } from '@/components/NotificationInbox';

export default function BangkeroNotificationsScreen() {
  return <NotificationInbox header={<BangkeroScreenHeader title="Notifications" />} />;
}
