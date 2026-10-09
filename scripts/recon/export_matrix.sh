#!/bin/sh
# The two reads text_match.py needs. Run from the repo root with the DB tunnel up.
set -e
D="$(dirname "$0")"
export $(grep -E '^DATABASE_URL=' .env.local | head -1)
psql "$DATABASE_URL" -X -t -A -c "
select json_agg(row_to_json(t)) from (
  select c.id, c.mc_number mc, c.mc_variant v, c.product, c.file_name,
         c.file_dimensions dim, c.image_text, c.image_description
  from creatives c
  where c.client_id=8 and c.archived_at is null and c.image_text is not null) t;" > "$D/creatives.json"
psql "$DATABASE_URL" -X -t -A -c "
select json_agg(row_to_json(t)) from (
  select m.id, m.number mc, m.variant v, m.status, m.topic, m.audience,
         case when m.audience is null then 'DRAFT'
              when ch.id is not null then 'AGENTIC' else 'DCO' end axis,
         coalesce(a.product,'') aud_product,
         m.name, m.headline, m.copy1, m.copy2, m.cta, m.disclaimer
  from messages m
   left join audiences a on a.key=m.audience and a.client_id=m.client_id
   left join channels ch on ch.key=m.audience and ch.client_id=m.client_id
  where m.client_id=8 and m.archived_at is null) t;" > "$D/messages.json"
wc -c "$D/creatives.json" "$D/messages.json"
