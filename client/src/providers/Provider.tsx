'use client';

import React, { useMemo } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SocketProvider } from './SocketProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  // 1. Stable QueryClient instance across re-renders
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 5,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  // 2. Ensure Client ID is stable and doesn't trigger re-initializations
  const googleClientId = useMemo(() => {
    return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
  }, []);

  // 3. Prevent rendering the provider until client ID is available
  if (!googleClientId) {
    return (
      <QueryClientProvider client={queryClient}>
        <SocketProvider>{children}</SocketProvider>
      </QueryClientProvider>
    );
  }

  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <QueryClientProvider client={queryClient}>
        <SocketProvider>{children}</SocketProvider>
      </QueryClientProvider>
    </GoogleOAuthProvider>
  );
}