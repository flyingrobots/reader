# Reserve uploader provenance for authenticated uploads

Issue: [Reader #255](https://github.com/flyingrobots/reader/issues/255).

## Outcome

MCP and CLI deliveries cannot choose `provenance.uploaded_by`; authenticated web uploads continue to record the server's uploader identity.

## Scope

Separate caller-supplied provenance from the upload handler's server-owned identity. Keep the intended caller privacy selection explicit in the delivery documentation. Update the MCP input-schema golden only for the changed contract.

## Acceptance and validation

- Observe a regression failure through MCP `reader_ingest` when a caller supplies an uploader.
- Exercise the equivalent CLI boundary and ensure refused submissions create no receipt.
- Preserve authenticated uploader receipts and retry ownership using the existing upload tests.
- Run the contract suite inside the test sandbox, inspect the exact schema change, and repeat new boundary regressions.
- Keep this PR in draft until these checks and CI pass. Replace this active plan with a dated verification record when implementation is complete.

This plan is agent-written and has not received human editorial review.
