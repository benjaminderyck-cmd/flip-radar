# Vérification de compatibilité — construction du 3 septembre 2026

Les paquets officiels npm `n8n-nodes-base@2.15.1` et `@n8n/task-runner@2.37.3` ont été consultés en lecture seule pendant la construction. Ils ne sont pas des dépendances du worker.

| Élément exporté | Contrôle effectué |
|---|---|
| Code v2 | Version supportée, `language: javaScript`, `mode: runOnceForAllItems`, `jsCode` |
| HTTP Request v4.2 | Version supportée ; Header Auth, corps JSON et structure des options réponse/redirection vérifiés |
| Telegram v1.2 | Version supportée ; `sendMessage`, `replyMarkup: none`, `parse_mode: HTML`, attribution désactivée |
| Texte Telegram | Tous les caractères HTML spéciaux sont échappés, pour rendre l'annonce comme du texte sans injection de balises |
| Sandbox Code | Le runner consulté n'injecte pas le global `URL` ; le moteur et la configuration n'en dépendent plus |

Le SELF TEST est exécuté dans une VM JavaScript restreinte sans `URL`, `require`, `fetch`, `process`, accès fichiers ni secrets. Le même code de calcul est embarqué dans l'export n8n et utilisé par le worker. Les limites du petit parseur d'URL de preuve sont volontaires : hôtes DNS ASCII/punycode, URL absolue sans identifiants, espaces ou segments `..`. Le navigateur possède un contrôle réseau distinct, plus complet.

Les nœuds Code compilent, les graphes et références internes sont contrôlés, les JSON sont comparés au générateur. **Cela ne remplace pas un import et une exécution dans ton instance n8n**, qui n'est pas connectée ici. Un changement de version du produit peut imposer un ajustement ; commencer par l'export 00 sans appels externes.

Autres vérifications non réalisées : image Docker complète, démarrage du navigateur de production, modèle distant, source réelle, Telegram, base distante, déploiement et charge multi-workers. Les tests du Web Hunter utilisent des adaptateurs simulés ; ils valident les choix d'actions et les garde-fous, pas la qualité réelle d'un modèle sur des marketplaces.

Références : [paquet officiel n8n-nodes-base](https://www.npmjs.com/package/n8n-nodes-base/v/2.15.1), [paquet officiel task runner](https://www.npmjs.com/package/@n8n/task-runner/v/2.37.3), [documentation du nœud Code](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code/).
