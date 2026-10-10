# SentinelFlow Frontend

React + Vite dashboard for the deployed SentinelFlow FastAPI backend.

## Requirements
- Node.js 18+ (Node.js 20 LTS recommended)
- Internet connection for the hosted API

## Run locally
1. Extract this folder.
2. Open a terminal in the `sentinelflow-frontend` folder.
3. Run:

   ```bash
   npm install
   npm run dev
   ```

4. Open the local URL Vite prints, usually `http://localhost:5173`.

The frontend defaults to:
`https://sentinelflow-backend-4337.onrender.com`

To override the API base URL, copy `.env.example` to `.env` and set `VITE_API_BASE_URL`.

## Production build check
```bash
npm run build
```

## Backend endpoints used
- `GET /health`
- `GET /api/v1/scada/readings`
- `GET /api/v1/scada/alerts`

The UI tolerates the current backend's SQLite array rows as well as object-based rows. It shows loading, empty, and connection-error states and refreshes data every 15 seconds.

## Important notes
- The API currently uses threshold-based detection according to the backend code supplied for this project. The frontend displays backend results and does not claim to run machine learning in the browser.
- If the browser reports a CORS error, update the FastAPI CORS configuration to allow the frontend's deployed domain.
- Render free web services may sleep when idle. The first request can take longer.
- SQLite data on a default ephemeral host may not persist across redeployments/restarts. Use persistent storage or a managed database if persistence is required.
