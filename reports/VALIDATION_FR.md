# FLIP RADAR 0.3 — vérification locale

Date UTC : 2026-09-04T19:07:44.623Z

125/125 tests réussis, 0 échec. 25 fichiers JavaScript vérifiés. Neuf workflows n8n générés et inactifs. Le SELF TEST couvre 19 cas fictifs.

PostgreSQL : PGlite 0.5.8 in memory; both migrations replayed. Node : v24.19.0. Dépendances : pg 8.23.0, Playwright 1.62.1.

Aucun appel à une marketplace ou un modèle distant, aucun Telegram ni achat exécuté. Les serveurs HTTP utilisés par les tests sont locaux.

Les migrations et les transactions ont été réellement exécutées dans PGlite ; le navigateur et le modèle sont simulés. L'agrégation des familles et les deux branches du workflow 24 sont testées. Voir TEST_RESULTS.tap et SELF_TEST_RESULT.json.

Restent à vérifier pour cette mise à jour : déploiement 0.3, import du workflow 24 dans n8n et agrégation sur les 36 366 références de production. La transmission au Hunter demeure désactivée jusqu'à l'approbation d'une source d'annonces actives.
