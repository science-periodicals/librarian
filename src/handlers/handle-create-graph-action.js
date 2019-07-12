import crypto from 'crypto';
import moment from 'moment';
import omit from 'lodash/omit';
import pick from 'lodash/pick';
import uniqBy from 'lodash/uniqBy';
import pickBy from 'lodash/pickBy';
import createError from '@scipe/create-error';
import { parseIndexableString } from '@scipe/collate';
import {
  arrayify,
  getId,
  flatten,
  contextUrl,
  relabelNodes,
  getNodeMap,
  nodeify
} from '@scipe/jsonld';
import { getAgentId, getObjectId } from '../utils/schema-utils';
import {
  isRole,
  validateDigitalDocumentPermission,
  validateGraphNodes
} from '../validators';
import createId from '../create-id';
import handleParticipants from '../utils/handle-participants';
import handleUserReferences from '../utils/handle-user-references';
import { COPIED_ROLE_PROPS, CONTRIBUTOR_PROPS } from '../constants';
import remapRole from '../utils/remap-role';
import { normalizePermissions } from '../acl';
import setId from '../utils/set-id';
import validateAndSetupCreatedCreativeWorkRoles from '../utils/validate-and-setup-created-creative-work-roles';
import { getFramedGraphTemplate } from '../utils/workflow-actions';
import findRole from '../utils/find-role';
import { setEmbeddedIds } from '../utils/embed-utils';

// TODO handle / validate `Graph.isInResponseTo` (link to RFA if the graph is created in response to an RFA)

/**
 * Note: we can use sameAs of role to setup graph role @id ahead of time:
 *
 * {
 *   '@type': 'CreateGraphAction',
 *   actionStatus: 'CompletedActionStatus',
 *   agent: AUTHOR_ID,
 *   participant: JOURNAL_EDITOR_ROLE_ID,
 *   object: WORKFLOW_SPECIFICATION_ID,
 *   result: {
 *     '@id': GRAPH_ID,
 *     '@type': 'Graph',
 *     additionalType: PUBLICATION_TYPE_ID,
 *     editor: {
 *       '@id': JOURNAL_EDITOR_ROLE_ID,
 *       sameAs: GRAPH_EDITOR_ROLE_ID
 *     },
 *     author: {
 *       '@id': GRAPH_AUTHOR_ROLE_ID,
 *       '@type': 'ContributorRole',
 *       roleName: 'author',
 *       author: AUTHOR_ID
 *     }
 *   }
 * }
 */
export default async function handleCreateGraphAction(
  action,
  {
    store,
    strict = true,
    skipPayments // if set to `true` we don't check if the organization has a valid `customerAccountStatus`
  } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      'CreateGraphAction actionStatus must be CompletedActionStatus'
    );
  }

  const objectId = getObjectId(action);
  if (!objectId) {
    throw createError(
      400,
      'CreateGraphAction must have a valid object pointing to a WorkflowSpecification'
    );
  }

  let workflowSpecification = await this.get(objectId, {
    store,
    acl: false
  });

  if (workflowSpecification['@type'] !== 'WorkflowSpecification') {
    throw createError(
      400,
      'CreateGraphAction must have a valid object pointing to a WorkflowSpecification'
    );
  }

  const agentId = getAgentId(action.agent);
  if (!agentId || !agentId.startsWith('user:')) {
    throw createError(
      400,
      'CreateGraphAction must have a valid agent with a defined user @id'
    );
  }

  const profile = await this.get(agentId, {
    store,
    acl: false
  });

  const [periodicalId] = parseIndexableString(workflowSpecification._id);
  const periodical = await this.get(periodicalId, {
    store,
    acl: false
  });

  // We validate organization `customerAccountStatus` (must be `ValidCustomerAccountStatus`, otherwise we don't let user create submissions)
  if (!skipPayments) {
    const publisherId = getId(periodical.publisher);
    if (publisherId) {
      const organization = await this.get(publisherId, {
        store,
        acl: false
      });

      if (organization.customerAccountStatus !== 'ValidCustomerAccountStatus') {
        throw createError(
          403,
          `The WorkflowSpecification belongs to an organization (${getId(
            organization
          )}) that currently cannot accept incoming submissions`
        );
      }
    }
  }

  // we create a copy of the workflowSpecification so that if it is later updated we can always find that specific version
  const archivedId = createId(
    'workflow',
    workflowSpecification,
    periodical,
    workflowSpecification._rev
  );
  try {
    workflowSpecification = await this.put(
      setId(
        Object.assign(omit(workflowSpecification, ['_rev', '_id']), {
          exampleOfWork: getId(workflowSpecification)
        }),
        archivedId
      ),
      { store }
    );
  } catch (err) {
    if (err.code === 409 || err.code === 202) {
      workflowSpecification = await this.get(archivedId, { acl: false, store });
    } else {
      throw err;
    }
  }

  // handle graph
  const createGraphActionTemplate = arrayify(
    workflowSpecification.potentialAction
  ).find(action => action['@type'] === 'CreateGraphAction');

  if (!createGraphActionTemplate) {
    throw createError(400, 'could not find CreateGraphAction template');
  }

  const graphTemplate = await getFramedGraphTemplate(workflowSpecification);

  let graph = arrayify(action.result).find(
    result => result['@type'] === 'Graph'
  );

  if (
    graph &&
    graph['@id'] &&
    graph['@id'] !== createId('graph', graph['@id'])['@id']
  ) {
    throw createError(400, 'invalid Graph @id');
  }

  const graphId = createId('graph', graph);
  const actionId = createId('action', action, getId(graph));

  if (graph && graph.hasDigitalDocumentPermission) {
    validateDigitalDocumentPermission(graph.hasDigitalDocumentPermission, {
      validGranteeIds: new Set(
        [agentId]
          .concat(
            arrayify(action.participant).map(participant =>
              getAgentId(participant)
            )
          )
          .filter(id => id && id.startsWith('user:'))
      )
    });
  }

  const now = new Date();

  const encryptionKey = {
    '@type': 'EncryptionKey',
    value: crypto.randomBytes(32).toString('hex'),
    initializationVector: crypto.randomBytes(16).toString('hex')
  };

  graph = await flattenAndNormalizeGraph(
    setId(
      Object.assign(
        { encryptionKey },
        omit(graph, ['potentialAction']),
        // template overwrite graph...
        omit(graphTemplate, ['potentialAction']),
        // ...except  for some specific props
        pick(graph, [
          'name',
          'alternateName',
          'description',
          'disambiguatingDescription'
        ]),
        {
          '@context': contextUrl,
          '@type': 'Graph',
          creator: agentId,
          dateCreated: now.toISOString(),
          expectedDatePublishedOrRejected: moment(now)
            .add(moment.duration(workflowSpecification.expectedDuration))
            .toISOString(),
          identifier: 1, // this gets incremented during CreateReleaseAction and provide a short more human readable alternative to the semver `version`
          isPartOf: getId(periodical),
          publisher: getId(periodical.publisher),
          workflow: getId(workflowSpecification)
        },
        // in strict mode we do not let user specify encryption key
        strict
          ? {
              encryptionKey
            }
          : undefined // in non strict mode we let user specify an encryption key in the graph. This is mostly useful for stories so that we have stable anonymous @id across various runs of the story
      ),
      graphId
    ),
    getId(action),
    actionId
  );

  graph = await this.validateAndSetupNodeIds(graph, {
    store,
    strict
  });

  // validate graph
  const messages = validateGraphNodes(graph);
  if (messages.length) {
    throw createError(400, messages.join(' ; '));
  }

  // validate the publication types
  //
  // The `additionalType` property (on `Graph`) is used to list the publication types of the Graph.
  // - We ensure that the types listed belong to the journal
  // - We validate that each publication type list the workflow as eligibleWorkflow if not we error
  // - We embed a subset of the type data for indexing / fast display purpose
  if (graph.additionalType) {
    const typeId = getId(graph.additionalType);
    if (!typeId) {
      throw createError(400, `${action['@type']} invalid additionalType`);
    }
    let type = await this.get(graph.additionalType, {
      store,
      acl: false
    });

    const [typeScopeId] = parseIndexableString(type._id);
    if (
      type['@type'] !== 'PublicationType' ||
      typeScopeId !== periodicalId ||
      !arrayify(type.eligibleWorkflow).some(
        eligibleWorkflow => getId(eligibleWorkflow) === objectId // !getId(workflowSpecification) can be the versioned workflowSpec and not `objectId` in this case `objectId === workflowSpecification.exampleOfWork
      )
    ) {
      throw createError(
        400,
        `${
          action['@type']
        } invalid additionalType. Check that the additional type is a PublicationType, belongs to the Periodical (${periodicalId}) and is compatible with the workflow ${objectId} (eligible workflow)`
      );
    }

    // As for the workflow specification, we take a copy of the type so that we
    // can always display the publication type as it was at the time the article
    // was submitted (the editor can keep editing the type)
    const archivedId = createId('type', type, periodical, type._rev);
    try {
      type = await this.put(
        setId(
          Object.assign(omit(type, ['_rev', '_id']), {
            exampleOfWork: getId(type)
          }),
          archivedId
        ),
        { store }
      );
    } catch (err) {
      if (err.code === 409 || err.code === 202) {
        type = await this.get(archivedId, {
          acl: false,
          store
        });
      } else {
        throw err;
      }
    }

    graph.additionalType = pick(type, ['@id', '@type', 'name']); // embed a subset of the props for indexing purpose
  }

  // Process roles and contributors
  const periodicalRoleMap = getNodeMap(
    arrayify(periodical.creator)
      .concat(...CONTRIBUTOR_PROPS.map(p => periodical[p]))
      .filter(role => isRole(role) && getId(role))
  );

  // The agent is probably new and not listed in the periodical
  const agentRoleId =
    getId(action.agent) || getId(createGraphActionTemplate.agent);
  const enrichedAgent =
    agentRoleId && agentRoleId in periodicalRoleMap
      ? remapRole(periodicalRoleMap[agentRoleId], 'agent', { dates: false })
      : Object.assign(
          {},
          pick(action.agent, COPIED_ROLE_PROPS),
          // make sure that the template overwrites the user defined agent
          // createGraphActionTemplate.agent may not exists or have no agentId (if only a roleName was specified),
          pick(createGraphActionTemplate.agent, COPIED_ROLE_PROPS),
          {
            agent:
              getAgentId(action.agent) ||
              getAgentId(createGraphActionTemplate.agent)
          }
        );

  // The participant _must_ be listed in the periodical
  const enrichedParticipants = uniqBy(
    arrayify(createGraphActionTemplate.participant)
      .concat(arrayify(action.participant))
      .filter(role => getId(role) && getId(role) in periodicalRoleMap)
      .map(participant => {
        return periodicalRoleMap[getId(participant)];
      }),
    role => getId(role)
  ).map(role => remapRole(role, 'participant', { dates: false }));

  graph = validateAndSetupCreatedCreativeWorkRoles(graph, {
    strict,
    agent: enrichedAgent,
    participants: enrichedParticipants,
    agentProfile: profile,
    participantSource: periodical
  });

  // we replace action.agent and action.participiant by the role added to the graph so that we
  // can rely on the agent role @id for blinding (anonymity) in the notifications
  const graphAgentRole = findRole(
    getId(enrichedAgent) && getId(enrichedAgent).startsWith('role:')
      ? omit(nodeify(enrichedAgent), ['@id'])
      : enrichedAgent,
    graph,
    { ignoreMainEntity: true, ignoreEndDateOnPublicationOrRejection: true }
  );

  if (!graphAgentRole) {
    throw createError(
      400,
      'Could not find graph role for agent. This may happen if agent was specified as a user and the same user is present in a different role. Retry by setting the agent as a role'
    );
  }
  const handledAgent = remapRole(graphAgentRole, 'agent', { dates: false });

  const handledParticipants = enrichedParticipants.map(enrichedParticipant => {
    const graphRole = findRole(
      getId(enrichedParticipant) &&
        getId(enrichedParticipant).startsWith('role:')
        ? omit(nodeify(enrichedParticipant), ['@id'])
        : enrichedParticipant,
      graph,
      {
        ignoreMainEntity: true,
        ignoreEndDateOnPublicationOrRejection: true
      }
    );
    if (!graphRole) {
      throw createError(
        400,
        `Could not find graph role for participant ${getId(
          enrichedParticipant
        )}. It may be because the participant (that can come from the action template) was not listed in the result of the CreateGraphAction`
      );
    }
    return remapRole(graphRole, 'participant', { dates: false });
  });

  const handledAction = setId(
    pickBy(
      Object.assign(
        {
          startTime: new Date().toISOString()
        },
        action,
        {
          actionStatus: 'CompletedActionStatus',
          endTime: new Date().toISOString(),
          agent: handledAgent,
          participant: handledParticipants.length
            ? handledParticipants
            : undefined,
          result: pick(graph, ['@id', '@type']),
          instanceOf: getId(createGraphActionTemplate)
        }
        // we want the @id of the createGraphAction to be part of the graph
        // ns so that the action get deleted easily when the graph is deleted
      ),
      x => x !== undefined
    ),
    actionId
  );

  // Start workflow stage (if any)...
  const startWorkflowStageActionTemplate = arrayify(
    graphTemplate.potentialAction
  ).find(action => action['@type'] === 'StartWorkflowStageAction');

  const workflowActions = [];

  // We make sure that the stage starts _after_ the endTIme of the CreateGraphAction
  const stageStartDate = new Date(
    new Date(handledAction.endTime).getTime() + 1
  );
  if (startWorkflowStageActionTemplate) {
    const {
      startWorkflowStageAction,
      instantiatedActions
    } = await this.instantiateWorkflowStage(
      startWorkflowStageActionTemplate,
      workflowSpecification,
      getId(graph),
      {
        agent: handledAction.agent,
        startTime: stageStartDate.toISOString(),
        endTime: stageStartDate.toISOString()
      }
    );

    // for convenience, we add the StartWorkflowStageAction @id as potential action of the result of the handled action
    handledAction.result.potentialAction = getId(startWorkflowStageAction);

    workflowActions.push(startWorkflowStageAction, ...instantiatedActions);
  }

  const lock = await this.createLock(getId(graph), {
    prefix: 'create-graph',
    isLocked: async () => {
      const hasUniqId = await this.hasUniqId(getId(graph));

      let prevGraph;
      try {
        prevGraph = await this.get(getId(graph), { store });
      } catch (err) {
        if (err.code !== 404) {
          throw err;
        }
      }

      return hasUniqId || !!prevGraph;
    }
  });

  let savedAction, savedGraph, savedWorkflowActions;
  try {
    [savedAction, savedGraph, ...savedWorkflowActions] = await this.put(
      [
        handleParticipants(handledAction, graph),
        omit(graph, ['potentialAction']),
        ...workflowActions.map(action =>
          handleUserReferences(handleParticipants(action, graph), graph)
        )
      ],
      { store, force: true }
    );
  } catch (err) {
    throw err;
  } finally {
    try {
      await lock.unlock();
    } catch (err) {
      this.log.error(
        { err },
        'could not release lock, but it will auto expire'
      );
    }
  }

  try {
    var syncedGraph = await this.syncGraph(savedGraph, savedWorkflowActions, {
      store
    });
  } catch (err) {
    this.log.error(
      { err, actions: savedWorkflowActions },
      'error syncing graphs'
    );
  }

  if (
    savedWorkflowActions.some(
      action =>
        action['@type'] === 'CreateReleaseAction' &&
        action.releaseRequirement === 'ProductionReleaseRequirement' &&
        action.actionStatus === 'ActiveActionStatus'
    )
  ) {
    // issue CheckActions
    await this.syncCheckActions(savedGraph, {
      store,
      now: stageStartDate
    });
  }

  return Object.assign({}, savedAction, {
    result: Object.assign(
      Object.assign(
        {},
        savedGraph,
        syncedGraph ? { _rev: syncedGraph._rev } : undefined
      ),
      savedWorkflowActions.length
        ? { potentialAction: savedWorkflowActions }
        : undefined
    )
  });
}

async function flattenAndNormalizeGraph(
  graph,
  actionId, // the actionId entered by the user (can be a blank node)
  nextActionId // the actionId that we will set for the action
) {
  if (!graph) {
    return graph;
  }

  graph = normalizePermissions(graph);

  const relabelMap = { [getId(actionId)]: getId(nextActionId) };

  let normalizedGraph = await flatten(pick(graph, ['@graph', 'mainEntity']));
  relabelNodes(normalizedGraph, {
    relabelMap,
    blankNode: true
  });

  return setEmbeddedIds(
    Object.assign({}, graph, normalizedGraph, {
      resultOf: getId(nextActionId)
    })
  );
}
