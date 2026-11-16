import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { ReportIssueForm } from '@/components/ReportIssueForm';

export default function PassengerReportIssueScreen() {
  return <ReportIssueForm header={<PassengerScreenHeader title="Report Issue" />} />;
}
