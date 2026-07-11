"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/dashboard" : "/login");
  }, [user, loading, router]);

  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="h-8 w-8 animate-spin rounded-full border border-white/15 border-t-white" />
    </div>
  );
}
