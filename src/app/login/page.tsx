// Public login page. Middleware excludes /login from the auth gate so
// unauthenticated users can reach this route. After successful login,
// the form redirects to ?next=… (or / if missing).

import LoginForm from './LoginForm';

export const metadata = {
  title: 'Sign in · LinkedIn Analytics',
};

export const dynamic = 'force-dynamic';

interface Props {
  searchParams?: { next?: string; error?: string };
}

export default function LoginPage({ searchParams }: Props) {
  return (
    <LoginForm
      next={searchParams?.next ?? '/'}
      initialError={searchParams?.error}
    />
  );
}
