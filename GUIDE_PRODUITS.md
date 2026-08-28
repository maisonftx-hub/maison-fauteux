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
   - `image` — laissez `null` pour l'instant (affiche le croquis par
     défaut), ou remplissez-le une fois la photo envoyée — voir la section
     suivante
   - `desc` — une ou deux phrases de description
   - `art` — le dessin ; en attendant un vrai visuel, le plus simple est de
     dupliquer le `art` d'un produit existant
4. Vérifiez qu'il y a une virgule entre chaque bloc `{ }`, et **aucune**
   virgule après le tout dernier `}` juste avant le `]` final du fichier.
5. Commit comme à l'étape 6 de la section précédente.

## Supprimer un produit

1. Même page, même bouton crayon, dans `products.json`.
2. Repérez le produit par son `"id"`, puis sélectionnez **tout son bloc**,
   de son `{` d'ouverture jusqu'à son `}` de fermeture inclusivement.
3. Supprimez ce bloc en entier.
4. Vérifiez la ponctuation autour de la coupure :
   - Si vous avez supprimé un produit du **milieu** de la liste, il doit
     rester exactement une virgule entre les deux blocs qui se retrouvent
     maintenant côte à côte.
   - Si vous avez supprimé le **dernier** produit de la liste, retirez
     aussi la virgule qui suivait le bloc précédent (rien ne doit avoir de
     virgule juste avant le `]` final).
5. Collez le fichier dans https://jsonlint.com pour vérifier avant de
   valider (voir "Le piège à éviter" plus bas), puis commit.

*Note :* supprimer un produit ne retire pas les anciennes commandes déjà
passées pour cet article dans Stripe — seulement sa disponibilité future
sur le site.

## Ajouter une vraie photo à un produit

Chaque produit affiche un croquis dessiné par défaut jusqu'à ce qu'une vraie
photo soit ajoutée. Pour en ajouter une :

1. Sur https://github.com/maisonftx-hub/maison-fauteux, ouvrez le dossier
   `assets/products/`.
2. Cliquez **Add file → Upload files**, puis glissez-déposez la photo (ou
   choisissez-la depuis votre ordinateur).
   - Formats acceptés : `.jpg`, `.png` ou `.webp`.
   - Gardez le fichier sous ~1 Mo si possible (le site charge plus vite) —
     la plupart des photos de téléphone peuvent être compressées sans perte
     visible via https://squoosh.app avant de les envoyer.
   - Donnez-lui un nom simple et sans espace, ex. `hoodie-face.jpg`.
3. **Commit changes** pour envoyer la photo dans le repo.
4. Retournez dans `products.json` (bouton crayon), trouvez le produit
   concerné, et changez sa ligne `"image"` :
   ```
   "image": "assets/products/hoodie-face.jpg"
   ```
5. Commit. Le site affiche maintenant la vraie photo à la place du croquis,
   partout où ce produit apparaît (boutique, fiche produit, panier).

Pour revenir au croquis, remettez simplement `"image": null`.

## Le piège à éviter

`products.json` est du texte strict — une virgule manquante ou en trop, ou
un guillemet non fermé, peut empêcher **tout** le site de charger ses
produits, pas juste celui que vous modifiez. GitHub ne vous avertira pas
si vous cassez la syntaxe.

**Avant de valider ("Commit"), collez le contenu complet du fichier dans
https://jsonlint.com et cliquez "Validate JSON".** Si c'est vert, c'est bon
à publier. Ça prend dix secondes et ça évite de casser le site en direct.

## Où sont les prix pour le paiement (Stripe) ?

Nulle part ailleurs. `products.json` est l'unique source : le fichier
`api/create-checkout-session.js` (le code qui parle à Stripe) lit ce même
fichier automatiquement à chaque commande. Vous n'avez jamais besoin
d'ouvrir ce fichier, ni de toucher au Dashboard Stripe, pour ajouter ou
changer un produit — voir `STRIPE_SETUP.md` pour ce qui concerne Stripe
lui-même (paiements, remboursements, mode live).
