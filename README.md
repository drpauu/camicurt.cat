# camicurt.cat

## Requisits
- Node.js 18+.
- Fitxer GeoJSON d'entrada a `data/comarques_icgc.geojson` (42 comarques).

## Com posar en marxa
1) Instal.la dependencies:
```
npm install
```

2) Genera el TopoJSON optimitzat:
```
npm run build:map
```

3) Arrenca el servidor de desenvolupament:
```
npm run dev
```

## Tests E2E
```
npx playwright install
npm run test:e2e
```

## Nivells diaris i setmanals
El generador usa la clau de servei de Supabase per inserir nivells a la base de dades.

### Execucio manual
```
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run level:daily
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run level:weekly
```

Opcio equivalent:
```
SUPABASE_URL=... SERVICE_ROLE_KEY=... npm run level:daily
SUPABASE_URL=... SERVICE_ROLE_KEY=... npm run level:weekly
```

Notes:
- `level:daily` assegura els darrers 21 dies (incloent avui).
- `level:weekly` assegura les darreres 4 setmanes (incloent l'actual).
- `level:2025` crea tots els nivells diaris i setmanals del 2025.

### Programacio amb cron (exemple)
```
1 0 * * * cd /Users/pau/Desktop/GitHub/Rumb/Rumb && SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run level:daily
1 0 * * 1 cd /Users/pau/Desktop/GitHub/Rumb/Rumb && SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run level:weekly
```

Opcio equivalent:
```
1 0 * * * cd /Users/pau/Desktop/GitHub/Rumb/Rumb && SUPABASE_URL=... SERVICE_ROLE_KEY=... npm run level:daily
1 0 * * 1 cd /Users/pau/Desktop/GitHub/Rumb/Rumb && SUPABASE_URL=... SERVICE_ROLE_KEY=... npm run level:weekly
```

### Cron gratuit amb GitHub Actions
- El workflow `.github/workflows/cron-levels.yml` crida l'Edge Function cada 5 minuts.
- Defineix el secret `CRON_KEY` al repo i la mateixa clau a Supabase (Secrets de la funcio).
- A Supabase, afegeix `SERVICE_ROLE_KEY` com a secret de la funcio.
- La funcio pre-genera els darrers 21 nivells diaris i les darreres 4 setmanes (incloent l'actual).

### Taules opcionals per millores
```
create table if not exists public.cron_runs (
  run_key text primary key,
  created_at timestamp with time zone default now()
);

create table if not exists public.telemetry_events (
  id uuid primary key default gen_random_uuid(),
  player_id uuid,
  event_type text not null,
  mode text,
  difficulty_id text,
  map_id text,
  start_id text,
  target_id text,
  rule_id text,
  day_key text,
  week_key text,
  payload jsonb,
  created_at timestamp with time zone default now()
);
```

## Notes
- Si el camp del nom no es detecta, pots indicar-lo amb:
```
NAME_FIELD=nom_comar npm run build:map
```
- Si no hi ha `data/comarques_icgc.geojson`, el script combina els GeoJSON de `comarques_repo_git`.
- Les comarques duplicades es fusionen per nom per evitar forats al mapa.
- El fitxer de sortida es crea a `public/catalunya-comarques.topojson`.
