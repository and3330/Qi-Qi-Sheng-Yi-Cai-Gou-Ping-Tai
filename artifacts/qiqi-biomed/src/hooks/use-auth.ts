import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";

export function useAuth() {
  const { data: me, isLoading, error } = useGetMe({ 
    query: { 
      retry: false,
      staleTime: 5 * 60 * 1000,
      queryKey: getGetMeQueryKey(),
    } 
  });
  
  const isLoaded = !isLoading;
  const isSignedIn = !!me && !error;
  
  return {
    isLoaded,
    isSignedIn,
    me
  };
}