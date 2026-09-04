# FLIP RADAR — passage à la version 0.3

La version **0.2.0 est actuellement déployée** et l'import officiel DNID 2024 est terminé : 36 366 lignes historiques exploitables ont été enregistrées.

La version **0.3.0 est prête à être déployée**. Elle ajoute l'agrégation sécurisée des familles de produits et le workflow n8n 24, qui transforme l'historique en pistes de recherche. Ces pistes ne prouvent ni la demande actuelle, ni le prix actuel, ni la rentabilité d'une annonce.

Le paquet contient neuf workflows n8n générés, le worker, les deux migrations SQL, les tests et la documentation. Il ne réalise aucun achat, paiement, message vendeur ou publication automatique.

## Mise à jour du worker

1. Décompresser `FLIP_RADAR_V0.3.0_READY.zip`.
2. Envoyer **tout le contenu intérieur du dossier `flip-radar`** à la racine du dépôt GitHub `flip-radar`.
3. Conserver le fichier `config/supabase-ca.crt` et les variables Railway existantes.
4. Attendre le redéploiement Railway.
5. Ouvrir `/health` : la réponse attendue contient `"version":"0.3.0"` et `"status":"up"`.

Si la version 0.2 fonctionne déjà, **aucune nouvelle migration SQL n'est nécessaire** pour cette mise à jour.

## Première exécution n8n de la version 0.3

1. Importer `workflows/FLIP_RADAR_24_PLAN_REFERENCE_FAMILIES.json` dans n8n.
2. Affecter le credential HTTP `FLIP_RADAR_WORKER` à chaque nœud HTTP du workflow.
3. Laisser `transmit_to_hunter` sur `false`.
4. Cliquer sur **Execute workflow**.
5. Ouvrir le résultat du nœud `Plan seulement - garde fou`.

Le workflow doit produire un plan limité de catégories et de familles historiques. Il ne crée aucune mission de navigation tant que les trois conditions suivantes ne sont pas réunies : activation volontaire dans le workflow, mode LIVE du worker et au moins une source d'annonces active explicitement approuvée.

## Situation actuelle

- Worker v0.2 : en ligne.
- Historique DNID 2024 : importé, historique uniquement.
- Worker v0.3 : validé localement, pas encore déployé.
- Source d'annonces courantes approuvée : aucune.
- Recherche LIVE, alertes et achats : désactivés.
- Achat automatique : non prévu.

Ne pas toucher à la base interne de n8n, ni aux projets Perlesmania ou House Hunter. Les clés restent dans les variables Railway et les credentials n8n, jamais dans GitHub, les fichiers JSON ou la conversation.

Le guide détaillé est dans `README_FR.md` et les résultats de validation sont dans `reports/`.
