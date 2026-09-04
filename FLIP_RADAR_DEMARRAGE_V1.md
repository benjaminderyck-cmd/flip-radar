# FLIP RADAR — passage à la version 0.4

La version **0.3.0 est actuellement déployée** et l'import officiel DNID 2024 est terminé : 36 366 lignes historiques exploitables ont été enregistrées. Le workflow 24 a produit correctement son plan et s'est arrêté au garde-fou.

La version **0.4.0 est prête à être déployée**. Elle ajoute un catalogue européen de 23 sources, toutes désactivées, ainsi que le workflow n8n 26 qui les enregistre sans lancer de recherche.

Le paquet contient dix workflows n8n générés, le worker, les deux migrations SQL, les tests et la documentation. Il ne réalise aucun achat, paiement, message vendeur ou publication automatique.

## Mise à jour du worker

1. Décompresser `FLIP_RADAR_V0.4.0_READY.zip`.
2. Envoyer **tout le contenu intérieur du dossier `flip-radar`** à la racine du dépôt GitHub `flip-radar`.
3. Conserver le fichier `config/supabase-ca.crt` et les variables Railway existantes.
4. Attendre le redéploiement Railway.
5. Ouvrir `/health` : la réponse attendue contient `"version":"0.4.0"` et `"status":"up"`.

Si la version 0.2 fonctionne déjà, **aucune nouvelle migration SQL n'est nécessaire** pour cette mise à jour.

## Première exécution n8n de la version 0.4

1. Importer `workflows/FLIP_RADAR_26_REGISTER_EUROPE_SOURCES.json` dans n8n.
2. Affecter `FLIP_RADAR_REVIEW` au nœud `Enregistrer sources en attente`.
3. Affecter `FLIP_RADAR_WORKER` ou `FLIP_RADAR_REVIEW` au nœud `Lire matrice sources`.
4. Cliquer sur **Execute workflow**.
5. Ouvrir le résultat du nœud `Expliquer prochaine etape`.

Le workflow doit retourner `CATALOG_READY_SOURCES_STILL_DISABLED`. Il enregistre la matrice, mais ne crée aucune mission et ne consulte aucun site.

## Situation actuelle

- Worker v0.3 : en ligne.
- Historique DNID 2024 : importé, historique uniquement.
- Worker v0.4 : validé localement, pas encore déployé.
- Source d'annonces courantes approuvée : aucune.
- Recherche LIVE, alertes et achats : désactivés.
- Achat automatique : non prévu.

Ne pas toucher à la base interne de n8n, ni aux projets Perlesmania ou House Hunter. Les clés restent dans les variables Railway et les credentials n8n, jamais dans GitHub, les fichiers JSON ou la conversation.

Le guide détaillé est dans `README_FR.md` et les résultats de validation sont dans `reports/`.
