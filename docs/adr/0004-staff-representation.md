# 4. Employees are organisation members with an explicit Staff role

- Status: accepted — founder approved DEC-013 on 2026-11-14
- Date: 2026-11-14

## Context

R0 found every current Academia user has audience `employee` (`docs/discovery/R0_DISCOVERY_REPORT.md`
D4). Inspironics employees are not one of the five personas.

## Decision

1. Employees are represented by an `organization_memberships` row in the **Inspironics** organisation plus an explicit `staff` role assignment.
2. Staff may also hold `learner`, `mentor`, `assessor` or administrator assignments. Each is a separate, scoped, dated role assignment.
3. **Employment never grants privileged access automatically.** Membership and the `staff` role confer no administrative permission; administrator rights come only from an explicit `platform_admin` (or scoped admin) assignment.

## Migration of existing users (R1)

| Existing data | Becomes |
|---|---|
| Academia user with audience `employee` or `leadership` | Inspironics membership + `staff` |
| Academia user with role `user` | `learner` |
| Academia user with role `admin` | `platform_admin` (keeps current employee access working) |
| Academia user with audience `intern` | Inspironics membership + `intern`; **no** `staff` role |

The existing `users.role` and `users.audience` columns remain and stay consistent for backwards compatibility.
