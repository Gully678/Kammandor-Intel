-- intel_0028_harvest_seen_content_hash  (net-CHANGED detection + typed signals)
alter table intel.harvest_seen add column if not exists content_hash text;
alter table intel.harvest_seen add column if not exists kind text;
alter table intel.harvest_seen add column if not exists attributes jsonb;
