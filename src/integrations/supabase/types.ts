export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          metadata: Json
          target: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          target?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_inventory_requests: {
        Row: {
          actor_id: string
          created_at: string
          credential_id: string | null
          fingerprint: string | null
          product_id: string
          reference: string
          saved_count: number
        }
        Insert: {
          actor_id: string
          created_at?: string
          credential_id?: string | null
          fingerprint?: string | null
          product_id: string
          reference: string
          saved_count?: number
        }
        Update: {
          actor_id?: string
          created_at?: string
          credential_id?: string | null
          fingerprint?: string | null
          product_id?: string
          reference?: string
          saved_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "admin_inventory_requests_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_inventory_requests_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "product_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_inventory_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_items: {
        Row: {
          product_id: string
          quantity: number
          updated_at: string
          user_id: string
        }
        Insert: {
          product_id: string
          quantity?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          product_id?: string
          quantity?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_broadcasts: {
        Row: {
          created_at: string
          created_by: string
          destination_url: string | null
          id: string
          message: string
          notification_type: string
          recipient_count: number
          reference: string
          sent_at: string | null
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by: string
          destination_url?: string | null
          id?: string
          message: string
          notification_type: string
          recipient_count?: number
          reference: string
          sent_at?: string | null
          status?: string
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string
          destination_url?: string | null
          id?: string
          message?: string
          notification_type?: string
          recipient_count?: number
          reference?: string
          sent_at?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_broadcasts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_reads: {
        Row: {
          notification_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          notification_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          notification_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notification_broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          delivered_payload: string | null
          delivered_specifications: Json
          delivery_instructions: string
          id: string
          order_id: string
          platform: string | null
          product_id: string | null
          quantity: number
          title: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          delivered_payload?: string | null
          delivered_specifications?: Json
          delivery_instructions?: string
          id?: string
          order_id: string
          platform?: string | null
          product_id?: string | null
          quantity?: number
          title: string
          unit_price: number
        }
        Update: {
          created_at?: string
          delivered_payload?: string | null
          delivered_specifications?: Json
          delivery_instructions?: string
          id?: string
          order_id?: string
          platform?: string | null
          product_id?: string | null
          quantity?: number
          title?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          currency: string
          id: string
          payment_reference: string | null
          request_key: string | null
          status: Database["public"]["Enums"]["order_status"]
          total: number
          user_id: string
          wallet_tx_id: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          payment_reference?: string | null
          request_key?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          total: number
          user_id: string
          wallet_tx_id?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          payment_reference?: string | null
          request_key?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          total?: number
          user_id?: string
          wallet_tx_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_wallet_tx_id_fkey"
            columns: ["wallet_tx_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_intents: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          order_id: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_reference: string | null
          raw: Json
          reference: string
          status: Database["public"]["Enums"]["tx_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          order_id?: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_reference?: string | null
          raw?: Json
          reference: string
          status?: Database["public"]["Enums"]["tx_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          order_id?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_reference?: string | null
          raw?: Json
          reference?: string
          status?: Database["public"]["Enums"]["tx_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          display_order: number
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          slug?: string
        }
        Relationships: []
      }
      product_credentials: {
        Row: {
          assigned_to: string | null
          content: string
          created_at: string
          delivered_at: string | null
          delivery_instructions: string
          email: string | null
          email_password: string | null
          id: string
          label: string | null
          order_id: string | null
          password: string | null
          product_id: string
          specifications: Json
          two_factor: string | null
          username: string | null
        }
        Insert: {
          assigned_to?: string | null
          content: string
          created_at?: string
          delivered_at?: string | null
          delivery_instructions?: string
          email?: string | null
          email_password?: string | null
          id?: string
          label?: string | null
          order_id?: string | null
          password?: string | null
          product_id: string
          specifications?: Json
          two_factor?: string | null
          username?: string | null
        }
        Update: {
          assigned_to?: string | null
          content?: string
          created_at?: string
          delivered_at?: string | null
          delivery_instructions?: string
          email?: string | null
          email_password?: string | null
          id?: string
          label?: string | null
          order_id?: string | null
          password?: string | null
          product_id?: string
          specifications?: Json
          two_factor?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_credentials_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_credentials_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_credentials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          archived_at: string | null
          category_id: string | null
          created_at: string
          currency: string
          description: string | null
          id: string
          image_url: string | null
          metadata: Json
          price: number
          product_status: Database["public"]["Enums"]["product_status"]
          published: boolean
          slug: string
          stock: number
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          category_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_url?: string | null
          metadata?: Json
          price: number
          product_status?: Database["public"]["Enums"]["product_status"]
          published?: boolean
          slug: string
          stock?: number
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          category_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_url?: string | null
          metadata?: Json
          price?: number
          product_status?: Database["public"]["Enums"]["product_status"]
          published?: boolean
          slug?: string
          stock?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          deleted_at: string | null
          display_name: string | null
          email: string | null
          id: string
          phone: string | null
          suspended: boolean
          suspension_reason: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          email?: string | null
          id: string
          phone?: string | null
          suspended?: boolean
          suspension_reason?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          phone?: string | null
          suspended?: boolean
          suspension_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      recently_viewed: {
        Row: {
          product_id: string
          user_id: string
          viewed_at: string
        }
        Insert: {
          product_id: string
          user_id: string
          viewed_at?: string
        }
        Update: {
          product_id?: string
          user_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recently_viewed_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recently_viewed_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      site_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          metadata: Json
          provider: Database["public"]["Enums"]["payment_provider"] | null
          reference: string | null
          status: Database["public"]["Enums"]["tx_status"]
          type: Database["public"]["Enums"]["tx_type"]
          user_id: string
          wallet_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          provider?: Database["public"]["Enums"]["payment_provider"] | null
          reference?: string | null
          status?: Database["public"]["Enums"]["tx_status"]
          type: Database["public"]["Enums"]["tx_type"]
          user_id: string
          wallet_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          provider?: Database["public"]["Enums"]["payment_provider"] | null
          reference?: string | null
          status?: Database["public"]["Enums"]["tx_status"]
          type?: Database["public"]["Enums"]["tx_type"]
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          currency: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wishlist_items: {
        Row: {
          created_at: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_add_product_credential: {
        Args: { _content: string; _product_id: string; _reference: string }
        Returns: number
      }
      admin_adjust_wallet: {
        Args: {
          _action: string
          _amount: number
          _reason: string
          _reference: string
          _user_id: string
        }
        Returns: {
          new_balance: number
          previous_balance: number
          reference: string
          transaction_id: string
        }[]
      }
      admin_archive_product: {
        Args: { _archived: boolean; _product_id: string }
        Returns: boolean
      }
      admin_broadcast_notification: {
        Args: {
          _destination_url?: string
          _message: string
          _reference: string
          _title: string
          _type: string
        }
        Returns: {
          created_at: string
          notification_id: string
          recipient_count: number
          status: string
        }[]
      }
      admin_inventory_count: { Args: { _product_id: string }; Returns: number }
      admin_inventory_summary: { Args: { _product_id: string }; Returns: Json }
      admin_list_available_inventory: {
        Args: { _product_id: string }
        Returns: {
          content: string
          created_at: string
          delivery_instructions: string
          id: string
          password: string
          specifications: Json
          username: string
        }[]
      }
      admin_product_order_counts: {
        Args: { _product_ids: string[] }
        Returns: {
          order_count: number
          product_id: string
        }[]
      }
      admin_save_category: {
        Args: {
          _category_id: string
          _description: string
          _display_order: number
          _image_url: string
          _name: string
          _slug: string
        }
        Returns: string
      }
      admin_save_product: {
        Args: {
          _category_id: string
          _description: string
          _image_url: string
          _metadata: Json
          _price: number
          _product_id: string
          _slug: string
          _status: Database["public"]["Enums"]["product_status"]
          _stock: number
          _title: string
        }
        Returns: string
      }
      admin_save_product_with_inventory: {
        Args: {
          _category_id: string
          _description: string
          _inventory: Json
          _metadata: Json
          _price: number
          _product_id: string
          _reference: string
          _slug: string
          _status: Database["public"]["Enums"]["product_status"]
          _title: string
        }
        Returns: Json
      }
      admin_save_product_with_logs: {
        Args: {
          _category_id: string | null
          _description: string | null
          _logs: Json
          _metadata: Json
          _price: number
          _product_id: string | null
          _reference: string
          _slug: string
          _status: Database["public"]["Enums"]["product_status"]
          _title: string
        }
        Returns: Json
      }
      admin_search_categories: {
        Args: never
        Returns: {
          created_at: string
          deleted_at: string
          description: string
          display_order: number
          id: string
          image_url: string
          is_active: boolean
          name: string
          product_count: number
          slug: string
        }[]
      }
      admin_search_users: {
        Args: {
          _page: number
          _page_size: number
          _role: string
          _search: string
          _status: string
        }
        Returns: {
          balance: number
          created_at: string
          deleted_at: string
          display_name: string
          email: string
          id: string
          phone: string
          role: Database["public"]["Enums"]["app_role"]
          suspended: boolean
          suspension_reason: string
          total_count: number
        }[]
      }
      admin_set_category_state: {
        Args: { _action: string; _category_id: string; _reassign_to?: string }
        Returns: {
          changed: boolean
          reassigned_products: number
        }[]
      }
      admin_set_user_state: {
        Args: { _action: string; _reason?: string; _user_id: string }
        Returns: boolean
      }
      admin_update_available_inventory: {
        Args: {
          _credential_id: string
          _delivery_instructions: string
          _password: string
          _specifications: Json
          _username: string
        }
        Returns: boolean
      }
      count_unread_notifications: { Args: never; Returns: number }
      ensure_user_wallet: {
        Args: never
        Returns: {
          balance: number
          currency: string
          id: string
          updated_at: string
        }[]
      }
      fail_paystack: { Args: { _reference: string }; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_account_active: { Args: { _user_id: string }; Returns: boolean }
      is_active_admin: { Args: { _user_id: string }; Returns: boolean }
      mark_notification_read: {
        Args: { _notification_id: string }
        Returns: boolean
      }
      prepare_cart_order: {
        Args: { _external: boolean; _request: string; _user: string }
        Returns: string
      }
      purchase_cart: { Args: { _request: string }; Returns: string }
      purchase_product_with_wallet: {
        Args: { _product_id: string; _request: string }
        Returns: Json
      }
      purchase_with_wallet: {
        Args: { _product_id: string; _quantity: number }
        Returns: string
      }
      settle_neurapay_payment: {
        Args: {
          _amount: number
          _provider_data?: Json
          _provider_reference?: string
          _reference: string
        }
        Returns: {
          already_credited: boolean
          credited: boolean
        }[]
      }
      settle_paystack: {
        Args: {
          _amount: number
          _currency: string
          _provider_id: string
          _reference: string
        }
        Returns: string
      }
      user_notification_feed: {
        Args: { _page?: number; _page_size?: number }
        Returns: {
          created_at: string
          destination_url: string
          id: string
          message: string
          notification_type: string
          read_at: string
          title: string
          total_count: number
        }[]
      }
    }
    Enums: {
      app_role: "user" | "admin"
      order_status:
        | "pending"
        | "completed"
        | "pending_credentials"
        | "failed"
        | "refunded"
      payment_provider: "neurapay" | "manual" | "paystack"
      product_status: "draft" | "published" | "unavailable"
      tx_status: "pending" | "success" | "failed" | "reversed"
      tx_type: "credit" | "debit"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["user", "admin"],
      order_status: [
        "pending",
        "completed",
        "pending_credentials",
        "failed",
        "refunded",
      ],
      payment_provider: ["neurapay", "manual", "paystack"],
      product_status: ["draft", "published", "unavailable"],
      tx_status: ["pending", "success", "failed", "reversed"],
      tx_type: ["credit", "debit"],
    },
  },
} as const
