# FLIP RADAR — worker 0.3

Un socle exécutable pour rechercher des objets à revendre en Europe, avec n8n, un navigateur piloté par IA et une base PostgreSQL isolée.

**État exact : le worker 0.2 fonctionne sur Railway avec 36 366 adjudications historiques importées ; cette mise à jour 0.3 est prête à déployer.** La connexion n8n → Railway → Supabase a été validée. Les sources d'annonces actives, les recherches LIVE et les alertes restent désactivées. Aucun achat, paiement, message vendeur ou publication n'est automatisé.

## Mise à jour 0.3 depuis la version 0.2

1. Aucune nouvelle migration SQL : conserver la base et les 36 366 références déjà importées.
2. Remplacer les fichiers du dépôt GitHub par ceux de ce pack, sans supprimer `config/supabase-ca.crt`.
3. Attendre Railway puis vérifier `/health` : `"version":"0.3.0"` et `"status":"up"`.
4. Importer `workflows/FLIP_RADAR_24_PLAN_REFERENCE_FAMILIES.json` dans n8n, sans l'activer.
5. Choisir `FLIP_RADAR_WORKER` dans chacun de ses nœuds HTTP.
6. Lancer une fois avec `transmit_to_hunter=false`, valeur fournie par défaut. Le résultat attendu est `PLAN_ONLY_NOT_TRANSMITTED`.

Le workflow classe les catégories et produits observés dans les adjudications 2024, exclut les catégories réglementées configurées et prépare au maximum cinq missions. Son score s'appelle `historical_research_score` : ce n'est ni une mesure de demande actuelle, ni une probabilité de vente, ni une estimation de profit. Même si quelqu'un change prématurément `transmit_to_hunter=true`, le workflow refuse l'envoi tant que le worker ne confirme pas simultanément LIVE, modèle et source active approuvée.

## Mise à jour 0.2 — ordre obligatoire

1. Dans Supabase SQL Editor, exécuter d'abord `sql/002_reference_sales.sql`.
2. Ensuite seulement, remplacer les fichiers du dépôt GitHub par ceux de ce pack et laisser Railway redéployer.
3. Vérifier `https://flip-radar-production-1c7c.up.railway.app/health` : la réponse doit contenir `"version":"0.2.0"` et `"status":"up"`.
4. Importer `workflows/FLIP_RADAR_23_IMPORT_DNID_REFERENCE.json` dans n8n, sans l'activer.
5. Dans ses deux nœuds HTTP, choisir le credential Header Auth privé `FLIP_RADAR_REVIEW`.
6. Exécuter manuellement une fois. Le workflow attend 30 secondes puis affiche `queued`, `running`, `completed` ou `failed`.

Ne pas inverser les étapes 1 et 2 : le worker 0.2 exige les migrations `001_foundation` et `002_reference_sales` au démarrage. Ne placer aucun mot de passe, token ou clé API dans GitHub ou dans le JSON n8n.

## Commencer maintenant dans n8n

1. Créer un nouveau workflow, puis utiliser **Import from File**.
2. Importer `workflows/FLIP_RADAR_00_SELF_TEST.json`.
3. Cliquer sur **Execute workflow**.
4. Ouvrir le résultat du nœud « Vérifier les 19 cas ».

Résultat attendu : `all_ok: true`, `tests_total: 19`, `external_calls: 0`, `telegram_sent: 0`, `purchases_executed: 0`.

Ce workflow n'a besoin d'aucune clé, ne consulte aucun site et ne touche aucune base. Les annonces, frais et ventes de ce test sont fictifs. Il vérifie le moteur de décision, pas une connexion réelle. Les exports utilisent des nœuds standards ; leur import doit encore être confirmé dans ta version de n8n.

## Ce qui est construit

| Module | Fonction réelle | Limite actuelle |
|---|---|---|
| Web Hunter | L'IA choisit une recherche, ouvre un lien observé, lit, défile, reformule et relève une annonce | Uniquement les domaines explicitement approuvés ; aucun site réel préconfiguré |
| Identification | Référence produit, état supposé, titre et prix accompagnés d'extraits | Hypothèses de l'IA, jamais validation d'authenticité |
| Demande | Score fondé sur ventes confirmées, offre concurrente et délais historiques | Données vérifiées à fournir ; favoris et annonces disparues insuffisants |
| Rentabilité | Coût d'achat complet, revente prudente, frais et provisions, marge et rotation | Estimation, pas bénéfice garanti ni calcul fiscal définitif |
| Base | Missions, annonces, références historiques, revues, opportunités, alertes et décisions | La migration 002 doit encore être exécutée sur ta base distante |
| Alertes | Une opportunité GO par exécution, déduplication, confirmation d'envoi | Telegram à connecter ; aucune notification envoyée pendant la construction |

Vinted, Leboncoin et `own_site` sont des **destinations de calcul**, pas des connecteurs de publication déjà autorisés. Le site de vente n'est pas créé dans cette version. Il n'y a pas encore de découverte automatique de nouveaux domaines, de collecte automatique de ventes confirmées, d'apprentissage sur tes ventes ou de flotte multi-workers testée en charge.

## Organisation du pack

- `workflows/` : neuf workflows générés, tous inactifs et à déclenchement manuel, plus le master Europe déjà configuré.
- `sql/001_foundation.sql` et `sql/002_reference_sales.sql` : schéma privé `flip_radar`, migrations additives et rejouables.
- `src/` : moteur de calcul, agent, adaptateur navigateur, adaptateur Gemini, API et stockage.
- `config/` : modèles de source et de revue, volontairement incomplets et désactivés.
- `docs/DATA_CONTRACT.md` : preuves requises et conventions de calcul.
- `test/` : tests déterministes ; navigateur et modèle simulés, PostgreSQL local PGlite.
- `reports/` : résultats de vérification du pack.

## Branchement du worker — après le SELF TEST

Le worker est un petit service Node.js séparé de n8n. n8n organise les étapes ; le worker héberge Chromium, pilote le modèle et conserve les résultats. Ne pas installer Chromium dans le nœud Code de n8n.

### 1. Base dédiée

Créer une base ou un projet PostgreSQL/Supabase distinct. Ne pas utiliser la base interne de n8n, ni modifier Perlesmania ou House Hunter.

Renseigner `FLIP_RADAR_DATABASE_URL` dans les secrets du worker. Utiliser une connexion PostgreSQL serveur avec droits sur le schéma, pas une clé publique Supabase `anon`. Renseigner le certificat d'autorité via `FLIP_RADAR_DB_CA_FILE` si nécessaire. TLS est vérifié par défaut ; `FLIP_RADAR_DB_SSL=false` est réservé au développement local explicitement choisi.

Dans le code décompressé, après installation des dépendances :

```bash
npm ci
npm run migrate
```

Le script attend les variables déjà injectées par l'hébergeur. Il ne charge pas `.env` automatiquement. En local, un fichier de secrets privé peut être chargé avec `node --env-file=.env scripts/migrate.mjs`. Ne jamais versionner ce fichier.

La migration crée seulement `flip_radar.*`, sans suppression de données. RLS est activé, les droits de `PUBLIC` sont retirés. Le service est prévu pour fonctionner avec le propriétaire de ce schéma privé ; un rôle non propriétaire nécessite ses propres autorisations et politiques RLS. Ne pas exposer le schéma à un client web. L'isolation n'est pas une invitation à réutiliser des identifiants d'un autre projet.

### 2. Hébergement du worker

Un `Dockerfile` est fourni. Il installe les dépendances et Chromium, puis démarre le service en utilisateur non-root. Cette image n'a pas été construite dans cet environnement : Docker n'y est pas disponible.

Prévoir un hébergement compatible avec le sandbox Chromium et de la mémoire pour un navigateur. Si la plateforme refuse le sandbox, arrêter et choisir un environnement compatible ; ne pas ajouter `--no-sandbox` pour forcer le démarrage. Utiliser un réseau dédié, sans accès aux services internes sensibles, avec filtrage des sorties. Les vérifications DNS applicatives ne remplacent pas un pare-feu contre le rebinding et les accès réseau internes.

Variables obligatoires :

| Variable | Où / pourquoi |
|---|---|
| `FLIP_RADAR_DATABASE_URL` | Secret de connexion à la base dédiée |
| `FLIP_RADAR_WORKER_TOKEN` | Secret aléatoire distinct, 32 caractères minimum |
| `FLIP_RADAR_REVIEW_TOKEN` | Autre secret aléatoire ; réservé à la revue humaine |
| `FLIP_RADAR_GEMINI_API_KEY` | Secret du modèle, nécessaire seulement pour une recherche réelle |
| `FLIP_RADAR_GEMINI_MODEL` | Identifiant exact d'un modèle disponible compatible avec le schéma JSON |
| `FLIP_RADAR_LIVE_ENABLED` | Laisser `false` pendant le branchement |
| `FLIP_RADAR_ALERTS_ENABLED` | Laisser `false` jusqu'au test de la destination d'alerte |

Les autres réglages sont dans `.env.example`. Les secrets ne doivent être collés ni dans un workflow JSON, ni dans une page consultée par l'IA, ni dans la conversation. Le modèle retenu ici est un adaptateur Gemini interchangeable ; aucune clé ou souscription n'a été créée.

Le navigateur reçoit un environnement réduit, sans les secrets de la base ou du modèle. Les extraits des pages publiques consultées sont envoyés au fournisseur IA configuré ; les captures d'écran sont optionnelles et désactivées par défaut.

Contrôles : `GET /health` est public et minimal ; `GET /v1/status` exige `Authorization: Bearer <WORKER_TOKEN>` et vérifie la migration. Exposer le worker uniquement en HTTPS derrière le proxy de l'hébergeur. Prévoir quotas/rate limits à l'entrée, quotas du fournisseur IA, journalisation sans secrets et rétention limitée des données.

### 3. Approuver une première source

Copier `config/sources.example.json` dans un fichier privé de configuration de sources. Ne pas activer l'exemple `example.com`.

Pour un vrai domaine : vérifier les conditions d'accès et l'autorisation d'automatisation, puis renseigner l'URL de cette vérification, sa date, le modèle d'URL de recherche, les chemins d'annonces, les pays/devises et les hôtes indispensables. Activer seulement cette source après validation. Le champ `status: approved` est une déclaration de l'opérateur, pas une autorisation accordée par le logiciel.

```bash
node scripts/import-sources.mjs config/sources.reviewed.json
```

L'IA pourra inventer ses requêtes **sur cette source**, mais pas s'autoriser d'autres sites. Au début, une source et une mission à la fois. Une révision d'accès datant de plus de 90 jours bloque la source.

Lecture anonyme uniquement : GET/HEAD, domaines exacts, pas d'identification, formulaire, téléchargement, panier, paiement, messagerie, proxy rotatif ou résolution de CAPTCHA. Les blocages 401/403/429 et les challenges arrêtent la recherche. Certains sites utilisant des recherches POST ne sont pas compatibles avec cet adaptateur ; il faut alors un moyen d'accès autorisé adapté, pas contourner le contrôle.

### 4. Brancher n8n

Créer un credential n8n **Header Auth** nommé `FLIP_RADAR_WORKER` : nom d'en-tête `Authorization`, valeur `Bearer ` suivie du secret WORKER. Créer séparément `FLIP_RADAR_REVIEW` avec le secret REVIEW, sans le donner à l'agent ni aux workflows de recherche.

Importer les autres JSON sans les activer. Dans chaque nœud « Configuration », renseigner uniquement l'URL HTTPS du worker, puis sélectionner le credential correspondant dans les nœuds HTTP.

| Workflow | Action |
|---|---|
| 10 CREATE MISSION | Enregistre une mission en attente. Pays et langues modifiables, aucune limite de prix d'achat |
| 20 HUNT NEXT | Lance la mission suivante, seulement si LIVE est activé côté worker |
| 21 MISSION STATUS | Lit le statut à partir du `mission_id` retourné ; pas de polling caché |
| 22 READ CANDIDATES | Lit les 50 dernières annonces, à vérifier |
| 23 IMPORT DNID | Importe manuellement les adjudications officielles 2024 ; credential REVIEW requis |
| 24 PLAN FAMILIES | Classe les familles historiques et prépare des missions ; transmission au Hunter bloquée par défaut |
| 25 REVIEW | Enregistre des preuves réelles via le credential REVIEW ; garde-fou à compléter explicitement |
| 30 DISPATCH ALERT | Réserve, envoie et confirme une alerte ; secret Telegram et destination à renseigner |

Le workflow 20 répond rapidement `started`. Ce n'est pas encore une recherche terminée : consulter 21. `busy` indique qu'un travail est déjà en cours sur ce worker, `idle` qu'il n'y a plus de mission.

### Références historiques officielles DNID

La version 0.2 peut télécharger uniquement l'URL CSV exacte publiée par la Direction Nationale d’Interventions Domaniales sur [data.gouv.fr](https://www.data.gouv.fr/datasets/donnees-de-ventes-annee-2024). La réutilisation est attribuée à ce producteur et à la [Licence Ouverte 2.0](https://www.data.gouv.fr/pages/legal/licences/etalab-2.0). L'import retire les coordonnées personnelles reconnaissables, conserve les prix d'adjudication en centimes et déduplique les lignes strictement identiques.

Cette base décrit des ventes de 2024. Elle aide à découvrir des familles de produits et à examiner des ordres de grandeur historiques, mais l'API la marque toujours `historical_only: true` et `eligible_as_current_market_proof: false`. Elle ne prouve ni la demande actuelle, ni la disponibilité d'une annonce, ni le prix actuel sur Vinted ou Leboncoin. Elle n'active donc pas le Web Hunter.

Le site d'enchères lui-même n'est pas collecté par navigateur : ses conditions interdisent le web-scraping. Un autre portail testé a présenté un contrôle anti-bot ; l'agent s'est arrêté sans tentative de contournement. Une source d'annonces actives ne sera ajoutée qu'avec API officielle, flux autorisé ou permission écrite.

`LIVE=true` peut occasionner des appels IA payants. Limites initiales : 18 décisions IA, 12 navigations, 3 minutes, 1 600 tokens de sortie maximum par appel. Ce sont des bornes par exécution, pas un plafond de dépense global. Configurer aussi les quotas fournisseur. Aucun coût d'abonnement n'est présumé.

### 5. Prouver la demande et la marge

Une annonce brute est toujours `unverified`. Les frais sont inconnus et la confiance d'identification est plafonnée à 0,85. Le navigateur ne peut donc pas, seul, créer un GO.

Le workflow 25 / `POST /v1/reviews` accepte les données vérifiées décrites dans `docs/DATA_CONTRACT.md`. Le modèle `config/review.template.json` n'est pas une preuve et ne doit pas être exécuté tel quel. Les déclarations `human` / `official_api` sont fournies par un opérateur de confiance ; le logiciel ne certifie pas tout seul les pages citées. Les connecteurs de preuves de ventes sont une prochaine intégration nécessaire pour automatiser davantage.

Seuils de départ, ajustables dans `src/core.mjs` : marge estimée après provisions ≥ 25 €, ROI ≥ 20 %, demande ≥ 60/100, risque ≤ 35/100, identité ≥ 0,90 et au moins 5 ventes comparables exploitables. À partir de 2 500 € de coût complet, 8 comparables sont exigés : **ce n'est pas un plafond d'achat**.

Ces seuils et pondérations sont provisoires, non optimisés sur tes résultats. Une forte demande ne garantit pas la revente. La meilleure destination est choisie parmi celles suffisamment documentées ; les canaux sans accès, catégorie autorisée, frais ou preuves restent à vérifier.

### 6. Activer les alertes, puis seulement planifier

Renseigner ton propre `chat_id` et le credential du bot Telegram dans 30. Activer `FLIP_RADAR_ALERTS_ENABLED=true` séparément et réaliser un premier essai contrôlé. Une revue déjà enregistrée quand les alertes étaient désactivées n'est pas rétroactivement expédiée ; une nouvelle revue avec une nouvelle clé est nécessaire après revalidation.

La file d'attente évite les doublons ordinaires. Il n'existe pas de garantie « exactement une fois » de bout en bout avec Telegram : après un timeout ou un crash, la livraison devient `uncertain` et n'est pas réessayée automatiquement. Vérifier le chat avant toute correction manuelle. Ne pas relancer directement le nœud Telegram avec les données épinglées d'une ancienne exécution.

Un déclencheur planifié pourra remplacer les déclencheurs manuels après validation des accès, des coûts et de la qualité des annonces. Aucune planification n'a été créée ou activée dans ce pack.

## Tests reproductibles

Avec Node.js 22+ et les dépendances de développement :

```bash
npm ci
npm run build:workflows
npm test
npm run self-test
npm run check
```

Les tests automatisés n'appellent ni marketplace, ni modèle distant, ni Telegram. PGlite exécute les deux migrations et les requêtes dans un PostgreSQL local en mémoire ; ce n'est pas un test de connexion Supabase. Le parseur a aussi été validé localement sur le véritable CSV officiel téléchargé séparément, sans inclure ce fichier de données dans le dépôt.

## Références techniques

Formats n8n : [import/export](https://docs.n8n.io/build/manage-workflows/export-and-import), [HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest), [messages Telegram](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.telegram/message-operations).

Adaptateurs : [réseau Playwright](https://playwright.dev/docs/network), [requêtes paramétrées node-postgres](https://node-postgres.com/features/queries), [Gemini generateContent](https://ai.google.dev/api/generate-content). Les versions des dépendances sont verrouillées dans `package-lock.json` ; les conditions d'accès des marketplaces doivent être examinées source par source au branchement.
