"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { formatInZone } from "@/lib/time";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/dialog";

type Target = { id: string; publicReference: string; serviceName: string; startAt: string };

/** Cancellation with explicit confirmation. The server re-checks ownership and the policy window. */
export function CancelBookingButton({
  booking,
  timeZone,
  endpoint = "customer",
  size = "sm",
  variant = "danger-outline",
  label = "Cancel",
  onCancelled,
}: {
  booking: Target;
  timeZone: string;
  endpoint?: "customer" | "admin";
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  label?: string;
  onCancelled?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function cancel(e: React.MouseEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res =
        endpoint === "admin"
          ? await api<{ alreadyCancelled: boolean }>(`/api/admin/bookings/${booking.id}`, { method: "PATCH", json: { action: "cancel" } })
          : await api<{ alreadyCancelled: boolean }>(`/api/bookings/${booking.id}/cancel`, { method: "PATCH" });
      toast.success(res.alreadyCancelled ? "This booking was already cancelled" : "Booking cancelled", {
        description: `${booking.publicReference} · the time is now free for others.`,
      });
      setOpen(false);
      onCancelled?.();
      router.refresh();
    } catch (err) {
      toast.error("Couldn't cancel this booking", { description: err instanceof ApiError ? err.message : "Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <AlertDialogTrigger asChild>
        <Button size={size} variant={variant}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <div className="space-y-2">
          <AlertDialogTitle>Cancel {booking.serviceName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {formatInZone(booking.startAt, "EEEE d MMMM 'at' HH:mm", timeZone)} · {booking.publicReference}. The time will be released
            immediately and may be booked by someone else.
          </AlertDialogDescription>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel disabled={busy}>Keep booking</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="danger" onClick={cancel} loading={busy}>
              Cancel booking
            </Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
