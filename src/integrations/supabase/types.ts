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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          created_at: string
          id: number
          payload: Json
          result: string
          room_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: number
          payload?: Json
          result?: string
          room_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: number
          payload?: Json
          result?: string
          room_id?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          capabilities: Json
          created_at: string
          default_config: Json
          enabled: boolean
          hidden_actions: boolean
          manifest: Json
          max_players: number
          min_players: number
          name: string
          slug: string
          supports_spectators: boolean
          tagline: string | null
          version: string
        }
        Insert: {
          capabilities?: Json
          created_at?: string
          default_config?: Json
          enabled?: boolean
          hidden_actions?: boolean
          manifest?: Json
          max_players: number
          min_players: number
          name: string
          slug: string
          supports_spectators?: boolean
          tagline?: string | null
          version: string
        }
        Update: {
          capabilities?: Json
          created_at?: string
          default_config?: Json
          enabled?: boolean
          hidden_actions?: boolean
          manifest?: Json
          max_players?: number
          min_players?: number
          name?: string
          slug?: string
          supports_spectators?: boolean
          tagline?: string | null
          version?: string
        }
        Relationships: []
      }
      match_events: {
        Row: {
          actor_id: string | null
          created_at: string
          id: number
          payload: Json
          room_id: string
          type: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: number
          payload?: Json
          room_id: string
          type: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: number
          payload?: Json
          room_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_events_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_guest: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
          is_guest?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_guest?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      room_participants: {
        Row: {
          connected: boolean
          eliminated: boolean
          id: string
          joined_at: string
          last_seen_at: string
          role: Database["public"]["Enums"]["participant_role"]
          room_id: string
          score: number
          seat: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          connected?: boolean
          eliminated?: boolean
          id?: string
          joined_at?: string
          last_seen_at?: string
          role?: Database["public"]["Enums"]["participant_role"]
          room_id: string
          score?: number
          seat?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          connected?: boolean
          eliminated?: boolean
          id?: string
          joined_at?: string
          last_seen_at?: string
          role?: Database["public"]["Enums"]["participant_role"]
          room_id?: string
          score?: number
          seat?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_participants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          code: string
          config: Json
          created_at: string
          created_by: string
          current_round: number
          ended_at: string | null
          error_message: string | null
          game_slug: string
          game_version: string
          id: string
          previous_status: Database["public"]["Enums"]["room_status"] | null
          started_at: string | null
          status: Database["public"]["Enums"]["room_status"]
          updated_at: string
          winner_user_id: string | null
        }
        Insert: {
          code: string
          config?: Json
          created_at?: string
          created_by: string
          current_round?: number
          ended_at?: string | null
          error_message?: string | null
          game_slug: string
          game_version: string
          id?: string
          previous_status?: Database["public"]["Enums"]["room_status"] | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["room_status"]
          updated_at?: string
          winner_user_id?: string | null
        }
        Update: {
          code?: string
          config?: Json
          created_at?: string
          created_by?: string
          current_round?: number
          ended_at?: string | null
          error_message?: string | null
          game_slug?: string
          game_version?: string
          id?: string
          previous_status?: Database["public"]["Enums"]["room_status"] | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["room_status"]
          updated_at?: string
          winner_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rooms_game_slug_fkey"
            columns: ["game_slug"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["slug"]
          },
        ]
      }
      round_actions: {
        Row: {
          action: Json
          id: string
          room_id: string
          round_id: string
          submitted_at: string
          user_id: string
        }
        Insert: {
          action: Json
          id?: string
          room_id: string
          round_id: string
          submitted_at?: string
          user_id: string
        }
        Update: {
          action?: Json
          id?: string
          room_id?: string
          round_id?: string
          submitted_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "round_actions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_actions_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      rounds: {
        Row: {
          forced: boolean
          id: string
          resolved_at: string | null
          result: Json | null
          room_id: string
          round_number: number
          started_at: string
          status: Database["public"]["Enums"]["round_status"]
        }
        Insert: {
          forced?: boolean
          id?: string
          resolved_at?: string | null
          result?: Json | null
          room_id: string
          round_number: number
          started_at?: string
          status?: Database["public"]["Enums"]["round_status"]
        }
        Update: {
          forced?: boolean
          id?: string
          resolved_at?: string | null
          result?: Json | null
          room_id?: string
          round_number?: number
          started_at?: string
          status?: Database["public"]["Enums"]["round_status"]
        }
        Relationships: [
          {
            foreignKeyName: "rounds_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          granted_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "master" | "operator" | "player"
      participant_role: "player" | "spectator"
      room_status:
        | "WAITING"
        | "READY"
        | "ROUND_STARTED"
        | "PLAYER_ACTIONS"
        | "RESOLVE"
        | "SCORE_UPDATE"
        | "NEXT_ROUND"
        | "MATCH_COMPLETE"
        | "PAUSED"
        | "DISCONNECTED"
        | "RECONNECTING"
        | "CANCELLED"
        | "ABORTED"
        | "ERROR"
      round_status: "PENDING" | "OPEN" | "RESOLVED" | "VOIDED"
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
      app_role: ["master", "operator", "player"],
      participant_role: ["player", "spectator"],
      room_status: [
        "WAITING",
        "READY",
        "ROUND_STARTED",
        "PLAYER_ACTIONS",
        "RESOLVE",
        "SCORE_UPDATE",
        "NEXT_ROUND",
        "MATCH_COMPLETE",
        "PAUSED",
        "DISCONNECTED",
        "RECONNECTING",
        "CANCELLED",
        "ABORTED",
        "ERROR",
      ],
      round_status: ["PENDING", "OPEN", "RESOLVED", "VOIDED"],
    },
  },
} as const
