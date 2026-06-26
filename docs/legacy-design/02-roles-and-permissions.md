# Roles and Permissions — Original Design
> Source: `الادوار والصلاحيات.odt`  
> Date: ~2026-03 (Replit phase)

## System Roles (6 roles)

| Role | Description |
|------|-------------|
| `system_owner` | System owner — sees everything across all organizations |
| `admin` | Company admin — sees everything within their organization only |
| `project_manager` | Project manager |
| `document_controller` | Document controller |
| `reviewer` | Reviewer only |
| `viewer` | Read-only — default role |

## Section Visibility by Role

| Section | Who can access |
|---------|---------------|
| Billing | `admin` and `system_owner` only |
| System Admin | `admin` and `system_owner` only |
| AI Settings | `admin` and `system_owner` only (inside System Admin) |
| Configuration | `admin` and `system_owner` only |
| Organization list | `system_owner` sees all orgs — `admin` sees own org only |

All other roles (`project_manager`, `document_controller`, `reviewer`, `viewer`) do not see any of these sections.

## Divergence from Current Implementation

**Known issue identified in `system logic 1.odt`:** `admin` is treated identically to `system_owner` in `isSysAdmin()`:
```typescript
export function isSysAdmin(user: AuthUser): boolean {
  return user.role === "system_owner" || user.role === "admin";
}
```
This means `admin` can see all organizations cross-org — contrary to the design intent that admin is org-scoped only.
