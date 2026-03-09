# LDAP Action Example

This directory demonstrates how to create and test LDAP-based actions using the @sgnl-actions/testing framework.

## Structure

- `src/script.mjs` - Sample LDAP action that adds a user to an Active Directory group
- `tests/scenarios.yaml` - Test scenarios demonstrating various LDAP operations
- `tests/fixtures/` - LDAP fixture files (.ldap format) for different operations

## LDAP Fixtures

The LDAP fixtures use YAML format to define LDAP operation results:

### Basic Structure
```yaml
# Comment describing the operation
operation: bind|search|modify|unbind
result: success|error
code: 0|49|68|etc  # LDAP result code
message: "Result message"
```

### Search Results
For search operations, include `searchEntries`:
```yaml
operation: search
result: success
code: 0
searchEntries:
  - dn: "CN=User,OU=Users,DC=corp,DC=example,DC=com"
    attributes:
      distinguishedName: "CN=User,OU=Users,DC=corp,DC=example,DC=com"
      sAMAccountName: "username"
      mail: "user@example.com"
```

## Testing

To test LDAP actions, use the `runLDAPScenarios` function:

```javascript
import { runLDAPScenarios } from '@sgnl-actions/testing/ldap-scenarios';

runLDAPScenarios({
  script: './src/script.mjs',
  scenarios: './tests/scenarios.yaml'
});
```

See `tests/ldap-action.example.js` for a complete example of how to set up LDAP tests.

## Available Fixtures

- `bind-success.ldap` - Successful LDAP bind
- `bind-error.ldap` - Failed LDAP bind (invalid credentials)
- `search-user-found.ldap` - User search with results
- `search-no-results.ldap` - User search with no results
- `modify-success.ldap` - Successful LDAP modify operation
- `unbind-success.ldap` - Successful LDAP unbind

## Common LDAP Result Codes

- `0` - Success
- `49` - Invalid credentials
- `68` - Already exists
- `32` - No such object
- `10` - Referral

## Scenarios Covered

1. **Successfully add user to group** - Complete flow with bind, search, modify, unbind
2. **User not found** - Handle case where user doesn't exist in directory
3. **Authentication failure** - Handle invalid LDAP credentials
4. **Idempotent operation** - Handle case where user is already in group