import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireActiveAccount } from "@/lib/active-account.middleware";
import { isSafeInternalPath } from "@/lib/notification-url";
import type { Database } from "@/integrations/supabase/types";

const requireAdmin = async (supabase: SupabaseClient<Database>, userId: string) => {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) {
    console.error("Administrator authorization check failed:", error);
    throw new Error(
      `Administrator authorization could not be checked (database error ${error.code ?? "unknown"}).`,
    );
  }
  if (data !== true) throw new Error("Forbidden: administrator access required");
};

const userListSchema = z.object({
  search: z.string().trim().max(100).default(""),
  status: z.enum(["all", "active", "suspended", "deactivated"]).default("all"),
  role: z.enum(["all", "user", "admin"]).default("all"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const adminSearchUsers = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => userListSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data: users, error } = await context.supabase.rpc("admin_search_users", {
      _search: data.search,
      _status: data.status,
      _role: data.role,
      _page: data.page,
      _page_size: data.pageSize,
    });
    if (error) {
      console.error("Administrator user search failed:", error);
      throw new Error("Users could not be loaded. Please try again.");
    }
    return {
      users: users ?? [],
      total: users?.[0]?.total_count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export const adminUserDetails = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const [profile, wallet, roles, transactions] = await Promise.all([
      context.supabase
        .from("profiles")
        .select("id,email,display_name,phone,created_at,suspended,suspension_reason,deleted_at")
        .eq("id", data.userId)
        .maybeSingle(),
      context.supabase
        .from("wallets")
        .select("balance,currency")
        .eq("user_id", data.userId)
        .maybeSingle(),
      context.supabase.from("user_roles").select("role").eq("user_id", data.userId),
      context.supabase
        .from("wallet_transactions")
        .select("id,type,amount,balance_after,reference,description,created_at")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    const queryError = profile.error ?? wallet.error ?? roles.error ?? transactions.error;
    if (queryError || !profile.data) {
      if (queryError) console.error("Administrator user details query failed:", queryError);
      throw new Error("User details could not be loaded.");
    }
    return {
      profile: profile.data,
      wallet: wallet.data,
      roles: (roles.data ?? []).map((item) => item.role),
      transactions: transactions.data ?? [],
    };
  });

export const adminAdjustWallet = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        action: z.enum(["credit", "debit"]),
        amount: z
          .number()
          .finite()
          .positive()
          .max(100000000)
          .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-7),
        reason: z.string().trim().min(1).max(500),
        reference: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data: result, error } = await context.supabase.rpc("admin_adjust_wallet", {
      _user_id: data.userId,
      _action: data.action,
      _amount: data.amount,
      _reason: data.reason,
      _reference: data.reference,
    });
    if (error || !result?.[0]) {
      if (error) console.error("Administrator wallet adjustment failed:", error);
      throw new Error(error?.message ?? "Wallet adjustment could not be completed.");
    }
    return result[0];
  });

const userStateSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(["suspend", "restore", "deactivate"]),
  reason: z.string().trim().max(500).default(""),
});

export const adminSetUserState = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => userStateSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    if (data.userId === context.userId)
      throw new Error("You cannot change your own account status.");

    const { data: changed, error } = await context.supabase.rpc("admin_set_user_state", {
      _user_id: data.userId,
      _action: data.action,
      _reason: data.reason,
    });
    if (error) {
      console.error("Administrator user status change failed:", error);
      throw new Error(error.message);
    }

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
        ban_duration: data.action === "restore" ? "none" : "876000h",
      });
      if (authError) {
        console.error("Could not synchronize account status with Supabase Auth:", authError);
        return {
          changed: changed === true,
          sessionWarning:
            "The account status was saved, but Supabase could not refresh its sign-in restriction.",
        };
      }
    } catch (error) {
      console.error("Could not synchronize account status with Supabase Auth:", error);
      return {
        changed: changed === true,
        sessionWarning:
          "The account status was saved, but session invalidation could not be confirmed.",
      };
    }
    return { changed: changed === true, sessionWarning: null };
  });

export const adminDashboardOverview = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase, context.userId);
    const [
      users,
      activeUsers,
      suspendedUsers,
      products,
      publishedProducts,
      categories,
      orders,
      transactions,
      recentOrders,
    ] = await Promise.all([
      context.supabase.from("profiles").select("id", { count: "exact", head: true }),
      context.supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("suspended", false),
      context.supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("suspended", true),
      context.supabase.from("products").select("id", { count: "exact", head: true }),
      context.supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("published", true),
      context.supabase.from("product_categories").select("id", { count: "exact", head: true }),
      context.supabase.from("orders").select("id", { count: "exact", head: true }),
      context.supabase.from("wallet_transactions").select("id", { count: "exact", head: true }),
      context.supabase
        .from("orders")
        .select("id,total,status,created_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    const queryError =
      users.error ??
      activeUsers.error ??
      suspendedUsers.error ??
      products.error ??
      publishedProducts.error ??
      categories.error ??
      orders.error ??
      transactions.error ??
      recentOrders.error;
    if (queryError) {
      console.error("Administrator overview query failed:", queryError);
      throw new Error("Dashboard statistics could not be loaded.");
    }
    return {
      users: users.count ?? 0,
      activeUsers: activeUsers.count ?? 0,
      suspendedUsers: suspendedUsers.count ?? 0,
      products: products.count ?? 0,
      publishedProducts: publishedProducts.count ?? 0,
      categories: categories.count ?? 0,
      orders: orders.count ?? 0,
      transactions: transactions.count ?? 0,
      recentOrders: recentOrders.data ?? [],
    };
  });

const categoryInputSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  description: z.string().max(1000),
  imageUrl: z.union([
    z
      .string()
      .url()
      .max(2048)
      .refine((url) => /^https?:\/\//i.test(url)),
    z.literal(""),
  ]),
  displayOrder: z.number().int().min(0).max(100000),
});

export const adminSearchCategories = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase.rpc("admin_search_categories");
    if (error) {
      console.error("Administrator category search failed:", error);
      throw new Error("Categories could not be loaded.");
    }
    return data ?? [];
  });

export const adminSaveCategory = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => categoryInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data: id, error } = await context.supabase.rpc("admin_save_category", {
      _category_id: data.id as string,
      _name: data.name,
      _slug: data.slug,
      _description: data.description,
      _image_url: (data.imageUrl || null) as string,
      _display_order: data.displayOrder,
    });
    if (error || !id) {
      if (error) console.error("Administrator category save failed:", error);
      throw new Error(error?.message ?? "Category could not be saved.");
    }
    return { id };
  });

export const adminSetCategoryState = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) =>
    z
      .object({
        categoryId: z.string().uuid(),
        action: z.enum(["activate", "deactivate", "delete", "restore"]),
        reassignTo: z.string().uuid().nullable().default(null),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data: result, error } = await context.supabase.rpc("admin_set_category_state", {
      _category_id: data.categoryId,
      _action: data.action,
      _reassign_to: (data.reassignTo ?? null) as string,
    });
    if (error || !result?.[0]) {
      if (error) console.error("Administrator category action failed:", error);
      throw new Error(error?.message ?? "Category could not be updated.");
    }
    return result[0];
  });

const notificationInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(5000),
  type: z.enum(["general", "announcement", "promotion", "maintenance", "important"]),
  destinationUrl: z.string().trim().max(500).refine(isSafeInternalPath).default(""),
  reference: z.string().uuid(),
});

export const adminBroadcastNotification = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => notificationInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data: result, error } = await context.supabase.rpc("admin_broadcast_notification", {
      _reference: data.reference,
      _title: data.title,
      _message: data.message,
      _type: data.type,
      _destination_url: (data.destinationUrl || null) as string,
    });
    if (error || !result?.[0]) {
      if (error) console.error("Administrator notification broadcast failed:", error);
      throw new Error(error?.message ?? "Notification could not be broadcast.");
    }
    return result[0];
  });

export const adminNotificationHistory = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) =>
    z
      .object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const {
      data: notifications,
      error,
      count,
    } = await context.supabase
      .from("notification_broadcasts")
      .select(
        "id,title,message,notification_type,destination_url,status,created_by,recipient_count,created_at,sent_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range((data.page - 1) * data.pageSize, data.page * data.pageSize - 1);
    if (error) {
      console.error("Administrator notification history failed:", error);
      throw new Error("Notification history could not be loaded.");
    }
    const ids = [...new Set((notifications ?? []).map((item) => item.created_by))];
    const profiles = ids.length
      ? await context.supabase.from("profiles").select("id,display_name").in("id", ids)
      : { data: [], error: null };
    if (profiles.error) {
      console.error("Notification author details could not be loaded:", profiles.error);
      throw new Error("Notification history could not be loaded.");
    }
    const authors = new Map(
      (profiles.data ?? []).map((profile) => [profile.id, profile.display_name]),
    );
    return {
      notifications: (notifications ?? []).map((notification) => ({
        ...notification,
        author_name: authors.get(notification.created_by) ?? "Administrator",
      })),
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export const adminWalletTransactions = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) =>
    z
      .object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const {
      data: transactions,
      error,
      count,
    } = await context.supabase
      .from("wallet_transactions")
      .select(
        "id,user_id,type,amount,balance_after,status,provider,reference,description,created_at,metadata",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range((data.page - 1) * data.pageSize, data.page * data.pageSize - 1);
    if (error) {
      console.error("Administrator wallet transactions failed:", error);
      throw new Error("Wallet transactions could not be loaded.");
    }
    const userIds = [...new Set((transactions ?? []).map((transaction) => transaction.user_id))];
    const profiles = userIds.length
      ? await context.supabase.from("profiles").select("id,email,display_name").in("id", userIds)
      : { data: [], error: null };
    if (profiles.error) {
      console.error("Wallet transaction user details failed:", profiles.error);
      throw new Error("Wallet transactions could not be loaded.");
    }
    const byId = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
    return {
      transactions: (transactions ?? []).map((transaction) => ({
        ...transaction,
        profile: byId.get(transaction.user_id) ?? null,
      })),
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export const adminAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) =>
    z
      .object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const {
      data: logs,
      error,
      count,
    } = await context.supabase
      .from("activity_logs")
      .select("id,actor_id,action,target,metadata,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((data.page - 1) * data.pageSize, data.page * data.pageSize - 1);
    if (error) {
      console.error("Administrator audit logs failed:", error);
      throw new Error("Audit logs could not be loaded.");
    }
    const actorIds = [
      ...new Set((logs ?? []).flatMap((log) => (log.actor_id ? [log.actor_id] : []))),
    ];
    const profiles = actorIds.length
      ? await context.supabase.from("profiles").select("id,display_name").in("id", actorIds)
      : { data: [], error: null };
    if (profiles.error) {
      console.error("Audit log actor details failed:", profiles.error);
      throw new Error("Audit logs could not be loaded.");
    }
    const byId = new Map(
      (profiles.data ?? []).map((profile) => [profile.id, profile.display_name]),
    );
    return {
      logs: (logs ?? []).map((log) => ({
        ...log,
        actor_name: log.actor_id ? (byId.get(log.actor_id) ?? "Administrator") : "System",
      })),
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export const userNotifications = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) =>
    z
      .object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: notifications, error } = await context.supabase.rpc("user_notification_feed", {
      _page: data.page,
      _page_size: data.pageSize,
    });
    if (error) {
      console.error("User notifications could not be loaded:", error);
      throw new Error("Notifications could not be loaded.");
    }
    return {
      notifications: notifications ?? [],
      total: notifications?.[0]?.total_count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export const markUserNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => z.object({ notificationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("mark_notification_read", {
      _notification_id: data.notificationId,
    });
    if (error || result !== true) {
      if (error) console.error("Notification read status could not be saved:", error);
      throw new Error(error?.message ?? "Notification could not be marked as read.");
    }
    return { success: true };
  });

export const userUnreadNotificationCount = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("count_unread_notifications");
    if (error) {
      console.error("Unread notification count failed:", error);
      throw new Error("Unread notification count is unavailable.");
    }
    return data ?? 0;
  });

const productSearchSchema = z.object({
  search: z.string().trim().max(100).default(""),
  status: z.enum(["all", "draft", "published", "unavailable", "archived"]).default("all"),
  categoryId: z.string().uuid().nullable().default(null),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const adminSearchProducts = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => productSearchSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    let query = context.supabase
      .from("products")
      .select(
        "id,title,slug,category_id,description,price,currency,stock,published,product_status,metadata,created_at,updated_at,archived_at,product_categories(name)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range((data.page - 1) * data.pageSize, data.page * data.pageSize - 1);
    if (data.search) query = query.ilike("title", `%${data.search}%`);
    if (data.categoryId) query = query.eq("category_id", data.categoryId);
    if (data.status === "archived") query = query.not("archived_at", "is", null);
    else {
      query = query.is("archived_at", null);
      if (data.status !== "all") query = query.eq("product_status", data.status);
    }
    const { data: products, error, count } = await query;
    if (error) {
      console.error("Administrator product search failed:", error);
      throw new Error("Products could not be loaded.");
    }
    const productIds = (products ?? []).map((product) => product.id);
    const [categories, linkedOrders] = await Promise.all([
      context.supabase
        .from("product_categories")
        .select("id,name,is_active,deleted_at")
        .order("display_order")
        .order("name"),
      productIds.length
        ? context.supabase.rpc("admin_product_order_counts", { _product_ids: productIds })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (categories.error) {
      console.error("Product categories could not be loaded:", categories.error);
      throw new Error("Product categories could not be loaded.");
    }
    if (linkedOrders.error) {
      console.error("Product order counts could not be loaded:", linkedOrders.error);
      throw new Error("Product order history could not be checked.");
    }
    const orderCounts = new Map(
      (linkedOrders.data ?? []).map(({ product_id, order_count }) => [product_id, order_count]),
    );
    return {
      products: (products ?? []).map((product) => ({
        ...product,
        order_count: orderCounts.get(product.id) ?? 0,
      })),
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
      categories: categories.data,
    };
  });

const productInputSchema = z.object({
  reference: z.string().uuid(),
  id: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(160),
  categoryId: z.string().uuid().nullable(),
  description: z.string().max(10000),
  price: z
    .number()
    .finite()
    .positive()
    .max(100000000)
    .refine((price) => Math.abs(price * 100 - Math.round(price * 100)) < 1e-7),
  status: z.enum(["draft", "published", "unavailable"]),
  specifications: z
    .record(z.string(), z.string().trim().max(500))
    .refine(
      (items) =>
        Object.keys(items).length <= 20 && Object.keys(items).every((key) => key.length <= 100),
    ),
  deliveryInstructions: z.string().max(5000),
  logs: z.array(z.string().trim().min(1).max(10000)).max(1000),
});

export const adminSaveProduct = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => productInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const baseSlug =
      data.title
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 140) || "product";
    let slug = `${baseSlug}-${data.reference.slice(0, 8)}`;
    if (data.id) {
      const { data: existing, error: lookupError } = await context.supabase
        .from("products")
        .select("slug")
        .eq("id", data.id)
        .maybeSingle();
      if (lookupError || !existing) {
        if (lookupError) console.error("Product edit lookup failed:", lookupError);
        throw new Error("Product could not be found.");
      }
      slug = existing.slug;
    }
    const { data: result, error } = await context.supabase.rpc("admin_save_product_with_logs", {
      _reference: data.reference,
      _product_id: data.id,
      _title: data.title,
      _slug: slug,
      _category_id: data.categoryId,
      _description: data.description,
      _price: data.price,
      _status: data.status,
      _metadata: {
        specifications: data.specifications,
        delivery_instructions: data.deliveryInstructions.trim(),
      },
      _logs: data.logs,
    });
    if (error || !result) {
      if (error) console.error("Administrator product save failed:", error);
      throw new Error(error?.message ?? "Product could not be saved.");
    }
    const saved = result as { id: string; stock: number; savedCount: number };
    return saved;
  });

export const adminArchiveProduct = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) =>
    z.object({ productId: z.string().uuid(), archived: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data: changed, error } = await context.supabase.rpc("admin_archive_product", {
      _product_id: data.productId,
      _archived: data.archived,
    });
    if (error) {
      console.error("Administrator product archive failed:", error);
      throw new Error(error.message);
    }
    return { changed: changed === true };
  });

export const adminProductActivity = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => z.object({ productId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data: events, error } = await context.supabase
      .from("activity_logs")
      .select("id,action,actor_id,target,metadata,created_at")
      .eq("target", data.productId)
      .like("action", "admin.product.%")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("Product activity log query failed:", error);
      throw new Error("Product activity could not be loaded.");
    }
    return events;
  });

export const adminProductInventorySummary = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => z.object({ productId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data: summary, error } = await context.supabase.rpc("admin_inventory_summary", {
      _product_id: data.productId,
    });
    if (error || !summary) {
      if (error) console.error("Product inventory summary failed:", error);
      throw new Error("Delivery inventory summary could not be loaded.");
    }
    return summary as {
      total: number;
      available: number;
      sold: number;
      reserved: number;
      newlyAdded: number;
    };
  });

export const adminListAvailableInventory = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => z.object({ productId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data: entries, error } = await context.supabase.rpc("admin_list_available_inventory", {
      _product_id: data.productId,
    });
    if (error) {
      console.error("Available inventory list failed:", error);
      throw new Error("Available delivery inventory could not be loaded.");
    }
    return entries ?? [];
  });

export const adminUpdateAvailableInventory = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) =>
    z
      .object({
        credentialId: z.string().uuid(),
        username: z.string().trim().min(1).max(1000),
        password: z
          .string()
          .min(1)
          .max(5000)
          .refine((value) => value.trim().length > 0),
        specifications: z
          .record(z.string().max(100), z.string().max(500))
          .refine((items) => Object.keys(items).length <= 20),
        deliveryInstructions: z.string().max(5000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data: updated, error } = await context.supabase.rpc(
      "admin_update_available_inventory",
      {
        _credential_id: data.credentialId,
        _username: data.username,
        _password: data.password,
        _specifications: data.specifications,
        _delivery_instructions: data.deliveryInstructions,
      },
    );
    if (error || updated !== true) {
      if (error) console.error("Available inventory update failed:", error);
      throw new Error(error?.message ?? "Available delivery inventory could not be updated.");
    }
    return { updated: true };
  });
