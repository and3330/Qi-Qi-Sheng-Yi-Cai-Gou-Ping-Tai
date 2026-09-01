import { useGetErpMe, getGetErpMeQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

export function useErpAuth() {
  const { data: user, error, isLoading } = useGetErpMe({
    query: {
      queryKey: getGetErpMeQueryKey(),
      retry: false,
    }
  });

  const queryClient = useQueryClient();

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/sign-in';
    } catch (e) {
      console.error('Logout failed', e);
    }
  };

  const isBlocked = !!error || (user && !user.erpRole);

  return {
    user,
    isLoading,
    isBlocked,
    logout,
  };
}
