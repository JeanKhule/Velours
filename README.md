# BM

PWA locale (Vite + React + TypeScript). Spec : `docs/plan_application.md`.

- `npm install` puis `npm run dev` → http://localhost:5173 (aussi exposé sur le réseau local pour tester sur téléphone).
- `npm run build` → `dist/` ; `npm run preview` pour la tester.
- `node scripts/check-crypto.ts` : vérifie le chiffrement (bon PIN déchiffre, mauvais PIN échoue, rien en clair).

Données : un seul enregistrement IndexedDB chiffré AES‑GCM, clé dérivée du PIN (PBKDF2‑SHA256, 600 000 itérations). La clé ne vit qu'en mémoire et disparaît dès que l'app passe en arrière‑plan.
