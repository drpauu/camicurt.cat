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

## Nivells diaris
El generador usa la clau de servei de Supabase per inserir nivells a la base de dades.

### Base de dades
El schema versionat és a `supabase/migrations/202604300001_daily_calendar_schema.sql`.
Inclou `levels`, `calendar_daily`, `players`, `attempts`, `cron_runs`,
`telemetry_events`, la vista `daily_calendar_public`, índexs i polítiques RLS.

Aplica'l amb Supabase CLI:
```
supabase db push
```

### Execucio manual
```
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run level:daily
```

Opcio equivalent:
```
SUPABASE_URL=... SERVICE_ROLE_KEY=... npm run level:daily
```

Notes:
- `level:daily` assegura els darrers 21 dies (incloent avui).
- `level:2025` crea tots els nivells diaris del 2025.
- `calendar:health` comprova que el calendari públic té nivell per avui i els darrers 21 dies.

### Health check
```
SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run calendar:health
SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run calendar:health -- --days=7
```

### Programacio amb cron (exemple)
```
1 0 * * * cd /Users/pau/Desktop/GitHub/Rumb/Rumb && SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run level:daily
```

Opcio equivalent:
```
1 0 * * * cd /Users/pau/Desktop/GitHub/Rumb/Rumb && SUPABASE_URL=... SERVICE_ROLE_KEY=... npm run level:daily
```

### Cron gratuit amb GitHub Actions
- El workflow `.github/workflows/cron-levels.yml` crida l'Edge Function cada 5 minuts.
- Defineix el secret `CRON_KEY` al repo i la mateixa clau a Supabase (Secrets de la funcio).
- A Supabase, afegeix `SERVICE_ROLE_KEY` com a secret de la funcio.
- La funcio pre-genera els darrers 21 nivells diaris.

## Notes
- Si el camp del nom no es detecta, pots indicar-lo amb:
```
NAME_FIELD=nom_comar npm run build:map
```
- Si no hi ha `data/comarques_icgc.geojson`, el script combina els GeoJSON de `comarques_repo_git`.
- Les comarques duplicades es fusionen per nom per evitar forats al mapa.
- El fitxer de sortida es crea a `public/catalunya-comarques.topojson`.
