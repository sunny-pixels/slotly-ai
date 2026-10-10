"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { toast } from "sonner";
import { CalendarClock, Pencil, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { formatDuration, formatPrice } from "@/lib/money";
import { Button, buttonVariants } from "@/components/ui/button";
import { SheetContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/menu";
import { Table, TableFrame, TD, TH, THead, TR } from "@/components/ui/data";
import { Badge, Notice } from "@/components/common/status";
import { PageHeader } from "@/components/common/page";

export type AdminService = {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  durationMinutes: number;
  priceCents: number;
  currency: string;
  isActive: boolean;
  openSlots: number;
  upcomingBookings: number;
};

export function ServicesAdmin({ services }: { services: AdminService[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminService | "new" | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  async function toggleActive(s: AdminService, isActive: boolean) {
    setToggling(s.id);
    try {
      await api(`/api/admin/services/${s.id}`, { method: "PATCH", json: { isActive } });
      toast.success(isActive ? `${s.name} is bookable again` : `${s.name} deactivated`, {
        description: isActive ? undefined : "Existing bookings are kept; no new bookings can be made.",
      });
      router.refresh();
    } catch (e) {
      toast.error("Couldn't update the service", { description: e instanceof ApiError ? e.message : undefined });
    } finally {
      setToggling(null);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Services" }]}
        title="Services"
        description="Prices and details apply to new bookings only — existing bookings keep the price they were made at. Services are deactivated, never deleted."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> New service
          </Button>
        }
      />

      <TableFrame>
        <Table>
          <THead>
            <tr>
              <TH>Service</TH>
              <TH>Category</TH>
              <TH>Duration</TH>
              <TH>Price</TH>
              <TH>Open slots</TH>
              <TH>Upcoming bookings</TH>
              <TH>Active</TH>
              <TH className="text-right">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <tbody>
            {services.map((s) => (
              <TR key={s.id} className={s.isActive ? undefined : "bg-surface-muted/60"}>
                <TD>
                  <p className="font-semibold">{s.name}</p>
                  <p className="font-mono text-[0.75rem] text-ink-subtle">{s.slug}</p>
                </TD>
                <TD>{s.category}</TD>
                <TD className="whitespace-nowrap">{formatDuration(s.durationMinutes)}</TD>
                <TD className="tabular">{formatPrice(s.priceCents, s.currency)}</TD>
                <TD className="tabular">{s.openSlots}</TD>
                <TD className="tabular">{s.upcomingBookings}</TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={s.isActive}
                      disabled={toggling === s.id}
                      onCheckedChange={(v) => void toggleActive(s, v)}
                      aria-label={`${s.isActive ? "Deactivate" : "Activate"} ${s.name}`}
                    />
                    {!s.isActive && <Badge>Inactive</Badge>}
                  </div>
                </TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-1">
                    <Link href={`/admin/availability?serviceId=${s.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                      <CalendarClock /> Slots
                    </Link>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                      <Pencil /> Edit
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableFrame>

      <DialogPrimitive.Root open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null && (
          <ServiceForm
            key={editing === "new" ? "new" : editing.id}
            service={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        )}
      </DialogPrimitive.Root>
    </>
  );
}

type FieldErrors = Record<string, string[] | undefined>;

function ServiceForm({ service, onDone }: { service: AdminService | null; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") ?? ""),
      category: String(fd.get("category") ?? ""),
      description: String(fd.get("description") ?? ""),
      durationMinutes: Number(fd.get("durationMinutes")),
      priceCents: Math.round(Number(fd.get("price")) * 100),
      currency: String(fd.get("currency") ?? "INR"),
      ...(service ? {} : { isActive: true }),
    };
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      if (service) {
        const res = await api<{ retiredSlots: number }>(`/api/admin/services/${service.id}`, { method: "PATCH", json: payload });
        toast.success("Service updated", {
          description: res.retiredSlots ? `${res.retiredSlots} future unbooked slots were retired — generate new slots for the new duration.` : undefined,
        });
      } else {
        await api("/api/admin/services", { method: "POST", json: payload });
        toast.success("Service created", { description: "Add opening hours and generate slots to make it bookable." });
      }
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const details = err.details as { fieldErrors?: FieldErrors } | undefined;
        if (details?.fieldErrors) setFieldErrors(details.fieldErrors);
      } else setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetContent>
      <form onSubmit={submit} className="flex h-full flex-col" noValidate>
        <div className="border-b border-line px-6 py-5">
          <DialogPrimitive.Title className="font-display text-section font-semibold">{service ? `Edit ${service.name}` : "New service"}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-meta text-ink-muted">
            {service ? "Changes apply to future bookings only." : "New services start active. Add availability next."}
          </DialogPrimitive.Description>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          {error && <Notice tone="danger">{error}</Notice>}
          {service && service.upcomingBookings > 0 && (
            <Notice tone="info">
              {service.upcomingBookings} upcoming booking{service.upcomingBookings === 1 ? "" : "s"}: the duration is locked until they are completed or cancelled.
            </Notice>
          )}
          <Field id="svc-name" label="Name" error={fieldErrors.name}>
            <Input name="name" defaultValue={service?.name} required maxLength={80} />
          </Field>
          <Field id="svc-category" label="Category" error={fieldErrors.category}>
            <Input name="category" defaultValue={service?.category} required maxLength={50} list="svc-categories" />
          </Field>
          <datalist id="svc-categories">
            <option value="Consultations" />
            <option value="Coaching" />
            <option value="Wellness" />
            <option value="Health" />
          </datalist>
          <Field id="svc-description" label="Description" error={fieldErrors.description}>
            <Textarea name="description" defaultValue={service?.description} required rows={5} maxLength={2000} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field id="svc-duration" label="Duration (minutes)" error={fieldErrors.durationMinutes}>
              <Input name="durationMinutes" type="number" min={5} max={480} step={5} defaultValue={service?.durationMinutes ?? 60} required />
            </Field>
            <Field id="svc-price" label="Price (₹)" error={fieldErrors.priceCents}>
              <Input name="price" type="number" min={0} step="0.01" defaultValue={service ? String(service.priceCents / 100) : "1000"} required />
            </Field>
          </div>
          <Field id="svc-currency" label="Currency" hint="ISO code, e.g. INR" error={fieldErrors.currency}>
            <Input name="currency" defaultValue={service?.currency ?? "INR"} maxLength={3} required className="w-28 uppercase" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <DialogPrimitive.Close asChild>
            <Button type="button" variant="secondary" disabled={saving}>
              Cancel
            </Button>
          </DialogPrimitive.Close>
          <Button type="submit" loading={saving}>
            {service ? "Save changes" : "Create service"}
          </Button>
        </div>
      </form>
    </SheetContent>
  );
}
