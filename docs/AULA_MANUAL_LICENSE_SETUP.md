# Setup manual de llicencies Aula

Executa aquests exemples des del SQL editor de Supabase. Canvia emails, noms i dates abans d'aplicar-los.

## Crear organitzacio i llicencia

```sql
with org as (
  insert into public.aula_organizations (
    name, legal_name, city, province, contact_email, billing_email, allowed_domains
  )
  values (
    'Institut Exemple',
    'Institut Exemple',
    'Vic',
    'Barcelona',
    'coordinacio@institutexemple.cat',
    'facturacio@institutexemple.cat',
    array['institutexemple.cat']::text[]
  )
  returning id
)
insert into public.aula_licenses (
  organization_id, plan, status, starts_at, ends_at, max_teachers,
  max_participants_per_session, features
)
select
  org.id,
  'pilot',
  'trial',
  current_date,
  current_date + 30,
  2,
  30,
  app_private.aula_plan_features('pilot')
from org;
```

## Convidar docent

```sql
insert into public.aula_teachers (
  organization_id, email, full_name, role, status
)
select id, 'docent@institutexemple.cat', 'Docent Exemple', 'teacher', 'invited'
from public.aula_organizations
where name = 'Institut Exemple';
```

## Crear primer admin Camicurt

Primer, l'usuari ha d'existir a `auth.users` despres d'haver fet login magic link una vegada.

```sql
insert into public.aula_organizations (name, legal_name, status)
values ('Camicurt', 'Camicurt', 'active')
returning id;
```

```sql
insert into public.aula_licenses (
  organization_id, plan, status, starts_at, ends_at, max_teachers, features
)
select id, 'centre', 'active', current_date, current_date + 3650, 10,
       app_private.aula_plan_features('centre')
from public.aula_organizations
where name = 'Camicurt';
```

```sql
insert into public.aula_teachers (
  organization_id, user_id, email, full_name, role, status, activated_at
)
select
  o.id,
  u.id,
  u.email,
  'Admin Camicurt',
  'camicurt_admin',
  'active',
  now()
from public.aula_organizations o
cross join auth.users u
where o.name = 'Camicurt'
  and u.email = 'admin@example.com';
```

## Suspendre llicencia

```sql
update public.aula_licenses
set status = 'suspended'
where id = '00000000-0000-0000-0000-000000000000';
```

## Renovar llicencia

```sql
update public.aula_licenses
set ends_at = current_date + 365,
    status = case when status = 'expired' then 'active' else status end,
    billing_reference = 'FACT-2026-001'
where id = '00000000-0000-0000-0000-000000000000';
```

## Consultar registre

```sql
select
  o.name,
  l.plan,
  l.status,
  l.starts_at,
  l.ends_at,
  count(t.*) filter (where t.status = 'active') as docents_actius
from public.aula_licenses l
join public.aula_organizations o on o.id = l.organization_id
left join public.aula_teachers t on t.organization_id = o.id
group by o.name, l.id
order by l.created_at desc;
```
