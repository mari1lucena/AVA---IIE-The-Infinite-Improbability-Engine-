"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Invisible client component: subscribes to realtime changes on `slots` and
 * re-renders the server component (router.refresh) whenever a slot is
 * inserted/updated/deleted — so a cascade filling or vacating a slot shows on
 * the agenda without a manual refresh. RLS scopes the stream to this clinic.
 *
 * The refresh is debounced: a bulk operation like "Repor demo" (demo_reset
 * deletes ~450 slots and re-seeds 423) fires hundreds of change events at once;
 * calling router.refresh() on each one floods the router and the page never
 * settles. Coalescing them into a single trailing refresh keeps cascades snappy
 * (1–2 events) while collapsing storms into one re-render.
 */
export function RealtimeRefresher() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, 400);
    };

    const channel = supabase
      .channel("agenda-slots")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "slots" },
        scheduleRefresh,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
