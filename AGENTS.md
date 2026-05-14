# Instruccions per futurs agents

- No trencar el joc public de `/`; qualsevol canvi a `src/App.jsx` ha de preservar la UI i el comportament existent.
- Tota UI nova de Camicurt Aula ha d'estar en catala.
- No posar mai `service_role`, secrets ni claus privades al frontend.
- Les validacions premium i de llicencia s'han de fer a Supabase o Edge Functions, no a `localStorage`.
- L'alumnat no te compte, email ni usuari Supabase.
- No guardar dades personals d'alumnes; nomes pseudonim o nom d'equip.
- Mantindre migracions additives i no modificar taules publiques existents sense necessitat clara.
- Executar `npm run build` abans de finalitzar canvis de frontend.
- Preferir routing manual senzill per `/aula` mentre no calgui `react-router-dom`.
- Si es toca RLS, revisar que docents nomes poden accedir al seu centre i que alumnes no poden llegir taules directament.
