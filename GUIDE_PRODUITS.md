# Ajouter ou modifier un produit

Le catalogue au complet vit dans un seul fichier : **`products.json`**, à la
racine du repo. Pas besoin d'ordinateur de développeur, de terminal, ni de
compte Claude — tout se fait dans l'éditeur de GitHub, directement dans le
navigateur.

## Modifier un produit existant (prix, taille, description...)

1. Allez sur https://github.com/maisonftx-hub/maison-fauteux
2. Cliquez sur `products.json`
3. Cliquez sur le crayon (✏️ *Edit this file*) en haut à droite
4. Trouvez le produit à modifier — repérez son `"id"` (ex. `"hoodie"`) — et
   changez seulement la valeur voulue, ex. `"price": 85` → `"price": 90`
5. Ne touchez pas aux guillemets, virgules ou accolades autour — seulement
   les valeurs entre guillemets ou les nombres.
6. En bas de page : **Commit changes...** → laissez le message par défaut ou
   décrivez le changement → **Commit directly to the main branch** →
   **Commit changes**.
7. Le site se remet à jour tout seul, environ 1-2 minutes plus tard —
   aucune autre étape.

## Ajouter un nouveau produit

1. Même page, même bouton crayon.
2. Copiez-collez un bloc `{ ... }` existant en entier, collez-le juste avant
   ou après un autre, séparé par une virgule.
3. Changez chaque valeur pour le nouveau produit :
   - `id` — un identifiant court, en minuscules, sans espace ni accent
     (ex. `"tuque"`), qui n'existe nulle part ailleurs dans le fichier
   - `name`, `sub`, `price`
   - `flat` — juste un numéro de référence pour le croquis, ex. `"07"`
   - `sizes` — une liste entre crochets, ex. `["S","M","L","XL"]` ou
     `["Taille unique"]`
   - `desc` — une ou deux phrases de description
   - `art` — le dessin ; en attendant un vrai visuel, le plus simple est de
     dupliquer le `art` d'un produit existant (voir note plus bas)
4. Vérifiez qu'il y a une virgule entre chaque bloc `{ }`, et **aucune**
   virgule après le tout dernier `}` juste avant le `]` final du fichier.
5. Commit comme à l'étape 6 ci-dessus.

## Le piège à éviter

`products.json` est du texte strict — une virgule manquante ou en trop, ou
un guillemet non fermé, peut empêcher **tout** le site de charger ses
produits, pas juste celui que vous modifiez. GitHub ne vous avertira pas
si vous cassez la syntaxe.

**Avant de valider ("Commit"), collez le contenu complet du fichier dans
https://jsonlint.com et cliquez "Validate JSON".** Si c'est vert, c'est bon
à publier. Ça prend dix secondes et ça évite de casser le site en direct.

## Le vrai visuel du produit (au lieu du croquis)

Chaque produit affiche pour l'instant un dessin au trait (généré par nous),
pas une vraie photo. Remplacer ça par de vraies photos demande un
changement de structure un peu plus large — décrivez ce besoin dans une
conversation avec Claude plutôt que d'éditer `art` à la main.

## Où sont les prix pour le paiement (Stripe) ?

Nulle part ailleurs. `products.json` est l'unique source : le fichier
`api/create-checkout-session.js` (le code qui parle à Stripe) lit ce même
fichier automatiquement à chaque commande. Vous n'avez jamais besoin
d'ouvrir ce fichier, ni de toucher au Dashboard Stripe, pour ajouter ou
changer un produit — voir `STRIPE_SETUP.md` pour ce qui concerne Stripe
lui-même (paiements, remboursements, mode live).
