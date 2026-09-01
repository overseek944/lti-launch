# 1. Tenancy is keyed on issuer, client ID and deployment ID together

**Status:** accepted

## Context

An LTI launch carries an issuer, an audience (the client ID) and a deployment
ID. The issuer is the obvious tenant key and it is wrong.

One platform issuer can host many deployments. Several districts share a
regional Canvas instance. One district has several sub-accounts. Each is a
separate deployment of the same tool against the same issuer.

## Decision

The tenancy key is the triple `(iss, client_id, deployment_id)`. A launch whose
triple has no registration is refused with `unknown_deployment` rather than
being resolved to a near match.

## Consequences

Two districts sharing an LMS host cannot see each other's data. Keying on the
issuer alone would be a data isolation failure, not a bug, and it would be
discovered either during a security review or by a district.

The cost is that the deployment ID lives in the token body, so the token has to
be decoded once before it can be verified, in order to find the key to verify it
with. That decode is explicitly untrusted and used only for lookup.
