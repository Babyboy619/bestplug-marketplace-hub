import type { Database } from "@/integrations/supabase/types";

type ProductRow = Database["public"]["Tables"]["products"]["Row"];

export type CatalogProduct = Pick<
  ProductRow,
  "id" | "title" | "slug" | "description" | "price" | "currency" | "stock" | "product_status"
>;

export type CatalogListingProduct = CatalogProduct & Pick<ProductRow, "category_id">;
