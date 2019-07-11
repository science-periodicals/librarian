import semver from 'semver';
import uniq from 'lodash/uniq';
import pickBy from 'lodash/pickBy';
import omit from 'lodash/omit';
import isPlainObject from 'lodash/isPlainObject';
import flatten from 'lodash/flatten';
import traverse from 'traverse';
import { arrayify, getId, dearrayify, getNodeMap } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import {
  getTemplateId,
  getWorkflowMap,
  getInstantiatedActions,
  getFramedGraphTemplate
} from '../utils/workflow-actions';
import { getObjectId, getResultId } from '../utils/schema-utils';
import { getStageActions, compareActions } from '../utils/workflow-utils';
import createId from '../create-id';
import setId from '../utils/set-id';

/**
 * This is called at CreateGraphAction and then for each completed AssessAction
 *
 * Note: locking so that workflow stage cannot be instantiated twice is done
 * in the handleAssessAction handler
 */
export default async function instantiateWorkflowStage(
  startWorkflowStageAction, // may be a template in any case it's framed
  workflowSpecification,
  graphIdOrReleaseId,
  {
    agent, // the agent of the action triggering the instantiation
    startTime,
    endTime,
    resultOf, // the AssessAction used to instantiate the stage (when the stage is instantiated as the result of an AssessAction, so after the first stage) TODO rename to `decision` ?
    store
  } = {}
) {
  if (!startWorkflowStageAction) {
    throw createError(
      400,
      'instantiateWorkflowStage: missing startWorkflowStageAction parameter'
    );
  }

  // ensure it's the live graphId
  const graphId = createId('graph', graphIdOrReleaseId)['@id'];

  const latestGraphVersion = graphIdOrReleaseId.includes('?version=')
    ? graphIdOrReleaseId.split('?version=', 2)[1]
    : null;

  const graphTemplate = await getFramedGraphTemplate(workflowSpecification);

  const workflowMap = getWorkflowMap(graphTemplate);
  const startWorkflowStageActionTemplate =
    workflowMap[getTemplateId(startWorkflowStageAction)];

  if (!startWorkflowStageActionTemplate) {
    throw createError(400, 'could not find CreateWorkflowStageAction template');
  }

  const isTemplate = !!(
    getId(startWorkflowStageAction) &&
    getId(startWorkflowStageAction).startsWith('workflow:')
  );

  // force instanciation if a template is provided
  const startWorkflowStageActionId = createId(
    'action',
    isTemplate ? null : getId(startWorkflowStageAction),
    graphId
  );

  const relabelIdMap = {};

  const objectId = graphIdOrReleaseId;

  // We instantiate the stage but _without_ replacing the stage templateId by
  // the stageId so that it's not part of the relabelIdMap.
  // This is important so that we can relabel things like the ifMatch of
  // decision letter in case of cycles:
  //
  // In case of cycle an AssessAction potential result will point back to the
  // stage template Id _but_ the `instantiateAction` method will take care of
  // giving it a new @id => the stage template id is being map to the id of the
  // future stage (and not the @id of the instantiated stage, we will set that @id
  // after being done with relabelIdMap)
  let unIdedStartWorkflowStageAction = Object.assign(
    { startTime: startTime || new Date().toISOString() },
    startWorkflowStageActionTemplate,
    agent ? { agent } : undefined,
    resultOf ? { resultOf: getId(resultOf) } : undefined,
    {
      actionStatus: 'CompletedActionStatus',
      endTime: endTime || new Date().toISOString(),
      instanceOf: getId(startWorkflowStageActionTemplate),
      object: graphId,
      result: multiplex(arrayify(startWorkflowStageActionTemplate.result)).map(
        result => {
          return instantiateAction(
            result,
            workflowMap,
            startWorkflowStageActionId,
            graphId,
            latestGraphVersion,
            objectId,
            {
              startTime,
              relabelIdMap,
              instantiatedActions,
              resultOf
            }
          );
        }
      )
    }
  );

  // relabel @ids using `relabelIdMap`
  unIdedStartWorkflowStageAction = traverse.map(
    unIdedStartWorkflowStageAction,
    function(x) {
      const key =
        /\d/.test(this.key) && this.path.length > 1
          ? this.path[this.path.length - 2]
          : this.key;

      if (
        typeof x === 'string' &&
        x in relabelIdMap &&
        key !== 'sameAs' &&
        key !== 'publishActionInstanceOf' &&
        (x.startsWith('_:') || key !== 'instanceOf')
      ) {
        this.update(relabelIdMap[x]);
      }
    }
  );

  // Give an instantiated @id to the stage
  startWorkflowStageAction = setId(
    unIdedStartWorkflowStageAction,
    startWorkflowStageActionId
  );

  // collapse requiresCompletionOf to @id and take care of multiplexing
  collapseAndMultiplex(startWorkflowStageAction, { multiplex: true });

  // Add instruments (mutate in place)

  // get the ref to all the actions in flat form and mutate them (simpler)
  const stageActions = getStageActions(startWorkflowStageAction);

  // Note `getActionsByScopeIdAndTypes` should be guaranteed to have all the
  // required data given we prepolutated the store upstream (see comment in the
  // view)
  const potentialInstruments = await this.getActionsByScopeIdAndTypes(
    graphId,
    [
      'ReviewAction',
      'CreateReleaseAction',
      'DeclareAction',
      'PayAction',
      'PublishAction'
    ],
    { store }
  );

  // - AssessAction -> list all the ReviewAction, DeclareAction and PayAction targetting the same version of the ms as the AssessAction + the CreateReleaseAction
  // + backport `comment` and `annotation` of `resultOf` (the decision leading to the stage) if the stage doesn't include a CreateReleaseAction
  const assessAction = stageActions.find(
    action => action['@type'] === 'AssessAction'
  );
  if (assessAction) {
    const reviewActions = potentialInstruments
      .filter(
        instrument =>
          instrument['@type'] === 'ReviewAction' &&
          getObjectId(instrument) === getObjectId(assessAction)
      )
      .concat(
        // needed as the stage action are not into CouchDB yet
        stageActions.filter(action => action['@type'] === 'ReviewAction')
      );

    const createReleaseAction = potentialInstruments
      .filter(
        instrument =>
          instrument['@type'] === 'CreateReleaseAction' &&
          getObjectId(instrument) === graphId
      )
      .concat(
        // needed as the stage action are not into CouchDB yet
        stageActions.filter(action => action['@type'] === 'CreateReleaseAction')
      )
      .filter(
        createReleaseAction =>
          getResultId(createReleaseAction) === getObjectId(assessAction)
      )[0];

    const declareActions = potentialInstruments
      .filter(
        instrument =>
          instrument['@type'] === 'DeclareAction' &&
          getObjectId(instrument) === getObjectId(assessAction)
      )
      .concat(
        // needed as the stage action are not into CouchDB yet
        stageActions.filter(action => action['@type'] === 'DeclareAction')
      );

    const payActions = potentialInstruments
      .filter(
        instrument =>
          instrument['@type'] === 'PayAction' &&
          getObjectId(instrument) === getObjectId(assessAction)
      )
      .concat(
        // needed as the stage action are not into CouchDB yet
        stageActions.filter(action => action['@type'] === 'PayAction')
      );

    const instruments = [
      ...reviewActions,
      createReleaseAction,
      ...declareActions,
      ...payActions
    ].filter(Boolean);

    if (instruments.length) {
      assessAction.instrument = uniq(instruments.map(getId));
    }

    // backport `annotation` and `comment` of previous assess (`resultOf`) if the stage doesn't include a create release action
    if (
      resultOf &&
      !stageActions.some(action => action['@type'] === 'CreateReleaseAction')
    ) {
      ['comment', 'annotation'].forEach(p => {
        // we reset the @id as they are embedded in a new embedder doc
        if (arrayify(resultOf[p]).length) {
          assessAction[p] = arrayify(resultOf[p]).map(node => {
            if (typeof node === 'string') {
              node = { '@id': node };
            }
            if (node['@type'] === 'Annotation') {
              return setId(
                Object.assign(
                  {},
                  node,
                  node.annotationBody
                    ? {
                        annotationBody: setId(
                          typeof node.annotationBody === 'string'
                            ? { '@id': node.annotationBody }
                            : node.annotationBody,
                          createId('cnode', null, assessAction)
                        )
                      }
                    : undefined
                ),
                createId('cnode', null, assessAction)
              );
            }

            return setId(node, createId('cnode', null, assessAction));
          });
        }
      });
    }
  }

  // set CreateReleaseAction as instrument of ReviewAction, DeclareAction, PublishAction
  // + in case of ReviewAction add the assessAction that lead to the review
  for (const actionType of [
    'ReviewAction',
    'DeclareAction',
    'PayAction',
    'PublishAction'
  ]) {
    const actions = stageActions.filter(
      action => action['@type'] === actionType
    );
    if (actions.length) {
      const createReleaseAction = potentialInstruments
        .filter(
          instrument =>
            instrument['@type'] === 'CreateReleaseAction' &&
            getObjectId(instrument) === graphId
        )
        .concat(
          // needed as the stage action are not into CouchDB yet
          stageActions.filter(
            action => action['@type'] === 'CreateReleaseAction'
          )
        )
        .filter(
          createReleaseAction =>
            getResultId(createReleaseAction) === getObjectId(actions[0])
        )[0];

      if (createReleaseAction || (resultOf && actionType === 'ReviewAction')) {
        actions.forEach(action => {
          if (actionType === 'ReviewAction') {
            if (createReleaseAction && getId(resultOf)) {
              action.instrument = [getId(resultOf), getId(createReleaseAction)];
            } else if (createReleaseAction) {
              action.instrument = getId(createReleaseAction);
            } else if (getId(resultOf)) {
              action.instrument = getId(resultOf);
            }
          } else {
            action.instrument = getId(createReleaseAction);
          }
        });
      }
    }
  }

  // `resultOf` is the assessAction that lead to the stage
  if (resultOf) {
    const createReleaseAction = stageActions.find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    if (createReleaseAction) {
      createReleaseAction.instrument = getId(resultOf); // AssessAction
    }
  }

  // Set the identifiers. identifiers are <stageIndex>.<actionIndex>[.e] (.e is optional and for the endorse actions)
  const stageIndex = resultOf
    ? parseInt(resultOf.identifier.split('.')[0], 10) + 1
    : 0;

  // first we get the order of the stageActions minus the endorse action as their identifiers is <stageIndex>.<actionIndex>.e
  const sortedActions = stageActions
    .filter(action => action['@type'] !== 'EndorseAction')
    .sort(compareActions);

  sortedActions.forEach((action, i) => {
    action.identifier = `${stageIndex}.${i}`;
  });

  // set identifier to the endorse actions
  const sortedActionMap = getNodeMap(sortedActions);
  const endorseActions = stageActions.filter(
    action => action['@type'] === 'EndorseAction'
  );
  endorseActions.forEach(endorseAction => {
    const action = sortedActionMap[getObjectId(endorseAction)];
    if (action && action.identifier) {
      endorseAction.identifier = action.identifier + '.e';
    }
  });

  // set identifier to the InformAction and EmailMessages
  if (assessAction) {
    let i = 0;
    arrayify(assessAction.potentialAction).forEach(action => {
      if (action['@type'] === 'InformAction') {
        action.identifier = assessAction.identifier + `.i.${i}`;
        i++;

        if (action.instrument) {
          arrayify(action.instrument).forEach(instrument => {
            if (instrument['@type'] === 'EmailMessage') {
              instrument.identifier = action.identifier + '.e';
            }
          });
        }
      }
    });
  }

  startWorkflowStageAction.identifier = stageIndex.toString();

  const instantiatedActions = getInstantiatedActions(startWorkflowStageAction);

  return { startWorkflowStageAction, instantiatedActions };
}

/**
 * handle the `minInstances` and `maxInstances` prop (typically used for ReviewAction)
 * Note: multiplexing `requiresCompletionOf` is done further downstream after
 * the action have been instantiated (see `collapseAndMultiplex`)
 */
function multiplex(actions) {
  return flatten(
    actions.map(action => {
      const n = action.maxInstances || action.minInstances;

      if (n > 1) {
        return Array.from({
          length: n
        }).map((_, i) => Object.assign({}, action, { instanceIndex: i }));
      }

      // Note: we don't handle CreateReleaseAction.result.potentialAction here
      // to avoid to multiplex several times (this is done in `instantiateAction`)

      return action;
    })
  );
}

/**
 * Note: requiresCompletionOf is taken care of in librarian#instantiateWorkflowStage
 *
 * Note: see librarian#instantiateWorkflowStage for post processing (relabelId
 * thanks to the collected `relabelIdMap` + collapse `requiresCompletionOf`)
 */
function instantiateAction(
  template, // the action template to be instantiated. It MUST be part of the stage with @id `startWorkflowStageActionId`
  workflowMap, // a map of all the (framed) action template
  startWorkflowStageActionId, // the @id of the instantiated startWorkflowStageAction that resulted in the action instantiation
  graphId, // the @id of the live graph
  graphVersion,
  objectId,
  {
    startTime,
    endTime,
    isPotentialAction = false,
    relabelIdMap = {}, // will be mutated in place,
    resultOf // the assessAction leading to the stage (if any)
  } = {}
) {
  template = Object.assign(
    {},
    getId(template) ? workflowMap[getId(template)] : undefined,
    template //  `template may have instanceIndex props added by multiplex`
  );

  // ensure it's the live graphId
  graphId = createId('graph', graphId)['@id'];

  const instantiatedAction = setId(
    pickBy(
      Object.assign({}, template, {
        startTime:
          !isPotentialAction && template.actionStatus === 'ActiveActionStatus'
            ? startTime || new Date().toISOString()
            : undefined,
        endTime:
          template.actionStatus === 'CompletedActionActionStatus' ||
          template.actionStatus === 'FailedActionActionStatus'
            ? endTime || new Date().toISOString()
            : undefined,
        actionStatus: template.actionStatus || 'PotentialActionStatus',
        instanceOf: getId(template),
        resultOf: getId(startWorkflowStageActionId),
        // Note: we handle the addition of `objectId` in the relabelIdMap further down
        object:
          template['@type'] === 'CreateReleaseAction' ||
          template['@type'] === 'PublishAction' // special case for CreateReleaseAction and PublishAction where the object is _always_ the live graph
            ? graphId
            : isPlainObject(template.object)
            ? template.object.object
              ? Object.assign({}, template.object, { object: objectId })
              : Object.assign({}, template.object, { '@id': objectId })
            : objectId
      }),
      x => x !== undefined
    ),
    createId('action', null, graphId),
    relabelIdMap
  );

  // add the potentail relabeling of the object to the relabelIdMap
  // TODO? we can probably delete that
  // !! we need to be cautious to not overwrite the graphId by objectId for the
  // object of a CreateReleaseAction as the object of a CreateReleaseAction must
  // always be the live graph
  const templateObjectId = getObjectId(template);
  if (
    templateObjectId &&
    !templateObjectId.startsWith('graph:') &&
    templateObjectId !== getObjectId(instantiatedAction)
  ) {
    relabelIdMap[templateObjectId] = getObjectId(instantiatedAction);
  }

  // inject the name-input `PropertyValueSpecification` if the template `agent`
  // has a subrole
  // -> this is so that we can differentiate an action requiring a specific
  // subrole from an action (which has been assigned or staged) whose agent happens
  // to be part of a specific subrole
  // See https://schema.org/docs/actions.html for weird -input syntax
  if (
    instantiatedAction.agent &&
    instantiatedAction.agent.roleName &&
    instantiatedAction.agent.name
  ) {
    instantiatedAction.agent['name-input'] = {
      '@type': 'PropertyValueSpecification',
      readonlyValue: true,
      valueRequired: true
    };
  }

  switch (instantiatedAction['@type']) {
    case 'ReviewAction':
      if (instantiatedAction.answer) {
        instantiatedAction.answer = dearrayify(
          instantiatedAction.answer,
          arrayify(instantiatedAction.answer).map(answer => {
            // set @id to questions and answers
            if (
              answer.parentItem &&
              answer.parentItem['@type'] === 'Question'
            ) {
              return setId(
                Object.assign({}, answer, {
                  parentItem: setId(
                    Object.assign({}, answer.parentItem, {
                      isNodeOf: getId(instantiatedAction)
                    }),
                    createId('node'),
                    relabelIdMap
                  ),
                  isNodeOf: getId(instantiatedAction)
                }),
                createId('node'),
                relabelIdMap
              );
            } else {
              return answer;
            }
          })
        );
      }

      instantiatedAction.resultReview = setId(
        Object.assign(
          {
            '@type': 'Review'
          },
          isPlainObject(instantiatedAction.resultReview)
            ? instantiatedAction.resultReview
            : undefined
        ),
        createId('node'),
        relabelIdMap
      );
      break;

    case 'DeclareAction':
      if (instantiatedAction.question) {
        instantiatedAction.question = dearrayify(
          instantiatedAction.question,
          arrayify(instantiatedAction.question).map(question => {
            if (question['@type'] === 'Question') {
              return setId(
                Object.assign({}, question, {
                  isNodeOf: getId(instantiatedAction)
                }),
                createId('node'),
                relabelIdMap
              );
            }

            return question;
          })
        );

        instantiatedAction.result = dearrayify(
          instantiatedAction.question,
          arrayify(instantiatedAction.question).map(question =>
            setId(
              {
                '@type': 'Answer',
                parentItem: getId(question),
                isNodeOf: getId(instantiatedAction)
              },
              createId('node'),
              relabelIdMap
            )
          )
        );
      }
      break;

    case 'AssessAction':
      if (instantiatedAction.potentialResult) {
        instantiatedAction.potentialResult = dearrayify(
          instantiatedAction.potentialResult,
          arrayify(instantiatedAction.potentialResult).map(potentialResult => {
            // potentialResult can be a StartWorkflowStageAction or a RejectAction
            const potentialResultTemplate =
              workflowMap[getId(potentialResult)] || potentialResult;
            // !! We do _not_ instantiate next stages => omit `result` from `StartWorkflowStageAction`

            return setId(
              Object.assign(
                {},
                potentialResultTemplate['@type'] === 'StartWorkflowStageAction'
                  ? omit(potentialResultTemplate, ['result'])
                  : potentialResultTemplate,
                {
                  instanceOf: getId(potentialResultTemplate)
                }
              ),
              createId('action', null, graphId)['@id'],
              relabelIdMap
            );
          })
        );
      }
      break;

    case 'CreateReleaseAction':
      {
        let increment =
          (instantiatedAction.result && instantiatedAction.result.version) ||
          'premajor';

        // allow to dynamically overwrite the increment
        if (resultOf && resultOf.revisionType) {
          switch (resultOf.revisionType) {
            case 'PatchRevision':
              increment = 'prepatch';
              break;
            case 'MinorRevision':
              increment = 'preminor';
              break;
            case 'MajorRevision':
              increment = 'premajor';
              break;
          }
        }

        const nextGraphVersion =
          graphVersion == null
            ? '0.0.0-0'
            : semver.inc(graphVersion, increment);
        const releaseId = createId('release', nextGraphVersion, graphId)['@id'];
        const nextObjectId = releaseId;

        instantiatedAction.result = setId(
          Object.assign(
            {
              '@type': 'Graph'
            },
            isPlainObject(instantiatedAction.result)
              ? instantiatedAction.result
              : undefined,
            { version: nextGraphVersion },
            instantiatedAction.result &&
              instantiatedAction.result.potentialAction
              ? {
                  potentialAction: multiplex(
                    arrayify(instantiatedAction.result.potentialAction)
                  ).map(template => {
                    return instantiateAction(
                      template,
                      workflowMap,
                      startWorkflowStageActionId,
                      graphId,
                      nextGraphVersion,
                      nextObjectId,
                      { relabelIdMap, isPotentialAction: true, resultOf }
                    );
                  })
                }
              : undefined
          ),
          releaseId,
          relabelIdMap
        );
      }
      break;

    case 'InformAction':
      // handle InformAction and EmailMessage. For now this is usefull for the
      // decision letters so that they have stable @id that can be targeted with
      // annotations for collaborative editing
      // InformAction must be potentialAction of a parentAction => no need to set the objectId as it was already set

      if (instantiatedAction.instrument) {
        instantiatedAction.instrument = dearrayify(
          instantiatedAction.instrument,
          arrayify(instantiatedAction.instrument).map(instrument => {
            if (instrument['@type'] === 'EmailMessage') {
              return setId(
                Object.assign({}, instrument, {
                  instanceOf: getId(instrument), // needed for resolver etc. (need to be able to easily go back to email message template)
                  isNodeOf: getId(instantiatedAction)
                }),
                createId('node'),
                relabelIdMap
              );
            }

            return instrument;
          })
        );
      }

      break;

    case 'PublishAction': {
      // Set the result of the PublishAction so that the final version is available
      // upgrade semver pre-release (e.g. 1.0.0-0) (`objectId`) to release (e.g. 1.0.0).
      const publicVersion = semver.inc(
        graphVersion != null ? graphVersion : '0.0.0-0',
        'patch'
      );
      const releaseId = createId('release', publicVersion, graphId)['@id'];

      instantiatedAction.result = setId(
        Object.assign(
          {
            '@type': 'Graph'
          },
          isPlainObject(instantiatedAction.result)
            ? instantiatedAction.result
            : undefined,
          { version: publicVersion }
        ),
        releaseId,
        relabelIdMap
      );
      break;
    }

    case 'PayAction':
    case 'ScheduleAction':
    case 'AuthorizeAction':
    case 'DeauthorizeAction':
    case 'BuyAction':
    case 'TypesettingAction':
      // Nothing else to do
      break;

    default:
      // TODO throw
      break;
  }

  // Handle `potentialAction` of a workflow action (InformAction, EndorseAction, AuthorizeAction / DeauthorizeAction)
  if (instantiatedAction.potentialAction) {
    instantiatedAction.potentialAction = dearrayify(
      instantiatedAction.potentialAction,
      arrayify(instantiatedAction.potentialAction).map(action => {
        return instantiateAction(
          action,
          workflowMap,
          startWorkflowStageActionId,
          graphId,
          graphVersion,
          getId(instantiatedAction),
          { relabelIdMap, isPotentialAction: true, resultOf }
        );
      })
    );
  }

  return instantiatedAction;
}

/**
 * Collapse to @id:
 * - `about`
 * - `ifMatch`
 * - `requiresCompletionOf` + multiplex
 * - `messageAttachment` + multiplex
 */
function collapseAndMultiplex(
  startWorkflowStageAction,
  { multiplex = false } = {}
) {
  const instantiatedActions = getInstantiatedActions(startWorkflowStageAction);

  const instantiatedActionByTemplateIds = instantiatedActions.reduce(
    (map, action) => {
      const templateId = getId(action.instanceOf);
      // some action are multiplexed => we accumulate them in a list
      if (!(templateId in map)) {
        map[templateId] = [];
      }
      map[templateId].push(action);
      return map;
    },
    {}
  );

  function process(object = {}) {
    // collapse and maybe multiplex
    ['requiresCompletionOf', 'messageAttachment'].forEach(p => {
      if (object[p]) {
        object[p] = uniq(
          flatten(
            arrayify(object[p]).map(value => {
              const id = getId(value);
              if (multiplex && id) {
                const action = instantiatedActions.find(
                  action => getId(action) === id
                );
                if (action) {
                  const actions =
                    instantiatedActionByTemplateIds[getId(action.instanceOf)];
                  return actions.map(getId);
                }
              }

              return id;
            })
          ).filter(Boolean)
        );

        if (!object[p].length) {
          delete object[p];
        }
      }
    });

    // just collapse
    ['about', 'ifMatch'].forEach(p => {
      if (object[p]) {
        object[p] = dearrayify(
          object[p],
          arrayify(object[p]).map(value => getId(value))
        );
      }
    });

    // recurse
    ['result', 'potentialResult', 'potentialAction', 'instrument'].forEach(
      p => {
        arrayify(object[p]).forEach(value => {
          if (isPlainObject(value)) {
            process(value);
          }
        });
      }
    );
  }

  process(startWorkflowStageAction);

  return startWorkflowStageAction;
}
