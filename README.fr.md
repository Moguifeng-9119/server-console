# ServerConsole

**Trouvez un GPU avec assez de mémoire libre, identifiez son utilisateur et ouvrez terminal ou fichiers dans un même outil de bureau.**

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

[Télécharger](https://github.com/Moguifeng-9119/server-console/releases/tag/v0.13.0) · [Signaler un problème](https://github.com/Moguifeng-9119/server-console/issues)

**0.13.0 :** jauges circulaires par GPU, affichage immédiat du cache, panneaux de fichiers conservés et historique visible : 30 minutes, 1 heure, 12 heures, 1 jour, 1 semaine. SQLite supprime automatiquement les données brutes après 24 heures et les résumés par minute après 30 jours. La collecte fonctionne lorsque l’application est ouverte. Installez `ServerConsole-Setup-0.13.0.exe`. [Validation et capacité](docs/VALIDATION-0.13.0.md)

**Les fichiers Windows ne sont pas signés. SmartScreen peut afficher un avertissement. Comparez le SHA-256 au fichier de la version.**

![Espace GPU : données simulées](assets/screenshots/workbench-en.png)

**Nouveautés de 0.12.0**

Journal persistant pour récupérer et nettoyer les fichiers temporaires de chaque tâche ; progression SHA-256 visible et explication des anciennes tâches. Commandes clavier des fichiers/relais, protection du texte non enregistré et ESLint/Hooks ajoutés. Les dix langues ont 702 clés ; la relecture native de tous les textes assistés par traduction automatique reste à faire.

0.12.2 a validé sur deux serveurs Linux réels un envoi de 16 MiB, rsync, la reprise après arrêt forcé du processus principal, la progression du préfixe et le nettoyage des clés/répertoires appartenant aux tâches. Les chiffres 0.11.1 suivants sont historiques. Portée actuelle : [0.12.2](docs/VALIDATION-0.12.2.md).

![27-second simulated workflow](assets/demo/workflow.gif)

<p><img src="assets/screenshots/relay-en.png" alt="Simulated server relay" width="49%"> <img src="assets/screenshots/transfer-en.png" alt="Simulated resume verification" width="49%"></p>

Les captures montrent v0.12.0 avec des données simulées. v0.12.0 fournit Windows x64 portable, Linux x86_64 AppImage et macOS DMG universel, avec SHA-256. Les paquets ne sont pas signés ; macOS n'est pas notarialisé.

[Detailed usage and recovery (English)](docs/USER-GUIDE.md) · [简体中文](docs/USER-GUIDE.zh-CN.md)

## Fonctionnalités

Un outil personnel pour les serveurs partagés **Linux / NVIDIA GPU**, via SSH sans agent de surveillance distant.

- Filtrer les GiB libres par carte, le modèle et l'utilisateur ; trier par mémoire libre et ouvrir surveillance, terminal ou fichiers.
- Voir processus, plusieurs GPU par PID, CPU Linux par différences de compteurs, fraîcheur et historique horodaté avec lacunes.
- Transferts en file, reprise vérifiée, récupération après redémarrage, rsync direct ou relais SFTP ; import SSH config, groupes, ProxyJump, commandes et redirections de ports.
- Alertes actives/rétablies, deux notifications fermables au maximum ; aucune alerte externe dans la démo.

Pas de comptes d'équipe, réservations, ordonnanceur de cluster, AMD/Intel GPU ni diagnostic NVML complet. La mémoire libre n'est pas une réservation.

## Premiers pas

Téléchargez votre paquet, testez et ajoutez un serveur ou importez SSH config. GPU : nvidia-smi distant ; système : Linux /proc. Pour le code, utilisez Node.js 22 et npm :

```sh
git clone https://github.com/Moguifeng-9119/server-console.git
cd server-console
npm ci
npm run dev
```

Le navigateur affiche une simulation. SSH, identifiants, terminal et SFTP réels nécessitent le processus de bureau :

```sh
npm run electron:dev
```

Choisissez les GiB libres requis par carte, le modèle ou l'utilisateur. Les paramètres sont regroupés ; Ctrl/Cmd+K ouvre la palette. Les principaux dialogues prennent en charge Tab, Shift+Tab, Échap et le retour du focus.

## Transferts et identifiants

- Une cible existante arbitraire n'est jamais un préfixe de reprise : fichier temporaire dédié et comparaison SHA-256 de tout le préfixe.
- SFTP vérifie octets et taille/date de la source avant remplacement, sérialise les cibles conflictuelles et conserve les données de reprise en cas d'échec. Une erreur de nettoyage conserve le dossier de récupération et est signalée.
- Le MD5 optionnel précède le remplacement d'un fichier ; répertoires et relais ne sont pas déclarés vérifiés par MD5.
- Le direct exige rsync aux deux extrémités et une connexion source–destination, avec clé SSH temporaire et empreinte approuvée ; sinon relais SFTP avec staging. Replis tar/scp écrasant directement désactivés.
- Un magasin système sûr chiffre mots de passe et phrases secrètes ; absent ou Linux basic_text, les nouveaux secrets restent uniquement en session et doivent être ressaisis après redémarrage. Les paramètres indiquent le mode réel ; les clés privées restent à leur emplacement.

Taille/date ne verrouillent pas une source modifiée en parallèle. Voir la [sécurité](SECURITY.md) ; rsync réel et nettoyage après interruption ont passé des tests isolés.

## Validation

v0.11.1 a passé, sur chaque OS Windows/Linux/macOS, le typage, 84 tests de régression, le smoke SFTP, le build et 22 contrôles navigateur ; chaque application empaquetée a passé 16 contrôles natifs : IPC, shell SSH local, redimensionnement, redirection et redémarrage authentifié.

DPAPI Windows est réellement testé. macOS utilise MockKeychain, sans preuve pour le vrai Keychain ; l'exécution est sur arm64, pas Intel. Linux vérifie le mode session sans magasin sûr. GPU/MIG physiques, PTY distant complet, rsync/débit en production, magasins macOS/Linux réels, installateurs et mises à jour restent à valider. Le benchmark de 10/30 sessions SSH simulées ne prouve pas une performance de cluster ou une économie en pourcentage.

## Développement

React, TypeScript, Electron, Vite, ssh2 ; versions dans [package.json](package.json) et le lockfile. Commandes :

```sh
npm run lint
npm run typecheck
npm test
npm run smoke
npm run build
npx playwright-core install chromium
npm run test:ui
npm run test:workflow
npm run benchmark
```

SC_ELECTRON_PATH doit viser l'exécutable courant non encapsulé ; lancez npm run e2e:terminal. dist:win:lite, dist:win:nsis, dist:linux et dist:mac désactivent l'auto-publication. Le [CI de paquets](.github/workflows/package.yml) teste avant téléversement. ESLint et React-Hooks sont configurés ; npm run lint est exécuté en CI.

## Langues et participation

README en dix langues ; dix fichiers de clés complets pour l’interface, chargés à la demande. La relecture native de tous les textes reste à faire. [LOCALIZATION](docs/LOCALIZATION.md).

[Validation](docs/VALIDATION-0.11.1.md) · [Méthode de mesure](docs/BENCHMARKS.md) · [Architecture](docs/ARCHITECTURE.md) · [Contribuer](CONTRIBUTING.md) · [Feuille de route](docs/ROADMAP.md) · [Changements](CHANGELOG.md) · [Licence MIT](LICENSE)
