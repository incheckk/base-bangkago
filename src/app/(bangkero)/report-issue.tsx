import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { ReportIssueForm } from '@/components/ReportIssueForm';

export default function BangkeroReportIssueScreen() {
  return <ReportIssueForm header={<BangkeroScreenHeader title="Report Issue" />} />;
}
