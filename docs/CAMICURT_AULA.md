# Camicurt Aula

## Arquitectura

Camicurt Aula es una capa educativa privada sobre el joc public existent.

- `/` continua carregant el joc public sense login.
- `/aula` carrega la landing comercial i el shell Aula.
- Docents: Supabase Auth amb magic link i RPC `aula_claim_teacher`.
- Llicencies: registres vinculats a `aula_organizations`, no codis compartibles.
- Alumnat: sense compte, entra amb `join_code` temporal i token de participant.
- Resultats d'alumnat: Edge Function `aula-session` amb service role nomes al backend.

La migracio `202605140001_aula_schema.sql` crea les taules Aula, RLS, helpers a `app_private`, wrappers RPC publics, seeds de reptes i materials inicials.

## Taules principals

- `aula_organizations`: centres.
- `aula_licenses`: plans, estat, dates, limits i features.
- `aula_teachers`: docents convidats o actius.
- `aula_license_events`: registre comercial i d'activacio.
- `aula_challenge_packs` i `aula_challenges`: reptes preparats.
- `aula_sessions`: sessions amb codi temporal.
- `aula_participants`: equips/pseudonims, sense email.
- `aula_results`: resultats de sessio.
- `aula_materials`: materials docents.
- `aula_audit_logs`: accions rellevants.

## Seguretat

- No hi ha `service_role` al frontend.
- Les operacions privilegiades viuen en funcions `app_private` amb `security definer`; les RPC publiques nomes fan de wrapper.
- RLS esta activada a totes les taules Aula.
- Els docents nomes llegeixen dades del seu centre amb llicencia activa.
- L'alumnat no te usuari Supabase i no pot llegir taules Aula directament.
- Els tokens d'alumnat es retornen una vegada i es guarden com SHA-256 a `aula_participants`.

Nota: Supabase recomana evitar `security definer` en esquemes exposats. Per aixo les funcions amb privilegis estan a `app_private`; els wrappers publics mantenen el contracte RPC per al frontend.

## Flux docent

1. Pau/admin crea organitzacio i llicencia.
2. Pau/admin convida un docent per email.
3. El docent entra a `/aula/login` i rep un magic link.
4. `/aula/callback` crida `aula_claim_teacher`.
5. Si hi ha llicencia activa, `/aula/panel` mostra el centre i sessions.
6. El docent crea una sessio a `/aula/sessions/new`.
7. El docent obre la sessio i projecta el codi.

## Flux alumne

1. L'equip entra a `/aula/join`.
2. Escriu codi i pseudonim.
3. Edge Function valida sessio, centre i llicencia.
4. Rep un snapshot del repte i token temporal.
5. Juga a `/aula/play/:sessionId`.
6. El resultat s'envia a `POST /aula-session/submit-result`.

## Variables d'entorn

Frontend:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` o `VITE_SUPABASE_ANON_KEY`

Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SERVICE_ROLE_KEY` com a fallback temporal
- `AULA_ALLOWED_ORIGINS` opcional, separat per comes

No afegir secrets reals al repositori.

## Lmits coneguts

- No hi ha pagaments integrats.
- Els materials inicials son HTML imprimible, no PDF.
- La verificacio del resultat (`verified`) queda a `false`; una v2 pot recalcular server-side la ruta trobada.
- El mode Aula reutilitza el joc public amb adaptador, pero mante la validacio d'alumnes i resultats al backend.

## Roadmap v2

- Verificacio server-side completa de rutes.
- Reptes amb normes Aula.
- Informes agregats per grup/classe.
- Materials PDF i diapositives.
- Importacio de classes i rols d'administracio escolar mes granulars.
