# Ma maison — PWA domotique avec maison 3D

Tableau de bord domotique sombre (verre dépoli) centré sur une **maison 3D interactive**.
Vanilla JS (modules ES), **aucune dépendance** : moteur WebGL2 maison (`js/gl.js`), fonctionne hors ligne.
La base existante (HomeKit 3D Studio : éditeur de plan, BIM, mobilier, jardin, modèles T2/T3/T4) est conservée
intacte dans `editor.html`, accessible via **Menu ⋯ → Éditeur de plan 3D** (et retour « ‹ Ma maison »).

## Lancer
Servir le dossier en HTTP(S) (le service worker exige HTTPS ou localhost) :
`python3 -m http.server 8080` puis ouvrir `http://localhost:8080/`.
iPhone : Safari → Partager → « Sur l’écran d’accueil ». Android/Desktop : Menu ⋯ → « Installer l’application ».
**Ouvrez l’app une fois en ligne** : le service worker met alors tout en cache (dont Three.js pour l’éditeur).

## Structure
| Fichier | Rôle |
|---|---|
| `js/data.js` | **Modèle de données** : house → rooms → devices(state) → scenes → automations (+ décor 3D). JSON pur. |
| `js/catalog.js` | Comportement par type d’appareil (états par défaut, puissance, résumé). |
| `js/store.js` | État, persistance (localStorage), actions, scénarios, moteur d’automatisations, énergie. |
| `js/drivers.js` | **Couche appareils** : `SimulatedDriver` (thermique, garage, détecteurs…) — à remplacer. |
| `js/world.js` | Construit la 3D **à partir des données** (murs déduits des pièces, ouvertures, mobilier). |
| `js/gl.js` | Moteur WebGL2 : éclairage nocturne, halos, murs « maison de poupée », caméra orbitale. |
| `js/house3d.js` | Contrôleur 3D (gestes, pastilles, repères, qualité adaptative) + repli **Plan 2D**. |
| `js/views.js`, `js/sheets.js`, `js/dom.js`, `js/app.js` | Interface : onglets, feuilles de contrôle, éditeurs, démarrage. |
| `js/cams.js` | Flux caméra **simulés** (canvas). |
| `service-worker.js`, `manifest.json`, `icons/` | PWA : cache hors ligne, installation, icônes, écrans de démarrage iPhone/iPad. |
| `tests/` | `node tests/store.test.mjs` (logique), `node tests/world.test.mjs` (géométrie). |

## Modifier les données
Tout se modifie dans l’app (renommer pièce/appareil, ajouter/supprimer un appareil, créer scénarios et
automatisations) ou en **Menu → Exporter / Importer** (JSON). Le décor 3D (`layout.furniture`, `layout.openings`,
rectangles des pièces) est dans le même JSON. Réinitialisation : Menu → Réinitialiser.

## Brancher un vrai système (Home Assistant, MQTT, Matter)
Écrire un driver avec la même interface que `SimulatedDriver` et le passer à `createStore({ driver })` dans `app.js` :
```js
class HADriver {
  attach(store) { this.store = store; this.ws = new WebSocket('ws://HA:8123/api/websocket'); /* auth, subscribe_events */
    this.ws.onmessage = (m) => { /* state_changed → */ store.setDevice(idMap[entity], { on: s.state==='on', brightness: ... }, { source: 'driver' }); }; }
  send(device, patch) { /* appel de service HA : light.turn_on, climate.set_temperature… pour device.id */ }
  // pas de step() : les valeurs continues arrivent via store.patchLive(id, patch)
}
```
Ajouter dans chaque appareil `props.entity` (ex. `light.salon`) pour la correspondance. Caméras : remplacer `drawFeed` (`js/cams.js`) par un `<video>`/`<img>` MJPEG/HLS.

## Limites connues (à connaître)
- Données **simulées** (appareils, énergie historique, caméras) tant qu’aucun driver n’est branché.
- Les automatisations s’exécutent tant que l’app est ouverte (pas de tâche en arrière-plan côté navigateur).
- L’éditeur de plan (`editor.html`) a ses propres données : elles ne sont pas synchronisées avec le tableau de bord.
- Testé dans Chromium (émulation iPhone 17, iPad, bureau) ; **non testé sur un vrai Safari iOS** ni mesuré sur GPU mobile.
