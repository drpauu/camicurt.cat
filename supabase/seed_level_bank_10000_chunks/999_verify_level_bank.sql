select count(*) from public.level_bank;

select difficulty_id, count(*)
from public.level_bank
group by difficulty_id
order by difficulty_id;
