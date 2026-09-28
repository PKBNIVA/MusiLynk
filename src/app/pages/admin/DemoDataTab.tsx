import { Database } from 'lucide-react';
import DemoDataPanel from '../../components/admin/DemoDataPanel';
import { AdminPageHeader } from './ui';

export default function DemoDataTab() {
  return (
    <div>
      <AdminPageHeader
        icon={Database}
        title="Demo data"
        description="Seed or clear sample data used for demos and local testing."
      />
      <DemoDataPanel />
    </div>
  );
}
