# ServerConsole

**Trouvez une GPU avec assez de mémoire libre et ouvrez expériences, terminal et fichiers depuis un même bureau.**

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

[Télécharger](https://github.com/Moguifeng-9119/server-console/releases/latest) · [Issues](https://github.com/Moguifeng-9119/server-console/issues) · [Changelog](CHANGELOG.md)

![CI](https://github.com/Moguifeng-9119/server-console/actions/workflows/ci.yml/badge.svg)
![MIT](https://img.shields.io/badge/license-MIT-0891b2)

## Nouveautés de 0.18.0

- La collecte GPU, système et processus par niveaux est reliée au véritable ordonnanceur. Valeurs inconnues, horodatages et interruptions sont conservés. La vue générale garde quatre jauges GPU par ligne.

- Les espaces de travail enregistrent serveur, dossier, GPU, tmux, journaux et services. Recherche et division du terminal ainsi que raccourcis fichiers préservent le contexte.

- Codes de sortie et résultats d’arrêt suivent l’exécution distante. L’identité de démarrage protège contre la réutilisation des PID. Le mode hors ligne alimente alertes et résumé mobile.

- Historique de 30 minutes, 1 heure, 12 heures, 1 jour et 1 semaine, comparaison GPU, disque/réseau, exports et événements. Données brutes conservées 24 heures, synthèses 30 jours, puis nettoyées.

- Tâches, journaux incrémentaux, disponibilité GPU, règles, conteneurs et tunnels. Slurm fournit travaux, détails et journaux en lecture seule si le serveur le permet.

- Vérifiez changements et exclusions avant synchronisation. L’envoi à l’enregistrement distingue attente, transfert, réussite et échec ; la date de réussite suit la fin du transfert.

- Diagnostic et sauvegarde de configuration sans identifiants pour récupération et migration. Webhooks HTTPS facultatifs, désactivés par défaut. Collecteur sans interface démarré séparément pour garder l’historique bureau fermé.

[0.18.1 release notes](docs/RELEASE-v0.18.1.md) · [Validation](docs/VALIDATION-0.18.1.md) · [Workspaces / tools guide](docs/WORKBENCH-GUIDE.md)

## Démarrage

Choisissez un paquet joint aux Releases. Windows est non signé et SmartScreen peut avertir. Comparez son SHA-256 au fichier de la même version. macOS/Linux dépendent des workflows et fichiers effectivement publiés.

Ajoutez ou importez SSH, vérifiez l’empreinte, puis ouvrez la vue générale ou l’espace de travail. GPU requiert nvidia-smi, le système Linux /proc. La mémoire libre ne réserve aucune ressource.

[Detailed usage and recovery](docs/USER-GUIDE.md) · [Security](SECURITY.md) · [Headless collector](docs/HEADLESS-MONITOR.md)

## Développement

```sh
git clone https://github.com/Moguifeng-9119/server-console.git
cd server-console
npm ci
npm run dev
```

Le navigateur affiche une démo simulée identifiée. SSH, terminal et SFTP réels nécessitent Electron.

```sh
npm run electron:dev
```

React 18 · TypeScript · Electron · Vite · ssh2 · SQLite. [package.json](package.json) · [Architecture](docs/ARCHITECTURE.md)

```sh
npm run lint
npm run typecheck
npm test
npm run smoke
npm run build
npm run test:ui
npm run test:workflow
```

## Validation et portée

Le registre actuel donne commandes, résultats et contrôles en attente. Deux hôtes Linux réels ont testé flux GPU, trois niveaux, compteurs et tâche dédiée sortant avec le code 7. Cela ne valide pas une flotte, les transferts 100Go, Slurm/MIG réels ni tous les installateurs.

[Current validation ledger](docs/VALIDATION-0.18.1.md) · [Packaging workflow](.github/workflows/package.yml) · [Benchmark methodology](docs/BENCHMARKS.md)

## Langues et guides

Application et README en dix langues. Les traductions assistées nécessitent une révision native. Les sorties distantes gardent leur langue. Les images montrent des simulations de versions antérieures.

![GPU overview — historical simulated example](assets/screenshots/gpu-even-0.13.1-en.png)

[Localization](docs/LOCALIZATION.md) · [Contributing](CONTRIBUTING.md) · [MIT](LICENSE)
