import { listServicesForAdmin } from "@/server/services/catalog";
import { PageBody } from "@/components/common/page";
import { ServicesAdmin } from "@/components/admin/services-admin";

export const metadata = { title: "Manage services" };

export default async function AdminServicesPage() {
  const services = await listServicesForAdmin();
  return (
    <PageBody>
      <ServicesAdmin services={services} />
    </PageBody>
  );
}
