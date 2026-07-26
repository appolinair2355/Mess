# Site d'envoi de SMS (Twilio)

## Installation en local

1. Installer Node.js (version 18 ou plus) si ce n'est pas déjà fait.
2. Dans le dossier du projet, lancer :
   ```
   npm install
   ```
3. Copier `.env.example` en `.env` :
   ```
   cp .env.example .env
   ```
4. Ouvrir `.env` et remplir avec tes vraies valeurs Twilio (uniquement en
   local — ce fichier ne doit JAMAIS être commité ni déployé, voir `.gitignore`) :
   - `TWILIO_ACCOUNT_SID` : trouvé dans Console Twilio → General settings → Account SID
   - `TWILIO_AUTH_TOKEN` : trouvé dans Console Twilio → API keys & tokens
   - `TWILIO_FROM_NUMBER` : ton numéro Twilio (acheté dans "Phone Numbers")
   - `DESTINATION_NUMBER` : numéro de secours, rarement utilisé (le formulaire
     envoie normalement son propre numéro choisi par pays)

## Lancement en local

```
npm start
```

Puis ouvrir http://localhost:3000 dans le navigateur.

## Déploiement sur Render (production)

**Ne jamais utiliser de fichier `.env` en production.** Sur Render, les
variables se configurent directement dans le tableau de bord, pas dans un
fichier du dépôt :

1. New → Web Service → connecte ton dépôt GitHub
2. Build command : `npm install`
3. Start command : `npm start`
4. Onglet **Environment** → ajoute une par une :
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_FROM_NUMBER`
   - `DESTINATION_NUMBER`
   - `PORT` = `10000`
5. Sauvegarder → Render redéploie automatiquement avec ces valeurs

Le code lit ces variables via `process.env.NOM_VARIABLE` (voir `server.js`) —
rien à modifier dans le code, seulement à remplir ces champs sur Render.

## Important — sécurité

- Ne jamais publier ni commiter le fichier `.env` — `.gitignore` l'exclut déjà.
- Le SDK Twilio n'utilise que des variables d'environnement (`process.env`),
  aucune valeur n'est écrite en dur dans le code.
- Si un Auth Token a déjà été exposé publiquement (ex: poussé par erreur sur
  GitHub), Twilio le révoque automatiquement par mesure de protection. Il
  faut alors récupérer le nouveau token sur la Console et mettre à jour
  uniquement la variable sur Render — jamais dans un fichier du dépôt.
- En essai gratuit Twilio, tu ne peux envoyer des SMS qu'à des numéros
  vérifiés dans ta console.

## En-tête (nom expéditeur)

La page a un champ "En-tête" où on tape directement le nom à afficher comme
expéditeur (ex: "MonSite"), à chaque envoi. Limites imposées par Twilio : 11
caractères max, lettres et chiffres uniquement, sans espace. Si le champ est
laissé vide, le numéro Twilio (`TWILIO_FROM_NUMBER`) est utilisé comme
expéditeur à la place. Le destinataire ne pourra pas répondre à un message
envoyé avec un en-tête texte, et cette fonctionnalité n'est pas disponible
dans tous les pays (interdite aux États-Unis/Canada notamment).

## Sélecteur de pays (Afrique)

La page propose un menu déroulant avec tous les pays d'Afrique et leur
drapeau (Bénin +229 sélectionné par défaut). L'utilisateur choisit le pays,
tape son numéro local (sans l'indicatif ni le 0 initial), et le site compose
automatiquement le numéro complet (ex: +229 90000000).

`DESTINATION_NUMBER` sert uniquement de numéro de secours si aucun numéro
n'est envoyé par le formulaire.
