#!/usr/bin/env bun
/**
 * Database Cleanup Script
 * 
 * Cleans all leads, conversations, and related data to start fresh.
 * 
 * Usage:
 *   bun run scripts/cleanup-leads.ts
 * 
 * WARNING: This will DELETE ALL data! Make sure you have a backup if needed.
 */

import { createClient } from '@supabase/supabase-js';

// Get environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing required environment variables:');
  console.error('  - NEXT_PUBLIC_SUPABASE_URL');
  console.error('  - SUPABASE_SECRET_KEY');
  console.error('\nMake sure .env.local is properly configured.');
  process.exit(1);
}

// Create Supabase admin client
const supabase = createClient(supabaseUrl, supabaseKey);

// Tables to truncate (in order respecting foreign keys)
const tablesToTruncate = [
  'lead_brief_revisions',
  'messages',
  'lead_events',
  'webhook_idempotency',
  'dead_letter_events',
  'lead_briefs',
  'conversations',
  'memory_snapshots',
  'customer_identities',
  'customers'
];

async function main() {
  console.log('🧹 Starting database cleanup...\n');
  console.log('⚠️  WARNING: This will DELETE ALL data from the following tables:');
  tablesToTruncate.forEach(table => console.log(`   - ${table}`));
  console.log('\n💾 Tables that will be KEPT:');
  console.log('   - admin_users');
  console.log('   - accounts');
  console.log('   - account_members');
  console.log('   - channel_integrations');
  console.log('   - projects');
  console.log('\n');

  // Confirm deletion
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise<string>(resolve => {
    rl.question('❓ Are you sure you want to continue? Type "YES" to confirm: ', resolve);
  });
  rl.close();

  if (answer !== 'YES') {
    console.log('\n❌ Cleanup cancelled.');
    process.exit(0);
  }

  console.log('\n🗑️  Deleting data...\n');

  let totalDeleted = 0;

  for (const table of tablesToTruncate) {
    try {
      // Get count before deletion
      const { count: beforeCount } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

      // Truncate table using RPC call (Supabase doesn't support TRUNCATE via REST)
      // We'll delete all rows instead
      const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');

      if (error) {
        console.error(`❌ Error truncating ${table}: ${error.message}`);
        continue;
      }

      // Get count after deletion
      const { count: afterCount } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

      const deleted = (beforeCount || 0) - (afterCount || 0);
      totalDeleted += deleted;

      console.log(`✓ ${table.padEnd(25)} Deleted: ${deleted.toLocaleString()} rows`);
    } catch (error) {
      console.error(`❌ Error truncating ${table}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log('\n✅ Cleanup complete!');
  console.log(`📊 Total rows deleted: ${totalDeleted.toLocaleString()}`);

  // Verify cleanup
  console.log('\n🔍 Verifying cleanup...\n');

  for (const table of tablesToTruncate) {
    const { count } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });

    const status = count === 0 ? '✓' : '⚠️';
    console.log(`${status} ${table.padEnd(25)} ${count?.toLocaleString() || 0} rows remaining`);
  }

  console.log('\n✨ Database is now clean and ready for fresh data!');
}

// Run the script
main().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
