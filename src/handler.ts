import {Context} from './context'
import {OutputVars} from './types'
import {
  createPreviewApp,
  deletePreviewApp,
  pollPreviewAppCreationJob
} from './previewApps'
import {getProjectByPk, getRealtimeLogs, getTenantEnvByTenantId} from './tasks'
import {getOutputVars} from './utils'
import {getHasuraEnvVars} from './parameters'
import * as core from '@actions/core';
require('isomorphic-fetch');

export const handler = async (context: Context): Promise<OutputVars | {}> => {
  if (context.parameters.SHOULD_DELETE) {
    context.logger.log('Deleting Hasura Cloud preview app.')
    const deleteResp = await deletePreviewApp(context)
    context.logger.log(
      `Preview app "${context.parameters.NAME}" deleted successfully.`
    )
    return deleteResp
  }

  context.logger.log('Creating Hasura Cloud preview app.')

  context.logger.log(`Context:\n${JSON.stringify(context, null, 2)}`)

  const createResp = await createPreviewApp(context)
  context.logger.log(
    `Scheduled creation of preview app:\n${JSON.stringify(createResp, null, 2)}`
  )

  context.logger.log(`Polling the preview app creation status...`)

  const previewAppCreationMetadata = await pollPreviewAppCreationJob(
    context,
    createResp.githubPreviewAppJobID
  )

  context.logger.log(
    `Preview app creation metadata:\n${JSON.stringify(
      previewAppCreationMetadata,
      null,
      2
    )}`
  )

  context.logger.log(`Applying metadata and migrations from the branch...`)

  const envVars = getHasuraEnvVars(core.getInput('hasuraEnv'))
  // if adminSecret is not found, make a request to get envVars
  
  const adminSecret: {key: string; value: string} | undefined = envVars.find(
    e => e['key'] === 'HASURA_GRAPHQL_ADMIN_SECRET'
  );

  const project = await getProjectByPk(
    previewAppCreationMetadata.projectId,
    context
  )

  const tenantId = project.tenant.id;

  context.logger.log(`Tenant:\n${JSON.stringify(tenantId, null, 2)}`)
  context.logger.log(`Project:\n${JSON.stringify(project, null, 2)}`)

  if (tenantId) {
    // const tenant = await getTenantEnvByTenantId(tenantId, context)
    // const adminSecretFromTenant = tenant.envVars.find(
    //   e => e['key'] === 'HASURA_GRAPHQL_ADMIN_SECRET'
    // )

    const postgresFromEnv:
      | {key: string; value: string}
      | undefined = getHasuraEnvVars(core.getInput('hasuraEnv')).find(
      e => e['key'] === 'PG_ENV_VARS_FOR_HASURA'
    )

    await fetch(`${project.endpoint}/v1/metadata`, {
      headers: {
        'content-type': 'application/json',
        'x-hasura-admin-secret': adminSecret?.value as string
      },
      body: JSON.stringify({
        type: 'bulk',
        source: 'default',
        resource_version: 3,
        args: [
          {
            type: 'pg_add_source',
            args: {
              name: 'default',
              configuration: {
                connection_info: {
                  database_url: {
                    from_env: postgresFromEnv?.value
                  },
                  use_prepared_statements: false,
                  isolation_level: 'read-committed'
                },
                read_replicas: null,
                extensions_schema: null
              },
              replace_configuration: false,
              customization: {
                naming_convention: 'hasura-default'
              }
            }
          }
        ]
      }),
      method: 'POST'
    })
  } else {
    context.logger.log(`Tenant ID not found. ${JSON.stringify(project, null, 2)}`)
  }

  context.logger.log(
    `Getting logs... ${previewAppCreationMetadata.githubDeploymentJobID}`
  )

  const jobStatus = await getRealtimeLogs(
    previewAppCreationMetadata.githubDeploymentJobID,
    context
  )

  if (jobStatus === 'failed') {
    throw new Error(
      'Preview app has been created, but applying metadata and migrations failed'
    )
  }
  return getOutputVars(previewAppCreationMetadata, context.parameters)
}
