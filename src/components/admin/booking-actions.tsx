"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { CancelBookingButton } from "@/components/booking/cancel-booking-button";

export function AdminBookingActions({
  booking,
  timeZone,
  canComplete,
}: {
  booking: { id: string; publicReference: string; serviceName: string; startAt: string; status: string };
  timeZone: string;
  canComplete: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const active = booking.status === "CONFIRMED" || booking.status === "PENDING";
  if (!active) return <span className="text-meta text-ink-subtle">—</span>;

  async function complete() {
    setBusy(true);
    try {
      await api(`/api/admin/bookings/${booking.id}`, { method: "PATCH", json: { action: "complete" } });
      toast.success(`${booking.publicReference} marked as completed`);
      router.refresh();
    } catch (e) {
      toast.error("Couldn't update the booking", { description: e instanceof ApiError ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-end gap-1.5">
      {canComplete && (
        <Button size="sm" variant="secondary" onClick={complete} loading={busy}>
          {!busy && <CheckCheck />} Complete
        </Button>
      )}
      <CancelBookingButton booking={booking} timeZone={timeZone} endpoint="admin" />
    </div>
  );
}
