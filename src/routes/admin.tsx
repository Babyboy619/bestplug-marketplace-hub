import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { AdminCategories } from "@/components/admin-categories";
import { AdminNotifications } from "@/components/admin-notifications";
import { AdminProducts } from "@/components/admin-products";
import { AdminAuditLogs, AdminWalletTransactions } from "@/components/admin-records";
import { AdminUsers } from "@/components/admin-users";
import { SiteFrame } from "@/components/site-frame";
import { Button } from "@/components/ui/button";
import { useAuthUser } from "@/hooks/use-auth-user";
import { adminDashboardOverview } from "@/lib/admin.functions";
import { pageHead } from "@/lib/metadata";

type Overview = Awaited<ReturnType<typeof adminDashboardOverview>>;
type AdminSection =
  "overview" | "users" | "products" | "categories" | "notifications" | "transactions" | "audit";

const sections: { id: AdminSection; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "User Management" },
  { id: "products", label: "Product Management" },
  { id: "categories", label: "Category Management" },
  { id: "notifications", label: "Notification Management" },
  { id: "transactions", label: "Wallet Transactions" },
  { id: "audit", label: "Audit Logs" },
];

export const Route = createFileRoute("/admin")({
  head: () => pageHead("Admin Dashboard", "Manage marketplace users, products, and orders."),
  component: AdminPage,
});

function AdminPage() {
  const { user, loading, isAdmin, roleLoading, roleError, retryAdminVerification } = useAuthUser();
  const loadOverview = useServerFn(adminDashboardOverview);
  const [section, setSection] = useState<AdminSection>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    if (loading || roleLoading || !user || !isAdmin || section !== "overview") return;
    let active = true;
    setDataLoading(true);
    setDataError(null);
    void loadOverview()
      .then((result) => {
        if (active) setOverview(result);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setDataError(
          cause instanceof Error ? cause.message : "Dashboard statistics could not be loaded.",
        );
      })
      .finally(() => {
        if (active) setDataLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, loading, isAdmin, roleLoading, section, refreshIndex, loadOverview]);

  return (
    <SiteFrame>
      <main className="mx-auto min-h-[65vh] max-w-7xl px-4 py-8 sm:px-8 sm:py-10">
        <div className="flex items-center gap-3">
          <ShieldCheck aria-hidden="true" className="size-8 text-primary" />
          <div>
            <p className="text-xs uppercase text-primary">BESTPLUG MARKETPLACE</p>
            <h1 className="section-heading mt-1">Admin Dashboard</h1>
          </div>
        </div>

        {loading || roleLoading ? (
          <p className="mt-8 text-muted-foreground" role="status">
            Verifying administrator access…
          </p>
        ) : !user ? (
          <div className="mt-8 rounded-lg border border-border p-6">
            <p>You must sign in with an authorized administrator account to continue.</p>
            <Button asChild className="mt-4">
              <Link to="/auth">Sign in</Link>
            </Button>
          </div>
        ) : roleError ? (
          <div className="mt-8 rounded-lg border border-destructive p-4 text-sm" role="alert">
            <p>{roleError}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={retryAdminVerification}
            >
              Retry verification
            </Button>
          </div>
        ) : !isAdmin ? (
          <p className="mt-8 rounded-lg border border-destructive p-4 text-sm" role="alert">
            This account is not authorized to access the Admin Dashboard.
          </p>
        ) : (
          <>
            <nav
              aria-label="Admin dashboard sections"
              className="mt-7 flex gap-2 overflow-x-auto border-b border-border pb-3"
            >
              {sections.map(({ id, label }) => (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={section === id ? "default" : "outline"}
                  aria-current={section === id ? "page" : undefined}
                  onClick={() => setSection(id)}
                >
                  {label}
                </Button>
              ))}
            </nav>

            {section === "overview" ? (
              <section aria-labelledby="admin-overview-heading" className="mt-7">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 id="admin-overview-heading" className="text-2xl font-semibold">
                      Overview
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Live totals from marketplace records.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={dataLoading}
                    onClick={() => setRefreshIndex((value) => value + 1)}
                  >
                    {dataLoading ? "Refreshing…" : "Refresh overview"}
                  </Button>
                </div>
                {dataError ? (
                  <p className="mt-5 rounded-md border border-destructive p-3 text-sm" role="alert">
                    {dataError}
                  </p>
                ) : dataLoading ? (
                  <p className="mt-6 text-sm text-muted-foreground" role="status">
                    Loading dashboard statistics…
                  </p>
                ) : overview ? (
                  <>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {[
                        ["Registered users", overview.users],
                        ["Active users", overview.activeUsers],
                        ["Suspended users", overview.suspendedUsers],
                        ["Total products", overview.products],
                        ["Published products", overview.publishedProducts],
                        ["Categories", overview.categories],
                        ["Wallet transactions", overview.transactions],
                        ["Orders", overview.orders],
                      ].map(([label, count]) => (
                        <article key={label} className="rounded-lg border border-border p-5">
                          <p className="text-sm text-muted-foreground">{label}</p>
                          <p className="brand-title mt-2 text-3xl font-semibold text-primary">
                            {Number(count).toLocaleString()}
                          </p>
                        </article>
                      ))}
                    </div>
                    <section className="mt-9">
                      <h3 className="text-xl font-semibold">Recent orders</h3>
                      {overview.recentOrders.length ? (
                        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                          <table className="w-full min-w-[520px] text-left text-sm">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="p-3 font-semibold">Order</th>
                                <th className="p-3 font-semibold">Total</th>
                                <th className="p-3 font-semibold">Status</th>
                                <th className="p-3 font-semibold">Created</th>
                              </tr>
                            </thead>
                            <tbody>
                              {overview.recentOrders.map((order) => (
                                <tr key={order.id} className="border-t border-border">
                                  <td className="p-3 font-mono text-xs">{order.id}</td>
                                  <td className="p-3">
                                    ₦{Number(order.total).toLocaleString("en-NG")}
                                  </td>
                                  <td className="p-3">{order.status}</td>
                                  <td className="p-3">
                                    {new Date(order.created_at).toLocaleDateString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-muted-foreground">No orders yet.</p>
                      )}
                    </section>
                  </>
                ) : (
                  <p className="mt-6 text-sm text-muted-foreground" role="status">
                    Dashboard statistics are not available.
                  </p>
                )}
              </section>
            ) : section === "users" ? (
              <AdminUsers />
            ) : section === "products" ? (
              <AdminProducts />
            ) : section === "categories" ? (
              <AdminCategories />
            ) : section === "notifications" ? (
              <AdminNotifications />
            ) : section === "transactions" ? (
              <AdminWalletTransactions />
            ) : (
              <AdminAuditLogs />
            )}
          </>
        )}
      </main>
    </SiteFrame>
  );
}
