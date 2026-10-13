<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1ed-K-J5usbPzs8bmGVd65OOEm9j1yVt-

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy [.env.example](.env.example) to `.env` and set the values
3. Run the app:
   `npm run dev`

## Deploy to Vercel

1. Import this repo in Vercel (framework: Other / configured via `vercel.json`).
2. Set **Environment Variables** (Production + Preview):

| Variable | When needed | Notes |
|----------|-------------|--------|
| `GEMINI_API_KEY` | Build | Required for synthesis |
| `APP_PASSWORD` | Build | Standalone unlock password |
| `VWX_KEY_ID` | Runtime | VisionWorx signing key id |
| `VWX_SECRET` | Runtime | Server-only HMAC secret |
| `VWX_APP_HOST` | Runtime | Allowed callback host (optional; defaults allow vision-worx.com + `*visionworx*.vercel.app`) |

Enable **Build** access for `GEMINI_API_KEY` and `APP_PASSWORD` (Vite bakes them at build time). Keep `VWX_*` server-only — do not prefix with `VITE_`.

3. Deploy. The SPA is served from `dist`; `POST /api/visionworx-save` runs as a Vercel Serverless Function.

## VisionWorx

Optional Gen Tools integration. After the three `VWX_*` vars are set and the app is redeployed:

- Standalone (no `vwx_run` / `vwx_callback`): password gate; no VisionWorx posts.
- From VisionWorx **Open…**: no password; after a successful visualization the server signs and POSTs the image to `vwx_callback`.
