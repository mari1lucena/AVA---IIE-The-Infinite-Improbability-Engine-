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
      cascade_offers: {
        Row: {
          candidate_slot_id: string | null
          cascade_step: number
          clinic_id: string
          created_at: string | null
          expires_at: string
          id: string
          offered_at: string | null
          patient_id: string
          responded_at: string | null
          response_message: string | null
          slot_id: string
          sms_message_id: string | null
          status: string
        }
        Insert: {
          candidate_slot_id?: string | null
          cascade_step: number
          clinic_id: string
          created_at?: string | null
          expires_at: string
          id?: string
          offered_at?: string | null
          patient_id: string
          responded_at?: string | null
          response_message?: string | null
          slot_id: string
          sms_message_id?: string | null
          status?: string
        }
        Update: {
          candidate_slot_id?: string | null
          cascade_step?: number
          clinic_id?: string
          created_at?: string | null
          expires_at?: string
          id?: string
          offered_at?: string | null
          patient_id?: string
          responded_at?: string | null
          response_message?: string | null
          slot_id?: string
          sms_message_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cascade_offers_candidate_slot_id_fkey"
            columns: ["candidate_slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cascade_offers_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cascade_offers_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cascade_offers_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          address: string | null
          agent_custom_instructions: string | null
          agent_language: string
          agent_name: string | null
          agent_signature: string | null
          agent_tone: string
          agent_use_emoji: boolean
          calendar_sync_enabled: boolean | null
          cascade_cutoff_hours: number | null
          cascade_horizon_days: number
          cascade_max_attempts: number | null
          cascade_prefer_furthest: boolean
          created_at: string | null
          email: string | null
          google_calendar_id: string | null
          google_channel_expiration: string | null
          google_channel_id: string | null
          google_connected_at: string | null
          google_connected_email: string | null
          google_refresh_token: string | null
          google_resource_id: string | null
          google_sync_token: string | null
          id: string
          last_calendar_sync: string | null
          name: string
          notify_patient_on_reception_change: boolean
          offer_cooldown_minutes: number
          phone: string | null
          slug: string
          sms_enabled: boolean | null
          sms_sender_number: string | null
          subscription_plan: string | null
          subscription_status: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          agent_custom_instructions?: string | null
          agent_language?: string
          agent_name?: string | null
          agent_signature?: string | null
          agent_tone?: string
          agent_use_emoji?: boolean
          calendar_sync_enabled?: boolean | null
          cascade_cutoff_hours?: number | null
          cascade_horizon_days?: number
          cascade_max_attempts?: number | null
          cascade_prefer_furthest?: boolean
          created_at?: string | null
          email?: string | null
          google_calendar_id?: string | null
          google_channel_expiration?: string | null
          google_channel_id?: string | null
          google_connected_at?: string | null
          google_connected_email?: string | null
          google_refresh_token?: string | null
          google_resource_id?: string | null
          google_sync_token?: string | null
          id?: string
          last_calendar_sync?: string | null
          name: string
          notify_patient_on_reception_change?: boolean
          offer_cooldown_minutes?: number
          phone?: string | null
          slug: string
          sms_enabled?: boolean | null
          sms_sender_number?: string | null
          subscription_plan?: string | null
          subscription_status?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          agent_custom_instructions?: string | null
          agent_language?: string
          agent_name?: string | null
          agent_signature?: string | null
          agent_tone?: string
          agent_use_emoji?: boolean
          calendar_sync_enabled?: boolean | null
          cascade_cutoff_hours?: number | null
          cascade_horizon_days?: number
          cascade_max_attempts?: number | null
          cascade_prefer_furthest?: boolean
          created_at?: string | null
          email?: string | null
          google_calendar_id?: string | null
          google_channel_expiration?: string | null
          google_channel_id?: string | null
          google_connected_at?: string | null
          google_connected_email?: string | null
          google_refresh_token?: string | null
          google_resource_id?: string | null
          google_sync_token?: string | null
          id?: string
          last_calendar_sync?: string | null
          name?: string
          notify_patient_on_reception_change?: boolean
          offer_cooldown_minutes?: number
          phone?: string | null
          slug?: string
          sms_enabled?: boolean | null
          sms_sender_number?: string | null
          subscription_plan?: string | null
          subscription_status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          assigned_staff_id: string | null
          cancel_pending: boolean
          clinic_id: string
          conversation_type: string
          created_at: string | null
          escalated_at: string | null
          escalation_reason: string | null
          had_cancel_nudge: boolean
          id: string
          last_message_at: string | null
          message_count: number | null
          offered_slot_ids: string[] | null
          patient_id: string
          related_cascade_offer_id: string | null
          related_slot_id: string | null
          requested_doctor_id: string | null
          resolution_outcome: string | null
          resolved_at: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          assigned_staff_id?: string | null
          cancel_pending?: boolean
          clinic_id: string
          conversation_type: string
          created_at?: string | null
          escalated_at?: string | null
          escalation_reason?: string | null
          had_cancel_nudge?: boolean
          id?: string
          last_message_at?: string | null
          message_count?: number | null
          offered_slot_ids?: string[] | null
          patient_id: string
          related_cascade_offer_id?: string | null
          related_slot_id?: string | null
          requested_doctor_id?: string | null
          resolution_outcome?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          assigned_staff_id?: string | null
          cancel_pending?: boolean
          clinic_id?: string
          conversation_type?: string
          created_at?: string | null
          escalated_at?: string | null
          escalation_reason?: string | null
          had_cancel_nudge?: boolean
          id?: string
          last_message_at?: string | null
          message_count?: number | null
          offered_slot_ids?: string[] | null
          patient_id?: string
          related_cascade_offer_id?: string | null
          related_slot_id?: string | null
          requested_doctor_id?: string | null
          resolution_outcome?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_related_cascade_offer_id_fkey"
            columns: ["related_cascade_offer_id"]
            isOneToOne: false
            referencedRelation: "cascade_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_related_slot_id_fkey"
            columns: ["related_slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_requested_doctor_id_fkey"
            columns: ["requested_doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      doctors: {
        Row: {
          clinic_id: string
          created_at: string | null
          email: string | null
          google_calendar_id: string | null
          google_channel_expiration: string | null
          google_channel_id: string | null
          google_resource_id: string | null
          google_sync_token: string | null
          id: string
          is_active: boolean | null
          name: string
          specialty: string | null
        }
        Insert: {
          clinic_id: string
          created_at?: string | null
          email?: string | null
          google_calendar_id?: string | null
          google_channel_expiration?: string | null
          google_channel_id?: string | null
          google_resource_id?: string | null
          google_sync_token?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          specialty?: string | null
        }
        Update: {
          clinic_id?: string
          created_at?: string | null
          email?: string | null
          google_calendar_id?: string | null
          google_channel_expiration?: string | null
          google_channel_id?: string | null
          google_resource_id?: string | null
          google_sync_token?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          specialty?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctors_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_queue: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          category: string
          clinic_id: string
          conversation_id: string | null
          created_at: string | null
          description: string
          id: string
          patient_id: string
          priority: string
          resolution_notes: string | null
          resolved_at: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          category: string
          clinic_id: string
          conversation_id?: string | null
          created_at?: string | null
          description: string
          id?: string
          patient_id: string
          priority?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          category?: string
          clinic_id?: string
          conversation_id?: string | null
          created_at?: string | null
          description?: string
          id?: string
          patient_id?: string
          priority?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "escalation_queue_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_queue_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_queue_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_queue_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          ai_latency_ms: number | null
          ai_model: string | null
          ai_tokens_used: number | null
          body: string
          channel: string | null
          conversation_id: string
          delivered_at: string | null
          id: string
          read_at: string | null
          sender_id: string | null
          sender_type: string
          sent_at: string | null
          sms_message_id: string | null
          sms_status: string | null
        }
        Insert: {
          ai_latency_ms?: number | null
          ai_model?: string | null
          ai_tokens_used?: number | null
          body: string
          channel?: string | null
          conversation_id: string
          delivered_at?: string | null
          id?: string
          read_at?: string | null
          sender_id?: string | null
          sender_type: string
          sent_at?: string | null
          sms_message_id?: string | null
          sms_status?: string | null
        }
        Update: {
          ai_latency_ms?: number | null
          ai_model?: string | null
          ai_tokens_used?: number | null
          body?: string
          channel?: string | null
          conversation_id?: string
          delivered_at?: string | null
          id?: string
          read_at?: string | null
          sender_id?: string | null
          sender_type?: string
          sent_at?: string | null
          sms_message_id?: string | null
          sms_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          accepts_short_notice: boolean | null
          clinic_id: string
          created_at: string | null
          date_of_birth: string | null
          email: string | null
          id: string
          is_active: boolean | null
          last_no_show_date: string | null
          medical_notes: string | null
          name: string
          no_show_count: number | null
          opted_out: boolean
          opted_out_at: string | null
          phone: string
          prefers_early_slots: boolean | null
          primary_doctor_id: string | null
          reception_notes: string | null
          updated_at: string | null
        }
        Insert: {
          accepts_short_notice?: boolean | null
          clinic_id: string
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          last_no_show_date?: string | null
          medical_notes?: string | null
          name: string
          no_show_count?: number | null
          opted_out?: boolean
          opted_out_at?: string | null
          phone: string
          prefers_early_slots?: boolean | null
          primary_doctor_id?: string | null
          reception_notes?: string | null
          updated_at?: string | null
        }
        Update: {
          accepts_short_notice?: boolean | null
          clinic_id?: string
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          last_no_show_date?: string | null
          medical_notes?: string | null
          name?: string
          no_show_count?: number | null
          opted_out?: boolean
          opted_out_at?: string | null
          phone?: string
          prefers_early_slots?: boolean | null
          primary_doctor_id?: string | null
          reception_notes?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patients_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_primary_doctor_id_fkey"
            columns: ["primary_doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      slots: {
        Row: {
          booked_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cascade_level: number | null
          clinic_id: string
          confirmed_at: string | null
          created_at: string | null
          doctor_id: string | null
          doctor_name: string | null
          end_time: string
          google_event_id: string | null
          id: string
          last_synced_at: string | null
          notes: string | null
          original_patient_id: string | null
          patient_id: string | null
          refilled_from: string | null
          start_time: string
          status: string
          updated_at: string | null
        }
        Insert: {
          booked_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cascade_level?: number | null
          clinic_id: string
          confirmed_at?: string | null
          created_at?: string | null
          doctor_id?: string | null
          doctor_name?: string | null
          end_time: string
          google_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          notes?: string | null
          original_patient_id?: string | null
          patient_id?: string | null
          refilled_from?: string | null
          start_time: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          booked_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cascade_level?: number | null
          clinic_id?: string
          confirmed_at?: string | null
          created_at?: string | null
          doctor_id?: string | null
          doctor_name?: string | null
          end_time?: string
          google_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          notes?: string | null
          original_patient_id?: string | null
          patient_id?: string | null
          refilled_from?: string | null
          start_time?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "slots_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slots_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slots_original_patient_id_fkey"
            columns: ["original_patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slots_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          auth_user_id: string | null
          clinic_id: string
          created_at: string | null
          email: string
          id: string
          is_active: boolean | null
          last_login: string | null
          name: string
          role: string
          updated_at: string | null
        }
        Insert: {
          auth_user_id?: string | null
          clinic_id: string
          created_at?: string | null
          email: string
          id?: string
          is_active?: boolean | null
          last_login?: string | null
          name: string
          role?: string
          updated_at?: string | null
        }
        Update: {
          auth_user_id?: string | null
          clinic_id?: string
          created_at?: string | null
          email?: string
          id?: string
          is_active?: boolean | null
          last_login?: string | null
          name?: string
          role?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      waiting_list: {
        Row: {
          accepts_short_notice: boolean | null
          added_at: string | null
          booked_at: string | null
          cancelled_at: string | null
          clinic_id: string
          doctor_id: string | null
          id: string
          patient_id: string
          preferred_date_end: string | null
          preferred_date_start: string | null
          preferred_time_of_day: string | null
          reason: string | null
          status: string
          urgency: string | null
        }
        Insert: {
          accepts_short_notice?: boolean | null
          added_at?: string | null
          booked_at?: string | null
          cancelled_at?: string | null
          clinic_id: string
          doctor_id?: string | null
          id?: string
          patient_id: string
          preferred_date_end?: string | null
          preferred_date_start?: string | null
          preferred_time_of_day?: string | null
          reason?: string | null
          status?: string
          urgency?: string | null
        }
        Update: {
          accepts_short_notice?: boolean | null
          added_at?: string | null
          booked_at?: string | null
          cancelled_at?: string | null
          clinic_id?: string
          doctor_id?: string | null
          id?: string
          patient_id?: string
          preferred_date_end?: string | null
          preferred_date_start?: string | null
          preferred_time_of_day?: string | null
          reason?: string | null
          status?: string
          urgency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waiting_list_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiting_list_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiting_list_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_get_agent_route: { Args: never; Returns: Json }
      admin_set_agent_route: { Args: { p_target: string }; Returns: Json }
      agent_context: { Args: { p_conversation_id: string }; Returns: Json }
      agent_escalate: {
        Args: {
          p_category: string
          p_conversation_id: string
          p_priority?: string
          p_reason: string
        }
        Returns: string
      }
      agent_inbound_batch: { Args: { p_message_id: string }; Returns: Json }
      agent_send_message: {
        Args: { p_body: string; p_conversation_id: string }
        Returns: string
      }
      book_slot: {
        Args: { p_conversation_id: string; p_slot_id: string }
        Returns: Json
      }
      booking_cancel: { Args: { p_conversation_id: string }; Returns: Json }
      booking_cancel_dismiss: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      booking_cancel_request: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      booking_decline: { Args: { p_conversation_id: string }; Returns: Json }
      booking_offer_clear: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      cancel_booking: { Args: { p_conversation_id: string }; Returns: Json }
      cascade_expire_advance: {
        Args: { p_clinic_id?: string }
        Returns: Json[]
      }
      cascade_offer_next: { Args: { p_slot_id: string }; Returns: Json }
      cascade_respond_accept: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      cascade_respond_decline: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      confirmation_confirm: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      confirmation_decline: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      confirmations_start: {
        Args: { p_clinic_id?: string; p_target_date?: string }
        Returns: Json[]
      }
      demo_reset: { Args: never; Returns: Json }
      find_availability: {
        Args: { p_conversation_id: string; p_limit?: number }
        Returns: Json
      }
      find_availability_window: {
        Args: {
          p_conversation_id: string
          p_date?: string
          p_doctor_id?: string
          p_from?: string
          p_limit?: number
          p_lock_doctor?: boolean
          p_to?: string
        }
        Returns: Json
      }
      mock_sms_inbound: {
        Args: { p_body: string; p_clinic_slug: string; p_phone: string }
        Returns: string
      }
      mock_sms_roster: { Args: { p_clinic_slug: string }; Returns: Json }
      mock_sms_thread: {
        Args: { p_clinic_slug: string; p_phone: string }
        Returns: Json
      }
      offer_accept: { Args: { p_conversation_id: string }; Returns: Json }
      offer_decline: { Args: { p_conversation_id: string }; Returns: Json }
      patient_opt_in: { Args: { p_conversation_id: string }; Returns: Json }
      patient_opt_out: { Args: { p_conversation_id: string }; Returns: Json }
      patient_set_name: {
        Args: { p_conversation_id: string; p_name: string }
        Returns: Json
      }
      pullforward_offer_next: {
        Args: { p_clinic_id?: string; p_target_date?: string }
        Returns: Json[]
      }
      reception_apply: {
        Args: { p_clinic_id: string; p_notify?: boolean; p_plan: Json }
        Returns: Json
      }
      reception_norm: { Args: { p: string }; Returns: string }
      reception_plan: {
        Args: { p_clinic_id: string; p_command: Json; p_patient_id?: string }
        Returns: Json
      }
      reception_target_status: {
        Args: {
          p_clinic_id: string
          p_doctor_id: string
          p_exclude_patient?: string
          p_start: string
        }
        Returns: Json
      }
      seed_clinic_agenda: {
        Args: { p_clinic_slug: string; p_days?: number; p_start?: string }
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
    Enums: {},
  },
} as const
