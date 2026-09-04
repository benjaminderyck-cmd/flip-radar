# Données, preuves et calculs — contrat 0.1

## API privée

Toutes les routes `/v1/*` demandent le header `Authorization: Bearer …`. Les exemples sont des structures à remplir, jamais des données de marché. Corps JSON maximum : 512 000 octets. Aucun endpoint de paiement ou de contact vendeur n'existe.

| Méthode / chemin | Credential | Fonction |
|---|---|---|
| `GET /health` | Aucun | État du processus, pas de détail privé |
| `GET /v1/status` | WORKER ou REVIEW | Migration, flags, worker occupé |
| `POST /v1/missions` | WORKER ou REVIEW | `{request_key, mission:{objective,countries,languages,source_ids}}` |
| `POST /v1/runs/next` | WORKER ou REVIEW | `{}` ; démarre au plus une mission |
| `GET /v1/missions/:id` | WORKER ou REVIEW | Statut d'exécution |
| `GET /v1/listings` | WORKER ou REVIEW | 50 dernières annonces brutes |
| `POST /v1/reviews` | REVIEW uniquement | `{request_key,listing_id,listing_updates,quotes,risk,fx}` |
| `GET /v1/opportunities` | WORKER ou REVIEW | 50 dernières évaluations |
| `POST /v1/alerts/claim` | WORKER ou REVIEW | Réserve une seule alerte éligible |
| `POST /v1/alerts/ack` | WORKER ou REVIEW | `{id,claim_token,message_id}` après envoi confirmé |
| `POST /v1/decisions` | REVIEW uniquement | `{request_key,opportunity_id,decision,notes}` ; journal, aucun achat |

`request_key` doit comporter 4–160 caractères alphanumériques, `.`, `_`, `:`, `-`. Une même clé avec les mêmes données restitue le résultat existant ; avec des données différentes elle renvoie `409 IDEMPOTENCY_CONFLICT`. Les UUID viennent de l'API. Les décisions possibles : `watch`, `reject`, `bought`, `sold_elsewhere`. Déclarer `bought` enregistre un achat déjà réalisé manuellement, sans en exécuter un.

## Annonce d'acquisition

Le navigateur enregistre : source, URL observée, identifiant dérivé de l'URL, titre, prix, devise, pays, référence et état supposés, date, empreinte du texte et courts extraits probants. Seules des données visibles peuvent fonder le prix/titre. Les références de produits, pays et état restent à contrôler : une extraction n'est pas une expertise.

Une revue peut compléter `product_key`, `condition_key`, `identity_confidence`, `availability` et `costs_eur`. Elle ne peut pas remplacer l'URL, le mode, le prix observé ou la date d'observation. Si le prix a changé, refaire une observation. Seul `availability: "active"` est éligible.

`product_key` doit identifier le modèle et ses attributs qui changent sa valeur : capacité, taille, version, authenticité présumée, accessoires inclus selon la catégorie. `condition_key` distingue au minimum neuf, bon état, usé et défectueux. Deux annonces ne sont pas comparables simplement parce que leur marque correspond.

Tous les montants ci-dessous sont exprimés en **EUR**, sauf `listing.price` et `comp.price` associés à leur devise. Un zéro doit être une hypothèse explicitement vérifiée ; une donnée inconnue reste `null`, jamais zéro par défaut.

`costs_eur` :

- `inbound_shipping` : livraison jusqu'à toi.
- `buyer_fee` : frais/protection acheteur réellement applicables.
- `refurbishment` : remise en état.
- `import_reserve` : provision documentée pour frais d'importation éventuels ; Europe ne veut pas dire union douanière unique.
- `handling` : manutention, déplacement ou temps opérateur provisionné selon ta méthode.

## Une quote par destination et pays

Canaux reconnus : `vinted`, `leboncoin`, `own_site`. `enabled`, `market_accessible` et `category_allowed` doivent être vrais après vérification. Ni Vinted ni Leboncoin ne sont supposés autoriser toutes les catégories ou tous les comptes professionnels. Vérifier leurs règles applicables et les obligations de ton activité avant exploitation.

`fees_reviewed_at` date les hypothèses, maximum 90 jours. `fees_eur` demande tous les champs : `fixed_fee`, `seller_shipping`, `packaging`, `return_reserve`, `customer_acquisition`, `other_reserve`.

`fees_bps.platform` et `fees_bps.business_reserve` sont des entiers en points de base : 100 = 1 %. La provision entreprise ne prétend pas résoudre automatiquement TVA, cotisations ou fiscalité. Le calcul linéaire sur le prix de vente est une convention de provision ; adapter ses paramètres à ton statut avec un professionnel si nécessaire. Éviter le double comptage d'un coût dans plusieurs champs. Pour un site propre, inclure explicitement acquisition client et paiement : `own_site` n'implique aucune clientèle existante.

## Comparables `comps`

Chaque vente utilisée requiert :

- `url`, `verification_ref` : URL de l'annonce et référence probante.
- `status: "sold"`, `price_confirmed: true` : prix de transaction connu, pas prix affiché supposé.
- `verified_by: "human"` ou `"official_api"` : déclaration via le endpoint privé de revue, pas une appréciation de l'IA.
- `price`, `currency`, `sold_at` : montant positif, devise, vente datée des 90 derniers jours, sans date future.
- `product_key`, `condition_key`, `channel`, `market_country` : même produit/état/destination/pays que l'évaluation.
- `listed_at` : date permettant de calculer le délai historique. Au moins trois délais connus sont nécessaires pour le score de demande.

Les URL sont dédupliquées après retrait des seuls paramètres de tracking connus. Une annonce supprimée, un favori, une baisse de prix, une capture non datée ou un prix d'annonce active ne constitue pas une vente confirmée. Si une plateforme ne fournit pas de vrais prix vendus accessibles avec permission, conserver `REVUE` ; ne pas « compléter » au jugé.

## Demande `market`

Champs : `verified_by`, `verification_ref`, `scope: "complete_window"`, `window_days` (7–90), `sold_count`, `active_count`, `observed_at`, puis les mêmes clés produit/état/canal/pays.

Définir une fenêtre cohérente : ventes confirmées de ce périmètre sur la fenêtre, et stock actif à sa fin. L'observation doit dater de 7 jours maximum. Ne pas extrapoler un « total marché » à partir d'une poignée de résultats de recherche. Le nombre de ventes déclaré ne peut être inférieur aux comparables datés dans cette même fenêtre.

Score provisoire :

```text
ventes_mensualisees = sold_count × 30 / window_days
rotation_proxy = sold_count / max(1, sold_count + active_count)
volume = clamp(ventes_mensualisees / 25, 0, 1)
rotation = clamp(rotation_proxy / 0,5, 0, 1)
vitesse = clamp(1 − delai_median_historique / 60, 0, 1)
demande = arrondi(100 × (0,35 × volume + 0,40 × rotation + 0,25 × vitesse))
```

C'est un indice de classement heuristique, pas une probabilité de vente, une taille réelle de clientèle ni une prévision de délai. La saisonnalité et les biais d'échantillonnage ne sont pas modélisés dans cette V1. Les pondérations devront être recalibrées sur les ventes réellement réalisées.

## Marge et ordre des opportunités

Les montants sont calculés en centimes entiers. Pour la revente brute prudente, on prend le prix observé au rang `floor((n−1)×0,25)` dans les ventes comparables triées : un quartile bas empirique, pas une borne statistique garantie.

```text
cout_complet = prix_achat_converti_EUR + somme(costs_eur)
revente_nette_prudente = quartile_bas − somme(fees_eur)
                        − provision_pourcentages_arrondie_au_centime_superieur
marge_estimee_apres_provisions = revente_nette_prudente − cout_complet
ROI = marge / cout_complet
euros_par_jour_immobilise = marge / max(1, delai_median_historique)
```

Un coût ou taux inconnu bloque la recommandation : l'estimation ne le transforme pas en zéro. Parmi les destinations documentées, priorité aux GO, puis au ratio de marge par jour historique d'immobilisation. Cela ne maximise pas mathématiquement ton profit total : capital simultanément engagé, stockage, volume d'acheteurs et coûts fixes de l'infrastructure ne font pas encore l'objet d'un optimiseur de portefeuille. Suivre séparément dépenses IA/hébergement, temps et invendus pour connaître le résultat global.

Verdicts : `GO` = dossier éligible à examiner ; `REVUE` = preuve ou champ critique manquant ; `SURVEILLER` = demande trop faible malgré données suffisantes ; `NON` = marge insuffisante ou risque rédhibitoire. En mode test, `SIMULATION` remplace le verdict réel et `notification_allowed` reste faux.

## Risque, change et actualité

`risk` : `reviewed_by: "human"`, `score` de 0 à 100, `evidence_ref`, `reviewed_at` ≤ 7 jours et `flags` liste. `counterfeit`, `prohibited`, `unsafe`, `suspected_stolen` bloquent le GO. Une revue humaine ne garantit pas l'absence de fraude ; contrôler vendeur, état, authenticité, sécurité et disponibilité avant achat.

`fx` : objet indexé par devise, chaque entrée contenant `eur_per_unit`, `source_url`, `as_of` ≤ 3 jours. EUR ne nécessite pas de taux. Les frais de conversion doivent être provisionnés séparément. L'acquisition doit être observée dans les dernières 24 heures pour un GO ; recontrôler encore juste avant l'achat.

## Fiabilité et exploitation

Un seul job navigateur à la fois par processus. Une mission prend un bail de 10 minutes en base ; après crash, une mission au bail expiré peut être reprise, maximum trois tentatives. Les erreurs d'accès sont marquées en échec, pas relancées automatiquement en changeant d'identité.

L'historique déduplique les événements identiques, y compris si un prix revient à une valeur déjà connue ; ce n'est pas un journal exhaustif de chaque affichage de page. Les dernières observations restent conservées dans l'annonce. Les requêtes SQL sont paramétrées. Le contrôle des coûts, les sauvegardes, la rétention, la surveillance des erreurs et un test de charge restent à mettre en place avant exploitation continue.
