// Generated from Supabase schema on 2026-02-27
// To regenerate: pnpm supabase gen types typescript --project-id dkcohwyxtbdlpvhzuqry > app/types/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      categories: {
        Row: {
          id: string
          name: string
          parent_id: string | null
          description: string | null
          is_auto_created: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          parent_id?: string | null
          description?: string | null
          is_auto_created?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          parent_id?: string | null
          description?: string | null
          is_auto_created?: boolean | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      chunks: {
        Row: {
          id: string
          document_id: string | null
          content: string
          chunk_index: number
          embedding: string | null
          metadata: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          document_id?: string | null
          content: string
          chunk_index: number
          embedding?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          document_id?: string | null
          content?: string
          chunk_index?: number
          embedding?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_log: {
        Row: {
          id: string
          user_id: string | null
          consent_version: string
          accepted: boolean
          ip_address: string | null
          user_agent: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          consent_version: string
          accepted: boolean
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          consent_version?: string
          accepted?: boolean
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_ratings: {
        Row: {
          id: string
          contractor_id: string | null
          rated_by: string | null
          rating: number | null
          comment: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          contractor_id?: string | null
          rated_by?: string | null
          rating?: number | null
          comment?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          contractor_id?: string | null
          rated_by?: string | null
          rating?: number | null
          comment?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractor_ratings_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_ratings_rated_by_fkey"
            columns: ["rated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contractors: {
        Row: {
          id: string
          name: string
          company: string | null
          speciality: string
          phone: string | null
          email: string | null
          notes: string | null
          is_active: boolean | null
          added_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          company?: string | null
          speciality: string
          phone?: string | null
          email?: string | null
          notes?: string | null
          is_active?: boolean | null
          added_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          company?: string | null
          speciality?: string
          phone?: string | null
          email?: string | null
          notes?: string | null
          is_active?: boolean | null
          added_by?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractors_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          id: string
          user_id: string | null
          title: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          title?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          title?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      document_categories: {
        Row: {
          document_id: string
          category_id: string
          confidence: number | null
        }
        Insert: {
          document_id: string
          category_id: string
          confidence?: number | null
        }
        Update: {
          document_id?: string
          category_id?: string
          confidence?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_categories_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          id: string
          uploaded_by: string | null
          title: string | null
          original_filename: string | null
          file_url: string
          file_size_bytes: number | null
          mime_type: string | null
          privacy_level: 'shared' | 'private' | 'privileged'
          doc_type: string | null
          doc_date: string | null
          source_channel: 'web_upload' | 'email_shared' | 'email_private' | null
          processing_status: 'pending' | 'processing' | 'completed' | 'failed' | 'flagged_for_review' | null
          extracted_text: string | null
          ai_summary: string | null
          ai_confidence: number | null
          scrubbed_text: string | null
          created_at: string | null
          processed_at: string | null
        }
        Insert: {
          id?: string
          uploaded_by?: string | null
          title?: string | null
          original_filename?: string | null
          file_url: string
          file_size_bytes?: number | null
          mime_type?: string | null
          privacy_level?: 'shared' | 'private' | 'privileged'
          doc_type?: string | null
          doc_date?: string | null
          source_channel?: 'web_upload' | 'email_shared' | 'email_private' | null
          processing_status?: 'pending' | 'processing' | 'completed' | 'failed' | 'flagged_for_review' | null
          extracted_text?: string | null
          ai_summary?: string | null
          ai_confidence?: number | null
          scrubbed_text?: string | null
          created_at?: string | null
          processed_at?: string | null
        }
        Update: {
          id?: string
          uploaded_by?: string | null
          title?: string | null
          original_filename?: string | null
          file_url?: string
          file_size_bytes?: number | null
          mime_type?: string | null
          privacy_level?: 'shared' | 'private' | 'privileged'
          doc_type?: string | null
          doc_date?: string | null
          source_channel?: 'web_upload' | 'email_shared' | 'email_private' | null
          processing_status?: 'pending' | 'processing' | 'completed' | 'failed' | 'flagged_for_review' | null
          extracted_text?: string | null
          ai_summary?: string | null
          ai_confidence?: number | null
          scrubbed_text?: string | null
          created_at?: string | null
          processed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          id: string
          entity_type: 'asset' | 'contractor' | 'person' | 'contract' | 'rule' | 'decision' | 'promise' | 'event'
          name: string
          properties: Json | null
          discovered_from_document_id: string | null
          is_confirmed: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          entity_type: 'asset' | 'contractor' | 'person' | 'contract' | 'rule' | 'decision' | 'promise' | 'event'
          name: string
          properties?: Json | null
          discovered_from_document_id?: string | null
          is_confirmed?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          entity_type?: 'asset' | 'contractor' | 'person' | 'contract' | 'rule' | 'decision' | 'promise' | 'event'
          name?: string
          properties?: Json | null
          discovered_from_document_id?: string | null
          is_confirmed?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entities_discovered_from_document_id_fkey"
            columns: ["discovered_from_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_mentions: {
        Row: {
          id: string
          entity_id: string | null
          document_id: string | null
          chunk_id: string | null
          context_snippet: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          entity_id?: string | null
          document_id?: string | null
          chunk_id?: string | null
          context_snippet?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          entity_id?: string | null
          document_id?: string | null
          chunk_id?: string | null
          context_snippet?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_mentions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_mentions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_mentions_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "chunks"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_relations: {
        Row: {
          id: string
          entity_a_id: string | null
          entity_b_id: string | null
          relation_type: string
          properties: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          entity_a_id?: string | null
          entity_b_id?: string | null
          relation_type: string
          properties?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          entity_a_id?: string | null
          entity_b_id?: string | null
          relation_type?: string
          properties?: Json | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_relations_entity_a_id_fkey"
            columns: ["entity_a_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relations_entity_b_id_fkey"
            columns: ["entity_b_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_documents: {
        Row: {
          issue_id: string
          document_id: string
        }
        Insert: {
          issue_id: string
          document_id: string
        }
        Update: {
          issue_id?: string
          document_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_documents_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      issues: {
        Row: {
          id: string
          created_by: string | null
          title: string
          description: string | null
          category_id: string | null
          status: 'open' | 'in_progress' | 'resolved' | 'closed' | 'escalated' | null
          severity: 'low' | 'normal' | 'high' | 'critical' | null
          privacy_level: 'shared' | 'private' | 'privileged' | null
          created_at: string | null
          resolved_at: string | null
        }
        Insert: {
          id?: string
          created_by?: string | null
          title: string
          description?: string | null
          category_id?: string | null
          status?: 'open' | 'in_progress' | 'resolved' | 'closed' | 'escalated' | null
          severity?: 'low' | 'normal' | 'high' | 'critical' | null
          privacy_level?: 'shared' | 'private' | 'privileged' | null
          created_at?: string | null
          resolved_at?: string | null
        }
        Update: {
          id?: string
          created_by?: string | null
          title?: string
          description?: string | null
          category_id?: string | null
          status?: 'open' | 'in_progress' | 'resolved' | 'closed' | 'escalated' | null
          severity?: 'low' | 'normal' | 'high' | 'critical' | null
          privacy_level?: 'shared' | 'private' | 'privileged' | null
          created_at?: string | null
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "issues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          id: string
          conversation_id: string | null
          role: 'user' | 'assistant'
          content: string
          source_chunks: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          conversation_id?: string | null
          role: 'user' | 'assistant'
          content: string
          source_chunks?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          conversation_id?: string | null
          role?: 'user' | 'assistant'
          content?: string
          source_chunks?: Json | null
          created_at?: string | null
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
      notices: {
        Row: {
          id: string
          title: string
          content: string
          notice_type: 'general' | 'maintenance' | 'agm' | 'urgent' | 'event' | null
          published_by: string | null
          is_pinned: boolean | null
          expires_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          title: string
          content: string
          notice_type?: 'general' | 'maintenance' | 'agm' | 'urgent' | 'event' | null
          published_by?: string | null
          is_pinned?: boolean | null
          expires_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          title?: string
          content?: string
          notice_type?: 'general' | 'maintenance' | 'agm' | 'urgent' | 'event' | null
          published_by?: string | null
          is_pinned?: boolean | null
          expires_at?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notices_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          id: string
          full_name: string
          email: string
          phone: string | null
          unit_number: string | null
          role: 'super_admin' | 'trustee' | 'lawyer' | 'building_manager' | 'management_co' | 'owner' | 'tenant'
          is_active: boolean | null
          consent_accepted_at: string | null
          consent_ip_address: string | null
          consent_version: string | null
          created_at: string | null
          deactivated_at: string | null
        }
        Insert: {
          id: string
          full_name: string
          email: string
          phone?: string | null
          unit_number?: string | null
          role?: 'super_admin' | 'trustee' | 'lawyer' | 'building_manager' | 'management_co' | 'owner' | 'tenant'
          is_active?: boolean | null
          consent_accepted_at?: string | null
          consent_ip_address?: string | null
          consent_version?: string | null
          created_at?: string | null
          deactivated_at?: string | null
        }
        Update: {
          id?: string
          full_name?: string
          email?: string
          phone?: string | null
          unit_number?: string | null
          role?: 'super_admin' | 'trustee' | 'lawyer' | 'building_manager' | 'management_co' | 'owner' | 'tenant'
          is_active?: boolean | null
          consent_accepted_at?: string | null
          consent_ip_address?: string | null
          consent_version?: string | null
          created_at?: string | null
          deactivated_at?: string | null
        }
        Relationships: []
      }
      timeline_events: {
        Row: {
          id: string
          event_date: string
          title: string
          description: string | null
          event_type: 'agm' | 'rule_change' | 'maintenance' | 'legal' | 'financial' | 'promise' | 'incident' | null
          source_document_id: string | null
          issue_id: string | null
          privacy_level: 'shared' | 'private' | 'privileged' | null
          is_auto_generated: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          event_date: string
          title: string
          description?: string | null
          event_type?: 'agm' | 'rule_change' | 'maintenance' | 'legal' | 'financial' | 'promise' | 'incident' | null
          source_document_id?: string | null
          issue_id?: string | null
          privacy_level?: 'shared' | 'private' | 'privileged' | null
          is_auto_generated?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          event_date?: string
          title?: string
          description?: string | null
          event_type?: 'agm' | 'rule_change' | 'maintenance' | 'legal' | 'financial' | 'promise' | 'incident' | null
          source_document_id?: string | null
          issue_id?: string | null
          privacy_level?: 'shared' | 'private' | 'privileged' | null
          is_auto_generated?: boolean | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timeline_events_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_events_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Convenience type helpers
type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never
