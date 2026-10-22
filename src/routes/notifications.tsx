import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Bell, ExternalLink } from "lucide-react";
import { SiteFrame } from "@/components/site-frame";
import { Button } from "@/components/ui/button";
import { useAuthUser } from "@/hooks/use-auth-user";
import { markUserNotificationRead, userNotifications } from "@/lib/admin.functions";
import { pageHead } from "@/lib/metadata";

export const Route = createFileRoute("/notifications")({
  head: () => pageHead("Notifications", "View BestPlug marketplace announcements and account notifications."),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { user, loading: authLoading } = useAuthUser();
  const loadNotifications = useServerFn(userNotifications);
  const markRead = useServerFn(markUserNotificationRead);
  const [result, setResult] = useState<Awaited<ReturnType<typeof userNotifications>> | null>(null);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setResult(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void loadNotifications({ data: { page, pageSize: 20 } })
      .then((next) => {
        if (active) setResult(next);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Notifications could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, loadNotifications, page, refresh]);

  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / 20));

  async function markNotificationRead(notificationId: string): Promise<boolean> {
    setError(null);
    setBusyId(notificationId);
    try {
      await markRead({ data: { notificationId } });
      setResult((current) =>
        current
          ? {
              ...current,
              notifications: current.notifications.map((notification) =>
                notification.id === notificationId
                  ? { ...notification, read_at: notification.read_at ?? new Date().toISOString() }
                  : notification,
              ),
            }
          : current,
      );
      window.dispatchEvent(new Event("bestplug-notification-read"));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Notification could not be marked read.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SiteFrame>
      <main className="mx-auto min-h-[65vh] max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
        <div className="flex items-center gap-3">
          <Bell aria-hidden="true" className="size-7 text-primary" />
          <div>
            <p className="text-xs uppercase text-primary">BESTPLUG MARKETPLACE</p>
            <h1 className="section-heading mt-1">Notifications</h1>
          </div>
        </div>
        {authLoading ? (
          <p className="mt-8 text-sm text-muted-foreground" role="status">
            Checking your sign-in…
          </p>
        ) : !user ? (
          <div className="mt-8 rounded-lg border border-border p-6">
            <p>Sign in to view account notifications.</p>
            <Button asChild className="mt-4">
              <Link to="/auth">Sign in</Link>
            </Button>
          </div>
        ) : error ? (
          <p className="mt-6 rounded-md border border-destructive p-3 text-sm" role="alert">
            {error}
          </p>
        ) : loading ? (
          <p className="mt-8 text-sm text-muted-foreground" role="status">
            Loading notifications…
          </p>
        ) : result?.notifications.length ? (
          <>
            <div className="mt-6 space-y-3">
              {result.notifications.map((notification) => (
                <article
                  key={notification.id}
                  className={`rounded-lg border p-4 ${
                    notification.read_at ? "border-border" : "border-primary/60 bg-primary/5"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-primary">
                        {notification.notification_type}
                        {!notification.read_at && (
                          <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                            New
                          </span>
                        )}
                      </p>
                      <h2 className="mt-1 text-lg font-semibold">{notification.title}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(notification.created_at).toLocaleString()}
                      </p>
                    </div>
                    {!notification.read_at && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyId === notification.id}
                        onClick={() => void markNotificationRead(notification.id)}
                      >
                        {busyId === notification.id ? "Saving…" : "Mark as read"}
                      </Button>
                    )}
                  </div>
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-6">
                    {notification.message}
                  </p>
                  {notification.destination_url && (
                    <a
                      className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
                      href={notification.destination_url}
                      onClick={(event) => {
                        if (notification.read_at) return;
                        const destination = notification.destination_url;
                        if (!destination) return;
                        event.preventDefault();
                        void markNotificationRead(notification.id).then((success) => {
                          if (success) window.location.assign(destination);
                        });
                      }}
                    >
                      Open announcement <ExternalLink aria-hidden="true" className="size-4" />
                    </a>
                  )}
                </article>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between gap-3 text-sm">
              <p className="text-muted-foreground">
                {result.total} notification{result.total === 1 ? "" : "s"} · Page {page} of {pages}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={page >= pages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
            <Button
              className="mt-4"
              variant="ghost"
              onClick={() => setRefresh((value) => value + 1)}
            >
              Refresh notifications
            </Button>
          </>
        ) : (
          <div className="mt-8 rounded-lg border border-border p-8 text-center">
            <Bell className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-3 font-semibold">You’re all caught up</h2>
            <p className="mt-1 text-sm text-muted-foreground">No notifications are available.</p>
          </div>
        )}
      </main>
    </SiteFrame>
  );
}
