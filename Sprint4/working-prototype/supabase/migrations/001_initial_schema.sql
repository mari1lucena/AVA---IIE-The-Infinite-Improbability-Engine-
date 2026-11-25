-- II ∞ — Initial Database Schema
-- Version: 1.0
-- Date: 2026-08-12
--
-- This schema supports:
-- - Multi-clinic SaaS model
-- - Google Calendar sync
-- - AI agent conversations
-- - Cascade slot recovery
-- - Human escalation queue

-- ============================================
-- EXTENSIONS
-- ============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable RLS (Row Level Security)
-- ALTER DATABASE postgres SET "app.jwt_secret" TO 'your-jwt-secret';

-- ============================================
-- TABLES
-- ============================================

-- --------------------------------------------
-- Clinics
-- --------------------------------------------
CREATE TABLE clinics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL, -- Used in booking URL: /book/[slug]
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,

  -- Google Calendar integration
  google_calendar_id TEXT, -- Primary calendar ID
  google_refresh_token TEXT, -- OAuth refresh token (encrypted)
  calendar_sync_enabled BOOLEAN DEFAULT false,
  last_calendar_sync TIMESTAMPTZ,

  -- SMS config (for future Twilio integration)
  sms_sender_number TEXT, -- Twilio number
  sms_enabled BOOLEAN DEFAULT false,

  -- Cascade settings
  cascade_cutoff_hours INTEGER DEFAULT 2, -- Stop offering slots 2h before
  cascade_max_attempts INTEGER DEFAULT 3, -- Max patients to offer per slot

  -- Billing
  subscription_status TEXT DEFAULT 'trial', -- trial / active / cancelled
  subscription_plan TEXT DEFAULT 'basic', -- basic / premium

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- --------------------------------------------
-- Staff (clinic employees)
-- --------------------------------------------
CREATE TABLE staff (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

  -- Auth (uses Supabase Auth)
  auth_user_id UUID UNIQUE, -- Links to auth.users
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,

  -- Role
  role TEXT NOT NULL DEFAULT 'receptionist', -- admin / receptionist / doctor

  -- Status
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast clinic lookups
CREATE INDEX idx_staff_clinic_id ON staff(clinic_id);
CREATE INDEX idx_staff_auth_user_id ON staff(auth_user_id);

-- --------------------------------------------
-- Patients
-- --------------------------------------------
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

  -- Basic info
  name TEXT NOT NULL,
  phone TEXT NOT NULL, -- Primary contact (for SMS)
  email TEXT,
  date_of_birth DATE,

  -- Notes
  medical_notes TEXT, -- Doctor notes (RGPD sensitive)
  reception_notes TEXT, -- "Prefers morning slots", "Diabetic", etc.

  -- Behavioral flags (for cascade ranking)
  no_show_count INTEGER DEFAULT 0,
  last_no_show_date DATE,
  prefers_early_slots BOOLEAN DEFAULT false,
  accepts_short_notice BOOLEAN DEFAULT true, -- Willing to take same-day offers

  -- Status
  is_active BOOLEAN DEFAULT true, -- False = archived patient

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_patients_clinic_id ON patients(clinic_id);
CREATE INDEX idx_patients_phone ON patients(phone); -- For SMS lookups
CREATE INDEX idx_patients_name ON patients(name); -- For search

-- --------------------------------------------
-- Doctors (optional - clinics might have multiple)
-- --------------------------------------------
CREATE TABLE doctors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  specialty TEXT, -- "Clínico Geral", "Cardiologia", etc.
  email TEXT,

  -- Google Calendar (if doctor has separate calendar)
  google_calendar_id TEXT,

  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_doctors_clinic_id ON doctors(clinic_id);

-- --------------------------------------------
-- Slots (appointments)
-- --------------------------------------------
CREATE TABLE slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

  -- Timing
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,

  -- Doctor
  doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL,
  doctor_name TEXT, -- Fallback if no doctor_id

  -- Patient
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'available',
    -- available: open slot
    -- booked: patient confirmed
    -- pending_confirmation: booked but not confirmed
    -- cancelled: patient cancelled
    -- no_show: patient didn't show up
    -- completed: appointment happened
    -- offered: cascade is offering this slot to someone

  -- Cascade tracking
  original_patient_id UUID REFERENCES patients(id), -- Who cancelled/no-showed
  cascade_level INTEGER DEFAULT 0, -- 0 = original, 1+ = refilled N times
  refilled_from TEXT, -- Human-readable: "26 ago, 10:30" or "lista de espera"

  -- Google Calendar sync
  google_event_id TEXT, -- Calendar event ID
  last_synced_at TIMESTAMPTZ,

  -- Booking metadata
  booked_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,

  -- Notes
  notes TEXT, -- "Follow-up for blood test results"

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_slots_clinic_id ON slots(clinic_id);
CREATE INDEX idx_slots_patient_id ON slots(patient_id);
CREATE INDEX idx_slots_doctor_id ON slots(doctor_id);
CREATE INDEX idx_slots_start_time ON slots(start_time);
CREATE INDEX idx_slots_status ON slots(status);
CREATE INDEX idx_slots_google_event_id ON slots(google_event_id);

-- Composite index for cascade queries (find available slots after a given time)
CREATE INDEX idx_slots_cascade_lookup ON slots(clinic_id, start_time, status);

-- --------------------------------------------
-- Cascade Offers
-- --------------------------------------------
CREATE TABLE cascade_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

  -- Which slot is being offered
  slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,

  -- To whom
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,

  -- Offer details
  offered_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL, -- Usually slot.start_time - cascade_cutoff_hours

  -- Status
  status TEXT NOT NULL DEFAULT 'pending',
    -- pending: waiting for response
    -- accepted: patient said yes
    -- declined: patient said no
    -- expired: cutoff reached, no response
    -- superseded: another patient took the slot first

  -- Response tracking
  responded_at TIMESTAMPTZ,
  response_message TEXT, -- What the patient actually said

  -- Order in cascade
  cascade_step INTEGER NOT NULL, -- 0 = first offer, 1 = second, etc.

  -- SMS tracking (for future Twilio integration)
  sms_message_id TEXT, -- Twilio Message SID

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_cascade_clinic_id ON cascade_offers(clinic_id);
CREATE INDEX idx_cascade_slot_id ON cascade_offers(slot_id);
CREATE INDEX idx_cascade_patient_id ON cascade_offers(patient_id);
CREATE INDEX idx_cascade_status ON cascade_offers(status);

-- --------------------------------------------
-- Conversations (AI agent chat logs)
-- --------------------------------------------
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

  -- Participants
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  assigned_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL, -- If escalated to human

  -- Context
  conversation_type TEXT NOT NULL,
    -- confirmation: day-before confirmation
    -- cascade_offer: offering a freed slot
    -- exam_reminder: follow-up for exam/test
    -- no_show_followup: patient missed appointment
    -- general: patient initiated (should escalate immediately)

  related_slot_id UUID REFERENCES slots(id) ON DELETE SET NULL,
  related_cascade_offer_id UUID REFERENCES cascade_offers(id) ON DELETE SET NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'active',
    -- active: agent is handling
    -- escalated: handed to human
    -- resolved: conversation ended
    -- abandoned: patient stopped responding

  escalated_at TIMESTAMPTZ,
  escalation_reason TEXT, -- "patient_initiated" / "frustration" / "insurance_issue"

  resolved_at TIMESTAMPTZ,
  resolution_outcome TEXT, -- "booked" / "cancelled" / "no_action" / "other"

  -- Metadata
  message_count INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_conversations_clinic_id ON conversations(clinic_id);
CREATE INDEX idx_conversations_patient_id ON conversations(patient_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_assigned_staff ON conversations(assigned_staff_id);

-- --------------------------------------------
-- Messages (individual messages in conversations)
-- --------------------------------------------
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

  -- Sender
  sender_type TEXT NOT NULL, -- 'agent' / 'patient' / 'staff'
  sender_id UUID, -- NULL for agent, patient_id or staff_id otherwise

  -- Content
  body TEXT NOT NULL,

  -- Metadata
  channel TEXT DEFAULT 'sms', -- 'sms' / 'whatsapp' / 'mock' (dev only)

  -- AI tracking (for agent messages)
  ai_model TEXT, -- "gpt-4o-mini" / "llama-3.1-70b"
  ai_tokens_used INTEGER,
  ai_latency_ms INTEGER,

  -- SMS tracking (for future)
  sms_message_id TEXT, -- Twilio SID
  sms_status TEXT, -- sent / delivered / failed

  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_sent_at ON messages(sent_at);

-- --------------------------------------------
-- Escalation Queue (human reception tasks)
-- --------------------------------------------
CREATE TABLE escalation_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

  -- Related entities
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,

  -- Task details
  priority TEXT NOT NULL DEFAULT 'normal', -- urgent / high / normal / low
  category TEXT NOT NULL,
    -- conversation_takeover: agent escalated
    -- insurance_issue: financial/insurance problem
    -- complaint: patient unhappy
    -- booking_request: patient wants to book (not a follow-up)
    -- other

  description TEXT NOT NULL,

  -- Assignment
  assigned_to UUID REFERENCES staff(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending',
    -- pending: needs attention
    -- in_progress: staff working on it
    -- resolved: completed
    -- dismissed: no action needed

  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_escalation_clinic_id ON escalation_queue(clinic_id);
CREATE INDEX idx_escalation_status ON escalation_queue(status);
CREATE INDEX idx_escalation_assigned_to ON escalation_queue(assigned_to);
CREATE INDEX idx_escalation_priority ON escalation_queue(priority);

-- --------------------------------------------
-- Waiting List
-- --------------------------------------------
CREATE TABLE waiting_list (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL,

  -- Preferences
  preferred_date_start DATE, -- Earliest acceptable date
  preferred_date_end DATE, -- Latest acceptable date
  preferred_time_of_day TEXT, -- 'morning' / 'afternoon' / 'evening' / 'any'
  accepts_short_notice BOOLEAN DEFAULT true,

  -- Priority
  urgency TEXT DEFAULT 'routine', -- urgent / soon / routine
  reason TEXT, -- "Follow-up for exam results", "Routine checkup"

  -- Status
  status TEXT NOT NULL DEFAULT 'active',
    -- active: waiting for slot
    -- offered: cascade offered them a slot
    -- booked: got a slot
    -- cancelled: patient no longer needs
    -- expired: preferences expired

  added_at TIMESTAMPTZ DEFAULT NOW(),
  booked_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_waiting_list_clinic_id ON waiting_list(clinic_id);
CREATE INDEX idx_waiting_list_patient_id ON waiting_list(patient_id);
CREATE INDEX idx_waiting_list_status ON waiting_list(status);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE cascade_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE waiting_list ENABLE ROW LEVEL SECURITY;

-- Staff can only see their own clinic's data
-- (Policies will be added in next migration after testing)

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
CREATE TRIGGER update_clinics_updated_at BEFORE UPDATE ON clinics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_staff_updated_at BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_slots_updated_at BEFORE UPDATE ON slots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_escalation_queue_updated_at BEFORE UPDATE ON escalation_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SEED DATA (for development)
-- ============================================

-- Insert a demo clinic
INSERT INTO clinics (slug, name, phone, email, cascade_cutoff_hours)
VALUES ('clinica-sousa', 'Clínica Sousa', '+351 912 345 678', 'geral@clinicasousa.pt', 2);

-- Get the clinic ID for subsequent inserts
-- (In real deployment, this would be done via app logic)

COMMENT ON TABLE clinics IS 'Multi-tenant clinics using the system';
COMMENT ON TABLE staff IS 'Clinic staff with dashboard access';
COMMENT ON TABLE patients IS 'Patients registered at clinics';
COMMENT ON TABLE slots IS 'Appointment slots - the core scheduling unit';
COMMENT ON TABLE cascade_offers IS 'Tracks each offer made during slot recovery cascade';
COMMENT ON TABLE conversations IS 'AI agent conversation sessions with patients';
COMMENT ON TABLE messages IS 'Individual messages within conversations';
COMMENT ON TABLE escalation_queue IS 'Tasks requiring human receptionist attention';
COMMENT ON TABLE waiting_list IS 'Patients waiting for next available slot';
