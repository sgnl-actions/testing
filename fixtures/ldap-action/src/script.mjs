/**
 * Sample LDAP Action - Add User to Group
 * 
 * Demonstrates how to create an action that uses LDAP operations.
 * This is a reference implementation for testing LDAP actions.
 */
import { Client, Change, Attribute } from 'ldapts';

/**
 * Add user to LDAP group
 * @param {string} userPrincipalName - User's email address
 * @param {string} groupDN - Distinguished name of the target group
 * @param {string} ldapUrl - LDAP server URL
 * @param {string} baseDN - Base DN for searches
 * @param {string} bindUser - Service account for LDAP binding
 * @param {string} bindPassword - Service account password
 * @returns {Object} Result of the operation
 */
async function addUserToGroup(userPrincipalName, groupDN, ldapUrl, baseDN, bindUser, bindPassword) {
  const client = new Client({ url: ldapUrl });
  
  try {
    // Step 1: Bind to LDAP server
    await client.bind(bindUser, bindPassword);
    
    // Step 2: Search for user by email
    const searchResult = await client.search(`OU=Users,${baseDN}`, {
      scope: 'sub',
      filter: `(mail=${userPrincipalName})`,
      attributes: ['distinguishedName', 'memberOf']
    });
    
    if (!searchResult.searchEntries || searchResult.searchEntries.length === 0) {
      throw new Error('User not found');
    }
    
    const user = searchResult.searchEntries[0];
    const userDN = user.attributes.distinguishedName;
    const currentGroups = user.attributes.memberOf || [];
    
    // Check if user is already in the group (idempotency)
    if (currentGroups.includes(groupDN)) {
      return {
        status: 'success',
        userDN,
        groupDN,
        alreadyInGroup: true
      };
    }
    
    // Step 3: Add user to group
    const change = new Change({
      operation: 'add',
      modification: new Attribute({
        type: 'member',
        values: [userDN]
      })
    });
    
    await client.modify(groupDN, change);
    
    return {
      status: 'success',
      userDN,
      groupDN,
      alreadyInGroup: false
    };
    
  } finally {
    // Step 4: Always unbind
    await client.unbind();
  }
}

export default {
  /**
   * Main execution handler
   */
  invoke: async (params, context) => {
    console.log('Starting LDAP add user to group operation');
    
    const {
      userPrincipalName,
      groupDN
    } = params;
    
    const {
      LDAP_URL,
      LDAP_BASE_DN
    } = context.environment;
    
    const {
      LDAP_BIND_USER,
      LDAP_BIND_PASSWORD
    } = context.secrets;
    
    console.log(`Adding user ${userPrincipalName} to group ${groupDN}`);
    
    try {
      const result = await addUserToGroup(
        userPrincipalName,
        groupDN,
        LDAP_URL,
        LDAP_BASE_DN,
        LDAP_BIND_USER,
        LDAP_BIND_PASSWORD
      );
      
      if (result.alreadyInGroup) {
        console.log('User was already in the group');
      } else {
        console.log('Successfully added user to group');
      }
      
      return result;
      
    } catch (error) {
      console.error(`Failed to add user to group: ${error.message}`);
      throw error;
    }
  },
  
  /**
   * Error recovery handler
   */
  error: async (params, _context) => {
    const { error, userPrincipalName, groupDN } = params;
    console.error(`LDAP operation failed for user ${userPrincipalName}, group ${groupDN}: ${error.message}`);
    throw error;
  },
  
  /**
   * Graceful shutdown handler
   */
  halt: async (params, _context) => {
    console.log('LDAP operation is being halted');
    return {
      status: 'halted',
      reason: params.reason,
      halted_at: new Date().toISOString()
    };
  }
};