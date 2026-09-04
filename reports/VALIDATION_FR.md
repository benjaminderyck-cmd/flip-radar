# FLIP RADAR 0.2 — vérification locale

Date UTC : 2026-09-04T01:04:45.997Z

120/120 tests réussis, 0 échec. 25 fichiers JavaScript vérifiés. Huit workflows n8n générés et inactifs. Le SELF TEST couvre 19 cas fictifs.

PostgreSQL : PGlite 0.5.8 in memory; both migrations replayed. Node : v24.19.0. Dépendances : pg 8.23.0, Playwright 1.62.1.

Aucun appel à une marketplace ou un modèle distant, aucun Telegram ni achat exécuté. Les serveurs HTTP utilisés par les tests sont locaux.

Les migrations et les transactions ont été réellement exécutées dans PGlite ; le navigateur et le modèle sont simulés. Le parseur DNID a ses propres tests déterministes. Voir TEST_RESULTS.tap et SELF_TEST_RESULT.json.

Restent à vérifier pour cette mise à jour : migration 002 sur Supabase, déploiement 0.2, import DNID via n8n, source d'annonces actives autorisée, Chromium et modèle en production, Telegram et charge. Le worker 0.1 existant n'est pas modifié par ces tests locaux.
