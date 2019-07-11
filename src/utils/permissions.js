import { getId } from '@scipe/jsonld';

export function getDefaultPeriodicalDigitalDocumentPermissions(
  user,
  { createGraphPermission = false, publicReadPermission = false } = {}
) {
  // Note by default journals are _not_ visible publicly and are _not_ accepting submissions
  const permissions = [
    // user is admin of the journal
    {
      '@type': 'DigitalDocumentPermission',
      permissionType: 'AdminPermission',
      grantee: getId(user)
    },
    // any journal staff and invited authors and reviewer can see it
    {
      '@type': 'DigitalDocumentPermission',
      permissionType: 'ReadPermission',
      grantee: ['editor', 'producer', 'author', 'reviewer'].map(
        audienceType => {
          return {
            '@type': 'Audience',
            audienceType: audienceType
          };
        }
      )
    },

    // only editor and producer can edit it
    // Note: `WritePermission` is also required to be able to complete `PublishAction` (a PublishAction is a "write" to the journal)
    {
      '@type': 'DigitalDocumentPermission',
      permissionType: 'WritePermission',
      grantee: ['editor', 'producer'].map(audienceType => {
        return {
          '@type': 'Audience',
          audienceType: audienceType
        };
      })
    }
  ];

  if (createGraphPermission) {
    permissions.push({
      '@type': 'DigitalDocumentPermission',
      permissionType: 'CreateGraphPermission',
      grantee: {
        '@type': 'Audience',
        audienceType: 'user'
      }
    });
  }

  if (publicReadPermission) {
    permissions.push({
      '@type': 'DigitalDocumentPermission',
      permissionType: 'ReadPermission',
      grantee: {
        '@type': 'Audience',
        audienceType: 'public'
      }
    });
  }

  return permissions;
}

export function getDefaultGraphDigitalDocumentPermissions() {
  return [
    // Every role has access to the Graph
    {
      '@type': 'DigitalDocumentPermission',
      permissionType: 'ReadPermission',
      grantee: ['editor', 'author', 'reviewer', 'producer'].map(
        audienceType => {
          return {
            '@type': 'Audience',
            audienceType
          };
        }
      )
    },
    // Every role can perform actions targeting the Graph (for Graph, WritePermission => perform action)
    {
      '@type': 'DigitalDocumentPermission',
      permissionType: 'WritePermission',
      grantee: ['editor', 'author', 'reviewer', 'producer'].map(
        audienceType => {
          return {
            '@type': 'Audience',
            audienceType
          };
        }
      )
    },
    // Only editors and producers are Graph admins
    {
      '@type': 'DigitalDocumentPermission',
      permissionType: 'AdminPermission',
      grantee: ['editor', 'producer'].map(audienceType => {
        return {
          '@type': 'Audience',
          audienceType
        };
      })
    },
    // ViewIdentityPermission: open peer review
    {
      '@type': 'DigitalDocumentPermission',
      permissionType: 'ViewIdentityPermission',
      grantee: ['editor', 'author', 'reviewer', 'producer'].map(
        audienceType => {
          return {
            '@type': 'Audience',
            audienceType: audienceType
          };
        }
      ),
      permissionScope: ['editor', 'author', 'reviewer', 'producer'].map(
        audienceType => {
          return {
            '@type': 'Audience',
            audienceType: audienceType
          };
        }
      )
    }
  ];
}
