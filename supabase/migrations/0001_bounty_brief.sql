-- Migration: add the producer's brief to bounties (Frontend addendum #2).
-- Run this in the Supabase SQL editor on the existing project.
alter table bounties
  add column if not exists instructions      text,
  add column if not exists deliverable_specs text,
  add column if not exists reference_path    text;
