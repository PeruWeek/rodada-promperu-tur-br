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
      audit_logs: {
        Row: {
          action: string
          actor_profile_id: string | null
          created_at: string
          event_id: string
          id: string
          payload: Json
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          created_at?: string
          event_id: string
          id?: string
          payload?: Json
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          created_at?: string
          event_id?: string
          id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          city: string | null
          country_code: string
          created_at: string
          id: string
          instagram: string | null
          legal_name: string | null
          linkedin: string | null
          phone: string | null
          trade_name: string
          website: string | null
          whatsapp: string | null
        }
        Insert: {
          city?: string | null
          country_code: string
          created_at?: string
          id?: string
          instagram?: string | null
          legal_name?: string | null
          linkedin?: string | null
          phone?: string | null
          trade_name: string
          website?: string | null
          whatsapp?: string | null
        }
        Update: {
          city?: string | null
          country_code?: string
          created_at?: string
          id?: string
          instagram?: string | null
          legal_name?: string | null
          linkedin?: string | null
          phone?: string | null
          trade_name?: string
          website?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      email_delivery_logs: {
        Row: {
          created_at: string
          error: string | null
          event_id: string | null
          id: string
          provider: string
          recipient_email: string
          recipient_profile_id: string | null
          status: string
          template: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          event_id?: string | null
          id?: string
          provider?: string
          recipient_email: string
          recipient_profile_id?: string | null
          status: string
          template: string
        }
        Update: {
          created_at?: string
          error?: string | null
          event_id?: string | null
          id?: string
          provider?: string
          recipient_email?: string
          recipient_profile_id?: string | null
          status?: string
          template?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_delivery_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_delivery_logs_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_tables: {
        Row: {
          event_id: string
          exhibitor_profile_id: string | null
          id: string
          table_label: string | null
          table_number: number
        }
        Insert: {
          event_id: string
          exhibitor_profile_id?: string | null
          id?: string
          table_label?: string | null
          table_number: number
        }
        Update: {
          event_id?: string
          exhibitor_profile_id?: string | null
          id?: string
          table_label?: string | null
          table_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_tables_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_tables_exhibitor_profile_id_fkey"
            columns: ["exhibitor_profile_id"]
            isOneToOne: false
            referencedRelation: "exhibitor_profiles"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      events: {
        Row: {
          capacity_target: number | null
          created_at: string
          event_date: string | null
          id: string
          language_default: Database["public"]["Enums"]["app_language"]
          lunch_end: string | null
          lunch_start: string | null
          meetings_end: string | null
          meetings_start: string | null
          meetings2_end: string | null
          meetings2_start: string | null
          name: string
          slot_minutes: number
          tables_count: number
        }
        Insert: {
          capacity_target?: number | null
          created_at?: string
          event_date?: string | null
          id?: string
          language_default?: Database["public"]["Enums"]["app_language"]
          lunch_end?: string | null
          lunch_start?: string | null
          meetings_end?: string | null
          meetings_start?: string | null
          meetings2_end?: string | null
          meetings2_start?: string | null
          name: string
          slot_minutes?: number
          tables_count?: number
        }
        Update: {
          capacity_target?: number | null
          created_at?: string
          event_date?: string | null
          id?: string
          language_default?: Database["public"]["Enums"]["app_language"]
          lunch_end?: string | null
          lunch_start?: string | null
          meetings_end?: string | null
          meetings_start?: string | null
          meetings2_end?: string | null
          meetings2_start?: string | null
          name?: string
          slot_minutes?: number
          tables_count?: number
        }
        Relationships: []
      }
      exhibitor_profiles: {
        Row: {
          destinations: string[] | null
          materials_links: string[] | null
          pitch_es: string | null
          pitch_pt: string | null
          portfolio_es: string | null
          portfolio_pt: string | null
          profile_id: string
          segments: string[] | null
          services: string[] | null
          target_buyers: string[] | null
        }
        Insert: {
          destinations?: string[] | null
          materials_links?: string[] | null
          pitch_es?: string | null
          pitch_pt?: string | null
          portfolio_es?: string | null
          portfolio_pt?: string | null
          profile_id: string
          segments?: string[] | null
          services?: string[] | null
          target_buyers?: string[] | null
        }
        Update: {
          destinations?: string[] | null
          materials_links?: string[] | null
          pitch_es?: string | null
          pitch_pt?: string | null
          portfolio_es?: string | null
          portfolio_pt?: string | null
          profile_id?: string
          segments?: string[] | null
          services?: string[] | null
          target_buyers?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "exhibitor_profiles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      general_checkins: {
        Row: {
          checkin_at: string
          event_id: string
          id: string
          method: Database["public"]["Enums"]["checkin_method"]
          profile_id: string
        }
        Insert: {
          checkin_at?: string
          event_id: string
          id?: string
          method?: Database["public"]["Enums"]["checkin_method"]
          profile_id: string
        }
        Update: {
          checkin_at?: string
          event_id?: string
          id?: string
          method?: Database["public"]["Enums"]["checkin_method"]
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "general_checkins_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_checkins_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_checkins: {
        Row: {
          by_role: Database["public"]["Enums"]["meeting_checkin_by_role"]
          checkin_at: string
          id: string
          late_minutes: number | null
          meeting_id: string
          status: Database["public"]["Enums"]["meeting_checkin_status"]
        }
        Insert: {
          by_role: Database["public"]["Enums"]["meeting_checkin_by_role"]
          checkin_at?: string
          id?: string
          late_minutes?: number | null
          meeting_id: string
          status?: Database["public"]["Enums"]["meeting_checkin_status"]
        }
        Update: {
          by_role?: Database["public"]["Enums"]["meeting_checkin_by_role"]
          checkin_at?: string
          id?: string
          late_minutes?: number | null
          meeting_id?: string
          status?: Database["public"]["Enums"]["meeting_checkin_status"]
        }
        Relationships: [
          {
            foreignKeyName: "meeting_checkins_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_outcomes: {
        Row: {
          created_at: string
          meeting_id: string
          next_steps: string | null
          notes: string | null
          outcome: Database["public"]["Enums"]["meeting_outcome"]
        }
        Insert: {
          created_at?: string
          meeting_id: string
          next_steps?: string | null
          notes?: string | null
          outcome: Database["public"]["Enums"]["meeting_outcome"]
        }
        Update: {
          created_at?: string
          meeting_id?: string
          next_steps?: string | null
          notes?: string | null
          outcome?: Database["public"]["Enums"]["meeting_outcome"]
        }
        Relationships: [
          {
            foreignKeyName: "meeting_outcomes_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: true
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_reschedules: {
        Row: {
          batch_id: string
          changed_at: string
          changed_by_profile_id: string | null
          details: Json
          event_id: string
          id: string
          meeting_id: string
          new_slot_id: string | null
          new_table_id: string | null
          old_slot_id: string | null
          old_table_id: string | null
          reason: string | null
        }
        Insert: {
          batch_id: string
          changed_at?: string
          changed_by_profile_id?: string | null
          details?: Json
          event_id: string
          id?: string
          meeting_id: string
          new_slot_id?: string | null
          new_table_id?: string | null
          old_slot_id?: string | null
          old_table_id?: string | null
          reason?: string | null
        }
        Update: {
          batch_id?: string
          changed_at?: string
          changed_by_profile_id?: string | null
          details?: Json
          event_id?: string
          id?: string
          meeting_id?: string
          new_slot_id?: string | null
          new_table_id?: string | null
          old_slot_id?: string | null
          old_table_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_reschedules_changed_by_profile_id_fkey"
            columns: ["changed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_reschedules_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_reschedules_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          cancel_reason: string | null
          created_at: string
          event_id: string
          id: string
          original_slot_id: string | null
          original_start_at: string | null
          requested_start_at: string | null
          slot_id: string
          status: Database["public"]["Enums"]["meeting_status"]
          table_id: string
          visitor_profile_id: string
        }
        Insert: {
          cancel_reason?: string | null
          created_at?: string
          event_id: string
          id?: string
          original_slot_id?: string | null
          original_start_at?: string | null
          requested_start_at?: string | null
          slot_id: string
          status?: Database["public"]["Enums"]["meeting_status"]
          table_id: string
          visitor_profile_id: string
        }
        Update: {
          cancel_reason?: string | null
          created_at?: string
          event_id?: string
          id?: string
          original_slot_id?: string | null
          original_start_at?: string | null
          requested_start_at?: string | null
          slot_id?: string
          status?: Database["public"]["Enums"]["meeting_status"]
          table_id?: string
          visitor_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_original_slot_id_fkey"
            columns: ["original_slot_id"]
            isOneToOne: false
            referencedRelation: "time_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "time_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "event_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_visitor_profile_id_fkey"
            columns: ["visitor_profile_id"]
            isOneToOne: false
            referencedRelation: "visitor_profiles"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          data: Json
          event_id: string | null
          id: string
          is_read: boolean
          recipient_profile_id: string
          status: Database["public"]["Enums"]["notification_status"]
          title: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Insert: {
          body?: string | null
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          data?: Json
          event_id?: string | null
          id?: string
          is_read?: boolean
          recipient_profile_id: string
          status?: Database["public"]["Enums"]["notification_status"]
          title: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Update: {
          body?: string | null
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          data?: Json
          event_id?: string | null
          id?: string
          is_read?: boolean
          recipient_profile_id?: string
          status?: Database["public"]["Enums"]["notification_status"]
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Relationships: [
          {
            foreignKeyName: "notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auth_user_id: string | null
          company_id: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          preferred_language: Database["public"]["Enums"]["app_language"]
        }
        Insert: {
          auth_user_id?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          preferred_language?: Database["public"]["Enums"]["app_language"]
        }
        Update: {
          auth_user_id?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          preferred_language?: Database["public"]["Enums"]["app_language"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      time_slots: {
        Row: {
          created_at: string
          end_at: string
          event_id: string
          generation_id: string | null
          id: string
          is_active: boolean
          is_buffer: boolean
          start_at: string
          table_id: string
        }
        Insert: {
          created_at?: string
          end_at: string
          event_id: string
          generation_id?: string | null
          id?: string
          is_active?: boolean
          is_buffer?: boolean
          start_at: string
          table_id: string
        }
        Update: {
          created_at?: string
          end_at?: string
          event_id?: string
          generation_id?: string | null
          id?: string
          is_active?: boolean
          is_buffer?: boolean
          start_at?: string
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_slots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_slots_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "event_tables"
            referencedColumns: ["id"]
          },
        ]
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
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      visitor_profiles: {
        Row: {
          buyer_type: string | null
          interests_destinations: string[] | null
          interests_segments: string[] | null
          interests_services: string[] | null
          notes: string | null
          portfolio_es: string | null
          portfolio_pt: string | null
          profile_id: string
        }
        Insert: {
          buyer_type?: string | null
          interests_destinations?: string[] | null
          interests_segments?: string[] | null
          interests_services?: string[] | null
          notes?: string | null
          portfolio_es?: string | null
          portfolio_pt?: string | null
          profile_id: string
        }
        Update: {
          buyer_type?: string | null
          interests_destinations?: string[] | null
          interests_segments?: string[] | null
          interests_services?: string[] | null
          notes?: string | null
          portfolio_es?: string | null
          portfolio_pt?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visitor_profiles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
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
      current_profile_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_or_staff: { Args: { _user_id: string }; Returns: boolean }
      rebuild_event_time_slots: {
        Args: { p_deactivate_previous?: boolean; p_event_id: string }
        Returns: string
      }
    }
    Enums: {
      app_language: "pt-BR" | "es"
      app_role: "admin" | "staff" | "exhibitor" | "visitor"
      checkin_method: "qr" | "manual"
      meeting_checkin_by_role: "staff" | "exhibitor" | "visitor"
      meeting_checkin_status: "present" | "no_show" | "late"
      meeting_outcome: "hot" | "warm" | "cold"
      meeting_status:
        | "scheduled"
        | "cancelled"
        | "done"
        | "no_show"
        | "needs_reschedule"
      notification_channel: "in_app" | "email" | "both"
      notification_status: "queued" | "sent" | "failed"
      notification_type:
        | "meeting_created"
        | "meeting_cancelled"
        | "meeting_rescheduled"
        | "meeting_reminder"
        | "system"
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
  public: {
    Enums: {
      app_language: ["pt-BR", "es"],
      app_role: ["admin", "staff", "exhibitor", "visitor"],
      checkin_method: ["qr", "manual"],
      meeting_checkin_by_role: ["staff", "exhibitor", "visitor"],
      meeting_checkin_status: ["present", "no_show", "late"],
      meeting_outcome: ["hot", "warm", "cold"],
      meeting_status: [
        "scheduled",
        "cancelled",
        "done",
        "no_show",
        "needs_reschedule",
      ],
      notification_channel: ["in_app", "email", "both"],
      notification_status: ["queued", "sent", "failed"],
      notification_type: [
        "meeting_created",
        "meeting_cancelled",
        "meeting_rescheduled",
        "meeting_reminder",
        "system",
      ],
    },
  },
} as const
