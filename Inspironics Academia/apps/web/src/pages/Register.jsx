import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import AuthLayout from '@/components/auth/AuthLayout';
import GoogleButton from '@/components/auth/GoogleButton';
import RegisterForm from '@/components/auth/RegisterForm';
import useAppConfig from '@/lib/useAppConfig';

export default function Register() {
  const { registration_open: open, loaded } = useAppConfig();

  return (
    <AuthLayout
      title="Create your account"
      description="Start turning playbooks into mastery."
      footer={<>Already have an account? <Link to="/login" className="text-primary font-medium hover:underline">Sign in</Link></>}
    >
      {!loaded ? null : open ? (
        <>
          <RegisterForm />
          <GoogleButton label="Sign up with Google" />
        </>
      ) : (
        <Alert>
          <Lock className="w-4 h-4" />
          <AlertDescription>Registration is closed — ask an administrator for an invite.</AlertDescription>
        </Alert>
      )}
    </AuthLayout>
  );
}
