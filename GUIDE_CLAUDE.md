# Connecter le Claude d'une autre personne au repo GitHub

Pour des changements simples (prix, texte, photo d'un produit), suivez
plutôt `GUIDE_PRODUITS.md` — pas besoin de Claude du tout. Ce guide-ci est
pour quelqu'un qui veut pouvoir demander à **son propre Claude** de modifier
le code directement (design, nouvelle fonctionnalité, bug), sans dépendre
du compte de la personne qui a fait le site initialement.

Chaque personne utilise **son propre compte Claude** (payant, séparé) — ce
guide ne donne accès à aucun compte existant, seulement au repo GitHub de
l'association.

## Étape 0 — Donner l'accès GitHub (à faire une seule fois, par un admin)

1. Sur https://github.com/maisonftx-hub/maison-fauteux → **Settings →
   Collaborators**
2. **Add people** → entrez le nom d'utilisateur ou le courriel GitHub de la
   personne
3. Elle doit accepter l'invitation (courriel ou notification GitHub)

Sans cette étape, son Claude pourra *voir* le code (le repo est public)
mais ne pourra pas *envoyer* de changements.

## Option A — Claude Code sur le web (recommandée, aucune installation)

La façon la plus simple : tout se passe dans le navigateur, rien à
installer.

1. Allez sur https://claude.ai/code
2. Connectez-vous avec votre propre compte Claude (plan Pro, Max ou Team —
   requis pour cette fonctionnalité)
3. **Sign in with GitHub** → autorisez l'accès à votre compte GitHub
   (celui qui vient d'être ajouté comme collaborateur à l'étape 0)
4. Créez un environnement cloud si demandé (laissez les valeurs par défaut)
5. Choisissez le repo **maisonftx-hub/maison-fauteux** dans la liste
6. Décrivez ce que vous voulez changer (ex. « change la couleur du bouton
   Commander pour du vert ») et envoyez
7. Claude travaille dans une copie isolée du code et **pousse une branche**
   séparée — il ne touche jamais `main` directement
8. Regardez les changements dans l'aperçu (diff), puis cliquez **Create
   PR** pour ouvrir une Pull Request
9. Sur GitHub, quelqu'un (vous ou un autre admin) clique **Merge pull
   request** pour que le changement devienne réellement live

Cette dernière étape (merge) est volontairement manuelle — ça évite qu'un
changement cassé se retrouve en ligne sans qu'personne ne l'ait regardé.

## Option B — Claude Code en local (pour quelqu'un à l'aise avec un terminal)

Plus rapide une fois configuré, mais demande une installation :

1. Installez Claude Code : https://code.claude.com/docs/en/quickstart
2. Connectez votre compte GitHub en local — la façon la plus simple est
   d'installer GitHub CLI (https://cli.github.com) puis lancer :
   ```
   gh auth login
   ```
3. Clonez le repo :
   ```
   git clone https://github.com/maisonftx-hub/maison-fauteux.git
   cd maison-fauteux
   ```
4. Lancez Claude :
   ```
   claude
   ```
5. Décrivez ce que vous voulez changer — Claude édite les fichiers et peut
   directement faire `git commit` / `git push` avec vos identifiants
   GitHub (ceux configurés à l'étape 2)

Contrairement à l'option web, en local Claude peut pousser directement sur
`main` si vous le lui demandez — à vous de décider si vous préférez quand
même passer par une Pull Request pour garder un droit de regard avant que
ça devienne live.

## Quelle option choisir ?

- **Aucune envie d'installer quoi que ce soit, préférence pour un filet de
  sécurité (Pull Request) avant que ça devienne live** → Option A (web)
- **À l'aise avec un terminal, veut itérer vite sans attendre de review**
  → Option B (local)

## À savoir

- L'option web est en aperçu de recherche ("research preview") pour les
  comptes Pro/Max/Team — vérifiez que votre plan Claude y donne accès.
- Le repo étant public, n'importe qui peut le *voir* sans invitation —
  seule la capacité d'y *pousser des changements* est limitée aux
  collaborateurs ajoutés à l'étape 0.
- Aucune des deux options ne touche au compte Stripe ni aux variables
  d'environnement Vercel (`STRIPE_SECRET_KEY` etc.) — voir `STRIPE_SETUP.md`
  et `README.md` pour ça séparément.
