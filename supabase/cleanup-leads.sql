-- ============================================
-- DATABASE CLEANUP SCRIPT
-- ============================================
-- Purpose: Clean all leads, conversations, and related data
--          to start fresh without old chat history and API versions
-- 
-- WARNING: This will DELETE ALL data from these tables!
--          Make sure you have a backup if needed.
--
-- Usage: Run in Supabase SQL Editor or via psql
-- ============================================

-- Start transaction for safety
BEGIN;

-- 1. Delete from child tables first (respecting foreign keys)

-- Delete lead brief revisions (child of lead_briefs)
TRUNCATE TABLE public.lead_brief_revisions CASCADE;

-- Delete messages (child of conversations)
TRUNCATE TABLE public.messages CASCADE;

-- Delete lead events (child of conversations)
TRUNCATE TABLE public.lead_events CASCADE;

-- Delete webhook idempotency records (safe to clear)
TRUNCATE TABLE public.webhook_idempotency CASCADE;

-- Delete dead letter events (safe to clear)
TRUNCATE TABLE public.dead_letter_events CASCADE;

-- 2. Delete from main tables

-- Delete lead briefs
TRUNCATE TABLE public.lead_briefs CASCADE;

-- Delete conversations
TRUNCATE TABLE public.conversations CASCADE;

-- Delete memory snapshots (customer memory)
TRUNCATE TABLE public.memory_snapshots CASCADE;

-- Delete customer identities (channel identities)
TRUNCATE TABLE public.customer_identities CASCADE;

-- Delete customers (but keep accounts)
TRUNCATE TABLE public.customers CASCADE;

-- 3. Reset sequences if any (for auto-incrementing IDs)

-- Reset serial sequences (if any exist)
-- Note: UUID tables don't need sequence resets

-- 4. Verify cleanup

-- Check counts (all should be 0)
SELECT 
  'lead_brief_revisions' as table_name, count(*) as row_count FROM public.lead_brief_revisions
UNION ALL
SELECT 'messages', count(*) FROM public.messages
UNION ALL
SELECT 'lead_events', count(*) FROM public.lead_events
UNION ALL
SELECT 'webhook_idempotency', count(*) FROM public.webhook_idempotency
UNION ALL
SELECT 'dead_letter_events', count(*) FROM public.dead_letter_events
UNION ALL
SELECT 'lead_briefs', count(*) FROM public.lead_briefs
UNION ALL
SELECT 'conversations', count(*) FROM public.conversations
UNION ALL
SELECT 'memory_snapshots', count(*) FROM public.memory_snapshots
UNION ALL
SELECT 'customer_identities', count(*) FROM public.customer_identities
UNION ALL
SELECT 'customers', count(*) FROM public.customers;

-- Commit the transaction
COMMIT;

-- ============================================
-- POST-CLEANUP VERIFICATION
-- ============================================
-- Run these queries separately to verify:

-- Check conversations count (should be 0)
-- SELECT count(*) FROM public.conversations;

-- Check lead briefs count (should be 0)
-- SELECT count(*) FROM public.lead_briefs;

-- Check customers count (should be 0)
-- SELECT count(*) FROM public.customers;

-- ============================================
-- OPTIONAL: Keep admin users and accounts
-- ============================================
-- The following tables are NOT truncated:
-- - admin_users (keep admin accounts)
-- - accounts (keep account structure)
-- - account_members (keep member relationships)
-- - channel_integrations (keep integration configs)
-- - projects (keep project templates)
-- ============================================
