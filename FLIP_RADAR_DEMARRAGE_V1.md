# FLIP RADAR — démarrer la construction

Le premier socle est construit : sept workflows n8n, un service de navigation pilotée par IA, le moteur demande/marge/risques, une base PostgreSQL et les tests.

Il n'est **pas encore déployé ni connecté aux marketplaces**. Il ne prétend pas accéder à tous les sites. Les recherches réelles, les alertes et les achats ne sont pas activés ; le programme ne possède aucun mécanisme d'achat automatique.

## Ta première action

1. Télécharger `FLIP_RADAR_00_SELF_TEST.json`.
2. Dans n8n, créer un nouveau workflow puis choisir **Import from File**.
3. Importer ce JSON, puis cliquer **Execute workflow**.
4. Ouvrir le résultat du dernier nœud.

Résultat attendu :

```json
{
  "all_ok": true,
  "tests_total": 19,
  "external_calls": 0,
  "telegram_sent": 0,
  "purchases_executed": 0
}
```

Le résultat complet contient aussi le détail des tests et un exemple fictif. Aucun credential, abonnement, accès marchand ou envoi n'est nécessaire. Les chiffres de l'exemple ne sont pas une opportunité réelle ni des tarifs de plateforme.

Si ce test échoue, conserver le message d'erreur et la version de n8n. Ne pas désactiver les protections de n8n pour le faire passer. Le code du test a été vérifié sans accès aux fichiers, au réseau ou aux secrets ; l'import dans ton instance reste à confirmer.

## Ensuite

Décompresser `FLIP_RADAR_CONSTRUCTION_V1.zip` et ouvrir `flip-radar/README_FR.md`. Le guide explique, dans l'ordre : base dédiée, worker, première source autorisée, credentials privés, recherche, vérification des preuves et alertes.

Ne pas toucher à la base interne de n8n, ni aux projets Perlesmania ou House Hunter. Les clés se renseignent dans les secrets de l'hébergeur et les credentials n8n, jamais dans la conversation ou les JSON.

Le navigateur sait choisir ses requêtes et parcourir une source approuvée. Il ne sait pas encore certifier automatiquement les ventes et la demande : ces preuves doivent être fournies via la revue privée avant qu'un candidat devienne GO. Les favoris seuls ne suffisent pas. La boutique propre et les connecteurs de publication Vinted/Leboncoin ne sont pas inclus dans cette première construction.

Les résultats détaillés de validation sont dans `flip-radar/reports/`. Les tests locaux ne remplacent pas les essais ultérieurs du navigateur, du modèle, de la base distante et de Telegram.
