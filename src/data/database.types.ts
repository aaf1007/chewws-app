export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      friendships: {
        Row: {
          addressee_id: string
          created_at: string
          requester_id: string
          responded_at: string | null
          status: Database["public"]["Enums"]["friendship_status"]
        }
        Insert: {
          addressee_id: string
          created_at?: string
          requester_id: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["friendship_status"]
        }
        Update: {
          addressee_id?: string
          created_at?: string
          requester_id?: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["friendship_status"]
        }
        Relationships: [
          {
            foreignKeyName: "friendships_addressee_id_fkey"
            columns: ["addressee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      link_saves: {
        Row: {
          id: string
          recipe_id: string | null
          saved_at: string
          user_id: string
        }
        Insert: {
          id?: string
          recipe_id?: string | null
          saved_at?: string
          user_id: string
        }
        Update: {
          id?: string
          recipe_id?: string | null
          saved_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_saves_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      pantry_entries: {
        Row: {
          created_at: string
          ingredient_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ingredient_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          ingredient_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pantry_entries_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          username?: string | null
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          created_at: string
          last_seen_at: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_seen_at?: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_seen_at?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      recipe_lines: {
        Row: {
          amount_text: string | null
          id: string
          ingredient_id: string
          original_text: string
          position: number
          recipe_id: string
        }
        Insert: {
          amount_text?: string | null
          id?: string
          ingredient_id: string
          original_text: string
          position: number
          recipe_id: string
        }
        Update: {
          amount_text?: string | null
          id?: string
          ingredient_id?: string
          original_text?: string
          position?: number
          recipe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_lines_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_tags: {
        Row: {
          recipe_id: string
          tag_id: string
        }
        Insert: {
          recipe_id: string
          tag_id: string
        }
        Update: {
          recipe_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_tags_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          build_attempts: number
          build_failure:
            | Database["public"]["Enums"]["draft_build_failure"]
            | null
          build_started_at: string | null
          build_status: Database["public"]["Enums"]["draft_build_status"]
          created_at: string
          id: string
          owner_id: string
          recipe_found: boolean
          status: Database["public"]["Enums"]["recipe_status"]
          steps: string[]
          suggested_tags: string[]
          title: string
          updated_at: string
          want_to_cook_at: string | null
        }
        Insert: {
          build_attempts?: number
          build_failure?:
            | Database["public"]["Enums"]["draft_build_failure"]
            | null
          build_started_at?: string | null
          build_status?: Database["public"]["Enums"]["draft_build_status"]
          created_at?: string
          id?: string
          owner_id?: string
          recipe_found?: boolean
          status?: Database["public"]["Enums"]["recipe_status"]
          steps?: string[]
          suggested_tags?: string[]
          title: string
          updated_at?: string
          want_to_cook_at?: string | null
        }
        Update: {
          build_attempts?: number
          build_failure?:
            | Database["public"]["Enums"]["draft_build_failure"]
            | null
          build_started_at?: string | null
          build_status?: Database["public"]["Enums"]["draft_build_status"]
          created_at?: string
          id?: string
          owner_id?: string
          recipe_found?: boolean
          status?: Database["public"]["Enums"]["recipe_status"]
          steps?: string[]
          suggested_tags?: string[]
          title?: string
          updated_at?: string
          want_to_cook_at?: string | null
        }
        Relationships: []
      }
      shopping_list_amounts: {
        Row: {
          amount_texts: string[]
          created_at: string
          item_id: string
          recipe_id: string
          recipe_title: string
        }
        Insert: {
          amount_texts?: string[]
          created_at?: string
          item_id: string
          recipe_id: string
          recipe_title?: string
        }
        Update: {
          amount_texts?: string[]
          created_at?: string
          item_id?: string
          recipe_id?: string
          recipe_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_list_amounts_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "shopping_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_list_amounts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      shopping_list_items: {
        Row: {
          checked_at: string | null
          checked_by: string | null
          created_at: string
          hand_added_text: string | null
          id: string
          ingredient_id: string | null
          list_id: string
          phone_changed_at: string | null
          updated_at: string
        }
        Insert: {
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          hand_added_text?: string | null
          id?: string
          ingredient_id?: string | null
          list_id: string
          phone_changed_at?: string | null
          updated_at?: string
        }
        Update: {
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          hand_added_text?: string | null
          id?: string
          ingredient_id?: string | null
          list_id?: string
          phone_changed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_list_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_list_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "shopping_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      shopping_list_shares: {
        Row: {
          created_at: string
          friend_id: string
          list_id: string
        }
        Insert: {
          created_at?: string
          friend_id: string
          list_id: string
        }
        Update: {
          created_at?: string
          friend_id?: string
          list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_list_shares_friend_id_fkey"
            columns: ["friend_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_list_shares_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "shopping_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      shopping_lists: {
        Row: {
          created_at: string
          id: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
        }
        Relationships: []
      }
      source_videos: {
        Row: {
          caption: string | null
          creator_name: string | null
          creator_url: string | null
          external_id: string | null
          fetched_at: string | null
          id: string
          original_url: string
          pasted_text: string | null
          platform: Database["public"]["Enums"]["source_platform"]
          recipe_id: string
          recipe_site_url: string | null
          refresh_requested_at: string | null
          screenshot_path: string | null
          thumbnail_url: string | null
          title: string | null
        }
        Insert: {
          caption?: string | null
          creator_name?: string | null
          creator_url?: string | null
          external_id?: string | null
          fetched_at?: string | null
          id?: string
          original_url: string
          pasted_text?: string | null
          platform: Database["public"]["Enums"]["source_platform"]
          recipe_id: string
          recipe_site_url?: string | null
          refresh_requested_at?: string | null
          screenshot_path?: string | null
          thumbnail_url?: string | null
          title?: string | null
        }
        Update: {
          caption?: string | null
          creator_name?: string | null
          creator_url?: string | null
          external_id?: string | null
          fetched_at?: string | null
          id?: string
          original_url?: string
          pasted_text?: string | null
          platform?: Database["public"]["Enums"]["source_platform"]
          recipe_id?: string
          recipe_site_url?: string | null
          refresh_requested_at?: string | null
          screenshot_path?: string | null
          thumbnail_url?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_videos_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: true
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      staples: {
        Row: {
          created_at: string
          ingredient_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ingredient_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          ingredient_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staples_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      shopping_list_people: {
        Row: {
          is_owner: boolean | null
          list_id: string | null
          user_id: string | null
          username: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_caption_to_draft: {
        Args: {
          pasted_text?: string
          recipe_id: string
          with_screenshot?: boolean
        }
        Returns: string
      }
      add_manual_item: {
        Args: {
          changed_at?: string
          ingredient_name: string
          item_id?: string
          item_text: string
          list_id: string
        }
        Returns: string
      }
      add_recipe_to_shopping_list: {
        Args: { lines: Json; recipe_id: string }
        Returns: string[]
      }
      add_staple: { Args: { ingredient_name: string }; Returns: string }
      add_tag: { Args: { name: string; recipe_id: string }; Returns: Json }
      add_to_pantry: { Args: { ingredient_name: string }; Returns: string }
      cancel_friend_request: { Args: { user_id: string }; Returns: undefined }
      check_off: {
        Args: { changed_at?: string; item_id: string }
        Returns: string
      }
      claim_draft_build: { Args: { recipe_id: string }; Returns: Json }
      claim_friend_request_push: {
        Args: { addressee: string; requester: string }
        Returns: Json
      }
      claim_source_refresh: { Args: { recipe_id: string }; Returns: Json }
      create_recipe: {
        Args: { lines: Json; steps: string[]; title: string }
        Returns: string
      }
      draft_ready_push: { Args: { recipe_id: string }; Returns: Json }
      edit_recipe: {
        Args: { lines: Json; recipe_id: string; steps: string[]; title: string }
        Returns: string
      }
      fail_draft: {
        Args: {
          reason: Database["public"]["Enums"]["draft_build_failure"]
          recipe_id: string
        }
        Returns: boolean
      }
      finish_draft: {
        Args: { recipe_id: string; result: Json }
        Returns: boolean
      }
      forget_push_token: { Args: { token: string }; Returns: undefined }
      forget_push_tokens: { Args: { tokens: string[] }; Returns: undefined }
      get_profile: {
        Args: { user_id: string }
        Returns: {
          id: string
          username: string
        }[]
      }
      has_ingredient: { Args: { ingredient_id: string }; Returns: boolean }
      ingredients_i_have: { Args: never; Returns: string[] }
      leave_shared_shopping_list: { Args: { list_id: string }; Returns: Json }
      list_friend_requests: {
        Args: never
        Returns: {
          direction: string
          id: string
          sent_at: string
          username: string
        }[]
      }
      list_friends: {
        Args: never
        Returns: {
          id: string
          since: string
          username: string
        }[]
      }
      list_shared_shopping_lists: {
        Args: never
        Returns: {
          list_id: string
          owner_id: string
          owner_username: string
        }[]
      }
      list_shopping_list_shares: {
        Args: never
        Returns: {
          friend_id: string
          shared_at: string
          username: string
        }[]
      }
      register_push_token: { Args: { token: string }; Returns: undefined }
      remove_recipe_from_shopping_list: {
        Args: { recipe_id: string }
        Returns: undefined
      }
      respond_to_friend_request: {
        Args: { accept: boolean; requester_id: string }
        Returns: Json
      }
      retry_draft: { Args: { recipe_id: string }; Returns: string }
      review_draft: {
        Args: {
          lines: Json
          recipe_id: string
          steps: string[]
          tags?: string[]
          title: string
        }
        Returns: string
      }
      save_from_link: {
        Args: {
          pasted_text?: string
          platform: Database["public"]["Enums"]["source_platform"]
          recipe_id: string
          url: string
          with_screenshot?: boolean
        }
        Returns: Json
      }
      search_recipes: {
        Args: { want_to_cook_only?: boolean; words?: Json }
        Returns: {
          build_attempts: number
          build_failure:
            | Database["public"]["Enums"]["draft_build_failure"]
            | null
          build_started_at: string | null
          build_status: Database["public"]["Enums"]["draft_build_status"]
          created_at: string
          id: string
          owner_id: string
          recipe_found: boolean
          status: Database["public"]["Enums"]["recipe_status"]
          steps: string[]
          suggested_tags: string[]
          title: string
          updated_at: string
          want_to_cook_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "recipes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_users: {
        Args: { query: string }
        Returns: {
          id: string
          relationship: string
          username: string
        }[]
      }
      send_friend_request: { Args: { user_id: string }; Returns: Json }
      set_username: { Args: { name: string }; Returns: Json }
      set_want_to_cook: {
        Args: { recipe_id: string; want_to_cook: boolean }
        Returns: string
      }
      share_shopping_list: { Args: { friend_id: string }; Returns: Json }
      stop_sharing_shopping_list: { Args: { friend_id: string }; Returns: Json }
      store_source_refresh: {
        Args: { recipe_id: string; source: Json }
        Returns: boolean
      }
      uncheck: {
        Args: { changed_at?: string; item_id: string }
        Returns: string
      }
      unfriend: { Args: { user_id: string }; Returns: undefined }
    }
    Enums: {
      draft_build_failure:
        | "source_unavailable"
        | "source_unreachable"
        | "unreadable"
        | "timed_out"
        | "not_set_up"
        | "no_caption"
        | "source_refused"
      draft_build_status: "building" | "built" | "failed"
      friendship_status: "pending" | "accepted" | "declined"
      recipe_status: "draft" | "reviewed"
      source_platform: "tiktok" | "youtube" | "instagram" | "web"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      draft_build_failure: [
        "source_unavailable",
        "source_unreachable",
        "unreadable",
        "timed_out",
        "not_set_up",
        "no_caption",
        "source_refused",
      ],
      draft_build_status: ["building", "built", "failed"],
      friendship_status: ["pending", "accepted", "declined"],
      recipe_status: ["draft", "reviewed"],
      source_platform: ["tiktok", "youtube", "instagram", "web"],
    },
  },
} as const

