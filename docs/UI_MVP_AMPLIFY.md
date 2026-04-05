# UI MVP on Amplify

This MVP UI is a static frontend in `ui/` hosted by Amplify.

## What It Does

- Creates a supervisor session.
- Sends `develop`, `edit`, or `evaluate` requests.
- Polls run status.
- Displays latest prose and evaluator artifacts.

## Files

- `ui/index.html`
- `ui/styles.css`
- `ui/app.js`
- `amplify.yml`

## Supervisor API Requirement

The browser app calls the Supervisor API, so ensure the API is reachable from Amplify and CORS is set.

Required env for API server:

- `AWS_REGION`
- `STATE_MACHINE_ARN`
- `ARTIFACT_DDB_TABLE`
- Optional: `SUPERVISOR_CORS_ORIGIN=https://<your-amplify-domain>`

For quick local testing, `SUPERVISOR_CORS_ORIGIN=*` works.

## Deploy via Amplify

1. In AWS Amplify, connect this GitHub repo/branch.
2. Amplify will detect `amplify.yml` and publish the `ui/` folder as static content.
3. Open the deployed site.
4. Set the "Supervisor API Base URL" field in the UI to your supervisor API endpoint.

Terraform output for deployed endpoint:

- `supervisor_api_url`

## Local UI Test

Serve the `ui/` folder with any static server, then point API Base URL to local supervisor API.

Example API startup:

```bash
AWS_REGION=us-east-1 \
STATE_MACHINE_ARN=<your-state-machine-arn> \
ARTIFACT_DDB_TABLE=<your-artifact-table> \
SUPERVISOR_CORS_ORIGIN=* \
npm run dev:supervisor
```

Then open `ui/index.html` through a local static server.
