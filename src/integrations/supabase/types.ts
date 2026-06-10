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
      agent_skills: {
        Row: {
          agent_id: string
          skill_id: string
        }
        Insert: {
          agent_id: string
          skill_id: string
        }
        Update: {
          agent_id?: string
          skill_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_skills_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          base_url_mode: Database["public"]["Enums"]["agent_base_url_mode"]
          created_at: string
          event_id: string
          id: string
          is_active: boolean
          is_default: boolean
          max_tokens: number | null
          model: string
          name: string
          provider: string
          rag_enabled: boolean
          system_prompt: string | null
          temperature: number | null
          updated_at: string
        }
        Insert: {
          base_url_mode?: Database["public"]["Enums"]["agent_base_url_mode"]
          created_at?: string
          event_id: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          max_tokens?: number | null
          model: string
          name: string
          provider?: string
          rag_enabled?: boolean
          system_prompt?: string | null
          temperature?: number | null
          updated_at?: string
        }
        Update: {
          base_url_mode?: Database["public"]["Enums"]["agent_base_url_mode"]
          created_at?: string
          event_id?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          max_tokens?: number | null
          model?: string
          name?: string
          provider?: string
          rag_enabled?: boolean
          system_prompt?: string | null
          temperature?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_profile_id: string | null
          created_at: string
          event_id: string | null
          id: string
          payload: Json
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          payload?: Json
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          created_at?: string
          event_id?: string | null
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
          address: string | null
          city: string | null
          country_code: string
          created_at: string
          general_phone: string | null
          id: string
          import_profile: string | null
          instagram: string | null
          legal_name: string | null
          linkedin: string | null
          phone: string | null
          registration_id: string | null
          specialty: string | null
          state_code: string | null
          tax_id: string | null
          trade_name: string
          website: string | null
          whatsapp: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          country_code: string
          created_at?: string
          general_phone?: string | null
          id?: string
          import_profile?: string | null
          instagram?: string | null
          legal_name?: string | null
          linkedin?: string | null
          phone?: string | null
          registration_id?: string | null
          specialty?: string | null
          state_code?: string | null
          tax_id?: string | null
          trade_name: string
          website?: string | null
          whatsapp?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          country_code?: string
          created_at?: string
          general_phone?: string | null
          id?: string
          import_profile?: string | null
          instagram?: string | null
          legal_name?: string | null
          linkedin?: string | null
          phone?: string | null
          registration_id?: string | null
          specialty?: string | null
          state_code?: string | null
          tax_id?: string | null
          trade_name?: string
          website?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      company_event_pipeline: {
        Row: {
          city: string | null
          company_category:
            | Database["public"]["Enums"]["pipeline_company_category"]
            | null
          company_id: string
          company_role: Database["public"]["Enums"]["pipeline_company_role"]
          company_type:
            | Database["public"]["Enums"]["pipeline_company_type"]
            | null
          country_code: string | null
          created_at: string
          event_id: string
          id: string
          is_profile_complete: boolean
          last_contact_at: string | null
          last_contact_channel: string | null
          next_action: Database["public"]["Enums"]["pipeline_next_action"]
          next_action_due_at: string | null
          notes: string | null
          owner_staff_profile_id: string | null
          primary_profile_id: string | null
          priority: Database["public"]["Enums"]["pipeline_priority"]
          region_label: string | null
          registration_status: Database["public"]["Enums"]["pipeline_registration_status"]
          scheduling_status: Database["public"]["Enums"]["pipeline_scheduling_status"]
          state_code: string | null
          updated_at: string
        }
        Insert: {
          city?: string | null
          company_category?:
            | Database["public"]["Enums"]["pipeline_company_category"]
            | null
          company_id: string
          company_role?: Database["public"]["Enums"]["pipeline_company_role"]
          company_type?:
            | Database["public"]["Enums"]["pipeline_company_type"]
            | null
          country_code?: string | null
          created_at?: string
          event_id: string
          id?: string
          is_profile_complete?: boolean
          last_contact_at?: string | null
          last_contact_channel?: string | null
          next_action?: Database["public"]["Enums"]["pipeline_next_action"]
          next_action_due_at?: string | null
          notes?: string | null
          owner_staff_profile_id?: string | null
          primary_profile_id?: string | null
          priority?: Database["public"]["Enums"]["pipeline_priority"]
          region_label?: string | null
          registration_status?: Database["public"]["Enums"]["pipeline_registration_status"]
          scheduling_status?: Database["public"]["Enums"]["pipeline_scheduling_status"]
          state_code?: string | null
          updated_at?: string
        }
        Update: {
          city?: string | null
          company_category?:
            | Database["public"]["Enums"]["pipeline_company_category"]
            | null
          company_id?: string
          company_role?: Database["public"]["Enums"]["pipeline_company_role"]
          company_type?:
            | Database["public"]["Enums"]["pipeline_company_type"]
            | null
          country_code?: string | null
          created_at?: string
          event_id?: string
          id?: string
          is_profile_complete?: boolean
          last_contact_at?: string | null
          last_contact_channel?: string | null
          next_action?: Database["public"]["Enums"]["pipeline_next_action"]
          next_action_due_at?: string | null
          notes?: string | null
          owner_staff_profile_id?: string | null
          primary_profile_id?: string | null
          priority?: Database["public"]["Enums"]["pipeline_priority"]
          region_label?: string | null
          registration_status?: Database["public"]["Enums"]["pipeline_registration_status"]
          scheduling_status?: Database["public"]["Enums"]["pipeline_scheduling_status"]
          state_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_event_pipeline_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_event_pipeline_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_event_pipeline_owner_staff_profile_id_fkey"
            columns: ["owner_staff_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_event_pipeline_primary_profile_id_fkey"
            columns: ["primary_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          content: string | null
          conversation_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["conversation_message_role"]
          tool_call_id: string | null
          tool_calls: Json | null
          tool_name: string | null
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["conversation_message_role"]
          tool_call_id?: string | null
          tool_calls?: Json | null
          tool_name?: string | null
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["conversation_message_role"]
          tool_call_id?: string | null
          tool_calls?: Json | null
          tool_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          agent_id: string | null
          created_at: string
          event_id: string
          id: string
          owner_profile_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          event_id: string
          id?: string
          owner_profile_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          event_id?: string
          id?: string
          owner_profile_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_template_overrides: {
        Row: {
          cta_label_es: string | null
          cta_label_pt: string | null
          from_name: string | null
          greeting_es: string | null
          greeting_pt: string | null
          intro_es: string | null
          intro_pt: string | null
          outro_es: string | null
          outro_pt: string | null
          signature_es: string | null
          signature_pt: string | null
          subject_es: string | null
          subject_pt: string | null
          template_name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cta_label_es?: string | null
          cta_label_pt?: string | null
          from_name?: string | null
          greeting_es?: string | null
          greeting_pt?: string | null
          intro_es?: string | null
          intro_pt?: string | null
          outro_es?: string | null
          outro_pt?: string | null
          signature_es?: string | null
          signature_pt?: string | null
          subject_es?: string | null
          subject_pt?: string | null
          template_name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cta_label_es?: string | null
          cta_label_pt?: string | null
          from_name?: string | null
          greeting_es?: string | null
          greeting_pt?: string | null
          intro_es?: string | null
          intro_pt?: string | null
          outro_es?: string | null
          outro_pt?: string | null
          signature_es?: string | null
          signature_pt?: string | null
          subject_es?: string | null
          subject_pt?: string | null
          template_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_template_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
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
      exhibitor_requests: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by_profile_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_profile_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_profile_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "exhibitor_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exhibitor_requests_reviewed_by_profile_id_fkey"
            columns: ["reviewed_by_profile_id"]
            isOneToOne: false
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
          job_title: string | null
          pending_signup: boolean
          phone: string | null
          preferred_language: Database["public"]["Enums"]["app_language"]
          whatsapp: string | null
        }
        Insert: {
          auth_user_id?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          job_title?: string | null
          pending_signup?: boolean
          phone?: string | null
          preferred_language?: Database["public"]["Enums"]["app_language"]
          whatsapp?: string | null
        }
        Update: {
          auth_user_id?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          job_title?: string | null
          pending_signup?: boolean
          phone?: string | null
          preferred_language?: Database["public"]["Enums"]["app_language"]
          whatsapp?: string | null
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
      rag_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          event_id: string
          id: string
          metadata: Json
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          event_id: string
          id?: string
          metadata?: Json
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          event_id?: string
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "rag_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "rag_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rag_chunks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      rag_documents: {
        Row: {
          created_at: string
          event_id: string
          id: string
          mime: string | null
          raw_text: string
          source_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          mime?: string | null
          raw_text: string
          source_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          mime?: string | null
          raw_text?: string
          source_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rag_documents_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          created_at: string
          description: string
          id: string
          is_active: boolean
          key: string
          name: string
          params_schema: Json
          scope: Database["public"]["Enums"]["skill_scope"]
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          is_active?: boolean
          key: string
          name: string
          params_schema?: Json
          scope?: Database["public"]["Enums"]["skill_scope"]
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          key?: string
          name?: string
          params_schema?: Json
          scope?: Database["public"]["Enums"]["skill_scope"]
        }
        Relationships: []
      }
      staff_table_assignments: {
        Row: {
          created_at: string
          event_id: string
          id: string
          staff_profile_id: string
          table_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          staff_profile_id: string
          table_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          staff_profile_id?: string
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_table_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_table_assignments_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_table_assignments_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "event_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
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
      user_llm_credentials: {
        Row: {
          api_key_encrypted: string
          created_at: string
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key_encrypted: string
          created_at?: string
          provider?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key_encrypted?: string
          created_at?: string
          provider?: string
          updated_at?: string
          user_id?: string
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
          additional_contacts: Json
          buyer_type: string | null
          consent_data_sharing: boolean
          consent_data_sharing_at: string | null
          consent_marketing: boolean
          demand_profile: string | null
          interests_destinations: string[] | null
          interests_destinations_free: string | null
          interests_segments: string[] | null
          interests_services: string[] | null
          notes: string | null
          portfolio_es: string | null
          portfolio_pt: string | null
          profile_id: string
        }
        Insert: {
          additional_contacts?: Json
          buyer_type?: string | null
          consent_data_sharing?: boolean
          consent_data_sharing_at?: string | null
          consent_marketing?: boolean
          demand_profile?: string | null
          interests_destinations?: string[] | null
          interests_destinations_free?: string | null
          interests_segments?: string[] | null
          interests_services?: string[] | null
          notes?: string | null
          portfolio_es?: string | null
          portfolio_pt?: string | null
          profile_id: string
        }
        Update: {
          additional_contacts?: Json
          buyer_type?: string | null
          consent_data_sharing?: boolean
          consent_data_sharing_at?: string | null
          consent_marketing?: boolean
          demand_profile?: string | null
          interests_destinations?: string[] | null
          interests_destinations_free?: string | null
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
      v_company_event_pipeline: {
        Row: {
          city: string | null
          company_category:
            | Database["public"]["Enums"]["pipeline_company_category"]
            | null
          company_id: string | null
          company_legal_name: string | null
          company_role:
            | Database["public"]["Enums"]["pipeline_company_role"]
            | null
          company_specialty: string | null
          company_trade_name: string | null
          company_type:
            | Database["public"]["Enums"]["pipeline_company_type"]
            | null
          country_code: string | null
          created_at: string | null
          event_id: string | null
          exhibitor_destinations: string[] | null
          exhibitor_segments: string[] | null
          exhibitor_services: string[] | null
          has_pending_exhibitor_request: boolean | null
          id: string | null
          is_profile_complete: boolean | null
          last_contact_at: string | null
          last_contact_channel: string | null
          next_action:
            | Database["public"]["Enums"]["pipeline_next_action"]
            | null
          next_action_due_at: string | null
          notes: string | null
          owner_name: string | null
          owner_staff_profile_id: string | null
          primary_contact_email: string | null
          primary_contact_name: string | null
          primary_contact_phone: string | null
          primary_contact_whatsapp: string | null
          primary_profile_id: string | null
          priority: Database["public"]["Enums"]["pipeline_priority"] | null
          region_label: string | null
          registration_status:
            | Database["public"]["Enums"]["pipeline_registration_status"]
            | null
          scheduled_meetings_count: number | null
          scheduling_status:
            | Database["public"]["Enums"]["pipeline_scheduling_status"]
            | null
          state_code: string | null
          updated_at: string | null
          visitor_buyer_type: string | null
          visitor_destinations: string[] | null
          visitor_segments: string[] | null
          visitor_services: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "company_event_pipeline_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_event_pipeline_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_event_pipeline_owner_staff_profile_id_fkey"
            columns: ["owner_staff_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_event_pipeline_primary_profile_id_fkey"
            columns: ["primary_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_create_company_for_orphan: {
        Args: {
          p_city?: string
          p_country_code: string
          p_legal_name?: string
          p_profile_id: string
          p_state_code?: string
          p_trade_name: string
        }
        Returns: string
      }
      admin_link_orphan_to_company: {
        Args: {
          p_company_id: string
          p_force?: boolean
          p_force_reason?: string
          p_profile_id: string
        }
        Returns: undefined
      }
      admin_list_orphan_exhibitors: {
        Args: never
        Returns: {
          created_at: string
          email: string
          full_name: string
          has_exhibitor_request: boolean
          is_active: boolean
          profile_id: string
          request_status: string
          table_number: number
        }[]
      }
      admin_list_unpublished_exhibitors: {
        Args: never
        Returns: {
          created_at: string
          email: string
          full_name: string
          profile_id: string
          reason: string
          trade_name: string
        }[]
      }
      complete_buyer_signup: { Args: { p_payload: Json }; Returns: string }
      current_profile_id: { Args: never; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      derive_region_label: {
        Args: { p_city: string; p_country: string; p_state: string }
        Returns: string
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      has_meeting_with_company: {
        Args: { _company_id: string }
        Returns: boolean
      }
      has_meeting_with_profile: {
        Args: { _profile_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_or_staff: { Args: { _user_id: string }; Returns: boolean }
      is_exhibitor_company: { Args: { _company_id: string }; Returns: boolean }
      is_exhibitor_profile: { Args: { _profile_id: string }; Returns: boolean }
      log_audit: {
        Args: { p_action: string; p_event_id?: string; p_payload: Json }
        Returns: undefined
      }
      match_rag_chunks: {
        Args: { p_event_id: string; p_query: string; p_top_k?: number }
        Returns: {
          content: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      onboard_company: {
        Args: { p_city: string; p_country_code: string; p_trade_name: string }
        Returns: string
      }
      pipeline_active_event_id: { Args: never; Returns: string }
      pipeline_compute_complete: {
        Args: {
          p_company_id: string
          p_profile_id: string
          p_role: Database["public"]["Enums"]["pipeline_company_role"]
        }
        Returns: boolean
      }
      pipeline_ensure_row: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      pipeline_recalc_scheduling: {
        Args: { p_company_id: string; p_event_id: string }
        Returns: undefined
      }
      public_companies: {
        Args: { _ids: string[] }
        Returns: {
          city: string
          country_code: string
          id: string
          import_profile: string
          instagram: string
          legal_name: string
          linkedin: string
          specialty: string
          state_code: string
          trade_name: string
          website: string
        }[]
      }
      public_exhibitor_catalog: {
        Args: { _event_id?: string }
        Returns: {
          city: string
          country_code: string
          destinations: string[]
          full_name: string
          profile_id: string
          segments: string[]
          services: string[]
          table_number: number
          trade_name: string
        }[]
      }
      public_exhibitor_detail: {
        Args: { _profile_id: string }
        Returns: {
          city: string
          company_id: string
          country_code: string
          destinations: string[]
          full_name: string
          instagram: string
          linkedin: string
          materials_links: string[]
          pitch_es: string
          pitch_pt: string
          portfolio_es: string
          portfolio_pt: string
          profile_id: string
          segments: string[]
          services: string[]
          table_number: number
          target_buyers: string[]
          trade_name: string
          website: string
        }[]
      }
      public_profiles: {
        Args: { _ids: string[] }
        Returns: {
          company_id: string
          full_name: string
          id: string
          is_active: boolean
          job_title: string
          preferred_language: Database["public"]["Enums"]["app_language"]
        }[]
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      rebuild_event_time_slots: {
        Args: { p_deactivate_previous?: boolean; p_event_id: string }
        Returns: string
      }
    }
    Enums: {
      agent_base_url_mode: "api" | "free"
      app_language: "pt-BR" | "es"
      app_role: "admin" | "staff" | "exhibitor" | "visitor"
      checkin_method: "qr" | "manual"
      conversation_message_role: "user" | "assistant" | "tool" | "system"
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
      pipeline_company_category:
        | "buyer_prioritario"
        | "buyer_secundario"
        | "fornecedor_mice"
        | "hotelaria"
        | "destino"
        | "parceiro_institucional"
        | "imprensa"
        | "outro"
      pipeline_company_role: "exhibitor" | "visitor"
      pipeline_company_type:
        | "agencia"
        | "operadora"
        | "corporativo"
        | "organizadora"
        | "associacao"
        | "hotel"
        | "dmc"
        | "centro_de_convencoes"
        | "transporte"
        | "tecnologia_eventos"
        | "outro"
      pipeline_next_action:
        | "nenhuma"
        | "ligar_para_confirmar"
        | "cobrar_documentos"
        | "aguardar_retorno"
        | "aprovar_cadastro"
        | "ajustar_perfil"
        | "estimular_agendamento"
      pipeline_priority: "baixa" | "media" | "alta"
      pipeline_registration_status:
        | "nao_iniciado"
        | "em_preenchimento"
        | "cadastro_concluido"
        | "aguardando_aprovacao"
        | "aprovado"
        | "bloqueado"
      pipeline_scheduling_status:
        | "sem_agendamento"
        | "agendamento_iniciado"
        | "agendado_parcial"
        | "agendado_ok"
        | "agenda_fechada"
      skill_scope: "public" | "staff"
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
      agent_base_url_mode: ["api", "free"],
      app_language: ["pt-BR", "es"],
      app_role: ["admin", "staff", "exhibitor", "visitor"],
      checkin_method: ["qr", "manual"],
      conversation_message_role: ["user", "assistant", "tool", "system"],
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
      pipeline_company_category: [
        "buyer_prioritario",
        "buyer_secundario",
        "fornecedor_mice",
        "hotelaria",
        "destino",
        "parceiro_institucional",
        "imprensa",
        "outro",
      ],
      pipeline_company_role: ["exhibitor", "visitor"],
      pipeline_company_type: [
        "agencia",
        "operadora",
        "corporativo",
        "organizadora",
        "associacao",
        "hotel",
        "dmc",
        "centro_de_convencoes",
        "transporte",
        "tecnologia_eventos",
        "outro",
      ],
      pipeline_next_action: [
        "nenhuma",
        "ligar_para_confirmar",
        "cobrar_documentos",
        "aguardar_retorno",
        "aprovar_cadastro",
        "ajustar_perfil",
        "estimular_agendamento",
      ],
      pipeline_priority: ["baixa", "media", "alta"],
      pipeline_registration_status: [
        "nao_iniciado",
        "em_preenchimento",
        "cadastro_concluido",
        "aguardando_aprovacao",
        "aprovado",
        "bloqueado",
      ],
      pipeline_scheduling_status: [
        "sem_agendamento",
        "agendamento_iniciado",
        "agendado_parcial",
        "agendado_ok",
        "agenda_fechada",
      ],
      skill_scope: ["public", "staff"],
    },
  },
} as const
