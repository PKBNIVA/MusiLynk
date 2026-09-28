import { Settings2 } from 'lucide-react';
import OperationsPanel from '../../components/admin/OperationsPanel';
import { AdminPageHeader } from './ui';

export default function OperationsTab() {
  return (
    <div>
      <AdminPageHeader
        icon={Settings2}
        title="Operations"
        description="One-off maintenance and diagnostic tools for the platform."
      />
      <OperationsPanel />
    </div>
  );
}
