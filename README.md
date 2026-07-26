# Site d'envoi de SMS (Twilio)

## Installation

1. Installer Node.js (version 18 ou plus) si ce n'est pas déjà fait.
2. Dans le dossier du projet, lancer :
   ```
   npm install
   ```
3. Copier `.env.example` en `.env` :
   ```
   cp .env.example .env
   ```
4. Ouvrir `.env` et remplir avec tes vraies valeurs Twilio :
   - `TWILIO_ACCOUNT_SID` : trouvé dans Console Twilio → General settings → Account SID
   - `TWILIO_AUTH_TOKEN` : trouvé au même endroit (clique sur "Show" pour l'afficher)
   - `TWILIO_FROM_NUMBER` : ton numéro Twilio (acheté dans "Phone Numbers")
   - `DESTINATION_NUMBER` : le numéro fixe qui recevra les SMS
   - `TWILIO_SENDER_ID` (optionnel) : nom affiché comme expéditeur (ex: "MonSite")
     au lieu du numéro. Max 11 caractères alphanumériques. Le destinataire ne
     pourra pas répondre à ce message. Non disponible aux États-Unis/Canada,
     et certains pays exigent un enregistrement préalable — vérifie sur ta
     console Twilio si c'est supporté pour le pays du destinataire. Laisse
     vide pour utiliser simplement le numéro Twilio.

## Lancement

```
npm start
```

Puis ouvrir http://localhost:3000 dans le navigateur.

## Important — sécurité

- Ne jamais publier le fichier `.env` (ajoute-le à `.gitignore` si tu utilises Git).
- L'Auth Token Twilio est un secret : ne le mets jamais dans du code visible côté navigateur.
- En essai gratuit Twilio, tu ne peux envoyer des SMS qu'à des numéros vérifiés dans ta console.

## En-tête (nom expéditeur)

La page a maintenant un champ "En-tête" où on tape directement le nom à
afficher comme expéditeur (ex: "MonSite"), à chaque envoi — plus besoin de le
configurer dans `.env`. Limites imposées par Twilio : 11 caractères max,
lettres et chiffres uniquement, sans espace. Si le champ est laissé vide, le
numéro Twilio (`TWILIO_FROM_NUMBER`) est utilisé comme expéditeur à la place.

Comme pour le Sender ID, le destinataire ne pourra pas répondre à un message
envoyé avec un en-tête texte, et cette fonctionnalité n'est pas disponible
dans tous les pays (interdite aux États-Unis/Canada notamment).

## Sélecteur de pays (Afrique)

La page propose maintenant un menu déroulant avec tous les pays d'Afrique et
leur drapeau (Bénin +229 sélectionné par défaut). L'utilisateur choisit le
pays, tape son numéro local (sans l'indicatif ni le 0 initial), et le site
compose automatiquement le numéro complet (ex: +229 90000000).

`DESTINATION_NUMBER` dans `.env` sert uniquement de numéro de secours si aucun
numéro n'est envoyé par le formulaire — dans l'usage normal, c'est le pays +
numéro choisis sur la page qui définissent le destinataire.

## Déploiement

Ce site peut être déployé sur n'importe quel hébergeur Node.js (Render, Railway, Heroku, VPS...).
Il suffit de définir les mêmes variables d'environnement sur la plateforme choisie.
