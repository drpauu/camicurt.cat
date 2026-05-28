# Aristocracia backoffice

`/aristocracia` és el panell intern de Camicurt per gestionar llicències, status,
xarxes socials i treballadors.

## Crear l'owner inicial

1. Aplica les migracions de Supabase, inclosa `202605280001_aristocracia_backoffice.sql`.
2. Desplega l'Edge Function interna.
3. Executa el setup amb variables d'entorn. No posis la contrasenya en cap fitxer.

```bash
supabase functions deploy aristocracia-admin
```

```bash
SUPABASE_URL="https://PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
ARISTOCRACIA_OWNER_EMAIL="pau@camicurt.cat" \
ARISTOCRACIA_OWNER_PASSWORD="..." \
npm run aristocracia:owner
```

El script crea o actualitza l'usuari de Supabase Auth i vincula el worker intern
`pau@camicurt.cat` amb rol `owner`.

## Accés

- URL: `/aristocracia`
- Usuari inicial: `pau@camicurt.cat`
- Contrasenya: la que s'hagi passat per `ARISTOCRACIA_OWNER_PASSWORD`
- Edge Function: `aristocracia-admin`

## Notes de seguretat

- La contrasenya no es guarda al repo, migracions ni frontend.
- La funció `aristocracia-admin` verifica JWT i rol intern abans d'utilitzar
  `service_role`.
- Les taules `aristocracia_*` tenen RLS i no són llegibles per `anon`.
