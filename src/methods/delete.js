import isPlainObject from 'lodash/isPlainObject';
import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import flagDeleted from '../utils/flag-deleted';
import getScopeId from '../utils/get-scope-id';

/**
 * Delete an `object`
 * !! Only certain objects can be deleted see `checkDeleteAcl` for details
 * Note: `node` can only be "deleted" through UpdateAction (and subclasses)
 * Note: ArchiveAction can be used to archive PublicationType and WorkflowSpecification
 */
export default async function deleteMethod(object, { store, acl } = {}) {
  if (typeof object !== 'string' && !isPlainObject(object)) {
    throw createError(400, 'Invalid object parameter for checkDeleteAcl');
  }

  object = await this.get(object, {
    store,
    acl: false
  });

  try {
    await this.checkDeleteAcl(object, { store, acl });
  } catch (err) {
    throw err;
  }

  const [scopeId, type] = parseIndexableString(object._id);

  switch (type) {
    case 'org': {
      // delete the associated stripe account (if any)
      let account;
      try {
        account = await this.getStripeAccountByOrganizationId(scopeId, {
          store
        });
      } catch (err) {
        // noop (there may not be an account associated with this org)
        // TODO finer grain error handling
      }
      if (account) {
        try {
          await this.stripe.accounts.del(account.id);
        } catch (err) {
          // TODO better error message if not  all balances are zero.
          throw err;
        }
      }

      let customer;
      try {
        customer = await this.getStripeCustomerByOrganizationId(scopeId, {
          store
        });
      } catch (err) {
        // noop (there may not be a customer associated with this org)
        // TODO finer grain error handling
      }
      if (customer) {
        try {
          await this.stripe.customers.del(customer.id);
        } catch (err) {
          // TODO better error message
          throw err;
        }
      }

      let deletedDocs = [];
      const periodicals = await this.getPeriodicalsByOrganizationId(scopeId, {
        store
      });
      for (const periodical of periodicals) {
        // first delete the graphs
        const graphs = await this.getGraphsByPeriodicalId(getId(periodical), {
          store
        });
        const graphScopeIds = Array.from(
          new Set(graphs.map(graph => getScopeId(graph)))
        );

        for (const graphScopeId of graphScopeIds) {
          const graphDeletedDocs = await this.deleteScope(graphScopeId, {
            store,
            force: true
          });
          deletedDocs.push(...graphDeletedDocs);
        }

        // delete journal scope
        const periodicalDeletedDocs = await this.deleteScope(
          getId(periodical),
          {
            store,
            force: true
          }
        );
        deletedDocs.push(...periodicalDeletedDocs);
      }

      const organizationDeletedDocs = await this.deleteScope(scopeId, {
        store,
        force: true
      });

      return itemListify([...organizationDeletedDocs, ...deletedDocs]);
    }

    case 'journal': {
      let deletedDocs = [];
      // first delete the graphs
      const graphs = await this.getGraphsByPeriodicalId(scopeId, { store });
      const graphScopeIds = Array.from(
        new Set(graphs.map(graph => getScopeId(graph)))
      );

      for (const graphScopeId of graphScopeIds) {
        const graphDeletedDocs = await this.deleteScope(graphScopeId, {
          store,
          force: true
        });
        deletedDocs.push(...graphDeletedDocs);
      }

      // delete journal scope
      const periodicalDeletedDocs = await this.deleteScope(scopeId, {
        store,
        force: true
      });
      return itemListify([...periodicalDeletedDocs, ...deletedDocs]);
    }

    case 'graph': {
      const graph = object;
      if (graph.version != null) {
        throw createError(
          403,
          `${object['@type'] ||
            'type'} cannot be deleted (version). Try deleting the live Graph instead.`
        );
      }
      const deleted = await this.deleteScope(scopeId, { store, force: true });
      return itemListify(deleted);
    }

    case 'issue': {
      const issue = object;
      switch (issue['@type']) {
        case 'SpecialPublicationIssue': {
          const deletedIssue = flagDeleted(issue);
          const deleted = await this.put(deletedIssue, {
            store,
            force: true,
            deleteBlobs: true
          });

          try {
            await this.syncIssue(deletedIssue, { store });
          } catch (err) {
            this.log.error({ err, issue: deletedIssue }, 'error syncing issue');
          }
          return itemListify(deleted);
        }

        default:
          throw createError(
            403,
            `${object['@type'] || type} cannot be deleted.`
          );
      }
    }

    case 'action': {
      const action = object;

      switch (action['@type']) {
        case 'UploadAction':
        case 'InviteAction':
        case 'RequestArticleAction':
        case 'ApplyAction':
        case 'InformAction': {
          // only potential or active ones can be deleted
          if (
            action.actionStatus !== 'PotentialActionStatus' &&
            action.actionStatus !== 'ActiveActionStatus'
          ) {
            throw createError(
              403,
              `${action['@type']} in actionStatus ${
                action.actionStatus
              } cannot be deleted`
            );
          }

          const deleted = await this.put(flagDeleted(action), {
            store,
            force: true,
            deleteBlobs: true
          });
          return itemListify(deleted);
        }

        case 'TagAction': {
          const deleted = await this.put(flagDeleted(action), {
            store,
            force: true,
            deleteBlobs: true
          });
          return itemListify(deleted);
        }

        case 'CommentAction': {
          const children = await this.getChildCommentActions(object);

          const deleted = await this.put(
            [object].concat(children).map(action => flagDeleted(action)),
            { store, force: true, deleteBlobs: true }
          );
          return itemListify(deleted);
        }

        default:
          throw createError(
            403,
            `${object['@type'] || type} cannot be deleted.`
          );
      }
    }

    default:
      throw createError(403, `${object['@type'] || 'type'} cannot be deleted.`);
  }
}

function itemListify(list) {
  list = arrayify(list);
  return {
    '@type': 'ItemList',
    numberOfItems: list.length,
    itemListElement: list.map(item => {
      return {
        '@type': 'ListItem',
        item
      };
    })
  };
}
