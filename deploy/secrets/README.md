# Firebase Admin credentials for Docker

Place your service account JSON here:

```
deploy/secrets/firebase-admin.local.json
```

Then uncomment the `volumes` lines for `auth-backend` and `dashboard-backend` in `deploy/docker-compose.yml`.

**Do not commit this file.** It is listed in `.gitignore`.

Alternative: set `FIREBASE_SERVICE_ACCOUNT` or `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` in `deploy/.env` instead of mounting a file.
