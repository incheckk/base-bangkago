import { NotificationInbox } from '@/components/NotificationInbox';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';

export default function NotificationsScreen() {
  return <NotificationInbox header={<PassengerScreenHeader title="Notifications" />} />;
}
