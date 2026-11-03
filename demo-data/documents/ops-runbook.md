Ops runbook — Ledgerline payments

Deployment steps
1. Build the API image with npm run build and publish it to the internal registry.
2. Apply database migrations with the migration runner before starting the new image.
3. Restart the payment worker and confirm the queue depth returns to zero.
4. Open the admin console and verify the health panel shows green for payments.

Environment setup
The service reads DATABASE_URL, JWT_SECRET and VENDOR_API_BASE from the environment.
Copy .env.example to .env for local work. Never commit the filled file.

Known issues
The webhook retry queue is not yet deployed and remains blocked on vendor approval.
Until it ships, failed chargeback webhooks must be replayed manually from the admin
console.

The old vendor sandbox key is still active and was never revoked after the prototype
handed over. Rotate it before any external demo.

The reconciliation job occasionally times out on the last business day of the month
because the legacy PHP service holds a long transaction. Restarting the job is safe.

Dependencies
Vendor approval is required before the retry queue can be enabled in production.
The firewall team must allow inbound traffic on port 8443 for the settlement callback.
The finance team approves every change to the settlement export format.

Rollback
Keep the previous image tag available for two weeks. Rolling back requires replaying the
queue manually because the new worker acknowledges messages differently.
