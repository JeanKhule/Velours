# BM

PWA 100 % locale (Vite + React + TypeScript). Aucun serveur, aucun compte, aucune donnée en ligne.

- `npm install` puis `npm run dev` → http://localhost:5173
- `npm run build` → `dist/` (publié sur GitHub Pages par `.github/workflows/pages.yml`)
- `node scripts/check.ts` : chiffrement, enveloppes, règles du jeu, QR.

## Comment ça marche

- **Profil** : pseudo + PIN. Tout l'état est un seul enregistrement IndexedDB chiffré AES‑GCM, clé dérivée du PIN (PBKDF2‑SHA256, 600 000 itérations). Verrouillage dès que l'app passe en arrière‑plan. Bouton panique (même sans PIN) : efface tout.
- **Appairage** : face à face, chaque téléphone scanne le QR de l'autre (clé publique ECDH P‑256). Chacun dérive la même clé secrète ; un code de sécurité à 6 chiffres permet de vérifier.
- **Échanges** : chaque action produit un lien scellé (`…#m=…`, compressé + AES‑GCM) à envoyer par la messagerie de son choix. Le contenu est après `#` : jamais transmis à l'hébergeur. Un lien modifié ou venant d'un autre couple est rejeté. Chaque lien renvoie les deux derniers jours, donc un lien perdu se rattrape au suivant.
