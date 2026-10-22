import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adminBroadcastNotification, adminNotificationHistory } from "@/lib/admin.functions";
import { isSafeInternalPath } from "@/lib/notification-url";

type NotificationType = "general" | "announcement" | "promotion" | "maintenance" | "important";
type HistoryResult = Awaited<ReturnType<typeof adminNotificationHistory>>;
const types: { value: NotificationType; label: string }[] = [
  { value: "general", label: "General" },
  { value: "announcement", label: "Announcement" },
  { value: "promotion", label: "Promotion" },
  { value: "maintenance", label: "Maintenance" },
  { value: "important", label: "Important" },
];

export function AdminNotifications() {
  const broadcast = useServerFn(adminBroadcastNotification);
  const loadHistory = useServerFn(adminNotificationHistory);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<NotificationType>("announcement");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [reference, setReference] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryResult | null>(null);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setHistoryError(null);
    void loadHistory({ data: { page, pageSize: 20 } })
      .then((result) => {
        if (active) setHistory(result);
      })
      .catch((cause: unknown) => {
        if (active)
          setHistoryError(
            cause instanceof Error ? cause.message : "Broadcast history could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadHistory, page, refresh]);

  const totalPages = Math.max(1, Math.ceil((history?.total ?? 0) / 20));
  const validDestination = isSafeInternalPath(destinationUrl);

  async function sendBroadcast() {
    if (!title.trim() || !message.trim() || !validDestination) {
      setFormError("Check the title, message, and same-site destination URL.");
      setConfirmOpen(false);
      return;
    }
    const requestReference = reference ?? crypto.randomUUID();
    setReference(requestReference);
    setBusy(true);
    setFormError(null);
    try {
      const result = await broadcast({
        data: {
          reference: requestReference,
          title: title.trim(),
          message: message.trim(),
          type,
          destinationUrl: destinationUrl.trim(),
        },
      });
      toast.success(
        `Announcement saved and made available to ${result.recipient_count} eligible accounts.`,
      );
      setTitle("");
      setMessage("");
      setType("announcement");
      setDestinationUrl("");
      setReference(null);
      setConfirmOpen(false);
      setPage(1);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Broadcast could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  function resetReference() {
    setReference(null);
  }

  return (
    <section aria-labelledby="admin-notifications-heading" className="mt-8">
      <div>
        <h2 id="admin-notifications-heading" className="text-2xl font-semibold">
          Notification Management
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Broadcast announcements are stored once and appear in each eligible account’s notification
          feed. Recipient count is the eligible account count at send time, not a read receipt.
        </p>
      </div>
      <form
        className="mt-5 space-y-4 rounded-lg border border-border p-4 sm:p-6"
        onSubmit={(event) => {
          event.preventDefault();
          setFormError(null);
          setConfirmOpen(true);
        }}
      >
        <h3 className="text-lg font-semibold">Compose broadcast</h3>
        <label className="block text-sm">
          Title
          <Input
            className="mt-1"
            required
            maxLength={160}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              resetReference();
            }}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            Type
            <select
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
              value={type}
              onChange={(event) => {
                setType(event.target.value as NotificationType);
                resetReference();
              }}
            >
              {types.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Destination path (optional)
            <Input
              className="mt-1"
              maxLength={500}
              placeholder="/products"
              value={destinationUrl}
              onChange={(event) => {
                setDestinationUrl(event.target.value);
                resetReference();
              }}
              aria-invalid={!validDestination}
            />
          </label>
        </div>
        <label className="block text-sm">
          Message
          <textarea
            className="mt-1 min-h-32 w-full rounded-md border border-input bg-background p-3"
            required
            maxLength={5000}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              resetReference();
            }}
          />
          <span className="mt-1 block text-xs text-muted-foreground">{message.length}/5000</span>
        </label>
        {!validDestination && (
          <p className="text-sm text-destructive" role="alert">
            Use a same-site path beginning with a single slash.
          </p>
        )}
        {formError && (
          <p className="rounded-md border border-destructive p-3 text-sm" role="alert">
            {formError}
          </p>
        )}
        <div className="rounded-md bg-muted/50 p-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Preview</p>
          <p className="mt-2 font-semibold">{title || "Notification title"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{message || "Your message preview."}</p>
          <p className="mt-2 text-xs capitalize text-primary">
            {types.find((option) => option.value === type)?.label}
            {destinationUrl && validDestination ? ` · ${destinationUrl}` : ""}
          </p>
        </div>
        <Button
          type="submit"
          disabled={busy || !title.trim() || !message.trim() || !validDestination}
        >
          Review and send now
        </Button>
      </form>

      <section className="mt-9" aria-labelledby="broadcast-history-heading">
        <h3 id="broadcast-history-heading" className="text-xl font-semibold">
          Broadcast history
        </h3>
        {historyError && (
          <p className="mt-3 rounded-md border border-destructive p-3 text-sm" role="alert">
            {historyError}
          </p>
        )}
        {loading ? (
          <p className="mt-4 text-sm text-muted-foreground" role="status">
            Loading broadcast history…
          </p>
        ) : history?.notifications.length ? (
          <>
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-3">Title</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Created by</th>
                    <th className="p-3">Created</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Eligible at send</th>
                  </tr>
                </thead>
                <tbody>
                  {history.notifications.map((notification) => (
                    <tr key={notification.id} className="border-t border-border">
                      <td className="p-3">
                        <p className="font-medium">{notification.title}</p>
                        <p className="mt-1 max-w-sm truncate text-xs text-muted-foreground">
                          {notification.message}
                        </p>
                      </td>
                      <td className="p-3 capitalize">{notification.notification_type}</td>
                      <td className="p-3">{notification.author_name}</td>
                      <td className="p-3">{new Date(notification.created_at).toLocaleString()}</td>
                      <td className="p-3 capitalize">{notification.status}</td>
                      <td className="p-3">{notification.recipient_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <p className="text-muted-foreground">
                {history.total} broadcast{history.total === 1 ? "" : "s"} · Page {page} of{" "}
                {totalPages}
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
                  disabled={page >= totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : (
          !historyError && (
            <p className="mt-4 rounded-md border border-border p-5 text-sm text-muted-foreground">
              No broadcasts yet.
            </p>
          )
        )}
      </section>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!busy) setConfirmOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this broadcast now?</DialogTitle>
            <DialogDescription>
              This announcement will be immediately available to all eligible users. You cannot
              recall it from their notification feeds.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-md border border-border p-4 text-sm">
            <p className="font-semibold">{title}</p>
            <p className="whitespace-pre-wrap">{message}</p>
            <p className="capitalize text-muted-foreground">{type}</p>
            {destinationUrl && <p className="font-mono text-xs">{destinationUrl}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={busy} onClick={() => void sendBroadcast()}>
              {busy ? "Sending…" : "Send now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
