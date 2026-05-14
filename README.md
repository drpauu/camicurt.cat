# Camicurt: el joc de rutes curtes entre comarques catalanes

<p align="center">
  <img src="logo/header.png" alt="Camicurt" width="760" />
</p>

**Camicurt** és un joc web en català on el repte és connectar una comarca d'**Inici** amb una comarca de **Destí** triant comarques catalanes que permetin formar una ruta contínua. El joc combina geografia, lògica de grafs, normes dinàmiques i progressió per convertir el mapa comarcal en un problema curt, visual i rejugable.

No és només un mapa interactiu: és una experiència de resolució de rutes on cada partida té una solució òptima calculada, una dificultat classificable i una capa de feedback pensada perquè el jugador entengui si s'està acostant a la millor resposta.

---

## Proposta de valor

Camicurt destaca perquè converteix un coneixement aparentment estàtic, les comarques de Catalunya i les seves fronteres, en un sistema de joc amb decisions reals.

| Valor | Què aporta al jugador | Què aporta tècnicament |
| --- | --- | --- |
| **Partides curtes i rejugables** | Cada mapa es resol en pocs minuts i convida a millorar el resultat. | Generació controlada de reptes amb rangs de dificultat i filtres de viabilitat. |
| **Aprenentatge geogràfic natural** | El jugador aprèn quines comarques són veïnes sense una lliçó explícita. | El mapa es modela com un graf d'adjacència a partir de TopoJSON. |
| **Comparació amb l'òptim** | El resultat mostra si la ruta trobada s'acosta al camí més curt. | Dijkstra calcula camins mínims i alternatives òptimes. |
| **Normes que canvien la ruta** | Les partides poden exigir passar per una comarca o evitar-ne una altra. | La cerca de camins incorpora restriccions `mustIncludeAny` i `avoid`. |
| **Progressió sense fricció** | Dificultats, ratxa diària, records i comodins creen continuïtat. | Estat local, Supabase opcional, cache i cues offline per dades de joc. |

---

## En una frase

> Troba el camí més curt entre dues comarques catalanes, respecta la norma de la partida i intenta superar el teu propi resultat amb menys intents i menys temps.

---

## Com es juga

1. **Mira l'objectiu de la partida.**  
   La targeta principal mostra una comarca d'Inici, una comarca de Destí i, si el mode ho requereix, una Norma.

2. **Escriu comarques candidates.**  
   Introdueix noms de comarques al camp de joc. El sistema normalitza i valida el nom escrit, comprova que existeixi i evita repeticions, Inici i Destí.

3. **Construeix una connexió real.**  
   El joc considera les comarques introduïdes com un conjunt de nodes disponibles. Quan aquest conjunt, juntament amb Inici i Destí, permet formar una ruta contínua de veïnatge, la partida pot quedar resolta.

4. **Respecta la norma activa.**  
   Algunes partides obliguen a passar per una comarca o grup de comarques concretes; altres impedeixen passar per una comarca determinada. Si hi ha ruta però la norma no es compleix, el repte continua.

5. **Compara't amb l'òptim.**  
   En completar una partida, Camicurt mostra la teva ruta i un camí òptim calculat pel motor de pathfinding. Això converteix cada final en aprenentatge: no només saps que has arribat, sinó també com podies haver-ho fet millor.

6. **Millora temps, intents i precisió.**  
   El resultat es resumeix amb temps, intents, precisió i diferència respecte al camí més curt.

---

## Objectiu del jugador

L'objectiu principal és **connectar Inici i Destí amb el mínim nombre possible de comarques intermèdies**, respectant la norma de la partida quan n'hi ha.

Una partida perfecta és aquella en què el jugador troba una ruta amb la mateixa longitud que el camí òptim calculat pel joc. En mode Contrarellotge, a més, cal fer-ho abans que s'acabi el temps.

---

## Mecàniques principals

- **Mapa interactiu de Catalunya:** cada comarca és una geometria clicable i estilitzada dins d'un SVG generat amb D3.
- **Entrada per text amb suggeriments:** el jugador escriu el nom de la comarca i rep suggeriments filtrats.
- **Validació estricta de noms:** accents i apòstrofs formen part de la normalització del joc; per exemple, `Val d'Aran` i `Val d Aran` no són equivalents.
- **Feedback visual de qualitat:** les comarques encertades, properes o alienes a la ruta òptima es marquen amb estats diferents.
- **Comodins:** ajudes temporals per revelar un pas, revelar la comarca de referència d'una norma o mostrar inicials.
- **Comparació final:** el jugador pot alternar entre "La teva ruta" i "Un camí òptim".
- **Calendari diari:** els reptes diaris es poden recuperar des d'un calendari amb dies disponibles, completats i bloquejats.
- **Ratxa diària:** completar el repte del dia incrementa la ratxa si el jugador manté continuïtat.
- **Àudio i música opcionals:** efectes per feedback, victòria, error, compte enrere i recompenses, amb pistes musicals configurables.

---

## Modes de joc

### Diari

| Camp | Detall |
| --- | --- |
| **Objectiu** | Resoldre el repte fix del dia. |
| **Com es juga** | El jugador juga una partida associada a una data concreta del calendari. Si el backend Supabase està disponible, el repte surt del calendari públic; si no, el joc pot operar amb generació local segons l'estat disponible. |
| **Què el fa diferent** | És el mode més comparable: tothom juga el mateix repte del dia quan el calendari està publicat. Completar el repte actual alimenta la ratxa diària. |
| **Usuari ideal** | Jugadors recurrents que volen un hàbit diari i una sensació de repte compartit. |

### Normal

| Camp | Detall |
| --- | --- |
| **Objectiu** | Completar una ruta vàlida amb el mínim d'intents possible. |
| **Com es juga** | El joc genera un nou parell Inici-Destí i una norma viable, dins del rang de dificultat seleccionat. |
| **Què el fa diferent** | És el mode base per aprendre el mapa, desbloquejar dificultats i buscar partides perfectes. |
| **Usuari ideal** | Jugadors que volen progressió, repetició i millora incremental. |

### Contrarellotge

| Camp | Detall |
| --- | --- |
| **Objectiu** | Arribar al Destí abans que s'esgoti el temps. |
| **Com es juga** | El mode arrenca amb un compte enrere inicial de 5 segons. El límit de temps es calcula segons la longitud interna del camí òptim: `max(15s, comarquesInternes * 5s)`. |
| **Què el fa diferent** | Afegeix pressió temporal i penalitzacions de temps quan s'utilitzen comodins. |
| **Usuari ideal** | Jugadors que ja coneixen el mapa i volen rapidesa, intuïció i risc. |

### Explora

| Camp | Detall |
| --- | --- |
| **Objectiu** | Practicar rutes llargues sense pressió de temps ni límit estricte d'intents. |
| **Com es juga** | El joc genera reptes amb camins més llargs i sense norma activa. Els comodins tenen usos pràcticament il·limitats. |
| **Què el fa diferent** | És un mode d'entrenament i descoberta: més espai per provar connexions i entendre l'estructura territorial. |
| **Usuari ideal** | Jugadors nous, docents, curiosos del mapa o persones que volen practicar abans dels modes exigents. |

---

## Dificultat i progressió

La dificultat no és arbitrària: es deriva de la longitud del camí òptim, calculada com el nombre de comarques intermèdies entre Inici i Destí.

| Dificultat | Rang de comarques intermèdies òptimes | Ajudes | Boira / pistes |
| --- | ---: | --- | --- |
| **Pixapí** | 0-3 | Més permissiva | Sense boira |
| **Dominguero** | 4-5 | Intermèdia | Sense boira |
| **Rondinaire** | 6-8 | Més exigent | Amb boira i menys pistes |
| **Cap de colla de rutes** | 9+ | Màxima exigència | Amb boira i sense comodins principals |

En mode Normal, una partida perfecta pot desbloquejar la dificultat següent. En mode Diari, completar reptes pot desbloquejar totes les dificultats pendents segons la lògica actual del joc.

### Límit d'intents

El límit d'intents depèn de la dificultat i de la longitud òptima del repte:

| Dificultat | Marge sobre el camí òptim |
| --- | ---: |
| Pixapí | `òptim + 4` |
| Dominguero | `òptim + 3` |
| Rondinaire | `òptim + 1` |
| Cap de colla de rutes | `òptim + 0` |

El mode Explora no aplica aquest límit.

---

## Comodins

| Comodí | Efecte | Penalització en Contrarellotge | Usos segons dificultat |
| --- | --- | ---: | --- |
| **Revela un pas** | Il·lumina temporalment una comarca pendent del camí òptim. | +4s | Pixapí 2, Dominguero 2, Rondinaire 1, Cap de colla 0 |
| **Revelar norma** | Mostra temporalment la comarca o comarques de referència de la norma. | +3s | Pixapí 1, Dominguero 1, Rondinaire 1, Cap de colla 0 |
| **Inicials** | Mostra inicials al mapa durant uns segons. | +2s | Pixapí 2, Dominguero 1, Rondinaire 0, Cap de colla 0 |

En mode Explora, els comodins es tracten com a eines de pràctica i tenen disponibilitat molt alta.

---

## Sistema de puntuació i recompenses

Camicurt no puntua amb una xifra única opaca. El resultat es construeix amb mètriques interpretables:

- **Temps:** durada total de la partida, o temps consumit en Contrarellotge.
- **Intents:** nombre de comarques introduïdes.
- **Camí òptim:** nombre de comarques intermèdies del camí més curt.
- **Camí trobat:** longitud de la ruta que el conjunt d'intents permet formar.
- **Distància respecte a l'òptim:** `camíTrobat - camíÒptim`.
- **Precisió:** `round((òptim / intents) * 100)`, amb valors acotats entre 0 i 100.
- **Perfecte:** s'assoleix quan la distància respecte a l'òptim és 0.
- **Records locals:** es guarden millor temps, millor nombre d'intents i estat perfecte per nivell.
- **Ratxa diària:** es manté si el jugador completa el repte del dia de manera consecutiva.

Quan hi ha una millora personal o un desbloqueig, el joc activa feedback visual i sonor: confeti, efectes de victòria, recompenses i so de desbloqueig.

---

## Experiència d'usuari

La interfície està pensada perquè el jugador entengui el repte sense llegir instruccions llargues.

- **Primera pantalla útil:** el joc carrega directament el mapa i el repte, no una landing page.
- **Tutorial inicial de 4 passos:** objectiu, selecció de comarques, construcció de ruta i comparació amb l'òptim.
- **Capçalera clara:** Inici, Destí i Norma sempre estan visibles com a context de decisió.
- **Mapa com a superfície principal:** zoom, recentrat i estats visuals faciliten llegir la geografia.
- **Panell d'acció compacte:** input, suggeriments, intents i comodins viuen junts.
- **Navegació mòbil específica:** calendari, nou mapa i opcions passen a una barra inferior.
- **Accessibilitat bàsica:** diàlegs amb `role="dialog"`, labels, estats `aria`, focus al camp de joc i botons amb noms explícits.
- **Feedback multimodal:** color, text curt i so opcional reforcen cada acció sense interrompre la partida.

---

## Arquitectura tècnica

Camicurt és una aplicació web construïda amb una arquitectura principalment client-side, amb Supabase com a capa opcional per calendari diari, persistència d'intents i telemetria.

### Frontend

| Peça | Rol |
| --- | --- |
| **React 18** | UI, estat de partida, renderització de modes i resultats. |
| **Vite** | Build modern i separació de chunks per React, D3, TopoJSON i Supabase. |
| **D3 Geo / D3 Selection / D3 Zoom** | Projecció Mercator, paths SVG, zoom i manipulació del mapa. |
| **TopoJSON Client** | Conversió de TopoJSON a features i càlcul d'adjacència entre geometries. |
| **Canvas Confetti** | Celebració visual de final de partida. |
| **Sistema d'àudio propi** | Pools d'efectes, música en bucle, límit de concurrència i configuració per tema. |

### Backend i dades remotes

| Peça | Rol |
| --- | --- |
| **Supabase Auth anònim** | Identifica jugadors sense registre explícit quan Supabase està disponible. |
| **Supabase Postgres** | Desa nivells, calendari diari, jugadors, intents i telemetria. |
| **RLS** | Les polítiques limiten perfils, intents i telemetria al jugador autenticat; el calendari i nivells diaris són públics de lectura. |
| **Edge Function `generate-level`** | Genera i publica nivells diaris protegits amb `CRON_KEY`. |
| **Banc de nivells** | Taula `level_bank` amb candidats pregenerats, gestionada només per `service_role`. |
| **Servidor opcional de leaderboard** | Endpoint Node senzill per GET/POST amb sanitització i rate limit. |

### Persistència local

El joc utilitza `localStorage` per mantenir experiència fluida encara sense backend:

- configuració d'usuari,
- mode i dificultat seleccionats,
- dificultats desbloquejades,
- ratxa diària,
- records locals,
- resultats diaris,
- cache de calendari,
- cache del mapa,
- cues d'intents i telemetria per reintentar quan hi ha connexió.

### Flux principal de l'aplicació

```text
Carrega TopoJSON
  -> converteix geometries a features
  -> calcula adjacència entre comarques
  -> construeix cache de camins mínims en un Web Worker
  -> carrega catàleg de normes
  -> genera o recupera nivell
  -> valida intents del jugador
  -> detecta ruta completa i norma satisfeta
  -> calcula resultat, records, desbloqueigs i persistència
```

---

## Algoritmes i lògica interna

### Model del mapa com a graf

El mapa es tracta com un graf no dirigit:

- cada comarca és un **node**,
- dues comarques amb frontera compartida són una **aresta**,
- el graf es deriva de `topojson-client.neighbors(...)`,
- les geometries provenen de `public/catalunya-comarques.topojson`,
- el fitxer actual conté **41 geometries comarcals**.

La preparació del mapa inclou una fase de normalització prèvia: agrupació per nom de comarca, generació d'`id`, fusió de polígons duplicats i simplificació amb `mapshaper` mantenint formes.

### Camins mínims amb Dijkstra

El motor principal de resolució és `dijkstraAllShortestPaths`.

Fa tres coses rellevants:

1. Calcula la distància mínima entre Inici i Destí.
2. Reconstrueix tots els camins òptims fins a un màxim configurat.
3. Manté un ordre estable amb comparació catalana (`localeCompare("ca")`) per evitar resultats aleatoris quan hi ha empats.

Aquesta informació serveix per:

- saber si el jugador ha completat la ruta,
- mostrar un camí òptim al resultat,
- classificar la dificultat,
- calcular precisió i distància respecte a l'òptim.

### A* com a validació complementària

També existeix una implementació A* (`aStarShortestPath`) amb heurística basada en distància entre centroides de comarques. El resultat es compara amb Dijkstra per comprovar consistència de longitud. Dijkstra continua sent la font de veritat per a tots els camins òptims.

### Cache de pathfinding

Quan l'adjacència està carregada, el joc construeix una cache de camins mínims entre parelles de comarques. Aquesta feina s'envia a un **Web Worker** (`src/workers/path-cache.worker.js`) per no bloquejar la UI.

Si el navegador no suporta workers o hi ha un error, el càlcul cau a una versió síncrona.

### Generació de partides

La generació selecciona:

1. una comarca d'Inici,
2. una comarca de Destí diferent i no adjacent directament,
3. una norma viable si el mode no és Explora,
4. un camí òptim que encaixi en el rang de dificultat objectiu.

El generador intenta trobar una combinació vàlida amb un nombre limitat d'intents. Si no la troba, aplica fallbacks progressius:

- segon bloc de cerca aleatòria,
- recorregut exhaustiu de parelles,
- últim recurs amb les primeres comarques disponibles.

Això evita que el joc quedi encallat si el catàleg de normes o el rang de dificultat no ofereixen prou combinacions.

### Normes de partida

El catàleg actual conté **1.550 normes** versionades a `rules.json`, amb:

- **1.400 normes de tipus `REQUIRE`**,
- **150 normes de tipus `FORBID` / `EXCLUDE`**.

Les normes es normalitzen en dos tipus interns:

| Tipus intern | Significat |
| --- | --- |
| `mustIncludeAny` | La ruta ha de passar per almenys una de les comarques de referència. |
| `avoid` | La ruta no pot passar per les comarques prohibides. |

Les normes genèriques o massa explícites que trencaven el joc queden filtrades per validació:

- regles sense comarques associades,
- textos genèrics com "algun lloc clau",
- normes de grup cultural deshabilitades,
- normes directes que revelen literalment una comarca concreta quan estan marcades com a deshabilitades.

### Pathfinding amb normes

La funció `findShortestPathsWithRule` adapta Dijkstra segons la norma:

- **Sense norma:** camí mínim directe al graf complet.
- **`avoid`:** elimina temporalment nodes prohibits mitjançant un `allowedSet`.
- **`mustIncludeAny`:** calcula camins Inici -> comarca obligada i comarca obligada -> Destí, combina resultats, elimina rutes amb nodes duplicats i conserva les més curtes.

El sistema no accepta una norma només perquè existeixi al catàleg: abans comprova que sigui factible per al parell Inici-Destí.

### Validació de jugades

Quan el jugador envia una comarca:

1. es normalitza el text,
2. es comprova que existeixi,
3. es rebutgen Inici i Destí,
4. es rebutgen repeticions,
5. s'afegeix l'intent a l'historial,
6. es recalcula si el conjunt d'intents permet formar una ruta contínua.

La partida es completa quan:

- existeix un camí entre Inici i Destí dins el conjunt `{Inici, Destí, intents}`,
- i la norma activa està satisfeta.

### Algoritme de dificultat

La dificultat es calcula amb `classifyDifficultyByShortestCount`, a partir del nombre de comarques intermèdies del camí òptim. Aquesta decisió fa que la dificultat sigui explicable i estable: no depèn d'una etiqueta manual, sinó de la distància real dins el graf.

### Algoritme de precisió

La precisió del resultat és:

```text
precisió = round((comarquesIntermèdiesÒptimes / intentsDelJugador) * 100)
```

El valor queda acotat entre 0 i 100. Això premia rutes eficients i penalitza l'exploració excessiva, però sense ocultar les mètriques base.

### Randomització i seeds

El joc utilitza:

- `Math.random` per a partides normals aleatòries,
- `mulberry32(hashString(seed))` per a reptes deterministes com el mode Diari,
- històric de normes per reduir repeticions en reptes diaris,
- banc de nivells pregenerats per assignar calendaris futurs.

---

## Decisions tècniques rellevants

### 1. Graf abans que coordenades

El joc no calcula distàncies sobre latitud i longitud per decidir si una ruta és vàlida. Fa servir veïnatge topològic. Això és clau perquè la pregunta del joc no és "quina comarca és més a prop", sinó "quina comarca toca quina altra".

### 2. Dijkstra com a font de veritat

Dijkstra garanteix camins mínims en un graf no ponderat i permet reconstruir alternatives òptimes. És una decisió adequada perquè totes les arestes tenen el mateix cost: passar d'una comarca a una veïna.

### 3. Worker per al càlcul pesant

La cache de camins mínims pot ser costosa si es calcula per totes les parelles. Desplaçar-la a un Web Worker protegeix la interacció del mapa i evita congelar la UI inicial.

### 4. Supabase com a extensió, no com a dependència dura

La partida pot funcionar amb estat local, però Supabase afegeix calendari públic, intents, telemetria i perfils anònims. Això manté baixa la fricció per al jugador i, alhora, deixa una base escalable per analítica i reptes diaris.

### 5. RLS i claus elevades separades

El calendari públic és llegible, però la gestió del banc de nivells i la creació de nivells diaris queda restringida a `service_role` o Edge Function protegida. Aquesta separació redueix superfície d'abús.

### 6. Assets cachejables i URLs estables

El projecte defineix capçaleres de cache agressives per TopoJSON, `rules.json`, logo, àudio i assets. També manté rutes estables per logo i favicon amb un plugin propi de Vite.

---

## Components principals

| Fitxer / carpeta | Responsabilitat |
| --- | --- |
| `src/App.jsx` | Orquestració principal: estat de joc, modes, calendari, input, resultats, telemetria i UI. |
| `src/lib/pathfinding.js` | Dijkstra, A*, camins amb normes, cache i serialització. |
| `src/lib/difficulty.js` | Classificació de dificultat per longitud del camí òptim. |
| `src/lib/rules.js` | Càrrega, cache i normalització del catàleg de normes. |
| `src/lib/ruleValidation.js` | Validació de fonts de normes i payloads de nivells. |
| `src/lib/geography.js` | Centroides i conjunts de veïns per feedback visual. |
| `src/lib/completion.js` | Registres de completació i selecció del millor intent. |
| `src/lib/settings.js` | Configuració local de tema, música i efectes. |
| `src/workers/path-cache.worker.js` | Construcció de cache de camins en background. |
| `scripts/build-topojson.mjs` | Normalització i optimització del mapa. |
| `scripts/generate-level.mjs` | Generació de nivells, banc, calendaris i reparació de dades. |
| `supabase/functions/generate-level` | Edge Function per publicar nivells diaris. |
| `supabase/migrations` | Esquema SQL, RLS, banc de nivells, RPC i polítiques. |
| `tests` | Tests Playwright de UI, pathfinding, normes, dificultat i layout responsive. |

---

## Flux de dades

```text
TopoJSON + rules.json
  -> React state
  -> graf d'adjacència
  -> generador de nivell
  -> input del jugador
  -> validació de ruta i norma
  -> resultat
  -> localStorage
  -> Supabase / leaderboard opcional
```

La separació important és que el **motor de joc** no depèn directament de la UI. La UI mostra estat i accions; les decisions de ruta, dificultat, norma i resultat viuen en funcions reutilitzables o en blocs ben delimitats.

---

## Escalabilitat i mantenibilitat

- **Afegir comarques o canviar el mapa:** passa per substituir o regenerar el TopoJSON i reconstruir l'adjacència.
- **Afegir normes:** es pot fer ampliant `rules.json`, sempre que cada norma apunti a comarques concretes i superi validació.
- **Afegir dificultats:** cal ampliar rangs a `difficulty.js` i la configuració visual/funcional de dificultats a l'app.
- **Afegir modes:** l'estructura actual permet introduir modes nous modificant generació, condicions de victòria i UI de selecció.
- **Afegir mètriques:** la cua de telemetria i la taula `telemetry_events` ja donen un punt d'entrada.
- **Optimitzar rendiment:** la divisió de chunks i el worker de pathfinding ja separen càrrega inicial, càlcul geogràfic i dependències pesants.

---

## Per què aquest projecte destaca

Camicurt funciona perquè el disseny i la tècnica apunten al mateix objectiu: **fer que la geografia sigui jugable**.

- Té una idea simple d'explicar i difícil d'executar bé.
- El repte no és decoratiu: el mapa és l'estructura real del joc.
- Les normes afegeixen variabilitat sense trencar la lògica del graf.
- La comparació amb l'òptim dona credibilitat tècnica i valor educatiu.
- El mode Diari converteix una mecànica curta en hàbit.
- L'arquitectura separa clarament UI, dades, pathfinding, normes i persistència.
- La base actual ja contempla rendiment, cache, RLS, telemetria i proves automatitzades.

---

## Possibles millores futures

- **Classificacions visibles dins la UI:** el codi ja calcula estadístiques de posició relativa; es podria portar a una pantalla de rànquing completa.
- **Perfils d'usuari més explícits:** avui l'autenticació és anònima quan Supabase està disponible; es podria afegir identitat visible o grups.
- **Editor intern de normes:** una eina per validar i publicar normes sense tocar JSON manualment.
- **Més mapes:** reutilitzar el motor per vegueries, municipis, països o altres territoris.
- **Explicació pedagògica postpartida:** mostrar per què una ruta és òptima i quines fronteres la fan possible.
- **Mode competitiu síncron:** mateix repte, mateix temps, resultats comparats en directe.
- **Analítica agregada:** explotar `telemetry_events` per detectar normes massa difícils, comarques confuses o punts de frustració.
- **Accessibilitat avançada:** mode d'alt contrast, navegació de mapa per teclat i suport complet per lectors de pantalla.
- **Internacionalització:** el sistema de `locales` ja centralitza textos; es podria ampliar a altres llengües.

---

## Assumptions i dades pendents

- `[PENDENT: afegir mètriques reals d'ús]` com usuaris actius, partides jugades o retenció, si existeixen fora del repositori.
- `[PENDENT: afegir captures finals]` si es vol convertir aquest README en material comercial amb screenshots de gameplay, calendari i resultat.
- `[PENDENT: confirmar mapa oficial objectiu]` el TopoJSON actual exposa 41 geometries comarcals; si el producte vol representar el mapa comarcal administratiu més recent, cal validar la font cartogràfica exacta.
- Aquesta documentació descriu el comportament observable al codi actual del repositori. No s'han afegit funcionalitats que no apareguin implementades.

---

## Conclusió

Camicurt és un projecte petit en superfície i sòlid en profunditat: una web de joc ràpida, en català, amb una mecànica clara, una base algorítmica defensable i una arquitectura preparada per créixer.

Per al jugador, és un repte geogràfic curt, intuïtiu i rejugable. Per a un usuari tècnic, és una aplicació que demostra criteri: modelatge amb grafs, pathfinding real, generació controlada de nivells, persistència progressiva, cache, RLS, Edge Functions i una UI pensada per convertir dades territorials en una experiència de joc convincent.

**Camicurt ven una idea senzilla amb una execució tècnica seriosa: trobar el camí curt pot semblar fàcil, però fer-ho bé demana mapa, memòria, estratègia i una mica d'instint.**
