import { Stethoscope } from 'lucide-react';
import { SignInDoctor } from '../../components/admin/SignInDoctor';
import { AdminPageHeader } from './ui';

export default function SignInDoctorTab() {
  return (
    <div>
      <AdminPageHeader
        icon={Stethoscope}
        title="Sign-in doctor"
        description="Diagnose why a specific account cannot sign in."
      />
      <SignInDoctor />
    </div>
  );
}
