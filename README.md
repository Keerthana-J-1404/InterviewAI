# InterviewAI

## Backend authentication

Protected API requests must include a Firebase ID token in the header:

```text
Authorization: Bearer <firebase-id-token>
```

For local development, configure Firebase Admin credentials in `backend/.env` using either:

- `GOOGLE_APPLICATION_CREDENTIALS` pointing to a local service-account JSON file, or
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`.

When using `FIREBASE_PRIVATE_KEY`, store escaped newlines as `\\n` in the environment value. Never commit the service-account file or `.env`.

For Render, set the same variables in the service environment. Prefer the individual variables when file-based secrets are not available. The Firebase project ID must match the project used by the frontend Firebase configuration.

`GET /` remains a public health check. User, resume, question, live interview, finalization, and history endpoints require a valid Firebase ID token.
