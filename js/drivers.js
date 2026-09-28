// ---------------------------------------------------------------------------
// COUCHE D'APPAREILS — clairement séparée de l'application.
//
// Un "driver" est un objet avec (tous optionnels sauf attach) :
//   attach(store)            appelé une fois au démarrage
//   send(device, patch)      l'utilisateur/une scène change un appareil : à
//                            transmettre au matériel réel (HA, MQTT, Matter…)
//   step(dt)                 appelé chaque seconde (simulation uniquement)
//
// Pour un appareil réel, le driver appelle en retour :
//   store.setDevice(id, patch, { source: 'driver' })   changement discret
//   store.patchLive(id, patch)                          valeur continue
//
// Ci-dessous : SimulatedDriver, qui fait vivre la maison (thermique, porte de
// garage, détecteurs, humidité, piscine). Voir README.md pour brancher
// Home Assistant.
// ---------------------------------------------------------------------------

const OUTDOOR_TEMP = 12; // °C extérieur simulé

export class SimulatedDriver {
  constructor() { this.store = null; this.nextEvent = 40; }
  attach(store) { this.store = store; }
  send() { /* simulation : l'état est déjà à jour dans le store */ }

  step(dt) {
    const S = this.store;
    const st = S.state;

    // --- Thermique : chaque pièce chauffée tend vers sa consigne ------------
    st.devices.filter((d) => d.type === 'thermostat').forEach((d) => {
      const s = d.state;
      let heating = s.heating;
      if (s.mode === 'off') heating = false;
      else if (s.current < s.target - 0.15) heating = true;
      else if (s.current >= s.target + 0.05) heating = false;
      let cur = s.current;
      const ac = S.devicesIn(d.roomId).find((x) => x.type === 'ac' && x.state.on);
      if (heating) cur += 0.06 * dt;
      else cur += (OUTDOOR_TEMP + 7 - cur) * 0.0025 * dt; // déperdition lente
      if (ac) cur += (ac.state.target - cur) * 0.03 * dt;
      S.patchLive(d.id, { current: Math.round(cur * 100) / 100, heating });
    });

    // --- Capteur salle de bain : le sèche-serviettes chauffe/sèche --------------
    st.devices.filter((d) => d.type === 'temp').forEach((d) => {
      const heater = S.devicesIn(d.roomId).find((x) => x.type === 'heater' && x.state.on);
      const t = d.state.temperature + ((heater ? 24.5 : 22) - d.state.temperature) * 0.01 * dt;
      const h = Math.min(85, Math.max(35, d.state.humidity + (Math.random() - 0.5) * 0.6 + (heater ? -0.05 : 0.0)));
      S.patchLive(d.id, { temperature: Math.round(t * 10) / 10, humidity: Math.round(h * 10) / 10 });
    });

    // --- Porte de garage : 4 s pour une course complète --------------------------
    st.devices.filter((d) => d.type === 'garage').forEach((d) => {
      const s = d.state; const diff = s.target - s.position;
      if (Math.abs(diff) > 0.01) S.patchLive(d.id, { position: Math.abs(diff) < 25 * dt ? s.target : s.position + Math.sign(diff) * 25 * dt });
    });

    // --- Piscine : l'eau tend (lentement) vers la consigne -----------------------
    st.devices.filter((d) => d.type === 'pool').forEach((d) => {
      const s = d.state;
      const t = s.temperature + ((s.pump ? s.target : 18) - s.temperature) * 0.004 * dt;
      S.patchLive(d.id, { temperature: Math.round(t * 100) / 100 });
    });

    // --- Détecteurs : retombée automatique -------------------------------------
    st.devices.filter((d) => d.type === 'motion' && d.state.detected && Date.now() > d.state.detectedUntil).forEach((d) => {
      S.setDevice(d.id, { detected: false }, { source: 'driver' });
    });

    // --- Événements aléatoires (option) ----------------------------------------------
    if (st.settings.simulateEvents) {
      this.nextEvent -= dt;
      if (this.nextEvent <= 0) {
        this.nextEvent = 45 + Math.random() * 60;
        const sensors = st.devices.filter((d) => d.type === 'motion');
        const d = sensors[Math.floor(Math.random() * sensors.length)];
        if (d) S.setDevice(d.id, { detected: true }, { source: 'driver' });
      }
    }
  }
}
