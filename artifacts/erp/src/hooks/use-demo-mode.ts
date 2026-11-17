import { useQuery } from "@tanstack/react-query";

/** 是否為展示環境（DEMO_MODE） */
export function useDemoMode(): boolean {
  const { data } = useQuery<{ demoMode: boolean }>({
    queryKey: ["/erp-api/config"],
    queryFn: async () => {
      const res = await fetch("/erp-api/config");
      if (!res.ok) return { demoMode: false };
      return res.json();
    },
    staleTime: Infinity,
    retry: false,
  });
  return data?.demoMode === true;
}
