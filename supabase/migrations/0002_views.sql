-- Product and reliability metrics for the weekly review. All views read the service-role tables.

create or replace view v_turns_daily as
with thumbs as (
  select date_trunc('day', fm.created_at) as day, count(*) as thumbs_down
  from feedback f join messages fm on fm.id = f.message_id
  where f.rating = 'down'
  group by 1
),
turns as (
  select
    date_trunc('day', m.created_at) as day,
    count(*) as turns,
    count(*) filter (where m.response_kind = 'answer') as answers,
    count(*) filter (where m.response_kind in ('not_covered', 'out_of_scope')) as not_covered,
    count(*) filter (where m.response_kind = 'emergency') as emergencies,
    count(*) filter (where m.response_kind = 'refusal') as refusals,
    count(*) filter (where m.response_kind = 'validation_failed') as validation_failures,
    count(*) filter (where m.response_kind = 'error') as errors,
    count(*) filter (where m.fallback_ran) as fallbacks,
    percentile_cont(0.95) within group (order by m.ttfb_ms) filter (where m.ttfb_ms is not null) as ttft_p95_ms,
    percentile_cont(0.95) within group (order by m.latency_ms) filter (where m.model is not null) as total_p95_ms,
    case when sum(coalesce(m.cache_read_input_tokens, 0) + coalesce(m.input_tokens, 0) + coalesce(m.cache_creation_input_tokens, 0)) > 0
      then sum(coalesce(m.cache_read_input_tokens, 0))::numeric
           / sum(coalesce(m.cache_read_input_tokens, 0) + coalesce(m.input_tokens, 0) + coalesce(m.cache_creation_input_tokens, 0))
      else null end as cache_hit_rate,
    sum(
      coalesce(m.input_tokens, 0) * p.input_per_mtok
      + coalesce(m.output_tokens, 0) * p.output_per_mtok
      + coalesce(m.cache_read_input_tokens, 0) * p.cache_read_per_mtok
      + coalesce(m.cache_creation_input_tokens, 0) * p.cache_write_1h_per_mtok
    ) / 1000000.0 as cost_usd
  from messages m
  left join model_prices p on m.model like p.model || '%'
  where m.role = 'assistant'
  group by 1
)
select t.*, coalesce(th.thumbs_down, 0) as thumbs_down
from turns t
left join thumbs th on th.day = t.day
order by t.day desc;

create or replace view v_not_covered_by_program as
select
  date_trunc('month', m.created_at) as month,
  coalesce(mc.program_number, 0) as related_program,
  count(distinct m.id) as turns,
  (array_agg(m.display_text order by m.created_at desc))[1:5] as sample_questions
from messages m
join messages q on q.conversation_id = m.conversation_id and q.turn_index = m.turn_index - 1 and q.role = 'user'
left join message_citations mc on mc.message_id = m.id
where m.role = 'assistant' and m.response_kind in ('not_covered', 'out_of_scope')
group by 1, 2
order by 1 desc, 3 desc;

create or replace view v_program_volume as
select
  date_trunc('week', m.created_at) as week,
  mc.program_number,
  count(distinct m.id) as turns
from messages m
join message_citations mc on mc.message_id = m.id
where m.role = 'assistant'
group by 1, 2
order by 1 desc, 3 desc;

create or replace view v_review_backlog as
select f.id, f.created_at, f.source, f.rating, f.flag, f.comment, f.status,
       m.response_kind, m.display_text as answer, m.manual_version_id, m.prompt_version
from feedback f
join messages m on m.id = f.message_id
where f.status = 'new'
order by f.created_at;
