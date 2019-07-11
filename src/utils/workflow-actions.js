import traverse from 'traverse';
import pick from 'lodash/pick';
import omit from 'lodash/omit';
import isPlainObject from 'lodash/isPlainObject';
import cloneDeep from 'lodash/cloneDeep';
import createError from '@scipe/create-error';
import {
  getId,
  arrayify,
  dearrayify,
  flatten,
  frame,
  getNodeMap,
  embed,
  relabelNodes,
  reUuid,
  unprefix
} from '@scipe/jsonld';
import createId from '../create-id';
import {
  isRole,
  isAudience,
  validateDateTimeDuration,
  validateDigitalDocumentPermission
} from '../validators';
import schema from './schema';
import {
  CONTRIBUTOR_PROPS,
  COPIED_ROLE_PROPS,
  RELEASE_TYPES
} from '../constants';
import { getAgent, getAgentId } from '../utils/schema-utils';

export function getStageId(action = {}) {
  return getId(action.resultOf);
}

export function getTemplateId(action = {}) {
  const actionId = getId(action);
  if (actionId && actionId.startsWith('workflow:')) {
    return actionId;
  }

  return getId(action.instanceOf);
}

export async function getFramedGraphTemplate(workflowSpecification) {
  const createGraphActionTemplate = arrayify(
    workflowSpecification.potentialAction
  ).find(action => action['@type'] === 'CreateGraphAction');

  if (!createGraphActionTemplate) {
    throw createError(400, 'could not find CreateGraphAction template');
  }

  const templateNodes = arrayify(createGraphActionTemplate.result['@graph']);
  const templateGraphNodes = templateNodes.filter(
    node => node['@type'] === 'Graph' && node.version == null
  );
  const templateRootGraphs = templateGraphNodes.filter(
    graphNode =>
      !templateNodes.some(node => getId(node.result) === getId(graphNode))
  );

  if (templateRootGraphs.length !== 1) {
    throw createError(
      400,
      `Invalid WorkflowSpecification: ${
        templateRootGraphs.length
      } root Graphs (${templateRootGraphs
        .map(getId)
        .filter(Boolean)
        .join(',')})`
    );
  }

  // Note: the Graph is stored flattened in `createGraphActionTemplate.result` so we reframe it here
  const framedResult = await frame(
    createGraphActionTemplate.result,
    {
      '@id': getId(templateRootGraphs[0]), // !! will be a blank node => must set preserveUuidBlankNodes option to true for framing to work
      '@embed': '@always'
    },
    {
      preserveUuidBlankNodes: true,
      forceRemoveUnnecessaryBlankNodeIds: true // need `forceRemoveUnnecessaryBlankNodeIds` and not just `removeUnnecessaryBlankNodeIds` so that unecessary blank node UUID are removed
    }
  );

  return arrayify(framedResult['@graph'])[0];
}

export function getWorkflowMap(
  framedGraphTemplate,
  { prefix = 'workflow:' } = {},
  workflowMap = {} // used for recursion
) {
  if (!framedGraphTemplate) {
    return workflowMap;
  }
  const object = framedGraphTemplate; // used in recursion so only `framedGraphTemplate` the first time

  if (
    object &&
    typeof object['@id'] === 'string' &&
    object['@id'].startsWith(prefix) &&
    Object.keys(object).length > 1
  ) {
    // only add object to the map, not references
    workflowMap[object['@id']] = object;
  }

  if (object) {
    ['potentialAction', 'result', 'potentialResult'].forEach(p => {
      if (object[p]) {
        arrayify(object[p]).forEach(object =>
          getWorkflowMap(object, { prefix }, workflowMap)
        );
      }
    });
  }

  return workflowMap;
}

export function getInstantiatedActions(
  action,
  // -- parameters used for recursion
  _stageId,
  _actions
) {
  _stageId =
    _stageId ||
    (action['@type'] === 'StartWorkflowStageAction'
      ? getId(action)
      : getId(action.resultOf));
  _actions = _actions || [];

  if (!_stageId) return _actions;

  const actionId = getId(action);
  if (
    action['@type'] !== 'StartWorkflowStageAction' &&
    actionId &&
    actionId !== _stageId &&
    (actionId.startsWith('action:') || actionId.startsWith('message:')) &&
    getId(action.resultOf) === _stageId &&
    getId(action.instanceOf)
  ) {
    // !! we omit the potential action as they are stored in their own documents
    // as well so we don't want to repeat data
    let truncatedAction = omit(action, ['potentialAction']);
    if (
      truncatedAction['@type'] === 'CreateReleaseAction' &&
      isPlainObject(truncatedAction.result)
    ) {
      truncatedAction = Object.assign({}, truncatedAction, {
        result: omit(truncatedAction.result, ['potentialAction'])
      });
    }
    _actions.push(truncatedAction);
  }

  ['result', 'potentialResult', 'potentialAction', 'instrument'].forEach(p => {
    arrayify(action[p]).forEach(value => {
      if (isPlainObject(value)) {
        getInstantiatedActions(value, _stageId, _actions);
      }
    });
  });

  return _actions;
}

export function getInstantiatedAction(action, startWorkflowStageAction) {
  const instantiatedActions = getInstantiatedActions(startWorkflowStageAction);
  return instantiatedActions.find(
    instantiatedAction => getId(instantiatedAction) === getId(action)
  );
}

export function getBlockingActionTemplates(stageTemplate, action) {
  if (
    arrayify(stageTemplate.result).some(
      template => getId(template) === getId(action.isBasedOn)
    )
  ) {
    return arrayify(stageTemplate.result).filter(
      template => getId(template) !== getId(action.isBasedOn)
    );
  } else {
    const createReleaseAction = arrayify(stageTemplate.result).find(
      template => template['@type'] === 'CreateReleaseAction'
    );
    return arrayify(
      createReleaseAction &&
        createReleaseAction.result &&
        createReleaseAction.result.potentialAction
    ).filter(template => getId(template) !== getId(action.isBasedOn));
  }
}

// !! TODO ensure that author can always view identity of authors and that
// producers can always view identity of other producers _and_ authors
// This is enforced by app-suite but needs to be guaranteed here.

/**
 * We assume that the `periodical` is valid i.e all his contributors are valid roles
 */
export async function validateAndSetupWorkflowSpecification(
  workflowSpecification = {},
  periodical,
  {
    prevWorkflowSpecification, // required for updates: needed to know what @id are valid when we update a workflow specification
    now = new Date().toISOString()
  } = {}
) {
  // validate workflowSpecificationStatus
  if (
    workflowSpecification.workflowSpecificationStatus &&
    workflowSpecification.workflowSpecificationStatus !==
      'DeactivatedWorkflowSpecificationStatus' &&
    workflowSpecification.workflowSpecificationStatus !==
      'ActiveWorkflowSpecificationStatus'
  ) {
    throw createError(
      400,
      'Invalid WorkflowSpecification workflowSpecificationStatus.'
    );
  }

  // expectedDuration is used to specify the expected duration of the whole workflow
  const messages = validateDateTimeDuration(workflowSpecification);
  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  if (!workflowSpecification.expectedDuration) {
    throw createError(
      400,
      'Invalid WorkflowSpecification, WorkflowSpecification must have a defined expected duration prop'
    );
  }

  // validate that there is only 1 potential action that is a CreateGraphAction
  let [createGraphAction, ...others] = arrayify(
    workflowSpecification.potentialAction
  );
  if (!createGraphAction || others.length) {
    throw createError(
      400,
      'Invalid WorkflowSpecification potentialAction. Potential action must have 1 CreateGraphAction'
    );
  }

  // The result of the createGraphAction must be a Graph (Note: it can be specified as {'@graph': []}).
  let graph = createGraphAction.result;
  if (!graph) {
    throw createError(
      400,
      'Invalid WorkflowSpecification: invalid result for CreateGraphAction (missing)'
    );
  }

  // Handle ifMatch before flattening (ifMatch is used to match the right decision letter to decision for instance)
  // This is because ifMatch is not defined as @type:@id in the context.json (but is defined as a simple text string)
  const ifMatchRelabelMap = {};
  traverse(graph).forEach(function(x) {
    if (
      this.key === 'ifMatch' &&
      typeof x === 'string' &&
      x.startsWith('_:') &&
      // In case of blanknode UUID we preserve the UUID part and just upgrade the prefix from `_:` to `workflow:` so that we can refer to stable @id for stories
      !reUuid.test(unprefix(x)) &&
      !(x in ifMatchRelabelMap)
    ) {
      ifMatchRelabelMap[x] = createId('blank')['@id'];
    }
  });

  graph = traverse.map(graph, function(x) {
    if (typeof x === 'string' && x.startsWith('_:') && x in ifMatchRelabelMap) {
      this.update(ifMatchRelabelMap[x]);
    }
  });

  let flattened = await flatten(graph, { preserveUuidBlankNodes: true });
  let nodes = flattened['@graph'];

  // find the root Graph: only Graph node not result of another node
  const graphNodes = nodes.filter(
    node => node['@type'] === 'Graph' && node.version == null
  );

  const rootGraphs = graphNodes.filter(
    graphNode => !nodes.some(node => getId(node.result) === getId(graphNode))
  );

  if (rootGraphs.length !== 1) {
    throw createError(
      400,
      `Invalid WorkflowSpecification: ${
        rootGraphs.length
      } root Graphs (${rootGraphs
        .map(getId)
        .filter(Boolean)
        .join(',')})`
    );
  }

  const framed = await frame(
    flattened,
    {
      '@id': getId(rootGraphs[0]), // !! will be a blank node => must set preserveUuidBlankNodes option to true for framing to work
      '@embed': '@always'
    },
    { preserveUuidBlankNodes: true }
  );

  if (
    !framed['@graph'] ||
    framed['@graph'].length !== 1 // need 1 root (Graph) so length must be 1
  ) {
    throw createError(
      400,
      'Invalid result. result must be a Graph with the @type set to Graph'
    );
  }

  const framedGraph = framed['@graph'][0];

  // we validate permissions on the framed graph
  if (framedGraph.hasDigitalDocumentPermission) {
    validateDigitalDocumentPermission(framedGraph.hasDigitalDocumentPermission);
  }

  // we re-flatten the framed graph so that we purge unecessary nodes
  // Note: user may have added some orphan stages (new unlinked stages) so we only purge when there are no orphan stages
  const stages = nodes.filter(
    node => node['@type'] === 'StartWorkflowStageAction'
  );
  const assessActions = nodes.filter(node => node['@type'] === 'AssessAction');

  const orphanStages = stages.filter(stage => {
    // if the stage is linked (not orphan) then it must be listed in the `potentialResult` of an assessAction
    const isLinked = assessActions.some(assessAction => {
      return arrayify(assessAction.potentialResult).some(
        result => getId(result) === getId(stage)
      );
    });
    return !isLinked;
  });

  // Note that the first submission stage is orphan by design => we only purge if there is stricly 1 orphan stage (the submission stage)
  if (orphanStages.length === 1) {
    // purge
    flattened = await flatten(framedGraph, { preserveUuidBlankNodes: true });
    nodes = flattened['@graph'];
  }

  let nodeMap = getNodeMap(flattened);

  const workflowWillHaveReviewers = Object.values(nodeMap).some(node => {
    if (node['@type'] === 'ReviewAction') {
      const agent = nodeMap[getId(node.agent)];
      return agent && agent.roleName === 'reviewer';
    }
    return false;
  });

  const workflowWillHaveProducers = Object.values(nodeMap).some(node => {
    if (node['@type'] === 'ReviewAction') {
      const agent = nodeMap[getId(node.agent)];
      return agent && agent.roleName === 'producer';
    }
    return false;
  });

  // Node validation
  nodes.forEach(node => {
    // Validate `CreateReleaseAction`
    if (node['@type'] === 'CreateReleaseAction') {
      // Agent must include author
      const agent = nodeMap[getId(node.agent)];
      if (!agent || agent.roleName !== 'author') {
        throw createError(
          400,
          `Invalid node in workflow specification: ${
            node['@type']
          } must have an agent property with a value specifying author as roleName`
        );
      }

      assertValidAudience(
        node,
        {
          onInstantiation: ['author'],
          onCompletion: [
            'editor',
            workflowWillHaveReviewers ? 'reviewer' : null,
            workflowWillHaveProducers ? 'producer' : null
          ].filter(Boolean)
        },
        nodeMap
      );

      // Validate `version`
      // Version must be `undefined` or a valid `RELEASE_TYPES`)
      if (node.object) {
        const object = nodeMap[node.object];
        if (object) {
          if (object.version != null) {
            throw createError(
              400,
              `Invalid node in workflow specification. The object of a CreateReleaseAction cannot have a version`
            );
          }
        }
      }

      if (node.result) {
        const result = nodeMap[node.result];
        if (result) {
          const version = result.version;
          if (version != null && !RELEASE_TYPES.has(version)) {
            throw createError(
              400,
              `Invalid node in workflow specification. When defined the version property of the result of a CreateReleaseAction must be one of ${Array.from(
                RELEASE_TYPES
              ).join(', ')}`
            );
          }

          // validate potentialAction of the resulting Graph
          const validTypes = [
            'AssessAction',
            'DeclareAction',
            'ReviewAction',
            'PayAction',
            'PublishAction'
          ];

          if (
            arrayify(result.potentialAction).some(actionId => {
              const action = nodeMap[actionId];
              return action && !validTypes.includes(action['@type']);
            })
          ) {
            throw createError(
              400,
              `Invalid node in workflow specification. When defined the potential actions of the result of a CreateReleaseAction can only point to ${validTypes.join(
                ', '
              )}`
            );
          }
        }
      }
    }

    // Validate `DeclareAction`
    if (node['@type'] === 'DeclareAction') {
      // Agent must include author
      const agent = nodeMap[getId(node.agent)];
      if (!agent || agent.roleName !== 'author') {
        throw createError(
          400,
          `Invalid node in workflow specification: ${
            node['@type']
          } must have an agent property with a value specifying author as roleName`
        );
      }

      assertValidAudience(
        node,
        {
          onInstantiation: ['author'],
          onCompletion: ['editor']
        },
        nodeMap
      );

      // Validate `version`
      // Version must be `undefined` or a valid `RELEASE_TYPES`)
      if (node.object) {
        const object = nodeMap[node.object];
        if (object) {
          if (object.version != null) {
            throw createError(
              400,
              `Invalid node in workflow specification. The object of a CreateReleaseAction cannot have a version`
            );
          }
        }
      }
    }

    // Validate `PayAction`
    if (node['@type'] === 'PayAction') {
      // Agent must include author
      const agent = nodeMap[getId(node.agent)];
      if (!agent || agent.roleName !== 'author') {
        throw createError(
          400,
          `Invalid node in workflow specification: ${
            node['@type']
          } must have an agent property with a value specifying author as roleName`
        );
      }

      assertValidAudience(
        node,
        {
          onInstantiation: ['author'],
          onCompletion: ['editor']
        },
        nodeMap
      );
    }

    // Validate `ReviewAction`
    if (node['@type'] === 'ReviewAction') {
      // Agent must be defined
      const agent = nodeMap[getId(node.agent)];
      if (
        !agent ||
        (agent.roleName !== 'reviewer' &&
        agent.roleName !== 'author' && // TODO remove ? breaks a lot of tests...
          agent.roleName !== 'producer' &&
          agent.roleName !== 'editor')
      ) {
        throw createError(
          400,
          `Invalid node in workflow specification: ${
            node['@type']
          } must have an agent property with a value of editor, author, reviewer or producer for roleName `
        );
      }

      assertValidAudience(
        node,
        {
          onInstantiation: [],
          onCompletion: ['editor']
        },
        nodeMap
      );
    }

    // Validate `PublishAction`
    if (node['@type'] === 'PublishAction') {
      // Agent must include editor
      const agent = nodeMap[getId(node.agent)];
      if (!agent || agent.roleName !== 'editor') {
        throw createError(
          400,
          `Invalid node in workflow specification: ${
            node['@type']
          } must have an agent property with a value specifying editor as roleName`
        );
      }

      // Audience must include editor
      assertValidAudience(
        node,
        {
          onInstantiation: ['editor']
        },
        nodeMap
      );

      // `publishActionInstanceOf`
      if (node.publishActionInstanceOf) {
        const validTypes = [
          'CreateReleaseAction',
          'AssessAction',
          'DeclareAction',
          'ReviewAction',
          'PayAction',
          'PublishAction'
        ];

        if (
          arrayify(node.publishActionInstanceOf).some(templateId => {
            templateId = getId(templateId);
            const template = nodeMap[templateId];

            return !template || !validTypes.includes(template['@type']);
          })
        ) {
          throw createError(
            400,
            `Invalid node in workflow specification: ${
              node['@type']
            } publishActionInstanceOf must list existing workflow actions (of types ${validTypes.join(
              ', '
            )})`
          );
        }
      }

      // `publishIdentityOf`
      if (node.publishIdentityOf) {
        if (
          arrayify(node.publishIdentityOf).some(audienceId => {
            const audience = nodeMap[audienceId];
            return (
              !audience ||
              (audience.audienceType !== 'editor' &&
                audience.audienceType !== 'author' &&
                audience.audienceType !== 'reviewer' &&
                audience.audienceType !== 'producer')
            );
          })
        ) {
          throw createError(
            400,
            `Invalid node in workflow specification: ${
              node['@type']
            } publishIdentity of must list valid audiences`
          );
        }
      }
    }

    // Validate `AssessAction`
    if (node['@type'] === 'AssessAction') {
      // Agent must include editor
      const agent = nodeMap[getId(node.agent)];
      if (!agent || agent.roleName !== 'editor') {
        throw createError(
          400,
          `Invalid node in workflow specification: ${
            node['@type']
          } must have an agent property with a value specifying editor as roleName`
        );
      }

      assertValidAudience(
        node,
        {
          onInstantiation: ['editor'],
          onCompletion: [
            workflowWillHaveReviewers ? 'reviewer' : null,
            workflowWillHaveProducers ? 'producer' : null
          ].filter(Boolean)
        },
        nodeMap
      );

      // AssessAction cannot have a result prop (only `potentialResult`)
      if (node.result) {
        throw createError(
          400,
          `Invalid "result" property for ${
            node['@type']
          }. Only "potentialResult" can be specified for ${node['@type']}`
        );
      }

      // PotentialResult must be StartWorkflowStageAction or RejectAction
      if (node.potentialResult) {
        // validate potentialAction
        const validTypes = ['StartWorkflowStageAction', 'RejectAction'];

        if (
          arrayify(node.potentialResult).some(potentialResultId => {
            const potentialResult = nodeMap[potentialResultId];
            return (
              potentialResult && !validTypes.includes(potentialResult['@type'])
            );
          })
        ) {
          throw createError(
            400,
            `Invalid node in workflow specification. When defined the potential result of an AssessAction can only point to ${validTypes}.join(', ')`
          );
        }
      }
    }

    // Validate `StartWorkflowStageAction`
    if (node['@type'] === 'StartWorkflowStageAction') {
      assertValidAudience(
        node,
        {
          onInstantiation: [
            'author',
            'editor',
            workflowWillHaveReviewers ? 'reviewer' : null,
            workflowWillHaveProducers ? 'producer' : null
          ].filter(Boolean)
        },
        nodeMap
      );

      if (node.result) {
        // validate result
        const validTypes = [
          'CreateReleaseAction',
          'AssessAction',
          'DeclareAction',
          'ReviewAction',
          'PayAction',
          'PublishAction'
        ];

        if (
          arrayify(node.result).some(actionId => {
            const action = nodeMap[actionId];
            return action && !validTypes.includes(action['@type']);
          })
        ) {
          throw createError(
            400,
            `Invalid node in workflow specification. When defined the result of a StartWorkflowStageAction can only point to ${validTypes.join(
              ', '
            )}`
          );
        }
      }
    }

    // TODO Validate `InformAction`.
    // - `agent` must be a Role,
    // - `recipient` must be audiences
    // - Must have 1 instrument and it must be an EmailMessage.
    // - If defined, email message `about` must be the object of the inform action
    // - If defined, `messageAttachment` must be a list of @id from the stage (exception being the live graph or release)
    if (node['@type'] === 'InformAction') {
      // TODO
    }

    // Validate `AuthorizeAction`
    if (node['@type'] === 'AuthorizeAction') {
      // `AuthorizeAction` must have at least 1 recipient
      if (!arrayify(node.recipient).length >= 1) {
        throw createError(
          400,
          `Invate node ${node['@type']} in workflow specification`
        );
      }

      // `recipent` must be valid audiences
      arrayify(node.recipient).forEach(recipientId => {
        const recipient = nodeMap[getId(recipientId)];
        if (
          !recipient ||
          (recipient.audienceType !== 'author' &&
            recipient.audienceType !== 'reviewer' &&
            recipient.audienceType !== 'editor' &&
            recipient.audienceType !== 'producer')
        ) {
          throw createError(
            400,
            `Invate node ${
              node['@type']
            } in workflow specification: recipient ${recipientId} is not a valid audience`
          );
        }
      });
    }

    // Validate `EndorseAction`
    if (node['@type'] === 'EndorseAction') {
      // EndorseAction must have an agent node
      const agent = nodeMap[getId(node.agent)];
      if (!agent || !agent.roleName) {
        throw createError(
          400,
          `EndorseAction must have a valid agent specification`
        );
      }

      // EndorseAction audience must match the `agent.roleName`
      const participants = arrayify(node.participant);
      if (participants.length !== 1) {
        throw createError(
          400,
          `EndorseAction participant must match the agent`
        );
      }
      const audience = nodeMap[getId(participants[0])];
      if (!audience || audience.audienceType !== agent.roleName) {
        throw createError(
          400,
          `EndorseAction participant must match the agent roleName ${
            agent.roleName
          } (got ${audience && audience.audienceType})`
        );
      }

      // EndorseAction cannot have `completeOn`
      // This is to prevent cases like:
      // {
      //   '@type': 'TypesettingAction',
      //   actionStatus: 'PotentialActionStatus',
      //   completeOn: 'OnEndorsed',
      //   potentialAction: {
      //     '@id': '_:id',
      //     '@type': 'EndorseAction',
      //     actionStatus: 'PotentialActionStatus',
      //     activateOn: 'OnObjectStagedActionStatus',
      //     completeOn: 'OnObjectCompletedActionStatus'
      //   }
      // }
      if (node.completeOn) {
        throw createError(
          400,
          `EndorseAction cannot have a completeOn property`
        );
      }
    }

    // Graph nodes should have no @id or a blank node
    if (node['@type'] === 'Graph') {
      const nodeId = getId(node);
      if (nodeId && !nodeId.startsWith('_:')) {
        throw createError(
          400,
          'Invalid result. Graph nodes must be blank nodes'
        );
      }
    }

    // `expectsAcceptanceOf` value must be valid Offers @id
    // TODO validate that offers are valid
    // TODO validate potentialService
    if (node.expectsAcceptanceOf) {
      if (
        !arrayify(node.expectsAcceptanceOf).some(offerId => {
          return getId(offerId) !== createId('node', offerId)['@id'];
        })
      ) {
        throw createError(
          400,
          'Invalid node in workflow specification. Node with expectsAcceptanceOf property must have value corresponding to valid offer @id'
        );
      }
    }

    // Validate `actionStatus`
    // If specified the actionStatus of an certain actions (`EndorseAction`,
    // `StartWorkflowStageAction`...) must be `PotentialActionStatus`
    // This is so that to Activate the action, it MUST be POSTed as it will
    // create side effects
    if (
      (node['@type'] === 'EndorseAction' ||
        node['@type'] === 'BuyAction' ||
        node['@type'] === 'RejectAction' ||
        node['@type'] === 'AuthorizeAction' ||
        node['@type'] === 'DeauthorizeAction' ||
        node['@type'] === 'StartWorfklowStageAction') &&
      node.actionStatus &&
      node.actionStatus !== 'PotentialActionStatus'
    ) {
      throw createError(
        400,
        `Invalid "actionStatus" property. When specified the actionStatus of the ${
          node['@type']
        } must be "PotentialActionStatus"`
      );
    }

    // TODO
    // Validate polyton action (any action with a `minInstances` prop)
    // For now, we restrict Polyton action to `ReviewAction`

    // TODO
    // Validate `requiresCompletionOf`
    // `requiresCompletionOf` can only take values from workflow actions of the same stage
    // In particular requiresCompletionOf cannot accept EndorseActions this is to ensure that
    // `completeOn` (and that only) is used to make an endorse action required
    // - prevent circular deps
    if (node.requiresCompletionOf) {
      // ensure that no EndorseAction are present
      if (
        arrayify(node.requiresCompletionOf).some(id => {
          const requiredAction = nodeMap[getId(id)];
          return requiredAction && requiredAction['@type'] == 'EndorseAction';
        })
      ) {
        throw createError(
          400,
          `requiresCompletionOf cannot point to EndorseActions. Use completeOn: "OnEndorsed" instead`
        );
      }
    }

    // TODO
    // Validate triggers
    // - if `OnObjectActiveActionStatus`, `OnObjectCompletedActionStatus`,
    //  `OnObjectFailedActionStatus`, `OnObjectStagedActionStatus`, the object must
    //   be in a previous status.
    // - if `OnEndorsed`, there must be a potentialAction being an EndorseAction.
  });

  // TODO validate audience of EndorseAction object, the agent of endorse action
  // should be part of the audience of the action to be endorsed...

  // Agent mentioned in the CreateGraphAction can only be roles either
  // without a defined agentId or with one present in the periodical
  const periodicalRoleMap = CONTRIBUTOR_PROPS.reduce((periodicalRoleMap, p) => {
    if (p in periodical) {
      arrayify(periodical[p]).forEach(role => {
        periodicalRoleMap[getId(role)] = role;
      });
    }
    return periodicalRoleMap;
  }, {});

  // All the role listed in the CreateGraphAction must come from the
  // createGraphAction.agent or createGraphAction.participant.

  // First we validate that all the createGraphAction.agent and
  // createGraphAction.participant are valid roles. If their @id
  // is defined, we make sure that they are present in the periodicalRoleMap
  ['agent', 'participant'].forEach(p => {
    if (
      !arrayify(createGraphAction[p]).every(role => {
        // !! role can be a string if it's just a reference

        // valid values:
        return (
          isAudience(getAgent(role)) ||
          getId(role) in periodicalRoleMap ||
          (!getId(role) &&
            !getAgentId(role) &&
            isRole(role, p, { needRoleProp: false }))
        );
      })
    ) {
      throw createError(
        400,
        `some agent or participant of the CreateGraphAction are not valid role or are not present in the object following properties: ${CONTRIBUTOR_PROPS.join(
          ', '
        )}`
      );
    }
  });

  const validRolesMap = arrayify(createGraphAction.agent)
    .concat(arrayify(createGraphAction.participant))
    .reduce((validRolesMap, role) => {
      const roleId = getId(role);
      if (roleId) {
        validRolesMap[getId(role)] = role;
      }
      return validRolesMap;
    }, {});

  // We now validate that all the agents listed in the
  // Graph are valid roles and that if they have an @id,
  // it is present in the validRolesMap
  const actionAndResourceRoleProps = [
    'agent',
    'participant',
    'recipient'
  ].concat(CONTRIBUTOR_PROPS);

  nodes.forEach(node => {
    actionAndResourceRoleProps.forEach(p => {
      if (p in node) {
        if (
          !arrayify(node[p]).every(roleId => {
            const role = embed(roleId, nodeMap);

            let unroled;
            if (role[p]) {
              unroled = arrayify(role[p])[0];
            }

            // valid values:
            return (
              isAudience(getAgent(role)) ||
              roleId in validRolesMap ||
              ((!roleId || roleId.startsWith('_:')) &&
                !getId(unroled) &&
                isRole(role, p, { needRoleProp: false }))
            );
          })
        ) {
          throw createError(
            400,
            `some ${p} of the Graph nodes are not valid role or are not present in the object's following properties: ${CONTRIBUTOR_PROPS.join(
              ', '
            )}`
          );
        }
      }
    });
  });

  // TODO validate that if some actions were assigned, the assigned
  // user needs to have the corresponding permissions! (lookup
  // hasDigitalDocumentPermission)
  // see https://github.com/scienceai/librarian/issues/41

  ////////////////////////////////////////
  // Setup (Mutation and normalization) //
  ////////////////////////////////////////

  // for convenience we deep clone so that we can mutate in place...
  createGraphAction = cloneDeep(omit(createGraphAction, ['result']));

  // normalize the roles, replace data with a subset of the one from the periodicalRoleMap
  ['agent', 'participant'].forEach(p => {
    if (createGraphAction[p]) {
      createGraphAction[p] = dearrayify(
        createGraphAction[p],
        arrayify(createGraphAction[p]).map(role => {
          const roleId = getId(role);
          if (roleId && roleId in periodicalRoleMap) {
            return Object.assign(
              pick(periodicalRoleMap[roleId], COPIED_ROLE_PROPS),
              { [p]: getAgentId(periodicalRoleMap[roleId]) }
            );
          }
          return role;
        })
      );
    }
  });

  const setupRoleMap = {};
  nodes.forEach(node => {
    Object.keys(node).forEach(p => {
      arrayify(node[p]).forEach(roleId => {
        if (roleId in periodicalRoleMap) {
          setupRoleMap[roleId] = Object.assign(
            pick(periodicalRoleMap[roleId], COPIED_ROLE_PROPS),
            { [p]: getAgentId(periodicalRoleMap[roleId]) }
          );
        }
      });
    });
  });
  nodes = nodes.map(node => {
    const nodeId = getId(node);
    if (nodeId in setupRoleMap) {
      return setupRoleMap[nodeId];
    }
    return node;
  });

  // Give each action and emailMessage a `workflow:<uuid>` @id (and relabel the refs)
  // and set actionStatus to PotentialActionStatus if missing
  const invalidIds = [];
  const blankNodeMap = {};

  let authorizedIds = new Set();
  if (prevWorkflowSpecification) {
    const [prevCreateGraphAction] = arrayify(
      prevWorkflowSpecification.potentialAction
    );

    if (
      getId(prevCreateGraphAction) &&
      getId(prevCreateGraphAction).startsWith('workflow:')
    ) {
      authorizedIds.add(getId(prevCreateGraphAction));
    }

    const nodes = arrayify(
      prevCreateGraphAction.result && prevCreateGraphAction.result['@graph']
    );

    nodes.forEach(node => {
      const nodeId = getId(node);
      if (nodeId && nodeId.startsWith('workflow:')) {
        authorizedIds.add(nodeId);
      }
    });
  }

  nodes.forEach(node => {
    if (schema.is(node, 'Action') || schema.is(node, 'EmailMessage')) {
      if (schema.is(node, 'Action')) {
        if (
          !node.actionStatus ||
          (node.actionStatus !== 'PotentialActionStatus' &&
            node.actionStatus !== 'ActiveActionStatus' &&
            node.actionStatus !== 'CompletedActionStatus' &&
            node.actionStatus !== 'StagedActionStatus' &&
            node.actionStatus !== 'FailedActionStatus')
        ) {
          node.actionStatus = 'PotentialActionStatus';
        }
      }

      if (!node['@id']) {
        node['@id'] = createId('workflow')['@id'];
      } else {
        if (node['@id'].startsWith('_:')) {
          if (!(node['@id'] in blankNodeMap)) {
            const id = node['@id'];

            // In case of blanknode UUID we preserve the UUID part and just upgrade the prefix from `_:` to `workflow:`
            // This is required for stories.
            blankNodeMap[node['@id']] = createId(
              'workflow',
              reUuid.test(unprefix(id)) ? id : null
            )['@id'];
          }
          node['@id'] = blankNodeMap[node['@id']];
        } else if (!authorizedIds.has(node['@id'])) {
          invalidIds.push(node['@id']);
        }
      }
    }
  });

  if (invalidIds.length) {
    throw createError(
      400,
      `Invalid @id: ${invalidIds.join(
        ', '
      )}. @id of the potential CreateGraphAction must be blank nodes`
    );
  }

  nodes = relabelNodes(nodes, { relabelMap: blankNodeMap });
  nodeMap = getNodeMap(nodes);

  const workflowSpecificationId = createId(
    'workflow',
    workflowSpecification,
    periodical
  );
  // set object for convenience
  createGraphAction.object = getId(workflowSpecificationId);

  // overwrite result with the setup nodes
  createGraphAction.result = { '@graph': nodes };

  if (
    createGraphAction.actionStatus !== 'PotentialActionStatus' &&
    createGraphAction.actionStatus !== 'ActiveActionStatus'
  ) {
    createGraphAction.actionStatus = 'PotentialActionStatus';
  }

  // Set @id and default and replace the createGraph action with the setup one
  return Object.assign(
    // defaults
    {
      workflowSpecificationStatus: 'DeactivatedWorkflowSpecificationStatus',
      dateCreated: now
    },
    workflowSpecification,
    // overwrite
    workflowSpecificationId,
    {
      '@type': 'WorkflowSpecification',
      isPotentialWorkflowOf: getId(periodical),
      potentialAction: createGraphAction
    },
    prevWorkflowSpecification
      ? {
          dateModified: now
        }
      : undefined
  );
}

/**
 * Check if:
 * - `action` has the `audienceTypes` defined in `onInstantiation` in `participant`
 * - `action` will have the `audienceTypes` defined in `onCompletion` on completion
 */
function assertValidAudience(
  action,
  { onInstantiation = [], onCompletion = [] } = {},
  nodeMap
) {
  const authorizeActions = arrayify(action.potentialAction)
    .map(potentialActionId => {
      return nodeMap[getId(potentialActionId)];
    })
    .filter(
      potentialAction =>
        potentialAction && potentialAction['@type'] === 'AuthorizeAction'
    );

  const missingAudienceTypesOnInstantiation = onInstantiation.filter(
    audienceType => {
      return !arrayify(action.participant).some(participantId => {
        const participant = nodeMap[getId(participantId)];
        return participant && participant.audienceType === audienceType;
      });
    }
  );

  const missingAudienceTypesOnCompletion = onCompletion.filter(audienceType => {
    return !(
      arrayify(action.participant).some(participantId => {
        const participant = nodeMap[getId(participantId)];
        return participant && participant.audienceType === audienceType;
      }) ||
      authorizeActions.some(authorizeAction => {
        return (
          (authorizeAction.completeOn === 'OnObjectActiveActionStatus' ||
            authorizeAction.completeOn === 'OnObjectStagedActionStatus' ||
            authorizeAction.completeOn === 'OnObjectCompletedActionStatus') &&
          arrayify(authorizeAction.recipient).some(recipientId => {
            const recipient = nodeMap[getId(recipientId)];
            return recipient && recipient.audienceType === audienceType;
          })
        );
      })
    );
  });

  if (
    missingAudienceTypesOnInstantiation.length ||
    missingAudienceTypesOnCompletion.length
  ) {
    let msg = `Invalid node in workflow specification: ${action['@type']}`;
    if (missingAudienceTypesOnInstantiation.length) {
      msg += ` missing audiences on instantiation: ${missingAudienceTypesOnInstantiation.join(
        ', '
      )}`;
    }
    if (missingAudienceTypesOnCompletion.length) {
      msg += ` missing audiences on completion: ${missingAudienceTypesOnCompletion.join(
        ', '
      )}`;
    }

    throw createError(400, msg);
  }
}

/*
 *   `objectSpecification` will be flattened
 *   objectSpecification: {
 *     '@graph': [
 *       {
 *         '@type': 'Graph',
 *         mainEntity: {
 *           '@type': 'ScholarlyArticle',
 *           'description-input': {
 *             '@type': 'PropertyValueSpecification',
 *             valueRequired: true,
 *             valueMaxlength: 100
 *           },
 *           encoding: {
 *             '@type': 'DocumentObject',
 *             'name-input': {
 *               '@type': 'PropertyValueSpecification',
 *               valueRequired: true
 *             }
 *           },
 *           hasPart: [
 *             {
 *               '@type': 'WebPageElement',
 *               // PublicationElementType are defined inline.
 *               additionalType: {
 *                 '@type': 'PublicationElementType',
 *                 name: 'Abstract',
 *                 description:
 *                   "A brief summary, the purpose of which is to help the reader quickly ascertain the publication's purpose.",
 *                 sameAs: 'WPAbstract'
 *               },
 *               text: {
 *                 '@type': 'PropertyValueSpecification',
 *                 valueRequiredOn: 'OnPublicationAccepted',
 *                 valueMaxlength: 100
 *               }
 *             }
 *           ]
 *         }
 *       }
 *     ]
 *   }
 */
export async function validateAndSetupPublicationTypeObjectSpecification(
  objectSpecification
) {
  const flattened = await flatten(objectSpecification, {
    preserveUuidBlankNodes: true
  });

  // validate objectSpecification:
  // must have 1 (and one only Graph) with a mainEntity
  const nodes = arrayify(flattened['@graph']);
  const graphs = nodes.filter(node => node['@type'] === 'Graph');
  if (!nodes.length || graphs.length !== 1 || !graphs[0].mainEntity) {
    throw createError(400, 'Invalid objectSpecification');
  }

  return { '@graph': nodes };
}
