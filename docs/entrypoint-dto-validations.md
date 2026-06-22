# Entrypoint DTO Validations

## 1. Overview

This document describes the DTO-level validation rules applied to the `alias` field across the `users` module. It covers the format constraints enforced at request time and the runtime uniqueness guard applied during profile updates.

The implementation is split into two layers:
*   **DTO validation** — handled by NestJS's `ValidationPipe` using `class-validator` decorators. Runs before the controller method is invoked.
*   **Service-level check** — a database query that confirms the alias is not already registered to a different user.

## 2. Affected Endpoints

| Method | Path | Auth | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/users/validate-alias` | JWT required | Validates alias format and checks availability |
| `PATCH` | `/users/:id` | JWT required | Updates user profile; enforces alias uniqueness on change |

## 3. `ValidateAliasDto` — Field Constraints

Defined at: `src/modules/users/dto/validate-alias.dto.ts`

```ts
@IsString()
@MaxLength(80)
@Matches(/^[a-z0-9.!_]+$/, {
  message: 'Alias must only contain lowercase letters, numbers, and allowed symbols (., !, _)',
})
alias: string;
```

| Rule | Detail |
| :--- | :--- |
| `@IsString()` | Value must be a string; rejects missing or non-string inputs |
| `@MaxLength(80)` | Alias cannot exceed 80 characters |
| `@Matches(...)` | Only `a-z`, `0-9`, `.`, `!`, and `_` are accepted |
| No spaces | Whitespace has no place in the allowed charset and will fail the regex |
| No uppercase | Characters `A-Z` are outside the allowed charset and will fail the regex |

## 4. `GET /users/validate-alias` — Response Scenarios

### 4.1 Success (`200 OK`)

The endpoint returns `200 OK` in both outcomes below. The `available` boolean is the discriminator.

| Scenario | Example Input | Response |
| :--- | :--- | :--- |
| Alias is valid and free | `?alias=john_doe1` | `{ "available": true }` |
| Alias is valid but taken | `?alias=jane.doe` | `{ "available": false }` |

### 4.2 Validation Failures (`400 Bad Request`)

The following are rejected at the DTO layer before the service or database is reached.

| Scenario | Example Input | Failing Rule |
| :--- | :--- | :--- |
| Contains a space | `?alias=john doe` | `@Matches` — whitespace not in charset |
| Contains uppercase letters | `?alias=JohnDoe` | `@Matches` — uppercase not in charset |
| Contains a disallowed symbol | `?alias=john@doe` | `@Matches` — `@` not in `[a-z0-9.!_]` |
| Exceeds 80 characters | `?alias=aaa...` (81 chars) | `@MaxLength(80)` |
| Empty string | `?alias=` | `@Matches` — `+` quantifier requires at least one character |
| Missing query param | `GET /users/validate-alias` | `@IsString()` — value is `undefined` |

Sample error response:
```json
{
  "statusCode": 400,
  "message": [
    "Alias must only contain lowercase letters, numbers, and allowed symbols (., !, _)"
  ],
  "error": "Bad Request"
}
```

## 5. `PATCH /users/:id` — Uniqueness Guard

When the request body includes an `alias` field, the service performs an additional check before persisting the update.

### 5.1 Execution Flow

```
PATCH /users/:id  { alias: "new_alias" }
  │
  ├─ 1. Fetch user by :id
  │       Not found → 404 Not Found
  │
  ├─ 2. Is the incoming alias the same as the current alias?
  │       Yes → skip uniqueness check (no change)
  │
  └─ 3. Query database: is alias taken by another user?
          Yes → 409 Conflict
          No  → save and return updated user
```

### 5.2 Failure Cases

| Scenario | HTTP Status | Message |
| :--- | :--- | :--- |
| User `:id` does not exist | `404 Not Found` | `"User no encontrado"` |
| Alias already registered to a different user | `409 Conflict` | `"Alias is already taken"` |

> **Note:** A user submitting their own current alias (e.g., saving a settings form without changing it) is **not** treated as a conflict. Step 2 short-circuits the check to avoid a false positive.
